// The Witness 3D app shell: one UI shared by the web page and the desktop app. It draws what a
// backend sends and turns input into requests; all geometry lives behind the backend, which is
// OpenCascade compiled to WebAssembly on the web (LocalBackend.js) and the Rust engine on the
// desktop (apps/desktop/ui/main.js).
//
// Input follows Plasticity (see /mnt/project-files/witness3d/plasticity-parity.md and keymap.js):
// middle-drag orbits, right-drag pans, the wheel zooms; left-click selects and left-drag draws a
// selection box; a command starts from its key, the command bar or the palette (F), is adjusted
// with its yellow dot, its keys and typed numbers, and is finished by Enter, right-click or OK, or
// aborted by Escape. Starting one command finishes the one running.
//
// A backend implements:
//   info                         { kernel: string }
//   scene()                      -> Body[]
//   preview(req)                 -> Preview, or null when a newer request made this one stale
//   commit(req)                  -> { id, scene: Body[] }
//   previewBlend(req)            -> Body (the body as it would be), or null when stale; a failure
//                                   throws an error whose `edges` lists the edges the kernel blamed
//   commitBlend(req)             -> { id, scene: Body[] }
//   commitMotion(req)            -> { id, scene: Body[] }; the viewport previews a motion itself
//   deleteBodies(ids)            -> Body[]
//   duplicateBodies(ids)         -> { ids, scene: Body[] }
//   undo(), redo()               -> Body[]
//   exportStep(id)               -> string to show, or null if the user backed out
// Optional, shown only when present (the desktop has them, the web page does not yet):
//   newDocument()                -> Body[]
//   save()                       -> file name, or null if the user backed out
//   open()                       -> { name, scene: Body[] }, or null
//   importStep()                 -> { id, scene: Body[] }, { dxf: text, name } for a drawing, or null
//   curves()                     -> Curve[]; addCurves(Curve[]) -> { ids }
//   deleteItems(bodies, curves)  -> Body[]
//   previewBoolean({ target, tools, op }) -> Body, or null when stale
//   commitBoolean({ target, tools, op, keepTools }) -> { id, scene: Body[] }
// Curve:   { id, origin, x, normal, kind: 'polyline', points: [u, v][], closed } | { ..., kind: 'circle', center, radius },
//          in a plane in viewport coordinates, with v along normal × x
// Body:    { id, positions, indices, faceIds, facePlanes: ({ origin, normal } | null)[], edges: number[][], volume,
//            faceRefs: number[], edgeRefs: number[], revision }
//          `edges` holds one polyline (x, y, z, x, y, z, ...) per B-rep edge; its index is the edge's
//          number, the same on both backends, and is what a BlendRequest names. Numbers change when
//          an edit rebuilds a body; refs (`faceRefs[n]`, `edgeRefs[n]`) follow a face or edge
//          through edits, so the selection is kept as refs. `revision` changes with every edit.
// BlendRequest: { body, edges: number[], size, kind: 'fillet' | 'chamfer', angle (radians, chamfers) }
// MotionRequest: { bodies, offset, pivot, axis, angle, scale }: scale by `scale` and turn by `angle`
//          radians about `axis`, both about `pivot`, then move by `offset`, in the viewport's
//          coordinates (y up)
// Units are millimetres throughout.
// Preview: { outcome: 'join' | 'cut' | 'new' | 'none', tool: Body | null, result: Body | null }
// Request: { target, distance, op?: 'auto' | 'union' | 'difference' | 'intersect' | 'new', and one of
//          region (a closed curve's id), face (a flat face's number on target), or
//          origin, normal, xAxis, profile: { kind: 'rect', width, height } | { kind: 'circle', radius }, newBody }
//          Preview.outcome can also be 'intersect'.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { MagnitudeGizmo, typed } from '../MagnitudeGizmo.js';
import { TOOLS, check, tool as toolInfo, withDefaults } from './tools.js';
import { ACTIONS, COMMAND, VIEWPORT, keyFor, keyOf } from './keymap.js';
import { adjacent, edgeLoop, edgeRing, topology } from './edgeLoops.js';
import { Selection, faceBoundEdges, faceEdges, faceNeighbours } from './Selection.js';
import { edgeOffsetsBothSides, edgeOffsetsOnFace, facesLoopOffsets } from '../edgeOffset.js';
import { curveArrayMotions } from '../curveArray.js';
import { chamferDimensions, curveDimensions, faceDimensions, filletDimensions, solidDimensions } from '../dimension.js';
import { edgeCurve, flattenCurve } from '../altDuplicate.js';
import { EDGE_CONTINUITY, bridgeCurve, bridgePoles, edgePoint } from '../bridgeEdge.js';
import { ALIGN_CONTINUITY, alignAnalysis, alignRequest, readEdgeFaces, targetFace } from '../alignSurface.js';
import { PROJECT_CONTINUITY, projectAlignRequest } from '../projectAlign.js';
import { constrainedSurface, splineSheetData } from '../constrainedSurface.js';
import { square, squareAnalysis, quadSides } from '../square.js';
import { combTeeth, isoLines, onFace } from '../isoCombs.js';
import { liftPiece, meshSilhouette, nearestOver } from '../createOutline.js';
import { FONTS, parseFont, textShapes } from '../text.js';
import { closesUp, groupLoops } from '../loopGroups.js';
import { regionsToExtrude } from '../regions.js';
import { slidePoles } from '../polesEdit.js';
import { densify, placeOnFace, smoothThrough } from '../deform.js';
import { limitCurve } from '../loftLimits.js';
import { CULLING, DEPTHS, checkImage, imageLook, newImage } from './images.js';
import { newInstance, checkInstance, matrixOf, motionOf, instanceFromMotion, mirroredInstance } from './instances.js';
import { arrayMotions, radialSpec, rectangularSpec } from '../arrayMotions.js';
import { Constraints } from './constraints.js';
import { SNAP_KINDS, allowed as snapAllowed, kindOf as snapKindOf, parseSnaps } from './snapKinds.js';
import { Organise } from './Organise.js';
import { P_MENU, RADIALS, mergeKeys, parseRadial, shortLabel, showKey, sliceAt, slicePosition } from './menus.js';
import { ADVANCED_MATERIAL, ENVIRONMENTS, MATERIAL_LIBRARY, SHADERS, SHADER_OPTIONS, checkMaterial, formatMass, isColorKey, massOf, newMaterial, shader } from './shading.js';
import { claude, describe, MODEL, reply, request } from './ai.js';
import { icon } from './icons.js';
import { limitEdges, mergeShortEdges, polygonize, removeSmallParts, to3mf, toGlb, toObj, toStl } from '../meshExport.js';
import { flatten, toDxf, toSvg } from '../drawingExport.js';
import { readDxf } from '../dxf.js';
import { distanceToFace } from '../dependentOffset.js';
import { ALIGN_CURVE_CONTINUITY, alignCurveEnd, BRIDGE_CONTINUITY, bridgeContinuous, bridgeEnd, continuity, curvatureComb, curveVertices, deleteVertices, explode, EXTEND_SHAPES, extendCurve, filletCurve, nearestEnd, OFFSET_CORNERS, offsetCurve, offsetSlot, offsetThrough, unionLoops, moveVertices, alignedInPlane, offsetVertex, rebuildCurve, subdivideCurve, completeCurve, convertVertices, insertKnotAt, raiseDegree, reverseCurve, transformCurve, moveVerticesTo, slideCurveCVs, splitCurve, tangentCircle, tangentCircle3, trim, cutCurve, cuttersFor, samples as curveSamples } from '../curveEdit.js';
import { ViewGizmo } from './ViewGizmo.js';
import { Toolbar } from './Toolbar.js';
import { arcballAbout, dragAngles, orbitAbout } from './orbit.js';
import { poleMoves } from '../poleFalloff.js';
import { planeFrom } from '../cplaneFrom.js';
import { stepSources } from './sources.js';
import { parallelCylinders, parallelFlatFaces, relatedFaces, samePlane } from './faceGroups.js';
import { circleTangents, closestOnScreen, commonTangents, curvePointSnaps, intersections, perpendicularFeet, tangentPoints } from '../curveSnaps.js';
import { PREF_FIELDS, changedPrefs, controlSettings, readPrefs, setPref, viewColors, wheelSpeed } from './prefs.js';
import { arcPoints, circleThrough, curveFromNurbs, cvPoints, ellipsePoints, endTangent, helixPoints, loops, nurbsLoop, nurbsPoints, polygonCorners, spiralAngle, tangentArc } from '../curves.js';

const KEYS = {
  material: [['FORK', 'OWN COPY'], ['⏎ / RMB', 'OK'], ['ESC', 'CANCEL']],
  idle: [['CLICK', 'SELECT'], ['⇧ CLICK', 'ADD'], ['CTRL CLICK', 'REMOVE'], ['CTRL ⇧ CLICK', 'PICK FROM LIST'], ['DRAG', 'BOX'], ['MMB', 'ORBIT'], ['RMB', 'PAN'], ['F', 'SEARCH']],
  fillet: [['DRAG DOT', 'RADIUS'], ['IN', 'CHAMFER'], ['D', 'DISTANCE'], ['C', 'CHAMFER'], ['A', 'ANGLE'], ['V', 'VARIABLE POINT'], ['L', 'LIMIT POINTS'], ['CTRL CLICK', 'EDGES'], ['T', 'TANGENT EDGES'], ['CLICK ROUND', 'COPY RADIUS'], ['⏎ / RMB', 'OK']],
  move: [['X Y Z', 'AXIS'], ['⇧ X Y Z', 'PLANE'], ['G', 'SCREEN'], ['CTRL', 'SNAP'], ['⏎ / RMB', 'OK']],
  rotate: [['X Y Z', 'AXIS'], ['R', 'SCREEN'], ['CTRL', '15°'], ['⏎ / RMB', 'OK']],
  scale: [['S', 'UNIFORM'], ['CTRL', '0.1'], ['⏎ / RMB', 'OK']],
  extrude: [['DRAG DOT', 'DISTANCE'], ['D', 'DISTANCE'], ['F', 'FREESTYLE: CLICK START · END'], ['V', 'PIVOT: CLICK'], ['I', 'INDIVIDUAL'], ['A', 'ANGLE'], ['⇧T', 'THICKNESS'], ['S', 'BOTH SIDES'], ['Q', 'UNION'], ['W', 'DIFFERENCE'], ['⇧E', 'INTERSECT'], ['⇧Q', 'SLICE'], ['B', 'NEW BODY'], ['⏎ / RMB', 'OK']],
  boolean: [['Q', 'UNION'], ['W', 'DIFFERENCE'], ['⇧E', 'INTERSECT'], ['⇧Q', 'SLICE'], ['T', 'KEEP TOOLS'], ['⏎ / RMB', 'OK']],
  offset: [['DRAG DOT', 'DISTANCE'], ['D', 'DISTANCE'], ['A', 'ANGLE ADJACENT'], ['TAB', 'GROW MODE'], ['⇧ CLICK', 'FACES'], ['ALT+CLICK', 'A FACE TO MATCH'], ['⏎ / RMB', 'OK']],
  revolve: [['CLICK', 'AXIS START · END'], ['A', 'ANGLE'], ['⇧T', 'THICKNESS'], ['Q', 'UNION'], ['W', 'DIFFERENCE'], ['⇧E', 'INTERSECT'], ['B', 'NEW BODY'], ['⏎ / RMB', 'OK']],
  loft: [['CLICK', 'GUIDES (OPTIONAL)'], ['⏎ / RMB', 'OK'], ['ESC', 'CANCEL']],
  'loft-sheet': [['CLICK', 'ADD / REMOVE A CURVE OR EDGE'], ['O', 'LOOP'], ['L', 'LIMIT POINT'], ['TAB', 'CONTINUITY (TWO EDGES)'], ['D', 'TENSION'], ['⏎ / RMB', 'OK'], ['ESC', 'CANCEL']],
  sweep: [['CLICK', 'PATH · THEN A GUIDE'], ['M', 'GUIDE METHOD'], ['N', 'ALIGNMENT'], ['D', 'TWIST'], ['Q', 'UNION'], ['W', 'DIFFERENCE'], ['⇧E', 'INTERSECT'], ['B', 'NEW BODY'], ['⏎ / RMB', 'OK']],
  rect: [['CLICK', 'CORNERS'], ['S', 'SQUARE'], ['C', 'FROM CENTRE'], ['TAB', 'TYPE SIZE'], ['ALT', 'NO SNAP'], ['ESC', 'CANCEL']],
  circle: [['CLICK', 'CENTRE · RADIUS'], ['V', 'VERTICAL'], ['TAB', 'TYPE DIAMETER'], ['ALT', 'NO SNAP'], ['ESC', 'CANCEL']],
  line: [['CLICK', 'POINTS'], ['CLICK START', 'CLOSE'], ['X Y Z', 'AXIS'], ['CTRL Z', 'BACK'], ['TAB', 'TYPE LENGTH'], ['⏎ / RMB', 'DONE']],
  'center-rect': [['CLICK', 'CENTRE · CORNER'], ['S', 'SQUARE'], ['TAB', 'TYPE SIZE'], ['ALT', 'NO SNAP'], ['ESC', 'CANCEL']],
  rect3: [['CLICK', 'SIDE · WIDTH'], ['TAB', 'TYPE SIZE'], ['ALT', 'NO SNAP'], ['ESC', 'CANCEL']],
  circle2: [['CLICK', 'TWO ENDS'], ['TAB', 'TYPE DIAMETER'], ['ALT', 'NO SNAP'], ['ESC', 'CANCEL']],
  circle3: [['CLICK', 'THREE POINTS'], ['ALT', 'NO SNAP'], ['ESC', 'CANCEL']],
  arc3: [['CLICK', 'START · END · ON ARC'], ['ALT', 'NO SNAP'], ['ESC', 'CANCEL']],
  arc: [['CLICK', 'CENTRE · START · END'], ['TAB', 'RADIUS · ANGLE'], ['ALT', 'NO SNAP'], ['ESC', 'CANCEL']],
  polygon: [['CLICK', 'CENTRE · SIZE'], ['↑ ↓', 'SIDES'], ['⇧ WHEEL', 'SIDES'], ['C', 'CIRCUMSCRIBED'], ['V', 'VERTICAL'], ['TAB', 'TYPE RADIUS'], ['ESC', 'CANCEL']],
  ellipse: [['CLICK', 'CENTRE · AXIS · WIDTH'], ['ALT', 'NO SNAP'], ['ESC', 'CANCEL']],
  ellipse3: [['CLICK', 'AXIS ENDS · WIDTH'], ['ALT', 'NO SNAP'], ['ESC', 'CANCEL']],
  cv: [['CLICK', 'CONTROL POINTS'], ['CLICK START', 'CLOSE'], ['TAB', 'THROUGH POINTS'], ['X Y Z', 'AXIS'], ['CTRL Z', 'BACK'], ['⏎ / RMB', 'DONE']],
  spline: [['CLICK', 'POINTS'], ['CLICK START', 'CLOSE'], ['TAB', 'CONTROL POINTS'], ['X Y Z', 'AXIS'], ['CTRL Z', 'BACK'], ['⏎ / RMB', 'DONE']],
  'tangent-arc': [['CLICK', 'CURVE END · SIZE'], ['D', 'FLIP'], ['ALT', 'NO SNAP'], ['ESC', 'CANCEL']],
  spiral: [['CLICK', 'AXIS START · END · RADIUS'], ['X Y Z', 'AXIS'], ['A', 'ANGLE'], ['D', 'LENGTH'], ['R', 'RADIUS'], ['⏎ / RMB', 'OK']],
  'offset-vertex': [['DRAG DOT', 'DISTANCE'], ['D', 'DISTANCE'], ['⏎ / RMB', 'OK']],
  slide: [['DRAG DOT', 'DISTANCE'], ['D', 'DISTANCE'], ['U', 'POSITIVE U'], ['⇧U', 'NEGATIVE U'], ['V', 'POSITIVE V (SURFACE)'], ['⇧V', 'NEGATIVE V (SURFACE)'], ['N', 'NORMAL'], ['⏎ / RMB', 'OK']],
  'align-vertex': [['X / Y / Z', 'AXIS'], ['V', 'VALUE'], ['⏎ / RMB', 'OK']],
  'align-curve': [['TAB', 'CONTINUITY G0 G1 G2'], ['D', 'TENSION'], ['CHIP', 'CONSTRAIN'], ['⏎ / RMB', 'OK']],
  rebuild: [['C', 'CONTROL POINTS'], ['D', 'DEGREE'], ['⏎ / RMB', 'OK']],
  'match-face': [['CLICK', 'TARGET FACE'], ['⇧ CLICK', 'FACES'], ['TAB', 'GROW'], ['⏎ / RMB', 'OK']],
  image: [['DEL', 'REMOVE'], ['⏎ / RMB', 'OK'], ['ESC', 'CANCEL']],
  instance: [['G R S', 'MOVE ROTATE SCALE'], ['⇧D', 'DUPLICATE'], ['DEL', 'REMOVE'], ['⏎ / RMB', 'OK'], ['ESC', 'CANCEL']],
  'deform-curve': [['CLICK', 'REFERENCE, THEN TARGET FACE'], ['M U N', 'FLIP'], ['K', 'KEEP'], ['R', 'REBLEND SOLIDS'], ['⏎ / RMB', 'OK']],
  untrim: [['TAB', 'KEEP EDGES'], ['⇧ CLICK', 'FACES'], ['⏎ / RMB', 'OK']],
  unwrap: [['⇧ CLICK', 'FACES'], ['⏎ / RMB', 'OK']],
  section: [['D', 'DISTANCE'], ['F', 'FLIP'], ['⏎ / RMB', 'OK']],
  dimension: [['TAB', 'NEXT SIZE'], ['TYPE', 'NEW VALUE'], ['⏎ / RMB', 'OK']],
  text: [['TYPE', 'THE TEXT'], ['CTRL ⏎ / RMB', 'OK'], ['ESC', 'CANCEL']],
  place: [['CLICK', 'FROM, THEN TO'], ['S', 'SCALE'], ['A', 'ANGLE'], ['D', 'OFFSET'], ['F', 'FLIP'], ['I', 'INSTANCE'], ['X Y Z', 'AXIS'], ['Q W ⇧E ⇧Q B', 'BOOLEAN'], ['CLICK', 'PLACE ANOTHER'], ['⏎ / RMB', 'OK']],
  'rebuild-face': [['M', 'METHOD'], ['T', 'TOLERANCE'], ['D', 'DEGREE'], ['S', 'SPANS'], ['E', 'EXTEND'], ['H', 'SHRINK'], ['⇧ CLICK', 'FACES'], ['⏎ / RMB', 'OK']],
  'fillet-vertex': [['DRAG DOT', 'IN ROUND · OUT CHAMFER'], ['D', 'FILLET DISTANCE'], ['C', 'CHAMFER DISTANCE'], ['⏎ / RMB', 'OK']],
  'offset-curve': [['DRAG DOT', 'DISTANCE'], ['D', 'DISTANCE'], ['V / C', 'GAP FILL'], ['S', 'BOTH SIDES'], ['F', 'FREESTYLE: CLICK'], ['O', 'SLOT'], ['I', 'COMBINED'], ['⏎ / RMB', 'OK']],
  'fillet-curve': [['D', 'RADIUS'], ['TYPE', 'IN PANEL'], ['⏎ / RMB', 'OK']],
  'remove-face': [['⇧ CLICK', 'FACES'], ['⏎ / RMB', 'OK']],
  cut: [['⇧ CLICK', 'SOLIDS · CURVES'], ['⇧ ALT CLICK', 'FACES'], ['P', 'CONSTRUCTION PLANE'], ['⏎ / RMB', 'OK']],
  draft: [['A', 'ANGLE'], ['D', 'OFFSET'], ['TAB', 'GROW'], ['⇧ CLICK', 'FACES'], ['CLICK LINE', 'CURVE TAPER'], ['⏎ / RMB', 'OK']],
  imprint: [['⇧ CLICK', 'FACES · CURVES'], ['⇧ ALT CLICK', 'BODY THAT IMPRINTS'], ['X Y Z', 'VECTOR'], ['S', 'SCREEN SPACE'], ['C', 'COMPLETION'], ['⏎ / RMB', 'OK']],
  project: [['⇧ CLICK', 'SOLID · CURVES'], ['X Y Z', 'VECTOR'], ['S', 'SCREEN SPACE'], ['⏎ / RMB', 'OK']],
  'bridge-surface': [['⇧ CLICK', 'TWO EDGES, OR TWO CROSSING SHEETS'], ['T', 'TENSION'], ['A', 'ADD WALL PAIR'], ['⏎ / RMB', 'OK']],
  'extend-sheet': [['CLICK', "A SHEET'S EDGE"], ['D', 'DISTANCE'], ['CTRL+CLICK', 'A BODY TO REACH'], ['TAB', 'NATURAL · LINEAR · SOFT · REFLECTIVE'], ['⏎ / RMB', 'OK']],
  thicken: [['CLICK', 'A SHEET'], ['ALT CLICK', 'FACES (THICKEN FACE)'], ['D', 'FRONT'], ['B', 'BACK'], ['⏎ / RMB', 'OK']],
  pipe: [['⇧ CLICK', 'CURVES'], ['R', 'RADIUS'], ['T', 'THICKNESS'], ['V', 'SIDES'], ['⏎ / RMB', 'OK']],
  patch: [['⇧ CLICK', 'CURVES · EDGES'], ['T', 'TANGENT TO FACES'], ['Q', 'QUAD-SIDED'], ['⏎ / RMB', 'OK']],
  hole: [['CLICK', 'A FLAT FACE'], ['T', 'THROUGH ALL'], ['TYPE', 'SIZE IN PANEL'], ['⏎ / RMB', 'OK']],
  split: [['CLICK', 'WHERE TO SPLIT'], ['ESC / ⏎', 'DONE']],
  'measure-distance': [['CLICK', 'TWO POINTS'], ['CLICK', 'AGAIN TO RESTART'], ['ESC', 'DONE']],
  'measure-radius': [['CLICK', 'A ROUND EDGE OR CURVE'], ['ESC', 'DONE']],
  'measure-continuity': [['CLICK', 'NEAR TWO CURVE ENDS'], ['ESC', 'DONE']],
  'export-mesh': [['TYPE', 'OPTIONS IN PANEL'], ['⏎ / RMB', 'SAVE'], ['ESC', 'CANCEL']],
  'export-drawing': [['VIEW', 'AS THE CAMERA SEES IT'], ['H', 'HIDDEN LINES'], ['C', 'CURVES'], ['⏎ / RMB', 'SAVE'], ['ESC', 'CANCEL']],
  'tangent-circle': [['CLICK', 'FIRST · SECOND CURVE · SIZE OR THIRD CURVE'], ['F', 'FREEZE'], ['TAB', 'RADIUS'], ['ESC', 'CANCEL']],
  extend: [['CLICK', 'NEAR AN END'], ['S', 'SHAPE NATURAL / LINEAR'], ['TYPE', 'LENGTH IN PANEL'], ['ESC / ⏎', 'DONE']],
  bridge: [['T / D', 'TENSION'], ['TAB', 'CONTINUITY G0 G1 G2 G3'], ['X Y Z', 'AXIS'], ['Q', 'TRIM'], ['CHIP', 'CONSTRAIN'], ['⏎ / RMB', 'OK']],
  'bridge-edge': [['D', 'TENSION'], ['TAB', 'CONTINUITY G0 G1 G2 G3'], ['X Y Z', 'AXIS'], ['⏎ / RMB', 'OK']],
  'align-surface': [['TAB', 'CONTINUITY G0 G1 G2'], ['D', 'TENSION'], ['⏎ / RMB', 'OK']],
  'project-align': [['TAB', 'CONTINUITY G0 G1 G2 PERP'], ['N X Y Z S', 'PROJECTION'], ['D', 'TENSION'], ['⏎ / RMB', 'OK']],
  square: [['⇧ CLICK', 'SIDES: CURVES OR EDGES'], ['TAB', 'CONTINUITY G0 G1 G2'], ['T', 'TENSION'], ['D', 'DEGREE'], ['⏎ / RMB', 'OK']],
  'constrained-surface': [['CLICK', 'ADD A POINT'], ['CTRL Z', 'REMOVE THE LAST'], ['TAB', 'PERFORMANCE / SMOOTHNESS'], ['⏎ / RMB', 'OK']],
  trim: [['CLICK', 'PIECE TO CUT AWAY'], ['CTRL Z', 'UNDO ONE'], ['ESC / ⏎', 'DONE']],
  'cut-curve': [['CLICK', 'CUTTER CURVES · FACES'], ['TAB', 'EXTEND'], ['S', 'SCREEN SPACE'], ['⏎ / RMB', 'OK'], ['ESC', 'CANCEL']],
  'insert-knot': [['CLICK', 'ADD A CONTROL POINT'], ['ESC / ⏎', 'DONE']],
  'isoparam': [['HOVER', 'FACE'], ['CLICK', 'SPLIT'], ['TAB', 'U / V'], ['⇧ WHEEL', 'COUNT'], ['S', 'SUBDIVIDE'], ['⏎ / RMB', 'DONE']],
  'offset-edge': [['D', 'DISTANCE'], ['−', 'OTHER FACE'], ['S', 'BOTH SIDES'], ['I', 'INDIVIDUAL'], ['V', 'GAP FILL'], ['⏎ / RMB', 'OK']],
  box: [['CLICK', 'CORNER · CORNER · HEIGHT'], ['C', 'FROM CENTRE'], ['S', 'SQUARE'], ['TAB', 'TYPE'], ['H', 'HEIGHT'], ['Q W ⇧E ⇧Q', 'BOOLEAN'], ['B', 'NEW BODY'], ['⏎ / RMB', 'OK']],
  'center-box': [['CLICK', 'CENTRE · CORNER · HEIGHT'], ['C', 'FROM CORNER'], ['S', 'SQUARE'], ['TAB', 'TYPE'], ['H', 'HEIGHT'], ['Q W ⇧E ⇧Q', 'BOOLEAN'], ['B', 'NEW BODY'], ['⏎ / RMB', 'OK']],
  box3: [['CLICK', 'CORNER · SIDE · WIDTH · HEIGHT'], ['X Y Z', 'AXIS'], ['TAB', 'TYPE'], ['Q W ⇧E ⇧Q', 'BOOLEAN'], ['B', 'NEW BODY'], ['⏎ / RMB', 'OK']],
  cylinder: [['CLICK', 'CENTRE · RADIUS · HEIGHT'], ['V', 'VERTICAL'], ['TAB', 'TYPE'], ['F', 'RADIUS'], ['D', 'HEIGHT'], ['Q W ⇧E ⇧Q', 'BOOLEAN'], ['B', 'NEW BODY'], ['⏎ / RMB', 'OK']],
  sphere: [['CLICK', 'CENTRE · SIZE'], ['TAB', 'TYPE'], ['D', 'DIAMETER'], ['Q W ⇧E ⇧Q', 'BOOLEAN'], ['B', 'NEW BODY'], ['⏎ / RMB', 'OK']],
  shell: [['D', 'THICKNESS'], ['⇧ CLICK', 'FACES'], ['⏎ / RMB', 'OK']],
  mirror: [['X Y Z', 'PLANE'], ['⇧ X Y Z', 'NEGATIVE'], ['CLICK', 'FACE PLANE'], ['F', 'FREESTYLE'], ['Q', 'UNION'], ['I', 'INSTANCES'], ['⏎ / RMB', 'OK']],
  'rect-array': [['TYPE', 'COUNTS · SPACING'], ['TAB', 'SPACING / EXTENT'], ['⇧ WHEEL', 'COPIES'], ['X Y Z', 'WHEEL AXIS'], ['J', 'JOIN'], ['I', 'INSTANCES'], ['⏎ / RMB', 'OK']],
  'radial-array': [['X Y Z', 'AXIS'], ['TAB', 'TOTAL / SPACING'], ['⇧ WHEEL', 'COPIES'], ['J', 'JOIN'], ['I', 'INSTANCES'], ['⏎ / RMB', 'OK']],
  'curve-array': [['CLICK', 'CURVE'], ['A', 'ALIGN'], ['J', 'JOIN'], ['I', 'INSTANCES'], ['⏎ / RMB', 'OK']],
  pushpull: [['CLICK', 'PLACE'], ['DRAG DOT', 'DISTANCE'], ['Q', 'JOIN'], ['W', 'CUT'], ['B', 'NEW'], ['R C', 'SHAPE'], ['⏎ / RMB', 'OK']],
};
// Drawing commands: Plasticity's curve tools, which end in curves and the regions inside them.
const DRAW = {
  rect: 'RECTANGLE', circle: 'CIRCLE', line: 'LINE', 'center-rect': 'CENTER RECTANGLE', rect3: 'THREE POINT RECTANGLE',
  circle2: 'TWO POINT CIRCLE', circle3: 'THREE POINT CIRCLE', arc3: 'THREE POINT ARC', arc: 'CENTER POINT ARC',
  polygon: 'REGULAR POLYGON', spline: 'SPLINE CURVE', ellipse: 'CENTER ELLIPSE', ellipse3: 'THREE POINT ELLIPSE',
  'tangent-arc': 'TANGENT ARC', spiral: 'SPIRAL', cv: 'CONTROL POINT CURVE',
};
for (const id of Object.keys(DRAW)) KEYS[id]?.splice(-1, 0, ['K', 'KNIFE']);
// Clicks that finish each drawing; lines and splines go on until closed or finished.
const CLICKS = { rect: 2, 'center-rect': 2, rect3: 3, circle: 2, circle2: 2, circle3: 3, arc3: 3, arc: 3, polygon: 2, ellipse: 3, ellipse3: 3, 'tangent-arc': 2 };
// Commands that grow a solid from drawn regions, sharing one panel.
const FORMS = { revolve: true, loft: true, sweep: true };
const PRIMS = { box: true, 'center-box': true, box3: true, cylinder: true, sphere: true };
// Commands that aren't tools in the registry (they act on a click, not on settings).
const EDITS = { isoparam: 'ISOPARAM', 'offset-vertex': 'OFFSET VERTEX', slide: 'SLIDE CURVE CV', 'fillet-vertex': 'FILLET VERTEX', 'align-vertex': 'ALIGN VERTEX', 'align-curve': 'ALIGN CURVE', rebuild: 'REBUILD CURVE', 'rebuild-face': 'REBUILD FACE', 'match-face': 'MATCH FACE', 'deform-curve': 'DEFORM', image: 'REFERENCE IMAGE', instance: 'INSTANCE', untrim: 'UNTRIM', unwrap: 'UNWRAP FACE', section: 'SECTION ANALYSIS', place: 'PLACE', dimension: 'DIMENSION', text: 'TEXT', 'insert-knot': 'INSERT KNOT', 'offset-edge': 'OFFSET EDGE', material: 'SET MATERIAL', 'export-mesh': 'EXPORT MESH', 'export-drawing': 'EXPORT DRAWING', 'measure-continuity': 'MEASURE CONTINUITY', trim: 'TRIM', 'cut-curve': 'CUT CURVE', 'bridge-edge': 'BRIDGE EDGE', 'align-surface': 'ALIGN SURFACE', 'project-align': 'PROJECT ALIGN', 'constrained-surface': 'CONSTRAINED SURFACE', square: 'SQUARE', extend: 'EXTEND CURVE', 'tangent-circle': 'TANGENT CIRCLE', split: 'SPLIT CURVE', 'measure-distance': 'MEASURE DISTANCE', 'measure-radius': 'MEASURE RADIUS' };
const keysHtml = id => KEYS[id].map(([k, v]) => `<kbd>${k}</kbd><span>${v}</span>`).join('');
// The Command Bar, exactly the manual's list (Plasticity Essentials › Command Bar).
const BAR = [['palette', 'F', 'SEARCH'], ['tool:move', 'G', 'MOVE'], ['tool:rotate', 'R', 'ROTATE'], ['tool:scale', 'S', 'SCALE'], ['duplicate', '⇧D', 'DUPLICATE'], ['tool:boolean', 'Q', 'BOOLEAN'], ['tool:rect-array', '', 'RECTANGULAR ARRAY'], ['tool:radial-array', '', 'RADIAL ARRAY'], ['suggest', '⇧F', 'SUGGESTED COMMANDS']];

const SHELL = `
<div class="w3d">
  <header class="bar">
    <div class="brand"><button class="pmenu-open" data-id="pmenu-open" aria-haspopup="menu" aria-expanded="false" title="File menu">WITNESS 3D <span class="caret">▾</span></button></div>
    <nav class="tools" data-id="tools" aria-label="Tools"></nav>
    <span class="spacer"></span>
    <button class="export" data-action="ask" title="Ask for a command in words (Ctrl+K)">${icon('ask')}ASK</button>
    <button class="export" data-id="file-new" hidden>${icon('file-new')}NEW</button>
    <button class="export" data-id="file-open" hidden>${icon('file-open')}OPEN</button>
    <button class="export" data-id="file-save" hidden>${icon('file-save')}SAVE</button>
    <button class="export" data-id="import" hidden title="Import a STEP, IGES or DXF file">${icon('import')}IMPORT</button>
    <input type="file" data-id="import-file" accept=".dxf,.png,.jpg,.jpeg" hidden>
    <button class="export" data-id="export" disabled title="Export STEP">${icon('export')}STEP</button>
    <span class="file" data-id="file-name">UNTITLED.W3D</span>
  </header>
  <div class="pmenu" data-id="pmenu" role="menu" hidden></div>
  <div class="prefs" data-id="prefs" role="dialog" aria-label="Preferences" hidden></div>

  <aside class="left" aria-label="Document">
    <div class="tabs" role="tablist">
      <button role="tab" data-id="tab-outliner" aria-selected="true">OUTLINER</button>
      <button role="tab" data-id="tab-history" aria-selected="false">HISTORY <span data-id="history-count">00</span></button>
    </div>
    <div class="list" data-id="outliner"></div>
    <div class="list" data-id="history" hidden></div>
    <dl class="stats">
      <dt>SELECTED</dt><dd data-id="sel-count">—</dd>
      <dt>VOLUME</dt><dd data-id="volume">—</dd>
      <dt>FACES</dt><dd data-id="faces">—</dd>
      <dt>MASS</dt><dd data-id="mass">—</dd>
    </dl>
    <div class="pair">
      <button data-id="undo" title="Undo (Ctrl+Z)">${icon('undo')}UNDO</button>
      <button data-id="redo" title="Redo (Ctrl+Shift+Z)">${icon('redo')}REDO</button>
    </div>
  </aside>

  <main class="view">
    <canvas aria-label="3D modeling viewport"></canvas>
    <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
    <span class="hud" data-id="hud" data-idle>SELECT · F SEARCH</span>
    <div class="nav" data-id="nav" aria-label="View navigation"></div>
    <div class="modes" role="group" aria-label="Selection mode">
      ${[['point', 'POINTS', '1'], ['edge', 'EDGES', '2'], ['face', 'FACES', '3'], ['solid', 'SOLIDS', '4'], ['all', 'ALL', '5']].map(([m, name, k]) => `<button data-mode="${m}" aria-pressed="true" aria-label="Select ${name.toLowerCase()}" title="${name} (${k}${m === 'all' ? '' : ` · ⇧${k} toggles`})">${icon(`mode-${m}`)}</button>`).join('')}
    </div>
    <div class="cmdbar" role="toolbar" aria-label="Command bar">
      ${BAR.map(([a, k, l]) => `<button data-action="${a}" aria-label="${l}" title="${l}${k ? ` (${k})` : ''}">${icon(a === 'palette' ? 'search' : a === 'suggest' ? 'suggest' : a.replace('tool:', ''))}${k ? `<kbd>${k}</kbd>` : ''}</button>`).join('')}
    </div>
    <div class="keys" data-id="keys">${keysHtml('idle')}</div>
    <span class="snap-tag" data-id="snap-tag" hidden></span>
    <div class="radial" data-id="radial" hidden><div class="radial-hub" data-id="radial-hub"></div></div>
    <button class="isolated" data-id="isolated" hidden title="Unisolate (Alt+.)">${icon('isolate')}<span>0 ISOLATED</span></button>
    <div class="boxsel" data-id="boxsel" hidden></div>
    <div class="pickmenu" data-id="pickmenu" role="menu" aria-label="Pick from what is under the pointer" hidden></div>
    <div class="palette" data-id="palette" hidden>
      <div class="palette-title" data-id="palette-title">SEARCH COMMANDS</div>
      <input data-id="palette-input" placeholder="TYPE A COMMAND" autocomplete="off" spellcheck="false">
      <ul data-id="palette-list" role="listbox"></ul>
      <div class="palette-foot">RIGHT-CLICK A COMMAND TO SET ITS KEY</div>
    </div>
    <div class="palette ask" data-id="ask" hidden>
      <div class="palette-title" data-id="ask-title">ASK · ONE COMMAND, PREVIEWED FIRST</div>
      <input data-id="ask-input" placeholder="E.G. ROUND THE TOP EDGES BY 4 MM" autocomplete="off" spellcheck="false">
      <div class="ask-out" data-id="ask-out"></div>
    </div>
    <div class="toast" data-id="toast" hidden></div>
    <div class="loading" data-id="loading">STARTING THE KERNEL…</div>
  </main>

  <aside class="right" aria-label="Inspector">
    <header><span data-id="tool-name">SELECT</span><span data-id="target">—</span></header>
    <div class="sec" data-panel="fillet" hidden>
      <span class="hint" data-id="blend-hint">SELECT EDGES TO ROUND</span>
      <div class="field"><label for="w3d-blend-distance">DISTANCE</label><input id="w3d-blend-distance" data-id="blend-distance" type="number" step="0.5" value="0" title="Negative makes a chamfer"></div>
      <div class="field"><label for="w3d-blend-angle">ANGLE °</label><input id="w3d-blend-angle" data-id="blend-angle" type="number" step="5" min="1" max="89" value="45" title="The chamfer's angle"></div>
      <div class="field"><label>SHAPE</label><output data-id="blend-kind">ROUND</output></div>
      <div class="seg" role="group" aria-label="Fillet shape"><button data-flshape="round" aria-pressed="true" title="A circular round of the radius">ROUND</button><button data-flshape="chordal" aria-pressed="false" title="The distance is the width across the round">CHORDAL</button><button data-flshape="conic" aria-pressed="false" title="A conic between the same lines; Tension is its rho">CONIC</button><button data-flshape="g2" aria-pressed="false" title="Curvature continuous with the faces it joins">G2</button><button data-flshape="full" aria-pressed="false" title="Full: two edges of one face; the round touches that face and both beside it, so the size is not used">FULL</button></div>
      <div class="field" data-id="blend-tension-row" hidden><label for="w3d-blend-tension">TENSION</label><input id="w3d-blend-tension" data-id="blend-tension" type="number" step="0.05" min="0.05" max="0.95" value="0.5" title="Conic: its rho (0.5 a parabola, higher pulls into the corner). G2: how far toward the corner it reaches"></div>
      <div class="field"><label>EDGES</label><output data-id="blend-count">0</output></div>
      <div class="field"><label>VARIABLE POINTS</label><output data-id="blend-vars" title="V adds one on a rounded edge; drag its dot for the radius there">0</output></div>
      <div class="field"><label>LIMIT POINTS</label><output data-id="blend-limits" title="L adds one on a rounded edge; with two the round runs only between them">0</output></div>
      <div class="chips"><button data-id="blend-tangent" aria-pressed="true" title="Add tangent edges: the round runs on along edges tangent to the picked ones. Off, it stops at the ends of the picked edges"><kbd>T</kbd>TANGENT EDGES</button></div>
    </div>
    <div class="sec" data-panel="spiral" hidden>
      <span class="hint" data-id="spiral-hint">CLICK THE START OF THE AXIS</span>
      <div class="field"><label for="w3d-spiral-turns">TURNS</label><input id="w3d-spiral-turns" data-id="spiral-turns" data-spiral-field="turns" type="number" step="0.5" min="0" value="4"></div>
      <div class="field"><label for="w3d-spiral-radius">RADIUS</label><input id="w3d-spiral-radius" data-id="spiral-radius" data-spiral-field="radius" type="number" step="0.5" min="0" value="0"></div>
      <div class="field"><label for="w3d-spiral-length">LENGTH</label><input id="w3d-spiral-length" data-id="spiral-length" data-spiral-field="length" type="number" step="0.5" min="0" value="0"></div>
      <div class="field"><label for="w3d-spiral-angle">ANGLE °</label><input id="w3d-spiral-angle" data-id="spiral-angle" data-spiral-field="angle" type="number" step="1" value="0"></div>
      <div class="chips"><button data-spiral="left" aria-pressed="false">LEFT HANDED</button></div>
    </div>
    <div class="sec" data-panel="draw" hidden>
      <span class="hint" data-id="draw-hint">CLICK A FACE OR THE CONSTRUCTION PLANE</span>
      <div class="field"><label>SIZE</label><output data-id="draw-size">—</output></div>
      <div class="field"><label>POINTS</label><output data-id="draw-points">0</output></div>
      <div class="chips" data-id="draw-rect">
        <button data-draw="square" aria-pressed="false"><kbd>S</kbd>SQUARE</button>
        <button data-draw="centre" aria-pressed="false"><kbd>C</kbd>FROM CENTRE</button>
      </div>
      <div class="chips" data-id="draw-polygon" hidden>
        <span class="field"><label>SIDES</label><output data-id="draw-sides">6</output></span>
        <button data-draw="fewer" aria-pressed="false"><kbd>↓</kbd>FEWER</button>
        <button data-draw="more" aria-pressed="false"><kbd>↑</kbd>MORE</button>
        <button data-draw="circumscribed" aria-pressed="false"><kbd>C</kbd>CIRCUMSCRIBED</button>
      </div>
      <div class="chips"><button data-draw="knife" aria-pressed="false"><kbd>K</kbd>KNIFE</button></div>
      <div class="chips" data-id="draw-vertical" hidden>
        <button data-draw="vertical" aria-pressed="false"><kbd>V</kbd>VERTICAL</button>
      </div>
    </div>
    <div class="sec" data-panel="extrude" hidden>
      <span class="hint" data-id="ex-hint">DRAG THE DOT, OR D AND TYPE</span>
      <div class="field"><label for="w3d-ex-distance">DISTANCE</label><input id="w3d-ex-distance" data-id="ex-distance" type="number" step="2.5" value="0"></div>
      <div class="field"><label for="w3d-ex-angle">ANGLE °</label><input id="w3d-ex-angle" data-id="ex-angle" type="number" step="1" value="0"></div>
      <div class="field"><label for="w3d-ex-thickness">THICKNESS</label><input id="w3d-ex-thickness" data-id="ex-thickness" type="number" step="0.5" min="0" value="0"></div>
      <div class="chips"><button data-id="ex-lock" aria-pressed="false"><kbd>S</kbd>BOTH SIDES</button></div>
      <div class="chips">
        <button data-id="ex-free" aria-pressed="false" title="Click a start point and an end point: they set the direction and distance"><kbd>F</kbd>FREESTYLE</button>
        <button data-id="ex-pivot" aria-pressed="false" title="Click where the gizmo sits"><kbd>V</kbd>PIVOT</button>
        <button data-id="ex-individual" aria-pressed="false" title="Each selected face along its own normal instead of all along the first face's"><kbd>I</kbd>INDIVIDUAL</button>
      </div>
      <div class="field"><label>RESULT</label><output data-id="ex-outcome">—</output></div>
      <span class="label">OPERATION</span>
      <div class="seg wrap" role="group" aria-label="Extrude operation">
        <button data-xop="union" aria-pressed="false"><kbd>Q</kbd>UNION</button>
        <button data-xop="difference" aria-pressed="false"><kbd>W</kbd>DIFF</button>
        <button data-xop="intersect" aria-pressed="false"><kbd>⇧E</kbd>INTER</button>
        <button data-xop="slice" aria-pressed="false"><kbd>⇧Q</kbd>SLICE</button>
        <button data-xop="new" aria-pressed="false"><kbd>B</kbd>NEW</button>
      </div>
    </div>
    <div class="sec" data-panel="boolean" hidden>
      <span class="hint" data-id="bool-hint">THE FIRST SOLID SELECTED IS THE TARGET</span>
      <div class="field"><label>TOOLS</label><output data-id="bool-tools">—</output></div>
      <span class="label">OPERATION</span>
      <div class="seg wrap2" role="group" aria-label="Boolean operation">
        <button data-bop="union" aria-pressed="true"><kbd>Q</kbd>UNION</button>
        <button data-bop="difference" aria-pressed="false"><kbd>W</kbd>DIFF</button>
        <button data-bop="intersect" aria-pressed="false"><kbd>⇧E</kbd>INTER</button>
        <button data-bop="slice" aria-pressed="false"><kbd>⇧Q</kbd>SLICE</button>
        <button data-bop="region" aria-pressed="false" title="Region: a solid for each part of space the bodies (solids and sheets) close off">REGION</button>
      </div>
      <span class="label">TARGET MATERIAL</span>
      <div class="seg wrap2" role="group" aria-label="Target material"><button data-btmat="default" aria-pressed="true" title="The target as it is">DEFAULT</button><button data-btmat="empty" aria-pressed="false" title="Only the target's skin: a solid's faces taken as a sheet">EMPTY</button><button data-btmat="inside" aria-pressed="false" title="A sheet target as solid behind its faces (against their normals); a closed sheet as the solid it bounds">INSIDE</button><button data-btmat="outside" aria-pressed="false" title="The space in front of a sheet target's faces, or all the space outside a solid">OUTSIDE</button></div>
      <span class="label">TOOL MATERIAL</span>
      <div class="seg wrap2" role="group" aria-label="Tool material"><button data-bumat="default" aria-pressed="true" title="The tool as it is">DEFAULT</button><button data-bumat="empty" aria-pressed="false" title="Only the tool's skin: a solid's faces taken as a sheet">EMPTY</button><button data-bumat="inside" aria-pressed="false" title="A sheet tool as solid behind its faces (against their normals); a closed sheet as the solid it bounds">INSIDE</button><button data-bumat="outside" aria-pressed="false" title="The space in front of a sheet tool's faces, or all the space outside a solid">OUTSIDE</button></div>
      <div class="chips"><button data-id="bool-keep" aria-pressed="false"><kbd>T</kbd>KEEP TOOLS</button></div>
    </div>
    <div class="sec" data-panel="offset" hidden>
      <span class="hint" data-id="off-hint">DRAG THE DOT, OR D AND TYPE</span>
      <div class="field"><label for="w3d-off-distance">DISTANCE</label><input id="w3d-off-distance" data-id="off-distance" type="number" step="0.5" value="0"></div>
      <div class="field"><label for="w3d-off-angle">ANGLE ADJACENT °</label><input id="w3d-off-angle" data-id="off-angle" type="number" step="1" value="0"></div>
      <span class="label">GROW</span>
      <div class="seg" role="group" aria-label="Grow mode"><button data-grow="moving" aria-pressed="true" title="Move the whole wall when the offset gets to the outer wall">MOVING</button><button data-grow="fixed" aria-pressed="false" title="Stop at the outer wall">FIXED</button><button data-grow="none" aria-pressed="false" title="Keep going by itself, past the outer wall">NONE</button></div>
      <div class="field"><label>FACES</label><output data-id="off-count">0</output></div>
    </div>
    <div class="sec" data-panel="export-mesh" hidden>
      <span class="hint" data-id="mx-hint">—</span>
      <span class="label">FORMAT</span>
      <div class="seg" role="group" aria-label="Mesh format"><button data-mxf="obj" aria-pressed="true">OBJ</button><button data-mxf="stl" aria-pressed="false" title="Binary STL, millimetres">STL</button><button data-mxf="glb" aria-pressed="false" title="Binary glTF in metres, with each body's material">GLB</button><button data-mxf="3mf" aria-pressed="false" title="3MF for printing, millimetres, with each body's colour">3MF</button></div>
      <div class="field" title="Overall density: sets Tolerance and Angle together, coarse to fine"><label for="w3d-mx-density">DENSITY</label><input id="w3d-mx-density" data-id="mx-density" type="range" min="0" max="1" step="0.01" value="0.33"></div>
      <div class="field"><label for="w3d-mx-tol">TOLERANCE</label><input id="w3d-mx-tol" data-id="mx-tol" type="number" step="0.01" min="0.001" value="0.05"></div>
      <div class="field"><label for="w3d-mx-angle">ANGLE °</label><input id="w3d-mx-angle" data-id="mx-angle" type="number" step="1" min="0.5" value="15"></div>
      <div class="field"><label for="w3d-mx-width">MAX WIDTH</label><input id="w3d-mx-width" data-id="mx-width" type="number" step="1" min="0" value="0"></div>
      <div class="field"><label for="w3d-mx-min">MIN WIDTH</label><input id="w3d-mx-min" data-id="mx-min" type="number" step="0.1" min="0" value="0" title="Edges shorter than this are merged away (0 keeps them all)"></div>
      <div class="field" data-id="mx-obj-scale"><label for="w3d-mx-scale">SCALE</label><input id="w3d-mx-scale" data-id="mx-scale" type="number" step="0.1" min="0.000001" value="1" title="OBJ: every coordinate multiplied by this, for the other program's units"></div>
      <span class="label" data-id="mx-up-label">UP AXIS</span>
      <div class="seg" role="group" aria-label="Up axis" data-id="mx-up"><button data-mxup="z" aria-pressed="true" title="Z up, as this app shows it">Z</button><button data-mxup="y" aria-pressed="false" title="Y up, as most mesh programs have it">Y</button></div>
      <span class="label" data-id="mx-topo-label">TOPOLOGY</span>
      <div class="seg" role="group" aria-label="Topology" data-id="mx-topo"><button data-mxtopo="tris" aria-pressed="true" title="Triangles only">TRIS</button><button data-mxtopo="quads" aria-pressed="false" title="Quads, with triangles where two will not pair">QUADS</button><button data-mxtopo="ngons" aria-pressed="false" title="Each flat run of faces one polygon of any number of sides">NGONS</button></div>
      <div class="chips" data-id="mx-convex-row"><button data-id="mx-convex" aria-pressed="false" title="Ngons: only convex polygons; a run that is not convex stays triangles">CONVEX NGONS ONLY</button></div>
      <div class="field" title="Separate pieces smaller across (their bounding box's diagonal) than this are left out; 0 keeps them all"><label for="w3d-mx-small">REMOVE SMALL FEATURES</label><input id="w3d-mx-small" data-id="mx-small" type="number" step="0.5" min="0" value="0"></div>
    </div>
    <div class="sec" data-panel="export-drawing" hidden>
      <span class="hint" data-id="dr-hint">—</span>
      <span class="label">FORMAT</span>
      <div class="seg" role="group" aria-label="Drawing format"><button data-drf="svg" aria-pressed="true">SVG</button><button data-drf="dxf" aria-pressed="false">DXF</button></div>
      <div class="chips"><button data-id="dr-hidden" aria-pressed="true" title="Hidden lines (H)">HIDDEN</button><button data-id="dr-curves" aria-pressed="true" title="Curves (C)">CURVES</button></div>
      <div class="field"><label for="w3d-dr-tol">TOLERANCE</label><input id="w3d-dr-tol" data-id="dr-tol" type="number" step="0.01" min="0.001" value="0.01"></div>
    </div>
    <div class="sec" data-panel="offset-curve" hidden>
      <span class="hint" data-id="oc-hint">—</span>
      <div class="field"><label for="w3d-oc-d">DISTANCE</label><input id="w3d-oc-d" data-id="oc-d" type="number" step="0.5" value="5"></div>
      <span class="label">GAP FILL</span>
      <div class="chips"><button data-id="oc-linear" aria-pressed="true">LINEAR</button><button data-id="oc-round" aria-pressed="false">ROUND</button><button data-id="oc-natural" aria-pressed="false">NATURAL</button></div>
      <div class="chips"><button data-id="oc-lock" aria-pressed="false" title="Lock distances: offset both sides (S)"><kbd>S</kbd>BOTH SIDES</button><button data-id="oc-free" aria-pressed="false" title="Freestyle: click where the offset goes (F)"><kbd>F</kbd>FREESTYLE</button><button data-id="oc-slot" aria-pressed="false" title="Slot: an open curve offset both ways and closed round its ends (O)"><kbd>O</kbd>SLOT</button><button data-id="oc-combine" aria-pressed="false" title="Combined: closed offsets merge where they overlap (I)"><kbd>I</kbd>COMBINED</button></div>
    </div>
    <div class="sec" data-panel="offset-edge" hidden>
      <span class="hint" data-id="oe-hint">—</span>
      <div class="field"><label for="w3d-oe-d">DISTANCE</label><input id="w3d-oe-d" data-id="oe-d" type="number" step="0.5" value="2"></div>
      <span class="label">GAP FILL</span>
      <div class="chips"><button data-oecorner="linear" aria-pressed="true" title="Offsets meet in a sharp corner">LINEAR</button><button data-oecorner="round" aria-pressed="false" title="An arc round the corner">ROUND</button><button data-oecorner="natural" aria-pressed="false" title="The offsets run on into each other smoothly">NATURAL</button></div>
      <div class="chips"><button data-id="oe-both" aria-pressed="false" title="Offset onto both faces of the edge at once"><kbd>S</kbd>BOTH SIDES</button><button data-id="oe-individual" aria-pressed="false" title="Individual: each picked face's own outline, rather than the outline of the faces together" hidden><kbd>I</kbd>INDIVIDUAL</button></div>
    </div>
    <div class="sec" data-panel="isoparam" hidden>
      <span class="hint" data-id="iso-hint">HOVER A FACE</span>
      <span class="label">DIRECTION</span>
      <div class="seg" role="group" aria-label="Direction">
        <button data-isodir="u" aria-pressed="true" title="The curve that runs along the face's u, v held"><kbd>U</kbd>ALONG U</button>
        <button data-isodir="v" aria-pressed="false" title="The curve that runs along the face's v, u held"><kbd>V</kbd>ALONG V</button>
      </div>
      <div class="field"><label for="w3d-iso-count">COUNT</label><input id="w3d-iso-count" data-id="iso-count" type="number" step="1" min="1" max="64" value="1" title="How many edges, spread evenly across the face (Shift + wheel); one follows the pointer"></div>
      <div class="field"><label for="w3d-iso-param">PARAM</label><input id="w3d-iso-param" data-id="iso-param" type="number" step="0.05" min="0" max="1" placeholder="cursor" title="Where one edge lies, from 0 to 1 across the face; empty follows the pointer"></div>
      <div class="chips"><button data-id="iso-subdivide" aria-pressed="false" title="Subdivide: split the face's control surface too, each piece its own, its control points meeting along the new edges"><kbd>S</kbd>SUBDIVIDE</button></div>
    </div>
    <div class="sec" data-panel="offset-vertex" hidden>
      <span class="hint" data-id="ov-hint">—</span>
      <div class="field"><label for="w3d-ov-d">DISTANCE</label><input id="w3d-ov-d" data-id="ov-d" type="number" step="0.5" min="0.001" value="2"></div>
    </div>
    <div class="sec" data-panel="slide" hidden>
      <span class="hint" data-id="sl-hint">—</span>
      <div class="field"><label for="w3d-sl-d">DISTANCE</label><input id="w3d-sl-d" data-id="sl-d" type="number" step="0.5" value="0" title="How far the control points slide (D)"></div>
      <span class="label">DIRECTION</span>
      <div class="seg" role="group" aria-label="Slide direction"><button data-sldir="u" aria-pressed="true" title="Along the control cage, +U (U)"><kbd>U</kbd></button><button data-sldir="-u" aria-pressed="false" title="Back along the control cage, −U (Shift+U)"><kbd>⇧U</kbd></button><button data-sldir="v" aria-pressed="false" title="Along the face's net in v, +V (V)" hidden><kbd>V</kbd></button><button data-sldir="-v" aria-pressed="false" title="Back along the face's net in v, −V (Shift+V)" hidden><kbd>⇧V</kbd></button><button data-sldir="n" aria-pressed="false" title="Across the cage: in the curve's plane, or off the face (N)"><kbd>N</kbd></button></div>
    </div>
    <div class="sec" data-panel="align-vertex" hidden>
      <span class="hint" data-id="av-hint">—</span>
      <span class="label">AXIS</span>
      <div class="seg" role="group" aria-label="Axis">
        <button data-avaxis="x" aria-pressed="true" title="Line the vertices up across x: they share one x"><kbd>X</kbd>X</button>
        <button data-avaxis="y" aria-pressed="false" title="They share one y"><kbd>Y</kbd>Y</button>
        <button data-avaxis="z" aria-pressed="false" title="They share one z (height)"><kbd>Z</kbd>Z</button>
      </div>
      <div class="field"><label for="w3d-av-v">VALUE</label><input id="w3d-av-v" data-id="av-v" type="number" step="0.5" value="0"></div>
    </div>
    <div class="sec" data-panel="align-curve" hidden>
      <span class="hint" data-id="ac-hint">—</span>
      <span class="label">CONTINUITY</span>
      <div class="seg" role="group" aria-label="Continuity with the reference"><button data-accont="G0" aria-pressed="false" title="Meet the reference point (G0)">G0</button><button data-accont="G1" aria-pressed="true" title="Meet it and carry its direction on (G1)">G1</button><button data-accont="G2" aria-pressed="false" title="Carry its curvature on too (G2)">G2</button></div>
      <div class="field" title="Where along the reference curve to meet it, 0 its start to 1 its end, by length"><label for="w3d-ac-p">PARAMETER</label><input id="w3d-ac-p" data-id="ac-p" type="number" step="0.05" min="0" max="1" value="1"></div>
      <div class="field" title="How fast the curve leaves the point, against how fast it does now (D)"><label for="w3d-ac-t">TENSION</label><input id="w3d-ac-t" data-id="ac-t" type="number" step="0.1" min="0.05" value="1"></div>
      <div class="chips"><button data-id="ac-comb" aria-pressed="true" title="Show the curvature of both curves">CURVATURE</button><button data-id="ac-constrain" aria-pressed="false" title="Create constraints: the aligned end keeps meeting the other curve, made again with the same continuity when that curve is edited (for this session)">CONSTRAIN</button></div>
    </div>
    <div class="sec" data-panel="square" hidden>
      <span class="hint" data-id="sq-hint">—</span>
      <span class="label">CONTINUITY</span>
      <div class="seg" role="group" aria-label="Continuity with the faces along edge sides"><button data-sqcont="FREE" aria-pressed="false" title="Free: one span each way unless set, near the sides rather than on them, for a clean draft (Tab)">FREE</button><button data-sqcont="G0" aria-pressed="true" title="Meet the sides (G0) (Tab)">G0</button><button data-sqcont="G1" aria-pressed="false" title="Carry on the faces along edge sides (G1) (Tab)">G1</button><button data-sqcont="G2" aria-pressed="false" title="Carry on the faces along edge sides and bend as they do (G2) (Tab)">G2</button></div>
      <div class="field" title="How far the sheet carries on along the faces before turning (G1, G2) (T)"><label for="w3d-sq-t">TENSION</label><input id="w3d-sq-t" data-id="sq-t" type="number" step="0.1" min="0.1" value="1"></div>
      <div class="field" title="The surface's degree each way (D)"><label for="w3d-sq-d">DEGREE</label><input id="w3d-sq-d" data-id="sq-d" type="number" step="1" min="1" max="7" value="3"></div>
      <div class="field" title="Spans across the first side; 0 picks them to follow the sides within 0.01 mm"><label for="w3d-sq-u">SPANS U</label><input id="w3d-sq-u" data-id="sq-u" type="number" step="1" min="0" max="64" value="0"></div>
      <div class="field" title="Spans across the second side; 0 is as many as U"><label for="w3d-sq-v">SPANS V</label><input id="w3d-sq-v" data-id="sq-v" type="number" step="1" min="0" max="64" value="0"></div>
      <div class="field" title="How far the inner control points lie toward the plane of the sides: 0 follows the sides, 1 is as flat as they allow"><label for="w3d-sq-flat">FLATNESS</label><input id="w3d-sq-flat" data-id="sq-flat" type="number" step="0.1" min="0" max="1" value="0"></div>
      <div class="field" title="How strictly the sheet keeps to the sides: 1 on them, lower loosens them for a fairer surface"><label for="w3d-sq-w">WEIGHT</label><input id="w3d-sq-w" data-id="sq-w" type="number" step="0.1" min="0.05" max="1" value="1"></div>
      <div class="chips" data-id="sq-xrow" hidden><button data-id="sq-quad" aria-pressed="false" title="Fill the whole loop as one untrimmed four-sided surface, cut at its four corners (Q)"><kbd>Q</kbd>QUAD SIDED</button></div>
      <div class="seg" data-id="sq-qrow" role="group" aria-label="Quality: how closely the fit follows the sides" hidden><button data-sqquality="auto" aria-pressed="true" title="Auto: within 0.01 mm of the sides">AUTO</button><button data-sqquality="high" aria-pressed="false" title="High: within 0.001 mm">HIGH</button><button data-sqquality="max" aria-pressed="false" title="Max: within 0.0001 mm">MAX</button></div>
      <span class="label">BOUNDARY</span>
      <div class="seg" role="group" aria-label="How the isocurves leave the free sides"><button data-sqbound="natural" aria-pressed="true" title="Natural: the isocurves leave the sides as the fit has them">NATURAL</button><button data-sqbound="normal" aria-pressed="false" title="Normal: the isocurves leave the sides square to them">NORMAL</button><button data-sqbound="next" aria-pressed="false" title="Next: square to the sides that are nearly flat">NEXT</button><button data-sqbound="adjacent" aria-pressed="false" title="Adjacent: the isocurves lean from one neighbouring side's direction to the other's">ADJ.</button></div>
      <div class="chips"><button data-id="sq-analysis" aria-pressed="false" title="Analysis: check how the sheet meets its sides (G0 gap) and the faces along edge sides (G1 angle, G2 curvature) against the tolerances">ANALYSIS</button></div>
      <div data-id="sq-analysis-row" hidden>
        <div class="field two" title="Analysis tolerances: the largest gap (mm) and angle out of a face (°) that still pass"><label for="w3d-sq-tg0">G0 MM · G1 °</label><input id="w3d-sq-tg0" data-id="sq-tg0" type="number" step="0.01" min="0" value="0.01" aria-label="G0 tolerance"><input data-id="sq-tg1" type="number" step="0.1" min="0" value="0.5" aria-label="G1 tolerance"></div>
        <div class="field" title="Analysis tolerance: the largest difference in curvature across an edge side that still passes, per mm"><label for="w3d-sq-tg2">G2 /MM</label><input id="w3d-sq-tg2" data-id="sq-tg2" type="number" step="0.0005" min="0" value="0.001"></div>
        <div class="field"><label>G0</label><output data-id="sq-r0">—</output></div>
        <div class="field"><label>G1</label><output data-id="sq-r1">—</output></div>
        <div class="field"><label>G2</label><output data-id="sq-r2">—</output></div>
      </div>
    </div>
    <div class="sec" data-panel="constrained-surface" hidden>
      <span class="hint" data-id="cs-hint">—</span>
      <div class="field" title="How close the surface must come to every point"><label for="w3d-cs-tol">TOLERANCE</label><input id="w3d-cs-tol" data-id="cs-tol" type="number" step="0.001" min="0.0001" value="0.01"></div>
      <div class="field" title="How sharply the surface may bend to reach the points, in degrees; higher is more relaxed"><label for="w3d-cs-ang">ANGULAR TOL.</label><input id="w3d-cs-ang" data-id="cs-ang" type="number" step="1" min="0.5" max="90" value="15"></div>
      <span class="label">OPTIMIZE</span>
      <div class="seg" role="group" aria-label="Optimize for"><button data-csopt="performance" aria-pressed="true" title="Fewer spans: quicker to fit and to model with (Tab)">PERFORMANCE</button><button data-csopt="smoothness" aria-pressed="false" title="More spans, smoothed: a fairer surface (Tab)">SMOOTHNESS</button></div>
    </div>
    <div class="sec" data-panel="rebuild" hidden>
      <span class="hint" data-id="rb-hint">—</span>
      <div class="field"><label for="w3d-rb-n">CONTROL POINTS</label><input id="w3d-rb-n" data-id="rb-n" type="number" step="1" min="2" max="64" value="8"></div>
      <div class="field"><label for="w3d-rb-p">DEGREE</label><input id="w3d-rb-p" data-id="rb-p" type="number" step="1" min="1" max="7" value="3"></div>
    </div>
    <div class="sec" data-panel="match-face" hidden>
      <span class="hint" data-id="mf-hint">—</span>
      <div class="field"><label>FACES</label><output data-id="mf-count">0</output></div>
      <div class="field"><label>TARGET</label><output data-id="mf-target" title="Click the face whose surface the faces should take">—</output></div>
      <span class="label">GROW</span>
      <div class="seg" role="group" aria-label="Grow mode"><button data-mfgrow="moving" aria-pressed="true" title="An inner face matched past the outer wall takes the wall with it (Tab)">MOVING</button><button data-mfgrow="fixed" aria-pressed="false" title="Stop at the outer wall (Tab)">FIXED</button><button data-mfgrow="none" aria-pressed="false" title="Carry on past the outer wall by itself (Tab)">NONE</button></div>
    </div>
    <div class="sec" data-panel="image" hidden>
      <span class="hint" data-id="im-hint">—</span>
      <div class="field"><label for="w3d-im-w">WIDTH</label><input id="w3d-im-w" data-id="im-w" type="number" step="5" min="0.1" value="100" title="The picture's width in mm; its height follows"></div>
      <div class="field"><label for="w3d-im-o">OPACITY</label><input id="w3d-im-o" data-id="im-o" type="number" step="0.05" min="0" max="1" value="1" title="1 is solid, 0 is clear"></div>
      <span class="label">DEPTH</span>
      <div class="seg" role="group" aria-label="Image depth"><button data-imdepth="normal" aria-pressed="true" title="Hidden by what stands in front of it, and hides what stands behind it">NORMAL</button><button data-imdepth="front" aria-pressed="false" title="Always seen, over the model (see-through)">FRONT</button><button data-imdepth="behind" aria-pressed="false" title="Always behind the model, wherever it stands">BEHIND</button></div>
      <span class="label">CULLING</span>
      <div class="seg" role="group" aria-label="Image culling"><button data-imcull="front" aria-pressed="false" title="Seen from the front only">FRONT ONLY</button><button data-imcull="double" aria-pressed="true" title="Seen from both sides">DOUBLE SIDED</button></div>
      <div class="chips"><button data-id="im-delete" title="Remove the image (Delete)"><kbd>DEL</kbd>REMOVE</button></div>
    </div>
    <div class="sec" data-panel="instance" hidden>
      <span class="hint" data-id="in-hint">—</span>
      <div class="seg" role="group" aria-label="Handle"><button data-inmode="move" aria-pressed="true" title="Move the instance (G)">MOVE</button><button data-inmode="rotate" aria-pressed="false" title="Turn the instance (R)">ROTATE</button><button data-inmode="scale" aria-pressed="false" title="Scale the instance (S)">SCALE</button></div>
      <div class="chips"><button data-id="in-realize" title="Turn the instance into an ordinary body or curve you can edit">REALIZE</button><button data-id="in-dup" title="Another instance of the same master (Shift+D)"><kbd>⇧D</kbd>DUPLICATE</button><button data-id="in-delete" title="Remove the instance (Delete)"><kbd>DEL</kbd>REMOVE</button></div>
    </div>
    <div class="sec" data-panel="deform-curve" hidden>
      <span class="hint" data-id="dc-hint">—</span>
      <div class="field"><label>REFERENCE</label><output data-id="dc-ref" title="The face the curves lie on now">—</output></div>
      <div class="field"><label>TARGET</label><output data-id="dc-target" title="The face to wrap the curves onto">—</output></div>
      <span class="label">SCALE</span>
      <div class="field"><label for="w3d-dc-su">U</label><input id="w3d-dc-su" data-id="dc-su" type="number" step="0.1" value="1" title="Scale along U"></div>
      <div class="field"><label for="w3d-dc-sv">V</label><input id="w3d-dc-sv" data-id="dc-sv" type="number" step="0.1" value="1" title="Scale along V"></div>
      <div class="field"><label for="w3d-dc-sn">N</label><input id="w3d-dc-sn" data-id="dc-sn" type="number" step="0.1" value="1" title="Scale heights off the face"></div>
      <span class="label">OFFSET</span>
      <div class="field"><label for="w3d-dc-ou">U</label><input id="w3d-dc-ou" data-id="dc-ou" type="number" step="1" value="0" title="Move along U, in mm"></div>
      <div class="field"><label for="w3d-dc-ov">V</label><input id="w3d-dc-ov" data-id="dc-ov" type="number" step="1" value="0" title="Move along V, in mm"></div>
      <div class="field"><label for="w3d-dc-on">N</label><input id="w3d-dc-on" data-id="dc-on" type="number" step="0.5" value="0" title="Move off the face, in mm"></div>
      <span class="label">FLIP</span>
      <div class="chips"><button data-dcflip="mirror" aria-pressed="false" title="Mirror the curves on the face (M)"><kbd>M</kbd></button><button data-dcflip="swap" aria-pressed="false" title="Swap U and V (U)"><kbd>U</kbd></button><button data-dcflip="normal" aria-pressed="false" title="Turn heights over to the other side (N)"><kbd>N</kbd></button><button data-id="dc-keep" aria-pressed="false" title="Keep the original curves (K)"><kbd>K</kbd></button></div>
      <div class="chips" data-id="dc-reblend-row" hidden><button data-id="dc-reblend" aria-pressed="false" title="Take the fillets off before the warp and make them again after it at their radius, so they stay round (R)"><kbd>R</kbd>REBLEND</button></div>
    </div>
    <div class="sec" data-panel="untrim" hidden>
      <span class="hint" data-id="ut-hint">—</span>
      <div class="chips"><button data-id="ut-keep" aria-pressed="false" title="Imprint the face's edges on the sheet (Tab)"><kbd>TAB</kbd>KEEP EDGES</button></div>
    </div>
    <div class="sec" data-panel="section" hidden>
      <span class="hint" data-id="sa-hint">—</span>
      <span class="label">PLANE</span>
      <div class="seg" role="group" aria-label="Section plane"><button data-saplane="selection" aria-pressed="true" title="The selected face">SELECTION</button><button data-saplane="previous" aria-pressed="false" title="Where the last section was">PREVIOUS</button><button data-saplane="cplane" aria-pressed="false" title="The construction plane">CPLANE</button></div>
      <div class="field"><label for="w3d-sa-d">DISTANCE</label><input id="w3d-sa-d" data-id="sa-d" type="number" step="1" value="0" title="How far the slice moves into the model (D)"></div>
      <div class="chips"><button data-id="sa-flip" aria-pressed="false" title="Keep the other side (F)"><kbd>F</kbd>FLIP</button></div>
    </div>
    <div class="sec" data-panel="dimension" hidden>
      <span class="hint" data-id="dm-hint">—</span>
      <div data-id="dm-fields"></div>
    </div>
    <div class="sec" data-panel="text" hidden>
      <span class="hint" data-id="tx-hint">TYPE THE TEXT</span>
      <textarea data-id="tx-text" rows="3" spellcheck="false" title="The text; each line its own row">TEXT</textarea>
      <span class="label">FONT</span>
      <div class="seg" role="group" aria-label="Font">${FONTS.map(([name], i) => `<button data-txfont="${i}" aria-pressed="${i === 0}" title="${['A plain sans-serif (Outfit)', 'A serif (Lora)', 'A monospace (JetBrains Mono)'][i]}">${name}</button>`).join('')}</div>
      <div class="chips"><button data-id="tx-load" title="Load a TrueType font (.ttf) from your computer; it stays for next time">LOAD FONT</button><button data-id="tx-system" title="Pick one of the fonts installed on this computer; it stays for next time">SYSTEM FONT</button><button data-txfont="${FONTS.length}" data-id="tx-custom" aria-pressed="false" hidden title="Your font">MY FONT</button></div>
      <input type="file" data-id="tx-file" accept=".ttf,font/ttf,application/x-font-ttf" hidden>
      <select data-id="tx-list" hidden title="The fonts installed on this computer" aria-label="Installed fonts"></select>
      <span class="label">ALIGN</span>
      <div class="seg" role="group" aria-label="Align"><button data-txalign="left" aria-pressed="true" title="Lines start at the click">LEFT</button><button data-txalign="center" aria-pressed="false" title="Lines centred on the click">CENTER</button><button data-txalign="right" aria-pressed="false" title="Lines end at the click">RIGHT</button></div>
      <div class="field"><label for="w3d-tx-size">SIZE</label><input id="w3d-tx-size" data-id="tx-size" type="number" step="1" min="0.1" value="10" title="The height of the font's em, in mm"></div>
    </div>
    <div class="sec" data-panel="place" hidden>
      <span class="hint" data-id="pl-hint">—</span>
      <div class="field"><label for="w3d-pl-scale">SCALE</label><input id="w3d-pl-scale" data-id="pl-scale" type="number" step="0.1" min="0.001" value="1" title="How big the copy is against the original (S)"></div>
      <div class="field"><label for="w3d-pl-angle">ANGLE</label><input id="w3d-pl-angle" data-id="pl-angle" type="number" step="15" value="0" title="The copy's turn about the axis, in degrees (A)"></div>
      <div class="field"><label for="w3d-pl-d">OFFSET</label><input id="w3d-pl-d" data-id="pl-d" type="number" step="1" value="0" title="How far the copy stands off the destination along the axis (D)"></div>
      <span class="label">AXIS</span>
      <div class="seg" role="group" aria-label="Place axis"><button data-plaxis="normal" aria-pressed="true" title="The destination's normal">NORMAL</button><button data-plaxis="x" aria-pressed="false" title="Along X (X)"><kbd>X</kbd></button><button data-plaxis="y" aria-pressed="false" title="Along Y (Y)"><kbd>Y</kbd></button><button data-plaxis="z" aria-pressed="false" title="Along Z (Z)"><kbd>Z</kbd></button></div>
      <div class="chips"><button data-id="pl-flip" aria-pressed="false" title="Turn the copy over (F)"><kbd>F</kbd>FLIP</button><button data-id="pl-instance" aria-pressed="false" title="Place an instance of each solid, sharing its geometry, rather than a copy (I)"><kbd>I</kbd>INSTANCE</button></div>
      <span class="label">TARGET</span>
      <div class="seg" role="group" aria-label="Boolean with the body at the destination">
        <button data-plop="union" aria-pressed="false" title="Join the copy to the body it lands on (Q)"><kbd>Q</kbd>UNION</button>
        <button data-plop="difference" aria-pressed="false" title="Cut the copy from the body it lands on (W)"><kbd>W</kbd>DIFF</button>
        <button data-plop="intersect" aria-pressed="false" title="Keep where the copy and the body overlap (Shift+E)"><kbd>⇧E</kbd>INTER</button>
        <button data-plop="slice" aria-pressed="false" title="Cut the body in two along the copy (Shift+Q)"><kbd>⇧Q</kbd>SLICE</button>
        <button data-plop="new" aria-pressed="true" title="A separate new body (B)"><kbd>B</kbd>NEW</button>
      </div>
    </div>
    <div class="sec" data-panel="unwrap" hidden>
      <span class="hint" data-id="uw-hint">—</span>
    </div>
    <div class="sec" data-panel="rebuild-face" hidden>
      <span class="hint" data-id="rf-hint">—</span>
      <span class="label">METHOD</span>
      <div class="chips"><button data-rbmethod="tolerance" aria-pressed="true" title="As few control points as keep the face within the tolerance (M)"><kbd>M</kbd>TOLERANCE</button><button data-rbmethod="explicit" aria-pressed="false" title="Set the degree and spans yourself (M)">EXPLICIT</button></div>
      <div class="field" data-rf="tolerance"><label for="w3d-rf-tol">TOLERANCE</label><input id="w3d-rf-tol" data-id="rf-tol" type="number" step="0.001" min="0.000001" value="0.01"></div>
      <div class="field" data-rf="explicit" hidden><label for="w3d-rf-du">DEGREE U</label><input id="w3d-rf-du" data-id="rf-du" type="number" step="1" min="1" max="9" value="3"></div>
      <div class="field" data-rf="explicit" hidden><label for="w3d-rf-dv">DEGREE V</label><input id="w3d-rf-dv" data-id="rf-dv" type="number" step="1" min="1" max="9" value="3"></div>
      <div class="field" data-rf="explicit" hidden><label for="w3d-rf-su">SPANS U</label><input id="w3d-rf-su" data-id="rf-su" type="number" step="1" min="1" max="64" value="4"></div>
      <div class="field" data-rf="explicit" hidden><label for="w3d-rf-sv">SPANS V</label><input id="w3d-rf-sv" data-id="rf-sv" type="number" step="1" min="1" max="64" value="4"></div>
      <div class="field"><label for="w3d-rf-eu">EXTEND U</label><input id="w3d-rf-eu" data-id="rf-eu" type="number" step="0.5" min="0" value="0"></div>
      <div class="field"><label for="w3d-rf-ev">EXTEND V</label><input id="w3d-rf-ev" data-id="rf-ev" type="number" step="0.5" min="0" value="0"></div>
      <div class="chips"><button data-id="rf-shrink" aria-pressed="true" title="Fit the face's own extent, not its whole underlying surface (H)"><kbd>H</kbd>SHRINK</button></div>
      <div class="field"><label>CONTROL POINTS</label><output data-id="rf-cvs">—</output></div>
    </div>
    <div class="sec" data-panel="fillet-vertex" hidden>
      <span class="hint" data-id="fv-hint">—</span>
      <div class="field"><label for="w3d-fv-r">RADIUS</label><input id="w3d-fv-r" data-id="fv-r" type="number" step="0.5" value="0"></div>
      <div class="field"><label>SHAPE</label><output data-id="fv-shape">ROUND</output></div>
    </div>
    <div class="sec" data-panel="fillet-curve" hidden>
      <span class="hint" data-id="fc-hint">—</span>
      <div class="field"><label for="w3d-fc-r">RADIUS</label><input id="w3d-fc-r" data-id="fc-r" type="number" step="0.5" min="0.01" value="2"></div>
    </div>
    <div class="sec" data-panel="remove-face" hidden>
      <span class="hint" data-id="rf-hint">—</span>
      <div class="field"><label>FACES</label><output data-id="rf-count">0</output></div>
    </div>
    <div class="sec" data-panel="cut" hidden>
      <span class="hint" data-id="cut-hint">—</span>
      <div class="field"><label>SOLIDS</label><output data-id="cut-solids">0</output></div>
      <div class="field"><label>CURVES</label><output data-id="cut-curves">0</output></div>
      <div class="field"><label>FACES</label><output data-id="cut-faces">0</output></div>
      <div class="chips"><button data-id="cut-plane" aria-pressed="false"><kbd>P</kbd>PLANE</button></div>
      <div class="field"><label>PIECES</label><output data-id="cut-pieces">—</output></div>
    </div>
    <div class="sec" data-panel="draft" hidden>
      <span class="hint" data-id="draft-hint">—</span>
      <div class="field"><label for="w3d-draft-a">ANGLE °</label><input id="w3d-draft-a" data-id="draft-a" type="number" step="0.5" value="3"></div>
      <div class="field"><label>FACES</label><output data-id="draft-count">0</output></div>
      <div class="field" title="Moves the neutral plane along the pull direction (D)"><label for="w3d-draft-d">OFFSET</label><input id="w3d-draft-d" data-id="draft-d" type="number" step="0.5" value="0"></div>
      <div class="field"><label>NEUTRAL</label><output data-id="draft-pull">—</output></div>
      <div class="seg" role="group" aria-label="Taper method"><button data-drtaper="offset" aria-pressed="true" title="Offset: the faces tilt about the neutral plane, moved along the pull by Offset">OFFSET</button><button data-drtaper="curve" aria-pressed="false" title="Curve: click a straight curve or edge; the faces tilt about it">CURVE</button></div>
      <span class="label">GROW</span>
      <div class="seg" role="group" aria-label="Grow mode"><button data-drgrow="moving" aria-pressed="true" title="Moving: an inner face drafted out past the outer wall takes the wall with it (Tab)">MOVING</button><button data-drgrow="fixed" aria-pressed="false" title="Fixed: the drafted face stops at the outer wall (Tab)">FIXED</button><button data-drgrow="none" aria-pressed="false" title="None: the drafted face carries on by itself, past the outer wall (Tab)">NONE</button></div>
    </div>
    <div class="sec" data-panel="imprint" hidden>
      <span class="hint" data-id="imp-hint">—</span>
      <div class="field"><label>FACES</label><output data-id="imp-faces">ALL</output></div>
      <div class="field"><label>CURVES</label><output data-id="imp-curves">0</output></div>
      <div class="field"><label>BODIES</label><output data-id="imp-bodies">0</output></div>
      <div class="chips" data-id="imp-opts">
        <button data-imp="normal" aria-pressed="true" title="Normal: each curve along its own plane's normal">NORMAL</button>
        <button data-imp="vector" aria-pressed="false" title="Vector: every curve along one direction (X, Y, Z; again to flip)">VECTOR</button>
        <button data-imp="both" aria-pressed="true" title="Bidirectional: both ways from the curves">BIDIRECTIONAL</button>
        <button data-imp="hide" aria-pressed="false" title="Hide occlusion: not onto faces hidden behind others">HIDE OCCLUSION</button>
        <button data-imp="screen" aria-pressed="false" title="Screen space: along the view (S)"><kbd>S</kbd>SCREEN SPACE</button>
      </div>
      <div class="chips" data-id="imp-complete">
        <button data-impcomp="none" aria-pressed="true" title="Completion None: edges stay where the curves end (C)">NONE</button>
        <button data-impcomp="edge" aria-pressed="false" title="Completion Edge: carried on until they meet the face's edges (C)">EDGE</button>
      </div>
      <div class="field"><label>DIRECTION</label><output data-id="imp-dir">—</output></div>
    </div>
    <div class="sec" data-panel="project" hidden>
      <span class="hint" data-id="proj-hint">—</span>
      <div class="field"><label>MAKES</label><output data-id="proj-mode">—</output></div>
      <div class="chips" data-id="proj-opts">
        <button data-proj="normal" title="Normal: along the construction plane's normal" aria-pressed="true">NORMAL</button>
        <button data-proj="vector" title="Vector: along one direction (X, Y, Z; again to flip)" aria-pressed="false">VECTOR</button>
        <button data-proj="both" title="Bidirectional: both ways (Vector)" aria-pressed="false">BIDIRECTIONAL</button>
        <button data-proj="hide" title="Hide occluded: not onto faces hidden behind others (Vector)" aria-pressed="false">HIDE OCCLUDED</button>
        <button data-proj="screen" title="Screen space: along the view (S)" aria-pressed="false"><kbd>S</kbd>SCREEN SPACE</button>
      </div>
      <div class="field"><label>DIRECTION</label><output data-id="proj-dir">—</output></div>
      <div class="field"><label>CURVES</label><output data-id="proj-count">0</output></div>
    </div>
    <div class="sec" data-panel="patch" hidden>
      <span class="hint" data-id="patch-hint">—</span>
      <div class="chips"><button data-id="patch-tangent" aria-pressed="false"><kbd>T</kbd>TANGENT TO FACES</button><button data-id="patch-individual" aria-pressed="false" title="A sheet in each closed loop of the selection, rather than one loop only (I)"><kbd>I</kbd>INDIVIDUAL</button><button data-id="patch-quad" aria-pressed="false" title="Fill the loop as a four-sided B-spline sheet, split at its four corners"><kbd>Q</kbd>QUAD-SIDED</button></div>
      <span class="label">CONTINUITY</span>
      <div class="seg" role="group" aria-label="Continuity (T cycles)"><button data-pcont="planar" aria-pressed="false" title="Fill flat; a loop that is not flat is refused">PLANAR</button><button data-pcont="G0" aria-pressed="true" title="Meet the loop only">G0</button><button data-pcont="G1" aria-pressed="false" title="Leave the faces along the picked edges tangent">G1</button><button data-pcont="G2" aria-pressed="false" title="Match the faces' curvature along the picked edges">G2</button></div>
      <span class="label">METHOD</span>
      <div class="seg" role="group" aria-label="Method"><button data-pmethod="fill" aria-pressed="true" title="Fill the loop with a new sheet">FILL</button><button data-pmethod="hole" aria-pressed="false" title="Trim to hole: trim the selected target sheet to the hole the base sheet's edges make">HOLE</button><button data-pmethod="sheet" aria-pressed="false" title="Trim to sheet: trim the selected target sheet where the base sheet ends">SHEET</button></div>
      <div class="field"><label>CURVES</label><output data-id="patch-curves">0</output></div>
      <div class="field"><label>EDGES</label><output data-id="patch-edges">0</output></div>
      <div class="field" title="The sheet the Trim methods cut: select it in body mode with the base sheet's edges"><label>TARGET</label><output data-id="patch-target">—</output></div>
      <div class="field" title="How far the sheet may stray from its loop, and how far apart the loop's pieces may be and still join (mm)"><label for="w3d-patch-tol">TOLERANCE</label><input id="w3d-patch-tol" data-id="patch-tol" type="number" step="0.001" min="0.0001" value="0.001"></div>
    </div>
    <div class="sec" data-panel="bridge-surface" hidden>
      <span class="hint" data-id="bs-hint">—</span>
      <div class="field" data-id="bs-t-row"><label for="w3d-bs-t">TENSION</label><input id="w3d-bs-t" data-id="bs-t" type="number" step="0.1" min="0.05" value="1"></div>
      <div data-id="bs-sheets" hidden>
        <div class="field"><label for="w3d-bs-w">WIDTH</label><input id="w3d-bs-w" data-id="bs-w" type="number" step="0.5" min="0.01" value="2" title="How far the bridge reaches across each sheet"></div>
        <span class="label">SHAPE</span>
        <div class="seg" role="group" aria-label="Bridge shape"><button data-bsshape="g2" aria-pressed="true" title="G2: the bridge leaves both sheets with their curvature">G2</button><button data-bsshape="chamfer" aria-pressed="false" title="Chamfer: a flat bridge across the corner">CHAMFER</button></div>
        <span class="label">TRIM WALLS</span>
        <div class="chips" role="group" aria-label="Trim walls"><button data-bstrim="both" aria-pressed="true" title="Both: both sheets trimmed back to the bridge and joined to it">BOTH</button><button data-bstrim="short" aria-pressed="false" title="Short: only the shorter side trimmed and joined to the bridge">SHORT</button><button data-bstrim="long" aria-pressed="false" title="Long: only the longer side trimmed and joined to the bridge">LONG</button><button data-bstrim="none" aria-pressed="false" title="None: the sheets stay as they are and the bridge is a sheet of its own">NONE</button></div>
        <div class="chips"><button data-id="bs-add" aria-pressed="false" title="Add wall pair: click two more crossing sheets to bridge alike (A)"><kbd>A</kbd>ADD WALL PAIR</button></div>
        <div class="chips"><button data-id="bs-s1" aria-pressed="false" title="Sense 1: bridge to the other side of the first sheet">SENSE 1</button><button data-id="bs-s2" aria-pressed="false" title="Sense 2: bridge to the other side of the second sheet">SENSE 2</button></div>
      </div>
    </div>
    <div class="sec" data-panel="extend-sheet" hidden>
      <span class="hint" data-id="es-hint">—</span>
      <div class="field"><label for="w3d-es-d">DISTANCE</label><input id="w3d-es-d" data-id="es-d" type="number" step="0.5" min="0.01" value="5"></div>
      <span class="label">SHAPE</span>
      <div class="chips"><button data-esshape="natural" aria-pressed="true" title="Carry on with the surface's curvature (Tab)"><kbd>TAB</kbd>NATURAL</button><button data-esshape="linear" aria-pressed="false" title="Carry straight on from the edge (Tab)">LINEAR</button><button data-esshape="soft" aria-pressed="false" title="Leave tangent and with the same curvature, easing out flat (Tab)">SOFT</button><button data-esshape="reflective" aria-pressed="false" title="Mirror the sheet's shape through the edge (Tab)">REFLECTIVE</button></div>
      <span class="label">LIMIT</span>
      <div class="field"><span class="hint" data-id="es-limit" title="Ctrl-click a body: the sheet carries on until it meets it">—</span><button data-id="es-unlimit" hidden title="Extend by the distance instead">CLEAR</button></div>
      <div class="seg" data-id="es-limit-how" role="group" aria-label="Limit" hidden><button data-eslimit="minimal" aria-pressed="true" title="Stop where the sheet first meets the body">MINIMAL</button><button data-eslimit="outside" aria-pressed="false" title="Carry on through the body to its far side">OUTSIDE</button></div>
    </div>
    <div class="sec" data-panel="thicken" hidden>
      <span class="hint" data-id="th-hint">—</span>
      <div class="field"><label for="w3d-th-f">FRONT</label><input id="w3d-th-f" data-id="th-f" type="number" step="0.5" min="0" value="1"></div>
      <div class="field"><label for="w3d-th-b">BACK</label><input id="w3d-th-b" data-id="th-b" type="number" step="0.5" min="0" value="0"></div>
    </div>
    <div class="sec" data-panel="pipe" hidden>
      <span class="hint" data-id="pipe-hint">—</span>
      <div class="field"><label for="w3d-pipe-r">RADIUS</label><input id="w3d-pipe-r" data-id="pipe-r" type="number" step="0.5" min="0.01" value="1"></div>
      <div class="field"><label for="w3d-pipe-t">THICKNESS</label><input id="w3d-pipe-t" data-id="pipe-t" type="number" step="0.1" min="0" value="0"></div>
      <div class="field"><label for="w3d-pipe-v">SIDES</label><input id="w3d-pipe-v" data-id="pipe-v" type="number" step="1" min="0" max="256" value="0" title="0 for a round pipe, or 3 to 256 for a polygon"></div>
    </div>
    <div class="sec" data-panel="hole" hidden>
      <span class="hint" data-id="hole-hint">CLICK A FLAT FACE</span>
      <div class="field"><label for="w3d-hole-d">DIAMETER</label><input id="w3d-hole-d" data-id="hole-d" type="number" step="0.5" min="0.01" value="6"></div>
      <div class="field" data-id="hole-depth-row"><label for="w3d-hole-depth">DEPTH</label><input id="w3d-hole-depth" data-id="hole-depth" type="number" step="1" min="0.01" value="10"></div>
      <div class="chips"><button data-id="hole-through" aria-pressed="false"><kbd>T</kbd>THROUGH ALL</button></div>
    </div>
    <div class="sec" data-panel="extend" hidden>
      <span class="hint" data-id="ext-hint">CLICK NEAR THE END OF AN OPEN CURVE</span>
      <div class="field"><label for="w3d-ext-len">LENGTH</label><input id="w3d-ext-len" data-id="ext-len" type="number" step="1" min="0.01" value="10"></div>
      <span class="label">SHAPE</span>
      <div class="seg" role="group" aria-label="Extend shape">
        <button data-extshape="natural" aria-pressed="true" title="Carry on as the curve does: an arc round its circle, a curve with its end curvature"><kbd>S</kbd>NATURAL</button>
        <button data-extshape="linear" aria-pressed="false" title="Carry on straight along the end">LINEAR</button>
      </div>
    </div>
    <div class="sec" data-panel="bridge" hidden>
      <span class="hint" data-id="br-hint">—</span>
      <div class="field" title="Where the bridge leaves the first curve: 0 its start, 1 its end"><label for="w3d-br-p1">PARAMETER 1</label><input id="w3d-br-p1" data-id="br-p1" type="number" step="0.05" min="0" max="1" value="1"></div>
      <div class="field" title="Where the bridge meets the second curve: 0 its start, 1 its end"><label for="w3d-br-p2">PARAMETER 2</label><input id="w3d-br-p2" data-id="br-p2" type="number" step="0.05" min="0" max="1" value="0"></div>
      <div class="field two" title="How far the bridge holds each end's direction (D sets both)"><label for="w3d-br-t1a">G1 TENSION</label><input id="w3d-br-t1a" data-id="br-t1a" type="number" step="0.1" min="0.05" value="1" aria-label="G1 TENSION at the start"><input data-id="br-t1b" type="number" step="0.1" min="0.05" value="1" aria-label="G1 TENSION at the end"></div>
      <div class="field two" title="Moves the second and third control points along each end; the curvature is kept"><label for="w3d-br-t2a">G2 TENSION</label><input id="w3d-br-t2a" data-id="br-t2a" type="number" step="0.1" min="0.05" value="1" aria-label="G2 TENSION at the start"><input data-id="br-t2b" type="number" step="0.1" min="0.05" value="1" aria-label="G2 TENSION at the end"></div>
      <div class="field two" title="Moves only the third control point; G3 is kept"><label for="w3d-br-t3a">G3 TENSION</label><input id="w3d-br-t3a" data-id="br-t3a" type="number" step="0.1" min="0.05" value="1" aria-label="G3 TENSION at the start"><input data-id="br-t3b" type="number" step="0.1" min="0.05" value="1" aria-label="G3 TENSION at the end"></div>
      <span class="label">CONTINUITY</span>
      <div class="chips"><button data-id="br-start" title="Continuity at the start (click to cycle)">START G1</button><button data-id="br-end" title="Continuity at the end (click to cycle)">END G1</button></div>
      <span class="label">AXIS</span>
      <div class="seg" role="group" aria-label="Constrain the bridge to an axis"><button data-braxis="" aria-pressed="true" title="The bridge leaves along the curves themselves">NONE</button><button data-braxis="x" aria-pressed="false" title="The bridge leaves both ends along X"><kbd>X</kbd>X</button><button data-braxis="y" aria-pressed="false" title="The bridge leaves both ends along Y"><kbd>Y</kbd>Y</button><button data-braxis="z" aria-pressed="false" title="The bridge leaves both ends along Z"><kbd>Z</kbd>Z</button></div>
      <div class="chips"><button data-id="br-trim" aria-pressed="false" title="Trim the curves where they run on past the bridge"><kbd>Q</kbd>TRIM</button><button data-id="br-comb" aria-pressed="false" title="Show the curvature of the bridge and the curves it joins">CURVATURE</button><button data-id="br-constrain" aria-pressed="false" title="Create constraints: the bridge stays joined to the curves it bridges, remade with the same continuity when they are edited (for this session)">CONSTRAIN</button></div>
    </div>
    <div class="sec" data-panel="bridge-edge" hidden>
      <span class="hint" data-id="be-hint">—</span>
      <div class="field"><label for="w3d-be-p1">PARAMETER 1</label><input id="w3d-be-p1" data-id="be-p1" type="number" step="0.05" min="0" max="1" value="1"></div>
      <div class="field"><label for="w3d-be-p2">PARAMETER 2</label><input id="w3d-be-p2" data-id="be-p2" type="number" step="0.05" min="0" max="1" value="0"></div>
      <div class="field two" title="How far the bridge holds each end's direction (D sets both)"><label for="w3d-be-t1a">G1 TENSION</label><input id="w3d-be-t1a" data-id="be-t1a" type="number" step="0.1" min="0.05" value="1" aria-label="G1 TENSION at the start"><input data-id="be-t1b" type="number" step="0.1" min="0.05" value="1" aria-label="G1 TENSION at the end"></div>
      <div class="field two" title="Moves the second and third control points along each end; the curvature is kept"><label for="w3d-be-t2a">G2 TENSION</label><input id="w3d-be-t2a" data-id="be-t2a" type="number" step="0.1" min="0.05" value="1" aria-label="G2 TENSION at the start"><input data-id="be-t2b" type="number" step="0.1" min="0.05" value="1" aria-label="G2 TENSION at the end"></div>
      <div class="field two" title="Moves only the third control point; G3 is kept"><label for="w3d-be-t3a">G3 TENSION</label><input id="w3d-be-t3a" data-id="be-t3a" type="number" step="0.1" min="0.05" value="1" aria-label="G3 TENSION at the start"><input data-id="be-t3b" type="number" step="0.1" min="0.05" value="1" aria-label="G3 TENSION at the end"></div>
      <span class="label">CONTINUITY</span>
      <div class="chips"><button data-id="be-start" title="Continuity with the first edge (click to cycle)">START G1</button><button data-id="be-end" title="Continuity with the second edge (click to cycle)">END G1</button></div>
      <span class="label">AXIS</span>
      <div class="seg" role="group" aria-label="Constrain the bridge to an axis"><button data-beaxis="" aria-pressed="true" title="The bridge leaves along the edges themselves">NONE</button><button data-beaxis="x" aria-pressed="false" title="The bridge leaves both ends along X"><kbd>X</kbd>X</button><button data-beaxis="y" aria-pressed="false" title="The bridge leaves both ends along Y"><kbd>Y</kbd>Y</button><button data-beaxis="z" aria-pressed="false" title="The bridge leaves both ends along Z"><kbd>Z</kbd>Z</button></div>
    </div>
    <div class="sec" data-panel="align-surface" hidden>
      <span class="hint" data-id="as-hint">—</span>
      <span class="label">CONTINUITY</span>
      <div class="seg" role="group" aria-label="Continuity with the reference"><button data-ascont="G0" aria-pressed="false" title="Meet the reference edge (G0)">G0</button><button data-ascont="G1" aria-pressed="true" title="Meet it and its tangent plane (G1)">G1</button><button data-ascont="G2" aria-pressed="false" title="Meet it, its tangent plane and its curvature (G2)">G2</button></div>
      <div class="field" title="How fast the sheet leaves its side, against how fast it does now (D)"><label for="w3d-as-t">TENSION</label><input id="w3d-as-t" data-id="as-t" type="number" step="0.1" min="0.05" value="1"></div>
      <div class="field" title="How many more rows of control points follow the aligned ones, less and less (0: none)"><label for="w3d-as-blend">BLEND EXTRA ROWS</label><input id="w3d-as-blend" data-id="as-blend" type="number" step="1" min="0" value="0"></div>
      <div class="field" title="How much the sheet's own shape holds the blended rows back (0 to 1)"><label for="w3d-as-infl">INPUT SHAPE INFLUENCE</label><input id="w3d-as-infl" data-id="as-infl" type="number" step="0.1" min="0" max="1" value="0"></div>
      <div class="field two" title="Rebuild the sheet to this degree and number of spans each way before aligning (0: keep it as it is)"><label for="w3d-as-deg">DEGREE · SPANS</label><input id="w3d-as-deg" data-id="as-deg" type="number" step="1" min="0" max="7" value="0" aria-label="Degree"><input data-id="as-spans" type="number" step="1" min="0" value="0" aria-label="Spans"></div>
      <div class="field two" title="Align in full only between these fractions along the side, easing out to the side's ends"><label for="w3d-as-p0">PARTIAL START · END</label><input id="w3d-as-p0" data-id="as-p0" type="number" step="0.05" min="0" max="1" value="0" aria-label="Partial start"><input data-id="as-p1" type="number" step="0.05" min="0" max="1" value="1" aria-label="Partial end"></div>
      <span class="label">BOUNDARY</span>
      <div class="seg" role="group" aria-label="How the sheet leaves the aligned side at its ends"><button data-asbound="natural" aria-pressed="true" title="Natural: the sheet leaves the side's ends as the fit has it">NATURAL</button><button data-asbound="normal" aria-pressed="false" title="Normal: the sheet leaves the side's ends square to the side">NORMAL</button><button data-asbound="next" aria-pressed="false" title="Next: square where the neighbouring side is nearly flat">NEXT</button><button data-asbound="adjacent" aria-pressed="false" title="Adjacent: along the sheet's own neighbouring sides, as they ran before">ADJ.</button></div>
      <div class="chips"><button data-id="as-symmetric" aria-pressed="false" title="Symmetric: both sheets move, meeting halfway between their edges (G0 or G1)">SYMMETRIC</button><button data-id="as-analysis" aria-pressed="false" title="Analysis: check how the sheets meet along the edge (G0 gap, G1 angle, G2 curvature) against the tolerances">ANALYSIS</button></div>
      <div data-id="as-analysis-row" hidden>
        <div class="field two" title="Analysis tolerances: the largest gap (mm) and angle between the faces (°) that still pass"><label for="w3d-as-tg0">G0 MM · G1 °</label><input id="w3d-as-tg0" data-id="as-tg0" type="number" step="0.01" min="0" value="0.01" aria-label="G0 tolerance"><input data-id="as-tg1" type="number" step="0.1" min="0" value="0.5" aria-label="G1 tolerance"></div>
        <div class="field" title="Analysis tolerance: the largest difference in curvature across the edge that still passes, in percent"><label for="w3d-as-tg2">G2 %</label><input id="w3d-as-tg2" data-id="as-tg2" type="number" step="1" min="0" value="5"></div>
        <div class="field"><label>G0</label><output data-id="as-r0">—</output></div>
        <div class="field"><label>G1</label><output data-id="as-r1">—</output></div>
        <div class="field"><label>G2</label><output data-id="as-r2">—</output></div>
      </div>
    </div>
    <div class="sec" data-panel="project-align" hidden>
      <span class="hint" data-id="pa-hint">—</span>
      <span class="label">CONTINUITY</span>
      <div class="seg" role="group" aria-label="Continuity with the reference surface"><button data-pacont="G0" aria-pressed="false" title="Meet the reference surface (G0)">G0</button><button data-pacont="G1" aria-pressed="true" title="Meet it and its tangent plane (G1)">G1</button><button data-pacont="G2" aria-pressed="false" title="Meet it, its tangent plane and its curvature (G2)">G2</button><button data-pacont="PERP" aria-pressed="false" title="Meet it and leave it square (Perpendicular)">PERP</button></div>
      <span class="label">PROJECTION</span>
      <div class="seg" role="group" aria-label="Projection direction"><button data-padir="normal" aria-pressed="true" title="Along the reference surface's normal: the nearest points (N)">NORMAL</button><button data-padir="x" aria-pressed="false" title="Along X (X)">X</button><button data-padir="y" aria-pressed="false" title="Along Y (Y)">Y</button><button data-padir="z" aria-pressed="false" title="Along Z (Z)">Z</button><button data-padir="screen" aria-pressed="false" title="Along the view (S)">SCREEN</button></div>
      <div class="field" title="How fast the sheet leaves its side, against how fast it does now (D)"><label for="w3d-pa-t">TENSION</label><input id="w3d-pa-t" data-id="pa-t" type="number" step="0.1" min="0.05" value="1"></div>
      <div class="field" title="How many more rows of control points follow the aligned ones, less and less (0: none)"><label for="w3d-pa-blend">BLEND EXTRA ROWS</label><input id="w3d-pa-blend" data-id="pa-blend" type="number" step="1" min="0" value="0"></div>
    </div>
    <div class="sec" data-panel="insert-knot" hidden>
      <span class="hint" data-id="ik-hint">CLICK A CURVE TO ADD A CONTROL POINT THERE; ITS SHAPE STAYS THE SAME</span>
    </div>
    <div class="sec" data-panel="trim" hidden>
      <span class="hint" data-id="trim-hint">CLICK THE PIECE OF A CURVE TO CUT AWAY; IT ENDS WHERE OTHER CURVES CROSS IT</span>
    </div>
    <div class="sec" data-panel="cut-curve" hidden>
      <span class="hint" data-id="cc-hint">—</span>
      <div class="field"><label>TARGETS</label><output data-id="cc-targets">0</output></div>
      <div class="field"><label>CUTTERS</label><output data-id="cc-cutters">0</output></div>
      <div class="field"><label>FACES</label><output data-id="cc-faces">0</output></div>
      <div class="chips"><button data-id="cc-extend" aria-pressed="false" title="Carry short cutters on past their ends (Tab)"><kbd>TAB</kbd>EXTEND</button><button data-id="cc-screen" aria-pressed="false" title="Cutters in other planes sweep along the view instead of their own normal (S)"><kbd>S</kbd>SCREEN SPACE</button></div>
    </div>
    <div class="sec" data-panel="primitive" hidden>
      <span class="hint" data-id="prim-hint">CLICK THE FIRST CORNER</span>
      <div class="field" data-id="prim-w-row"><label for="w3d-prim-w">WIDTH</label><input id="w3d-prim-w" data-id="prim-w" type="number" step="1" value="20"></div>
      <div class="field" data-id="prim-d-row"><label for="w3d-prim-d">LENGTH</label><input id="w3d-prim-d" data-id="prim-d" type="number" step="1" value="20"></div>
      <div class="field" data-id="prim-r-row"><label for="w3d-prim-r">DIAMETER</label><input id="w3d-prim-r" data-id="prim-r" type="number" step="1" min="0.01" value="20"></div>
      <div class="field" data-id="prim-h-row"><label for="w3d-prim-h">HEIGHT</label><input id="w3d-prim-h" data-id="prim-h" type="number" step="1" value="20"></div>
      <div class="chips" data-id="prim-opts"><button data-popt="centre" aria-pressed="false"><kbd>C</kbd>CENTRE</button><button data-popt="square" aria-pressed="false"><kbd>S</kbd>SQUARE</button><button data-popt="vertical" aria-pressed="false"><kbd>V</kbd>VERTICAL</button></div>
      <span class="label">TARGET</span>
      <div class="seg" role="group" aria-label="Boolean with the body underneath">
        <button data-pop="union" aria-pressed="false"><kbd>Q</kbd>UNION</button>
        <button data-pop="difference" aria-pressed="false"><kbd>W</kbd>DIFF</button>
        <button data-pop="intersect" aria-pressed="false"><kbd>⇧E</kbd>INTER</button>
        <button data-pop="slice" aria-pressed="false"><kbd>⇧Q</kbd>SLICE</button>
        <button data-pop="new" aria-pressed="true"><kbd>B</kbd>NEW</button>
      </div>
      <div class="chips"><button data-id="prim-keep" aria-pressed="false" title="Keep the primitive as a body of its own after combining (T)"><kbd>T</kbd>KEEP TOOL</button></div>
    </div>
    <div class="sec" data-panel="material" hidden>
      <span class="hint" data-id="mat-hint">—</span>
      <span class="label">LIBRARY</span>
      <div class="swatches" role="group" aria-label="Material library" data-id="mat-library">${MATERIAL_LIBRARY.map((m, i) => `<button data-matlib="${i}" aria-label="${m.name}" title="${m.name} · ${m.density} G/CM³" style="background: ${m.color}"></button>`).join('')}</div>
      <div class="field"><label for="w3d-mat-color">COLOR</label><input id="w3d-mat-color" data-mat="color" type="color" value="#9a968c"></div>
      <div class="field"><label for="w3d-mat-rough">ROUGHNESS</label><input id="w3d-mat-rough" data-mat="roughness" type="number" step="0.05" min="0" max="1" value="0.5"></div>
      <div class="field"><label for="w3d-mat-metal">METALNESS</label><input id="w3d-mat-metal" data-mat="metalness" type="number" step="0.05" min="0" max="1" value="0"></div>
      <div class="field"><label for="w3d-mat-ior">IOR</label><input id="w3d-mat-ior" data-mat="ior" type="number" step="0.01" min="1" max="2.333" value="1.5"></div>
      <div class="field"><label for="w3d-mat-opacity">OPACITY</label><input id="w3d-mat-opacity" data-mat="opacity" type="number" step="0.05" min="0" max="1" value="1"></div>
      <div class="field"><label for="w3d-mat-density">DENSITY G/CM³</label><input id="w3d-mat-density" data-mat="density" type="number" step="0.01" min="0.001" value="1"></div>
      <div class="field"><label>MASS</label><output data-id="mat-mass">—</output></div>
      <details class="advanced" data-id="mat-advanced">
        <summary title="Clearcoat, sheen, iridescence and transmission, seen in Render mode">ADVANCED</summary>
        ${ADVANCED_MATERIAL.map(([k, label, lo, hi, step]) => lo === null
          ? `<div class="field"><label for="w3d-mat-${k}">${label}</label><input id="w3d-mat-${k}" data-mat="${k}" type="color" value="#ffffff"></div>`
          : `<div class="field"><label for="w3d-mat-${k}">${label}</label><input id="w3d-mat-${k}" data-mat="${k}" type="number" step="${step}" min="${lo}" max="${hi}" value="0"></div>`).join('')}
      </details>
      <div class="seg" role="group" aria-label="Material"><button data-id="mat-fork" title="Fork material: these bodies get their own copy">${icon('fork-material')}FORK</button><button data-id="mat-remove" title="Remove material">${icon('remove-material')}REMOVE</button></div>
    </div>
    <div class="sec" data-panel="shell" hidden>
      <span class="hint" data-id="shell-hint">FACES TO OPEN</span>
      <div class="field"><label for="w3d-shell-t">THICKNESS</label><input id="w3d-shell-t" data-id="shell-t" type="number" step="0.5" min="0.01" value="2"></div>
      <div class="field"><label>OPEN FACES</label><output data-id="shell-count">0</output></div>
    </div>
    <div class="sec" data-panel="mirror" hidden>
      <span class="hint" data-id="mirror-hint">—</span>
      <span class="label">PLANE SQUARE TO</span>
      <div class="seg" role="group" aria-label="Mirror axis"><button data-mx="x" aria-pressed="true" title="Positive X (X; Shift+X negative)"><kbd>X</kbd>X</button><button data-mx="y" aria-pressed="false" title="Positive Y (Y; Shift+Y negative)"><kbd>Y</kbd>Y</button><button data-mx="z" aria-pressed="false" title="Positive Z (Z; Shift+Z negative)"><kbd>Z</kbd>Z</button></div>
      <div class="field"><label for="w3d-mirror-at">AT</label><input id="w3d-mirror-at" data-id="mirror-at" type="number" step="1" value="0"></div>
      <div class="chips"><button data-id="mirror-neg" aria-pressed="false" aria-label="Negative direction" title="Negative direction (Shift+X/Y/Z): the copy goes to the axis's negative side"></button><button data-id="mirror-free" aria-pressed="false" aria-label="Freestyle" title="Freestyle (F): click two points on the construction plane; the mirror plane runs through them, square to the construction plane"><kbd>F</kbd></button><button data-id="mirror-cut" aria-pressed="false" aria-label="Cut down mirror plane" title="Cut down mirror plane: each solid is cut by the plane first, keeping the side the copy faces away from"></button></div>
      <div class="chips"><button data-id="mirror-join" aria-pressed="false" title="Union halves (Q): fuse each reflection into its original"><kbd>Q</kbd>UNION</button><button data-id="mirror-instance" aria-pressed="false" title="Make mirrored instances of the solids, sharing their geometry, rather than copies (I)"><kbd>I</kbd>INSTANCE</button></div>
    </div>
    <div class="sec" data-panel="rect-array" hidden>
      <span class="hint" data-id="ra-hint">—</span>
      <div class="field"><label>COUNT X · Y · Z</label><span class="trio"><input data-id="ra-cx" type="number" step="1" min="1" value="3" aria-label="Count along x"><input data-id="ra-cy" type="number" step="1" min="1" value="1" aria-label="Count along y"><input data-id="ra-cz" type="number" step="1" min="1" value="1" aria-label="Count along z"></span></div>
      <span class="label">MODE</span>
      <div class="seg" role="group" aria-label="Rectangular array mode"><button data-id="ra-spacing" aria-pressed="true" title="Spacing (Tab): the distance between neighbouring copies">SPACING</button><button data-id="ra-extent" aria-pressed="false" title="Extent (Tab): the distance from the first copy to the last, the copies spread evenly over it">EXTENT</button></div>
      <div class="field"><label data-id="ra-slabel">SPACING X · Y · Z</label><span class="trio"><input data-id="ra-sx" type="number" step="1" value="30" aria-label="Spacing along x"><input data-id="ra-sy" type="number" step="1" value="30" aria-label="Spacing along y"><input data-id="ra-sz" type="number" step="1" value="30" aria-label="Spacing along z"></span></div>
      <div class="chips"><button data-id="ra-join" aria-pressed="false"><kbd>J</kbd>JOIN</button><button data-id="ra-instance" aria-pressed="false" title="Make instances of the solids, sharing their geometry, rather than copies (I)"><kbd>I</kbd>INSTANCE</button></div>
    </div>
    <div class="sec" data-panel="radial-array" hidden>
      <span class="hint" data-id="rr-hint">—</span>
      <div class="field"><label for="w3d-rr-count">COUNT</label><input id="w3d-rr-count" data-id="rr-count" type="number" step="1" min="1" value="6"></div>
      <span class="label">MODE</span>
      <div class="seg" role="group" aria-label="Radial array mode"><button data-id="rr-total" aria-pressed="true" title="Total (Tab): the copies spread evenly over the angle">TOTAL</button><button data-id="rr-spacing" aria-pressed="false" title="Spacing (Tab): the angle between neighbouring copies">SPACING</button></div>
      <div class="field"><label for="w3d-rr-angle" data-id="rr-alabel">ANGLE °</label><input id="w3d-rr-angle" data-id="rr-angle" type="number" step="15" value="360"></div>
      <span class="label">AXIS</span>
      <div class="seg" role="group" aria-label="Radial array axis"><button data-rx="x" aria-pressed="false"><kbd>X</kbd>X</button><button data-rx="y" aria-pressed="false"><kbd>Y</kbd>Y</button><button data-rx="z" aria-pressed="true"><kbd>Z</kbd>Z</button></div>
      <div class="chips"><button data-id="rr-join" aria-pressed="false"><kbd>J</kbd>JOIN</button><button data-id="rr-instance" aria-pressed="false" title="Make instances of the solids, sharing their geometry, rather than copies (I)"><kbd>I</kbd>INSTANCE</button></div>
    </div>
    <div class="sec" data-panel="curve-array" hidden>
      <span class="hint" data-id="ca-hint">—</span>
      <div class="field"><label for="w3d-ca-count">COUNT</label><input id="w3d-ca-count" data-id="ca-count" type="number" step="1" min="1" value="5"></div>
      <div class="chips"><button data-id="ca-align" aria-pressed="true" title="Turn each copy with the curve (A)"><kbd>A</kbd>ALIGN</button><button data-id="ca-join" aria-pressed="false"><kbd>J</kbd>JOIN</button><button data-id="ca-instance" aria-pressed="false" title="Make instances of the solids, sharing their geometry, rather than copies (I)"><kbd>I</kbd>INSTANCE</button></div>
    </div>
    <div class="sec" data-panel="form" hidden>
      <span class="hint" data-id="form-hint">—</span>
      <div class="field" data-id="form-angle-row"><label for="w3d-form-angle">ANGLE °</label><input id="w3d-form-angle" data-id="form-angle" type="number" step="15" value="360"></div>
      <div class="field" data-id="form-thickness-row"><label for="w3d-form-thickness">THICKNESS</label><input id="w3d-form-thickness" data-id="form-thickness" type="number" step="0.5" min="0" value="0"></div>
      <div class="field" data-id="form-twist-row"><label for="w3d-form-twist">TWIST °</label><input id="w3d-form-twist" data-id="form-twist" type="number" step="15" value="0"></div>
      <div class="field" data-id="form-scale-row"><label for="w3d-form-scale">SCALE</label><input id="w3d-form-scale" data-id="form-scale" type="number" step="0.1" min="0.01" value="1"></div>
      <div class="field" data-id="form-guides-row"><label>GUIDES</label><output data-id="form-guides">0</output></div>
      <div data-id="form-method-row">
        <span class="label">GUIDE METHOD</span>
        <div class="seg" role="group" aria-label="Guide method">
          <button data-gmethod="point" aria-pressed="true" title="The section turns and scales to keep touching the guide"><kbd>M</kbd>POINT</button>
          <button data-gmethod="chord" aria-pressed="false" title="The section turns toward the guide without scaling">CHORD</button>
          <button data-gmethod="curve" aria-pressed="false" title="As Chord, matched by length along the guide">CURVE</button>
        </div>
      </div>
      <div data-id="form-align-row">
        <span class="label">ALIGNMENT</span>
        <div class="seg" role="group" aria-label="Alignment">
          <button data-galign="normal" aria-pressed="true" title="The section turns with the path"><kbd>N</kbd>NORMAL</button>
          <button data-galign="parallel" aria-pressed="false" title="The section keeps its drawn angle">PARALLEL</button>
        </div>
      </div>
      <div data-id="form-corner-row">
        <span class="label">CORNER TYPE</span>
        <div class="seg" role="group" aria-label="Corner type">
          <button data-gcorner="mitre" aria-pressed="true" title="The section meets itself in a sharp mitre at the path's corners">MITRE</button>
          <button data-gcorner="round" aria-pressed="false" title="The section turns round the path's corners">ROUND</button>
        </div>
      </div>
      <div class="field"><label>RESULT</label><output data-id="form-outcome">—</output></div>
      <div data-id="form-ops">
        <span class="label">OPERATION</span>
        <div class="seg" role="group" aria-label="Operation">
          <button data-fop="union" aria-pressed="false"><kbd>Q</kbd>UNION</button>
          <button data-fop="difference" aria-pressed="false"><kbd>W</kbd>DIFF</button>
          <button data-fop="intersect" aria-pressed="false"><kbd>⇧E</kbd>INTER</button>
          <button data-fop="new" aria-pressed="true"><kbd>B</kbd>NEW</button>
        </div>
      </div>
    </div>
    <div class="sec" data-panel="loft-sheet" hidden>
      <span class="hint" data-id="ls-hint">—</span>
      <div class="field"><label>CURVES</label><output data-id="ls-count">0</output></div>
      <div class="field"><label>LIMIT POINTS</label><output data-id="ls-limits">0</output></div>
      <div data-id="ls-edges-row" hidden>
        <span class="label">CONTINUITY · TWO EDGES</span>
        <div class="seg" role="group" aria-label="Continuity (Tab cycles)"><button data-lscont="G0" aria-pressed="true" title="Meet the edges only">G0</button><button data-lscont="G1" aria-pressed="false" title="Leave both faces tangent">G1</button><button data-lscont="G2" aria-pressed="false" title="Match both faces' curvature too">G2</button></div>
        <div class="field"><label for="w3d-ls-t">TENSION</label><input id="w3d-ls-t" data-id="ls-t" type="number" step="0.1" min="0.05" value="1" title="How far the sheet carries on from each face before it turns (D); 1 is a smooth cubic"></div>
      </div>
      <div class="chips"><button data-id="ls-loop" aria-pressed="false" title="Run the sheet on from the last curve back to the first (three curves or more)"><kbd>O</kbd>LOOP</button><button data-id="ls-limit" aria-pressed="false" title="Click a profile curve to set where the loft stops (up to two on each); click a point again to reverse it"><kbd>L</kbd>LIMIT POINT</button><button data-id="ls-simplify" aria-pressed="true" title="Simplify: parts of the loft that lie flat become trimmed planes rather than lofted surfaces">SIMPLIFY</button></div>
    </div>
    <div class="sec" data-panel="move" hidden>
      <span class="hint" data-id="move-hint">DRAG AN ARROW, PRESS X Y Z, OR TYPE</span>
      <div class="field"><label for="w3d-dx">ΔX</label><input id="w3d-dx" data-move="0" type="number" step="2.5" value="0"></div>
      <div class="field"><label for="w3d-dy">ΔY</label><input id="w3d-dy" data-move="1" type="number" step="2.5" value="0"></div>
      <div class="field"><label for="w3d-dz">ΔZ</label><input id="w3d-dz" data-move="2" type="number" step="2.5" value="0"></div>
    </div>
    <div class="sec" data-panel="xf-opts" hidden>
      <span class="label">ORIENTATION</span>
      <div class="seg wrap2" role="group" aria-label="Gizmo orientation">
        <button data-xforient="normal" aria-pressed="false" title="Normal: the gizmo's axes stand on the selected face (or the curve's plane)"><kbd>W</kbd>NORMAL</button>
        <button data-xforient="pivot" aria-pressed="false" title="Pivot: the axes stand on the face where the pivot was clicked">PIVOT</button>
        <button data-xforient="plane" aria-pressed="false" title="Construction plane: the axes follow the construction plane">CPLANE</button>
        <button data-xforient="world" aria-pressed="true" title="World: the axes follow the world's">WORLD</button>
      </div>
      <span class="label">PIVOT</span>
      <div class="seg" role="group" aria-label="Pivot">
        <button data-xfpivot="bbox" aria-pressed="true" title="The middle of the box round everything selected">BBOX</button>
        <button data-xfpivot="median" aria-pressed="false" title="The mean of the selected items' middles">MEDIAN</button>
        <button data-xfpivot="active" aria-pressed="false" title="The middle of the item selected last">ACTIVE</button>
      </div>
      <div class="chips"><button data-id="xf-pick" aria-pressed="false" title="Click where the gizmo goes"><kbd>V</kbd>SET PIVOT</button><button data-id="xf-unpivot" aria-pressed="false" title="Remove the pivot you set"><kbd>⌥V</kbd>REMOVE PIVOT</button></div>
    </div>
    <div class="sec" data-panel="pole-opts" hidden>
      <span class="label">PROPORTIONAL</span>
      <div class="seg" role="group" aria-label="Proportional">
        <button data-pfmode="none" aria-pressed="true" title="Only the picked points move">NONE</button>
        <button data-pfmode="all" aria-pressed="false" title="The points round the picked ones follow, less the further they are">ALL</button>
        <button data-pfmode="selected" aria-pressed="false" title="The picked points move most in the middle of the selection, less at its rim">SELECTED</button>
      </div>
      <div class="field"><label for="w3d-pfu">FALLOFF U</label><input id="w3d-pfu" data-id="pf-u" type="number" step="1" min="0.5" value="2"></div>
      <div class="field"><label for="w3d-pfv">FALLOFF V</label><input id="w3d-pfv" data-id="pf-v" type="number" step="1" min="0.5" value="2"></div>
      <span class="label">MIRROR</span>
      <div class="seg" role="group" aria-label="Mirror">
        <button data-pfmirror="none" aria-pressed="true" title="No mirror">NONE</button>
        <button data-pfmirror="u" aria-pressed="false" title="The point across the net in U moves too, mirrored">U</button>
        <button data-pfmirror="v" aria-pressed="false" title="The point across the net in V moves too, mirrored">V</button>
      </div>
    </div>
    <div class="sec" data-panel="rotate" hidden>
      <span class="hint">DRAG A RING, PRESS X Y Z OR R, OR TYPE</span>
      <span class="label">AXIS</span>
      <div class="seg" role="group" aria-label="Axis">
        <button data-axis="x" aria-pressed="false">X</button>
        <button data-axis="y" aria-pressed="false">Y</button>
        <button data-axis="z" aria-pressed="true">Z</button>
      </div>
      <div class="field"><label for="w3d-angle">ANGLE °</label><input id="w3d-angle" data-id="angle" type="number" step="15" value="0"></div>
    </div>
    <div class="sec" data-panel="scale" hidden>
      <span class="hint">DRAG THE CENTRE, PRESS S, OR TYPE</span>
      <div class="field"><label for="w3d-factor">FACTOR</label><input id="w3d-factor" data-id="factor" type="number" step="0.1" min="0.01" value="1"></div>
    </div>
    <div class="sec" data-panel="pushpull" hidden>
      <span class="hint" data-id="pp-hint">CLICK A FACE OR THE CONSTRUCTION PLANE</span>
      <div class="field"><label for="w3d-distance">Δ DISTANCE</label><input id="w3d-distance" data-id="distance" type="number" step="2.5" value="0" disabled></div>
      <div class="field"><label for="w3d-size">SIZE</label><input id="w3d-size" data-id="size" type="number" step="2.5" min="0.5" value="10"></div>
      <span class="label">PROFILE</span>
      <div class="seg" role="group" aria-label="Profile">
        <button data-profile="rect" aria-pressed="true"><kbd>R</kbd>RECT</button>
        <button data-profile="circle" aria-pressed="false"><kbd>C</kbd>CIRCLE</button>
      </div>
      <span class="label">OPERATION</span>
      <div class="seg" role="group" aria-label="Operation">
        <button data-op="join" aria-pressed="false"><kbd>Q</kbd>JOIN</button>
        <button data-op="cut" aria-pressed="false"><kbd>W</kbd>CUT</button>
        <button data-op="new" aria-pressed="false"><kbd>B</kbd>NEW</button>
      </div>
    </div>
    <div class="sec">
      <span class="label">VIEW</span>
      <div class="chips icons" role="group" aria-label="View">
        <button data-toggle="edges" aria-pressed="true" aria-label="Edges" title="Edges"></button>
        <button data-toggle="faces" aria-pressed="true" aria-label="Faces" title="Faces"></button>
        <button data-toggle="xray" aria-pressed="false" aria-label="X-ray" title="X-ray (Alt+Z)"></button>
        <button data-toggle="snap" aria-pressed="false" aria-label="Snap" title="Snap without holding Ctrl"></button>
        <button data-toggle="curves" aria-pressed="true" aria-label="Curves" title="Curves: show or hide them in the viewport"></button>
        <button data-toggle="curvature" aria-pressed="false" aria-label="Curvature" title="Curvature combs on curves (Toggle Curvature)"></button>
        <button data-toggle="render" aria-pressed="false" aria-label="Render" title="Render mode: lit by an environment, with the materials' roughness and metal"></button>
        <button data-toggle="ao" aria-pressed="false" aria-label="Ambient occlusion" title="Ambient occlusion: darken creases and corners where light reaches less"></button>
        <button data-id="section-btn" aria-pressed="false" aria-label="Section analysis" title="Section analysis: slice the view through a face or the construction plane; click again to end it"></button>
      </div>
      <div class="field"><label for="w3d-comb-scale">COMB SCALE</label><input id="w3d-comb-scale" data-id="comb-scale" type="range" min="0.1" max="4" step="0.1" value="1" title="Length of the curvature combs on curves and edges"></div>
      <span class="label">SHADER <output data-id="shader-name">CERAMIC DARK</output></span>
      <div class="swatches" role="group" aria-label="Shader mode">${SHADERS.map(s => `<button data-shader="${s.id}" aria-pressed="${s.id === 'ceramic-dark'}" aria-label="${s.name}" title="${s.name}: ${s.use}" style="background: ${s.swatch}"></button>`).join('')}</div>
      <div class="chips"><button data-id="matcap-load" title="Load a matcap image (PNG or JPEG) as the shader; it stays for next time">LOAD MATCAP</button><button data-id="matcap-custom" aria-pressed="false" hidden title="Your matcap">MY MATCAP</button></div>
      <input type="file" data-id="matcap-file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" hidden>
      <div class="stepper" data-id="shader-option" hidden><span data-id="shader-option-label">STRIPES</span><button data-id="shader-option-dec" aria-label="Less">−</button><output data-id="shader-option-value">24</output><button data-id="shader-option-inc" aria-label="More">+</button></div>
      <div data-id="render-options" hidden>
        <span class="label">ENVIRONMENT</span>
        <div class="chips">${ENVIRONMENTS.map(e => `<button data-env="${e.id}" aria-pressed="${e.id === 'studio'}" title="${e.use}">${e.name.toUpperCase()}</button>`).join('')}<button data-id="hdr-custom" aria-pressed="false" hidden title="Your HDR environment">HDR</button><button data-id="hdr-load" title="Load an HDR or EXR environment image (equirectangular) to light render mode">LOAD HDR</button></div>
        <input type="file" data-id="hdr-file" accept=".hdr,.exr" hidden>
        <div class="field"><label for="w3d-env-rot">ROTATION</label><input id="w3d-env-rot" data-id="env-rot" type="range" min="-180" max="180" step="1" value="0"></div>
        <div class="field"><label for="w3d-env-int">INTENSITY</label><input id="w3d-env-int" data-id="env-int" type="range" min="0" max="10" step="0.1" value="1"></div>
      </div>
      <div class="stepper"><span>GRID</span><button data-id="grid-dec" aria-label="Smaller grid step">−</button><output data-id="grid">2.5</output><button data-id="grid-inc" aria-label="Larger grid step">+</button></div>
    </div>
    <div class="sec" data-id="snapping">
      <span class="label">SNAPPING</span>
      <div class="chips"><button data-id="snap-object" aria-pressed="true" aria-label="Object snapping" title="Object snapping: points on solids, sheets and curves (Ctrl or drawing). Shift+X while a snap shows skips that kind until the command ends">${icon('snap-object')}</button>${SNAP_KINDS.map(k => `<button data-snapkind="${k.id}" aria-pressed="true" aria-label="${k.label} snaps" title="${k.label} snaps">${icon(`snap-${k.id}`)}</button>`).join('')}</div>
    </div>
    <div class="sec">
      <span class="label">CONSTRUCTION PLANE <output data-id="plane">XY</output></span>
      <div class="seg" role="group" aria-label="Construction plane">
        <button data-action="plane:selection" aria-label="From selection" title="From selection (Space): a flat face, a face and an edge, two parallel faces, a planar curve or region, or points; the view turns to face it">${icon('plane-face')}</button>
        <button data-action="plane:view" aria-label="Facing the view" title="Facing the view (Ctrl+Space), through the world origin">${icon('plane-view')}</button>
        <button data-action="plane:view-at" aria-label="Facing the view at a point" title="Facing the view (Ctrl+Shift+Space), through the next point you click">${icon('plane-point')}</button>
        <button data-action="plane:world" aria-label="World XY" title="The world XY plane">${icon('plane-world')}</button>
        <button data-action="plane:save" aria-label="Save plane" title="Save the construction plane to the list below (Temporary construction plane); saved with the file">${icon('plane-save')}</button>
      </div>
      <div class="saved-planes" data-id="saved-planes" hidden></div>
    </div>
    <div class="states">
      <span class="label">STATE</span>
      <ol data-id="states">
        <li data-s="none">NONE</li><li data-s="updating">UPDATING</li><li data-s="updated">UPDATED</li>
        <li data-s="committed">COMMITTED</li><li data-s="failed">FAILED</li><li data-s="cancelled">CANCELLED</li>
      </ol>
    </div>
    <span class="fill"></span>
    <div class="pair">
      <button data-id="cancel" disabled>ESC CANCEL</button>
      <button data-id="commit" disabled>⏎ OK</button>
    </div>
  </aside>

  <footer class="status">
    <span>SYS.1 / <span data-id="status-tool">SELECT</span> / <span data-id="status-target">VOID</span></span>
    <span data-id="kernel"></span>
    <span>UNITS MM</span>
    <span>PLANE <span data-id="status-plane">XY</span></span>
    <span data-id="blender" hidden title="Blender and Cinema 4D bridges">BRIDGE <output data-id="blender-state">—</output></span>
    <span>PREVIEW <output data-id="ms">—</output> MS · COALESCED <output data-id="coalesced">0→0</output></span>
    <span class="spacer"></span>
    <output data-id="cursor">X 0.00 Y 0.00 Z 0.00</output>
  </footer>
</div>`;

const COLORS = { ground: 0x0f0f11, ink: 0xefebe0, accent: 0xff4d00, face: 0x1c1c20, grid: 0x19191c, gridMajor: 0x232327 };
const DANGER = 0xef4444;
// Millimetres. The grid steps are what Ctrl snaps lengths to.
const GRID_STEPS = [0.5, 1, 2.5, 5, 10];
const DEG = Math.PI / 180;
const label = id => `B-${String(id).padStart(2, '0')}`;
const curveLabel = id => `C-${String(id).padStart(2, '0')}`;
const fmt = n => (n < 0 ? '−' : '+') + Math.abs(n).toFixed(2);
// User coordinates are z up; the viewport's own y is up.
const toWorld = ([x, y, z]) => [x, z, -y];
const toUser = ([x, y, z]) => [x, -z, y];
const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const worldAxis = a => new THREE.Vector3(...toWorld(AXES[a]));
// Numpad views: where the camera sits from the target, and the construction plane it brings
// (Plasticity: Num7 top and XY, Num1 front and XZ, Num3 right and YZ; Ctrl for the opposite side).
const VIEWS = {
  top: { dir: [0, 1, 0.0001], plane: 'XY' }, bottom: { dir: [0, -1, 0.0001], plane: 'XY' },
  front: { dir: [0, 0, 1], plane: 'XZ' }, back: { dir: [0, 0, -1], plane: 'XZ' },
  right: { dir: [1, 0, 0], plane: 'YZ' }, left: { dir: [-1, 0, 0], plane: 'YZ' },
  iso: { dir: [125, 105, 140] },
};

export async function mount(root, backend) {
  root.innerHTML = SHELL;
  // Panel options carry their icon ahead of the key and name.
  for (const b of root.querySelectorAll('[data-proj],[data-imp],[data-impcomp],[data-draw],[data-bop],[data-btmat],[data-bumat],[data-xop],[data-fop],[data-spiral],[data-toggle],[data-gmethod],[data-galign],[data-gcorner],[data-grow],[data-mfgrow],[data-drgrow],[data-eslimit],[data-flshape],[data-drtaper],[data-avaxis],[data-extshape],[data-esshape],[data-isodir],[data-id="oe-both"],[data-id="iso-subdivide"],[data-id="oe-individual"],[data-id="blend-tangent"],[data-id="ex-lock"],[data-id="bool-keep"],[data-id="prim-keep"],[data-id="ex-free"],[data-id="ex-pivot"],[data-id="ex-individual"],[data-id="patch-individual"],[data-id="patch-quad"],[data-id="as-symmetric"],[data-id="as-analysis"],[data-id="sq-analysis"],[data-id="dr-hidden"],[data-id="dr-curves"],[data-id="oc-lock"],[data-id="oc-free"],[data-id="oc-slot"],[data-id="oc-combine"],[data-id="es-unlimit"],[data-rbmethod],[data-oecorner],[data-saplane],[data-plaxis],[data-plop],[data-id="pl-flip"],[data-id="pl-instance"],[data-id="mirror-instance"],[data-id="mirror-neg"],[data-id="mirror-free"],[data-id="mirror-cut"],[data-id="ra-instance"],[data-id="ra-spacing"],[data-id="ra-extent"],[data-id="rr-total"],[data-id="rr-spacing"],[data-id="rr-instance"],[data-id="ca-instance"],[data-id="br-trim"],[data-id="br-comb"],[data-id="br-constrain"],[data-id="ac-constrain"],[data-id="ac-comb"],[data-id="dc-reblend"],[data-id="section-btn"],[data-id="sa-flip"],[data-id="rf-shrink"],[data-id="ut-keep"],[data-txfont],[data-id="tx-load"],[data-id="tx-system"],[data-txalign],[data-sldir],[data-dcflip],[data-id="dc-keep"],[data-imdepth],[data-imcull],[data-id="im-delete"],[data-id="cc-extend"],[data-id="cc-screen"],[data-inmode],[data-pfmode],[data-pfmirror],[data-xforient],[data-xfpivot],[data-id="xf-pick"],[data-id="xf-unpivot"],[data-id="ls-loop"],[data-id="ls-limit"],[data-id="ls-simplify"],[data-pmethod],[data-mxtopo],[data-id="mx-convex"],[data-sqbound],[data-asbound],[data-bsshape],[data-bstrim],[data-id="bs-add"],[data-id="bs-s1"],[data-id="bs-s2"],[data-id="in-realize"],[data-id="in-dup"],[data-id="in-delete"],[data-id="matcap-load"],[data-id="matcap-custom"],[data-id="hdr-load"],[data-id="hdr-custom"]')) {
    const name = (b.dataset.proj && (b.dataset.proj === 'screen' ? 'view-screen' : `proj-${b.dataset.proj}`)) ?? (b.dataset.imp && (b.dataset.imp === 'screen' ? 'view-screen' : `proj-${b.dataset.imp}`)) ?? (b.dataset.impcomp && `completion-${b.dataset.impcomp}`) ?? b.dataset.draw ?? b.dataset.bop ?? (b.dataset.xforient && `orient-${b.dataset.xforient}`) ?? (b.dataset.xfpivot && `pivot-${b.dataset.xfpivot}`) ?? (b.dataset.btmat && `mat-${b.dataset.btmat}`) ?? (b.dataset.bumat && `mat-${b.dataset.bumat}`) ?? b.dataset.xop ?? b.dataset.fop ?? b.dataset.spiral ?? (b.dataset.toggle && `view-${b.dataset.toggle}`)
      ?? (b.dataset.gmethod && `guide-${b.dataset.gmethod}`) ?? (b.dataset.galign && `align-${b.dataset.galign}`) ?? (b.dataset.gcorner && (b.dataset.gcorner === 'round' ? 'corner-round' : 'corner-linear')) ?? (b.dataset.grow && `grow-${b.dataset.grow}`) ?? (b.dataset.mfgrow && `grow-${b.dataset.mfgrow}`) ?? (b.dataset.drgrow && `grow-${b.dataset.drgrow}`) ?? (b.dataset.eslimit && `limit-${b.dataset.eslimit}`) ?? (b.dataset.flshape && `fillet-${b.dataset.flshape}`) ?? (b.dataset.drtaper && `taper-${b.dataset.drtaper}`) ?? (b.dataset.avaxis && `axis-${b.dataset.avaxis}`) ?? (b.dataset.extshape && `extend-${b.dataset.extshape}`) ?? (b.dataset.esshape && `extend-${b.dataset.esshape}`) ?? (b.dataset.isodir && `iso-${b.dataset.isodir}`) ?? (b.dataset.rbmethod && `rebuild-${b.dataset.rbmethod}`) ?? (b.dataset.oecorner && `corner-${b.dataset.oecorner}`) ?? (b.dataset.saplane && `section-${b.dataset.saplane}`) ?? (b.dataset.plaxis && (b.dataset.plaxis === 'normal' ? 'place-normal' : `axis-${b.dataset.plaxis}`)) ?? b.dataset.plop
      ?? (b.dataset.txfont && `font-${b.dataset.txfont}`) ?? (b.dataset.txalign && `txalign-${b.dataset.txalign}`) ?? (b.dataset.sldir && { u: 'slide-u', '-u': 'slide-back', v: 'slide-v', '-v': 'slide-vback', n: 'slide-n' }[b.dataset.sldir]) ?? (b.dataset.dcflip && { mirror: 'mirror', swap: 'swap-uv', normal: 'reverse-sheet' }[b.dataset.dcflip]) ?? (b.dataset.imdepth && `depth-${b.dataset.imdepth}`) ?? (b.dataset.imcull && `cull-${b.dataset.imcull}`) ?? b.dataset.inmode ?? (b.dataset.bsshape && `bridge-${b.dataset.bsshape}`) ?? (b.dataset.bstrim && `trimwall-${b.dataset.bstrim}`) ?? (b.dataset.mxtopo && `topo-${b.dataset.mxtopo}`) ?? (b.dataset.pmethod && (b.dataset.pmethod === 'fill' ? 'patch-fill' : `trim-${b.dataset.pmethod}`)) ?? (b.dataset.pfmode && `falloff-${b.dataset.pfmode}`) ?? ((b.dataset.sqbound ?? b.dataset.asbound) && `bound-${b.dataset.sqbound ?? b.dataset.asbound}`) ?? (b.dataset.pfmirror && `mirror-${b.dataset.pfmirror}`)
      ?? { 'matcap-load': 'matcap-load', 'matcap-custom': 'matcap', 'tx-load': 'font-load', 'tx-system': 'font-system', 'hdr-load': 'hdr-load', 'hdr-custom': 'hdr', 'ex-lock': 'lock', 'bool-keep': 'keep', 'prim-keep': 'keep', 'ex-free': 'freestyle', 'ex-pivot': 'pivot', 'ex-individual': 'individual', 'patch-individual': 'individual', 'mx-convex': 'convex', 'patch-quad': 'square', 'as-symmetric': 'symmetric', 'as-analysis': 'analysis', 'sq-analysis': 'analysis', 'bs-add': 'wall-pair', 'bs-s1': 'flip', 'bs-s2': 'flip', 'dr-hidden': 'hidden-lines', 'dr-curves': 'drawing-curves', 'oc-lock': 'lock', 'oc-free': 'freestyle', 'oc-slot': 'slot', 'oc-combine': 'combine', 'oe-both': 'both-sides', 'xf-pick': 'pivot', 'xf-unpivot': 'pivot-remove', 'ls-loop': 'loft-loop', 'ls-limit': 'limit-point', 'ls-simplify': 'simplify', 'iso-subdivide': 'subdivide', 'oe-individual': 'individual', 'blend-tangent': 'tangent-chain', 'es-unlimit': 'unlimit', 'rf-shrink': 'shrink', 'ut-keep': 'keep-edges', 'section-btn': 'view-section', 'sa-flip': 'flip', 'pl-flip': 'flip', 'pl-instance': 'instance', 'mirror-instance': 'instance', 'mirror-neg': 'mirror-neg', 'mirror-free': 'freestyle', 'mirror-cut': 'mirror-cut', 'ra-instance': 'instance', 'ra-spacing': 'array-spacing', 'ra-extent': 'array-extent', 'rr-total': 'array-total', 'rr-spacing': 'array-angle-step', 'rr-instance': 'instance', 'ca-instance': 'instance', 'br-trim': 'trim', 'br-comb': 'view-curvature', 'br-constrain': 'constrain', 'ac-constrain': 'constrain', 'ac-comb': 'view-curvature', 'dc-reblend': 'reblend', 'dc-keep': 'keep', 'im-delete': 'delete', 'in-realize': 'realize-instance', 'cc-extend': 'extend', 'cc-screen': 'view-screen', 'in-dup': 'duplicate', 'in-delete': 'delete' }[b.dataset.id];
    b.insertAdjacentHTML('afterbegin', icon(name));
  }
  const $ = id => root.querySelector(`[data-id="${id}"]`);
  const $$ = sel => [...root.querySelectorAll(sel)];

  // The toolbar: Plasticity's families of tools, each one button with its variants a click away.
  const NAMES = { rect: 'CORNER RECTANGLE', circle: 'CENTER CIRCLE', line: 'LINE', explode: 'EXPLODE', 'offset-curve': 'OFFSET CURVE', 'fillet-curve': 'FILLET CURVE', bridge: 'BRIDGE CURVES' };
  const ICON_OF = { 'measure-distance': 'measure', 'measure-radius': 'measure', 'measure-continuity': 'measure' };
  const toolbar = new Toolbar(root.querySelector('[data-id="tools"]'), root, id => ({
    name: NAMES[id] ?? EDITS[id] ?? DRAW[id] ?? toolInfo(id)?.label ?? id.toUpperCase(),
    key: keyFor(`draw:${id}`) || keyFor(`tool:${id}`) || (toolInfo(id)?.key ?? '').toUpperCase().replaceAll('-', ' '),
    icon: icon(ICON_OF[id] ?? id),
  }), id => (id === 'explode' ? explodeSelected() : startTool(id)));
  const say = e => String(e?.message ?? e).toUpperCase();

  const toast = msg => {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => t.hidden = true, 2600);
  };
  $('kernel').textContent = `KERNEL: ${backend.info.kernel}`;
  // Plasticity's Constraint System (constraints.js): every curve replacement also remakes the
  // constrained bridges hanging on the replaced curves, in the same undo step.
  const constraints = new Constraints();
  let bridgeConstrain = false;   // Create Constraints, remembered between bridges as in Plasticity
  let alignConstrain = false;    // and between Vertex Aligns
  if (backend.replaceCurves) {
    const rawReplace = backend.replaceCurves.bind(backend);
    backend.replaceCurves = async (ids, list) => {
      const p = constraints.plan(ids, list, curveById, (ins, k, out) => k.kind === 'bridge' ? bridgeContinuous(ins[0], k.ea, ins[1], k.eb, k.options) : alignCurveEnd(out, k.endT, ins[0], k.endR, k.options));
      const r = await rawReplace([...ids, ...p.ids], [...list, ...p.list]);
      p.done(r.ids);
      return { ...r, ids: r.ids.slice(0, list.length) };
    };
  }

  // --- viewport and navigation ---------------------------------------------
  // Plasticity's mouse: middle-drag orbits, right-drag pans, the wheel zooms in steps and
  // Ctrl+middle-drag zooms smoothly. The left button is for selecting.
  const canvas = root.querySelector('canvas');
  const viewEl = root.querySelector('.view');
  // Without WebGL there is no 3D view: say so on the loading screen rather than hang on it.
  const NO_GL = '3D VIEW UNAVAILABLE: THE BROWSER COULD NOT START WEBGL. ITS GPU PROCESS IS OFF OR CRASHED, OFTEN WHEN DRIVE C: IS FULL. FREE SOME SPACE, CHECK HARDWARE ACCELERATION IS ON, THEN RESTART THE BROWSER OR APP.';
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); }
  catch (e) { $('loading').textContent = NO_GL; throw e; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  // The GPU process can also go away later; the browser restores the context when it comes back.
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); $('loading').textContent = NO_GL; $('loading').hidden = false; });
  canvas.addEventListener('webglcontextrestored', () => { $('loading').hidden = true; });
  // Preferences (Ctrl+,): read before anything takes its colours, so the accent reaches every
  // highlight; the rest also apply as they are changed.
  let prefs = readPrefs((() => { try { return JSON.parse(localStorage.getItem('w3d-prefs')); } catch { return null; } })());
  Object.assign(COLORS, viewColors(prefs.appearance));
  root.style.setProperty('--accent', prefs.appearance.accent);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.ground);
  const persp = new THREE.PerspectiveCamera(35, 1, 1, 4000);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -4000, 4000);
  let camera = persp;
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.zoomToCursor = true;
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
  // Rotate around cursor (Preferences): a middle-drag over a body turns the view about the point
  // under the cursor; over empty space it orbits the view's centre as before.
  let pivotDrag = null;
  viewEl.addEventListener('pointerdown', e => {
    if (e.button !== 1) return;
    // The drag's zoom direction (Invert Zoom), and Ctrl + middle-drag zooms only with Zoom Vertical on.
    controls.zoomSpeed = controlSettings(prefs.navigation).zoomSpeed;
    const dolly = (e.ctrlKey || e.metaKey) && prefs.navigation.zoomVertical;
    controls.mouseButtons.MIDDLE = dolly ? THREE.MOUSE.DOLLY : THREE.MOUSE.ROTATE;
    const arcball = prefs.navigation.arcball;
    if (dolly || e.shiftKey || turning || !(prefs.navigation.rotateAroundCursor || arcball)) return;
    let pivot = null;
    if (prefs.navigation.rotateAroundCursor) { ray(e); pivot = raycaster.intersectObjects(shownMeshes(), false)[0]?.point.clone() ?? null; }
    if (!pivot && !arcball) return;
    controls.mouseButtons.MIDDLE = null;
    pivotDrag = { pivot: pivot ?? controls.target.clone(), arcball, x: e.clientX, y: e.clientY };
  }, true);
  addEventListener('pointermove', e => {
    if (!pivotDrag) return;
    const dx = e.clientX - pivotDrag.x, dy = e.clientY - pivotDrag.y;
    pivotDrag.x = e.clientX; pivotDrag.y = e.clientY;
    if (pivotDrag.arcball) {
      // Arcball: no fixed up, so the camera's up turns with the view.
      camera.updateMatrixWorld();
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize(), up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
      const r = arcballAbout(camera.position, controls.target, up, right, pivotDrag.pivot, dx, dy, canvas.clientHeight, prefs.navigation.rotateSpeed);
      camera.position.copy(r.position);
      controls.target.copy(r.target);
      camera.up.copy(r.up);
      camera.lookAt(controls.target);
      return;
    }
    const { azimuth, elevation } = dragAngles(dx, dy, canvas.clientHeight, prefs.navigation.rotateSpeed);
    const r = orbitAbout(camera.position, controls.target, pivotDrag.pivot, azimuth, elevation, camera.up);
    camera.position.copy(r.position);
    controls.target.copy(r.target);
    camera.lookAt(controls.target);
  });
  addEventListener('pointerup', e => { if (e.button === 1 && pivotDrag) { pivotDrag = null; controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE; } });
  // The wheel's zoom direction has its own switch (Invert Wheel Direction).
  viewEl.addEventListener('wheel', () => { controls.zoomSpeed = wheelSpeed(prefs.navigation); }, { capture: true, passive: true });
  // The selection context menu: the wheel moves down its list instead of zooming; with the left
  // button held (Plasticity's left-click + wheel), the first turn opens it, and letting go selects.
  viewEl.addEventListener('wheel', e => {
    const held = down && down.button === 0 && !down.box && (!cmd || cmd.auto);
    if (!pickMenu && !held) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const step = e.deltaY > 0 || e.deltaX > 0 ? 1 : -1;
    if (!pickMenu) {
      openPickMenu(e);
      if (pickMenu) { pickMenu.held = true; down.consumed = true; }
      return;
    }
    movePick(pickMenu.at + step);
  }, { capture: true, passive: false });
  addEventListener('keydown', e => {
    if (!pickMenu) return;
    const keys = { Escape: () => closePickMenu(), ArrowDown: () => movePick(pickMenu.at + 1), ArrowUp: () => movePick(pickMenu.at - 1), Enter: () => choosePick(pickMenu.at, e.shiftKey) };
    if (!keys[e.key]) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    keys[e.key]();
    if (!pickMenu) { hover = null; drawOverlays(); }
  }, true);
  // Regular Polygon: Shift+wheel adds or takes away a side instead of zooming.
  viewEl.addEventListener('wheel', e => {
    if (!e.shiftKey || (cmd?.id !== 'polygon' && !cmd?.wheel)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const up = e.deltaY < 0 || e.deltaX < 0;
    if (cmd.id === 'polygon') setSides(cmd.sides + (up ? 1 : -1));
    else cmd.wheel(up ? 1 : -1);
  }, { capture: true, passive: false });
  scene.add(new THREE.HemisphereLight(0xffffff, 0x202024, 1.4));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
  keyLight.position.set(5, 10, 7);
  scene.add(keyLight);

  // Plasticity and Blender turn the camera to a new view rather than jumping; so does this, over
  // `VIEW_MS`. A turn in progress is replaced by the next.
  const VIEW_MS = 260;
  let turning = null;
  function turnTo(target, position, ms = VIEW_MS) {
    if (!ms) { controls.target.copy(target); camera.position.copy(position); camera.lookAt(target); turning = null; return; }
    const from = { target: controls.target.clone(), offset: camera.position.clone().sub(controls.target) };
    const to = { target: target.clone(), offset: position.clone().sub(target) };
    turning = { from, to, t0: performance.now(), ms };
  }
  function stepTurn(now) {
    const t = turning;
    if (!t) return;
    const k = Math.min(1, (now - t.t0) / t.ms), e = k * k * (3 - 2 * k);
    // Swing the direction on the sphere and blend the distance, so the view never passes through the target.
    const a = t.from.offset.clone().normalize(), b = t.to.offset.clone().normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(a, b);
    const dir = a.applyQuaternion(new THREE.Quaternion().slerp(q, e));
    const len = THREE.MathUtils.lerp(t.from.offset.length(), t.to.offset.length(), e);
    controls.target.lerpVectors(t.from.target, t.to.target, e);
    camera.position.copy(controls.target).addScaledVector(dir, len);
    camera.lookAt(controls.target);
    if (k >= 1) turning = null;
  }
  function setView(name, { animate = true } = {}) {
    const v = VIEWS[name];
    // A named view stands upright again after arcball turns rolled it.
    camera.up.set(0, 1, 0);
    const dist = name === 'iso' ? 225 : camera.position.distanceTo(controls.target);
    const target = name === 'iso' ? new THREE.Vector3(0, 15, 0) : controls.target.clone();
    const dir = new THREE.Vector3(...v.dir).normalize();
    turnTo(target, target.clone().addScaledVector(dir, dist), animate ? VIEW_MS : 0);
    if (v.plane) setPlane({ origin: new THREE.Vector3(), normal: new THREE.Vector3(...v.dir).normalize().round(), name: v.plane });
  }
  /** Orbit about the target by `dx` (around up) and `dy` (over the top) radians, as a middle-drag does. */
  function orbitBy(dx, dy) {
    turning = null;
    const offset = camera.position.clone().sub(controls.target);
    const s = new THREE.Spherical().setFromVector3(offset);
    s.theta += dx;
    s.phi = THREE.MathUtils.clamp(s.phi + dy, 0.01, Math.PI - 0.01);
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s));
    camera.lookAt(controls.target);
  }
  /** Slide the view by a screen drag of `dx`, `dy` pixels, as a right-drag does. */
  function panBy(dx, dy) {
    turning = null;
    const h = canvas.clientHeight || 1;
    const span = camera.isOrthographicCamera ? (camera.top - camera.bottom) / camera.zoom
      : 2 * camera.position.distanceTo(controls.target) * Math.tan(persp.fov * DEG / 2);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
    const move = right.multiplyScalar(-dx * span / h).addScaledVector(up, dy * span / h);
    camera.position.add(move);
    controls.target.add(move);
  }
  /** Zoom by a vertical drag of `dy` pixels: up zooms in. */
  function zoomBy(dy) {
    turning = null;
    const f = Math.exp(dy * 0.01);
    if (camera.isOrthographicCamera) { camera.zoom = THREE.MathUtils.clamp(camera.zoom / f, 0.01, 1000); camera.updateProjectionMatrix(); return; }
    const offset = camera.position.clone().sub(controls.target).multiplyScalar(f);
    if (offset.length() < 1) return;
    camera.position.copy(controls.target).add(offset);
  }
  function setOrtho(on) {
    if (on === camera.isOrthographicCamera) return;
    const next = on ? ortho : persp;
    next.position.copy(camera.position);
    next.quaternion.copy(camera.quaternion);
    next.up.copy(camera.up);
    if (on) {
      // Keep what's at the target the same size on screen.
      const h = camera.position.distanceTo(controls.target) * Math.tan(persp.fov * DEG / 2);
      ortho.top = h; ortho.bottom = -h; ortho.zoom = 1;
    } else {
      const h = (ortho.top - ortho.bottom) / 2 / ortho.zoom;
      const d = h / Math.tan(persp.fov * DEG / 2);
      next.position.copy(controls.target).add(camera.position.clone().sub(controls.target).normalize().multiplyScalar(d));
    }
    camera = next;
    controls.object = camera;
    for (const g of [cmd?.gizmo, cmd?.tc]) if (g) g.camera = camera;
    resize(true);
  }
  /** Frame the selection, or everything (Plasticity 0.6.30's /). */
  function focus() {
    turning = null;
    const ids = sel.size ? sel.bodies : current.map(b => b.id);
    const box = new THREE.Box3();
    for (const id of ids) { const m = bodyMesh(id); if (m) box.expandByObject(m); }
    if (box.isEmpty()) return;
    const s = box.getBoundingSphere(new THREE.Sphere());
    const dir = camera.position.clone().sub(controls.target).normalize();
    controls.target.copy(s.center);
    camera.position.copy(s.center).addScaledVector(dir, s.radius / Math.sin(persp.fov * DEG / 2) * 1.1);
    if (camera.isOrthographicCamera) camera.zoom = (ortho.top - ortho.bottom) / (2.2 * s.radius);
    camera.updateProjectionMatrix();
  }

  // --- drawing what the backend sends ---------------------------------------
  const view = { edges: true, faces: true, curves: true, xray: false, snap: false, curvature: false, shader: 'ceramic-dark', render: false, environment: 'studio', envRotation: 0, envIntensity: 1, ao: false };
  const shadeU = {
    mode: { value: 0 }, sectioned: { value: false }, pull: { value: new THREE.Vector3(0, 1, 0) }, stripes: { value: SHADER_OPTIONS.stripes.value },
    draftSin: { value: Math.sin(SHADER_OPTIONS.draft.value * DEG) }, spacing: { value: SHADER_OPTIONS.spacing.value }, bend: { value: 1 / SHADER_OPTIONS.radius.value },
    // A matcap image of your own (Load Matcap): looked up by the view-space normal, shown as it is.
    matcap: { value: new THREE.DataTexture(new Uint8Array([160, 156, 148, 255]), 1, 1) },
  };
  shadeU.matcap.value.needsUpdate = true;
  const shaderOpts = Object.fromEntries(Object.entries(SHADER_OPTIONS).map(([k, o]) => [k, o.value]));
  const faceMat = new THREE.MeshStandardMaterial({ color: COLORS.face, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const edgeMat = new THREE.LineBasicMaterial({ color: COLORS.ink, transparent: true, opacity: 0.8 });
  const phantom = {
    add: { face: new THREE.MeshBasicMaterial({ color: COLORS.ink, transparent: true, opacity: 0.1, depthWrite: false }), edge: new THREE.LineBasicMaterial({ color: COLORS.ink }) },
    cut: { face: new THREE.MeshBasicMaterial({ color: COLORS.accent, transparent: true, opacity: 0.16, depthWrite: false }), edge: new THREE.LineBasicMaterial({ color: COLORS.accent }) },
  };
  // Shader modes (shading.js), drawn from the face normal in view space rather than from matcap
  // images. Zebra stripes mirror even bands, so they stay smooth over G2 joins, kink at G1 ones and
  // break where faces only touch (G0). In render mode the faces keep the lit physical material.
  const shade = (own = false) => shader => {
    Object.assign(shader.uniforms, { ownColor: { value: own }, sectioned: shadeU.sectioned, shadeMode: shadeU.mode, pull: shadeU.pull, stripes: shadeU.stripes, draftSin: shadeU.draftSin, spacing: shadeU.spacing, bend: shadeU.bend, matcap: shadeU.matcap });
    shader.fragmentShader = 'uniform bool ownColor;\nuniform bool sectioned;\nuniform int shadeMode;\nuniform vec3 pull;\nuniform float stripes;\nuniform float draftSin;\nuniform float spacing;\nuniform float bend;\nuniform sampler2D matcap;\n' + shader.fragmentShader.replace('#include <dithering_fragment>', `
      // In a block of its own, so its names can't clash with the physical material's (clearcoat,
      // sheen and the rest declare their own in main).
      {
      // Faces draw both sides so a sheet shows from behind (Reverse Sheet); three.js has already
      // turned the normal of a back face towards the eye.
      vec3 n = normalize(normal);
      vec3 v = normalize(vViewPosition);
      // A matcap's lighting: the view-space normal against a light up and to the left.
      float lam = clamp(dot(n, normalize(vec3(-0.4, 0.6, 0.7))), 0.0, 1.0);
      float spec = pow(clamp(dot(reflect(-normalize(vec3(-0.4, 0.6, 0.7)), n), v), 0.0, 1.0), 40.0);
      float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.0);
      // The colour modes show a body's material, or a light grey where it has none.
      vec3 base = ownColor ? diffuseColor.rgb : vec3(0.62, 0.60, 0.56);
      // Ceramic dark keeps the lit standard material; a body with a material shows its colour in it
      // without needing an environment (render mode, -1, leaves everything to the physical material).
      if (shadeMode == 0 && ownColor) gl_FragColor.rgb = base * (0.25 + 0.7 * lam) + 0.2 * spec;
      else if (shadeMode == 1) gl_FragColor.rgb = mix(vec3(0.07, 0.10, 0.16), vec3(0.42, 0.52, 0.64), lam) + vec3(spec) + 0.35 * fres * vec3(0.6, 0.75, 1.0);
      else if (shadeMode == 2) gl_FragColor.rgb = vec3(0.03 + 0.17 * lam) + vec3(spec) * 1.2 + 0.25 * fres;
      else if (shadeMode == 3) gl_FragColor.rgb = mix(vec3(0.24, 0.23, 0.21), vec3(0.86, 0.84, 0.79), 0.5 + 0.5 * n.y);
      else if (shadeMode == 4) gl_FragColor.rgb = base * (0.35 + 0.75 * lam) + vec3(pow(spec, 0.5) * 0.8);
      else if (shadeMode == 5) gl_FragColor.rgb = base * (0.3 + 0.8 * lam);
      else if (shadeMode == 6) gl_FragColor.rgb = vec3(0.0);
      else if (shadeMode == 7) gl_FragColor.rgb = base;
      else if (shadeMode == 8) {
        // Isophotes: bands of equal angle between the face and the line of sight.
        float band = fract(acos(clamp(dot(n, v), -1.0, 1.0)) / 1.5707963 * stripes * 0.5);
        float aa = fwidth(band) * 1.5;
        gl_FragColor.rgb = mix(vec3(0.08), vec3(0.9), smoothstep(0.5 - aa, 0.5 + aa, band) - smoothstep(1.0 - aa, 1.0, band));
      } else if (shadeMode == 9) {
        // Draft: the face's angle to the pull direction against the threshold.
        vec3 nw = normalize((vec4(n, 0.0) * viewMatrix).xyz);
        float d = dot(nw, normalize(pull));
        vec3 tint = d > draftSin ? vec3(0.30, 0.72, 0.42) : d < -draftSin ? vec3(0.86, 0.30, 0.26) : vec3(0.93, 0.68, 0.22);
        gl_FragColor.rgb = tint * (0.55 + 0.45 * abs(n.z));
      } else if (shadeMode == 10 || shadeMode == 11) {
        vec3 r = reflect(-v, n);
        float band = fract((asin(clamp(shadeMode == 10 ? r.y : r.x, -1.0, 1.0)) / 3.14159265 + 0.5) * stripes);
        float aa = fwidth(band) * 1.5;
        float s = smoothstep(0.5 - aa, 0.5 + aa, band) - smoothstep(1.0 - aa, 1.0, band);
        gl_FragColor.rgb = mix(vec3(0.06), vec3(0.92), s);
      } else if (shadeMode == 12) {
        // Topography: a line every \`spacing\` mm of height along the construction plane normal.
        vec3 world = (inverse(viewMatrix) * vec4(-vViewPosition, 1.0)).xyz;
        float h = dot(world, normalize(pull)) / spacing;
        float line = abs(fract(h - 0.5) - 0.5) / max(fwidth(h), 1e-6);
        gl_FragColor.rgb = mix(vec3(1.0, 0.30, 0.0), vec3(0.16 + 0.2 * lam), clamp(line, 0.0, 1.0));
      } else if (shadeMode == 13) gl_FragColor.rgb = (gl_FrontFacing ? vec3(0.24, 0.44, 0.85) : vec3(0.85, 0.29, 0.24)) * (0.45 + 0.55 * lam);
      else if (shadeMode == 14) {
        // A matcap image: the sphere's picture at the view-space normal, tinted by a material's colour.
        vec3 m = texture2D(matcap, n.xy * 0.495 + 0.5).rgb;
        gl_FragColor.rgb = ownColor ? m * diffuseColor.rgb / 0.62 : m;
      } else if (shadeMode >= 15 && shadeMode <= 17) {
        // Curvature from how the normal turns across the pixel: the first and second fundamental
        // forms in screen directions give Gaussian K and mean H, and the larger principal curvature.
        vec3 p = -vViewPosition, a = dFdx(p), b = dFdy(p), na = dFdx(n), nb = dFdy(n);
        float E = dot(a, a), F = dot(a, b), G = dot(b, b);
        float L = dot(na, a), M = 0.5 * (dot(na, b) + dot(nb, a)), N = dot(nb, b);
        float det = max(E * G - F * F, 1e-24);
        float K = (L * N - M * M) / det, H = (E * N - 2.0 * F * M + G * L) / (2.0 * det);
        float k = shadeMode == 15 ? sign(K) * sqrt(abs(K)) : shadeMode == 16 ? H : abs(H) + sqrt(max(H * H - K, 0.0));
        float t = clamp(k / bend, -1.0, 1.0);
        vec3 flat_ = vec3(0.30, 0.72, 0.42), out_ = vec3(0.86, 0.30, 0.26), in_ = vec3(0.24, 0.44, 0.85);
        vec3 c = shadeMode == 17 ? (t < 0.5 ? mix(flat_, vec3(0.93, 0.68, 0.22), t * 2.0) : mix(vec3(0.93, 0.68, 0.22), out_, t * 2.0 - 1.0))
          : t >= 0.0 ? mix(flat_, out_, t) : mix(flat_, in_, -t);
        gl_FragColor.rgb = c * (0.6 + 0.4 * lam);
      }
      // Section Analysis: where the slice opens a solid, its inside shows flat in the accent.
      if (sectioned && !gl_FrontFacing) gl_FragColor.rgb = vec3(1.0, 0.30, 0.0) * 0.7;
      // The modes above write colours as shown on screen. Drawn into a linear buffer (ambient
      // occlusion, whose last pass makes them screen colours again), they are made linear first.
      if (shadeMode >= 0 && !(shadeMode == 0 && !ownColor) || (sectioned && !gl_FrontFacing))
        gl_FragColor = linearToOutputTexel(sRGBTransferEOTF(vec4(clamp(gl_FragColor.rgb, 0.0, 1.0), gl_FragColor.a)));
      }
      #include <dithering_fragment>`);
  };
  faceMat.onBeforeCompile = shade();
  // Set Material: bodies share materials by id; each gets its own three.js material made from it.
  const materials = new Map(), materialOf = new Map();   // material id -> values; body id -> material id
  let nextMaterial = 1;
  const bodyMats = new Map();   // body id -> THREE material
  function faceMatFor(id) {
    const m = materials.get(materialOf.get(id));
    if (!m) return faceMat;
    let mat = bodyMats.get(id);
    if (!mat) {
      mat = new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      mat.onBeforeCompile = shade(true);
      mat.customProgramCacheKey = () => 'own';
      mat.clippingPlanes = section.plane ? [section.plane] : null;
      bodyMats.set(id, mat);
    }
    mat.color.set(m.color);
    Object.assign(mat, { roughness: m.roughness, metalness: m.metalness, ior: m.ior, clearcoat: m.clearcoat, clearcoatRoughness: m.clearcoatRoughness, sheen: m.sheen, sheenRoughness: m.sheenRoughness, iridescence: m.iridescence, transmission: m.transmission, thickness: m.thickness });
    mat.sheenColor.set(m.sheenColor);
    mat.userData.opacity = m.opacity;
    return mat;
  }
  /** Every face material bodies use now. */
  const faceMats = () => [faceMat, ...bodyMats.values()];
  // Render mode lights the faces with an environment instead of the shader; the environments are
  // small scenes turned into reflection maps, so no image files are needed.
  let pmrem = null;
  const envMaps = {};
  function environmentMap(id) {
    if (envMaps[id]) return envMaps[id];
    if (id === 'hdr') return environmentMap('studio');
    pmrem ??= new THREE.PMREMGenerator(renderer);
    let room;
    if (id === 'studio') room = new RoomEnvironment();
    else {
      room = new THREE.Scene();
      const sky = id === 'sky';
      room.background = new THREE.Color(sky ? 0x8fb4d9 : 0x101012);
      const light = (w, h, x, y, z, k = 6) => {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k), side: THREE.DoubleSide }));
        p.position.set(x, y, z);
        p.lookAt(0, 0, 0);
        room.add(p);
      };
      if (sky) { light(40, 40, 0, 12, 0, 3); light(60, 6, 0, -8, 0, 0.4); }
      else if (id === 'stripes') for (let i = -4; i <= 4; i++) light(0.6, 14, 6 * Math.sin(i * 0.35), 0, 6 * Math.cos(i * 0.35), 8);
      else { light(4, 4, -5, 4, 5, 9); light(6, 6, 6, 1, 4, 3); light(3, 6, 0, 3, -6, 7); }
    }
    envMaps[id] = pmrem.fromScene(room, 0.02).texture;
    return envMaps[id];
  }
  // Your own matcap (kept for next time in this browser or app) and HDR environment (this session).
  let matcapUrl = null, hdrName = '';
  function useMatcap(url) {
    return new Promise((ok, fail) => new THREE.TextureLoader().load(url, t => {
      t.colorSpace = THREE.NoColorSpace;   // shown as drawn: the shader writes display colours
      shadeU.matcap.value.dispose();
      shadeU.matcap.value = t;
      matcapUrl = url;
      ok();
    }, undefined, () => fail(new Error('that image could not be read'))));
  }
  try { const kept = localStorage.getItem('w3d-matcap'); if (kept) useMatcap(kept).catch(() => {}); } catch { /* no storage */ }
  async function loadHdr(file) {
    const exr = /\.exr$/i.test(file.name);
    const url = URL.createObjectURL(file);
    try {
      const tex = await (exr ? new EXRLoader() : new HDRLoader()).loadAsync(url);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      pmrem ??= new THREE.PMREMGenerator(renderer);
      envMaps.hdr?.dispose();
      envMaps.hdr = pmrem.fromEquirectangular(tex).texture;
      tex.dispose();
      hdrName = file.name;
    } catch { throw new Error(`${file.name} could not be read as an ${exr ? 'EXR' : 'HDR'} image`); }
    finally { URL.revokeObjectURL(url); }
  }
  // Ambient occlusion: the view drawn into a linear buffer, darkened in creases by ground-truth AO,
  // then turned into screen colours.
  let composer = null, aoCamera = null, aoRadius = 0;
  function renderAO() {
    const w = canvas.width, h = canvas.height;
    // GTAO is built for one kind of camera; switching between perspective and orthographic rebuilds it.
    if (composer && aoCamera !== camera) { composer.passes.forEach(p => p.dispose?.()); composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); composer = null; }
    if (!composer) {
      const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
      composer = new EffectComposer(renderer, target);
      composer.setPixelRatio(1);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(new GTAOPass(scene, camera, w, h));
      composer.addPass(new OutputPass());
      aoCamera = camera;
      aoRadius = 0;
    }
    if (composer.renderTarget1.width !== w || composer.renderTarget1.height !== h) composer.setSize(w, h);
    // The darkening reaches a few percent of the view across, so it reads the same at any zoom.
    const across = camera.isOrthographicCamera ? (camera.top - camera.bottom) / camera.zoom : camera.position.distanceTo(controls.target);
    const radius = 0.04 * across;
    if (Math.abs(radius - aoRadius) > 0.01 * radius) { composer.passes[1].updateGtaoMaterial({ radius, thickness: radius, distanceExponent: 1, scale: 1 }); aoRadius = radius; }
    composer.render();
  }

  function applyView() {
    const custom = view.shader === 'custom' && matcapUrl;
    const sh = custom ? { id: 'custom', name: 'My matcap', mode: 14 } : shader(view.shader);
    shadeU.mode.value = view.render ? -1 : sh.mode;
    shadeU.pull.value.copy(cplane.normal);
    shadeU.stripes.value = shaderOpts.stripes;
    shadeU.draftSin.value = Math.sin(shaderOpts.draft * DEG);
    shadeU.spacing.value = shaderOpts.spacing;
    shadeU.bend.value = 1 / shaderOpts.radius;
    scene.environment = view.render ? environmentMap(view.environment) : null;
    scene.environmentIntensity = view.envIntensity;
    scene.environmentRotation.set(0, view.envRotation * DEG, 0);
    for (const m of faceMats()) {
      // Transparent materials show at half strength outside render mode, as Plasticity does.
      const own = m.userData.opacity ?? 1, opacity = view.xray ? 0.25 : own < 1 ? (view.render ? own : 0.5) : 1;
      m.transparent = opacity < 1;
      m.opacity = opacity;
      m.depthWrite = opacity === 1;
      m.colorWrite = view.faces;
      m.needsUpdate = true;
    }
    for (const b of $$('[data-toggle]')) b.setAttribute('aria-pressed', view[b.dataset.toggle]);
    for (const b of $$('[data-shader]')) b.setAttribute('aria-pressed', !view.render && b.dataset.shader === sh.id);
    for (const b of $$('[data-env]')) b.setAttribute('aria-pressed', b.dataset.env === view.environment);
    $('matcap-custom').hidden = !matcapUrl;
    $('matcap-custom').setAttribute('aria-pressed', String(!view.render && !!custom));
    $('hdr-custom').hidden = !envMaps.hdr;
    $('hdr-custom').setAttribute('aria-pressed', String(view.environment === 'hdr'));
    if (envMaps.hdr) $('hdr-custom').title = `Your HDR environment: ${hdrName}`;
    $('render-options').hidden = !view.render;
    const opt = !view.render && sh.option ? SHADER_OPTIONS[sh.option] : null;
    if (composer) composer.passes[1].enabled = view.ao;
    $('shader-option').hidden = !opt;
    if (opt) { $('shader-option-label').textContent = opt.label; $('shader-option-value').textContent = shaderOpts[sh.option]; }
    $('shader-name').textContent = view.render ? 'RENDER' : sh.name.toUpperCase();
    scene.traverse(o => { if (o.userData.bodyEdges) o.visible = view.edges; });
    curveGroup.visible = view.curves;
    drawCombs();
  }

  function meshOf(body, faces = faceMat, edges = edgeMat) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(body.positions, 3));
    g.setIndex(body.indices);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, faces);
    const pts = [], segEdge = [];
    body.edges.forEach((e, n) => {
      for (let i = 3; i < e.length; i += 3) { pts.push(e[i - 3], e[i - 2], e[i - 1], e[i], e[i + 1], e[i + 2]); segEdge.push(n); }
    });
    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), edges);
    lines.userData = { bodyEdges: edges === edgeMat, segEdge }; // segment index → edge number, for picking edges
    lines.visible = edges !== edgeMat || view.edges;
    mesh.add(lines);
    mesh.userData = { id: body.id, faceIds: body.faceIds, facePlanes: body.facePlanes, edges: body.edges, lines };
    return mesh;
  }
  const dispose = obj => { obj.traverse(o => o.geometry?.dispose()); obj.removeFromParent(); };

  const bodies = new THREE.Group();
  scene.add(bodies);
  let current = [];
  let org = new Organise();   // hidden, locked, isolated, grouped
  const sel = new Selection();
  const bodyMesh = id => bodies.children.find(m => m.userData.id === id);
  const bodyOf = id => current.find(b => b.id === id);
  const shownMeshes = () => bodies.children.filter(m => org.shows(m.userData.id));

  function showScene(list) {
    // The selection is kept as refs across the change and turned back into the new numbers.
    const saved = sel.toRefs(current);
    // Curvature combs follow their edge or face through the change too.
    const combRefs = surfaceCombs.map(c => ({ ...c, ref: current.find(b => b.id === c.body)?.[c.face === undefined ? 'edgeRefs' : 'faceRefs']?.[c.face ?? c.n] }));
    surfaceCombs = combRefs.flatMap(({ body, face, ref, hidden }) => {
      const n = ref === undefined ? -1 : list.find(b => b.id === body)?.[face === undefined ? 'edgeRefs' : 'faceRefs']?.indexOf(ref) ?? -1;
      return n < 0 ? [] : [face === undefined ? { body, n, teeth: null, hidden } : { body, face: n, runs: null, hidden }];
    });
    refreshSurfaceCombs();
    current = list;
    sel.fromRefs(saved, list);
    org.prune(list.map(b => b.id));
    renderIsolated();
    for (const m of [...bodies.children]) dispose(m);
    for (const id of [...materialOf.keys()]) if (typeof id === 'number' && !list.some(b => b.id === id)) { materialOf.delete(id); bodyMats.get(id)?.dispose(); bodyMats.delete(id); }
    for (const b of list) {
      const m = meshOf(b, faceMatFor(b.id));
      m.visible = org.shows(b.id);
      bodies.add(m);
    }
    renderTotals();
    $('export').disabled = list.length === 0;
    hover = null;
    selectionChanged({ quiet: true });
    bridgeOutline();
    if (shownPoints.faces.size) refreshShownPoints(list);
    drawInstances();
    return loadCurves();
  }

  // --- drawn curves and their regions ----------------------------------------
  // A curve lies in a plane { origin, x, normal } (viewport coordinates) with 2D points in it,
  // y = normal × x. A closed one bounds a region, drawn as a faint fill that face mode can pick.
  const curveGroup = new THREE.Group();
  scene.add(curveGroup);
  let curveList = [];
  const curveMat = {
    normal: new THREE.LineBasicMaterial({ color: 0x9a968c }),
    hover: new THREE.LineBasicMaterial({ color: 0xffffff }),
    selected: new THREE.LineBasicMaterial({ color: COLORS.accent }),
  };
  const regionLook = opacity => new THREE.MeshBasicMaterial({ color: COLORS.ink, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const regionMat = { normal: regionLook(0.04), hover: regionLook(0.12), selected: Object.assign(regionLook(0.3), { color: new THREE.Color(COLORS.accent) }) };
  function curveFrame(c) {
    const n = new THREE.Vector3(...c.normal).normalize();
    const x = new THREE.Vector3(...c.x).projectOnPlane(n).normalize();
    return { o: new THREE.Vector3(...c.origin), x, y: new THREE.Vector3().crossVectors(n, x), n };
  }
  // A spiral's points carry their height up the normal as z.
  const lift = (f, p, h = 0) => f.o.clone().addScaledVector(f.x, p.x).addScaledVector(f.y, p.y).addScaledVector(f.n, h + (p.z ?? 0));
  const curve2d = c => c.kind === 'circle' ? new THREE.Path().absarc(c.center[0], c.center[1], c.radius, 0, Math.PI * 2).getPoints(96).slice(0, -1)
    : c.kind === 'arc' ? (arcPoints(c.start, c.mid, c.end, 48) ?? [c.start, c.end]).map(p => new THREE.Vector2(...p))
    : c.kind === 'spline' ? (c.samples ?? splinePreview(c.points, c.closed)).slice(0, c.closed ? -1 : undefined).map(p => new THREE.Vector2(...p))
    : c.kind === 'cv' ? cvPoints(c.points, !!c.closed, 96).map(p => new THREE.Vector2(...p))
    : c.kind === 'ellipse' ? ellipsePoints(c.center, c.major, c.minor, 96).map(p => new THREE.Vector2(...p))
    : c.kind === 'contour' ? contour2d(c)
    : c.kind === 'spiral' ? helixPoints(c, 48).map(p => new THREE.Vector3(...p))
    : c.kind === 'nurbs' ? nurbsPoints(c).slice(0, nurbsLoop(c) ? -1 : undefined).map(p => new THREE.Vector3(...p))
    : c.points.map(p => new THREE.Vector2(...p));
  /** A joined contour's points: the kernel's samples, or its pieces one after another. */
  function contour2d(c) {
    const pts = c.samples ? c.samples.map(p => new THREE.Vector2(...p)) : c.pieces.flatMap((p, i) => curve2d(p).slice(i ? 1 : 0));
    return isClosed(c) && pts.length > 1 && pts[0].distanceTo(pts.at(-1)) < 1e-6 ? pts.slice(0, -1) : pts;
  }
  const isClosed = c => c.kind === 'circle' || c.kind === 'ellipse' || (c.kind === 'contour' ? loops(c.pieces) : c.kind === 'nurbs' ? nurbsLoop(c) : c.kind !== 'arc' && c.closed && c.points.length >= 3);
  // Control-point curves draw from their control points with the same B-spline the kernels make.
  const curveName = c => ({ circle: 'CIRCLE', arc: 'ARC', spline: 'SPLINE', cv: 'CV CURVE', ellipse: 'ELLIPSE', contour: 'CONTOUR', spiral: 'SPIRAL', nurbs: 'NURBS CURVE' })[c.kind] ?? (!c.closed ? 'LINE' : c.points.length === 4 ? 'RECTANGLE' : 'POLYGON');
  /** A spline through the points for drawing before the kernel has made it (the kernel's own fit
   * is close to this chordal Catmull-Rom curve, not the same). */
  function splinePreview(points, closed) {
    if (points.length < 2) return points;
    const c = new THREE.CatmullRomCurve3(points.map(([u, v]) => new THREE.Vector3(u, v, 0)), closed, 'chordal');
    return c.getPoints(16 * points.length).map(p => [p.x, p.y]);
  }
  // Plasticity's Toggle Curvature: a comb on every curve, teeth on the outside of each bend and as long as
  // the curvature is strong, joined by an envelope. One scale for all curves, so they compare.
  const combGroup = new THREE.Group();
  scene.add(combGroup);
  const combMat = new THREE.LineBasicMaterial({ color: 0x6cbf5f, transparent: true, opacity: 0.7, depthTest: false });
  const combScale = () => Number($('comb-scale').value) || 1;
  function drawCombs() {
    drawSurfaceCombs();
    for (const o of [...combGroup.children]) dispose(o);
    if (!view.curvature || !curveList.length) return;
    const combs = curveList.filter(c => c.kind !== 'spiral' && c.kind !== 'nurbs').map(c => { try { return { c, comb: curvatureComb(c) }; } catch { return null; } }).filter(Boolean);
    const kMax = Math.max(1e-12, ...combs.flatMap(x => x.comb.map(t => t.k)));
    const box = new THREE.Box3();
    for (const o of curveGroup.children) box.expandByObject(o);
    const scale = combScale() * 0.25 * box.getSize(new THREE.Vector3()).length() / kMax;
    for (const { c, comb } of combs) {
      const f = curveFrame(c), at = (p, h = 0.04) => lift(f, { x: p[0], y: p[1] }, h);
      const teeth = [], envelope = [];
      for (const t of comb) {
        const tip = [t.at[0] + t.dir[0] * t.k * scale, t.at[1] + t.dir[1] * t.k * scale];
        teeth.push(at(t.at), at(tip));
        envelope.push(at(tip));
      }
      const tl = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(teeth), combMat), el = new THREE.Line(new THREE.BufferGeometry().setFromPoints(envelope), combMat);
      tl.renderOrder = el.renderOrder = 11;
      combGroup.add(tl, el);
    }
  }

  // Plasticity's Toggle Surface Curvature: the same combs on the edges of bodies, toggled edge by
  // edge, and on faces along isoparams each way. Each keeps its edge's or face's number and is read
  // again when the body changes. An edge's entry has `teeth`, a face's `runs` (one list per piece).
  // Fillet's limit points (L): a dot on the edge where the round stops.
  const limitMarks = new THREE.Group();
  scene.add(limitMarks);
  let surfaceCombs = [];
  const surfaceCombGroup = new THREE.Group();
  scene.add(surfaceCombGroup);
  function drawSurfaceCombs() {
    for (const o of [...surfaceCombGroup.children]) dispose(o);
    const shown = surfaceCombs.filter(c => (c.teeth || c.runs) && !c.hidden && org.shows(c.body));
    if (!shown.length) return;
    const lines = shown.flatMap(c => c.runs ?? [c.teeth]);
    const kMax = Math.max(1e-12, ...lines.flatMap(l => l.map(t => t.k)));
    const box = new THREE.Box3();
    for (const l of lines) for (const t of l) box.expandByPoint(new THREE.Vector3(...t.at));
    for (const m of bodies.children) if (shown.some(c => c.body === m.userData.id)) box.expandByObject(m);
    const scale = combScale() * 0.25 * box.getSize(new THREE.Vector3()).length() / kMax;
    for (const line of lines) {
      const teeth = [], envelope = [];
      for (const t of line) {
        const at = new THREE.Vector3(...t.at), tip = at.clone().addScaledVector(new THREE.Vector3(...t.dir), t.k * scale);
        teeth.push(at, tip);
        envelope.push(tip);
      }
      const tl = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(teeth), combMat), el = new THREE.Line(new THREE.BufferGeometry().setFromPoints(envelope), combMat);
      tl.renderOrder = el.renderOrder = 11;
      surfaceCombGroup.add(tl, el);
    }
  }
  /** Fetch the teeth of every surface comb again, after the bodies changed. */
  async function refreshSurfaceCombs() {
    if (!surfaceCombs.length) return drawSurfaceCombs();
    const list = surfaceCombs;
    await Promise.all(list.map(async c => {
      try {
        if (c.face === undefined) c.teeth = await backend.edgeCurvature({ body: c.body, edge: c.n });
        else c.runs = await faceCombs(c.body, c.face);
      } catch { c.teeth = c.runs = null; }
    }));
    if (list === surfaceCombs) { surfaceCombs = list.filter(c => c.teeth || c.runs); drawSurfaceCombs(); renderOutliner(); }
  }
  /** Comb teeth along isoparams of a face, cut to the face, one list per piece. */
  async function faceCombs(id, face) {
    const b = bodyOf(id);
    if (!b) return null;
    const { positions: p, indices: ix, faceIds } = b, tris = [], v = i => [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
    for (let t = 0; t < faceIds.length; t++) if (faceIds[t] === face) tris.push([v(ix[3 * t]), v(ix[3 * t + 1]), v(ix[3 * t + 2])]);
    if (!tris.length) return null;
    const lines = isoLines(5, 96);
    const { points } = await backend.faceUvn({ body: id, face, map: true, points: lines.flat() });
    const box = new THREE.Box3().setFromPoints(tris.flat().map(q => new THREE.Vector3(...q)));
    // Display triangles stand off a curved surface by up to their chord error.
    const tol = Math.max(0.05, 0.01 * box.getSize(new THREE.Vector3()).length());
    let k = 0;
    return lines.flatMap(l => onFace(l.map(() => points[k++]), tris, tol)).map(combTeeth);
  }
  async function toggleSurfaceCurvature() {
    if (!backend.edgeCurvature) return toast('SURFACE CURVATURE IS NOT IN THIS BUILD YET');
    const edges = sel.list('edge'), faces = backend.faceUvn ? sel.list('face') : [];
    if (!edges.length && !faces.length) {
      if (!surfaceCombs.length) return toast('SELECT THE EDGES OR FACES TO SHOW CURVATURE ON');
      surfaceCombs = [];
      drawSurfaceCombs();
      renderOutliner();
      return toast('SURFACE CURVATURE OFF');
    }
    const same = (c, x) => c.body === x.body && (x.kind === 'face' ? c.face === x.n : c.face === undefined && c.n === x.n);
    const picked = [...edges, ...faces], on = c => picked.some(x => same(c, x));
    if (picked.every(x => surfaceCombs.some(c => same(c, x)))) surfaceCombs = surfaceCombs.filter(c => !on(c));
    else surfaceCombs = [...surfaceCombs.filter(c => !on(c)), ...edges.map(e => ({ body: e.body, n: e.n, teeth: null })), ...faces.map(f => ({ body: f.body, face: f.n, runs: null }))];
    await refreshSurfaceCombs();
    const k = Math.max(0, ...surfaceCombs.filter(on).flatMap(c => (c.runs ?? [c.teeth]).flat().map(t => t.k)));
    const what = [edges.length && `${edges.length} EDGE${edges.length > 1 ? 'S' : ''}`, faces.length && `${faces.length} FACE${faces.length > 1 ? 'S' : ''}`].filter(Boolean).join(' AND ');
    toast(surfaceCombs.some(on) ? `CURVATURE ON ${what}${k > 0 ? ` · TIGHTEST RADIUS ${(1 / k).toFixed(3)} MM` : ' · FLAT'}` : 'SURFACE CURVATURE OFF');
  }

  async function loadCurves() {
    curveList = backend.curves ? await backend.curves() : [];
    sel.keepCurves(curveList.map(c => c.id));
    for (const k of [...materialOf.keys()]) if (typeof k === 'string' && !curveById(curveKeyId(k))) materialOf.delete(k);
    for (const id of [...shownPoints.curves]) if (!curveById(id)) shownPoints.curves.delete(id);
    paintShownPoints();
    for (const o of [...curveGroup.children]) dispose(o);
    for (const c of curveList) {
      const f = curveFrame(c), pts = curve2d(c);
      const line = new (isClosed(c) ? THREE.LineLoop : THREE.Line)(new THREE.BufferGeometry().setFromPoints(pts.map(p => lift(f, p, 0.02))), curveMat.normal);
      line.userData = { curve: c.id };
      line.renderOrder = 9;
      curveGroup.add(line);
      if (!isClosed(c)) continue;
      const g = new THREE.ShapeGeometry(new THREE.Shape(pts), 1);
      g.applyMatrix4(new THREE.Matrix4().makeBasis(f.x, f.y, f.n).setPosition(lift(f, { x: 0, y: 0 }, 0.02)));
      const m = new THREE.Mesh(g, regionMat.normal);
      m.userData = { region: c.id };
      m.renderOrder = 7;
      curveGroup.add(m);
    }
    drawOverlays();
    drawInstances();
    renderOutliner();
    drawCombs();
  }
  // Set Material on curves: their key in materialOf, and a line of the material's colour.
  const curveKey = id => `c:${id}`, curveKeyId = k => Number(k.slice(2));
  const curveLineMats = new Map();   // material id -> THREE line material
  function curveLineMat(id) {
    const m = materials.get(materialOf.get(curveKey(id)));
    if (!m) return curveMat.normal;
    let mat = curveLineMats.get(m.id);
    if (!mat) curveLineMats.set(m.id, mat = new THREE.LineBasicMaterial());
    mat.color.set(m.color);
    return mat;
  }
  /** Colour curves and regions for hover and selection. */
  function paintCurves() {
    const is = (kind, id) => sel.has({ kind, id }) ? 'selected' : hover?.kind === kind && hover.id === id ? 'hover' : 'normal';
    for (const o of curveGroup.children) {
      if (o.userData.curve !== undefined) {
        const state = is('curve', o.userData.curve) === 'normal' && sel.has({ kind: 'region', id: o.userData.curve }) ? 'selected' : is('curve', o.userData.curve);
        o.material = state === 'normal' ? curveLineMat(o.userData.curve) : curveMat[state];
      }
      else if (o.userData.region !== undefined) o.material = regionMat[is('region', o.userData.region)];
    }
    paintVertices();
  }
  // Curve vertices (point mode): every vertex a small grey dot, the hovered one white, selected ones orange.
  const vertexDots = new THREE.Group();
  const vertexMat = Object.fromEntries(Object.entries({ normal: [0x9a968c, 5], hover: [0xffffff, 9], selected: [COLORS.accent, 9] })
    .map(([k, [color, size]]) => [k, new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false })]));
  scene.add(vertexDots);
  /** Each shown curve's vertices in model space: [{ id, n, at }]. */
  function vertexList() {
    const out = [];
    for (const c of curveList) {
      const f = curveFrame(c);
      curveVertices(c).forEach(([x, y], n) => out.push({ id: c.id, n, at: lift(f, { x, y }, 0.02) }));
    }
    return out;
  }
  // Toggle Points (Plasticity's): control points kept on show for the curves and faces it was run
  // on: a curve's vertices (a control point curve's or NURBS curve's control polygon), a face's
  // control net. Faces are kept per body, 'all' for a whole solid.
  const shownPoints = { curves: new Set(), faces: new Map() };
  let facePoleCache = new Map();
  // Move's Proportional and Mirror options for face control points.
  const poleOpts = { mode: 'none', fu: 2, fv: 2, mirror: 'none' };
  const pointsGroup = new THREE.Group();
  scene.add(pointsGroup);
  const netLine = new THREE.LineBasicMaterial({ color: 0x9a968c, transparent: true, opacity: 0.7, depthTest: false });
  const facesShown = (body, n) => { const w = shownPoints.faces.get(body); return w === 'all' || !!w?.has(n); };
  function paintShownPoints() {
    for (const o of [...pointsGroup.children]) dispose(o);
    const dots = [], segs = [];
    for (const id of shownPoints.curves) {
      const c = curveById(id);
      if (!c) continue;
      const f = curveFrame(c);
      const net = c.kind === 'cv' ? c.points.map(([x, y]) => lift(f, { x, y }, 0.03)) : c.kind === 'nurbs' ? c.poles.map(([x, y, z]) => lift(f, { x, y, z }, 0.03)) : null;
      if (!net) { dots.push(...curveVertices(c).map(([x, y]) => lift(f, { x, y }, 0.03))); continue; }
      const run = c.kind === 'cv' && c.closed ? [...net, net[0]] : net;
      for (let i = 1; i < run.length; i++) segs.push(run[i - 1], run[i]);
      dots.push(...net);
    }
    // Face nets; picked points orange, the hovered one white. A command moving them shows them moved.
    const lit = { hover: [], selected: [] };
    for (const [body, which] of shownPoints.faces) {
      const all = facePoleCache.get(body);
      if (!all || !org.shows(body)) continue;
      for (const n of which === 'all' ? all.keys() : which) {
        const P = (cmd?.poleRows?.get(`${body}:${n}`) ?? all[n] ?? []).map(r => r.map(q => new THREE.Vector3(...q)));
        if (!P.length) continue;
        for (const r of P) for (let j = 1; j < r.length; j++) segs.push(r[j - 1], r[j]);
        for (let j = 0; j < P[0].length; j++) for (let i = 1; i < P.length; i++) segs.push(P[i - 1][j], P[i][j]);
        P.flat().forEach((q, k) => {
          const it = { kind: 'pole', body, face: n, n: k };
          if (sel.has(it)) lit.selected.push(q);
          else if (hover?.kind === 'pole' && hover.body === body && hover.face === n && hover.n === k) lit.hover.push(q);
          else dots.push(q);
        });
      }
    }
    if (segs.length) { const l = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segs), netLine); l.renderOrder = 11; pointsGroup.add(l); }
    if (dots.length) { const d = new THREE.Points(new THREE.BufferGeometry().setFromPoints(dots), vertexMat.normal); d.renderOrder = 11; pointsGroup.add(d); }
    for (const [k, pts] of Object.entries(lit)) if (pts.length) { const d = new THREE.Points(new THREE.BufferGeometry().setFromPoints(pts), vertexMat[k]); d.renderOrder = 12; pointsGroup.add(d); }
  }
  /** The shown faces' control points: [{ body, face, n, at }]. */
  function poleList() {
    const out = [];
    for (const [body, which] of shownPoints.faces) {
      const all = facePoleCache.get(body);
      if (!all || !org.shows(body)) continue;
      for (const face of which === 'all' ? all.keys() : which) (all[face] ?? []).flat().forEach((q, n) => out.push({ body, face, n, at: new THREE.Vector3(...q) }));
    }
    return out;
  }
  /**
   * Plasticity's CV hull loops (Alt+click a hull): the shown control net line within a few pixels
   * of a canvas point (off its points), as the points of the whole row or column it runs along. A
   * face's net is rows of points; a line between two rows belongs to a column. A control-point
   * curve's hull gives all its points. Null when no hull line is near.
   */
  function hullLoopAt(p, px = 6) {
    let best = null, bestD = px;
    const seg = (a, b) => {
      const s = screenOf(a), t = screenOf(b);
      if (s.behind || t.behind) return Infinity;
      const dx = t.x - s.x, dy = t.y - s.y, L = dx * dx + dy * dy;
      const k = L ? Math.max(0, Math.min(1, ((p.x - s.x) * dx + (p.y - s.y) * dy) / L)) : 0;
      return Math.hypot(s.x + dx * k - p.x, s.y + dy * k - p.y);
    };
    for (const [body, which] of shownPoints.faces) {
      const all = facePoleCache.get(body);
      if (!all || !org.shows(body)) continue;
      for (const face of which === 'all' ? all.keys() : which) {
        const P = (all[face] ?? []).map(r => r.map(q => new THREE.Vector3(...q)));
        if (!P.length) continue;
        const cols = P[0].length;
        P.forEach((r, i) => { for (let j = 1; j < r.length; j++) { const d = seg(r[j - 1], r[j]); if (d < bestD) { bestD = d; best = r.map((_, k) => ({ kind: 'pole', body, face, n: i * cols + k })); } } });
        for (let j = 0; j < cols; j++) for (let i = 1; i < P.length; i++) { const d = seg(P[i - 1][j], P[i][j]); if (d < bestD) { bestD = d; best = P.map((_, k) => ({ kind: 'pole', body, face, n: k * cols + j })); } }
      }
    }
    for (const id of shownPoints.curves) {
      const c = curveById(id);
      if (!c || (c.kind !== 'cv' && c.kind !== 'nurbs')) continue;
      const f = curveFrame(c), net = c.kind === 'cv' ? c.points.map(([x, y]) => lift(f, { x, y })) : c.poles.map(([x, y, z]) => lift(f, { x, y, z }));
      const run = c.kind === 'cv' && c.closed ? [...net, net[0]] : net;
      for (let i = 1; i < run.length; i++) { const d = seg(run[i - 1], run[i]); if (d < bestD) { bestD = d; best = net.map((_, n) => ({ kind: 'vertex', id, n })); } }
    }
    return best;
  }
  /** A face's control point (as poleList gives them) by face and number. */
  const poleOf = it => { const q = facePoleCache.get(it.body)?.[it.face]?.flat()[it.n]; return q && new THREE.Vector3(...q); };
  /** The shown face control point within a few pixels of a canvas point, nearest first. */
  function poleAt(p, px = 7) {
    let best = null, bestD = px;
    for (const v of poleList()) {
      const s = screenOf(v.at);
      if (s.behind) continue;
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d <= bestD) { bestD = d; best = { kind: 'pole', body: v.body, face: v.face, n: v.n, point: v.at.clone() }; }
    }
    return best;
  }
  /** The face in `nets` whose control net (rows of [x, y, z]) is nearest `net`, point by point; null without one. */
  function nearestNet(net, nets) {
    if (!net?.length) return null;
    const flat = net.flat();
    let best = null, bestD = Infinity;
    nets.forEach((m, i) => {
      const q = m?.flat();
      if (!q || q.length !== flat.length || m.length !== net.length) return;
      let d = 0;
      for (let k = 0; k < q.length; k++) d += Math.hypot(q[k][0] - flat[k][0], q[k][1] - flat[k][1], q[k][2] - flat[k][2]);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }
  /** After the bodies change: the shown faces' control points again, gone bodies dropped. */
  async function refreshShownPoints(list) {
    for (const body of [...shownPoints.faces.keys()]) if (!list.some(b => b.id === body)) shownPoints.faces.delete(body);
    const cache = new Map();
    for (const body of shownPoints.faces.keys()) { try { cache.set(body, await backend.facePoles({ body })); } catch { shownPoints.faces.delete(body); } }
    // A rebuilt body numbers its faces afresh: follow each shown face to the face whose control
    // net is nearest its old one (a moved point changes only a few).
    for (const [body, which] of shownPoints.faces) {
      const was = facePoleCache.get(body), now = cache.get(body);
      if (which === 'all' || !was || !now) continue;
      shownPoints.faces.set(body, new Set([...which].map(n => nearestNet(was[n], now) ?? n)));
    }
    facePoleCache = cache;
    paintShownPoints();
  }
  async function togglePoints() {
    const curves = [...new Set([...sel.curves, ...sel.list('vertex').map(v => v.id)])].filter(curveById);
    const faces = sel.list('face'), solids = sel.solids.filter(b => org.shows(b));
    if (!curves.length && !faces.length && !solids.length) return toast('SELECT CURVES, FACES OR SOLIDS TO SHOW OR HIDE THEIR POINTS');
    if ((faces.length || solids.length) && !backend.facePoles) return toast('FACE POINTS ARE NOT IN THIS BUILD YET');
    // One switch for the whole selection: everything already showing hides, otherwise all show.
    const show = ![...curves.map(id => shownPoints.curves.has(id)), ...faces.map(f => facesShown(f.body, f.n)), ...solids.map(b => shownPoints.faces.get(b) === 'all')].every(Boolean);
    try {
      for (const body of new Set([...faces.map(f => f.body), ...solids])) if (!facePoleCache.has(body)) facePoleCache.set(body, await backend.facePoles({ body }));
    } catch (e) { return toast(say(e)); }
    for (const id of curves) show ? shownPoints.curves.add(id) : shownPoints.curves.delete(id);
    for (const b of solids) show ? shownPoints.faces.set(b, 'all') : shownPoints.faces.delete(b);
    for (const { body, n } of faces) {
      let w = shownPoints.faces.get(body);
      if (w === 'all' && !show) w = new Set([...facePoleCache.get(body).keys()]);
      if (w === 'all') continue;
      w ??= new Set();
      show ? w.add(n) : w.delete(n);
      if (w.size) shownPoints.faces.set(body, w); else shownPoints.faces.delete(body);
    }
    paintShownPoints();
    const what = [curves.length && `${curves.length} CURVE${curves.length > 1 ? 'S' : ''}`, faces.length && `${faces.length} FACE${faces.length > 1 ? 'S' : ''}`, solids.length && `${solids.length} SOLID${solids.length > 1 ? 'S' : ''}`].filter(Boolean).join(' · ');
    toast(`POINTS ${show ? 'SHOWN' : 'HIDDEN'} · ${what}`);
  }
  // Which way curves run: a short arrow at each start, shown for a moment after Reverse Curve.
  const directionArrows = new THREE.Group();
  scene.add(directionArrows);
  let directionTimer = 0;
  function showDirection(ids) {
    for (const o of [...directionArrows.children]) { directionArrows.remove(o); o.dispose?.(); }
    clearTimeout(directionTimer);
    for (const id of ids) {
      const c = curveById(id);
      const pts = c && curve2d(c);
      if (!pts || pts.length < 2) continue;
      const f = curveFrame(c);
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
      const from = lift(f, pts[0], 0.03), to = lift(f, pts.find(p => p.distanceTo(pts[0]) > 1e-6) ?? pts[1], 0.03);
      const size = Math.min(Math.max(len * 0.12, 1), 20);
      const arrow = new THREE.ArrowHelper(to.sub(from).normalize(), from, size, COLORS.accent, size * 0.35, size * 0.2);
      arrow.renderOrder = 12;
      directionArrows.add(arrow);
    }
    directionTimer = setTimeout(() => { for (const o of [...directionArrows.children]) { directionArrows.remove(o); o.dispose?.(); } }, 2500);
  }
  function paintVertices() {
    for (const o of [...vertexDots.children]) dispose(o);
    if (shownPoints.faces.size) paintShownPoints();
    if (!sel.allows('point')) return;
    const look = v => sel.has({ kind: 'vertex', id: v.id, n: v.n }) ? 'selected' : hover?.kind === 'vertex' && hover.id === v.id && hover.n === v.n ? 'hover' : 'normal';
    // Grey dots only on curves in play (selected, hovered or with a vertex picked), so drawings stay clean.
    const live = new Set([...sel.list().filter(it => it.id !== undefined).map(it => it.id), ...(hover?.id !== undefined ? [hover.id] : [])]);
    const groups = { normal: [], hover: [], selected: [] };
    for (const v of vertexList()) { const k = look(v); if (k !== 'normal' || live.has(v.id)) groups[k].push(v.at); }
    for (const [k, pts] of Object.entries(groups)) {
      if (!pts.length) continue;
      const dots = new THREE.Points(new THREE.BufferGeometry().setFromPoints(pts), vertexMat[k]);
      dots.renderOrder = k === 'normal' ? 11 : 12;
      vertexDots.add(dots);
    }
  }
  /** The curve vertex within a few pixels of a canvas point, nearest first. */
  function vertexAt(p, px = 7) {
    let best = null, bestD = px;
    for (const v of vertexList()) {
      const s = screenOf(v.at);
      if (s.behind) continue;
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d <= bestD) { bestD = d; best = { kind: 'vertex', id: v.id, n: v.n, point: v.at.clone() }; }
    }
    return best;
  }
  /** The centre of a region, in the viewport. */
  function regionCentre(c) {
    const f = curveFrame(c);
    if (c.kind === 'circle' || c.kind === 'ellipse') return lift(f, new THREE.Vector2(...c.center));
    // The area centroid of the outline.
    const p = curve2d(c).map(q => [q.x, q.y]);
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < p.length; i++) {
      const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length], w = x0 * y1 - x1 * y0;
      a += w; cx += (x0 + x1) * w; cy += (y0 + y1) * w;
    }
    if (Math.abs(a) < 1e-12) return lift(f, { x: p.reduce((s, q) => s + q[0], 0) / p.length, y: p.reduce((s, q) => s + q[1], 0) / p.length });
    return lift(f, { x: cx / (3 * a), y: cy / (3 * a) });
  }

  /** The area-weighted centre of a face, from its display triangles. */
  function faceCentre(body, face) {
    const { positions: p, indices: ix, faceIds } = body;
    const c = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
    let area = 0;
    for (let t = 0; t < faceIds.length; t++) {
      if (faceIds[t] !== face) continue;
      a.fromArray(p, ix[3 * t] * 3); b.fromArray(p, ix[3 * t + 1] * 3); d.fromArray(p, ix[3 * t + 2] * 3);
      const w = b.clone().sub(a).cross(d.clone().sub(a)).length() / 2;
      c.addScaledVector(a.add(b).add(d), w / 3);
      area += w;
    }
    return area > 0 ? c.divideScalar(area) : null;
  }

  // --- outliner and history -----------------------------------------------
  const history = [];   // committed steps, oldest first; `undone` counts how many from the end were undone
  let undone = 0;
  // What was selected when the command now finishing began: its sources, for Ctrl+T.
  let opSources = null, sourceAt = null, sourceSel = null, overlaysOff = false;
  const keepSources = () => { opSources = sel.list().map(it => ({ ...it })); };
  function record(text, id, tag = label(id)) {
    history.splice(history.length - undone, undone, { text, id, tag, sources: opSources ?? [] });
    undone = 0;
    sourceAt = null;
    renderHistory();
  }
  /**
   * Ctrl+T: select what the last operation was made from (the selection its command began with,
   * whatever of it still exists); again steps to the operation before, Ctrl+Shift+T forward.
   */
  function selectSources(dir) {
    const live = history.length - undone;
    const now = JSON.stringify(sel.list());
    const i = stepSources(history, live, now === sourceSel ? sourceAt : null, dir);
    if (i === null) return toast(dir < 0 ? 'NO EARLIER OPERATION WITH SOURCES' : 'NO LATER OPERATION WITH SOURCES');
    sourceAt = i;
    const there = history[i].sources.filter(it => it.kind === 'vertex' || it.kind === 'curve' || it.kind === 'region' ? !!curveById(it.id) : !!bodyOf(it.body));
    sel.clear();
    for (const it of there) sel.add(it);
    selectionChanged({ quiet: true });
    sourceSel = JSON.stringify(sel.list());
    const gone = history[i].sources.length - there.length;
    toast(`SOURCES OF ${history[i].text}${there.length ? ` · ${there.length} SELECTED` : ''}${gone ? ` · ${gone} NO LONGER THERE` : ''}`);
  }
  function renderOutliner() {
    const out = $('outliner');
    out.innerHTML = '<div class="group-title">▾ SOLIDS</div>';
    const ids = current.map(b => b.id);
    const solids = current.filter(b => !b.sheet), sheets = current.filter(b => b.sheet);
    const toggles = (shown, locked, off) => `<button class="dis" aria-pressed="${off}" aria-label="Disable or enable" title="${off ? 'Enable' : 'Disable: off the viewport and out of every command, for heavy scenes'}">${icon('disable')}</button><button class="lk" aria-pressed="${locked}" aria-label="Lock or unlock" title="${locked ? 'Unlock' : 'Lock'}">${icon(locked ? 'padlock' : 'unlock')}</button><button class="eye" aria-pressed="${shown}" aria-label="Show or hide">◉</button>`;
    const setDisabled = (list, off) => { org.setDisabled(list, off); organised(); renderOutliner(); renderTotals(); };
    const indent = depth => `padding-left: ${14 + 14 * depth}px`;
    const bodyRow = (b, depth) => {
      const row = document.createElement('div');
      const locked = org.locked.has(b.id), shown = !org.hidden.has(b.id), off = org.disabled.has(b.id);
      row.className = 'row-item' + (locked ? ' locked' : '') + (org.shows(b.id) ? '' : ' off') + (off ? ' disabled' : '');
      row.style = indent(depth);
      row.setAttribute('aria-current', sel.has({ kind: 'solid', body: b.id }));
      row.innerHTML = `<span class="sq"></span><span class="name">${b.sheet ? 'SHEET' : 'BODY'} ${b.id}</span><span class="tag">${label(b.id)}</span>${toggles(shown, locked, off)}`;
      row.onclick = e => {
        if (e.target.closest('.dis')) return setDisabled([b.id], !off);
        if (off) return toast('DISABLED · ENABLE TO SELECT');
        if (e.target.closest('.eye')) return setHidden([b.id], shown);
        if (e.target.closest('.lk')) { org.setLocked([b.id], !locked); return organised(); }
        if (!org.picks(b.id)) return toast(locked ? 'LOCKED · UNLOCK TO SELECT' : 'HIDDEN');
        applySelect({ kind: 'solid', body: b.id }, e.shiftKey ? 'add' : (e.ctrlKey || e.metaKey) ? 'remove' : 'replace');
        selectionChanged();
      };
      out.append(row);
    };
    // A group is a folder: its own groups, then its bodies. Clicking it selects everything in it.
    const folder = (g, depth) => {
      const all = org.allMembers(g.id, ids), shown = all.some(id => !org.hidden.has(id)), locked = all.length > 0 && all.every(id => org.locked.has(id));
      const off = all.length > 0 && all.every(id => org.disabled.has(id)), active = org.active === g.id;
      const row = document.createElement('div');
      row.className = 'row-item folder' + (all.length ? '' : ' empty-group') + (off ? ' disabled' : '') + (active ? ' active-collection' : '');
      row.style = indent(depth);
      row.setAttribute('aria-current', all.length > 0 && all.every(id => sel.has({ kind: 'solid', body: id })));
      row.innerHTML = `<span class="tw">${g.open ? '▾' : '▸'}</span><button class="act" aria-pressed="${active}" aria-label="Toggle active collection" title="${active ? 'The active collection: new bodies go in here. Click or double-click the row to stop' : 'Make this the active collection: new bodies go in here (or double-click the row)'}">${icon('folder')}</button><span class="name" title="Double-click to rename">${g.name}</span><span class="tag">${all.length}</span>${toggles(shown, locked, off)}`;
      const name = row.querySelector('.name');
      row.onclick = e => {
        if (name.isContentEditable) return;
        if (e.target.closest('.tw')) { g.open = !g.open; return renderOutliner(); }
        if (e.target.closest('.act')) { org.toggleActive(g.id); return renderOutliner(); }
        if (e.target.closest('.dis')) return setDisabled(all, !off);
        if (e.target.closest('.eye')) return setHidden(all, shown);
        if (e.target.closest('.lk')) { org.setLocked(all, !locked); return organised(); }
        const mod = e.shiftKey ? 'add' : (e.ctrlKey || e.metaKey) ? 'remove' : 'replace';
        if (mod === 'replace') sel.clear();
        for (const id of all.filter(id => org.picks(id))) mod === 'remove' ? sel.remove({ kind: 'solid', body: id }) : applySelect({ kind: 'solid', body: id }, 'add');
        selectionChanged();
      };
      name.ondblclick = e => {
        e.stopPropagation();
        name.contentEditable = 'true';
        name.focus();
        getSelection().selectAllChildren(name);
        const done = keep => { name.onblur = name.onkeydown = null; if (keep) org.rename(g.id, name.textContent); renderOutliner(); };
        name.onkeydown = k => { k.stopPropagation(); if (k.key === 'Enter') { k.preventDefault(); done(true); } else if (k.key === 'Escape') done(false); };
        name.onblur = () => done(true);
      };
      // Plasticity: double-clicking a group makes it the active collection (the name renames).
      row.ondblclick = e => { if (e.target.closest('button, .name')) return; org.toggleActive(g.id); renderOutliner(); };
      out.append(row);
      if (!g.open) return;
      for (const c of org.childGroups(g.id)) folder(c, depth + 1);
      for (const id of org.members(g.id, ids)) bodyRow(bodyOf(id), depth + 1);
    };
    for (const g of org.childGroups(null)) folder(g, 0);
    const loose = b => !org.groupOf.has(b.id);
    if (!solids.length && !org.groups.length) out.insertAdjacentHTML('beforeend', '<div class="empty">NO SOLIDS</div>');
    for (const b of solids.filter(loose)) bodyRow(b, 0);
    if (sheets.some(loose)) out.insertAdjacentHTML('beforeend', '<div class="group-title">▾ SHEETS</div>');
    for (const b of sheets.filter(loose)) bodyRow(b, 0);
    out.insertAdjacentHTML('beforeend', '<div class="group-title">▾ CURVES</div>');
    for (const c of curveList) {
      const row = document.createElement('div');
      row.className = 'row-item curve';
      row.setAttribute('aria-current', sel.has({ kind: 'curve', id: c.id }) || sel.has({ kind: 'region', id: c.id }));
      const look = { circle: 'circle', arc: 'arc3', spline: 'spline', cv: 'cv', ellipse: 'ellipse', contour: 'join', spiral: 'spiral', nurbs: 'project' }[c.kind] ?? (!c.closed ? 'line' : c.points.length === 4 ? 'rect' : 'polygon');
      row.innerHTML = `${icon(look)}<span class="name">${curveName(c)}</span><span class="tag">${curveLabel(c.id)}</span>`;
      row.onclick = e => { applySelect({ kind: 'curve', id: c.id }, modOf(e)); selectionChanged(); };
      out.append(row);
    }
    if (cmd?.id === 'pushpull' && cmd.at) out.insertAdjacentHTML('beforeend', `<div class="row-item curve"><span class="ln"></span><span>${profileKind === 'circle' ? 'CIRCLE' : 'RECT'}.001</span></div>`);
    else if (!curveList.length) out.insertAdjacentHTML('beforeend', '<div class="empty">NO CURVES</div>');
    if (instances.length) out.insertAdjacentHTML('beforeend', '<div class="group-title">▾ INSTANCES</div>');
    for (const n of instances) {
      const row = document.createElement('div');
      const gone = !masterOf(n);
      row.className = 'row-item curve' + (n.hidden || gone ? ' off' : '');
      row.setAttribute('aria-current', cmd?.id === 'instance' && cmd.instance === n.id);
      row.innerHTML = `${icon('instance')}<span class="name" title="${gone ? 'Its master is gone' : `An instance of ${masterLabel(n)}`}">${n.curve ? 'CURVE INSTANCE' : 'INSTANCE'}</span><span class="tag">${instanceLabel(n.id)}</span><button class="eye" aria-pressed="${!n.hidden}" aria-label="Show or hide">◉</button>`;
      row.onclick = async e => {
        if (e.target.closest('.eye')) { n.hidden = !n.hidden; drawInstances(); return renderOutliner(); }
        if (gone) return toast('ITS MASTER IS GONE');
        if (cmd) await finish();
        startInstance(n.id);
        renderOutliner();
      };
      out.append(row);
    }
    // Plasticity lists each curvature measurement under Measurements: an eye shows or hides it, a
    // click selects its edge or face, and × takes it off.
    if (surfaceCombs.length || view.curvature) out.insertAdjacentHTML('beforeend', '<div class="group-title">▾ MEASUREMENTS</div>');
    if (view.curvature) {
      const row = document.createElement('div');
      row.className = 'row-item curve measurement';
      row.innerHTML = `${icon('view-curvature')}<span class="name" title="Curvature combs on every curve (Toggle Curvature)">CURVATURE</span><span class="tag">CURVES</span><button class="eye" aria-pressed="true" aria-label="Hide">◉</button>`;
      row.onclick = () => { view.curvature = false; applyView(); renderOutliner(); };
      out.append(row);
    }
    for (const c of surfaceCombs) {
      const row = document.createElement('div');
      const item = c.face === undefined ? { kind: 'edge', body: c.body, n: c.n } : { kind: 'face', body: c.body, n: c.face };
      row.className = 'row-item curve measurement' + (c.hidden ? ' off' : '');
      row.setAttribute('aria-current', sel.has(item));
      row.innerHTML = `${icon('view-curvature')}<span class="name" title="Curvature of ${item.kind === 'edge' ? 'an edge' : 'a face'} of ${label(c.body)}">${item.kind.toUpperCase()} ${item.n}</span><span class="tag">${label(c.body)}</span><button class="eye" aria-pressed="${!c.hidden}" aria-label="Show or hide">◉</button><button class="drop" aria-label="Remove" title="Remove this measurement">${icon('delete')}</button>`;
      row.onclick = e => {
        if (e.target.closest('.eye')) { c.hidden = !c.hidden; drawSurfaceCombs(); return renderOutliner(); }
        if (e.target.closest('.drop')) { surfaceCombs = surfaceCombs.filter(x => x !== c); drawSurfaceCombs(); return renderOutliner(); }
        applySelect(item, modOf(e));
        selectionChanged();
      };
      out.append(row);
    }
    if (images.length) out.insertAdjacentHTML('beforeend', '<div class="group-title">▾ IMAGES</div>');
    for (const im of images) {
      const row = document.createElement('div');
      row.className = 'row-item curve' + (im.hidden ? ' off' : '');
      row.setAttribute('aria-current', cmd?.id === 'image' && cmd.image === im.id);
      row.innerHTML = `${icon('image')}<span class="name" title="${im.name.replace(/[<>&"]/g, '')}">IMAGE</span><span class="tag">${imageLabel(im.id)}</span><button class="eye" aria-pressed="${!im.hidden}" aria-label="Show or hide">◉</button>`;
      row.onclick = async e => {
        if (e.target.closest('.eye')) { im.hidden = !im.hidden; drawImages(); return renderOutliner(); }
        if (cmd) await finish();
        startImage(im.id);
        renderOutliner();
      };
      out.append(row);
    }
  }
  function renderHistory() {
    const live = history.length - undone;
    $('history-count').textContent = String(live).padStart(2, '0');
    $('history').innerHTML = history.length ? '' : '<div class="empty">NOTHING YET</div>';
    history.forEach((h, i) => {
      const row = document.createElement('div');
      row.className = 'row-item hist' + (i >= live ? ' undone' : '');
      row.innerHTML = `<span class="n">${String(i + 1).padStart(2, '0')}</span><span class="name">${h.text}</span><span class="tag">${h.tag}</span>`;
      $('history').append(row);
    });
    $('undo').disabled = live === 0;
    $('redo').disabled = undone === 0;
  }
  function tab(name) {
    $('tab-outliner').setAttribute('aria-selected', name === 'outliner');
    $('tab-history').setAttribute('aria-selected', name === 'history');
    $('outliner').hidden = name !== 'outliner';
    $('history').hidden = name !== 'history';
  }
  $('tab-outliner').onclick = () => tab('outliner');
  $('tab-history').onclick = () => tab('history');

  // --- construction plane ---------------------------------------------------
  // Where sketches go when they land on no face; the grid is drawn on it. Plasticity: Space takes
  // it from the selected face and turns the view to face it, Shift+Space keeps the view, Ctrl+Space
  // makes one facing the view through the origin, and Num7/1/3 bring XY, XZ and YZ with their views.
  const UP = new THREE.Vector3(0, 1, 0);
  const cplane = { origin: new THREE.Vector3(), normal: UP.clone(), name: 'XY' };
  // Move, Rotate and Scale keep their orientation and pivot choices from one use to the next.
  const xfPrefs = { orient: 'world', pivot: 'bbox' };
  const grid = new THREE.GridHelper(400, 40, COLORS.gridMajor, COLORS.grid);
  scene.add(grid);
  const planeOf = () => new THREE.Plane().setFromNormalAndCoplanarPoint(cplane.normal, cplane.origin);
  function setPlane({ origin, normal, name }) {
    cplane.origin.copy(origin);
    cplane.normal.copy(normal).normalize(); shadeU.pull.value.copy(cplane.normal);
    cplane.name = name;
    grid.position.copy(origin);
    grid.quaternion.setFromUnitVectors(UP, cplane.normal);
    $('plane').textContent = name;
    $('status-plane').textContent = name;
  }
  // --- reference images -----------------------------------------------------
  // Plasticity's reference images: pictures standing on the construction plane they were imported
  // on (see images.js). They live in the file's app state, not the kernel, and are not picked in
  // the viewport: the outliner lists them, and clicking one opens its panel.
  let images = [], nextImage = 1;
  const imageGroup = new THREE.Group();
  scene.add(imageGroup);
  const textures = new Map();
  const imageLabel = id => `I-${String(id).padStart(2, '0')}`;
  function drawImages() {
    for (const m of imageGroup.children) { m.geometry.dispose(); m.material.dispose(); }
    imageGroup.clear();
    for (const im of images) {
      if (im.hidden) continue;
      if (!textures.has(im.id)) {
        const t = new THREE.TextureLoader().load(im.src);
        t.colorSpace = THREE.SRGBColorSpace;
        textures.set(im.id, t);
      }
      const look = imageLook(im);
      const mat = new THREE.MeshBasicMaterial({ map: textures.get(im.id), transparent: look.transparent, opacity: look.opacity, depthTest: look.depthTest, depthWrite: look.depthWrite, side: look.double ? THREE.DoubleSide : THREE.FrontSide, toneMapped: false });
      // The picture lies flat in the plane: x along the plane's x, up the picture along its -z.
      const geo = new THREE.PlaneGeometry(im.width, im.width * im.aspect).rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.fromArray(im.origin);
      mesh.quaternion.fromArray(im.quaternion);
      mesh.renderOrder = look.order;
      imageGroup.add(mesh);
    }
  }
  const asDataUrl = blob => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => fail(new Error('that image could not be read')); r.readAsDataURL(blob); });
  const pictureSize = src => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok([i.naturalWidth, i.naturalHeight]); i.onerror = () => fail(new Error('that file is not a PNG or JPEG picture')); i.src = src; });
  /** A PNG or JPEG placed on the construction plane, 100 mm wide, centred on its origin. */
  async function importImage(blob, name) {
    const src = await asDataUrl(blob);
    if (!/^data:image\/(png|jpeg);base64,/.test(src)) throw new Error('reference images are PNG or JPEG pictures');
    const [w, h] = await pictureSize(src);
    if (!(w > 0 && h > 0)) throw new Error('that picture has no size');
    const im = newImage(nextImage++, name, src, h / w, { origin: cplane.origin.toArray(), quaternion: grid.quaternion.toArray() });
    images.push(im);
    drawImages();
    renderOutliner();
    toast(`IMAGE ${name.toUpperCase()} ON ${cplane.name} · SAVED WITH THE FILE`);
  }
  /** Plasticity's image appearance (M on an image): width, opacity, depth and culling, live. */
  function startImage(id) {
    const im = images.find(m => m.id === id);
    if (!im) return;
    const before = { ...im };
    const c = cmd = { id: 'image', image: id };
    lastTool = 'image';
    showTool('image');
    setState('none');
    setTarget(imageLabel(id));
    const show = () => {
      $('im-hint').textContent = `${im.name.toUpperCase()} · ${Math.round(im.width * 10) / 10} × ${Math.round(im.width * im.aspect * 10) / 10} MM`;
      for (const b of $$('[data-imdepth]')) b.setAttribute('aria-pressed', String(b.dataset.imdepth === im.depth));
      for (const b of $$('[data-imcull]')) b.setAttribute('aria-pressed', String(b.dataset.imcull === im.culling));
      drawImages();
      setState('updated');
    };
    c.set = (key, v) => { im[key] = v; show(); };
    c.input = () => {
      const w = num('im-w'), o = num('im-o');
      if (w > 0) im.width = w;
      if (o >= 0 && o <= 1) im.opacity = o;
      show();
    };
    c.remove = () => {
      images = images.filter(m => m.id !== id);
      textures.get(id)?.dispose();
      textures.delete(id);
      endCmd('committed');
      drawImages();
      renderOutliner();
      toast(`REMOVED ${imageLabel(id)}`);
    };
    c.key = action => (action === 'delete' ? (c.remove(), true) : false);
    c.finish = async () => { endCmd('committed'); renderOutliner(); };
    c.abort = () => { Object.assign(im, before); drawImages(); endCmd('cancelled'); };
    $('im-w').value = im.width;
    $('im-o').value = im.opacity;
    show();
  }

  // --- instances ------------------------------------------------------------
  // Plasticity's Create Instance and Create Curve Instance: a light copy of a solid, sheet or curve
  // that shares its master's geometry (see instances.js). Drawn from the master's own mesh or line,
  // so an edit to the master shows in every instance; read-only, in lighter grey. They live in the
  // file's app state, list under INSTANCES, and a click on one (in the viewport or the outliner)
  // opens it to move, turn, scale, duplicate, realize or remove. A curve instance has `curve: true`
  // and its master is a curve id.
  let instances = [], nextInstance = 1;
  const instanceGroup = new THREE.Group();
  scene.add(instanceGroup);
  const instanceEdgeMat = new THREE.LineBasicMaterial({ color: 0xb4b0a6, transparent: true, opacity: 0.85 });
  const instanceLabel = id => `N-${String(id).padStart(2, '0')}`;
  const masterOf = n => n.curve ? curveById(n.master) : bodyOf(n.master);
  const masterLabel = n => n.curve ? curveLabel(n.master) : label(n.master);
  /** The shown instances of solids and sheets, each with its master's body. */
  const placedSolids = () => instances.filter(n => !n.curve && !n.hidden).map(n => ({ n, b: bodyOf(n.master) })).filter(x => x.b);
  /** The scene's volume and faces; an instance counts as its master at its scale. */
  function renderTotals() {
    // Disabled bodies are left out of the scene, so out of its totals too.
    const placed = placedSolids().filter(({ n }) => !org.disabled.has(n.master)), on = current.filter(b => !org.disabled.has(b.id));
    $('volume').textContent = (on.reduce((v, b) => v + b.volume, 0) + placed.reduce((v, { n, b }) => v + b.volume * n.scale ** 3, 0)).toFixed(3);
    $('faces').textContent = on.reduce((k, b) => k + b.facePlanes.length, 0) + placed.reduce((k, { b }) => k + b.facePlanes.length, 0);
  }
  function drawInstances() {
    renderTotals();
    renderMass();
    for (const o of instanceGroup.children) if (o.userData.own) o.geometry.dispose();
    instanceGroup.clear(); // a body's geometry is its master's, so only curve lines are disposed
    for (const n of instances) {
      if (n.curve) {
        const cv = curveById(n.master);
        if (n.hidden || !cv) continue;
        const f = curveFrame(cv);
        const line = new (isClosed(cv) ? THREE.LineLoop : THREE.Line)(new THREE.BufferGeometry().setFromPoints(curve2d(cv).map(p => lift(f, p, 0.02))), instanceEdgeMat);
        line.matrixAutoUpdate = false;
        line.matrix.copy(matrixOf(n));
        line.userData = { instance: n.id, own: true };
        line.renderOrder = 9;
        instanceGroup.add(line);
        continue;
      }
      const master = bodyMesh(n.master);
      if (n.hidden || !master) continue;
      const mesh = new THREE.Mesh(master.geometry, faceMatFor(n.master));
      const lines = new THREE.LineSegments(master.userData.lines.geometry, instanceEdgeMat);
      lines.userData = { bodyEdges: true };
      lines.visible = view.edges;
      mesh.add(lines);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(matrixOf(n));
      mesh.userData = { instance: n.id };
      instanceGroup.add(mesh);
    }
  }
  /** The instance under the pointer, if it is nearer than `hit` (a pickAt result). */
  function instanceAt(e, hit) {
    ray(e);
    raycaster.params.Line.threshold = unitsPerPixel(controls.target) * 6;
    const h = raycaster.intersectObjects(instanceGroup.children, false)[0];
    if (!h) return null;
    if (hit?.point && camera.position.distanceTo(hit.point) < h.distance) return null;
    return h.object.userData.instance;
  }
  /** Create Instance: one instance of each selected solid, sheet or curve, then move it into place. */
  async function createInstances() {
    const ids = sel.list('solid').map(s => s.body).filter(id => bodyMesh(id));
    const curves = sel.curves.filter(curveById);
    if (!ids.length && !curves.length) return toast('SELECT A SOLID, SHEET OR CURVE TO INSTANCE');
    if (cmd) await finish();
    let last = null;
    for (const id of ids) {
      const centre = new THREE.Box3().setFromObject(bodyMesh(id)).getCenter(new THREE.Vector3());
      last = newInstance(nextInstance++, id, centre.toArray());
      instances.push(last);
    }
    for (const id of curves) {
      const cv = curveById(id), f = curveFrame(cv);
      const centre = new THREE.Box3().setFromPoints(curve2d(cv).map(p => lift(f, p))).getCenter(new THREE.Vector3());
      last = { ...newInstance(nextInstance++, id, centre.toArray()), curve: true };
      instances.push(last);
    }
    drawInstances();
    renderOutliner();
    startInstance(last.id, { fresh: true });
  }
  /** One instance open: a handle moves, turns or scales it (G R S); Realize, Duplicate, Remove. */
  function startInstance(id, { fresh = false } = {}) {
    const n = instances.find(m => m.id === id);
    if (!n) return;
    const before = JSON.parse(JSON.stringify(n));
    const handle = new THREE.Object3D();
    const place = () => {
      handle.position.fromArray(n.position);
      handle.quaternion.fromArray(n.quaternion);
      handle.scale.setScalar(n.scale);
    };
    place();
    scene.add(handle);
    const tc = new TransformControls(camera, canvas);
    tc.setSpace('world');
    tc.attach(handle);
    tc.addEventListener('dragging-changed', e => { controls.enabled = !e.value; });
    tc.addEventListener('objectChange', () => {
      n.position = handle.position.toArray();
      n.quaternion = handle.quaternion.clone().normalize().toArray();
      // Uniform only: take whichever component the drag changed.
      n.scale = Math.max(0.001, handle.scale.toArray().reduce((a, b) => Math.abs(b - n.scale) > Math.abs(a - n.scale) ? b : a, n.scale));
      show();
    });
    scene.add(tc.getHelper());
    const c = cmd = { id: 'instance', instance: id, tc };
    lastTool = 'instance';
    showTool('instance');
    setState('none');
    setTarget(instanceLabel(id));
    const mode = m => {
      tc.setMode({ move: 'translate', rotate: 'rotate', scale: 'scale' }[m]);
      for (const b of $$('[data-inmode]')) b.setAttribute('aria-pressed', String(b.dataset.inmode === m));
    };
    function show() {
      place();
      drawInstances();
      const at = toUser(n.position).map(fmt).join(' ');
      $('in-hint').textContent = `INSTANCE OF ${masterLabel(n)} · READ-ONLY · AT ${at}${n.scale !== 1 ? ` · ×${n.scale.toFixed(3)}` : ''}`;
      setState('updated');
    }
    c.mode = mode;
    c.key = action => {
      if (['move', 'rotate', 'scale'].includes(action)) { mode(action); return true; }
      if (action === 'duplicate') { c.duplicate(); return true; }
      if (action === 'delete') { c.remove(); return true; }
      return false;
    };
    c.click = e => {
      // Another instance opens in its place; other clicks don't change the selection.
      const other = instanceAt(e, null);
      if (other && other !== id) { endCmd('committed'); startInstance(other); renderOutliner(); }
      return true;
    };
    c.duplicate = () => {
      const copy = { ...JSON.parse(JSON.stringify(n)), id: nextInstance++ };
      instances.push(copy);
      endCmd('committed');
      drawInstances();
      renderOutliner();
      startInstance(copy.id, { fresh: true });
      toast(`${instanceLabel(copy.id)} · ANOTHER INSTANCE OF ${masterLabel(n)}`);
    };
    c.remove = () => {
      instances = instances.filter(m => m.id !== id);
      endCmd('committed');
      drawInstances();
      renderOutliner();
      toast(`REMOVED ${instanceLabel(id)}`);
    };
    c.realize = async () => {
      if (n.curve) {
        try {
          const m = motionOf(n), axis = new THREE.Vector3(...m.axis);
          const rotate = v => new THREE.Vector3(...v).applyAxisAngle(axis, m.angle).toArray();
          const { ids } = await backend.addCurves([transformCurve(curveById(n.master), { pivot: m.pivot, offset: m.offset, rotate, scale: m.scale })]);
          instances = instances.filter(x => x.id !== id);
          endCmd('committed');
          record('REALIZE CURVE INSTANCE', ids[0], curveLabel(ids[0]));
          await curvesChanged(ids);
          toast(`${instanceLabel(id)} IS NOW ${curveLabel(ids[0])}, AN ORDINARY CURVE`);
        } catch (e) { setState('failed'); toast(say(e)); }
        return;
      }
      try {
        let ids, list;
        if (n.mirror) {
          // A mirrored instance: the master mirrored as Mirror does, then placed where the instance stands.
          ({ ids, scene: list } = await backend.commitMirror({ bodies: [n.master], ...n.mirror, join: false }));
          const m = motionOf(n);
          if (Math.hypot(...m.offset) > 1e-12 || Math.abs(m.angle) > 1e-12 || Math.abs(m.scale - 1) > 1e-12) ({ scene: list } = await backend.commitMotion({ bodies: ids, ...m }));
        } else ({ ids, scene: list } = await backend.commitPlace({ bodies: [n.master], motion: motionOf(n), target: null, op: 'new' }));
        if (materialOf.has(n.master)) for (const b of ids) materialOf.set(b, materialOf.get(n.master));
        instances = instances.filter(m => m.id !== id);
        endCmd('committed');
        record('REALIZE INSTANCE', ids[0], label(ids[0]));
        await showScene(list);
        materialsChanged();
        sel.clear();
        for (const b of ids) sel.add({ kind: 'solid', body: b });
        selectionChanged();
        toast(`${instanceLabel(id)} IS NOW ${label(ids[0])}, AN ORDINARY BODY`);
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.finish = async () => { endCmd('committed'); renderOutliner(); };
    c.abort = () => {
      if (fresh) instances = instances.filter(m => m.id !== id);
      else Object.assign(n, before);
      drawInstances();
      endCmd('cancelled');
      renderOutliner();
    };
    c.cleanup = () => {
      tc.detach();
      tc.getHelper().removeFromParent();
      tc.dispose();
      handle.removeFromParent();
      controls.enabled = true;
    };
    mode('move');
    show();
    if (fresh) setHud('DRAG THE HANDLE TO PLACE THE INSTANCE · ⏎ TO KEEP');
  }

  /**
   * Space: the construction plane from the selection (cplaneFrom.js gives the rules): a flat face,
   * a face and an edge, two parallel faces, a planar curve or region, or points.
   */
  function planeFromSelection(alignView) {
    const view = camera.position.clone().sub(controls.target).normalize().toArray();
    const faces = sel.list('face').map(f => {
      const b = bodyOf(f.body), p = b?.facePlanes[f.n];
      return p ? { origin: faceCentre(b, f.n).toArray(), normal: p.normal, body: b.id } : { curved: true };
    });
    const edges = sel.list('edge').map(e => { const pts = bodyOf(e.body)?.edges[e.n] ?? []; const out = []; for (let i = 0; i + 2 < pts.length; i += 3) out.push([pts[i], pts[i + 1], pts[i + 2]]); return out; });
    const verts = vertexList();
    const points = [
      ...sel.list('vertex').map(v => verts.find(w => w.id === v.id && w.n === v.n)?.at.toArray()),
      ...sel.list('pole').map(it => poleOf(it)?.toArray()),
    ].filter(Boolean);
    const curves = [];
    for (const id of new Set([...sel.curves, ...sel.list('region').map(r => r.id)])) {
      const c = curveById(id);
      if (!c) continue;
      const f = curveFrame(c);
      if (c.kind === 'nurbs' && c.poles.some(q => Math.abs(q[2] ?? 0) > 1e-9)) { points.push(...c.poles.map(([x, y, z]) => lift(f, { x, y, z }).toArray())); continue; }
      if (c.kind === 'spiral' || c.kind === 'helix') { toast('A SPIRAL HAS NO PLANE OF ITS OWN'); return; }
      curves.push({ origin: (isClosed(c) ? regionCentre(c) : f.o).toArray(), normal: f.n.toArray() });
    }
    const got = planeFrom({ faces, edges, points, curves, view });
    if (got.error) return toast(got.error);
    const origin = new THREE.Vector3(...got.origin), normal = new THREE.Vector3(...got.normal);
    const name = got.kind === 'FACE' ? `FACE · ${label(faces[0].body)}` : got.kind;
    setPlane({ origin, normal, name });
    if (!alignView) return toast(`CONSTRUCTION PLANE · ${name}`);
    const dist = camera.position.distanceTo(controls.target);
    controls.target.copy(origin);
    const dir = normal.clone();
    if (Math.abs(dir.dot(UP)) > 0.9999) dir.z += 0.0001;
    camera.position.copy(origin).addScaledVector(dir.normalize(), dist);
  }
  function planeFromView() {
    setPlane({ origin: new THREE.Vector3(), normal: camera.position.clone().sub(controls.target).normalize(), name: 'VIEW' });
  }
  // Ctrl+Shift+Space: a plane facing the view, through the next point clicked.
  let planeOriginPending = false;
  function planeFromViewAt() {
    planeOriginPending = true;
    setHud('CLICK THE CONSTRUCTION PLANE’S ORIGIN · ESC CANCELS');
  }
  function placeViewPlane(e) {
    planeOriginPending = false;
    setHud('');
    const normal = camera.position.clone().sub(controls.target).normalize();
    const hit = pickAt(e);
    const at = hit?.point ?? ray(e).intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, controls.target), new THREE.Vector3());
    if (!at) return;
    setPlane({ origin: at.clone(), normal, name: 'VIEW' });
    toast('CONSTRUCTION PLANE FACING THE VIEW');
  }
  // Saved construction planes (Plasticity's Temporary construction plane, kept in a list).
  let savedPlanes = [];
  function savePlane() {
    const name = cplane.name === 'XY' || /^PLANE \d+$/.test(cplane.name) ? `PLANE ${savedPlanes.length + 1}` : cplane.name;
    if (savedPlanes.some(q => q.origin.every((v, i) => Math.abs(v - cplane.origin.getComponent(i)) < 1e-9) && q.normal.every((v, i) => Math.abs(v - cplane.normal.getComponent(i)) < 1e-9))) return toast('THAT PLANE IS SAVED ALREADY');
    savedPlanes.push({ name, origin: cplane.origin.toArray(), normal: cplane.normal.toArray() });
    drawSavedPlanes();
    keepAppState();
    toast(`SAVED ${name}`);
  }
  function drawSavedPlanes() {
    const el = $('saved-planes');
    el.replaceChildren(...savedPlanes.map((q, i) => {
      const row = document.createElement('div');
      row.className = 'saved-plane';
      const use = document.createElement('button');
      use.textContent = q.name;
      use.title = `Use the saved construction plane ${q.name}`;
      use.onclick = () => setPlane({ origin: new THREE.Vector3(...q.origin), normal: new THREE.Vector3(...q.normal), name: q.name });
      const del = document.createElement('button');
      del.className = 'icon-btn';
      del.innerHTML = icon('close');
      del.setAttribute('aria-label', `Forget ${q.name}`);
      del.title = `Forget ${q.name}`;
      del.onclick = () => { savedPlanes.splice(i, 1); drawSavedPlanes(); keepAppState(); };
      row.append(use, del);
      return row;
    }));
    el.hidden = !savedPlanes.length;
  }

  // --- picking ------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const gridStep = () => +$('grid').value;
  let lastPointer = null;
  const ndc = e => {
    const r = canvas.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };
  function ray(e) { raycaster.setFromCamera(ndc(e), camera); return raycaster.ray; }
  /** World units per screen pixel at a point. */
  function unitsPerPixel(at) {
    const h = canvas.clientHeight || 1;
    if (camera.isOrthographicCamera) return (camera.top - camera.bottom) / camera.zoom / h;
    return 2 * camera.position.distanceTo(at) * Math.tan(persp.fov * DEG / 2) / h;
  }
  /** Screen position (CSS pixels relative to the canvas) of a world point. */
  function screenOf(p) {
    const s = p.clone().project(camera);
    return { x: (s.x + 1) / 2 * canvas.clientWidth, y: (1 - s.y) / 2 * canvas.clientHeight, behind: s.z > 1 };
  }
  const local = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  /**
   * What is under the pointer among the active selection modes: an edge if one is close (and not
   * behind a face), else a face, else the solid. Returns { kind, body, n?, point }.
   */
  function pickAt(e) {
    ray(e);
    const vertex = sel.allows('point') && (vertexAt(local(e)) ?? poleAt(local(e)));
    if (vertex) return vertex;
    const meshes = shownMeshes().filter(m => !org.locked.has(m.userData.id));
    const faceHit = raycaster.intersectObjects(meshes, false)[0];
    const reach = faceHit ? faceHit.distance * 1.01 + 0.5 : Infinity; // in front of the face, or on it
    raycaster.params.Line.threshold = unitsPerPixel(faceHit?.point ?? controls.target) * 6;
    // Curves pick with edges or solids (Plasticity picks a curve whole), regions with faces.
    // Hidden curves (View › Curves off, or hidden in the outliner) can't be picked.
    const curveHit = (sel.allows('edge') || sel.allows('solid')) && curveGroup.visible
      && raycaster.intersectObjects(curveGroup.children.filter(o => o.visible && o.userData.curve !== undefined), false).find(h => h.distance <= reach);
    let edgeHit = null;
    if (sel.allows('edge')) {
      const hits = raycaster.intersectObjects(meshes.map(m => m.userData.lines), false);
      edgeHit = hits.find(h => !faceHit || h.distance <= faceHit.distance * 1.01 + 1e-6);
    }
    if (curveHit && (!edgeHit || curveHit.distance <= edgeHit.distance + 0.5)) return { kind: 'curve', id: curveHit.object.userData.curve, point: curveHit.point };
    if (edgeHit) return { kind: 'edge', body: edgeHit.object.parent.userData.id, n: edgeHit.object.userData.segEdge[edgeHit.index / 2], point: edgeHit.point };
    if (sel.allows('face')) {
      const r = curveGroup.visible && raycaster.intersectObjects(curveGroup.children.filter(o => o.visible && o.userData.region !== undefined), false).find(h => h.distance <= reach);
      if (r) return { kind: 'region', id: r.object.userData.region, point: r.point };
    }
    if (!faceHit) return null;
    const { id, faceIds } = faceHit.object.userData;
    if (sel.allows('face')) return { kind: 'face', body: id, n: faceIds[faceHit.faceIndex], point: faceHit.point };
    if (sel.allows('solid')) return { kind: 'solid', body: id, point: faceHit.point };
    return null;
  }

  /**
   * Everything pickable under the pointer, nearest first, for the selection context menu
   * (Ctrl+Shift+click): curve vertices and control points, curves, edges, regions, faces and
   * solids, as the selection modes allow, hidden behind nothing (a face further back is listed too).
   */
  function pickAllAt(e) {
    ray(e);
    const out = [], seen = new Set();
    const put = (it, d) => { const k = JSON.stringify({ ...it, point: undefined }); if (!seen.has(k)) { seen.add(k); out.push({ ...it, d }); } };
    if (sel.allows('point')) { const v = vertexAt(local(e)) ?? poleAt(local(e)); if (v) put(v, -1); }
    const meshes = shownMeshes().filter(m => !org.locked.has(m.userData.id));
    const faces = raycaster.intersectObjects(meshes, false);
    raycaster.params.Line.threshold = unitsPerPixel(faces[0]?.point ?? controls.target) * 6;
    if ((sel.allows('edge') || sel.allows('solid')) && curveGroup.visible)
      for (const h of raycaster.intersectObjects(curveGroup.children.filter(o => o.visible && o.userData.curve !== undefined), false)) put({ kind: 'curve', id: h.object.userData.curve, point: h.point }, h.distance);
    if (sel.allows('edge'))
      for (const h of raycaster.intersectObjects(meshes.map(m => m.userData.lines), false)) put({ kind: 'edge', body: h.object.parent.userData.id, n: h.object.userData.segEdge[h.index / 2], point: h.point }, h.distance);
    if (sel.allows('face') && curveGroup.visible)
      for (const h of raycaster.intersectObjects(curveGroup.children.filter(o => o.visible && o.userData.region !== undefined), false)) put({ kind: 'region', id: h.object.userData.region, point: h.point }, h.distance);
    for (const h of faces) {
      const { id, faceIds } = h.object.userData;
      if (sel.allows('face')) put({ kind: 'face', body: id, n: faceIds[h.faceIndex], point: h.point }, h.distance);
      if (sel.allows('solid')) put({ kind: 'solid', body: id, point: h.point }, h.distance + 1e-6);
    }
    return out.sort((a, b) => a.d - b.d);
  }
  const pickName = it => it.kind === 'solid' ? `${label(it.body)}${bodyOf(it.body)?.sheet ? ' SHEET' : ' SOLID'}`
    : it.kind === 'curve' ? `${curveLabel(it.id)} CURVE` : it.kind === 'region' ? `${curveLabel(it.id)} REGION`
    : it.kind === 'vertex' ? `${curveLabel(it.id)} POINT ${it.n + 1}` : it.kind === 'pole' ? `${label(it.body)} FACE ${it.face + 1} CV ${it.n + 1}`
    : `${label(it.body)} ${it.kind.toUpperCase()} ${it.n + 1}`;
  /**
   * Plasticity's selection context menu: Ctrl+Shift+click lists what lies under the pointer, the
   * wheel or arrow keys move down the list, and a click or Enter selects that one (Shift adds it).
   */
  let pickMenu = null;
  function openPickMenu(e) {
    const items = pickAllAt(e);
    const el = $('pickmenu');
    if (!items.length) { closePickMenu(); return toast('NOTHING UNDER THE POINTER'); }
    pickMenu = { items, at: 0, add: false };
    el.innerHTML = '';
    items.forEach((it, i) => {
      const b = document.createElement('button');
      b.setAttribute('role', 'menuitem');
      b.textContent = pickName(it);
      b.title = 'Select this (Shift adds it)';
      b.onpointerenter = () => movePick(i);
      b.onclick = ev => choosePick(i, ev.shiftKey);
      el.append(b);
    });
    const p = local(e);
    Object.assign(el.style, { left: `${p.x + 8}px`, top: `${p.y + 8}px` });
    el.hidden = false;
    movePick(0);
  }
  function movePick(i) {
    if (!pickMenu) return;
    pickMenu.at = (i + pickMenu.items.length) % pickMenu.items.length;
    [...$('pickmenu').children].forEach((b, k) => b.setAttribute('aria-current', String(k === pickMenu.at)));
    const { point, d, ...it } = pickMenu.items[pickMenu.at];
    hover = it;
    drawOverlays();
  }
  function choosePick(i, add) {
    if (!pickMenu) return;
    const { point, d, ...it } = pickMenu.items[i];
    closePickMenu();
    applySelect(it, add ? 'add' : 'replace');
    hover = null;
    selectionChanged();
  }
  function closePickMenu() { pickMenu = null; $('pickmenu').hidden = true; }

  // --- selection ------------------------------------------------------------
  // Clicks follow Plasticity 0.6.30 (src/selection/Click.ts): with solids selectable, the first
  // click on a solid takes the whole solid, and a click on a solid already selected (or one with
  // faces or edges selected) drills down to the face or edge. Shift adds, Ctrl removes or adds back,
  // a double-click takes the solid, and a click on nothing clears.
  function clickTarget(hit, mod) {
    if (!hit) return null;
    if (hit.kind === 'pole') return { kind: 'pole', body: hit.body, face: hit.face, n: hit.n };
    if (hit.body === undefined) return hit.kind === 'vertex' ? { kind: 'vertex', id: hit.id, n: hit.n } : { kind: hit.kind, id: hit.id };
    const solid = { kind: 'solid', body: hit.body };
    if (hit.kind === 'solid') return solid;
    if (sel.allows('solid')) {
      const children = sel.list().some(it => it.body === hit.body && it.kind !== 'solid');
      if (sel.has(solid)) { if (mod !== 'replace') return solid; }
      else if (!children) return solid;
    }
    return { kind: hit.kind, body: hit.body, n: hit.n };
  }
  // Edge topology per body, kept while the body is unchanged (its edges array is replaced on change).
  const topologies = new WeakMap();
  const topologyOf = b => { if (!topologies.has(b.edges)) topologies.set(b.edges, topology(b)); return topologies.get(b.edges); };
  function applySelect(it, mod) {
    if (!it) { if (mod === 'replace') sel.clear(); return; }
    const drop = () => { if (it.body === undefined) return; if (it.kind !== 'solid') sel.remove({ kind: 'solid', body: it.body }); else for (const c of sel.list()) if (c.body === it.body && c.kind !== 'solid') sel.remove(c); };
    if (mod === 'replace') { sel.clear(); sel.add(it); }
    else if (mod === 'add') { drop(); sel.add(it); }
    else if (sel.has(it)) sel.remove(it);
    else { drop(); sel.add(it); }
  }
  const modOf = e => e.shiftKey ? 'add' : (e.ctrlKey || e.metaKey) ? 'remove' : 'replace';

  // Box select (Plasticity: right-to-left takes what the box touches, left-to-right what it holds).
  function boxSelect(a, b, mod) {
    const r = { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) };
    const touch = b.x < a.x;
    const inside = p => !p.behind && p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;
    const v = new THREE.Vector3();
    const proj = (arr, i) => screenOf(v.fromArray(arr, i));
    const segHits = (p, q) => inside(p) || inside(q) || [[r.x0, r.y0, r.x1, r.y0], [r.x1, r.y0, r.x1, r.y1], [r.x1, r.y1, r.x0, r.y1], [r.x0, r.y1, r.x0, r.y0]].some(([x1, y1, x2, y2]) => crosses(p, q, { x: x1, y: y1 }, { x: x2, y: y2 }));
    const centre = { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 };
    function polyHit(points, closed) {
      if (touch) {
        for (let i = 0; i < points.length; i++) {
          if (inside(points[i])) return true;
          const j = i + 1 < points.length ? i + 1 : closed ? 0 : -1;
          if (j >= 0 && segHits(points[i], points[j])) return true;
        }
        return closed && points.length === 3 && inTriangle(centre, ...points);
      }
      return points.every(inside);
    }
    const found = [];
    for (const m of shownMeshes().filter(m => !org.locked.has(m.userData.id))) {
      const id = m.userData.id, body = bodyOf(id);
      const solidSelected = sel.has({ kind: 'solid', body: id });
      const children = sel.list().some(it => it.body === id && it.kind !== 'solid');
      const drill = !sel.allows('solid') || solidSelected || children;
      const tris = () => {
        const out = new Map();
        for (let t = 0; t < body.faceIds.length; t++) {
          const f = body.faceIds[t];
          if (!out.has(f)) out.set(f, []);
          out.get(f).push([0, 1, 2].map(k => proj(body.positions, body.indices[3 * t + k] * 3)));
        }
        return out;
      };
      if (!drill) {
        const all = [...tris().values()].flat();
        if (touch ? all.some(t => polyHit(t, true)) : all.every(t => polyHit(t, true))) found.push({ kind: 'solid', body: id });
      } else if (sel.allows('face')) {
        for (const [f, ts] of tris()) if (touch ? ts.some(t => polyHit(t, true)) : ts.every(t => polyHit(t, true))) found.push({ kind: 'face', body: id, n: f });
      } else if (sel.allows('edge')) {
        body.edges.forEach((e, n) => {
          const pts = [];
          for (let i = 0; i < e.length; i += 3) pts.push(proj(e, i));
          if (polyHit(pts, false)) found.push({ kind: 'edge', body: id, n });
        });
      }
    }
    if (sel.allows('edge') || sel.allows('solid')) for (const c of curveList) {
      const f = curveFrame(c);
      if (polyHit(curve2d(c).map(p => screenOf(lift(f, p))), isClosed(c))) found.push({ kind: 'curve', id: c.id });
    }
    if (mod === 'replace') sel.clear();
    for (const it of found) applySelect(it, mod === 'remove' ? 'remove' : 'add');
    selectionChanged();
  }

  // Overlays live on each body's mesh, so they move with it during a move preview.
  const overlayMat = {
    hover: new THREE.LineBasicMaterial({ color: 0xffffff }),
    selected: new THREE.LineBasicMaterial({ color: COLORS.accent }),
    failed: new THREE.LineBasicMaterial({ color: DANGER, depthTest: false }),
    hoverFace: new THREE.MeshBasicMaterial({ color: COLORS.ink, transparent: true, opacity: 0.08, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    face: new THREE.MeshBasicMaterial({ color: COLORS.accent, transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  };
  let hover = null, failedEdges = [];
  function edgeLines(body, numbers, material) {
    const pts = [];
    for (const n of numbers) {
      const e = body.edges[n];
      if (e) for (let i = 3; i < e.length; i += 3) pts.push(e[i - 3], e[i - 2], e[i - 1], e[i], e[i + 1], e[i + 2]);
    }
    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), material);
    lines.renderOrder = 12;
    lines.userData.overlay = true;
    return lines;
  }
  function faceMesh(body, faces, material) {
    const ix = [];
    for (let t = 0; t < body.faceIds.length; t++) if (faces.includes(body.faceIds[t])) ix.push(body.indices[3 * t], body.indices[3 * t + 1], body.indices[3 * t + 2]);
    const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(body.positions, 3));
    g.setIndex(ix);
    const m = new THREE.Mesh(g, material);
    m.renderOrder = 6;
    m.userData.overlay = true;
    return m;
  }
  function drawOverlays() {
    for (const m of bodies.children) for (const o of m.children.filter(o => o.userData.overlay)) dispose(o);
    const put = (id, obj) => bodyMesh(id)?.add(obj);
    for (const m of bodies.children) {
      const id = m.userData.id, b = bodyOf(id);
      if (!b) continue;
      if (sel.has({ kind: 'solid', body: id })) put(id, edgeLines(b, b.edges.map((_, n) => n), overlayMat.selected));
      const faces = sel.list('face').filter(it => it.body === id).map(it => it.n);
      if (faces.length) put(id, faceMesh(b, faces, overlayMat.face));
      const edges = sel.list('edge').filter(it => it.body === id).map(it => it.n);
      if (edges.length) put(id, edgeLines(b, edges.filter(n => !failedEdges.includes(n)), overlayMat.selected));
      if (failedEdges.length && edges.length) put(id, edgeLines(b, failedEdges, overlayMat.failed));
    }
    paintCurves();
    if (hover && !sel.has(hover) && hover.body !== undefined) {
      const b = bodyOf(hover.body);
      if (b) {
        if (hover.kind === 'edge') put(b.id, edgeLines(b, [hover.n], overlayMat.hover));
        else if (hover.kind === 'face') put(b.id, faceMesh(b, [hover.n], overlayMat.hoverFace));
        else put(b.id, edgeLines(b, b.edges.map((_, n) => n), overlayMat.hover));
      }
    }
  }

  /** After any change of selection: redraw, update the panels, and start or stop the default command. */
  function selectionChanged({ quiet = false } = {}) {
    drawOverlays();
    renderOutliner();
    const n = sel.size;
    $('sel-count').textContent = n ? `${n} ${[...new Set(sel.list().map(it => it.kind === 'pole' ? 'surface point' : it.kind))].join('+').toUpperCase()}` : '—';
    renderMass();
    if (cmd?.onSelection) return cmd.onSelection();
    if (quiet) return;
    // Plasticity's default command: with edges selected the fillet's dot is already there to drag.
    defaultCommand();
  }
  /**
   * Plasticity's auto-invoked commands (Preferences › Commands, each its own switch): the fillet's
   * dot with edges selected, Extend Sheet with one edge of a sheet, the extrude's with regions,
   * Offset Face's (push face) with faces, and Move's handles with solids or curves.
   */
  function defaultCommand() {
    const on = prefs.commands;
    if (cmd || !on.autoInvoke) return;
    if (sheetEdge() && on.autoExtendSheet && backend.previewExtendSheet) startExtendSheet({ auto: true });
    else if (edgeBody()) { if (on.autoFillet) startFillet({ auto: true }); }
    else if (regionsOnly()) { if (on.autoExtrude) startExtrude({ auto: true }); }
    else if (faceBody() !== null) { if (on.autoOffset) startOffset({ auto: true }); }
    // 2026.2: Move comes up on selected solids and curves, its handles ready to drag.
    else if (on.autoMove && sel.size && sel.list().every(it => it.kind === 'solid' || it.kind === 'curve')) startTransform('move', { auto: true });
  }
  /** The one selected edge, when it is an edge of a sheet and nothing else is selected. */
  function sheetEdge() {
    const items = sel.list();
    return items.length === 1 && items[0].kind === 'edge' && current.find(b => b.id === items[0].body)?.sheet ? items[0] : null;
  }
  /** The one body all selected faces are on, and only faces are selected; else null. */
  function faceBody() {
    const items = sel.list();
    if (!items.length || items.some(it => it.kind !== 'face')) return null;
    const ids = new Set(items.map(it => it.body));
    return ids.size === 1 ? [...ids][0] : null;
  }
  const regionsOnly = () => sel.size > 0 && sel.list().every(it => it.kind === 'region');
  /** The one body all selected edges are on, and only edges are selected; else null. */
  function edgeBody() {
    const items = sel.list();
    if (!items.length || items.some(it => it.kind !== 'edge')) return null;
    const ids = new Set(items.map(it => it.body));
    return ids.size === 1 ? [...ids][0] : null;
  }
  /** The bodies a transform acts on: the selected solids, else the bodies of whatever is selected. */
  const targetBodies = () => sel.solids.length ? sel.solids : sel.bodies;

  // --- point snapping -------------------------------------------------------
  // Plasticity: Ctrl snaps to the ends and middles of edges and the centres of faces (curves: see
  // curvePolys below), shown as a dot
  // with a tip; it is on by itself while placing a sketch. Alt turns it off for that.
  const SNAP_PX = 10;
  const snapDot = new THREE.Group();
  for (const [color, size] of [[COLORS.ink, 10], [0x000000, 6]]) {
    const p = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)),
      new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false }));
    p.renderOrder = 30 + size;
    snapDot.add(p);
  }
  snapDot.visible = false;
  scene.add(snapDot);
  function snapCandidates(m) {
    if (m.userData.snaps) return m.userData.snaps;
    const out = [];
    const at = (e, i) => new THREE.Vector3(e[i], e[i + 1], e[i + 2]);
    for (const e of m.userData.edges) {
      const n = e.length / 3;
      out.push({ point: at(e, 0), kind: 'END' }, { point: at(e, (n - 1) * 3), kind: 'END' });
      // Lines come as two points; curves as even samples, so the middle sample is the midpoint.
      const mid = n === 2 ? at(e, 0).lerp(at(e, 3), 0.5) : n % 2 ? at(e, (n - 1) / 2 * 3) : at(e, (n / 2 - 1) * 3).lerp(at(e, n / 2 * 3), 0.5);
      out.push({ point: mid, kind: 'MIDDLE' });
    }
    const body = bodyOf(m.userData.id);
    m.userData.facePlanes.forEach((p, f) => { const c = p && body && faceCentre(body, f); if (c) out.push({ point: c, kind: 'CENTER' }); });
    // 2026.2: where edges cross the YZ and XZ planes (user x = 0 and y = 0), anywhere on them.
    out.push(...crossings(m.userData.edges, new THREE.Plane(new THREE.Vector3(1, 0, 0), 0), 'YZ'), ...crossings(m.userData.edges, new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), 'XZ'));
    return m.userData.snaps = out;
  }
  /** The points where edge polylines cross `plane`, as snaps of `kind`; edge ends are left to END. */
  function crossings(edges, plane, kind) {
    const out = [];
    for (const e of edges) {
      const n = e.length / 3;
      let a = new THREE.Vector3(e[0], e[1], e[2]), da = plane.distanceToPoint(a);
      for (let i = 1; i < n; i++) {
        const b = new THREE.Vector3(e[3 * i], e[3 * i + 1], e[3 * i + 2]), db = plane.distanceToPoint(b);
        if (da * db < 0) out.push({ point: a.clone().lerp(b, da / (da - db)), kind });
        else if (db === 0 && i < n - 1) out.push({ point: b.clone(), kind });
        a = b; da = db;
      }
    }
    return out;
  }
  /** An instance's snaps: its master's, moved by the instance's matrix (kept until it moves). */
  function instanceSnaps(o) {
    const n = instances.find(i => i.id === o.userData.instance), master = n && bodyMesh(n.master);
    if (!master) return [];
    const key = o.matrix.elements.join(',');
    if (o.userData.snapKey !== key || o.userData.snapsOf !== master.userData.snaps) {
      o.userData.snaps = snapCandidates(master).map(s => ({ point: s.point.clone().applyMatrix4(o.matrix), kind: s.kind }));
      o.userData.snapKey = key;
      o.userData.snapsOf = master.userData.snaps;
    }
    return o.userData.snaps;
  }
  /** Where the mesh's edges cross the Section Analysis plane, while one is shown. */
  function sectionSnaps(m) {
    const p = section.plane;
    if (!p) return [];
    const key = `${p.normal.toArray()}|${p.constant}`;
    if (m.userData.sectionKey !== key) { m.userData.sectionKey = key; m.userData.sectionSnaps = crossings(m.userData.edges, p, 'SECTION'); }
    return m.userData.sectionSnaps;
  }
  // Curve snaps (curveSnaps.js): ends, middle, 1/4, 3/4, centre and crossings of the shown curves,
  // worked out once per set of curves; Perpendicular and Tangent from the point a drawing is at;
  // Closest, any point along a curve, when nothing else is near.
  let curveSnapCache = { list: null, shown: '', snaps: [], polys: [] };
  function curvePolys() {
    const shown = curveGroup.visible ? curveGroup.children.filter(o => o.visible && o.userData.curve !== undefined).map(o => o.userData.curve) : [];
    const key = shown.join(',');
    if (curveSnapCache.list === curveList && curveSnapCache.shown === key) return curveSnapCache;
    const polys = [];
    for (const id of shown) {
      const c = curveById(id);
      if (!c) continue;
      const f = curveFrame(c);
      const pts = curve2d(c).map(p => lift(f, p).toArray());
      let center = null, radius = null;
      if (c.kind === 'circle' || c.kind === 'ellipse') { center = lift(f, { x: c.center[0], y: c.center[1] }).toArray(); radius = c.kind === 'circle' ? c.radius : null; }
      else if (c.kind === 'arc') { const k = circleThrough(c.start, c.mid, c.end); if (k) { center = lift(f, { x: k.center[0], y: k.center[1] }).toArray(); radius = k.radius; } }
      polys.push({ id, pts, closed: isClosed(c), center, radius, normal: f.n.toArray(), arc: c.kind === 'arc' });
    }
    const v = a => new THREE.Vector3(...a);
    const snaps = [...polys.flatMap(q => curvePointSnaps(q.pts, q)), ...intersections(polys, 1e-3)].map(x => ({ point: v(x.point), kind: x.kind }));
    return curveSnapCache = { list: curveList, shown: key, snaps, polys };
  }
  /** Perpendicular and Tangent snaps on the shown curves from the point `from` (in the drawing plane, `normal`). */
  function fromSnaps(from, normal) {
    const out = [], f = from.toArray(), n = normal?.toArray();
    for (const q of curvePolys().polys) {
      out.push(...perpendicularFeet(q.pts, f, q.closed));
      if (!n) continue;
      // A circle or arc gets the exact tangent points (an arc's only where they lie on it).
      if (q.radius && Math.abs(Math.abs(q.normal[0] * n[0] + q.normal[1] * n[1] + q.normal[2] * n[2]) - 1) < 1e-6) {
        const ts = circleTangents(q.center, q.radius, q.normal, f);
        out.push(...(q.arc ? ts.filter(t => q.pts.some((p, i) => i && Math.hypot(...[0, 1, 2].map(k => (p[k] + q.pts[i - 1][k]) / 2 - t.point[k])) < Math.hypot(...[0, 1, 2].map(k => p[k] - q.pts[i - 1][k])))) : ts));
      } else out.push(...tangentPoints(q.pts, f, n, q.closed));
    }
    return out.map(x => ({ point: new THREE.Vector3(...x.point), kind: x.kind }));
  }
  function snapNear(e, meshes, plane = null, from = null) {
    if (!snapSettings.on) return null;
    const ok = s => snapAllowed(s.kind, snapSettings, cmd?.snapSkip);
    const c = local(e);
    let best = null, bestD = SNAP_PX;
    // 2026.2: instances snap as their masters do, where they stand.
    const placed = instanceGroup.children.filter(o => o.isMesh && o.visible).flatMap(o => instanceSnaps(o));
    const curves = curvePolys();
    const all = [...meshes.flatMap(m => [...snapCandidates(m), ...sectionSnaps(m)]), ...placed, ...curves.snaps, ...(from ? fromSnaps(from, plane?.normal) : [])];
    for (const s of all) {
      if (!ok(s) || (plane && Math.abs(plane.distanceToPoint(s.point)) > 1e-3)) continue;
      const p = screenOf(s.point);
      if (p.behind) continue;
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      // Points along a curve give way to the named points of the same place.
      if (d < bestD - 1e-6) { bestD = d; best = s; }
    }
    if (!best && ok({ kind: 'ON CURVE' })) {
      // Closest: the nearest point along a curve under the pointer.
      let near = null;
      for (const q of curves.polys) {
        if (plane && q.pts.some(p => Math.abs(plane.distanceToPoint(new THREE.Vector3(...p))) > 1e-3)) continue;
        const hit = closestOnScreen(q.pts, q.pts.map(p => screenOf(new THREE.Vector3(...p))), c, q.closed);
        if (hit && hit.d < SNAP_PX * 0.7 && (!near || hit.d < near.d)) near = hit;
      }
      if (near) return { point: new THREE.Vector3(...near.point), kind: 'ON CURVE' };
    }
    return best && { point: best.point.clone(), kind: best.kind };
  }
  // The Snapping window's settings (snapKinds.js), kept for the next session.
  let snapSettings = (() => { try { return parseSnaps(localStorage.getItem('w3d-snaps')); } catch { return parseSnaps(null); } })();
  let shownSnap = null;
  function setSnaps(next) {
    snapSettings = next;
    try { localStorage.setItem('w3d-snaps', JSON.stringify(next)); } catch { /* private window: this session only */ }
    $('snap-object').setAttribute('aria-pressed', next.on);
    for (const b of $$('[data-snapkind]')) { b.setAttribute('aria-pressed', !next.off.includes(b.dataset.snapkind)); b.disabled = !next.on; }
  }
  function showSnap(s, e) {
    shownSnap = s?.kind ?? null;
    snapDot.visible = !!s;
    if (s) snapDot.position.copy(s.point);
    const tag = $('snap-tag');
    tag.hidden = !s;
    if (s && e) { const c = local(e); tag.textContent = s.kind; tag.style.left = `${c.x + 12}px`; tag.style.top = `${c.y + 12}px`; }
  }
  const snapping = e => view.snap !== !!(e?.ctrlKey || e?.metaKey);

  // --- commands -------------------------------------------------------------
  // One command runs at a time: `cmd` is { id, finish(), abort(), key?(action, e), click?(e), ... }.
  // Starting a command finishes the one running, as in Plasticity.
  let cmd = null, lastTool = null;
  function setState(s) { for (const li of $('states').children) li.setAttribute('aria-current', li.dataset.s === s); }
  function setHud(text) {
    const h = $('hud');
    if (text) { h.textContent = text; delete h.dataset.idle; }
    else { h.textContent = 'SELECT · F SEARCH'; h.dataset.idle = ''; }
  }
  function showTool(id) {
    toolbar.setActive(id);
    for (const el of $$('[data-panel]')) el.hidden = el.dataset.panel !== (id === 'spiral' ? 'spiral' : DRAW[id] ? 'draw' : FORMS[id] ? 'form' : PRIMS[id] ? 'primitive' : id);
    $('keys').innerHTML = keysHtml(KEYS[id] ? id : 'idle');
    const name = !id ? 'SELECT' : EDITS[id] ?? DRAW[id] ?? toolInfo(id).label;
    $('tool-name').textContent = name;
    $('status-tool').textContent = name;
    $('commit').disabled = $('cancel').disabled = !id;
  }
  function setTarget(text) { $('target').textContent = text ?? '—'; $('status-target').textContent = text ?? 'VOID'; }
  function endCmd(state) {
    const c = cmd;
    cmd = null;
    c?.cleanup?.();
    showTool(null);
    setTarget(null);
    setHud(null);
    showSnap(null);
    if (state) setState(state);
    renderOutliner();
  }
  async function finish() { const c = cmd; if (c) await c.finish(); }
  function abort() { cmd?.abort(); }

  async function startTool(id, opts = {}) {
    if (cmd && cmd.id === id && !cmd.auto) return;
    if (cmd) await finish();
    keepSources();
    lastTool = id;
    if (id === 'fillet' && sel.size && sel.list().every(it => it.kind === 'vertex')) return startFilletVertex();
    if (id === 'fillet') return startFillet(opts);
    if (id === 'move' || id === 'rotate' || id === 'scale') return startTransform(id, opts);
    if (id === 'pushpull') return startPushPull(opts);
    if (id === 'extrude') return startExtrude(opts);
    if (id === 'boolean') return startBoolean();
    if (id === 'offset') return startOffset(opts);
    if (FORMS[id]) return startForm(id);
    if (PRIMS[id]) return startPrimitive(id, opts);
    if (id === 'offset-curve' || id === 'fillet-curve') return startCurveEdit(id);
    if (id === 'trim') return startTrim();
    if (id === 'hole') return startHole(opts);
    if (id === 'remove-face') return startRemoveFace();
    if (id === 'cut') return startCut();
    if (id === 'imprint') return startImprint();
    if (id === 'project') return startProject();
    if (id === 'patch') return startPatch();
    if (id === 'bridge-surface') return startBridgeSurface();
    if (id === 'thicken') return startThicken();
    if (id === 'pipe') return startPipe();
    if (id === 'extend-sheet') return startExtendSheet();
    if (id === 'extend') return startExtend();
    if (id === 'tangent-circle') return startTangentCircle();
    if (id === 'split') return startSplit();
    if (id === 'measure-distance') return startMeasureDistance();
    if (id === 'measure-radius') return startMeasureRadius();
    if (id === 'measure-continuity') return startMeasureContinuity();
    if (id === 'export-mesh') return startExportMesh();
    if (id === 'material') return startMaterial();
    if (id === 'export-drawing') return startExportDrawing();
    if (id === 'bridge') return startBridge();
    if (id === 'shell') return startShell();
    if (id === 'draft') return startDraft();
    if (id === 'mirror') return startMirror();
    if (id === 'rect-array' || id === 'radial-array') return startArray(id);
    if (id === 'curve-array') return startCurveArray();
    if (id === 'spiral') return startSpiral();
    if (DRAW[id]) return startDraw(id);
  }

  const previewGroup = new THREE.Group();
  scene.add(previewGroup);
  function clearPreview() {
    for (const m of [...previewGroup.children]) dispose(m);
    for (const m of bodies.children) m.visible = org.shows(m.userData.id);
  }
  function showPreviewBody(body, faces = faceMat, edges = edgeMat) {
    for (const m of bodies.children) if (m.userData.id === body.id) m.visible = false;
    const m = meshOf(body, faces, edges);
    previewGroup.add(m);
    return m;
  }

  /** A yellow-dot handle wired to the viewport; `onValue` gets every new value. */
  function dot(origin, dir, onValue, onEnd) {
    const g = new MagnitudeGizmo(camera, canvas, { step: gridStep() });
    g.setFrame(origin, dir);
    g.onStart = () => { controls.enabled = false; };
    g.onEnd = () => { controls.enabled = true; onEnd?.(); };
    g.onChange = onValue;
    g.onText = t => setHud(`${t}_`);
    scene.add(g);
    return g;
  }

  // --- fillet (B) -----------------------------------------------------------
  // Select edges and the yellow dot is there (Plasticity's default command for edges), or press B.
  // Drag the dot out to round, in (negative) to chamfer; D, C and A set the distance, the chamfer
  // and its angle from the cursor or typed numbers. Ctrl+click adds or removes edges. Too large a
  // radius stops at the largest that works. Enter or right-click finishes and selects the solid.
  function startFillet({ auto = false } = {}) {
    if (!auto && !edgeBody()) {
      if (sel.list('edge').length) return toast('FILLET THE EDGES OF ONE SOLID AT A TIME');
      if (!sel.allows('edge')) sel.toggleMode('edge'), renderModes();
    }
    const c = cmd = {
      id: 'fillet', auto, value: 0, angle: 45, shape: 'round', tension: 0.5, sent: 0, shown: 0, good: null, bad: null, body: null, edges: [],
      gizmo: null, entry: null, entryDone: () => previewFillet(),
      // Plasticity's variable points (V): { edge, point, scale, gizmo }, the radius there being value × scale.
      vars: [], limits: [], placing: null, tangent: true, extraGizmos() { return this.vars.map(v => v.gizmo) },
      // Each body's face surfaces, read once, so a click on a round face can copy its radius.
      surfaces: new Map(),
      get kind() { return this.value < 0 ? 'chamfer' : 'fillet' },
    };
    lastTool = 'fillet';
    showTool('fillet');
    for (const b of $$('[data-flshape]')) b.setAttribute('aria-pressed', String(b.dataset.flshape === 'round'));
    $('blend-tension-row').hidden = true;
    $('blend-tension').value = 0.5;
    $('blend-kind').textContent = 'ROUND';
    $('blend-limits').textContent = 0;
    $('blend-tangent').setAttribute('aria-pressed', 'true');
    for (const o of [...limitMarks.children]) dispose(o);
    setState('none');
    c.onSelection = () => {
      drawOverlays();
      const body = edgeBody();
      // An untouched auto fillet gives way to Extend Sheet when one sheet edge is all that's picked.
      if (c.auto && c.value === 0 && sheetEdge() && prefs.commands.autoExtendSheet) { abortFillet(null); return defaultCommand(); }
      if (!body) {
        // In Plasticity the default command goes when the selection stops being edges.
        if (c.auto && c.value === 0) return abortFillet(null);
        for (const v of [...c.vars]) dropVariable(v);
        c.limits = [];
        for (const o of [...limitMarks.children]) dispose(o);
        $('blend-limits').textContent = 0;
        c.body = null; c.edges = [];
        c.gizmo?.dispose(); c.gizmo = null;
        clearPreview();
        setTarget(null);
        $('blend-count').textContent = 0;
        $('blend-hint').textContent = 'CTRL+CLICK EDGES TO ROUND';
        return setHud('SELECT EDGES');
      }
      const edges = sel.list('edge').map(it => it.n).sort((a, b) => a - b);
      const moved = c.body !== body || String(edges) !== String(c.edges);
      for (const v of c.vars.filter(v => c.body !== body || !edges.includes(v.edge))) dropVariable(v);
      c.body = body; c.edges = edges;
      c.good = c.bad = null;
      failedEdges = [];
      setTarget(label(body));
      $('blend-count').textContent = edges.length;
      $('blend-hint').textContent = `${edges.length} EDGE${edges.length > 1 ? 'S' : ''} ON ${label(body)}`;
      if (moved || !c.gizmo) placeFilletDot();
      fetchSurfaces(c, body);
      previewFillet();
    };
    c.key = (action, e) => {
      if (action === 'distance') { c.auto = false; c.sign = 0; c.gizmo?.activate(lastPointer); return true; }
      if (action === 'chamfer') {
        c.auto = false; c.sign = -1;
        if (c.value > 0) setFillet(-c.value);
        c.gizmo?.activate(lastPointer);
        return true;
      }
      if (action === 'variable') {
        if (!(c.value > 0)) { toast('DRAG THE DOT OUT TO A ROUND FIRST'); return true; }
        c.auto = false;
        c.placing = 'variable';
        setHud('CLICK A ROUNDED EDGE · VARIABLE POINT');
        return true;
      }
      if (action === 'limit') {
        if (!(c.value > 0)) { toast('DRAG THE DOT OUT TO A ROUND FIRST'); return true; }
        c.auto = false;
        c.placing = 'limit';
        setHud(`CLICK A ROUNDED EDGE · LIMIT POINT ${Math.min(c.limits.length, 1) + 1} OF 2`);
        return true;
      }
      if (action === 'tangent') { setFilletTangent(!c.tangent); return true; }
      if (action === 'angle') {
        c.entry = { label: 'ANGLE °', text: '', apply: v => { if (v > 0 && v < 90) { c.angle = v; $('blend-angle').value = v; previewFillet(); } else toast('THE ANGLE MUST BE BETWEEN 0 AND 90'); } };
        setHud('ANGLE ° _');
        return true;
      }
      return false;
    };
    c.click = e => {
      const hit = pickAt(e);
      if (c.placing) {
        const what = c.placing;
        c.placing = null;
        if (hit?.kind !== 'edge' || hit.body !== c.body || !c.edges.includes(hit.n)) { toast('CLICK ONE OF THE ROUNDED EDGES'); previewFillet(); return true; }
        if (what === 'limit') addLimit(hit.n, hit.point);
        else addVariable(hit.n, hit.point);
        return true;
      }
      // Plasticity: click a round face (another fillet, a boss) and its radius becomes the distance.
      if (hit?.kind !== 'edge' && c.body !== null) {
        const h = raycaster.intersectObjects(shownMeshes(), false)[0];
        const body = h?.object.userData.id, n = h && h.object.userData.faceIds[h.faceIndex];
        const known = c.surfaces.get(body);
        if (h && !known) fetchSurfaces(c, body);
        const f = known?.[n];
        if (f?.kind === 'cylinder' || f?.kind === 'sphere' || f?.kind === 'round') {
          c.auto = false;
          if (c.shape === 'full') setFilletShape('round');
          setFillet(c.value < 0 ? -f.radius : f.radius, false);
          toast(`RADIUS ${+f.radius.toFixed(3)} COPIED`);
          return true;
        }
        if (h && !c.auto) { toast('CLICK A ROUND FACE TO COPY ITS RADIUS'); return true; }
      }
      // Ctrl+click (or Shift) adds or removes an edge; with nothing picked yet a plain click picks.
      if (hit?.kind !== 'edge') return !c.auto;
      if (e.ctrlKey || e.metaKey || e.shiftKey || !sel.list('edge').length) {
        sel.toggle({ kind: 'edge', body: hit.body, n: hit.n });
        for (const s of sel.list('solid')) sel.remove(s);
        selectionChanged();
        return true;
      }
      return !c.auto;
    };
    c.finish = () => commitFillet();
    c.abort = () => abortFillet('cancelled');
    c.cleanup = () => {
      c.gizmo?.dispose();
      for (const v of c.vars) v.gizmo.dispose();
      for (const o of [...limitMarks.children]) dispose(o);
      clearPreview();
      failedEdges = [];
      drawOverlays();
    };
    $('blend-distance').value = 0;
    $('blend-angle').value = c.angle;
    c.onSelection();
  }
  function abortFillet(state) {
    endCmd(state);
  }

  /** The dot sits at the middle of the last edge, pointing out between the faces that meet there. */
  function placeFilletDot() {
    const c = cmd;
    c.gizmo?.dispose();
    c.gizmo = null;
    const b = bodyOf(c.body), e = b?.edges[c.edges[c.edges.length - 1]];
    if (!e) return;
    const n = e.length / 3, mid = Math.floor((n - 1) / 2);
    const a = new THREE.Vector3().fromArray(e, mid * 3), d = new THREE.Vector3().fromArray(e, (mid + 1) * 3);
    const at = a.clone().lerp(d, 0.5), out = filletOut(b, e, at, d.clone().sub(a).normalize());
    if (!out) return;
    c.gizmo = dot(at, out, v => {
      if (c.sign < 0) v = -Math.abs(v);
      setFillet(snapping(lastPointer) ? Math.round(v / gridStep()) * gridStep() : v);
    }, () => refineFillet());
    c.gizmo.onStart = () => { controls.enabled = false; c.auto = false; c.dragVar = null; };
    c.gizmo.render(c.value);
  }

  /** A variable point on edge `n` nearest `near`, with a dot of its own for the radius there. */
  function addVariable(n, near) {
    const c = cmd, b = bodyOf(c.body), e = b?.edges[n];
    if (!e) return;
    let best = Infinity, at = null, tangent = null;
    for (let i = 3; i < e.length; i += 3) {
      const a = new THREE.Vector3().fromArray(e, i - 3), d = new THREE.Vector3().fromArray(e, i);
      const q = new THREE.Line3(a, d).closestPointToPoint(near, true, new THREE.Vector3());
      if (q.distanceTo(near) < best) { best = q.distanceTo(near); at = q; tangent = d.clone().sub(a).normalize(); }
    }
    const out = at && filletOut(b, e, at, tangent);
    if (!out) return;
    const v = { edge: n, point: at, scale: 1, gizmo: null };
    v.gizmo = dot(at, out, r => {
      r = Math.max(Math.abs(r), 1e-3);
      v.scale = r / c.value;
      c.dragVar = v;
      $('blend-vars').textContent = c.vars.length;
      previewFillet();
    });
    v.gizmo.onStart = () => { controls.enabled = false; };
    v.gizmo.render(c.value);
    c.vars.push(v);
    $('blend-vars').textContent = c.vars.length;
    setHud(`VARIABLE POINT ${c.vars.length} · DRAG ITS DOT`);
  }
  /**
   * A limit point on edge `n` nearest `near` (Plasticity's L). With two, the round runs only between
   * the planes square to the edge through them and ends flat; a third replaces the oldest.
   */
  function addLimit(n, near) {
    const c = cmd, e = bodyOf(c.body)?.edges[n];
    if (!e) return;
    let best = Infinity, at = null;
    for (let i = 3; i < e.length; i += 3) {
      const q = new THREE.Line3(new THREE.Vector3().fromArray(e, i - 3), new THREE.Vector3().fromArray(e, i)).closestPointToPoint(near, true, new THREE.Vector3());
      if (q.distanceTo(near) < best) { best = q.distanceTo(near); at = q; }
    }
    if (!at) return;
    if (c.limits.length === 2) c.limits.shift();
    c.limits.push({ edge: n, point: at });
    for (const o of [...limitMarks.children]) dispose(o);
    limitMarks.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(c.limits.map(l => l.point)), hullDots));
    $('blend-limits').textContent = c.limits.length;
    c.good = c.bad = null;
    if (c.limits.length < 2) setHud('L AGAIN FOR THE OTHER END');
    previewFillet();
  }
  function dropVariable(v) {
    const c = cmd;
    v.gizmo.dispose();
    c.vars.splice(c.vars.indexOf(v), 1);
    $('blend-vars').textContent = c.vars.length;
  }

  /** Out of the solid between the faces meeting at an edge, square to the edge at `at`. */
  function filletOut(b, e, at, tangent) {
    const out = new THREE.Vector3();
    b.facePlanes.forEach(p => {
      if (!p) return;
      const o = new THREE.Vector3(...p.origin), nrm = new THREE.Vector3(...p.normal);
      for (let i = 0; i < e.length; i += 3) if (Math.abs(new THREE.Vector3().fromArray(e, i).sub(o).dot(nrm)) > 1e-4) return;
      out.add(nrm);
    });
    if (out.lengthSq() < 1e-6) {
      const m = bodyMesh(b.id);
      m.geometry.computeBoundingBox();
      out.copy(at).sub(m.geometry.boundingBox.getCenter(new THREE.Vector3()));
    }
    out.addScaledVector(tangent, -out.dot(tangent)).normalize();
    return out.lengthSq() < 0.5 ? null : out;
  }

  /** Plasticity's Add Tangent Edges (T): off, the round keeps to the picked edges. */
  function setFilletTangent(on) {
    const c = cmd;
    if (c?.id !== 'fillet') return;
    c.tangent = on;
    $('blend-tangent').setAttribute('aria-pressed', String(on));
    if (!on && c.edges.length && !runEnds(c).length && c.limits.length !== 2) toast('THE PICKED EDGES CLOSE INTO A LOOP; THE ROUND RUNS ALL ROUND IT');
    c.good = c.bad = null;
    previewFillet();
  }

  /** Reads `body`'s face surfaces into the fillet command's cache (for copying a radius). */
  function fetchSurfaces(c, body) {
    if (!backend.faceSurfaces || body === undefined || c.surfaces.has(body)) return;
    c.surfaces.set(body, null);
    backend.faceSurfaces({ body }).then(list => c.surfaces.set(body, list), () => c.surfaces.delete(body));
  }

  function setFillet(v, fromGizmo = true) {
    const c = cmd;
    if (c?.id !== 'fillet') return;
    c.value = v;
    c.auto = c.auto && v === 0;
    if (!fromGizmo) c.gizmo?.render(v);
    // Variable points keep their share of the radius; a chamfer has none.
    for (const p of c.vars) { p.gizmo.visible = v > 0; if (v > 0) p.gizmo.render(v * p.scale); }
    if (document.activeElement !== $('blend-distance')) $('blend-distance').value = +v.toFixed(3);
    $('blend-kind').textContent = v < 0 ? 'CHAMFER' : (c.shape === 'g2' ? 'G2' : c.shape.toUpperCase());
    previewFillet();
  }

  const filletRequest = (c, v = c.value) => ({
    body: c.body, edges: c.edges, size: Math.abs(v), kind: v < 0 ? 'chamfer' : 'fillet', angle: c.angle * DEG,
    variable: v > 0 ? c.vars.map(p => ({ edge: p.edge, point: p.point.toArray(), scale: p.scale })) : [],
    shape: c.shape, tension: c.tension,
    limits: v > 0 && c.limits.length === 2 ? c.limits.map(l => l.point.toArray()) : v > 0 && !c.tangent ? runEnds(c) : [],
  });

  /**
   * With tangent edges off (T), the round stops at the ends of the picked edges instead of running
   * on along edges tangent to them: those ends as limit points (none for a closed loop).
   */
  function runEnds(c) {
    const body = bodyOf(c.body);
    if (!body) return [];
    const ends = [];
    for (const n of c.edges) {
      const e = body.edges[n];
      if (!e?.length) continue;
      for (const p of [e.slice(0, 3), e.slice(-3)]) {
        const at = ends.findIndex(q => Math.hypot(q.p[0] - p[0], q.p[1] - p[1], q.p[2] - p[2]) < 1e-6);
        if (at >= 0) ends[at].count++; else ends.push({ p, count: 1 });
      }
    }
    const open = ends.filter(q => q.count === 1).map(q => q.p);
    return open.length === 2 ? open : [];
  }

  /** Plasticity's fillet Shape: Round, Chordal (the distance spans the round), Conic or G2 (with Tension), or Full. */
  function setFilletShape(shape) {
    const c = cmd;
    if (c?.id !== 'fillet') return;
    c.shape = shape;
    for (const b of $$('[data-flshape]')) b.setAttribute('aria-pressed', String(b.dataset.flshape === shape));
    $('blend-tension-row').hidden = shape !== 'conic' && shape !== 'g2';
    if (c.value >= 0) $('blend-kind').textContent = shape === 'g2' ? 'G2' : shape.toUpperCase();
    c.good = c.bad = null;
    // A full round finds its own radius: any size will do, so preview straight away.
    if (shape === 'full' && c.value === 0) return setFillet(1, false);
    previewFillet();
  }

  async function previewFillet() {
    const c = cmd;
    if (c?.id !== 'fillet') return;
    const n = ++c.sent, v = c.value;
    if (c.body === null || v === 0) {
      clearPreview();
      setState('none');
      return setHud(c.body === null ? 'SELECT EDGES' : 'DRAG THE DOT · D C A');
    }
    // Past the size that failed (same sign), show the largest that worked; refined when the drag ends.
    if (c.good !== null && c.bad !== null && Math.sign(v) === Math.sign(c.bad) && Math.abs(v) >= Math.abs(c.bad)) {
      return setHud(`${v < 0 ? 'CHAMFER' : 'R'} ${Math.abs(c.good).toFixed(2)} MAX`);
    }
    setState('updating');
    const t0 = performance.now();
    let body;
    try { body = await backend.previewBlend(filletRequest(c, v)); }
    catch (e) {
      if (cmd !== c || n !== c.sent) return;
      if (c.good !== null && Math.sign(c.good) === Math.sign(v) && Math.abs(c.good) < Math.abs(v)) {
        c.bad = v;
        return setHud(`${v < 0 ? 'CHAMFER' : 'R'} ${Math.abs(c.good).toFixed(2)} MAX`);
      }
      // A size typed (or first dragged) too large: look for the largest that works and stop there.
      if (await largestFillet(c, v)) return;
      if (cmd !== c || n !== c.sent) return;
      // When the kernel can't say which edges failed, mark the whole selection.
      failedEdges = e.edges?.length ? e.edges : [...c.edges];
      clearPreview();
      drawOverlays();
      setState('failed');
      setHud(`${v < 0 ? 'CHAMFER' : 'ROUND'} FAILED`);
      $('blend-hint').textContent = say(e);
      return;
    }
    if (!body || cmd !== c || n < c.shown) return;
    c.shown = n;
    if (c.good === null || Math.sign(c.good) !== Math.sign(v) || Math.abs(v) > Math.abs(c.good)) c.good = v;
    if (c.bad !== null && Math.abs(v) >= Math.abs(c.bad)) c.bad = null;
    if (failedEdges.length) { failedEdges = []; drawOverlays(); }
    $('ms').textContent = Math.round(performance.now() - t0);
    clearPreview();
    showPreviewBody(body);
    const at = c.vars.includes(c.dragVar) ? ` · POINT ${c.vars.indexOf(c.dragVar) + 1} R ${(Math.abs(v) * c.dragVar.scale).toFixed(2)}` : '';
    setHud(v > 0 && c.shape === 'full' ? 'FULL ROUND' : `${v < 0 ? 'CHAMFER' : 'R'} ${Math.abs(v).toFixed(2)}${at}`);
    if (n === c.sent) setState('updated');
  }

  /**
   * A size that fails with nothing smaller tried yet: halve it until one works, then close in on
   * the largest that does. True when one was found (the fillet then stops there).
   */
  async function largestFillet(c, v) {
    const s = Math.sign(v);
    let lo = 0, hi = Math.abs(v), mid = hi / 2;
    for (let i = 0; i < 8 && !lo; i++, mid /= 2) {
      try { if (await backend.previewBlend(filletRequest(c, s * mid))) lo = mid; else hi = mid; } catch { hi = mid; }
      if (cmd !== c || c.value !== v) return true;
    }
    if (!lo) return false;
    c.good = s * lo; c.bad = v;
    await refineFillet();
    return true;
  }

  /** After a drag that went past what works, find the largest size that does and stop there (0.6.30). */
  async function refineFillet() {
    const c = cmd;
    if (c?.id !== 'fillet' || c.good === null || c.bad === null) return;
    let lo = Math.abs(c.good), hi = Math.abs(c.bad);
    const s = Math.sign(c.bad);
    for (let i = 0; i < 7 && hi - lo > 0.01; i++) {
      const mid = (lo + hi) / 2;
      try { if (await backend.previewBlend(filletRequest(c, s * mid))) lo = mid; } catch { hi = mid; }
      if (cmd !== c) return;
    }
    c.good = s * lo; c.bad = s * hi;
    c.gizmo?.render(s * lo);
    setFillet(s * lo, false);
  }

  async function commitFillet() {
    const c = cmd;
    if (c.body === null || c.value === 0) return abortFillet(c.auto ? null : 'cancelled');
    if (c.bad !== null && Math.abs(c.value) >= Math.abs(c.bad)) c.value = c.good;
    const req = filletRequest(c);
    const text = req.kind === 'fillet' && req.shape === 'full' ? `FILLET FULL ×${req.edges.length}`
      : `${req.kind === 'chamfer' ? 'CHAMFER' : req.shape === 'round' ? 'FILLET' : `FILLET ${req.shape === 'g2' ? 'G2' : req.shape.toUpperCase()}`} ${req.size.toFixed(2)} ×${req.edges.length}`;
    try {
      const { id, scene: list } = await backend.commitBlend(req);
      endCmd('committed');
      record(c.vars.length && req.kind === 'fillet' ? `${text} · ${c.vars.length} VARIABLE` : text, id);
      showScene(list);
      // Plasticity selects the result.
      sel.replace({ kind: 'solid', body: id });
      selectionChanged({ quiet: true });
    } catch (e) {
      failedEdges = e.edges ?? [];
      drawOverlays();
      setState('failed');
      toast(say(e));
    }
  }

  // --- move (G), rotate (R), scale (S) --------------------------------------
  // The handles drag; inside the command a key makes the cursor drive one value until a click
  // (Plasticity: X/Y/Z an axis, Shift+X/Y/Z a plane, G the screen; R the screen axis; S uniform),
  // and typing while it does sets the value exactly. The meshes follow as the preview, since a
  // rigid motion needs no kernel work; finishing sends one request, one undo step.
  function startTransform(kind, { follow = null, auto = false } = {}) {
    // A face's picked control points move on their own, not their body.
    const poles = sel.list('pole').filter(p => poleOf(p));
    // Faces on their own move and turn by themselves, their neighbours following (Move Face).
    // So do a solid's edges on their own, the flat faces beside them tilting (Move Edge).
    const fb = faceBody(), eb = fb === null ? edgeBody() : null;
    const faceMove = fb !== null ? { body: fb, faces: sel.list('face').map(it => it.n).sort((a, b) => a - b) }
      : eb !== null && bodyOf(eb) ? { body: eb, faces: [], edges: sel.list('edge').map(it => it.n).sort((a, b) => a - b) } : null;
    const what = faceMove?.edges ? 'EDGES' : 'FACES';
    if (faceMove && kind === 'scale') return toast(`${what} MOVE (G) AND TURN (R); SCALE THE WHOLE SOLID`);
    if (faceMove && !backend.previewMoveFaces) return toast(`${kind.toUpperCase()} OF ${what} IS NOT IN THIS BUILD YET`);
    const ids = faceMove ? [] : (sel.solids.length ? sel.solids : [...new Set(sel.list().filter(it => it.body !== undefined && it.kind !== 'pole').map(it => it.body))]).filter(id => org.shows(id));
    // Curves move whole; picked vertices (a NURBS curve's control points) move within their curve's plane.
    const curves = sel.curves.filter(curveById);
    const verts = sel.list('vertex').filter(v => curveById(v.id) && !curves.includes(v.id));
    if (!faceMove && !ids.length && !curves.length && !verts.length && !poles.length) return toast(`SELECT A SOLID, CURVE OR VERTEX TO ${kind.toUpperCase()}`);
    if ((curves.length || verts.length) && !backend.replaceCurves) return toast(`${kind.toUpperCase()} OF CURVES IS NOT IN THIS BUILD YET`);
    if (poles.length && !backend.previewMoveFacePoles) return toast(`${kind.toUpperCase()} OF SURFACE POINTS IS NOT IN THIS BUILD YET`);
    if (new Set(poles.map(p => p.body)).size > 1) return toast('PICK THE SURFACE POINTS OF ONE BODY AT A TIME');
    const vertexAt = v => { const src = curveById(v.id), [x, y] = curveVertices(src)[v.n]; return lift(curveFrame(src), { x, y }); };
    const box = new THREE.Box3();
    for (const id of ids) box.expandByObject(bodyMesh(id));
    for (const id of curves) { const src = curveById(id), f = curveFrame(src); for (const p of curve2d(src)) box.expandByPoint(lift(f, p)); }
    for (const v of verts) box.expandByPoint(vertexAt(v));
    for (const p of poles) box.expandByPoint(poleOf(p));
    if (faceMove) for (const n of faceMove.faces) box.expandByPoint(faceCentre(bodyOf(faceMove.body), n));
    if (faceMove?.edges) for (const n of faceMove.edges) {
      const e = bodyOf(faceMove.body).edges[n] ?? [];
      for (let i = 2; i < e.length; i += 3) box.expandByPoint(new THREE.Vector3(e[i - 2], e[i - 1], e[i]));
    }
    const pivot = box.getCenter(new THREE.Vector3());
    const handle = new THREE.Object3D();
    handle.position.copy(pivot);
    scene.add(handle);
    const tc = new TransformControls(camera, canvas);
    tc.setMode({ move: 'translate', rotate: 'rotate', scale: 'scale' }[kind]);
    tc.setSpace('local');
    tc.attach(handle);
    tc.addEventListener('dragging-changed', e => { controls.enabled = !e.value; if (e.value) { c.follow = null; c.auto = false; } });
    tc.addEventListener('objectChange', () => fromHandle());
    scene.add(tc.getHelper());
    const c = cmd = { id: kind, auto, ids, curves, verts, poles, faceMove, vertexAt, curveOut: null, poleMoves: null, poleRows: null, sent: 0, shown: 0, pivot, handle, tc, offset: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: 1, axis: 'z', follow: null,
      frame: new THREE.Quaternion(), orient: xfPrefs.orient, pivotMode: xfPrefs.pivot, pivotAt: null, picking: false };
    // Plasticity's pivots: the box round the selection (Bbox), the mean of the items' middles
    // (Median) or the item selected last (Active); V clicks a pivot of your own, Alt+V removes it.
    const items = [...ids.map(id => new THREE.Box3().setFromObject(bodyMesh(id)).getCenter(new THREE.Vector3())),
      ...curves.map(id => { const src = curveById(id), f = curveFrame(src), b = new THREE.Box3(); for (const q of curve2d(src)) b.expandByPoint(lift(f, q)); return b.getCenter(new THREE.Vector3()); }),
      ...verts.map(vertexAt), ...poles.map(poleOf),
      ...(faceMove?.faces ?? []).map(n => faceCentre(bodyOf(faceMove.body), n)).filter(Boolean)];
    const pivotFor = mode => mode === 'median' && items.length ? items.reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(items.length)
      : mode === 'active' && items.length ? items[items.length - 1].clone() : box.getCenter(new THREE.Vector3());
    /** Move the pivot to `p`, keeping what the transform does so far. */
    c.setPivot = p => {
      const d = p.clone().sub(c.pivot);
      c.offset.add(d.clone().multiplyScalar(c.scale).applyQuaternion(c.quat)).sub(d);
      c.pivot.copy(p);
      apply();
    };
    // Plasticity's orientations (W cycles them): Normal stands the gizmo on the selected face (or a
    // curve's plane), Pivot on the face where the pivot was clicked, Construction Plane on the plane.
    const normalOf = () => {
      if (faceMove?.faces?.length) { const f = faceFrame(bodyOf(faceMove.body), faceMove.faces[0]); if (f) return f.normal; }
      if (curves.length) return curveFrame(curveById(curves[0])).n;
      if (verts.length) return curveFrame(curveById(verts[0].id)).n;
      return null;
    };
    c.setOrient = o => {
      c.orient = xfPrefs.orient = o;
      const n = o === 'normal' ? normalOf() ?? cplane.normal : o === 'pivot' ? c.pivotAt?.normal ?? null : o === 'plane' ? cplane.normal : null;
      c.frame = n ? new THREE.Quaternion().setFromUnitVectors(UP, n.clone().normalize()) : new THREE.Quaternion();
      for (const b of $$('[data-xforient]')) b.setAttribute('aria-pressed', String(b.dataset.xforient === o));
      setAxis(c.axis);
      apply();
    };
    c.setPivotMode = m => {
      c.pivotMode = xfPrefs.pivot = m;
      for (const b of $$('[data-xfpivot]')) b.setAttribute('aria-pressed', String(b.dataset.xfpivot === m));
      if (!c.pivotAt) c.setPivot(pivotFor(m));
    };
    c.pickPivot = on => {
      c.picking = on;
      $('xf-pick').setAttribute('aria-pressed', String(on));
      if (on) setHud('CLICK WHERE THE PIVOT GOES');
      else apply();
    };
    c.removePivot = () => {
      c.pivotAt = null;
      c.pickPivot(false);
      if (c.orient === 'pivot') c.setOrient('pivot');
      c.setPivot(pivotFor(c.pivotMode));
    };
    lastTool = kind;
    showTool(kind);
    const moving = faceMove?.edges ?? faceMove?.faces ?? [];
    setTarget([...(faceMove ? [`${moving.length} ${what.slice(0, -1)}${moving.length > 1 ? 'S' : ''} OF ${label(faceMove.body)}`] : []), ...ids.map(label), ...curves.map(curveLabel), ...(verts.length ? [`${verts.length} VERTICES`] : []), ...(poles.length ? [`${poles.length} SURFACE POINT${poles.length > 1 ? 'S' : ''}`] : [])].join(' '));
    setState('none');
    setAxis('z');
    snapsFor(false);
    $$('[data-panel="pole-opts"]')[0].hidden = !poles.length;
    $$('[data-panel="xf-opts"]')[0].hidden = false;

    function fromHandle() {
      c.offset.copy(handle.position).sub(c.pivot);
      c.quat.copy(handle.quaternion).multiply(c.frame.clone().invert());
      if (kind === 'scale') {
        // Uniform only: take whichever component the drag changed.
        const s = handle.scale.toArray().reduce((a, b) => Math.abs(b - c.scale) > Math.abs(a - c.scale) ? b : a, c.scale);
        c.scale = Math.max(0.001, s);
      }
      apply();
    }
    c.key = (action, e) => {
      const p = lastPointer ?? centreEvent();
      if (action === 'orient') { const o = ['normal', 'pivot', 'plane', 'world']; c.setOrient(o[(o.indexOf(c.orient) + 1) % o.length]); return true; }
      if (action === 'pivot') { c.pickPivot(!c.picking); return true; }
      if (action === 'unpivot') { c.removePivot(); return true; }
      if (kind === 'move') {
        if ('xyz'.includes(action)) beginFollow({ type: 'axis', dir: frameAxis(c, action), name: action.toUpperCase() }, p);
        else if (['yz', 'xz', 'xy'].includes(action)) beginFollow({ type: 'plane', normal: frameAxis(c, 'xyz'.replace(action[0], '').replace(action[1], '')), name: action.toUpperCase() }, p);
        else if (action === 'screen') beginFollow({ type: 'plane', normal: null, name: 'SCREEN' }, p);
        else return false;
      } else if (kind === 'rotate') {
        if ('xyz'.includes(action)) { setAxis(action); beginFollow({ type: 'rotate', dir: frameAxis(c, action), name: action.toUpperCase() }, p); }
        else if (action === 'screen') beginFollow({ type: 'rotate', dir: null, name: 'SCREEN' }, p);
        else return false;
      } else if (action === 'uniform') beginFollow({ type: 'scale', name: 'UNIFORM' }, p);
      else return false;
      return true;
    };
    // Clicks don't change the selection while transforming, unless Move only came up by itself:
    // then a click selects as usual and Move follows the new selection.
    const untouched = () => c.offset.lengthSq() < 1e-18 && Math.abs(c.quat.w) > 1 - 1e-12 && Math.abs(c.scale - 1) < 1e-12;
    c.click = e => {
      if (c.picking) {
        const p = axisPointAt(e);
        if (!p) return true;
        ray(e);
        const hit = raycaster.intersectObjects(shownMeshes().filter(m => !c.ids.includes(m.userData.id)), false)[0];
        const n = hit?.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : null;
        c.pivotAt = { point: p, normal: n };
        c.pickPivot(false);
        c.setPivot(p);
        if (c.orient === 'pivot') c.setOrient('pivot');
        return true;
      }
      return !(c.auto && untouched());
    };
    c.onSelection = () => { if (!c.auto || !untouched()) return; endCmd(null); defaultCommand(); };
    c.finish = () => commitTransform();
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => {
      for (const id of ids) { const m = bodyMesh(id); if (m) { m.position.set(0, 0, 0); m.quaternion.identity(); m.scale.set(1, 1, 1); } }
      clearPreview();
      tc.detach();
      tc.getHelper().removeFromParent();
      tc.dispose();
      handle.removeFromParent();
      controls.enabled = true;
      if (poles.length) paintShownPoints();
    };
    for (const b of $$('[data-xfpivot]')) b.setAttribute('aria-pressed', String(b.dataset.xfpivot === c.pivotMode));
    $('xf-pick').setAttribute('aria-pressed', 'false');
    if (c.pivotMode !== 'bbox') c.pivot.copy(pivotFor(c.pivotMode));
    c.setOrient(c.orient);
    if (follow) c.key(follow);
  }

  /** User axis `a` of transform `c`'s gizmo, turned to its orientation. */
  const frameAxis = (c, a) => worldAxis(a).applyQuaternion(c?.frame ?? new THREE.Quaternion());

  function setAxis(a) {
    for (const b of $$('[data-axis]')) b.setAttribute('aria-pressed', b.dataset.axis === a);
    if (cmd?.id !== 'rotate') return;
    const angle = angleAbout(cmd.quat, a);
    cmd.axis = a;
    setAngle(angle);
  }
  /** The turn of `q` about a user axis, in degrees. */
  function angleAbout(q, a) {
    const ax = frameAxis(cmd, a);
    return Math.round(2 * Math.atan2(new THREE.Vector3(q.x, q.y, q.z).dot(ax), q.w) / DEG * 1e6) / 1e6;
  }
  function setAngle(deg) {
    const c = cmd;
    if (c?.id !== 'rotate') return;
    c.quat.setFromAxisAngle(frameAxis(c, c.axis), deg * DEG);
    apply();
  }
  function setOffset(user) {
    const c = cmd;
    if (c?.id !== 'move') return;
    c.offset.set(...toWorld(user));
    apply();
  }
  function setFactor(f) {
    const c = cmd;
    if (c?.id !== 'scale' || !(f > 0)) return;
    c.scale = f;
    apply();
  }
  function snapsFor(on) {
    const c = cmd;
    if (!c?.tc) return;
    c.tc.setTranslationSnap(on ? gridStep() : null);
    c.tc.setRotationSnap(on ? 15 * DEG : null);
    c.tc.setScaleSnap(on ? 0.1 : null);
  }

  /** The moved curves of transform `c`: whole curves, then curves with moved vertices. */
  function curvesMoved(c) {
    const { pivot, offset, quat, scale } = c;
    const rotate = v => new THREE.Vector3(...v).applyQuaternion(quat).toArray();
    const xf = { pivot: pivot.toArray(), offset: offset.toArray(), rotate, scale };
    const ids = [...c.curves], list = c.curves.map(id => transformCurve(curveById(id), xf));
    const at = p => p.clone().sub(pivot).multiplyScalar(scale).applyQuaternion(quat).add(pivot).add(offset).toArray();
    for (const id of new Set(c.verts.map(v => v.id))) {
      const moves = new Map(c.verts.filter(v => v.id === id).map(v => [v.n, at(c.vertexAt(v))]));
      ids.push(id);
      list.push(moveVerticesTo(curveById(id), moves));
    }
    return { ids, list };
  }

  /** Transform `c`'s face control points: the moves for the kernel, and the nets drawn moved. */
  function previewPoles(c) {
    const { pivot, offset, quat, scale } = c;
    const at = p => p.clone().sub(pivot).multiplyScalar(scale).applyQuaternion(quat).add(pivot).add(offset);
    const by = q => { const v = new THREE.Vector3(...q); return at(v).sub(v).toArray(); };
    c.poleMoves = poleMoves(facePoleCache.get(c.poles[0].body) ?? [], c.poles, by, poleOpts);
    c.poleRows = movedNets(c.poles[0].body, c.poleMoves);
    paintShownPoints();
    const moved = c.poleMoves.some(([, , d]) => Math.hypot(...d) > 1e-12);
    if (!moved) { clearPreview(); return; }
    livePreview(c, () => backend.previewMoveFacePoles({ body: c.poles[0].body, moves: c.poleMoves }), b => showPreviewBody(b));
  }
  /** Body `body`'s face nets with `moves` ([[face, n, by]]) applied, keyed `body:face`. */
  function movedNets(body, moves) {
    const out = new Map(), all = facePoleCache.get(body) ?? [];
    const rowsOf = face => {
      const key = `${body}:${face}`;
      if (!out.has(key)) out.set(key, (all[face] ?? []).map(r => r.map(q => [...q])));
      return out.get(key);
    };
    for (const [face, n, by] of moves) {
      const at = all[face]?.flat()[n];
      if (!at) continue;
      // The point moves wherever the body has it: a block's corner in each face, a seam twice.
      all.forEach((net, f) => net.flat().forEach((q, k) => {
        if (Math.hypot(q[0] - at[0], q[1] - at[1], q[2] - at[2]) > 1e-6) return;
        const rows = rowsOf(f), nv = rows[0]?.length ?? 1, p = rows[Math.floor(k / nv)]?.[k % nv];
        if (p) for (let i = 0; i < 3; i++) p[i] += by[i];
      }));
    }
    return out;
  }

  /** Preview: M = T(pivot + offset) · R · S · T(−pivot) on every target mesh, and the panel. */
  function apply() {
    const c = cmd;
    const { pivot, offset, quat, scale } = c;
    c.handle.position.copy(pivot).add(offset);
    c.handle.quaternion.copy(quat).multiply(c.frame ?? new THREE.Quaternion());
    c.handle.scale.setScalar(scale);
    for (const id of c.ids) {
      const m = bodyMesh(id);
      m.scale.setScalar(scale);
      m.quaternion.copy(quat);
      m.position.copy(pivot).add(offset).sub(pivot.clone().multiplyScalar(scale).applyQuaternion(quat));
    }
    if (c.curves.length || c.verts.length) {
      clearPreview();
      try {
        c.curveOut = curvesMoved(c);
        showCurvePreview(c.curveOut.list);
      } catch (e) { c.curveOut = null; setHud(say(e)); }
    }
    if (c.poles.length) previewPoles(c);
    if (c.faceMove) {
      if (offset.lengthSq() > 1e-18 || Math.abs(quat.w) < 1 - 1e-12) livePreview(c, () => backend.previewMoveFaces(faceMoveRequest(c)), b => showPreviewBody(b));
      else clearPreview();
    }
    const user = toUser(offset.toArray());
    for (const input of $$('[data-move]')) if (document.activeElement !== input) input.value = +user[input.dataset.move].toFixed(3);
    const angle = angleAbout(quat, c.axis);
    if (document.activeElement !== $('angle')) $('angle').value = +angle.toFixed(3);
    if (document.activeElement !== $('factor')) $('factor').value = +scale.toFixed(4);
    const lock = c.follow ? ` · ${c.follow.name}` : '';
    if (c.follow?.text) setHud(`${c.follow.name} ${c.follow.text}_`);
    else setHud(c.id === 'move' ? `Δ ${user.map(fmt).join(' ')}${lock}`
      : c.id === 'rotate' ? `${c.follow?.type === 'rotate' && c.follow.dir === null ? 'SCREEN' : c.axis.toUpperCase()} ${fmt(angle)}°${lock}`
        : `×${scale.toFixed(3)}${lock}`);
    const moved = offset.lengthSq() > 1e-18 || Math.abs(quat.w) < 1 - 1e-12 || Math.abs(scale - 1) > 1e-12;
    setState(moved ? 'updated' : 'none');
  }

  const centreEvent = () => { const r = canvas.getBoundingClientRect(); return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }; };

  /** The cursor drives one value until a click, Enter (keep) or Escape (put it back). */
  function beginFollow(f, e) {
    const c = cmd;
    f.base = { offset: c.offset.clone(), quat: c.quat.clone(), scale: c.scale };
    f.text = '';
    const camDir = camera.getWorldDirection(new THREE.Vector3());
    const at = c.pivot.clone().add(c.offset);
    if (f.type === 'axis') {
      // Intersect with the plane through the axis that faces the camera best.
      const n = f.dir.clone().cross(camDir).cross(f.dir).normalize();
      f.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n.lengthSq() > 1e-9 ? n : camDir, at);
    } else if (f.type === 'plane') {
      f.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(f.normal ?? camDir.clone().negate(), at);
    } else if (f.type === 'rotate') {
      f.dir = f.dir ?? camDir.clone().negate();
      f.centre = screenOf(at);
    } else f.centre = screenOf(at);
    f.start = followPoint(f, e);
    c.follow = f;
    apply();
  }
  function followPoint(f, e) {
    if (f.plane) {
      const s = snapping(e) && f.type !== 'rotate' ? snapNear(e, shownMeshes().filter(m => !cmd.ids.includes(m.userData.id))) : null;
      showSnap(s, e);
      if (s) return s.point;
      return ray(e).intersectPlane(f.plane, new THREE.Vector3()) ?? f.start ?? f.plane.coplanarPoint(new THREE.Vector3());
    }
    return local(e);
  }
  function followMove(e) {
    const c = cmd, f = c?.follow;
    if (!f || f.text) return;
    const p = followPoint(f, e);
    const snap = snapping(e), step = gridStep();
    if (f.type === 'axis') {
      let t = p.clone().sub(f.start).dot(f.dir);
      if (snap && !snapDot.visible) t = Math.round(t / step) * step;
      c.offset.copy(f.base.offset).addScaledVector(f.dir, t);
    } else if (f.type === 'plane') {
      const d = p.clone().sub(f.start);
      if (snap && !snapDot.visible) d.set(...d.toArray().map(v => Math.round(v / step) * step));
      c.offset.copy(f.base.offset).add(d);
    } else if (f.type === 'rotate') {
      const a0 = Math.atan2(-(f.start.y - f.centre.y), f.start.x - f.centre.x), a1 = Math.atan2(-(p.y - f.centre.y), p.x - f.centre.x);
      const toward = camera.position.clone().sub(c.pivot).dot(f.dir) >= 0 ? 1 : -1;
      let deg = (a1 - a0) / DEG * toward;
      if (snap) deg = Math.round(deg / 15) * 15;
      c.quat.setFromAxisAngle(f.dir, deg * DEG).multiply(f.base.quat);
    } else if (f.type === 'scale') {
      const d0 = Math.hypot(f.start.x - f.centre.x, f.start.y - f.centre.y) || 1, d1 = Math.hypot(p.x - f.centre.x, p.y - f.centre.y);
      let s = f.base.scale * d1 / d0;
      if (snap) s = Math.max(0.1, Math.round(s * 10) / 10);
      c.scale = Math.max(0.001, s);
    }
    apply();
  }
  function followTyped(f) {
    const c = cmd, v = typed(f.text);
    if (v === undefined) return apply();
    if (f.type === 'axis') c.offset.copy(f.base.offset).addScaledVector(f.dir, v);
    else if (f.type === 'rotate') c.quat.setFromAxisAngle(f.dir, v * DEG).multiply(f.base.quat);
    else if (f.type === 'scale') { if (v > 0) c.scale = v; }
    apply();
  }
  function endFollow(keep) {
    const c = cmd, f = c?.follow;
    if (!f) return;
    if (!keep) { c.offset.copy(f.base.offset); c.quat.copy(f.base.quat); c.scale = f.base.scale; }
    c.follow = null;
    showSnap(null);
    apply();
  }

  /** Transform `c`'s turn as an axis and an angle in radians. */
  function axisAngle(c) {
    const q = c.quat.clone().normalize();
    if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
    const angle = 2 * Math.acos(Math.min(1, q.w)), s = Math.sqrt(Math.max(0, 1 - q.w * q.w));
    return s < 1e-9 ? { axis: [0, 1, 0], angle: 0 } : { axis: [q.x / s, q.y / s, q.z / s], angle };
  }
  /** Move Face's request for transform `c`: turned about the pivot, then moved. */
  const faceMoveRequest = c => ({ ...c.faceMove, offset: c.offset.toArray(), pivot: c.pivot.toArray(), ...axisAngle(c) });

  async function commitTransform() {
    const c = cmd;
    endFollow(true);
    const moved = c.offset.lengthSq() > 1e-18 || Math.abs(c.quat.w) < 1 - 1e-12 || Math.abs(c.scale - 1) > 1e-12;
    if (!moved) return endCmd(c.auto ? null : 'cancelled');
    const { axis, angle } = axisAngle(c);
    const req = { bodies: c.ids, offset: c.offset.toArray(), pivot: c.pivot.toArray(), axis, angle, scale: c.scale };
    const user = toUser(req.offset);
    const text = c.id === 'move' ? `MOVE ${user.map(fmt).join(' ')}`
      : c.id === 'rotate' ? `ROTATE ${fmt(angle / DEG)}°` : `SCALE ×${c.scale.toFixed(3)}`;
    try {
      const out = c.curveOut;
      if ((c.curves.length || c.verts.length) && !out) throw new Error('those curves cannot be moved like that');
      let first = null;
      if (c.ids.length) {
        const { id, scene: list } = await backend.commitMotion(req);
        first = id;
        showScene(list);
      }
      let made = [];
      if (out) ({ ids: made } = await backend.replaceCurves(out.ids, out.list));
      if (c.poles.length) {
        const { id, scene: list } = await backend.commitMoveFacePoles({ body: c.poles[0].body, moves: c.poleMoves });
        first ??= id;
        await showScene(list);
      }
      if (c.faceMove) {
        const { id, scene: list } = await backend.commitMoveFaces(faceMoveRequest(c));
        first ??= id;
        await showScene(list);
      }
      endCmd('committed');
      record(text, first ?? made[0]);
      if (made.length) await curvesChanged(made);
    } catch (e) {
      setState('failed');
      toast(say(e));
    }
  }

  // --- push/pull (P) --------------------------------------------------------
  // Witness 3D's older quick sketch-and-extrude, now off the toolbar (Plasticity draws curves and
  // extrudes their regions instead): click a flat face or the plane to place a square or circle.
  let profileKind = 'rect', size = 10;
  const profile = () => profileKind === 'circle' ? { kind: 'circle', radius: size / 2 } : { kind: 'rect', width: size, height: size };
  function frameFor(normal) {
    const ref = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    return new THREE.Vector3().crossVectors(ref, normal).normalize();
  }
  function outlinePoints() {
    if (profileKind === 'circle') return new THREE.Path().absarc(0, 0, size / 2, 0, Math.PI * 2).getPoints(64);
    const h = size / 2;
    return [[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, y]) => new THREE.Vector2(x, y));
  }
  const outline = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: COLORS.accent, depthTest: false }));
  outline.renderOrder = 11;
  outline.visible = false;
  scene.add(outline);
  function placeOutline(origin, normal) {
    const x = frameFor(normal), y = new THREE.Vector3().crossVectors(normal, x);
    outline.geometry.setFromPoints(outlinePoints().map(p => origin.clone().addScaledVector(x, p.x).addScaledVector(y, p.y).addScaledVector(normal, 0.02)));
    outline.visible = true;
  }

  /** Where a sketch would go: on a flat face under the pointer, else on the construction plane. */
  function placeAt(e) {
    ray(e);
    const onPlane = (v, plane) => v.addScaledVector(plane.normal, -plane.distanceToPoint(v));
    const grid = v => snapping(e) ? v.set(...v.toArray().map(c => Math.round(c / gridStep()) * gridStep())) : v;
    const visible = shownMeshes();
    const hit = raycaster.intersectObjects(visible, false)[0];
    if (hit) {
      const { faceIds, facePlanes, id } = hit.object.userData;
      const face = faceIds[hit.faceIndex];
      const p = facePlanes[face];
      if (!p) return { curved: true };
      const normal = new THREE.Vector3(...p.normal);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(...p.origin));
      const s = e.altKey ? null : snapNear(e, [hit.object], plane);
      return { origin: onPlane(s ? s.point : grid(hit.point.clone()), plane), normal, target: id, face, snap: s };
    }
    const plane = planeOf();
    const at = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!at) return null;
    const s = e.altKey ? null : snapNear(e, visible, plane);
    return { origin: onPlane(s ? s.point : grid(at), plane), normal: cplane.normal.clone(), target: null, snap: s };
  }

  function startPushPull({ at = null } = {}) {
    const c = cmd = { id: 'pushpull', at: null, distance: 0, newBody: false, sent: 0, computed: 0, shown: 0, gizmo: null };
    lastTool = 'pushpull';
    showTool('pushpull');
    setState('none');
    setHud('CLICK A FACE OR THE PLANE');
    $('pp-hint').textContent = 'CLICK A FACE OR THE CONSTRUCTION PLANE';
    // A selected flat face places the sketch at once.
    const f = sel.list('face').at(-1), b = f && bodyOf(f.body), p = b?.facePlanes[f.n];
    if (!at && p) at = { origin: faceCentre(b, f.n), normal: new THREE.Vector3(...p.normal), target: b.id };
    c.move = e => {
      if (c.at) return;
      const hit = placeAt(e);
      showSnap(hit?.snap, e);
      if (hit && !hit.curved) placeOutline(hit.origin, hit.normal); else outline.visible = false;
    };
    c.click = async e => {
      const hit = placeAt(e);
      if (!hit) return true;
      if (hit.curved) { toast('PICK A FLAT FACE TO SKETCH ON'); return true; }
      if (c.at) { await finish(); startPushPull({ at: hit }); }
      else placeSketch(hit);
      return true;
    };
    c.key = action => {
      if (!c.at && action !== 'rect' && action !== 'circle') return false;
      if (action === 'distance') c.gizmo?.activate(lastPointer);
      else if (action === 'rect' || action === 'circle') setProfile(action);
      else setOperation(action);
      return true;
    };
    c.finish = () => commitPushPull();
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => { c.gizmo?.dispose(); outline.visible = false; clearPreview(); $('distance').value = '0'; $('distance').disabled = true; setOps(null); };
    if (at) placeSketch(at);
  }
  function placeSketch({ origin, normal, target }) {
    const c = cmd;
    c.at = { origin, normal, target };
    c.distance = 0;
    c.sent = c.computed = c.shown = 0;
    $('coalesced').textContent = '0→0';
    c.gizmo = dot(origin, normal, d => setDistance(snapping(lastPointer) ? Math.round(d / gridStep()) * gridStep() : d));
    placeOutline(origin, normal);
    showSnap(null);
    $('distance').disabled = false;
    $('pp-hint').textContent = 'DRAG THE DOT · Q JOIN · W CUT · B NEW';
    setTarget(target ? label(target) : cplane.name);
    setHud('+0.00');
    renderOutliner();
  }
  function setOps(outcome) { for (const b of $$('[data-op]')) b.setAttribute('aria-pressed', b.dataset.op === outcome); }
  function ppRequest(c) {
    const { origin, normal, target } = c.at;
    return { target, origin: origin.toArray(), normal: normal.toArray(), xAxis: frameFor(normal).toArray(), profile: profile(), distance: c.distance, newBody: c.newBody };
  }
  function setDistance(d) {
    const c = cmd;
    if (c?.id !== 'pushpull' || !c.at) return;
    c.distance = d;
    c.gizmo.render(d);
    if (document.activeElement !== $('distance')) $('distance').value = d.toFixed(2);
    updatePushPull();
  }
  async function updatePushPull() {
    const c = cmd;
    const n = ++c.sent;
    setState('updating');
    const t0 = performance.now();
    let p;
    try { p = await backend.preview(ppRequest(c)); }
    catch (e) { if (cmd === c) setState('failed'); toast(say(e)); return; }
    $('coalesced').textContent = `${c.sent}→${c.computed + (p ? 1 : 0)}`;
    if (!p) return;
    c.computed++;
    $('ms').textContent = Math.round(performance.now() - t0);
    if (cmd !== c || n < c.shown) return; // the command ended, or a newer answer is already on screen
    c.shown = n;
    clearPreview();
    if (p.result) showPreviewBody(p.result);
    if (p.tool) {
      const look = phantom[p.outcome === 'cut' ? 'cut' : 'add'];
      const m = meshOf(p.tool, look.face, look.edge);
      m.renderOrder = 5;
      previewGroup.add(m);
    }
    setOps(p.outcome);
    setHud(p.outcome === 'none' ? fmt(c.distance) : `${fmt(c.distance)} ${p.outcome.toUpperCase()}`);
    if (n === c.sent) setState('updated');
  }
  function setOperation(op) {
    const c = cmd;
    if (c?.id !== 'pushpull' || !c.at) return;
    if (op === 'new') c.newBody = !c.newBody;
    else {
      c.newBody = false;
      const d = Math.abs(c.distance) || gridStep();
      return setDistance(op === 'join' ? d : -d);
    }
    if (c.distance) updatePushPull();
  }
  function setProfile(kind) {
    profileKind = kind;
    for (const b of $$('[data-profile]')) b.setAttribute('aria-pressed', b.dataset.profile === kind);
    const c = cmd;
    if (c?.id === 'pushpull' && c.at) { placeOutline(c.at.origin, c.at.normal); renderOutliner(); if (c.distance) updatePushPull(); }
  }
  async function commitPushPull() {
    const c = cmd;
    if (!c.at || c.distance === 0) return endCmd('cancelled');
    const req = ppRequest(c);
    const text = `${fmt(req.distance)} ${c.newBody ? 'NEW' : req.distance > 0 ? 'JOIN' : 'CUT'}`;
    endCmd('committed');
    try {
      const { id, scene: list } = await backend.commit(req);
      record(text, id);
      showScene(list);
    } catch (e) { setState('failed'); toast(say(e)); }
  }

  // --- drawing: rectangle (Shift+Q), circle (Shift+W), line (Shift+A) ----------
  // Plasticity's curve tools. The first click lands on a flat face or the construction plane and
  // fixes the plane; snapping to points is on while drawing (Alt turns it off) and Ctrl rounds to
  // the grid. A rectangle is two corners (S square, C from the centre), a circle a centre and a
  // radius, a line a click per point: clicking its first point closes it, Enter or right-click
  // leaves it open, Ctrl+Z takes back a point. Tab types the size instead of the second click.
  // The result is a curve; a closed one has a region to extrude.
  const drawPreview = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: COLORS.accent, depthTest: false }));
  drawPreview.renderOrder = 20;
  drawPreview.frustumCulled = false;
  drawPreview.visible = false;
  scene.add(drawPreview);

  function startDraw(kind) {
    const c = cmd = { id: kind, plane: null, pts: [], cursor: null, square: false, centre: kind === 'center-rect', entry: null, sides: polygonSides, circumscribed: false, vertical: false, sweep: 0, turn: null, axis: null, tangent: null, flip: false };
    lastTool = kind;
    showTool(kind);
    setState('none');
    $('draw-rect').hidden = kind !== 'rect' && kind !== 'center-rect';
    $('draw-polygon').hidden = kind !== 'polygon';
    $('draw-vertical').hidden = kind !== 'polygon' && kind !== 'circle';
    for (const b of $$('[data-draw]')) b.setAttribute('aria-pressed', false);
    c.knife = false;
    c.move = e => {
      if (c.id === 'tangent-arc' && !c.plane) return;
      const p = drawPoint(e);
      showSnap(p?.snap, e);
      if (p && !p.curved) { c.cursor = p; drawShape(); }
    };
    c.click = e => {
      if (c.id === 'tangent-arc' && !c.plane) { tangentStart(e); return true; }
      const p = drawPoint(e);
      if (p?.curved) toast('DRAW ON A FLAT FACE OR THE CONSTRUCTION PLANE');
      else if (p) { addPoint(p, e); c.tanOrig = null; }
      return true;
    };
    c.key = action => {
      if (action === 'knife') {
        c.knife = !c.knife;
        $$('[data-draw="knife"]')[0].setAttribute('aria-pressed', c.knife);
        setHud(c.knife ? 'KNIFE: THE CURVE CUTS THE FACE IT IS DRAWN ON' : 'KNIFE OFF');
        return true;
      }
      if (action === 'square' || action === 'centre') {
        c[action] = !c[action];
        $(`draw-rect`).querySelector(`[data-draw="${action}"]`).setAttribute('aria-pressed', c[action]);
        drawShape();
        return true;
      }
      if (action === 'back') {
        c.pts.pop();
        if (!c.pts.length) c.plane = null;
        drawShape();
        return true;
      }
      if (action === 'more' || action === 'fewer') { setSides(c.sides + (action === 'more' ? 1 : -1)); return true; }
      if (action === 'vertical' && (c.id === 'polygon' || c.id === 'circle')) {
        c.vertical = !c.vertical;
        $('draw-vertical').querySelector('[data-draw="vertical"]').setAttribute('aria-pressed', c.vertical);
        drawShape();
        return true;
      }
      if (action === 'circumscribed') {
        c.circumscribed = !c.circumscribed;
        $('draw-polygon').querySelector('[data-draw="circumscribed"]').setAttribute('aria-pressed', c.circumscribed);
        drawShape();
        return true;
      }
      if (action === 'typed') { typeSize(); return true; }
      if (action === 'flip' && c.id === 'tangent-arc') { c.flip = !c.flip; drawShape(); return true; }
      if (action === 'switch' && (c.id === 'spline' || c.id === 'cv')) {
        // Tab: through-points and control points, keeping what's been clicked (manual: Control / Through-point).
        c.id = lastTool = c.id === 'spline' ? 'cv' : 'spline';
        showTool(c.id);
        drawShape();
        return true;
      }
      if (action.startsWith('axis-')) {
        // X, Y or Z keeps the next point on that axis through the last one (press again to free it).
        const a = action.slice(5);
        if (c.axis === a) c.axis = null;
        else if (c.plane && Math.hypot(worldAxis(a).dot(c.plane.x), worldAxis(a).dot(c.plane.y)) < 1e-6) return toast(`${a.toUpperCase()} IS ACROSS THE DRAWING PLANE`), true;
        else c.axis = a;
        drawShape();
        return true;
      }
      return false;
    };
    c.entryDone = () => c.entry ? setHud(`${c.entry.label} ${c.entry.text}_`) : drawShape();
    c.finish = () => finishDraw();
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => { drawPreview.visible = false; };
    drawShape();
  }

  // Regular Polygon remembers its number of sides, as in Plasticity.
  let polygonSides = 6;
  function setSides(n) {
    const c = cmd;
    if (c?.id !== 'polygon') return;
    c.sides = polygonSides = Math.max(3, Math.min(64, n));
    $('draw-sides').textContent = c.sides;
    drawShape();
  }

  /** The point under the pointer: on a face or the construction plane for the first, then in the drawing's plane. */
  function drawPoint(e) {
    const c = cmd;
    if (!c.plane) {
      const h = placeAt(e);
      if (!h || h.curved) return h;
      const x = frameFor(h.normal);
      return { plane: { o: h.origin.clone(), n: h.normal.clone(), x, y: new THREE.Vector3().crossVectors(h.normal, x), target: h.target, face: h.face }, uv: new THREE.Vector2(), snap: h.snap };
    }
    ray(e);
    const { o, n, x, y } = c.plane;
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, o);
    const at = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!at) return null;
    const from = c.pts?.length && c.pts.at(-1)?.isVector2 ? o.clone().addScaledVector(x, c.pts.at(-1).x).addScaledVector(y, c.pts.at(-1).y) : null;
    let s = e.altKey ? null : snapNear(e, shownMeshes(), plane, from);
    // Tan/Tan: a line begun on a circle or arc may end touching another one, its start sliding
    // round the first so the line touches both.
    if (c.id === 'line' && c.pts.length === 1) {
      const t = e.altKey ? null : tanTanSnap(e, (c.tanOrig ?? c.pts[0]), c.plane);
      if (t) {
        c.tanOrig ??= c.pts[0].clone();
        const ds = new THREE.Vector3(...t.start).sub(o);
        c.pts[0] = new THREE.Vector2(ds.dot(x), ds.dot(y));
        s = t;
      } else if (c.tanOrig) { c.pts[0] = c.tanOrig; c.tanOrig = null; }
    }
    const d = (s ? s.point : at).clone().sub(o);
    const uv = new THREE.Vector2(d.dot(x), d.dot(y));
    if (!s && snapping(e)) uv.set(Math.round(uv.x / gridStep()) * gridStep(), Math.round(uv.y / gridStep()) * gridStep());
    if (c.axis && c.pts.length) {
      const d = worldAxis(c.axis), du = d.dot(x), dv = d.dot(y), l2 = du * du + dv * dv, last = c.pts.at(-1);
      if (l2 > 1e-12) {
        const t = ((uv.x - last.x) * du + (uv.y - last.y) * dv) / l2;
        return { uv: new THREE.Vector2(last.x + t * du, last.y + t * dv), snap: null };
      }
    }
    return { uv, snap: s };
  }

  /** The Tan/Tan snap under the pointer for a line starting at `start` (plane coordinates), or null. */
  function tanTanSnap(e, start, pl) {
    if (!snapSettings.on || !snapAllowed('TAN/TAN', snapSettings, cmd?.snapSkip)) return null;
    const p0 = pl.o.clone().addScaledVector(pl.x, start.x).addScaledVector(pl.y, start.y).toArray();
    const n = pl.n.toArray(), dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const flat = q => q.radius && Math.abs(Math.abs(q.normal[0] * n[0] + q.normal[1] * n[1] + q.normal[2] * n[2]) - 1) < 1e-6;
    // On the circle, and for an arc on the part drawn (near its samples).
    const on = (q, p) => Math.abs(dist(p, q.center) - q.radius) < 1e-3 * Math.max(1, q.radius) && (!q.arc || q.pts.some(r => dist(r, p) < q.radius * 0.1 + 1e-3));
    const polys = curvePolys().polys.filter(flat), first = polys.find(q => on(q, p0));
    if (!first) return null;
    const c = local(e);
    let best = null, bestD = SNAP_PX;
    for (const q of polys) {
      if (q === first) continue;
      for (const { a, b } of commonTangents(first.center, first.radius, q.center, q.radius, n)) {
        if (!on(first, a) || !on(q, b)) continue;
        const sp = screenOf(new THREE.Vector3(...b));
        if (sp.behind) continue;
        const d = Math.hypot(sp.x - c.x, sp.y - c.y);
        if (d < bestD) { bestD = d; best = { point: new THREE.Vector3(...b), kind: 'TAN/TAN', start: a }; }
      }
    }
    return best;
  }

  /** Tangent Arc's first click: the end of an open curve, which it leaves along. */
  function tangentStart(e) {
    const c = cmd;
    ray(e);
    raycaster.params.Line.threshold = unitsPerPixel(controls.target) * 6;
    const hit = raycaster.intersectObjects(curveGroup.children.filter(o => o.userData.curve !== undefined), false)[0];
    const src = hit && curveList.find(k => k.id === hit.object.userData.curve);
    const ends = src ? [endTangent(src, false), endTangent(src, true)].filter(Boolean) : [];
    if (!ends.length) return toast(src ? 'PICK AN OPEN CURVE NEAR ONE OF ITS ENDS' : 'CLICK NEAR THE END OF A CURVE');
    const f = curveFrame(src), q = local(e);
    const far = ([p]) => { const s = screenOf(lift(f, { x: p[0], y: p[1] })); return Math.hypot(s.x - q.x, s.y - q.y); };
    const [p, dir] = ends.reduce((a, b) => far(b) < far(a) ? b : a);
    c.plane = { o: f.o, n: f.n, x: f.x, y: f.y, target: null };
    c.pts = [new THREE.Vector2(...p)];
    c.tangent = dir;
    c.cursor = { uv: c.pts[0].clone() };
    drawShape();
  }

  /** A rectangle's corners from its first click and the cursor, with S and C applied. */
  function rectCorners(a, b) {
    const c = cmd;
    let dx = b.x - a.x, dy = b.y - a.y;
    if (c.square) { const m = Math.max(Math.abs(dx), Math.abs(dy)); dx = (Math.sign(dx) || 1) * m; dy = (Math.sign(dy) || 1) * m; }
    if (c.centre) return [[a.x - dx, a.y - dy], [a.x + dx, a.y - dy], [a.x + dx, a.y + dy], [a.x - dx, a.y + dy]];
    return [[a.x, a.y], [a.x + dx, a.y], [a.x + dx, a.y + dy], [a.x, a.y + dy]];
  }

  /**
   * What the drawing would be with `pts` (the clicks so far plus the cursor): the points to show,
   * its size for the readout, and the curve once there are enough points (or an error).
   */
  function drawn(c, pts) {
    const P = pts.map(p => [p.x, p.y]), [a, b, q] = P, n = P.length;
    const d = (p, r) => Math.hypot(r[0] - p[0], r[1] - p[1]);
    const ring = (o, r) => new THREE.Path().absarc(o[0], o[1], r, 0, Math.PI * 2).getPoints(96).map(p => [p.x, p.y]);
    const line = () => ({ show: P, size: `L ${d(a, b).toFixed(2)}` });
    switch (c.id) {
      case 'rect': case 'center-rect': {
        const k = rectCorners(pts[0], pts[1]), w = Math.abs(k[1][0] - k[0][0]), h = Math.abs(k[2][1] - k[1][1]);
        return { show: [...k, k[0]], size: `${w.toFixed(2)} × ${h.toFixed(2)}`, curve: w > 1e-6 && h > 1e-6 ? { kind: 'polyline', points: k, closed: true } : 'THE RECTANGLE NEEDS A WIDTH AND A HEIGHT', text: `RECTANGLE ${w.toFixed(2)} × ${h.toFixed(2)}` };
      }
      case 'rect3': {
        if (n < 3) return line();
        const ux = (b[0] - a[0]) / d(a, b), uy = (b[1] - a[1]) / d(a, b), w = (q[0] - a[0]) * -uy + (q[1] - a[1]) * ux;
        const k = [a, b, [b[0] - uy * w, b[1] + ux * w], [a[0] - uy * w, a[1] + ux * w]];
        return { show: [...k, k[0]], size: `${d(a, b).toFixed(2)} × ${Math.abs(w).toFixed(2)}`, curve: d(a, b) > 1e-6 && Math.abs(w) > 1e-6 ? { kind: 'polyline', points: k, closed: true } : 'THE RECTANGLE NEEDS A WIDTH AND A HEIGHT', text: `RECTANGLE ${d(a, b).toFixed(2)} × ${Math.abs(w).toFixed(2)}` };
      }
      case 'circle': case 'circle2': {
        const up = c.id === 'circle' && c.vertical;
        const o = up ? [0, 0] : c.id === 'circle' ? a : [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], r = c.id === 'circle' ? d(a, b) : d(a, b) / 2;
        return { show: ring(o, r), frame: up ? standing(c, pts) : null, size: `⌀ ${(2 * r).toFixed(2)}`, curve: r > 1e-6 ? { kind: 'circle', center: o, radius: r } : 'THE CIRCLE NEEDS A RADIUS', text: `CIRCLE ⌀ ${(2 * r).toFixed(2)}${up ? ' VERTICAL' : ''}` };
      }
      case 'circle3': {
        if (n < 3) return line();
        const t = circleThrough(a, b, q);
        if (!t) return { show: P, size: '—', curve: 'THE THREE POINTS MUST NOT LIE ON A LINE' };
        return { show: ring(t.center, t.radius), size: `⌀ ${(2 * t.radius).toFixed(2)}`, curve: { kind: 'circle', center: t.center, radius: t.radius }, text: `CIRCLE ⌀ ${(2 * t.radius).toFixed(2)}` };
      }
      case 'arc3': {
        if (n < 3) return line();
        const show = arcPoints(a, q, b, 48), t = circleThrough(a, q, b);
        if (!show) return { show: P, size: '—', curve: 'THE THREE POINTS OF AN ARC MUST NOT LIE ON A LINE' };
        return { show, size: `R ${t.radius.toFixed(2)}`, curve: { kind: 'arc', start: a, mid: q, end: b }, text: `ARC R ${t.radius.toFixed(2)}` };
      }
      case 'arc': {
        if (n < 3) return { show: [a, b, ...ring(a, d(a, b))], size: `R ${d(a, b).toFixed(2)}` };
        const r = d(a, b), t0 = Math.atan2(b[1] - a[1], b[0] - a[0]), sw = c.sweep;
        const at = t => [a[0] + r * Math.cos(t0 + t), a[1] + r * Math.sin(t0 + t)];
        const show = Array.from({ length: 49 }, (_, i) => at(sw * i / 48));
        return { show, size: `R ${r.toFixed(2)} · ${(sw / DEG).toFixed(1)}°`, curve: r > 1e-6 && Math.abs(sw) > 1e-6 ? { kind: 'arc', start: at(0), mid: at(sw / 2), end: at(sw) } : 'THE ARC NEEDS A RADIUS AND AN ANGLE', text: `ARC R ${r.toFixed(2)} ${(sw / DEG).toFixed(1)}°` };
      }
      case 'polygon': {
        // V stands it up: in the plane through the centre that holds the cursor and the plane's normal.
        const k = c.vertical ? polygonCorners([0, 0], [0, d(a, b)], c.sides, c.circumscribed) : polygonCorners(a, b, c.sides, c.circumscribed);
        return { show: [...k, k[0]], frame: c.vertical ? standing(c, pts) : null, size: `${c.sides} · R ${d(a, b).toFixed(2)}`, curve: d(a, b) > 1e-6 ? { kind: 'polyline', points: k, closed: true } : 'THE POLYGON NEEDS A SIZE', text: `POLYGON ×${c.sides} R ${d(a, b).toFixed(2)}${c.vertical ? ' VERTICAL' : ''}` };
      }
      case 'ellipse': case 'ellipse3': {
        // Centre Ellipse: centre, end of an axis, then the width. Three Point: both ends of an axis, then the width.
        if (n < 3) return line();
        const o = c.id === 'ellipse' ? a : [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], major = [b[0] - o[0], b[1] - o[1]], R = Math.hypot(...major);
        const minor = R > 1e-9 ? Math.abs(major[0] * (q[1] - o[1]) - major[1] * (q[0] - o[0])) / R : 0;
        const ok = R > 1e-6 && minor > 1e-6;
        return { show: ok ? [...ellipsePoints(o, major, minor, 96), [o[0] + major[0], o[1] + major[1]]] : P, size: `${(2 * R).toFixed(2)} × ${(2 * minor).toFixed(2)}`, curve: ok ? { kind: 'ellipse', center: o, major, minor } : 'THE ELLIPSE NEEDS A LENGTH AND A WIDTH', text: `ELLIPSE ${(2 * R).toFixed(2)} × ${(2 * minor).toFixed(2)}` };
      }
      case 'tangent-arc': {
        if (n < 2) return line();
        const t = c.flip ? [-c.tangent[0], -c.tangent[1]] : c.tangent, arc = tangentArc(a, t, b);
        if (!arc) return { show: P, size: '—', curve: 'THE END CANNOT BE STRAIGHT AHEAD OF THE CURVE' };
        return { show: arcPoints(arc.start, arc.mid, arc.end, 48), size: `R ${arc.radius.toFixed(2)}`, curve: { kind: 'arc', start: arc.start, mid: arc.mid, end: arc.end }, text: `TANGENT ARC R ${arc.radius.toFixed(2)}` };
      }
      case 'spline':
        return { show: splinePreview(P, false), size: `×${c.pts.length}` };
      case 'cv':
        // The B-spline the kernels will make from these control points.
        return { show: P.length > 1 ? cvPoints(P, false, 16 * P.length) : P, size: `×${c.pts.length}` };
      default:
        return { show: P, size: `L ${d(P.at(-2), P.at(-1)).toFixed(2)}` };
    }
  }

  /**
   * The plane a circle or polygon stands in with V (Plasticity's vertical mode): through the centre,
   * holding the drawing plane's normal and the direction to the cursor.
   */
  function standing(c, pts) {
    const f = c.plane, a = lift(f, pts[0]), dir = lift(f, pts[1]).sub(a);
    if (dir.lengthSq() < 1e-18) dir.copy(f.x);
    dir.normalize();
    return { o: a, x: f.n.clone(), y: dir, n: new THREE.Vector3().crossVectors(f.n, dir) };
  }

  /** Center Point Arc: the angle swept so far, following the cursor round either way. */
  function trackSweep(c) {
    if (c.id !== 'arc' || c.pts.length < 2 || !c.cursor?.uv) return;
    const [a] = c.pts, u = c.cursor.uv, t = Math.atan2(u.y - a.y, u.x - a.x);
    if (c.turn !== null) {
      let dt = t - c.turn;
      while (dt > Math.PI) dt -= 2 * Math.PI;
      while (dt <= -Math.PI) dt += 2 * Math.PI;
      c.sweep = Math.max(-2 * Math.PI + 1e-3, Math.min(2 * Math.PI - 1e-3, c.sweep + dt));
    }
    c.turn = t;
  }

  function drawShape() {
    const c = cmd, f = c.plane;
    $('draw-points').textContent = c.pts.length;
    const need = CLICKS[c.id], left = need ? need - c.pts.length : 0;
    $('draw-hint').textContent = c.id === 'tangent-arc' ? (!f ? 'CLICK NEAR THE END OF A CURVE' : `CLICK FOR THE SIZE · D FLIPS${c.flip ? ' (FLIPPED)' : ''}`)
      : !f ? 'CLICK A FACE OR THE CONSTRUCTION PLANE'
      : c.axis ? `CLICK THE NEXT POINT · ALONG ${c.axis.toUpperCase()} (${c.axis.toUpperCase()} AGAIN FREES IT)`
      : c.id === 'rect' || c.id === 'center-rect' ? 'CLICK THE OTHER CORNER · TAB TYPES'
      : c.id === 'circle' ? `CLICK FOR THE RADIUS · TAB TYPES · V ${c.vertical ? 'FLAT' : 'VERTICAL'}`
      : c.id === 'polygon' ? `CLICK FOR THE SIZE · ↑ ↓ SIDES · V ${c.vertical ? 'FLAT' : 'VERTICAL'}`
      : c.id === 'arc' ? (left === 2 ? 'CLICK THE START · TAB TYPES THE RADIUS' : 'CLICK THE END · TAB TYPES THE ANGLE')
      : c.id === 'arc3' ? (left === 2 ? 'CLICK THE END' : 'CLICK A POINT ON THE ARC')
      : c.id === 'ellipse' ? (left === 2 ? 'CLICK THE END OF AN AXIS' : 'CLICK FOR THE WIDTH')
      : c.id === 'ellipse3' ? (left === 2 ? 'CLICK THE OTHER END OF THE AXIS' : 'CLICK FOR THE WIDTH')
      : need ? `CLICK ${left} MORE`
      : 'CLICK THE NEXT POINT · CLICK THE FIRST TO CLOSE';
    if (!f || !c.cursor?.uv) { drawPreview.visible = false; $('draw-size').textContent = '—'; return setHud(`${DRAW[c.id]} · ${c.id === 'tangent-arc' ? 'CLICK A CURVE END' : 'CLICK TO START'}`); }
    setTarget(f.target ? label(f.target) : cplane.name);
    trackSweep(c);
    const { show, size, frame } = drawn(c, [...c.pts, c.cursor.uv]);
    drawPreview.geometry.dispose();
    drawPreview.geometry = new THREE.BufferGeometry().setFromPoints(show.map(([u, v]) => lift(frame ?? f, { x: u, y: v }, frame ? 0 : 0.03)));
    drawPreview.visible = true;
    $('draw-size').textContent = size;
    setHud(size);
  }

  function addPoint(p, e) {
    const c = cmd;
    if (!c.plane) {
      c.plane = p.plane;
      c.pts = [p.uv];
      c.cursor = p;
      return drawShape();
    }
    const a = c.pts[0], b = p.uv;
    const need = CLICKS[c.id];
    if (need) {
      if (b.distanceTo(c.pts.at(-1)) < 1e-6) return;
      c.cursor = p;
      trackSweep(c);
      if (c.pts.length + 1 < need) { c.pts.push(b.clone()); if (c.id === 'arc') { c.sweep = 0; c.turn = null; } return drawShape(); }
      return commitDrawn([...c.pts, b]);
    }
    // A line or spline closes on its first point (within the snap distance on screen).
    if (c.pts.length >= 3) {
      const s = screenOf(lift(c.plane, a)), q = local(e);
      if (Math.hypot(s.x - q.x, s.y - q.y) < SNAP_PX) return commitLine(true);
    }
    if (b.distanceTo(c.pts.at(-1)) > 1e-6) c.pts.push(b.clone());
    drawShape();
  }

  /** Tab: type the size. Directions come from where the cursor is. */
  function typeSize() {
    const c = cmd;
    if (!c.plane) return toast('CLICK TO PLACE THE FIRST POINT, THEN TAB');
    const a = c.pts[0], b = c.cursor?.uv ?? a.clone().add(new THREE.Vector2(1, 1));
    const sx = Math.sign(b.x - a.x) || 1, sy = Math.sign(b.y - a.y) || 1;
    const dir = b.clone().sub(c.pts.at(-1));
    if (dir.lengthSq() < 1e-12) dir.set(1, 0);
    dir.normalize();
    const along = l => c.pts.at(-1).clone().addScaledVector(dir, l);
    if (c.id === 'rect' || c.id === 'center-rect') {
      const half = c.centre ? 0.5 : 1;
      c.entry = { label: 'WIDTH', text: '', apply: w => {
        c.entry = { label: 'HEIGHT', text: '', apply: h => commitRect(a, new THREE.Vector2(a.x + sx * Math.abs(w) * half, a.y + sy * Math.abs(h) * half)) };
      } };
    } else if (c.id === 'circle') {
      c.entry = { label: 'DIAMETER', text: '', apply: d => commitDrawn([a, along(Math.abs(d) / 2)]) };
    } else if (c.id === 'circle2') {
      c.entry = { label: 'DIAMETER', text: '', apply: d => commitDrawn([a, along(Math.abs(d))]) };
    } else if (c.id === 'polygon') {
      c.entry = { label: 'RADIUS', text: '', apply: r => commitDrawn([a, along(Math.abs(r))]) };
    } else if (c.id === 'rect3') {
      const width = () => { c.entry = { label: 'WIDTH', text: '', apply: w => {
        const [p, q] = c.pts, side = q.clone().sub(p).normalize();
        const cur = c.cursor?.uv ?? q, s = Math.sign((cur.x - p.x) * -side.y + (cur.y - p.y) * side.x) || 1;
        commitDrawn([p, q, q.clone().add(new THREE.Vector2(-side.y, side.x).multiplyScalar(s * Math.abs(w)))]);
      } }; };
      if (c.pts.length === 1) c.entry = { label: 'LENGTH', text: '', apply: l => { c.pts.push(along(Math.abs(l))); width(); } };
      else width();
    } else if (c.id === 'arc') {
      if (c.pts.length === 1) c.entry = { label: 'RADIUS', text: '', apply: r => { c.pts.push(along(Math.abs(r))); c.sweep = 0; c.turn = null; } };
      else c.entry = { label: 'ANGLE °', text: '', apply: v => { c.sweep = Math.max(-359.9, Math.min(359.9, v)) * DEG; commitDrawn([...c.pts, c.pts[1]]); } };
    } else if (CLICKS[c.id] || c.id === 'spline' || c.id === 'cv') {
      return toast('CLICK THE POINTS');
    } else {
      const last = c.pts.at(-1), dir = b.clone().sub(last);
      if (dir.lengthSq() < 1e-12) dir.set(1, 0);
      dir.normalize();
      c.entry = { label: 'LENGTH', text: '', apply: l => { c.pts.push(last.clone().addScaledVector(dir, l)); c.cursor = { uv: c.pts.at(-1).clone() }; } };
    }
    c.entryDone();
  }

  function curveOf(shape, frame = cmd.plane) {
    const { o, n, x } = frame;
    return { origin: o.toArray(), x: x.toArray(), normal: n.toArray(), ...shape };
  }
  function commitRect(a, b) {
    const k = rectCorners(a, b);
    if (Math.abs(k[1][0] - k[0][0]) < 1e-6 || Math.abs(k[2][1] - k[1][1]) < 1e-6) return toast('THE RECTANGLE NEEDS A WIDTH AND A HEIGHT');
    return commitCurve(curveOf({ kind: 'polyline', points: k, closed: true }), `RECTANGLE ${Math.abs(k[1][0] - k[0][0]).toFixed(2)} × ${Math.abs(k[2][1] - k[1][1]).toFixed(2)}`);
  }

  function commitLine(closed) {
    const c = cmd, points = c.pts.map(p => [p.x, p.y]);
    if (c.id === 'spline') return commitCurve(curveOf({ kind: 'spline', points, closed }), `SPLINE ×${c.pts.length}${closed ? ' CLOSED' : ''}`);
    if (c.id === 'cv') return commitCurve(curveOf({ kind: 'cv', points, closed }), `CV CURVE ×${c.pts.length}${closed ? ' CLOSED' : ''}`);
    return commitCurve(curveOf({ kind: 'polyline', points, closed }), `${closed ? 'POLYGON' : 'LINE'} ×${c.pts.length}`);
  }
  /** Finish a drawing with a fixed number of clicks, from all of them. */
  function commitDrawn(pts) {
    const d = drawn(cmd, pts);
    if (typeof d.curve === 'string') { cmd.pts = pts.slice(0, -1); drawShape(); return toast(d.curve); }
    return commitCurve(curveOf(d.curve, d.frame ?? cmd.plane), d.text);
  }
  async function finishDraw() {
    const c = cmd;
    if ((c.id === 'line' || c.id === 'spline' || c.id === 'cv') && c.pts.length >= 2) return commitLine(false);
    endCmd(c.plane ? 'cancelled' : null);
  }
  async function commitCurve(curve, text) {
    if (!backend.addCurves) { endCmd('failed'); return toast('DRAWING IS NOT IN THIS BUILD YET'); }
    const knife = cmd?.knife ? cmd.plane : null;
    endCmd('committed');
    try {
      const { ids } = await backend.addCurves([curve]);
      record(text, ids[0], curveLabel(ids[0]));
      if (knife) await knifeCut(knife, ids[0]);
      await loadCurves();
    } catch (e) { setState('failed'); toast(say(e)); }
  }
  /** Knife (K): the curve just drawn imprints the face it was drawn on and is used up; it stays when it cannot. */
  async function knifeCut(plane, curve) {
    if (plane.target == null || plane.face == null) return toast('KNIFE CUTS FACES; THAT CURVE WAS DRAWN ON THE CONSTRUCTION PLANE');
    if (!backend.commitImprint) return toast('KNIFE IS NOT IN THIS BUILD YET');
    try {
      const { id, scene: list } = await backend.commitImprint({ body: plane.target, faces: [plane.face], curves: [curve], consume: true });
      record('KNIFE', id);
      await showScene(list);
    } catch (e) { toast(`KNIFE: ${say(e)}`); }
  }

  // --- Spiral -------------------------------------------------------------------
  // Plasticity's Spiral: click the start of the axis, its end (X, Y or Z keeps it on that axis),
  // then the radius in the plane square to the axis at its end. The spiral then stays open to
  // adjust: Turns, Radius, Length, Angle (how steeply it climbs, tied to the pitch) and
  // handedness in the panel, A, D and R to type the angle, length and radius. Enter keeps it.
  function startSpiral() {
    const c = cmd = { id: 'spiral', step: 0, p1: null, p2: null, plane: null, axis: null, x: null, radius: 0, length: 0, turns: 4, left: false, at: null, entry: null };
    lastTool = 'spiral';
    showTool('spiral');
    setState('none');
    const hint = () => {
      $('spiral-hint').textContent = ['CLICK THE START OF THE AXIS', `CLICK THE END OF THE AXIS · X Y Z${c.axis ? ` (ALONG ${c.axis.toUpperCase()})` : ''}`, 'CLICK FOR THE RADIUS', 'A ANGLE · D LENGTH · R RADIUS · ⏎ OK'][c.step];
      for (const k of ['turns', 'radius', 'length']) if (document.activeElement !== $(`spiral-${k}`)) $(`spiral-${k}`).value = +c[k].toFixed(3);
      if (document.activeElement !== $('spiral-angle')) $('spiral-angle').value = c.length && c.radius ? +(spiralAngle(c) / DEG).toFixed(2) : 0;
      $$('[data-spiral="left"]')[0].setAttribute('aria-pressed', c.left);
    };
    /** The point for the click being made: on a face or the plane, then along the axis, then square to it. */
    const pointAt = e => {
      if (c.step === 0) return placeAt(e);
      ray(e);
      if (c.step === 1) {
        if (c.axis) {
          // The point on the axis line through the start nearest the pointer's ray.
          const d = worldAxis(c.axis), w = c.p1.clone().sub(raycaster.ray.origin), r = raycaster.ray.direction;
          const b = d.dot(r), den = 1 - b * b;
          if (den < 1e-9) return null;
          let t = (b * w.dot(r) - w.dot(d)) / den;
          if (snapping(e)) t = Math.round(t / gridStep()) * gridStep();
          return { origin: c.p1.clone().addScaledVector(d, t) };
        }
        const at = raycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(c.plane.n, c.p1), new THREE.Vector3());
        if (at && snapping(e)) at.set(...at.toArray().map(v => Math.round(v / gridStep()) * gridStep()));
        return at && { origin: at };
      }
      const n = c.p2.clone().sub(c.p1).normalize();
      const at = raycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, c.p2), new THREE.Vector3());
      if (!at) return null;
      const off = at.clone().sub(c.p2);
      let r = off.length();
      if (snapping(e)) r = Math.round(r / gridStep()) * gridStep();
      return { origin: at, radius: r, x: off.lengthSq() > 1e-12 ? off.normalize() : null };
    };
    const frame = () => { const n = c.p2.clone().sub(c.p1).normalize(); return { o: c.p1, x: c.x, y: new THREE.Vector3().crossVectors(n, c.x), n }; };
    const show = () => {
      hint();
      $('draw-points').textContent = c.step;
      let pts = [];
      if (c.step === 1 && c.at) pts = [c.p1, c.at.origin];
      if (c.step >= 2 && c.x && c.radius > 1e-9) { const f = frame(); pts = helixPoints(c, 48).map(([u, v, h]) => lift(f, { x: u, y: v }, h)); }
      drawPreview.geometry.dispose();
      drawPreview.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      drawPreview.visible = pts.length > 1;
      setHud(c.step >= 2 ? `R ${c.radius.toFixed(2)} · L ${c.length.toFixed(2)} · ×${+c.turns.toFixed(3)}` : c.step === 1 && c.at ? `L ${c.at.origin.distanceTo(c.p1).toFixed(2)}` : 'SPIRAL · CLICK TO START');
    };
    c.move = e => {
      if (c.step > 2) return;
      const p = pointAt(e);
      if (!p || p.curved) return;
      c.at = p;
      if (c.step === 2 && p.x) { c.x = p.x; c.radius = p.radius; }
      show();
    };
    c.click = e => {
      const p = pointAt(e);
      if (c.step > 2) return true;
      if (!p || p.curved) { toast('START ON A FLAT FACE OR THE CONSTRUCTION PLANE'); return true; }
      if (c.step === 0) { c.p1 = p.origin.clone(); c.plane = { n: p.normal.clone() }; setTarget(p.target != null ? label(p.target) : cplane.name); }
      else if (c.step === 1) {
        if (p.origin.distanceTo(c.p1) < 1e-6) return true;
        c.p2 = p.origin.clone();
        c.length = c.p2.distanceTo(c.p1);
        c.axis = null;
      } else {
        if (!p.x || !(p.radius > 1e-6)) return true;
        c.x = p.x; c.radius = p.radius;
        setState('updated');
      }
      c.step++;
      c.at = null;
      show();
      return true;
    };
    const set = (k, v) => {
      if (!(Number.isFinite(v) && v > 0)) return toast(`THE ${k.toUpperCase()} MUST BE GREATER THAN ZERO`);
      if (k === 'length') c.p2 = c.p1.clone().add(c.p2.clone().sub(c.p1).setLength(v));
      c[k] = v;
      if (k === 'length' || k === 'radius' || k === 'turns') show();
    };
    c.set = (k, v) => {
      if (c.step < 3) return toast('CLICK THE AXIS AND THE RADIUS FIRST');
      // The angle is the climb: keeping the length and radius, it sets the turns.
      if (k === 'angle') {
        if (!(v > 0 && v < 90)) return toast('THE ANGLE MUST BE BETWEEN 0 AND 90');
        return set('turns', c.length / (2 * Math.PI * c.radius * Math.tan(v * DEG)));
      }
      set(k, v);
    };
    c.key = action => {
      if (action.startsWith('axis-')) {
        if (c.step !== 1) return false;
        const a = action.slice(5);
        c.axis = c.axis === a ? null : a;
        show();
        return true;
      }
      if (['angle', 'length', 'radius'].includes(action)) {
        if (c.step < 3) { toast('CLICK THE AXIS AND THE RADIUS FIRST'); return true; }
        const name = { angle: 'ANGLE °', length: 'LENGTH', radius: 'RADIUS' }[action];
        c.entry = { label: name, text: '', apply: v => c.set(action, Math.abs(v)) };
        setHud(`${name} _`);
        return true;
      }
      if (action === 'left') { c.left = !c.left; show(); return true; }
      return false;
    };
    c.entryDone = () => { if (!c.entry) show(); };
    c.finish = () => {
      if (c.step < 3) return endCmd(c.step ? 'cancelled' : null);
      const n = c.p2.clone().sub(c.p1).normalize();
      return commitCurve({ origin: c.p1.toArray(), x: c.x.toArray(), normal: n.toArray(), kind: 'spiral', radius: c.radius, length: c.length, turns: c.turns, left: c.left }, `SPIRAL R ${c.radius.toFixed(2)} L ${c.length.toFixed(2)} ×${+c.turns.toFixed(3)}`);
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => { drawPreview.visible = false; };
    show();
  }

  // --- extrude (E) ------------------------------------------------------------
  // Plasticity's Extrude: select a region (its dot is there at once, the default command for
  // regions) or a flat face, and press E. Drag the dot or press D and type. It joins the body it
  // sits on going out and cuts going in; Q union, W difference and Shift+E intersect force the
  // boolean, B makes a new body. Enter, right-click or OK finishes and selects the result.
  const XOPS = ['union', 'difference', 'intersect', 'slice', 'new'];
  /** What E acts on: the last selected region or flat face, as { region | face, at, normal, target }. */
  function extrudeSource() {
    const it = sel.list().filter(i => i.kind === 'region' || i.kind === 'face').at(-1);
    if (!it) return null;
    if (it.kind === 'region') {
      // Every selected region goes together, those inside others cut out as holes.
      const all = sel.list('region').map(r => curveById(r.id)).filter(c => c && isClosed(c));
      if (all.length > 1) {
        const { first, more, holes } = regionsToExtrude(all.map(c => { const f = curveFrame(c); return { id: c.id, origin: f.o.toArray(), normal: f.n.toArray(), points: curve2d(c).map(p => lift(f, p).toArray()) }; }));
        const c = curveById(first), at = regionCentre(c), normal = curveFrame(c).n;
        return { region: first, more, holes, at, normal, target: bodyAt(at, normal), name: `${all.length} REGIONS${holes.length ? ` · ${holes.length} HOLE${holes.length > 1 ? 'S' : ''}` : ''}` };
      }
      const c = curveList.find(c => c.id === it.id);
      if (!c) return null;
      const at = regionCentre(c), normal = curveFrame(c).n;
      return { region: c.id, at, normal, target: bodyAt(at, normal), name: curveLabel(c.id) };
    }
    const b = bodyOf(it.body), p = b?.facePlanes[it.n];
    if (!p) return { curved: true };
    // The other selected flat faces of the same body go with it (Direct or Individual, I).
    const faces = sel.list('face').filter(f => f.body === it.body && f.n !== it.n && b.facePlanes[f.n]).map(f => f.n);
    return { face: it.n, faces, at: faceCentre(b, it.n), normal: new THREE.Vector3(...p.normal), target: b.id, name: `${faces.length ? `${faces.length + 1} FACES` : 'FACE'} · ${label(b.id)}` };
  }
  /** The body a region lies on: one whose face is under (or over) it. */
  function bodyAt(at, n) {
    for (const s of [1, -1]) {
      const rc = new THREE.Raycaster(at.clone().addScaledVector(n, 0.5 * s), n.clone().multiplyScalar(-s), 0, 1);
      const h = rc.intersectObjects(shownMeshes(), false)[0];
      if (h) return h.object.userData.id;
    }
    return null;
  }
  function startExtrude({ auto = false } = {}) {
    const src = extrudeSource();
    if (!src || src.curved) {
      if (!auto) toast(src?.curved ? 'EXTRUDE A FLAT FACE OR A REGION' : 'SELECT A REGION OR A FLAT FACE TO EXTRUDE');
      return;
    }
    const c = cmd = { id: 'extrude', auto, src, distance: 0, angle: 0, thickness: 0, lock: false, op: 'auto', direction: null, individual: false, picking: null, freeStart: null, pivot: src.at.clone(), outcome: null, sent: 0, shown: 0, gizmo: null, entry: null };
    lastTool = 'extrude';
    showTool('extrude');
    setState('none');
    setTarget(src.target ? label(src.target) : 'NEW BODY');
    $('ex-hint').textContent = `${src.name}${src.target ? ` ON ${label(src.target)}` : ''}`;
    $('ex-distance').value = 0;
    $('ex-angle').value = 0;
    $('ex-thickness').value = 0;
    $('ex-outcome').textContent = '—';
    setExtrudeOps();
    c.gizmo = dot(src.at, src.normal, d => setExtrude(snapping(lastPointer) ? Math.round(d / gridStep()) * gridStep() : d));
    c.gizmo.onStart = () => { controls.enabled = false; c.auto = false; c.dragVar = null; };
    c.onSelection = () => {
      drawOverlays();
      // The default command goes when the selection changes; a new region brings its own.
      if (!c.auto || c.distance !== 0) return;
      endCmd(null);
      defaultCommand();
    };
    c.key = action => {
      if (action === 'distance') { c.auto = false; c.gizmo.activate(lastPointer); return true; }
      // A and Shift+T take a typed value, as the dialog's Degrees and Thickness do.
      if (action === 'angle') {
        c.auto = false;
        c.entry = { label: 'ANGLE °', text: '', apply: v => setExtrudeShape({ angle: v }) };
        setHud('ANGLE ° _');
        return true;
      }
      if (action === 'thickness') {
        c.entry = { label: 'THICKNESS', text: '', apply: v => setExtrudeShape({ thickness: Math.abs(v) }) };
        setHud('THICKNESS _');
        return true;
      }
      if (action === 'lock') { setExtrudeShape({ lock: !c.lock }); return true; }
      // Freestyle (F): the next two clicks set the direction and distance. Pivot (V): the next
      // click places the gizmo. Individual (I): each face along its own normal.
      if (action === 'freestyle' || action === 'pivot') {
        c.auto = false;
        c.picking = c.picking === action || (action === 'freestyle' && c.picking === 'freestyle-end') ? null : action;
        c.freeStart = null;
        setExtrudeOps();
        setHud(c.picking === 'freestyle' ? 'CLICK THE START POINT' : c.picking === 'pivot' ? 'CLICK WHERE THE GIZMO GOES' : 'DRAG THE DOT');
        return true;
      }
      if (action === 'individual') {
        if (!c.src.faces?.length) { toast('INDIVIDUAL NEEDS TWO FACES OR MORE'); return true; }
        setExtrudeShape({ individual: !c.individual });
        return true;
      }
      if (!XOPS.includes(action)) return false;
      c.auto = false;
      c.op = c.op === action ? 'auto' : action;
      setExtrudeOps();
      if (c.distance) previewExtrude();
      return true;
    };
    c.entryDone = () => { if (!c.entry) previewExtrude(); };
    c.click = e => {
      if (!c.picking) return false;
      const p = axisPointAt(e);
      if (!p) return true;
      if (c.picking === 'pivot') {
        c.pivot = p;
        c.picking = null;
        c.gizmo.setFrame(c.pivot, c.direction ?? c.src.normal);
      } else if (c.picking === 'freestyle') {
        c.freeStart = p;
        c.picking = 'freestyle-end';
        setHud('CLICK THE END POINT');
        return true;
      } else {
        const d = p.clone().sub(c.freeStart);
        if (d.length() < 1e-6) return true;
        c.direction = d.clone().normalize();
        c.picking = null;
        c.gizmo.setFrame(c.pivot, c.direction);
        setExtrude(d.length(), false);
      }
      setExtrudeOps();
      return true;
    };
    c.finish = () => commitExtrude();
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => { c.gizmo?.dispose(); clearPreview(); };
    setHud(auto ? 'DRAG THE DOT · E EXTRUDE' : 'DRAG THE DOT · D · A ⇧T S · Q W ⇧E ⇧Q B');
  }
  function setExtrudeOps() {
    for (const b of $$('[data-xop]')) b.setAttribute('aria-pressed', cmd?.id === 'extrude' && cmd.op === b.dataset.xop);
    $('ex-lock').setAttribute('aria-pressed', cmd?.id === 'extrude' && cmd.lock);
    $('ex-free').setAttribute('aria-pressed', cmd?.id === 'extrude' && (!!cmd.direction || cmd.picking?.startsWith('freestyle')));
    $('ex-pivot').setAttribute('aria-pressed', cmd?.id === 'extrude' && cmd.picking === 'pivot');
    $('ex-individual').setAttribute('aria-pressed', cmd?.id === 'extrude' && cmd.individual);
    $('ex-individual').disabled = !(cmd?.id === 'extrude' && cmd.src.faces?.length);
  }
  /** Change the angle (degrees), thickness or both-sides lock, and preview again. */
  function setExtrudeShape(v) {
    const c = cmd;
    if (c?.id !== 'extrude') return;
    if (v.angle !== undefined && !(Math.abs(v.angle) < 90)) return toast('THE ANGLE MUST BE LESS THAN 90°');
    Object.assign(c, v);
    c.auto = false;
    if (document.activeElement !== $('ex-angle')) $('ex-angle').value = c.angle;
    if (document.activeElement !== $('ex-thickness')) $('ex-thickness').value = c.thickness;
    setExtrudeOps();
    if (c.distance) previewExtrude();
  }
  function setExtrude(d, fromGizmo = true) {
    const c = cmd;
    if (c?.id !== 'extrude') return;
    c.distance = d;
    c.auto = c.auto && d === 0;
    if (!fromGizmo) c.gizmo.render(d);
    if (document.activeElement !== $('ex-distance')) $('ex-distance').value = +d.toFixed(3);
    previewExtrude();
  }
  const extrudeRequest = c => ({
    target: c.src.target, ...(c.src.region !== undefined ? { region: c.src.region, moreRegions: c.src.more ?? [], holes: c.src.holes ?? [] } : { face: c.src.face, faces: c.src.faces ?? [], individual: c.individual }), distance: c.distance, op: c.op,
    back: c.lock ? Math.abs(c.distance) : 0, angle: c.angle * DEG, thickness: c.thickness,
    ...(c.direction && { direction: c.direction.toArray() }),
  });
  async function previewExtrude() {
    const c = cmd;
    const n = ++c.sent;
    if (!c.distance) { clearPreview(); setState('none'); return setHud('+0.00'); }
    setState('updating');
    const t0 = performance.now();
    let p;
    try { p = await backend.preview(extrudeRequest(c)); }
    catch (e) {
      if (cmd !== c || n !== c.sent) return;
      clearPreview();
      setState('failed');
      $('ex-outcome').textContent = 'FAILED';
      return setHud(say(e));
    }
    if (!p || cmd !== c || n < c.shown) return;
    c.shown = n;
    c.outcome = p.outcome;
    $('ms').textContent = Math.round(performance.now() - t0);
    clearPreview();
    if (p.result) showPreviewBody(p.result);
    if (p.tool) {
      const look = phantom[p.outcome === 'cut' || p.outcome === 'slice' ? 'cut' : 'add'];
      const m = meshOf(p.tool, look.face, look.edge);
      m.renderOrder = 5;
      previewGroup.add(m);
    }
    // A slice's cut-off part shows as the new body it will be.
    if (p.piece) { const m = meshOf(p.piece, phantom.add.face, phantom.add.edge); m.renderOrder = 6; previewGroup.add(m); }
    $('ex-outcome').textContent = p.outcome.toUpperCase();
    setHud(`${fmt(c.distance)} ${p.outcome === 'none' ? '' : p.outcome.toUpperCase()}`.trim());
    if (n === c.sent) setState('updated');
  }
  async function commitExtrude() {
    const c = cmd;
    if (!c.distance) return endCmd(c.auto ? null : 'cancelled');
    const req = extrudeRequest(c);
    try {
      const { id, scene: list } = await backend.commit(req);
      endCmd('committed');
      const extra = [c.lock && 'BOTH SIDES', c.angle && `${c.angle}°`, c.thickness && `T ${c.thickness}`, c.direction && 'FREESTYLE', c.individual && 'INDIVIDUAL'].filter(Boolean).join(' ');
      record(`EXTRUDE ${fmt(req.distance)}${extra ? ` ${extra}` : ''}${req.op === 'auto' ? '' : ` ${req.op.toUpperCase()}`}`, id);
      await showScene(list);
      sel.replace({ kind: 'solid', body: id });
      selectionChanged({ quiet: true });
    } catch (e) { setState('failed'); toast(say(e)); }
  }

  // --- boolean (Q) ------------------------------------------------------------
  // Plasticity's Boolean: select the target, then the tools, and press Q. Q union, W difference,
  // Shift+E intersect, Shift+Q slice (the target splits where each tool cuts it); T keeps the tools.
  // Region makes a solid of each part of space the bodies (solids and sheets) close off. The target
  // changes and the tools go.
  function startBoolean() {
    const ids = sel.solids.filter(id => org.shows(id));
    if (ids.length < 2) return toast('SELECT THE TARGET, THEN THE TOOLS');
    if (!backend.previewBoolean) return toast('BOOLEAN IS NOT IN THIS BUILD YET');
    const c = cmd = { id: 'boolean', target: ids[0], tools: ids.slice(1), op: 'union', keep: false, targetMaterial: 'default', toolMaterial: 'default', sent: 0, shown: 0 };
    lastTool = 'boolean';
    showTool('boolean');
    setState('none');
    setTarget(label(c.target));
    $('bool-hint').textContent = `TARGET ${label(c.target)}`;
    $('bool-tools').textContent = c.tools.map(label).join(' ');
    c.onSelection = () => drawOverlays();
    c.key = action => {
      if (action === 'keep') c.keep = !c.keep;
      else c.op = action;
      previewBooleanCmd();
      return true;
    };
    c.finish = () => commitBooleanCmd();
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => clearPreview();
    previewBooleanCmd();
  }
  async function previewBooleanCmd() {
    const c = cmd;
    for (const b of $$('[data-bop]')) b.setAttribute('aria-pressed', b.dataset.bop === c.op);
    for (const b of $$('[data-btmat]')) b.setAttribute('aria-pressed', b.dataset.btmat === c.targetMaterial);
    for (const b of $$('[data-bumat]')) b.setAttribute('aria-pressed', b.dataset.bumat === c.toolMaterial);
    $('bool-keep').setAttribute('aria-pressed', c.keep);
    const n = ++c.sent;
    setState('updating');
    const t0 = performance.now();
    let body;
    try { body = await backend.previewBoolean({ target: c.target, tools: c.tools, op: c.op === 'region' ? 'union' : c.op, region: c.op === 'region', targetMaterial: c.targetMaterial, toolMaterial: c.toolMaterial }); }
    catch (e) {
      if (cmd !== c || n !== c.sent) return;
      clearPreview();
      setState('failed');
      return setHud(say(e));
    }
    if (!body || cmd !== c || n < c.shown) return;
    c.shown = n;
    $('ms').textContent = Math.round(performance.now() - t0);
    clearPreview();
    showPreviewBody(body);
    // The tools show as phantoms unless they are kept; a slice's pieces as new bodies.
    if (!c.keep) for (const t of c.tools) {
      const m = bodyMesh(t), b = bodyOf(t);
      if (m) m.visible = false;
      const look = phantom[c.op === 'difference' || c.op === 'slice' ? 'cut' : 'add'];
      if (b) { const ph = meshOf(b, look.face, look.edge); ph.renderOrder = 5; previewGroup.add(ph); }
    }
    for (const piece of body.pieces ?? []) { const m = meshOf(piece, phantom.add.face, phantom.add.edge); m.renderOrder = 6; previewGroup.add(m); }
    const mats = [c.targetMaterial !== 'default' && `TARGET ${c.targetMaterial.toUpperCase()}`, c.toolMaterial !== 'default' && `TOOL ${c.toolMaterial.toUpperCase()}`].filter(Boolean).map(t => ` · ${t}`).join('');
    setHud(`${c.op.toUpperCase()}${c.op === 'region' ? ` · ${1 + (body.pieces?.length ?? 0)} SOLIDS` : ''}${mats}${c.keep ? ' · KEEP TOOLS' : ''}`);
    if (n === c.sent) setState('updated');
  }
  async function commitBooleanCmd() {
    const c = cmd;
    try {
      const { id, scene: list } = await backend.commitBoolean({ target: c.target, tools: c.tools, op: c.op === 'region' ? 'union' : c.op, region: c.op === 'region', targetMaterial: c.targetMaterial, toolMaterial: c.toolMaterial, keepTools: c.keep });
      endCmd('committed');
      record(`BOOLEAN ${c.op.toUpperCase()} ${c.tools.map(label).join(' ')}`, id);
      sel.clear();
      await showScene(list);
      sel.replace({ kind: 'solid', body: id });
      selectionChanged({ quiet: true });
    } catch (e) { setState('failed'); toast(say(e)); }
  }

  // --- offset face ------------------------------------------------------------
  // Plasticity's Offset Face (Push Face): select faces of one solid and the yellow dot is there at
  // once, the default command for faces. Drag it, or press D and type. The faces move along their
  // normals and the faces around them stretch to meet them; Shift or Ctrl+click adds or removes
  // faces. Enter, right-click or OK finishes. (Its A angle and Tab grow modes are not here yet.)
  function faceFrame(b, n) {
    const p = b.facePlanes[n];
    if (p) return { at: faceCentre(b, n), normal: new THREE.Vector3(...p.normal) };
    // A curved face: the display triangle nearest its centre, and that triangle's outward normal.
    const centre = faceCentre(b, n);
    if (!centre) return null;
    const { positions: pos, indices: ix, faceIds } = b;
    const a = new THREE.Vector3(), q = new THREE.Vector3(), r = new THREE.Vector3();
    let best = null;
    for (let t = 0; t < faceIds.length; t++) {
      if (faceIds[t] !== n) continue;
      a.fromArray(pos, ix[3 * t] * 3); q.fromArray(pos, ix[3 * t + 1] * 3); r.fromArray(pos, ix[3 * t + 2] * 3);
      const mid = a.clone().add(q).add(r).divideScalar(3), d = mid.distanceToSquared(centre);
      if (!best || d < best.d) best = { d, at: mid, normal: q.clone().sub(a).cross(r.clone().sub(a)).normalize() };
    }
    return best;
  }
  function startOffset({ auto = false } = {}) {
    const body = faceBody();
    if (body === null) return auto ? null : toast(sel.list('face').length ? 'OFFSET THE FACES OF ONE SOLID AT A TIME' : 'SELECT FACES TO OFFSET');
    if (!backend.previewOffset) return auto ? null : toast('OFFSET FACE IS NOT IN THIS BUILD YET');
    const c = cmd = { id: 'offset', auto, body, faces: [], distance: 0, angle: 0, grow: 'moving', sent: 0, shown: 0, gizmo: null };
    lastTool = 'offset';
    showTool('offset');
    setState('none');
    c.onSelection = () => {
      drawOverlays();
      const b = faceBody();
      if (b === null) {
        if (c.auto && c.distance === 0) { endCmd(null); return defaultCommand(); }
        return setHud('SELECT FACES');
      }
      const faces = sel.list('face').map(it => it.n).sort((x, y) => x - y);
      const moved = b !== c.body || String(faces) !== String(c.faces);
      c.body = b; c.faces = faces;
      setTarget(label(b));
      $('off-count').textContent = faces.length;
      $('off-hint').textContent = `${faces.length} FACE${faces.length > 1 ? 'S' : ''} ON ${label(b)}`;
      if (moved || !c.gizmo) {
        c.gizmo?.dispose();
        const f = faceFrame(bodyOf(b), faces.at(-1));
        c.gizmo = f && dot(f.at, f.normal, v => setOffsetDistance(snapping(lastPointer) ? Math.round(v / gridStep()) * gridStep() : v));
        if (c.gizmo) { c.gizmo.onStart = () => { controls.enabled = false; c.auto = false; }; c.gizmo.render(c.distance); }
      }
      previewOffsetCmd();
    };
    c.key = action => {
      if (action === 'distance') { c.auto = false; c.gizmo?.activate(lastPointer); return true; }
      if (action === 'angle') {
        // A: Angle Adjacent, the faces around lean (positive narrows the face).
        c.auto = false;
        c.entry = { label: 'ANGLE ADJACENT °', text: '', apply: v => setOffsetAngle(v) };
        setHud('ANGLE ADJACENT ° _');
        return true;
      }
      if (action === 'grow') { setOffsetGrow(GROWS[(GROWS.indexOf(c.grow) + 1) % GROWS.length]); return true; }
      return false;
    };
    c.click = e => {
      const hit = pickAt(e);
      // Dependent offset: Alt-click another face and the offset runs to meet it.
      if (hit?.kind === 'face' && e.altKey && !(hit.body === c.body && c.faces.includes(hit.n))) {
        const f = faceFrame(bodyOf(c.body), c.faces.at(-1));
        const d = f && distanceToFace(bodyOf(hit.body), hit.n, f.at.toArray(), f.normal.toArray());
        if (d == null) { toast('THAT FACE IS NOT IN LINE WITH THE OFFSET FACE'); return true; }
        c.auto = false;
        setOffsetDistance(Math.abs(d) < 1e-9 ? 0 : d, false);
        $('off-hint').textContent = `MATCHING ${label(hit.body)} · ${fmt(d)}`;
        return true;
      }
      if (hit?.kind !== 'face' || !(e.ctrlKey || e.metaKey || e.shiftKey)) return !c.auto;
      sel.toggle({ kind: 'face', body: hit.body, n: hit.n });
      for (const x of sel.list('solid')) sel.remove(x);
      selectionChanged();
      return true;
    };
    c.finish = () => commitOffsetCmd();
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => { c.gizmo?.dispose(); clearPreview(); };
    $('off-distance').value = 0;
    $('off-angle').value = 0;
    renderGrow();
    c.onSelection();
    setHud(auto ? 'DRAG THE DOT · D' : 'DRAG THE DOT, OR D AND TYPE');
  }
  function setOffsetDistance(d, fromGizmo = true) {
    const c = cmd;
    if (c?.id !== 'offset') return;
    c.distance = d;
    c.auto = c.auto && d === 0;
    if (!fromGizmo) c.gizmo?.render(d);
    if (document.activeElement !== $('off-distance')) $('off-distance').value = +d.toFixed(3);
    previewOffsetCmd();
  }
  function setOffsetAngle(deg) {
    const c = cmd;
    if (c?.id !== 'offset') return;
    if (!(Math.abs(deg) < 90)) return toast('THE ANGLE MUST BE BETWEEN -90 AND 90');
    c.angle = deg;
    if (document.activeElement !== $('off-angle')) $('off-angle').value = deg;
    previewOffsetCmd();
  }
  /** Offset Face's grow modes in Tab order (manual: Moving, Fixed, None). */
  const GROWS = ['moving', 'fixed', 'none'];
  function setOffsetGrow(g) {
    const c = cmd;
    if (c?.id !== 'offset') return;
    c.grow = g;
    renderGrow();
    toast(`GROW ${g.toUpperCase()}`);
    previewOffsetCmd();
  }
  function renderGrow() {
    for (const b of root.querySelectorAll('[data-grow]')) b.setAttribute('aria-pressed', String(b.dataset.grow === (cmd?.grow ?? 'moving')));
  }
  const offsetText = c => `${fmt(c.distance)}${c.angle ? ` · ${c.angle}°` : ''}${c.grow !== 'moving' ? ` · ${c.grow.toUpperCase()}` : ''}`;
  async function previewOffsetCmd() {
    const c = cmd;
    if (c?.id !== 'offset') return;
    const n = ++c.sent;
    if (!c.distance && !c.angle) { clearPreview(); setState('none'); return; }
    setState('updating');
    const t0 = performance.now();
    let body;
    try { body = await backend.previewOffset({ body: c.body, faces: c.faces, distance: c.distance, angle: c.angle * DEG, grow: c.grow }); }
    catch (e) {
      if (cmd !== c || n !== c.sent) return;
      clearPreview();
      setState('failed');
      $('off-hint').textContent = say(e);
      return setHud('OFFSET FAILED');
    }
    if (!body || cmd !== c || n < c.shown) return;
    c.shown = n;
    $('ms').textContent = Math.round(performance.now() - t0);
    clearPreview();
    showPreviewBody(body);
    setHud(offsetText(c));
    if (n === c.sent) setState('updated');
  }
  async function commitOffsetCmd() {
    const c = cmd;
    if ((!c.distance && !c.angle) || c.body === null) return endCmd(c.auto ? null : 'cancelled');
    try {
      const { id, scene: list } = await backend.commitOffset({ body: c.body, faces: c.faces, distance: c.distance, angle: c.angle * DEG, grow: c.grow });
      endCmd('committed');
      record(`OFFSET FACE ${offsetText(c)} ×${c.faces.length}`, id);
      await showScene(list);
      sel.replace({ kind: 'solid', body: id });
      selectionChanged({ quiet: true });
    } catch (e) { setState('failed'); toast(say(e)); }
  }

  // --- Round 7: Offset Curve, Fillet Curve, Trim and Explode ------------------------
  // The geometry is curveEdit.js, shared by both builds; the backend only stores the curves that
  // come out, so a preview here is exactly what OK makes. Each finish is one undo step.
  function showCurvePreview(list) {
    for (const c of list) {
      const f = curveFrame(c), pts = curve2d(c);
      const l = new (isClosed(c) ? THREE.LineLoop : THREE.Line)(new THREE.BufferGeometry().setFromPoints(pts.map(p => lift(f, p, 0.03))), curveMat.selected);
      l.renderOrder = 10;
      previewGroup.add(l);
    }
  }
  /** Toggle Curvature's combs on curves of a preview, scaled to them alone. */
  function showCombPreview(list) {
    const combs = list.map(c => { try { return { c, comb: curvatureComb(c) }; } catch { return null; } }).filter(Boolean);
    const kMax = Math.max(1e-12, ...combs.flatMap(x => x.comb.map(t => t.k)));
    const box = new THREE.Box3();
    for (const { c, comb } of combs) { const f = curveFrame(c); for (const t of comb) box.expandByPoint(lift(f, { x: t.at[0], y: t.at[1] })); }
    const scale = combScale() * 0.25 * box.getSize(new THREE.Vector3()).length() / kMax;
    for (const { c, comb } of combs) {
      const f = curveFrame(c), at = p => lift(f, { x: p[0], y: p[1] }, 0.04);
      const teeth = [], envelope = [];
      for (const t of comb) {
        const tip = [t.at[0] + t.dir[0] * t.k * scale, t.at[1] + t.dir[1] * t.k * scale];
        teeth.push(at(t.at), at(tip));
        envelope.push(at(tip));
      }
      const tl = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(teeth), combMat), el = new THREE.Line(new THREE.BufferGeometry().setFromPoints(envelope), combMat);
      tl.renderOrder = el.renderOrder = 11;
      previewGroup.add(tl, el);
    }
  }
  const curveById = id => curveList.find(c => c.id === id);
  async function curvesChanged(made) {
    await loadCurves();
    sel.clear();
    for (const id of made) sel.add({ kind: curveList.find(c => c.id === id && isClosed(c)) ? 'region' : 'curve', id });
    selectionChanged({ quiet: true });
  }

  function startCurveEdit(id) {
    const ids = sel.curves.filter(curveById);
    const offset = id === 'offset-curve';
    // With curve vertices picked instead of curves, Offset Curve is Offset Vertex (manual: Sketch › Offset Vertex).
    if (offset && !ids.length && sel.list('vertex').length) return startOffsetVertex();
    // Edges of a solid: Offset Edge; faces: Offset Face Loop (manual: Solid › Offset Edge, Offset Face Loop).
    if (offset && !ids.length && (edgeBody() !== null || faceBody() !== null)) return startEdgeOffset();
    if (!ids.length) return toast(`SELECT A CURVE TO ${offset ? 'OFFSET' : 'FILLET'}`);
    if (!backend.addCurves || (!offset && !backend.replaceCurves)) return toast(`${toolInfo(id).label} IS NOT IN THIS BUILD YET`);
    const field = offset ? 'oc-d' : 'fc-r', hint = offset ? 'oc-hint' : 'fc-hint';
    // Offset Curve's S (lock distances: both sides) and F (freestyle: a click sets the distance).
    const c = cmd = { id, ids, out: null, both: false, placing: false, slot: false, combined: false, gizmo: null };
    lastTool = id;
    showTool(id);
    setState('none');
    setTarget(ids.length === 1 ? curveLabel(ids[0]) : `${ids.length} CURVES`);
    const corner = () => OFFSET_CORNERS.find(k => $(`oc-${k}`).getAttribute('aria-pressed') === 'true') ?? 'linear';
    c.compute = () => {
      const list = c.each();
      // Offset Region I: the closed results merge where they overlap.
      if (!offset || !c.combined) return list;
      const closed = list.filter(isClosed);
      return closed.length > 1 ? [...list.filter(x => !isClosed(x)), ...unionLoops(closed)] : list;
    };
    c.each = () => ids.flatMap(cid => {
      const src = curveById(cid), d = num(field);
      if (!offset) return [filletCurve(src, d)];
      // Offset Region O: an open curve becomes a slot round it, closed by half circles.
      if (c.slot && !isClosed(src)) return [offsetSlot(src, Math.abs(d), corner())];
      return c.both ? [offsetCurve(src, d, corner()), offsetCurve(src, -d, corner())] : [offsetCurve(src, d, corner())];
    });
    c.preview = () => {
      clearPreview();
      c.gizmo?.render(num(field));
      for (const [k, on] of [['oc-lock', c.both], ['oc-free', c.placing], ['oc-slot', c.slot], ['oc-combine', c.combined]]) if (offset) $(k).setAttribute('aria-pressed', String(on));
      try {
        c.out = c.compute();
        showCurvePreview(c.out);
        $(hint).textContent = `${ids.length} CURVE${ids.length > 1 ? 'S' : ''}`;
        setHud(c.placing ? 'CLICK WHERE THE OFFSET GOES' : `${toolInfo(id).label} ${num(field)} MM${offset ? ` · ${corner().toUpperCase()}${c.both ? ' · BOTH SIDES' : ''}${c.slot ? ' · SLOT' : ''}${c.combined ? ' · COMBINED' : ''}` : ''}`);
        setState('updated');
      } catch (e) { c.out = null; $(hint).textContent = say(e); setHud(`${toolInfo(id).label} FAILED`); setState('failed'); }
    };
    if (offset) {
      // The yellow dot sits on the first curve, pointing the way a positive distance goes.
      const src = curveById(ids[0]), f = curveFrame(src), pts = curve2d(src);
      try {
        const mid = pts[Math.floor(pts.length / 2)], ahead = curve2d(offsetCurve(src, 1, corner()));
        const near = ahead.reduce((a, b) => (b.distanceTo(mid) < a.distanceTo(mid) ? b : a));
        const dir = lift(f, near).sub(lift(f, mid)).normalize();
        c.gizmo = dot(lift(f, mid), dir, v => { $(field).value = +v.toFixed(3); c.preview(); });
      } catch { c.gizmo = null; }
    }
    c.click = e => {
      if (!c.placing) return false;
      const src = curveById(ids[0]), f = curveFrame(src);
      ray(e);
      const p = raycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(f.n, f.o), new THREE.Vector3());
      if (!p) return true;
      const d = p.sub(f.o);
      try { $(field).value = +offsetThrough(src, [d.dot(f.x), d.dot(f.y)], corner()).toFixed(3); }
      catch (err) { toast(say(err)); return true; }
      c.placing = false;
      c.preview();
      return true;
    };
    c.key = action => {
      if (offset && action === 'corner') {
        const next = OFFSET_CORNERS[(OFFSET_CORNERS.indexOf(corner()) + 1) % OFFSET_CORNERS.length];
        for (const k of OFFSET_CORNERS) $(`oc-${k}`).setAttribute('aria-pressed', k === next);
        c.preview();
        return true;
      }
      if (offset && action === 'lock') { c.both = !c.both; c.preview(); return true; }
      if (offset && action === 'combine') { c.combined = !c.combined; c.preview(); return true; }
      if (offset && action === 'slot') { c.slot = !c.slot; c.preview(); return true; }
      if (offset && action === 'freestyle') { c.placing = !c.placing; c.preview(); return true; }
      if (action !== 'distance' && action !== 'radius') return false;
      c.entry = { label: action.toUpperCase(), text: '', apply: v => { $(field).value = v; c.preview(); } };
      setHud(`${action.toUpperCase()} _`);
      return true;
    };
    c.finish = async () => {
      if (!c.out) return toast($(hint).textContent);
      try {
        const { ids: made } = offset ? await backend.addCurves(c.out) : await backend.replaceCurves(ids, c.out);
        endCmd('committed');
        record(`${toolInfo(id).label} ${num(field)} MM`, made[0], curveLabel(made[0]));
        await curvesChanged(made);
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => { c.gizmo?.dispose(); clearPreview(); };
    c.preview();
  }

  /**
   * Plasticity's Offset Vertex: new vertices the distance along the curve either side of each
   * picked vertex; the curve keeps its shape. The dot at the first vertex drags the distance.
   */
  function startOffsetVertex() {
    if (!backend.replaceCurves) return toast('OFFSET VERTEX IS NOT IN THIS BUILD YET');
    const picked = sel.list('vertex').filter(v => curveById(v.id));
    const c = cmd = { id: 'offset-vertex', out: null, gizmo: null };
    lastTool = 'offset-curve';
    showTool('offset-vertex');
    setState('none');
    const curves = [...new Set(picked.map(v => v.id))];
    setTarget(curves.length === 1 ? curveLabel(curves[0]) : `${curves.length} CURVES`);
    // Per curve, its vertices from the last back, so earlier numbers hold while new ones go in.
    c.compute = () => curves.map(id => picked.filter(v => v.id === id).map(v => v.n).sort((a, b) => b - a)
      .reduce((cur, n) => offsetVertex(cur, n, num('ov-d')), curveById(id)));
    c.preview = () => {
      clearPreview();
      c.gizmo?.render(num('ov-d'));
      try {
        c.out = c.compute();
        showCurvePreview(c.out);
        $('ov-hint').textContent = `${picked.length} VERT${picked.length > 1 ? 'ICES' : 'EX'} ON ${curves.length} CURVE${curves.length > 1 ? 'S' : ''}`;
        setHud(`OFFSET VERTEX ${num('ov-d')} MM`);
        setState('updated');
      } catch (e) { c.out = null; $('ov-hint').textContent = say(e); setHud('OFFSET VERTEX FAILED'); setState('failed'); }
    };
    {
      // The dot sits on the first vertex, pointing along the curve to the next one.
      const first = picked[0], src = curveById(first.id), f = curveFrame(src), vs = curveVertices(src);
      const here = vs[first.n], next = vs[first.n + 1] ?? (isClosed(src) ? vs[0] : vs[first.n - 1]);
      if (here && next) {
        const at = lift(f, { x: here[0], y: here[1] }), dir = lift(f, { x: next[0], y: next[1] }).sub(at).normalize();
        c.gizmo = dot(at, dir, v => { $('ov-d').value = +Math.abs(v).toFixed(3); c.preview(); });
      }
    }
    c.key = action => {
      if (action !== 'distance') return false;
      c.entry = { label: 'DISTANCE', text: '', apply: v => { $('ov-d').value = v; c.preview(); } };
      setHud('DISTANCE _');
      return true;
    };
    c.finish = async () => {
      if (!c.out) return toast($('ov-hint').textContent);
      try {
        const { ids: made } = await backend.replaceCurves(curves, c.out);
        endCmd('committed');
        record(`OFFSET VERTEX ${num('ov-d')} MM`, made[0], curveLabel(made[0]));
        await curvesChanged(made);
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => { c.gizmo?.dispose(); clearPreview(); };
    c.preview();
  }

  /**
   * Plasticity's Slide Curve CV (Shift+G): the picked control points of spline and control point
   * curves slide along the control cage (U, Shift+U the other way) or across it (N). Drag the dot or
   * press D and type; Enter or right-click applies.
   */
  function startSlide() {
    if (sel.list('pole').length) return startSlideSurface();
    if (!backend.replaceCurves) return toast('SLIDE IS NOT IN THIS BUILD YET');
    const picked = sel.list('vertex').filter(v => ['cv', 'spline', 'nurbs'].includes(curveById(v.id)?.kind));
    if (!picked.length) return toast('SELECT CONTROL POINTS OF A SPLINE OR CONTROL POINT CURVE TO SLIDE');
    const c = cmd = { id: 'slide', dir: 'u', out: null, gizmo: null };
    lastTool = 'slide';
    showTool('slide');
    for (const b of $$('[data-sldir$="v"]')) b.hidden = true;
    setState('none');
    const curves = [...new Set(picked.map(v => v.id))];
    setTarget(curves.length === 1 ? curveLabel(curves[0]) : `${curves.length} CURVES`);
    c.compute = () => curves.map(id => slideCurveCVs(curveById(id), picked.filter(v => v.id === id).map(v => v.n), num('sl-d'), c.dir));
    const buttons = () => { for (const b of $$('[data-sldir]')) b.setAttribute('aria-pressed', String(b.dataset.sldir === c.dir)); };
    // The dot sits on the first point and points the way it slides.
    const place = () => {
      c.gizmo?.dispose();
      c.gizmo = null;
      const first = picked[0], src = curveById(first.id), f = curveFrame(src);
      const [moved] = [slideCurveCVs(src, [first.n], 1, c.dir)];
      const here = curveVertices(src)[first.n], there = curveVertices(moved)[first.n];
      const at = lift(f, { x: here[0], y: here[1] }), dir = lift(f, { x: there[0], y: there[1] }).sub(at).normalize();
      c.gizmo = dot(at, dir, v => { $('sl-d').value = +v.toFixed(3); c.preview(); });
    };
    c.preview = () => {
      clearPreview();
      c.gizmo?.render(num('sl-d'));
      try {
        c.out = c.compute();
        showCurvePreview(c.out);
        $('sl-hint').textContent = `${picked.length} CONTROL POINT${picked.length > 1 ? 'S' : ''} ON ${curves.length} CURVE${curves.length > 1 ? 'S' : ''}`;
        setHud(`SLIDE ${c.dir.toUpperCase()} ${num('sl-d')} MM`);
        setState(num('sl-d') ? 'updated' : 'none');
      } catch (e) { c.out = null; $('sl-hint').textContent = say(e); setHud('SLIDE FAILED'); setState('failed'); }
    };
    c.setDir = d => { c.dir = d; buttons(); try { place(); } catch { /* the hint says why */ } c.preview(); };
    c.key = action => {
      if (action === 'u' || action === '-u' || action === 'n') { c.setDir(action); return true; }
      if (action !== 'distance') return false;
      c.entry = { label: 'DISTANCE', text: '', apply: v => { $('sl-d').value = v; c.preview(); } };
      setHud('DISTANCE _');
      return true;
    };
    c.finish = async () => {
      if (!c.out) return toast($('sl-hint').textContent);
      if (!num('sl-d')) return endCmd(null);
      try {
        const { ids: made } = await backend.replaceCurves(curves, c.out);
        endCmd('committed');
        record(`SLIDE ${c.dir.toUpperCase()} ${num('sl-d')} MM`, made[0], curveLabel(made[0]));
        await curvesChanged(made);
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => { c.gizmo?.dispose(); clearPreview(); };
    $('sl-d').value = 0;
    buttons();
    try { place(); } catch { /* the preview says why */ }
    c.preview();
  }

  /**
   * Plasticity's Slide Surface CV (Shift+G with a face's control points picked, shown by Toggle
   * Points): they slide along the face's control net in u or v (U, V; Shift the other way) or
   * across it (N), by the dragged dot or a typed distance (D), with a live preview of the face.
   */
  function startSlideSurface() {
    if (!backend.previewMoveFacePoles) return toast('SLIDE SURFACE CV IS NOT IN THIS BUILD YET');
    const picked = sel.list('pole').filter(p => poleOf(p));
    if (!picked.length) return toast('SELECT CONTROL POINTS OF A FACE TO SLIDE');
    const body = picked[0].body;
    if (picked.some(p => p.body !== body)) return toast('PICK THE SURFACE POINTS OF ONE BODY AT A TIME');
    const c = cmd = { id: 'slide', dir: 'u', moves: null, poleRows: null, gizmo: null, sent: 0, shown: 0 };
    lastTool = 'slide';
    showTool('slide');
    $('tool-name').textContent = $('status-tool').textContent = 'SLIDE SURFACE CV';
    for (const b of $$('[data-sldir$="v"]')) b.hidden = false;
    setState('none');
    setTarget(label(body));
    const faces = [...new Set(picked.map(p => p.face))];
    const rowsOf = face => facePoleCache.get(body)?.[face] ?? [];
    c.compute = d => faces.flatMap(face => slidePoles(rowsOf(face), picked.filter(p => p.face === face).map(p => p.n), d, c.dir).map(([n, by]) => [face, n, by]));
    const buttons = () => { for (const b of $$('[data-sldir]')) b.setAttribute('aria-pressed', String(b.dataset.sldir === c.dir)); };
    // The dot sits on the first point and points the way it slides.
    const place = () => {
      c.gizmo?.dispose();
      c.gizmo = null;
      const first = picked[0], at = poleOf(first);
      const [[, by]] = slidePoles(rowsOf(first.face), [first.n], 1, c.dir);
      c.gizmo = dot(at, new THREE.Vector3(...by).normalize(), v => { $('sl-d').value = +v.toFixed(3); c.preview(); });
    };
    const text = () => `SLIDE ${c.dir.toUpperCase()} ${num('sl-d')} MM`;
    c.preview = () => {
      c.gizmo?.render(num('sl-d'));
      try {
        c.moves = c.compute(num('sl-d'));
        c.poleRows = movedNets(body, c.moves);
        paintShownPoints();
      } catch (e) { c.moves = null; $('sl-hint').textContent = say(e); setHud('SLIDE FAILED'); return setState('failed'); }
      $('sl-hint').textContent = `${picked.length} CONTROL POINT${picked.length > 1 ? 'S' : ''} ON ${faces.length} FACE${faces.length > 1 ? 'S' : ''} OF ${label(body)}`;
      setHud(text());
      if (!num('sl-d')) { clearPreview(); return setState('none'); }
      livePreview(c, () => backend.previewMoveFacePoles({ body, moves: c.moves }), b => showPreviewBody(b), 'sl-hint');
    };
    c.setDir = d => { c.dir = d; buttons(); try { place(); } catch { /* the hint says why */ } c.preview(); };
    c.key = action => {
      if (['u', '-u', 'v', '-v', 'n'].includes(action)) { c.setDir(action); return true; }
      if (action !== 'distance') return false;
      c.entry = { label: 'DISTANCE', text: '', apply: v => { $('sl-d').value = v; c.preview(); } };
      setHud('DISTANCE _');
      return true;
    };
    c.finish = async () => {
      if (!c.moves) return toast($('sl-hint').textContent);
      if (!num('sl-d')) return endCmd(null);
      try {
        const { id, scene: list } = await backend.commitMoveFacePoles({ body, moves: c.moves });
        endCmd('committed');
        record(`SLIDE SURFACE CV ${c.dir.toUpperCase()} ${num('sl-d')} MM`, id, `${picked.length} SURFACE POINT${picked.length > 1 ? 'S' : ''}`);
        await showScene(list);
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => { c.gizmo?.dispose(); clearPreview(); paintShownPoints(); };
    $('sl-d').value = 0;
    buttons();
    try { place(); } catch { /* the preview says why */ }
    c.preview();
  }

  /**
   * Plasticity's Fillet Vertex (B with curve vertices picked): the picked corners rounded, or
   * chamfered when the dot is dragged the other way (D and C type them). Negative radius = chamfer.
   */
  function startFilletVertex() {
    if (!backend.replaceCurves) return toast('FILLET VERTEX IS NOT IN THIS BUILD YET');
    const picked = sel.list('vertex').filter(v => curveById(v.id));
    if (!picked.length) return toast('SELECT CURVE VERTICES TO FILLET');
    const c = cmd = { id: 'fillet-vertex', out: null, gizmo: null };
    lastTool = 'fillet';
    showTool('fillet-vertex');
    setState('none');
    const curves = [...new Set(picked.map(v => v.id))];
    setTarget(curves.length === 1 ? curveLabel(curves[0]) : `${curves.length} CURVES`);
    const value = () => num('fv-r');
    c.compute = () => curves.map(id => filletCurve(curveById(id), Math.abs(value()), picked.filter(v => v.id === id).map(v => v.n), value() < 0));
    c.preview = () => {
      clearPreview();
      c.gizmo?.render(value());
      const v = value(), shape = v < 0 ? 'CHAMFER' : 'ROUND';
      $('fv-shape').textContent = shape;
      if (!v) { c.out = null; setState('none'); return setHud('DRAG THE DOT · D C'); }
      try {
        c.out = c.compute();
        showCurvePreview(c.out);
        $('fv-hint').textContent = `${picked.length} VERT${picked.length > 1 ? 'ICES' : 'EX'} ON ${curves.length} CURVE${curves.length > 1 ? 'S' : ''}`;
        setHud(`${shape} ${Math.abs(v)} MM`);
        setState('updated');
      } catch (e) { c.out = null; $('fv-hint').textContent = say(e); setHud(`${shape} FAILED`); setState('failed'); }
    };
    {
      // The dot sits on the first corner, pointing into it along the bisector: in rounds, out chamfers.
      const first = picked[0], src = curveById(first.id), f = curveFrame(src), vs = curveVertices(src), k = vs.length;
      const closed = isClosed(src), here = vs[first.n];
      const prev = vs[first.n - 1] ?? (closed ? vs[k - 1] : null), next = vs[first.n + 1] ?? (closed ? vs[0] : null);
      if (here && prev && next) {
        const at = lift(f, { x: here[0], y: here[1] });
        const u = lift(f, { x: prev[0], y: prev[1] }).sub(at).normalize(), w = lift(f, { x: next[0], y: next[1] }).sub(at).normalize();
        const dir = u.add(w);
        if (dir.length() > 1e-9) c.gizmo = dot(at, dir.normalize(), v => { $('fv-r').value = +v.toFixed(3); c.preview(); });
      }
    }
    c.key = action => {
      if (action !== 'distance' && action !== 'chamfer') return false;
      const chamfer = action === 'chamfer';
      c.entry = { label: chamfer ? 'CHAMFER DISTANCE' : 'FILLET DISTANCE', text: '', apply: v => { $('fv-r').value = chamfer ? -Math.abs(v) : Math.abs(v); c.preview(); } };
      setHud(`${chamfer ? 'CHAMFER' : 'FILLET'} DISTANCE _`);
      return true;
    };
    c.finish = async () => {
      if (!c.out) return value() ? toast($('fv-hint').textContent) : endCmd('cancelled');
      try {
        const { ids: made } = await backend.replaceCurves(curves, c.out);
        endCmd('committed');
        record(`FILLET VERTEX ${value() < 0 ? 'CHAMFER' : 'R'} ${Math.abs(value())} MM`, made[0], curveLabel(made[0]));
        await curvesChanged(made);
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => { c.gizmo?.dispose(); clearPreview(); };
    $('fv-r').value = 0;
    c.preview();
  }

  /**
   * Plasticity's Align Vertex and Align Curve (continuity): the target curve's end moves onto the
   * reference (its end, or the point at Parameter along it) and carries it on in G0, G1 or G2 (Tab),
   * its first control points moved (alignCurveEnd). Two curve ends picked as vertices (target, then
   * reference), or two curves selected (the ends nearest each other).
   */
  async function startAlignCurve(picked = null) {
    if (cmd) await finish();
    if (!backend.replaceCurves) return toast('ALIGN IS NOT IN THIS BUILD YET');
    if (!picked) {
      const ids = sel.curves.filter(curveById);
      if (ids.length !== 2) return toast('SELECT THE CURVE TO MOVE, THEN THE CURVE TO MEET');
      // The pair of ends nearest each other.
      const endPoint = (id, e) => { const src = curveById(id), vs = curveVertices(src), [x, y] = vs[e ? vs.length - 1 : 0]; return lift(curveFrame(src), { x, y }); };
      let best = null;
      for (const endT of [0, 1]) for (const endR of [0, 1]) {
        const d = endPoint(ids[0], endT).distanceTo(endPoint(ids[1], endR));
        if (!best || d < best.d) best = { d, endT, endR };
      }
      picked = { target: ids[0], reference: ids[1], endT: best.endT, endR: best.endR };
    }
    const { target, reference, endT, endR } = picked;
    const c = cmd = { id: 'align-curve', out: null, continuity: 'G1', comb: true };
    lastTool = 'align-curve';
    showTool('align-curve');
    setState('none');
    setTarget(`${curveLabel(target)} → ${curveLabel(reference)}`);
    $('ac-p').value = endR;
    const buttons = () => {
      for (const b of $$('[data-accont]')) b.setAttribute('aria-pressed', String(b.dataset.accont === c.continuity));
      $('ac-comb').setAttribute('aria-pressed', String(c.comb));
      $('ac-constrain').setAttribute('aria-pressed', String(alignConstrain));
    };
    c.preview = () => {
      clearPreview();
      buttons();
      try {
        c.out = alignCurveEnd(curveById(target), endT, curveById(reference), endR, { continuity: c.continuity, at: num('ac-p'), tension: num('ac-t') });
        showCurvePreview([c.out]);
        if (c.comb) showCombPreview([c.out, curveById(reference)]);
        $('ac-hint').textContent = `${curveLabel(target)} ${endT ? 'END' : 'START'} MEETS ${curveLabel(reference)} IN ${c.continuity}`;
        setHud(`ALIGN ${c.continuity} · TENSION ${num('ac-t')}`);
        setState('updated');
      } catch (e) { c.out = null; $('ac-hint').textContent = say(e); setHud('ALIGN FAILED'); setState('failed'); }
    };
    c.setContinuity = g => { c.continuity = g; c.preview(); };
    c.key = action => {
      if (action === 'continuity') return c.setContinuity(ALIGN_CURVE_CONTINUITY[(ALIGN_CURVE_CONTINUITY.indexOf(c.continuity) + 1) % ALIGN_CURVE_CONTINUITY.length]), true;
      if (action === 'view-curvature') { c.comb = !c.comb; c.preview(); return true; }
      if (action === 'constrain') { alignConstrain = !alignConstrain; c.preview(); return true; }
      if (action !== 'tension') return false;
      c.entry = { label: 'TENSION', text: '', apply: v => { if (v > 0) { $('ac-t').value = v; c.preview(); } else toast('THE TENSION MUST BE ABOVE ZERO'); } };
      setHud('TENSION _');
      return true;
    };
    c.finish = async () => {
      if (!c.out) return toast($('ac-hint').textContent);
      try {
        const { ids: made } = await backend.replaceCurves([target], [c.out]);
        if (alignConstrain) constraints.addAlign(made[0], endT, reference, endR, { continuity: c.continuity, at: num('ac-p'), tension: num('ac-t') });
        endCmd('committed');
        record(`ALIGN ${c.continuity}${alignConstrain ? ' · CONSTRAINED' : ''}`, made[0], `${curveLabel(target)} TO ${curveLabel(reference)}`);
        await curvesChanged(made);
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => clearPreview();
    c.preview();
  }

  /**
   * Square's sides as model-space polylines (curves sampled, body edges read through 200 points),
   * and an edge side's way out of its face, normals and curvatures for G1 and G2 (withOut). `c`
   * keeps what has been read in its `edges` and `faces` maps. Shared by Square and Loft's Two Edges.
   */
  function edgeSideReader(c) {
    c.edges ??= new Map();
    c.faces ??= new Map();
    // Each side as a polyline in model space.
    const sideOf = async it => {
      if (it.kind === 'curve') {
        const src = curveById(it.id), f = curveFrame(src), { points, closed } = curveSamples(src, 200);
        if (closed) throw new Error(`${curveLabel(it.id)} is closed: a side runs between two corners`);
        return points.map(p => lift(f, { x: p[0], y: p[1], z: p[2] ?? 0 }).toArray());
      }
      const key = `${it.body}:${it.n}`;
      if (!c.edges.has(key)) c.edges.set(key, (await backend.edgeCurvature({ body: it.body, edge: it.n, n: 200 })).map(t => t.at));
      return c.edges.get(key);
    };
    // The faces along an edge, read at every fifth point of its side, for G1.
    const facesOf = async (it, pts) => {
      const key = `${it.body}:${it.n}`;
      if (!c.faces.has(key)) {
        const at = pts.filter((_, i) => i % 5 === 0 || i === pts.length - 1);
        c.faces.set(key, { at, faces: readEdgeFaces(await backend.edgeFaces({ body: it.body, edge: it.n, points: at }), at.length) });
      }
      return c.faces.get(key);
    };
    // The way out of the face the sheet carries on from, at every point of an edge side: square to
    // the edge in the face's tangent plane, away from the face; of the edge's faces, the one whose
    // way out heads most into the sheet.
    const withOut = async (it, pts, centre) => {
      const { at, faces } = await facesOf(it, pts);
      const unit = v => { const l = Math.hypot(...v); return l > 0 ? v.map(x => x / l) : v; };
      const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      let best = null;
      for (const f of faces) {
        const normals = [], kappas = [];
        const outs = f.frames.map((fr, k) => {
          const T = unit(at[Math.min(k + 1, at.length - 1)].map((x, i) => x - at[Math.max(k - 1, 0)][i]));
          const N = unit(cross(fr.su, fr.sv));
          let d = unit(cross(N, T));
          if (dot(d, fr.at.map((x, i) => x - f.middle[i])) < 0) d = d.map(x => -x);
          // For G2, the face's normal curvature along d: d as a·Su + b·Sv, then II(d) / I(d).
          const E = dot(fr.su, fr.su), F = dot(fr.su, fr.sv), G = dot(fr.sv, fr.sv), det = E * G - F * F;
          const du = dot(d, fr.su), dv = dot(d, fr.sv), a = (G * du - F * dv) / det, b = (E * dv - F * du) / det;
          const I = a * a * E + 2 * a * b * F + b * b * G, II = a * a * dot(fr.suu, N) + 2 * a * b * dot(fr.suv, N) + b * b * dot(fr.svv, N);
          normals.push(N);
          kappas.push([det > 1e-24 && I > 1e-24 ? II / I : 0, 0, 0]);
          return d;
        });
        const score = outs.reduce((sum, d, k) => sum + dot(d, unit(centre.map((x, i) => x - at[k][i]))), 0);
        if (!best || score > best.score) best = { score, outs, normals, kappas };
      }
      if (!best) return pts;
      // Spread the sampled ways out (and normals and curvatures) over every point of the side.
      const side = pts.map(p => [...p]);
      const spread = vals => pts.map((_, i) => { const k = i / (pts.length - 1) * (at.length - 1), a = Math.floor(k), b = Math.min(a + 1, at.length - 1), t = k - a; return vals[a].map((x, j) => x * (1 - t) + vals[b][j] * t); });
      side.out = spread(best.outs);
      side.normal = spread(best.normals);
      side.kappa = spread(best.kappas);
      return side;
    };
    return { sideOf, withOut };
  }

  /**
   * Plasticity's Square: a four-sided B-spline sheet on the selected curves and body edges (four
   * meeting end to end, or two to loft between), with its degree and spans set. Shift+click adds or
   * takes off sides while it runs. The fill is square.js; OK or right-click makes the sheet.
   */
  async function startSquare({ xnurbs = false } = {}) {
    if (cmd) await finish();
    if (!backend.previewSplineSheet || !backend.edgeCurvature) return toast(`${xnurbs ? 'XNURBS' : 'SQUARE'} IS NOT IN THIS BUILD YET`);
    const c = cmd = { id: 'square', xnurbs, quad: xnurbs, quality: 'auto', data: null, sent: 0, shown: 0, edges: new Map(), faces: new Map(), continuity: 'G0' };
    $('sq-xrow').hidden = $('sq-qrow').hidden = !xnurbs;
    lastTool = 'square';
    showTool('square');
    if (xnurbs) { $('tool-name').textContent = 'XNURBS'; $('status-tool').textContent = 'XNURBS'; }
    setState('none');
    const { sideOf, withOut } = edgeSideReader(c);
    const picked = () => [...sel.curves.map(id => ({ kind: 'curve', id })), ...sel.list('edge').map(e => ({ kind: 'edge', body: e.body, n: e.n }))];
    c.preview = async () => {
      const items = picked();
      setTarget(`${items.length} SIDE${items.length === 1 ? '' : 'S'}`);
      const loose = c.quad ? items.length < 1 : items.length < 2 || items.length > 4;
      if (loose) {
        c.data = null;
        clearPreview();
        $('sq-hint').textContent = c.quad ? 'SELECT THE CURVES AND EDGES ROUND ONE CLOSED LOOP' : 'SELECT THREE OR FOUR SIDES MEETING END TO END, OR TWO TO LOFT BETWEEN';
        return setState('none');
      }
      let fit;
      try {
        let sides = await Promise.all(items.map(sideOf));
        // The faces along edge sides: for any continuity but G0, and for Analysis whatever the fit.
        let faced = null;
        if (c.continuity !== 'G0' || c.analysis) {
          const all = sides.flat(), centre = [0, 1, 2].map(k => all.reduce((t, p) => t + p[k], 0) / all.length);
          faced = await Promise.all(sides.map((pts, i) => items[i].kind === 'edge' ? withOut(items[i], pts, centre) : pts));
          if (c.continuity !== 'G0') sides = faced;
        }
        if (cmd !== c) return;
        // Quad sided: the whole loop is chained and cut at its four corners (xNURBS' option).
        if (c.quad) {
          const size = Math.max(...sides.flat().map(p => Math.hypot(...p.map((x, k) => x - sides[0][0][k])))) || 1;
          sides = quadSides(sides, Math.max(0.01, 1e-3 * size));
          faced = null;
        }
        c.checkSides = faced ?? sides;
        for (const b of $$('[data-sqquality]')) b.setAttribute('aria-pressed', String(b.dataset.sqquality === c.quality));
        $('sq-quad').setAttribute('aria-pressed', String(!!c.quad));
        const su = Math.round(num('sq-u')) || 0, sv = Math.round(num('sq-v')) || su;
        const tension = num('sq-t');
        if (!(tension > 0)) throw new Error('the tension must be greater than zero');
        fit = square(sides, { degree: Math.round(num('sq-d')), spans: su ? [su, sv] : 0, tolerance: { auto: 0.01, high: 0.001, max: 0.0001 }[c.quality], continuity: c.continuity, tension, flatness: Math.min(1, Math.max(0, num('sq-flat') || 0)), boundary: c.boundary ?? 'natural', weight: Math.min(1, Math.max(0.05, num('sq-w') || 1)) });
        for (const b of $$('[data-sqbound]')) b.setAttribute('aria-pressed', String(b.dataset.sqbound === (c.boundary ?? 'natural')));
      } catch (e) { c.data = null; clearPreview(); $('sq-hint').textContent = say(e); return setState('failed'); }
      c.data = splineSheetData(fit);
      c.fit = fit;
      c.analyse();
      $('sq-hint').textContent = `${c.xnurbs ? 'XNURBS · ' : ''}${c.continuity === 'FREE' ? 'FREE · ' : ''}${c.quad ? 'QUAD SIDED' : items.length === 2 ? 'LOFT' : items.length === 3 ? 'THREE SIDES' : 'FOUR SIDES'} · DEGREE ${fit.degree[0]} · ${fit.spans.join(' × ')} SPANS · SIDES WITHIN ${fit.gap < 1e-4 ? '< 0.0001' : fit.gap.toFixed(4)} MM${c.continuity === 'G1' || c.continuity === 'G2' ? ` · TANGENT WITHIN ${fit.turn.toFixed(2)}°` : ''}${c.continuity === 'G2' ? ` · CURVATURE WITHIN ${fit.bend.toFixed(5)} /MM` : ''}${num('sq-flat') > 0 ? ` · FLATNESS ${Math.min(1, num('sq-flat'))}` : ''}${num('sq-w') < 1 ? ` · WEIGHT ${Math.max(0.05, num('sq-w'))}` : ''}${c.boundary && c.boundary !== 'natural' ? ` · ${c.boundary.toUpperCase()} BOUNDARY` : ''}`;
      setHud(`${c.xnurbs ? 'XNURBS' : 'SQUARE'} · ${fit.spans.join(' × ')} SPANS`);
      livePreview(c, () => backend.previewSplineSheet({ data: c.data }), b => showPreviewBody(b), 'sq-hint');
    };
    // Analysis: the gap to the sides and, along edge sides, the angle and curvature difference to
    // their faces, each against its tolerance, whatever continuity the sheet was fitted for.
    c.analysis = false;
    c.analyse = () => {
      $('sq-analysis').setAttribute('aria-pressed', String(c.analysis));
      $('sq-analysis-row').hidden = !c.analysis;
      for (const k of [0, 1, 2]) $(`sq-r${k}`).textContent = '—';
      if (!c.analysis || !c.fit || !c.checkSides) return;
      try {
        const r = squareAnalysis(c.fit, c.checkSides, { g0: num('sq-tg0'), g1: num('sq-tg1'), g2: num('sq-tg2') });
        const mark = ok => ok ? ' ✓' : ' ✗';
        $('sq-r0').textContent = `${r.gap < 1e-4 ? '< 0.0001' : r.gap.toFixed(4)} MM${mark(r.ok.g0)}`;
        $('sq-r1').textContent = r.turn === null ? 'NO EDGE SIDES' : `${r.turn.toFixed(3)}°${mark(r.ok.g1)}`;
        $('sq-r2').textContent = r.bend === null ? 'NO EDGE SIDES' : `${r.bend.toFixed(5)} /MM${mark(r.ok.g2)}`;
      } catch (e) { $('sq-r0').textContent = say(e); }
    };
    c.setAnalysis = on => { c.analysis = on; c.analyse(); if (on) c.preview(); };
    c.onSelection = () => { drawOverlays(); c.preview(); };
    c.click = e => {
      const hit = pickAt(e);
      if (hit?.kind === 'curve') sel.toggle({ kind: 'curve', id: hit.id });
      else if (hit?.kind === 'edge') sel.toggle({ kind: 'edge', body: hit.body, n: hit.n });
      else return true;
      selectionChanged();
      return true;
    };
    c.setContinuity = g => {
      c.continuity = g;
      for (const b of $$('[data-sqcont]')) b.setAttribute('aria-pressed', String(b.dataset.sqcont === g));
      c.preview();
    };
    c.key = action => {
      if (action === 'continuity') { c.setContinuity({ FREE: 'G0', G0: 'G1', G1: 'G2', G2: 'FREE' }[c.continuity]); return true; }
      if (action === 'tension') {
        c.entry = { label: 'TENSION', text: '', apply: v => { if (v > 0) { $('sq-t').value = v; c.preview(); } else toast('THE TENSION MUST BE GREATER THAN ZERO'); } };
        setHud('TENSION _');
        return true;
      }
      if (action === 'quad' && c.xnurbs) { c.quad = !c.quad; c.preview(); return true; }
      if (action !== 'degree') return false;
      c.entry = { label: 'DEGREE', text: '', apply: v => { if (v >= 1 && v <= 7) { $('sq-d').value = Math.round(v); c.preview(); } else toast('THE DEGREE RUNS FROM 1 TO 7'); } };
      setHud('DEGREE _');
      return true;
    };
    c.finish = async () => {
      if (!c.data) { toast($('sq-hint').textContent); return endCmd('cancelled'); }
      try {
        const { ids, scene: list } = await backend.commitSplineSheet({ data: c.data });
        endCmd('committed');
        record(c.xnurbs ? 'XNURBS' : 'SQUARE', ids[0], $('sq-hint').textContent);
        await showScene(list);
        sel.clear();
        sel.add({ kind: 'solid', body: ids[0] });
        selectionChanged({ quiet: true });
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => clearPreview();
    for (const b of $$('[data-sqcont]')) b.setAttribute('aria-pressed', String(b.dataset.sqcont === 'G0'));
    c.preview();
  }

  /**
   * Plasticity's Constrained Surface: a smooth sheet through clicked points (they snap, and land on
   * faces where clicked). Tolerance is how close it must come to each point, Angular tolerance how
   * sharply it may bend to get there, Optimize Performance or Smoothness (Tab); Ctrl+Z takes the last
   * point off. The fit is constrainedSurface.js; OK or right-click makes the sheet.
   */
  function startConstrainedSurface() {
    if (!backend.previewSplineSheet) return toast('CONSTRAINED SURFACE IS NOT IN THIS BUILD YET');
    const c = cmd = { id: 'constrained-surface', points: [], optimize: 'performance', data: null, sent: 0, shown: 0 };
    lastTool = 'constrained-surface';
    showTool('constrained-surface');
    setState('none');
    setHud('CLICK THE POINTS THE SURFACE GOES THROUGH');
    const marks = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: COLORS.accent, size: 7, sizeAttenuation: false, depthTest: false }));
    marks.renderOrder = 13;
    scene.add(marks);
    const pointOf = e => {
      const s = e.altKey ? null : snapNear(e, shownMeshes());
      if (s) return s.point;
      ray(e);
      const hit = raycaster.intersectObjects(shownMeshes(), false)[0];
      if (hit) return hit.point.clone();
      const at = raycaster.ray.intersectPlane(planeOf(), new THREE.Vector3());
      return at && (snapping(e) ? at.set(...at.toArray().map(x => Math.round(x / gridStep()) * gridStep())) : at);
    };
    const buttons = () => { for (const b of $$('[data-csopt]')) b.setAttribute('aria-pressed', String(b.dataset.csopt === c.optimize)); };
    c.preview = () => {
      buttons();
      marks.geometry.dispose();
      marks.geometry = new THREE.BufferGeometry().setFromPoints(c.points);
      const n = c.points.length;
      if (n < 3) {
        c.data = null;
        clearPreview();
        $('cs-hint').textContent = `${n} POINT${n === 1 ? '' : 'S'} · CLICK ${3 - n} MORE`;
        return setState('none');
      }
      let fit;
      try { fit = constrainedSurface(c.points.map(p => p.toArray()), { tolerance: num('cs-tol'), angular: num('cs-ang'), optimize: c.optimize }); }
      catch (e) { c.data = null; clearPreview(); $('cs-hint').textContent = say(e); return setState('failed'); }
      c.data = splineSheetData(fit);
      const miss = fit.error < 1e-4 ? '< 0.0001' : fit.error.toFixed(4);
      $('cs-hint').textContent = fit.met ? `${n} POINTS · WITHIN ${miss} MM · ${fit.spans.join(' × ')} SPANS`
        : `${n} POINTS · MISSES BY ${miss} MM: RAISE THE ANGULAR TOLERANCE`;
      setHud(`CONSTRAINED SURFACE · ${n} POINTS`);
      livePreview(c, () => backend.previewSplineSheet({ data: c.data }), b => showPreviewBody(b), 'cs-hint');
    };
    c.key = action => {
      if (action === 'back') { c.points.pop(); c.preview(); return true; }
      if (action === 'optimize') { c.optimize = c.optimize === 'performance' ? 'smoothness' : 'performance'; c.preview(); return true; }
      return false;
    };
    c.move = e => showSnap(e.altKey ? null : snapNear(e, shownMeshes()), e);
    c.click = e => {
      const p = pointOf(e);
      if (!p) return true;
      c.points.push(p);
      c.preview();
      return true;
    };
    c.finish = async () => {
      if (!c.data) { if (c.points.length) toast($('cs-hint').textContent); return endCmd('cancelled'); }
      try {
        const { ids, scene: list } = await backend.commitSplineSheet({ data: c.data });
        endCmd('committed');
        record('CONSTRAINED SURFACE', ids[0], `${c.points.length} POINTS`);
        await showScene(list);
        sel.clear();
        sel.add({ kind: 'solid', body: ids[0] });
        selectionChanged({ quiet: true });
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => { clearPreview(); showSnap(null); marks.geometry.dispose(); marks.material.dispose(); marks.removeFromParent(); };
    c.preview();
  }

  /**
   * Plasticity's Align Vertex: the selected curve vertices share one coordinate along X, Y or Z
   * (the user's axes), each moving the shortest way within its curve's plane. The value starts at
   * the first vertex's and can be typed.
   */
  async function startAlignVertex() {
    if (cmd) await finish();
    if (!backend.replaceCurves) return toast('ALIGN VERTEX IS NOT IN THIS BUILD YET');
    const picked = sel.list('vertex').filter(v => curveById(v.id));
    if (picked.length < 2) return toast('SELECT TWO OR MORE CURVE VERTICES TO ALIGN');
    // Two ends of two curves: Plasticity's Align Vertex matches their continuity.
    if (picked.length === 2 && picked[0].id !== picked[1].id) {
      const endOfVertex = v => { const n = curveVertices(curveById(v.id)).length; return v.n === 0 ? 0 : v.n === n - 1 ? 1 : null; };
      const ends = picked.map(endOfVertex);
      if (ends.every(e => e !== null)) return startAlignCurve({ target: picked[0].id, endT: ends[0], reference: picked[1].id, endR: ends[1] });
    }
    const c = cmd = { id: 'align-vertex', out: null, axis: 'x' };
    lastTool = 'align-vertex';
    showTool('align-vertex');
    setState('none');
    const curves = [...new Set(picked.map(v => v.id))];
    setTarget(`${picked.length} VERTICES`);
    // User x, y, z as model directions (the model is y-up: user y is model -z).
    const AXES = { x: [1, 0, 0], y: [0, 0, -1], z: [0, 1, 0] };
    const coordOf = (v, axis) => {
      const src = curveById(v.id), [x, y] = curveVertices(src)[v.n], p = lift(curveFrame(src), { x, y });
      return p.x * AXES[axis][0] + p.y * AXES[axis][1] + p.z * AXES[axis][2];
    };
    const setAxis = axis => {
      c.axis = axis;
      for (const b of $$('[data-avaxis]')) b.setAttribute('aria-pressed', String(b.dataset.avaxis === axis));
      $('av-v').value = +coordOf(picked[0], axis).toFixed(4);
      c.preview();
    };
    c.preview = () => {
      clearPreview();
      const value = num('av-v');
      try {
        if (!Number.isFinite(value)) throw new Error('type a value');
        c.out = curves.map(id => {
          const src = curveById(id), vs = curveVertices(src);
          const moves = new Map(picked.filter(v => v.id === id).map(v => [v.n, alignedInPlane(src, vs[v.n], AXES[c.axis], value)]));
          return moveVertices(src, moves);
        });
        showCurvePreview(c.out);
        $('av-hint').textContent = `${picked.length} VERTICES ON ${curves.length} CURVE${curves.length > 1 ? 'S' : ''}`;
        setHud(`ALIGN ${c.axis.toUpperCase()} = ${value} MM`);
        setState('updated');
      } catch (e) { c.out = null; $('av-hint').textContent = say(e); setHud('ALIGN FAILED'); setState('failed'); }
    };
    c.setAxis = setAxis;
    c.key = action => {
      if (action === 'x' || action === 'y' || action === 'z') { setAxis(action); return true; }
      if (action !== 'value') return false;
      c.entry = { label: `${c.axis.toUpperCase()} VALUE`, text: '', apply: v => { $('av-v').value = v; c.preview(); } };
      setHud(`${c.axis.toUpperCase()} VALUE _`);
      return true;
    };
    c.finish = async () => {
      if (!c.out) return toast($('av-hint').textContent);
      try {
        const { ids: made } = await backend.replaceCurves(curves, c.out);
        endCmd('committed');
        record(`ALIGN VERTEX ${c.axis.toUpperCase()} ${num('av-v')} MM`, made[0], `${picked.length} VERTICES`);
        await curvesChanged(made);
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => clearPreview();
    setAxis('x');
  }

  /**
   * Plasticity's Offset Edge (edges picked) and Offset Face Loop (a face picked): the edges moved
   * across the face by the distance and imprinted there, splitting the face. For an edge between
   * two faces, a negative distance goes onto the other face and S offsets onto both at once. On one
   * flat face V cycles the gap fill; on curved faces, or a chain running over several faces, the
   * offset keeps the distance from the edges in space and its corners are round.
   */
  function startEdgeOffset() {
    if (!backend.previewImprint) return toast('OFFSET EDGE IS NOT IN THIS BUILD YET');
    const eb = edgeBody(), loop = eb === null;
    const id = loop ? faceBody() : eb, body = bodyOf(id);
    const picked = loop ? sel.list('face').map(it => it.n) : sel.list('edge').map(it => it.n);
    const flat = f => body.facePlanes[f] ? f : null;
    if (loop && !picked.length) return toast('PICK FACES OR EDGES TO OFFSET');
    if (loop && picked.some(f => flat(f) === null)) return toast('OFFSET FACE LOOP WORKS ON FLAT FACES');
    // The flat faces the picked edges all lie on: those an edge offset can run across.
    const sides = loop ? [...picked] : body.facePlanes.map((_, f) => f).filter(f => flat(f) !== null && picked.every(n => faceEdges(body, f).includes(n)));
    if (!sides.length && !backend.previewOffsetEdges) return toast('PICK EDGES THAT ALL BORDER ONE FLAT FACE');
    const c = cmd = { id: 'offset-edge', body: id, corner: 'linear', both: false, individual: false, shapes: null, faces: [], any: null, sent: 0, shown: 0 };
    lastTool = 'offset-edge';
    showTool('offset-edge');
    setState('none');
    setTarget(`${label(id)} · ${loop ? `FACE LOOP${picked.length > 1 ? ` ×${picked.length}` : ''}` : `${picked.length} EDGE${picked.length > 1 ? 'S' : ''}`}`);
    $('oe-both').hidden = loop;
    $('oe-individual').hidden = !loop;
    $('oe-individual').setAttribute('aria-pressed', 'false');
    const setCorner = k => {
      c.corner = k;
      for (const b of $$('[data-oecorner]')) b.setAttribute('aria-pressed', String(b.dataset.oecorner === k));
      c.preview();
    };
    c.preview = () => {
      clearPreview();
      const d = num('oe-d');
      c.any = null;
      try {
        if (!Number.isFinite(d) || Math.abs(d) < 1e-9) throw new Error('type a distance');
        if (!loop && (!sides.length || (sides.length === 1 && (d < 0 || c.both)))) {
          // Off the one flat face: the kernel offsets across whichever faces the edges border.
          if (!backend.previewOffsetEdges) throw new Error('offset edges on one flat face in this build');
          c.shapes = null;
          c.any = { body: c.body, edges: picked, distance: Math.abs(d), side: c.both ? 2 : !sides.length && d < 0 ? 1 : 0, away: !c.both && sides.length ? sides[0] : null };
          const how = c.both ? 'BOTH SIDES' : sides.length ? 'THE CURVED SIDE' : d < 0 ? 'THE OTHER SIDE' : 'ONE SIDE';
          $('oe-hint').textContent = `${picked.length} EDGE${picked.length > 1 ? 'S' : ''} ON ${how} · ROUND CORNERS${c.both ? '' : ' · − FOR THE OTHER SIDE, S FOR BOTH'}`;
          livePreview(c, () => backend.previewOffsetEdges(c.any), b => { showPreviewBody(b); setHud(`OFFSET EDGE ${d} MM · ${how}`); }, 'oe-hint');
          return;
        }
        if (c.both) {
          if (loop || sides.length < 2) throw new Error('both sides works on edges between two flat faces');
          c.faces = sides.slice(0, 2);
          c.shapes = edgeOffsetsBothSides(body, sides[0], sides[1], f => faceEdges(body, f), picked, Math.abs(d));
        } else if (loop) {
          ({ shapes: c.shapes, faces: c.faces } = facesLoopOffsets(body, picked, f => faceBoundEdges(body, f), d, c.corner, c.individual));
        } else {
          const face = d < 0 && sides.length > 1 ? sides[1] : sides[0];
          const edges = faceEdges(body, face);
          c.faces = [face];
          c.shapes = edgeOffsetsOnFace(body, face, edges, picked, Math.abs(d), c.corner);
        }
      } catch (e) { c.shapes = null; $('oe-hint').textContent = say(e); setState('failed'); return; }
      showCurvePreview(c.shapes);
      $('oe-hint').textContent = `${c.shapes.length} ${loop ? 'LOOP' : 'OFFSET'}${c.shapes.length > 1 ? 'S' : ''} ON FACE${c.faces.length > 1 ? 'S' : ''} ${c.faces.join(' AND ')}${loop ? (picked.length > 1 ? ` · I FOR ${c.individual ? 'COMBINED' : 'INDIVIDUAL'}` : '') : (sides.length > 1 || backend.previewOffsetEdges) && !c.both ? ' · − FOR THE OTHER FACE, S FOR BOTH' : ''}`;
      livePreview(c, () => backend.previewImprint(c.request()), b => { showPreviewBody(b); showCurvePreview(c.shapes); setHud(`${loop ? 'OFFSET FACE LOOP' : 'OFFSET EDGE'} ${d} MM · ${c.both ? 'BOTH SIDES' : c.corner.toUpperCase()}`); }, 'oe-hint');
    };
    c.request = () => ({ body: c.body, faces: c.faces, curves: [], tools: { shapes: c.shapes } });
    c.setCorner = setCorner;
    c.setBoth = on => {
      c.both = on;
      $('oe-both').setAttribute('aria-pressed', String(on));
      c.preview();
    };
    c.setIndividual = on => {
      if (!loop) return;
      c.individual = on;
      $('oe-individual').setAttribute('aria-pressed', String(on));
      c.preview();
    };
    c.key = action => {
      if (action === 'corner') { setCorner(OFFSET_CORNERS[(OFFSET_CORNERS.indexOf(c.corner) + 1) % OFFSET_CORNERS.length]); return true; }
      if (action === 'both') { c.setBoth(!c.both); return true; }
      if (action === 'individual') { c.setIndividual(!c.individual); return true; }
      if (action !== 'distance') return false;
      c.entry = { label: 'DISTANCE', text: '', apply: v => { $('oe-d').value = v; c.preview(); } };
      setHud('DISTANCE _');
      return true;
    };
    c.finish = async () => {
      if (!c.shapes && !c.any) { setState('failed'); return toast($('oe-hint').textContent); }
      try {
        const { id: made, scene: list } = c.any ? await backend.commitOffsetEdges(c.any) : await backend.commitImprint(c.request());
        endCmd('committed');
        record(`${loop ? 'OFFSET FACE LOOP' : 'OFFSET EDGE'} ${num('oe-d')} MM${c.both ? ' BOTH SIDES' : ''}`, made);
        await showScene(list);
        sel.replace({ kind: 'solid', body: made });
        selectionChanged({ quiet: true });
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => clearPreview();
    c.preview();
  }

  /**
   * Plasticity's Isoparam (Ctrl+R): edges on a face along its u or v, the face split there. Hover a
   * face to see the edge through the pointer; Count (Shift+wheel) spreads that many evenly across the
   * face instead, and Param fixes one at a place from 0 to 1. Subdivide (S) splits the face's control
   * surface too. A click splits the face and carries on; Enter or right-click splits the face last
   * shown and finishes.
   */
  function startIsoparam() {
    if (!backend.previewIsoparamSplit) return toast('ISOPARAM IS NOT IN THIS BUILD YET');
    const c = cmd = { id: 'isoparam', u: true, at: null, subdivide: false, made: 0, sent: 0, shown: 0 };
    lastTool = 'isoparam';
    showTool('isoparam');
    setState('none');
    setTarget('—');
    setHud('HOVER A FACE');
    $('iso-count').value = '1';
    $('iso-param').value = '';
    $('iso-subdivide').setAttribute('aria-pressed', 'false');
    const faceAt = e => {
      ray(e);
      const hit = raycaster.intersectObjects(shownMeshes().filter(m => !org.locked.has(m.userData.id)), false)[0];
      if (!hit) return null;
      const { id, faceIds } = hit.object.userData;
      return { body: id, face: faceIds[hit.faceIndex], point: hit.point.toArray() };
    };
    const count = () => Math.max(1, Math.min(64, Math.round(Number($('iso-count').value) || 1)));
    const params = () => {
      const n = count();
      if (n > 1) return Array.from({ length: n }, (_, i) => (i + 1) / (n + 1));
      const t = $('iso-param').value.trim();
      return t === '' ? [] : [Number(t)];
    };
    const request = at => ({ body: at.body, face: at.face, point: at.point, u: c.u, params: params(), subdivide: c.subdivide });
    const what = () => `${count()} EDGE${count() > 1 ? 'S' : ''} ALONG ${c.u ? 'U' : 'V'}${c.subdivide ? ' · SUBDIVIDE' : ''}`;
    const hint = () => { $('iso-hint').textContent = `${what()}${c.made ? ` · ${c.made} SPLIT` : ''} · TAB FOR ${c.u ? 'V' : 'U'}`; };
    c.setDir = u => {
      c.u = u;
      for (const b of $$('[data-isodir]')) b.setAttribute('aria-pressed', String((b.dataset.isodir === 'u') === u));
      c.preview();
    };
    c.setSubdivide = on => {
      c.subdivide = on;
      $('iso-subdivide').setAttribute('aria-pressed', String(on));
      c.preview();
    };
    c.wheel = d => { $('iso-count').value = String(Math.max(1, Math.min(64, count() + d))); c.preview(); };
    c.preview = () => {
      hint();
      if (!c.at) return;
      const req = request(c.at);
      livePreview(c, () => backend.previewIsoparamSplit(req), b => {
        showPreviewBody(b);
        setTarget(`${label(req.body)} · FACE ${req.face}`);
        setHud(`ISOPARAM · ${what()} · CLICK TO SPLIT`);
        hint();
      }, 'iso-hint');
    };
    c.move = e => {
      const at = faceAt(e);
      // Off the bodies the last face stays, so Enter or right-click still splits it.
      if (!at) return;
      c.at = at;
      c.preview();
    };
    const split = async at => {
      const { id, scene: list } = await backend.commitIsoparamSplit(request(at));
      c.made++;
      record(`ISOPARAM ${what()}`, id);
      await showScene(list);
      c.at = null;
      clearPreview();
      hint();
    };
    c.click = e => {
      const at = faceAt(e);
      if (!at) return true;
      split(at).catch(err => { setState('failed'); toast(say(err)); });
      return true;
    };
    c.key = action => {
      if (action === 'direction') c.setDir(!c.u);
      else if (action === 'u' || action === 'v') c.setDir(action === 'u');
      else if (action === 'subdivide') c.setSubdivide(!c.subdivide);
      else return false;
      return true;
    };
    c.finish = async () => {
      try { if (c.at) await split(c.at); } catch (err) { setState('failed'); return toast(say(err)); }
      endCmd(c.made ? 'committed' : 'cancelled');
    };
    c.abort = () => endCmd(c.made ? 'committed' : 'cancelled');
    c.cleanup = () => clearPreview();
    hint();
  }

  /**
   * Plasticity's Rebuild Curve: refit the selected curves as smooth NURBS curves with a set number
   * of control points and degree. The new control polygon shows while you set them, and the hint
   * gives how far the new curve strays from the old.
   */
  const hullDots = new THREE.PointsMaterial({ color: COLORS.accent, size: 6, sizeAttenuation: false });
  /**
   * Plasticity's Rebuild Face: the selected faces of one body given new B-spline surfaces, their
   * edges and trims kept. Tolerance (M toggles) fits as few control points as keep the face within
   * it; Explicit sets the U and V degree and spans. Extend carries the new surface on past the face,
   * and Shrink (H) fits the face's own extent rather than its whole underlying surface.
   */
  function startMatchFace() {
    const body = faceBody();
    if (body === null) return toast(sel.list('face').length ? 'MATCH THE FACES OF ONE SOLID AT A TIME' : 'SELECT THE FACES TO MATCH');
    if (!backend.previewMatchFaces) return toast('MATCH FACE IS NOT IN THIS BUILD YET');
    const c = cmd = { id: 'match-face', body, faces: [], target: null, grow: 'moving', sent: 0, shown: 0 };
    lastTool = 'match-face';
    showTool('match-face');
    setState('none');
    c.request = () => ({ body: c.body, faces: c.faces, target: c.target.body, tface: c.target.n, grow: c.grow });
    c.setGrow = g => {
      c.grow = g;
      for (const b of $$('[data-mfgrow]')) b.setAttribute('aria-pressed', String(b.dataset.mfgrow === g));
      c.preview();
    };
    c.key = action => {
      if (action !== 'grow') return false;
      const order = ['moving', 'fixed', 'none'];
      c.setGrow(order[(order.indexOf(c.grow) + 1) % 3]);
      toast(`GROW ${c.grow.toUpperCase()}`);
      return true;
    };
    c.preview = () => {
      if (!c.target) { clearPreview(); $('mf-hint').textContent = 'CLICK THE FACE TO MATCH TO'; return setHud('CLICK THE TARGET FACE'); }
      livePreview(c, () => backend.previewMatchFaces(c.request()), b => {
        showPreviewBody(b);
        $('mf-hint').textContent = `${c.faces.length} FACE${c.faces.length > 1 ? 'S' : ''} OF ${label(c.body)} TO ${label(c.target.body)}`;
        setHud(`MATCH FACE · GROW ${c.grow.toUpperCase()}`);
      }, 'mf-hint');
    };
    c.onSelection = () => {
      drawOverlays();
      const b = faceBody();
      if (b === null) return setHud('SELECT FACES OF ONE SOLID TO MATCH');
      c.body = b;
      c.faces = sel.list('face').map(it => it.n).sort((x, y) => x - y);
      setTarget(label(b));
      $('mf-count').textContent = c.faces.length;
      c.preview();
    };
    // Plasticity: select the faces, run Match Face, then pick the surface to match them to.
    c.click = e => {
      const hit = pickAt(e);
      if (hit?.kind !== 'face') return true;
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        sel.toggle({ kind: 'face', body: hit.body, n: hit.n });
        selectionChanged();
        return true;
      }
      if (hit.body === c.body && c.faces.includes(hit.n)) return true;
      c.target = { body: hit.body, n: hit.n };
      $('mf-target').textContent = `${label(hit.body)} · FACE ${hit.n + 1}`;
      c.preview();
      return true;
    };
    c.finish = async () => {
      if (!c.target) return toast('CLICK THE FACE TO MATCH TO');
      try {
        const { id, scene: list } = await backend.commitMatchFaces(c.request());
        endCmd('committed');
        record(`MATCH FACE ×${c.faces.length}`, id);
        await showScene(list);
        sel.replace({ kind: 'solid', body: id });
        selectionChanged({ quiet: true });
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => clearPreview();
    $('mf-target').textContent = '—';
    for (const b of $$('[data-mfgrow]')) b.setAttribute('aria-pressed', String(b.dataset.mfgrow === 'moving'));
    c.onSelection();
  }

  /**
   * Plasticity's Deform Curve: the selected curves wrapped from a reference face onto a target face.
   * Click the face the curves lie on, then the face to put them on; each curve keeps its place on
   * the face (its surface parameters, scaled to the face) and its height off it. Scale and Offset
   * work in the face's U, V and N; Mirror, UV and Normal flip them; Keep leaves the curves as well.
   */
  function startDeformCurve() {
    const ids = sel.curves.filter(curveById);
    const solids = ids.length ? [] : sel.list('solid').map(it => it.body);
    if (!ids.length && !solids.length) return toast('SELECT THE CURVES, SOLIDS OR SHEETS TO DEFORM');
    if (ids.length && (!backend.faceUvn || !backend.replaceCurves)) return toast('DEFORM CURVE IS NOT IN THIS BUILD YET');
    if (solids.length && !backend.previewDeform) return toast('DEFORM OF SOLIDS AND SHEETS IS ONLY IN THE DESKTOP APP SO FAR');
    const c = cmd = { id: 'deform-curve', ids, solids, ref: null, target: null, flips: { mirror: false, swap: false, normal: false }, keep: false, reblend: false, from: null, out: null, sent: 0 };
    lastTool = 'deform-curve';
    showTool('deform-curve');
    setState('none');
    const what = ids.length ? `${ids.length} CURVE${ids.length > 1 ? 'S' : ''}` : `${solids.length} BOD${solids.length > 1 ? 'IES' : 'Y'}`;
    setTarget(what);
    const where = f => f ? `${label(f.body)} · FACE ${f.n + 1}` : '—';
    const ask = () => {
      $('dc-ref').textContent = where(c.ref);
      $('dc-target').textContent = where(c.target);
      const say = !c.ref ? 'CLICK THE REFERENCE FACE' : !c.target ? 'CLICK THE TARGET FACE' : null;
      if (say) { $('dc-hint').textContent = say; setHud(say); }
    };
    // Each curve's points, along it in model space.
    const worldPoints = curve => { const f = curveFrame(curve); return densify(curve2d(curve).map(p => lift(f, p).toArray()), isClosed(curve)); };
    c.options = () => ({
      scale: [num('dc-su'), num('dc-sv'), num('dc-sn')].map(v => Number.isFinite(v) ? v : 1),
      offset: [num('dc-ou'), num('dc-ov'), num('dc-on')].map(v => Number.isFinite(v) ? v : 0),
      ...c.flips,
    });
    c.request = () => ({ bodies: c.solids, reference: c.ref.body, rface: c.ref.n, target: c.target.body, tface: c.target.n, ...c.options(), reblend: c.reblend, keep: c.keep });
    c.compute = async () => {
      if (c.solids.length) return backend.previewDeform(c.request());
      // The curves on the reference face only change with the reference.
      if (!c.from || c.from.face !== c.ref) {
        const curves = c.ids.map(curveById), pts = curves.map(worldPoints);
        const all = await backend.faceUvn({ body: c.ref.body, face: c.ref.n, points: pts.flat() });
        let k = 0;
        c.from = { face: c.ref, closed: curves.map(isClosed), uvn: pts.map(p => p.map(() => all.points[k++])) };
      }
      const { size } = await backend.faceUvn({ body: c.target.body, face: c.target.n, map: true, points: [] });
      const placed = placeOnFace(c.from.uvn, size, c.options());
      const { points } = await backend.faceUvn({ body: c.target.body, face: c.target.n, map: true, points: placed.flat() });
      let k = 0;
      return placed.map((p, i) => curveFromNurbs(smoothThrough(p.map(() => points[k++]), c.from.closed[i]), [0, -1, 0]));
    };
    c.preview = async () => {
      ask();
      if (!c.ref || !c.target) return clearPreview();
      const n = ++c.sent;
      setState('updating');
      try {
        const out = await c.compute();
        if (cmd !== c || n !== c.sent || out == null) return;
        c.out = out;
        clearPreview();
        if (c.solids.length) for (const b of out) showPreviewBody(b);
        else showCurvePreview(out);
        setState('updated');
        $('dc-hint').textContent = `${what} ONTO ${where(c.target)}${c.reblend && c.solids.length ? ' · REBLENDED' : ''}${c.keep ? ' · KEPT' : ''}`;
        setHud('DEFORM');
      } catch (e) {
        if (cmd !== c || n !== c.sent) return;
        c.out = null;
        clearPreview();
        setState('failed');
        $('dc-hint').textContent = say(e);
      }
    };
    c.setFlip = (k, on) => {
      c.flips[k] = on;
      for (const b of $$('[data-dcflip]')) b.setAttribute('aria-pressed', String(c.flips[b.dataset.dcflip]));
      c.preview();
    };
    c.setKeep = on => {
      c.keep = on;
      $('dc-keep').setAttribute('aria-pressed', String(on));
      c.preview();
    };
    c.setReblend = on => {
      c.reblend = on;
      $('dc-reblend').setAttribute('aria-pressed', String(on));
      c.preview();
    };
    c.key = action => {
      if (action === 'reblend') { if (c.solids.length) c.setReblend(!c.reblend); return !!c.solids.length; }
      if (action === 'mirror') c.setFlip('mirror', !c.flips.mirror);
      else if (action === 'u') c.setFlip('swap', !c.flips.swap);
      else if (action === 'normal') c.setFlip('normal', !c.flips.normal);
      else if (action === 'keep') c.setKeep(!c.keep);
      else return false;
      return true;
    };
    c.click = e => {
      const hit = pickAt(e);
      if (hit?.kind !== 'face') return true;
      const f = { body: hit.body, n: hit.n };
      // The first face clicked is the reference; after that, clicks pick the target.
      if (!c.ref) c.ref = f; else c.target = f;
      c.preview();
      return true;
    };
    c.finish = async () => {
      if (!c.ref || !c.target) return toast(c.ref ? 'CLICK THE TARGET FACE' : 'CLICK THE REFERENCE FACE');
      try {
        if (c.solids.length) {
          const { ids: made, scene: list } = await backend.commitDeform(c.request());
          endCmd('committed');
          record(`DEFORM ${c.solids.map(label).join(' ')}`, made[0], `ONTO ${where(c.target)}`);
          await showScene(list);
          sel.clear();
          for (const id of made) sel.add({ kind: 'solid', body: id });
          selectionChanged({ quiet: true });
          return;
        }
        const out = c.out ?? await c.compute();
        const { ids: made } = c.keep ? await backend.addCurves(out) : await backend.replaceCurves(c.ids, out);
        endCmd('committed');
        record(`DEFORM ${c.ids.map(curveLabel).join(' ')}`, made[0], `ONTO ${where(c.target)}`);
        await curvesChanged(made);
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => clearPreview();
    for (const b of $$('[data-dcflip]')) b.setAttribute('aria-pressed', 'false');
    $('dc-keep').setAttribute('aria-pressed', 'false');
    $('dc-reblend').setAttribute('aria-pressed', 'false');
    $('dc-reblend-row').hidden = !solids.length;
    for (const id of ['dc-su', 'dc-sv', 'dc-sn']) $(id).value = 1;
    for (const id of ['dc-ou', 'dc-ov', 'dc-on']) $(id).value = 0;
    ask();
  }

  /**
   * Plasticity's Untrim (Alt+T): each selected face's whole underlying surface as a new sheet,
   * out past its trims and holes; the body stays. Keep edges (Tab) imprints the face's edges on it.
   */
  function startUntrim() {
    const body = faceBody();
    if (body === null) return toast(sel.list('face').length ? 'UNTRIM THE FACES OF ONE BODY AT A TIME' : 'SELECT THE FACES TO UNTRIM');
    if (!backend.previewUntrim) return toast('UNTRIM IS NOT IN THIS BUILD YET');
    const c = cmd = { id: 'untrim', body, faces: [], keep: false, sent: 0, shown: 0 };
    lastTool = 'untrim';
    showTool('untrim');
    setState('none');
    c.request = () => ({ body: c.body, faces: c.faces, keep: c.keep });
    c.preview = () => livePreview(c, () => backend.previewUntrim(c.request()), b => {
      showPreviewBody(b);
      $('ut-hint').textContent = `${c.faces.length} FACE${c.faces.length > 1 ? 'S' : ''} OF ${label(c.body)}${c.keep ? ' · EDGES KEPT' : ''}`;
      setHud(c.keep ? 'UNTRIM · KEEP EDGES' : 'UNTRIM');
    }, 'ut-hint');
    c.setKeep = on => {
      c.keep = on;
      $('ut-keep').setAttribute('aria-pressed', String(on));
      c.preview();
    };
    c.onSelection = () => {
      drawOverlays();
      const b = faceBody();
      if (b === null) return setHud('SELECT FACES OF ONE BODY TO UNTRIM');
      c.body = b;
      c.faces = sel.list('face').map(it => it.n).sort((x, y) => x - y);
      setTarget(label(b));
      c.preview();
    };
    c.key = action => {
      if (action === 'keep-edges') { c.setKeep(!c.keep); return true; }
      return false;
    };
    c.click = e => {
      const hit = pickAt(e);
      if (hit?.kind !== 'face') return true;
      sel.toggle({ kind: 'face', body: hit.body, n: hit.n });
      selectionChanged();
      return true;
    };
    c.finish = async () => {
      try {
        const { ids, scene: list } = await backend.commitUntrim(c.request());
        endCmd('committed');
        record(`UNTRIM ×${c.faces.length}`, ids[0]);
        await showScene(list);
        sel.clear();
        for (const id of ids) sel.add({ kind: 'solid', body: id });
        selectionChanged({ quiet: true });
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => clearPreview();
    $('ut-keep').setAttribute('aria-pressed', 'false');
    c.onSelection();
  }

  /**
   * Plasticity's Section Analysis: a slice through the view along a plane, the model itself left
   * alone. The plane is the selected flat face, the previous section or the construction plane; D
   * moves it into the model, F flips which side stays. OK keeps the slice on; running it again (the
   * View button or the palette) takes it off.
   */
  const section = { plane: null, last: null };
  function applySection(plane) {
    section.plane = plane;
    renderer.localClippingEnabled = !!plane;
    for (const m of [...faceMats(), edgeMat, ...Object.values(overlayMat)]) { m.clippingPlanes = plane ? [plane] : null; m.needsUpdate = true; }
    shadeU.sectioned.value = !!plane;
    $('section-btn').setAttribute('aria-pressed', String(!!plane));
  }
  function startSection() {
    if (section.plane && cmd?.id !== 'section') { applySection(null); return toast('SECTION ANALYSIS OFF'); }
    const f = sel.list('face').at(-1), b = f && bodyOf(f.body), p = b?.facePlanes[f.n];
    const c = cmd = { id: 'section', how: p ? 'selection' : section.last ? 'previous' : 'cplane', flip: false, before: section.plane };
    lastTool = 'section';
    showTool('section');
    setState('none');
    // Each plane as where it sits and the way it looks into the model.
    const base = () => {
      if (c.how === 'selection' && p) return { origin: faceCentre(b, f.n), into: new THREE.Vector3(...p.normal).negate() };
      if (c.how === 'previous' && section.last) return { origin: section.last.origin.clone(), into: section.last.into.clone() };
      return { origin: cplane.origin.clone(), into: cplane.normal.clone().negate() };
    };
    c.preview = () => {
      for (const btn of $$('[data-saplane]')) {
        btn.setAttribute('aria-pressed', String(btn.dataset.saplane === c.how));
        btn.disabled = (btn.dataset.saplane === 'selection' && !p) || (btn.dataset.saplane === 'previous' && !section.last);
      }
      $('sa-flip').setAttribute('aria-pressed', String(c.flip));
      const d = num('sa-d') || 0, { origin, into } = base();
      c.at = { origin: origin.clone().addScaledVector(into, d), into: into.clone() };
      // three.js keeps what lies on the side the plane's normal points to: the model past the slice.
      const keep = c.flip ? into.clone().negate() : into.clone();
      applySection(new THREE.Plane().setFromNormalAndCoplanarPoint(keep, c.at.origin));
      $('sa-hint').textContent = `${c.how === 'selection' ? 'THE SELECTED FACE' : c.how === 'previous' ? 'THE PREVIOUS SECTION' : `CPLANE ${cplane.name}`} · ${d} MM IN${c.flip ? ' · FLIPPED' : ''}`;
      setHud(`SECTION ${d} MM`);
    };
    c.setHow = how => { c.how = how; c.preview(); };
    c.key = action => {
      if (action === 'flip') { c.flip = !c.flip; c.preview(); return true; }
      if (action !== 'distance') return false;
      c.entry = { label: 'DISTANCE', text: '', apply: v => { $('sa-d').value = v; c.preview(); } };
      setHud('DISTANCE _');
      return true;
    };
    c.finish = async () => {
      section.last = c.at;
      endCmd('committed');
    };
    c.abort = () => { applySection(c.before); endCmd('cancelled'); };
    $('sa-d').value = 0;
    c.preview();
  }

  /**
   * Plasticity's Dimension (=): the sizes of what is selected, each typed anew. A circle or arc has
   * its diameter and a rectangle its two sides; one round face its diameter; two flat faces of one
   * body the distance between them (the second moves); a block its width, length and height and a
   * ball its diameter. Tab steps through the sizes typing each; Enter applies the changed ones.
   */
  async function startDimension() {
    const curves = sel.curves.filter(curveById), faces = sel.list('face'), solids = targetBodies();
    const which = curves.length === 1 && sel.size === 1 ? { curve: curves[0] }
      : faces.length && faceBody() !== null ? { body: faceBody(), faces: faces.map(f => f.n) }
      : solids.length === 1 && sel.list().every(it => it.kind === 'solid') ? { solid: solids[0] } : null;
    const ask = 'SELECT A CIRCLE, ARC OR RECTANGLE, A ROUND FACE, FILLET OR CHAMFER, TWO FLAT FACES, OR A BLOCK OR BALL';
    if (!which) return toast(ask);
    if (which.curve === undefined && !backend.faceSurfaces) return toast('DIMENSION IS NOT IN THIS BUILD YET');
    /** The sizes as they are now, measured afresh (an edit can renumber faces). */
    const measure = async () => {
      if (which.curve !== undefined) return curveDimensions(curveById(which.curve));
      const surfaces = await backend.faceSurfaces({ body: which.body ?? which.solid });
      if (which.solid !== undefined) return solidDimensions(which.solid, surfaces);
      // One face of a fillet: its radius, the whole chain made again.
      if (which.faces.length === 1 && backend.filletFaces && backend.commitRefillet) {
        const chain = await backend.filletFaces({ body: which.body, faces: which.faces }).catch(() => []);
        if (chain.length) return filletDimensions(which.body, chain, surfaces);
      }
      // One face of a chamfer: its distance.
      if (which.faces.length === 1 && surfaces[which.faces[0]]?.kind === 'plane') {
        const mesh = bodyOf(which.body), points = e => Array.from({ length: e.length / 3 }, (_, i) => [e[3 * i], e[3 * i + 1], e[3 * i + 2]]);
        const near = mesh ? faceNeighbours(mesh, which.faces[0]).map(({ face, edge }) => ({ face, points: points(mesh.edges[edge]) })) : [];
        const chamfer = chamferDimensions(which.body, which.faces[0], surfaces, near);
        if (chamfer.length) return chamfer;
      }
      return faceDimensions(which.body, which.faces, surfaces);
    };
    let dims;
    try { dims = await measure(); } catch (e) { return toast(say(e)); }
    if (!dims.length) return toast(`NO SIZE TO SET THERE: ${ask}`);
    const c = cmd = { id: 'dimension', dims, active: -1, values: dims.map(d => d.value), sent: 0, shown: 0 };
    lastTool = 'dimension';
    showTool('dimension');
    setState('none');
    setTarget(which.curve !== undefined ? curveLabel(which.curve) : label(which.body ?? which.solid));
    const box = $('dm-fields');
    box.innerHTML = dims.map((d, i) => `<div class="field"><label for="w3d-dm-${i}">${d.label}</label><input id="w3d-dm-${i}" data-dm="${i}" type="number" step="0.1" min="0.001" value="${+d.value.toFixed(3)}"></div>`).join('');
    const fields = [...box.querySelectorAll('[data-dm]')];
    const show = () => {
      setHud(dims.map((d, i) => `${i === c.active ? '▸ ' : ''}${d.label} ${c.values[i].toFixed(3)}`).join(' · '));
      $('dm-hint').textContent = 'TAB TO TYPE A SIZE · ⏎ TO APPLY';
    };
    /** What the first changed size would do, drawn when it is an Offset Face. */
    c.preview = () => {
      show();
      clearPreview();
      const i = c.values.findIndex((v, k) => Math.abs(v - dims[k].value) > 1e-9);
      const edit = i >= 0 && c.values[i] > 0 ? dims[i].edit(c.values[i]) : null;
      if (edit?.op === 'offset' && backend.previewOffset) livePreview(c, () => backend.previewOffset({ ...editRequest(edit) }), b => showPreviewBody(b), 'dm-hint');
      if (edit?.op === 'turn' && backend.previewMoveFaces) livePreview(c, () => backend.previewMoveFaces(edit), b => showPreviewBody(b), 'dm-hint');
      if (edit?.op === 'refillet' && backend.previewRefillet) livePreview(c, () => backend.previewRefillet({ body: edit.body, faces: edit.faces, radius: edit.radius }), b => showPreviewBody(b), 'dm-hint');
    };
    const editRequest = edit => ({ body: edit.body, faces: edit.faces, distance: edit.distance, angle: 0, grow: 'moving', chamfer: edit.chamfer });
    fields.forEach((f, i) => { f.oninput = () => { const v = parseFloat(f.value); if (Number.isFinite(v)) { c.values[i] = v; c.preview(); } }; });
    c.key = action => {
      if (action !== 'typed') return false;
      c.active = (c.active + 1) % dims.length;
      const i = c.active;
      c.entry = { label: dims[i].label, text: '', apply: v => { c.values[i] = v; fields[i].value = v; c.preview(); }, next: () => c.key('typed') };
      show();
      setHud(`${dims[i].label} _`);
      return true;
    };
    c.entryDone = () => { if (c.entry) setHud(`${c.entry.label} ${c.entry.text}_`); };
    c.finish = async () => {
      const changed = dims.map((d, i) => [d.label, c.values[i], Math.abs(c.values[i] - d.value) > 1e-9]).filter(x => x[2]);
      if (!changed.length) return endCmd(null);
      if (changed.some(([, v]) => !(v > 0))) { setState('failed'); return toast('A SIZE MUST BE ABOVE ZERO'); }
      let made = null;
      try {
        const tag = () => which.curve !== undefined ? curveLabel(which.curve) : label(which.body ?? which.solid);
        // Each size is its own undo step, listed as such.
        for (const [name, v] of changed) {
          // Each size from the shape as the last one left it.
          const now = (await measure()).find(d => d.label === name);
          if (!now) throw new Error(`the ${name.toLowerCase()} is no longer there to set`);
          const edit = now.edit(v);
          if (edit.op === 'offset') ({ scene: made } = await backend.commitOffset(editRequest(edit)));
          else if (edit.op === 'turn') ({ scene: made } = await backend.commitMoveFaces(edit));
          else if (edit.op === 'refillet') ({ scene: made } = await backend.commitRefillet({ body: edit.body, faces: edit.faces, radius: edit.radius }));
          else if (edit.op === 'scale') ({ scene: made } = await backend.commitMotion({ bodies: [edit.body], pivot: edit.pivot, scale: edit.scale }));
          else {
            const { id, ...curve } = edit.curve;
            const { ids } = await backend.replaceCurves([which.curve], [curve]);
            which.curve = ids[0];
          }
          record(`DIMENSION ${name} ${v}`, which.curve ?? which.body ?? which.solid, tag());
        }
        endCmd('committed');
        if (made) await showScene(made);
        if (which.curve !== undefined) await curvesChanged([which.curve]);
      } catch (e) {
        // Sizes set before the failure stay set (each its own undo step).
        if (made) await showScene(made);
        setState('failed'); toast(say(e));
      }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => { clearPreview(); box.innerHTML = ''; };
    show();
  }

  /** The Text command's fonts, read once each (src/fonts, SIL Open Font License). */
  const fontCache = new Map();
  const FONT_URLS = [new URL('../fonts/Outfit-Regular.ttf', import.meta.url), new URL('../fonts/Lora-Regular.ttf', import.meta.url), new URL('../fonts/JetBrainsMono-Regular.ttf', import.meta.url)];
  // A font of the user's own (LOAD FONT), read once and kept for next time; its chip follows the three.
  let customFont = null;
  const fontName = i => i === FONTS.length ? (customFont?.name ?? 'MY FONT') : FONTS[i][0];
  function useCustomFont(buffer, name) {
    const font = parseFont(buffer);
    if (!textShapes(font, 'A', 10).shapes.length) throw new Error('that font has no outline for A');
    customFont = { font, name: name.replace(/\.ttf$/i, '').toUpperCase().slice(0, 14) };
    const chip = $('tx-custom');
    chip.hidden = false;
    chip.lastChild.textContent = customFont.name;
    chip.title = `Your font (${name})`;
  }
  try {
    const kept = JSON.parse(localStorage.getItem('w3d-font') ?? 'null');
    if (kept?.data) useCustomFont(Uint8Array.from(atob(kept.data), ch => ch.charCodeAt(0)).buffer, kept.name);
  } catch { /* no storage, or a font that no longer reads */ }
  function loadFont(i) {
    if (i === FONTS.length) return customFont ? Promise.resolve(customFont.font) : Promise.reject(new Error('load a font first'));
    if (!fontCache.has(i)) fontCache.set(i, fetch(FONT_URLS[i]).then(r => { if (!r.ok) throw new Error(`the ${FONTS[i][0].toLowerCase()} font did not load`); return r.arrayBuffer(); }).then(parseFont));
    return fontCache.get(i).catch(e => { fontCache.delete(i); throw e; });
  }

  /**
   * Plasticity's Text: typed text as curves on the construction plane, in a font and size, reading
   * from above with its first baseline through the plane's origin. Each letter outline is a closed
   * curve (a region), so Extrude makes it solid; a letter's hole is its own region to cut.
   * Ctrl+Enter, right-click or OK makes the curves; Escape cancels.
   */
  function startText() {
    const c = cmd = { id: 'text', font: 0, align: 'left', shapes: [], seq: 0 };
    lastTool = 'text';
    showTool('text');
    setState('none');
    setTarget(`PLANE ${cplane.name ?? ''}`.trim());
    const area = $('tx-text'), size = $('tx-size');
    const n = cplane.normal.clone().normalize();
    let x = new THREE.Vector3(1, 0, 0).projectOnPlane(n);
    if (x.lengthSq() < 1e-6) x = new THREE.Vector3(0, 0, -1).projectOnPlane(n);
    x.normalize();
    const frame = { origin: cplane.origin.toArray(), x: x.toArray(), normal: n.toArray() };
    const buttons = () => {
      for (const b of $$('[data-txfont]')) b.setAttribute('aria-pressed', String(+b.dataset.txfont === c.font));
      for (const b of $$('[data-txalign]')) b.setAttribute('aria-pressed', String(b.dataset.txalign === c.align));
    };
    c.preview = async () => {
      const seq = ++c.seq;
      const h = parseFloat(size.value);
      let font;
      try { font = await loadFont(c.font); } catch (e) { return toast(say(e)); }
      if (cmd !== c || seq !== c.seq) return;
      const { shapes, width } = h > 0 ? textShapes(font, area.value, h, c.align) : { shapes: [], width: 0 };
      c.shapes = shapes.map(sh => ({ ...frame, kind: 'nurbs', ...sh }));
      clearPreview();
      showCurvePreview(c.shapes);
      const t = `${c.shapes.length} CURVE${c.shapes.length === 1 ? '' : 'S'} · ${width.toFixed(1)} WIDE`;
      $('tx-hint').textContent = t;
      setHud(`TEXT ${fontName(c.font)} ${h > 0 ? h : '—'} · ${t}`);
    };
    c.setFont = i => { c.font = i; buttons(); c.preview(); };
    c.setAlign = a => { c.align = a; buttons(); c.preview(); };
    area.oninput = size.oninput = () => c.preview();
    area.onkeydown = e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); area.blur(); finish(); }
      else if (e.key === 'Escape') { e.preventDefault(); area.blur(); cmd?.abort(); }
    };
    c.finish = async () => {
      await c.preview();
      if (cmd !== c) return;
      if (!c.shapes.length) { setState('failed'); return toast('TYPE SOME TEXT WITH LETTERS TO MAKE CURVES'); }
      try {
        const { ids } = await backend.addCurves(c.shapes);
        record(`TEXT "${area.value.replace(/\n/g, ' ').slice(0, 24)}"`, ids[0], curveLabel(ids[0]));
        endCmd('committed');
        await curvesChanged(ids);
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => { clearPreview(); area.oninput = size.oninput = area.onkeydown = null; };
    buttons();
    c.preview();
    area.focus();
    area.select();
  }

  /**
   * Plasticity's Place (Ctrl+D): click a reference point on the selected solids, then a destination;
   * a copy lands there, its reference face against the destination face (or its up along the
   * construction plane's normal off a face). S scales, A turns about the axis, D stands it off, F
   * turns it over, X/Y/Z set the axis instead of the destination's normal, and Q W Shift+E Shift+Q
   * combine it with the body it lands on (B keeps it separate). A click places it and starts
   * another; Enter or right-click places it and ends; Escape ends.
   */
  /**
   * Copy with Placement (Ctrl+Shift+C) is Place's first step on its own: the selected solids are kept
   * with the point clicked on them. Paste with Placement (Ctrl+Shift+V) is Place from there on with
   * those solids, here or in another file opened since: click the destination, right-click places it
   * and waits for the next, Escape ends.
   */
  function startPlace({ mode = 'place' } = {}) {
    const paste = mode === 'paste';
    if (paste && !placeClipboard) return toast('NOTHING IS COPIED · SELECT SOLIDS AND PRESS CTRL+SHIFT+C');
    const ids = paste ? [] : targetBodies().filter(b => org.shows(b));
    if (!paste && !ids.length) return toast(mode === 'copy' ? 'SELECT THE SOLIDS TO COPY' : 'SELECT THE SOLIDS TO PLACE');
    if (!backend.previewPlace || (mode !== 'place' && !backend.copyBodies)) return toast(`${mode === 'place' ? 'PLACE' : 'COPY WITH PLACEMENT'} IS NOT IN THIS BUILD YET`);
    const c = cmd = { id: 'place', mode, ids, stage: paste ? 'to' : 'from', from: paste ? placeClipboard.from : null, to: null, axis: 'normal', flip: false, instance: false, op: 'new', placed: 0, sent: 0, shown: 0 };
    lastTool = 'place';
    showTool('place');
    setState('none');
    setTarget(paste ? `${placeClipboard.count} COPIED` : ids.length === 1 ? label(ids[0]) : `${ids.length} SOLIDS`);
    const hint = t => { $('pl-hint').textContent = t; setHud(t); };
    // A point with the way out of the surface there: a face's normal, else the construction plane's.
    const pointAt = e => {
      const p = placeAt(e);
      if (p && !p.curved) return { origin: p.origin.clone(), normal: p.normal.clone(), target: p.target, snap: p.snap };
      ray(e);
      const hit = raycaster.intersectObjects(shownMeshes(), false)[0];
      if (!hit?.face) return null;
      return { origin: hit.point.clone(), normal: hit.face.normal.clone().transformDirection(hit.object.matrixWorld), target: hit.object.userData.id };
    };
    const sync = () => {
      for (const b of $$('[data-plaxis]')) b.setAttribute('aria-pressed', String(b.dataset.plaxis === c.axis));
      for (const b of $$('[data-plop]')) b.setAttribute('aria-pressed', String(b.dataset.plop === c.op));
      $('pl-flip').setAttribute('aria-pressed', String(c.flip));
      $('pl-instance').setAttribute('aria-pressed', String(c.instance));
    };
    /** The copy's motion: its up (out of the reference face) turned onto the axis, then A about it. */
    c.motion = () => {
      const up = c.from.up.clone().normalize();
      const dir = (c.axis === 'normal' ? c.to.normal.clone() : worldAxis(c.axis)).normalize();
      if (c.flip) dir.negate();
      const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
      q.premultiply(new THREE.Quaternion().setFromAxisAngle(dir, (num('pl-angle') || 0) * DEG));
      const angle = 2 * Math.acos(Math.min(1, Math.abs(q.w))), sign = q.w < 0 ? -1 : 1;
      const axis = angle < 1e-12 ? [0, 1, 0] : [q.x, q.y, q.z].map(v => sign * v / Math.sin(angle / 2));
      const at = c.to.origin.clone().addScaledVector(dir, num('pl-d') || 0);
      return { pivot: c.from.origin.toArray(), offset: at.sub(c.from.origin).toArray(), axis, angle, scale: num('pl-scale') };
    };
    c.request = () => ({ bodies: c.ids, ...(paste && { clipboard: true }), motion: c.motion(), target: c.op === 'new' ? null : c.to.target ?? null, op: c.op });
    c.preview = () => {
      sync();
      if (!c.to) return;
      livePreview(c, () => backend.previewPlace(c.request()), p => {
        if (p.result) showPreviewBody(p.result);
        const look = phantom[c.op === 'difference' || c.op === 'slice' ? 'cut' : 'add'];
        for (const t of p.tools) { const m = meshOf(t, look.face, look.edge); m.renderOrder = 5; previewGroup.add(m); }
        for (const t of p.pieces) { const m = meshOf(t, phantom.add.face, phantom.add.edge); m.renderOrder = 6; previewGroup.add(m); }
        setHud(c.instance ? 'PLACE · INSTANCE' : `PLACE · ${({ new: 'NEW BODY', union: 'UNION', difference: 'DIFFERENCE', intersect: 'INTERSECT', slice: 'SLICE' })[c.op]}`);
      }, 'pl-hint');
    };
    c.move = e => {
      if (c.stage === 'adjust') return;
      const p = pointAt(e);
      showSnap(p?.snap, e);
      if (c.stage === 'to' && p) { c.to = p; c.preview(); }
    };
    c.click = e => {
      if (c.stage === 'adjust') { place(true); return true; }
      const p = pointAt(e);
      if (!p) return true;
      if (c.stage === 'from') {
        // Off a face the copy's up is the way out of it; on the plane, the plane's normal.
        c.from = { origin: p.origin, up: p.target !== null && p.target !== undefined ? p.normal.clone().negate() : cplane.normal.clone() };
        if (mode === 'copy') { copyForPlacement(); return true; }
        c.stage = 'to';
        hint('CLICK THE DESTINATION');
        return true;
      }
      c.to = p;
      c.stage = 'adjust';
      c.preview();
      hint(paste ? 'S A D F X Y Z · Q W ⇧E ⇧Q B · RIGHT-CLICK OR CLICK TO PLACE' : 'S A D F I X Y Z · Q W ⇧E ⇧Q B · CLICK TO PLACE');
      return true;
    };
    c.key = action => {
      if (action === 'flip') { c.flip = !c.flip; c.preview(); return true; }
      // An instance stands on its own, so it combines with nothing.
      if (action === 'instance' && paste) { toast('PASTED SOLIDS ARE COPIES; PLACE (CTRL+D) MAKES INSTANCES'); return true; }
      if (action === 'instance') { c.instance = !c.instance; if (c.instance) c.op = 'new'; c.preview(); return true; }
      if (action.startsWith('axis-')) { const a = action.slice(5); c.axis = c.axis === a ? 'normal' : a; c.preview(); return true; }
      if (['union', 'difference', 'intersect', 'slice', 'new'].includes(action)) {
        if (action !== 'new' && c.instance) { toast('AN INSTANCE CANNOT COMBINE; TURN INSTANCE (I) OFF'); return true; }
        if (action !== 'new' && c.to && (c.to.target === null || c.to.target === undefined)) { toast('PLACE IT ON A SOLID TO COMBINE WITH IT'); return true; }
        c.op = action; c.preview(); return true;
      }
      const field = { scale: ['pl-scale', 'SCALE'], angle: ['pl-angle', 'ANGLE'], offset: ['pl-d', 'OFFSET'] }[action];
      if (!field) return false;
      c.entry = { label: field[1], text: '', apply: v => { $(field[0]).value = v; c.preview(); } };
      setHud(`${field[1]} _`);
      return true;
    };
    c.entryDone = () => { if (c.entry) setHud(`${c.entry.label} ${c.entry.text}_`); };
    /** Place the copy where it is shown; `again` waits for the next destination. */
    async function place(again) {
      try {
        if (c.instance) {
          // Each solid's instance: the master turned and scaled about the point picked on it, then moved.
          const m = c.motion();
          const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...m.axis).normalize(), m.angle);
          for (const id of c.ids) instances.push({ ...newInstance(nextInstance++, id, m.pivot), position: m.pivot.map((v, i) => v + m.offset[i]), quaternion: q.toArray(), scale: m.scale });
          c.placed++;
          drawInstances();
          renderOutliner();
        } else {
          const { ids: made, scene: list } = await backend.commitPlace(c.request());
          c.placed++;
          record(`${paste ? 'PASTE WITH PLACEMENT' : 'PLACE'}${c.op !== 'new' ? ` · ${c.op.toUpperCase()}` : ''}`, made[0], made.length > 1 ? `${made.length} BODIES` : label(made[0]));
          await showScene(list);
        }
        if (!again) return endCmd('committed');
        clearPreview();
        c.stage = 'to';
        setState('committed');
        hint('CLICK WHERE THE NEXT GOES · ESC TO END');
      } catch (e) { setState('failed'); toast(say(e)); }
    }
    async function copyForPlacement() {
      try {
        const count = await backend.copyBodies(c.ids);
        placeClipboard = { count, from: { origin: c.from.origin.clone(), up: c.from.up.clone() } };
        endCmd('committed');
        toast(`COPIED ${count === 1 ? label(c.ids[0]) : `${count} SOLIDS`} · CTRL+SHIFT+V PASTES`);
      } catch (e) { setState('failed'); toast(say(e)); }
    }
    // Paste with Placement: right-click (or Enter) places the copy and waits for the next.
    c.finish = async () => { if (c.stage === 'adjust') return place(!paste ? false : true); endCmd(c.placed ? 'committed' : 'cancelled'); };
    c.abort = () => endCmd(c.placed ? 'committed' : 'cancelled');
    c.cleanup = () => clearPreview();
    for (const [id, v] of [['pl-scale', 1], ['pl-angle', 0], ['pl-d', 0]]) $(id).value = v;
    sync();
    if (paste) hint('CLICK THE DESTINATION · RIGHT-CLICK PLACES IT · ESC ENDS');
    else hint(`CLICK A POINT ON ${ids.length === 1 ? label(ids[0]) : 'THE SOLIDS'} TO ${mode === 'copy' ? 'COPY' : 'PLACE'} FROM`);
  }
  // Copy with Placement's solids are kept by the backend; this is the point picked on them.
  let placeClipboard = null;

  /**
   * Plasticity's Unwrap Face: each selected face laid flat on the XY plane as a new sheet under where
   * it was; the body stays. Planes, cylinders and cones keep their lengths; other faces are
   * flattened conformally, keeping their area.
   */
  function startUnwrap() {
    const body = faceBody();
    if (body === null) return toast(sel.list('face').length ? 'UNWRAP THE FACES OF ONE BODY AT A TIME' : 'SELECT THE FACES TO UNWRAP');
    if (!backend.previewUnwrap) return toast('UNWRAP FACE IS NOT IN THIS BUILD YET');
    const c = cmd = { id: 'unwrap', body, faces: [], sent: 0, shown: 0 };
    lastTool = 'unwrap';
    showTool('unwrap');
    setState('none');
    c.request = () => ({ body: c.body, faces: c.faces });
    c.preview = () => livePreview(c, () => backend.previewUnwrap(c.request()), b => {
      showPreviewBody(b);
      $('uw-hint').textContent = `${c.faces.length} FACE${c.faces.length > 1 ? 'S' : ''} OF ${label(c.body)} LAID FLAT ON XY`;
      setHud('UNWRAP FACE');
    }, 'uw-hint');
    c.onSelection = () => {
      drawOverlays();
      const b = faceBody();
      if (b === null) return setHud('SELECT FACES OF ONE BODY TO UNWRAP');
      c.body = b;
      c.faces = sel.list('face').map(it => it.n).sort((x, y) => x - y);
      setTarget(label(b));
      c.preview();
    };
    c.click = e => {
      const hit = pickAt(e);
      if (hit?.kind !== 'face') return true;
      sel.toggle({ kind: 'face', body: hit.body, n: hit.n });
      selectionChanged();
      return true;
    };
    c.finish = async () => {
      try {
        const { ids, scene: list } = await backend.commitUnwrap(c.request());
        endCmd('committed');
        record(`UNWRAP FACE ×${c.faces.length}`, ids[0]);
        await showScene(list);
        sel.clear();
        for (const id of ids) sel.add({ kind: 'solid', body: id });
        selectionChanged({ quiet: true });
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => clearPreview();
    c.onSelection();
  }

  function startRebuildFace() {
    const body = faceBody();
    if (body === null) return toast(sel.list('face').length ? 'REBUILD THE FACES OF ONE BODY AT A TIME' : 'SELECT THE FACES TO REBUILD');
    if (!backend.previewRebuildFaces) return toast('REBUILD FACE IS NOT IN THIS BUILD YET');
    const c = cmd = { id: 'rebuild-face', body, faces: [], method: 'tolerance', shrink: true, sent: 0, shown: 0 };
    lastTool = 'rebuild-face';
    showTool('rebuild-face');
    setState('none');
    c.request = () => ({
      body: c.body, faces: c.faces, explicit: c.method === 'explicit', tolerance: num('rf-tol'),
      degree: [num('rf-du'), num('rf-dv')], spans: [num('rf-su'), num('rf-sv')], extend: [num('rf-eu'), num('rf-ev')], shrink: c.shrink,
    });
    const mm = d => d < 0.001 ? d.toExponential(1) : d.toFixed(3);
    c.preview = () => livePreview(c, () => backend.previewRebuildFaces(c.request()), b => {
      showPreviewBody(b);
      const r = b.rebuilt ?? [];
      $('rf-cvs').textContent = r.map(f => `${f.poles[0]}×${f.poles[1]}`).join(' ') || '—';
      const dev = Math.max(0, ...r.map(f => f.deviation));
      $('rf-hint').textContent = `${c.faces.length} FACE${c.faces.length > 1 ? 'S' : ''} OF ${label(c.body)} · MAX DEVIATION ${mm(dev)} MM`;
      setHud(c.method === 'explicit' ? `REBUILD FACE · DEGREE ${num('rf-du')}×${num('rf-dv')} · SPANS ${num('rf-su')}×${num('rf-sv')}` : `REBUILD FACE · WITHIN ${num('rf-tol')} MM`);
    }, 'rf-hint');
    c.setMethod = m => {
      c.method = m;
      for (const b of $$('[data-rbmethod]')) b.setAttribute('aria-pressed', String(b.dataset.rbmethod === m));
      for (const f of $$('[data-rf]')) f.hidden = f.dataset.rf !== m;
      c.preview();
    };
    c.setShrink = on => {
      c.shrink = on;
      $('rf-shrink').setAttribute('aria-pressed', String(on));
      c.preview();
    };
    c.onSelection = () => {
      drawOverlays();
      const b = faceBody();
      if (b === null) return setHud('SELECT FACES OF ONE BODY TO REBUILD');
      c.body = b;
      c.faces = sel.list('face').map(it => it.n).sort((x, y) => x - y);
      setTarget(label(b));
      c.preview();
    };
    c.key = action => {
      if (action === 'method') { c.setMethod(c.method === 'explicit' ? 'tolerance' : 'explicit'); return true; }
      if (action === 'shrink') { c.setShrink(!c.shrink); return true; }
      // Degree, spans and extend take "u v", or one number for both.
      const pair = { degree: ['rf-du', 'rf-dv', 'DEGREE'], spans: ['rf-su', 'rf-sv', 'SPANS'], extend: ['rf-eu', 'rf-ev', 'EXTEND'] }[action];
      if (pair) {
        if (action !== 'extend' && c.method !== 'explicit') c.setMethod('explicit');
        c.entry = { label: pair[2], text: '', apply: v => { $(pair[0]).value = v; $(pair[1]).value = v; c.preview(); } };
        setHud(`${pair[2]} _`);
        return true;
      }
      if (action === 'tolerance') {
        if (c.method !== 'tolerance') c.setMethod('tolerance');
        c.entry = { label: 'TOLERANCE', text: '', apply: v => { $('rf-tol').value = v; c.preview(); } };
        setHud('TOLERANCE _');
        return true;
      }
      return false;
    };
    c.click = e => {
      const hit = pickAt(e);
      if (hit?.kind !== 'face' || !(e.ctrlKey || e.metaKey || e.shiftKey)) return true;
      sel.toggle({ kind: 'face', body: hit.body, n: hit.n });
      selectionChanged();
      return true;
    };
    c.finish = async () => {
      try {
        const { id, scene: list, rebuilt } = await backend.commitRebuildFaces(c.request());
        endCmd('committed');
        const dev = Math.max(0, ...(rebuilt ?? []).map(f => f.deviation));
        record(`REBUILD FACE ×${c.faces.length}`, id, `${(rebuilt ?? []).map(f => `${f.poles[0]}×${f.poles[1]} CVS`).join(' ')} · ${mm(dev)} MM`);
        await showScene(list);
        sel.replace({ kind: 'solid', body: id });
        selectionChanged({ quiet: true });
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => clearPreview();
    c.setMethod('tolerance');
    c.onSelection();
  }

  async function startRebuild() {
    if (cmd) await finish();
    if (!backend.replaceCurves) return toast('REBUILD IS NOT IN THIS BUILD YET');
    const ids = sel.curves.filter(curveById);
    if (!ids.length && sel.list('face').length) return startRebuildFace();
    if (!ids.length) return toast('SELECT A CURVE OR FACES TO REBUILD');
    const c = cmd = { id: 'rebuild', out: null };
    lastTool = 'rebuild';
    showTool('rebuild');
    setState('none');
    setTarget(ids.length > 1 ? `${ids.length} CURVES` : curveLabel(ids[0]));
    const first = curveById(ids[0]);
    $('rb-n').value = first.kind === 'nurbs' ? first.poles.length - (isClosed(first) ? 1 : 0) : first.kind === 'cv' ? first.points.length : 8;
    $('rb-p').value = first.kind === 'nurbs' ? first.degree : 3;
    c.preview = () => {
      clearPreview();
      const n = num('rb-n'), p = num('rb-p');
      try {
        if (!Number.isInteger(n) || !Number.isInteger(p)) throw new Error('type whole numbers');
        const made = ids.map(id => rebuildCurve(curveById(id), n, p));
        c.out = made.map(m => m.curve);
        showCurvePreview(c.out);
        for (const r of c.out) {
          const f = curveFrame(r), hull = r.poles.map(([x, y]) => lift(f, { x, y }, 0.03));
          previewGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(hull), curveMat.normal));
          previewGroup.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(hull), hullDots));
        }
        const dev = Math.max(...made.map(m => m.deviation));
        $('rb-hint').textContent = `MAX DEVIATION ${dev < 0.001 ? dev.toExponential(1) : dev.toFixed(3)} MM`;
        setHud(`REBUILD ${n} POINTS · DEGREE ${p}`);
        setState('updated');
      } catch (e) { c.out = null; $('rb-hint').textContent = say(e); setHud('REBUILD FAILED'); setState('failed'); }
    };
    c.key = action => {
      const field = action === 'count' ? 'rb-n' : action === 'degree' ? 'rb-p' : null;
      if (!field) return false;
      const label = action === 'count' ? 'CONTROL POINTS' : 'DEGREE';
      c.entry = { label, text: '', apply: v => { $(field).value = v; c.preview(); } };
      setHud(`${label} _`);
      return true;
    };
    c.finish = async () => {
      if (!c.out) return toast($('rb-hint').textContent);
      try {
        const { ids: made } = await backend.replaceCurves(ids, c.out);
        endCmd('committed');
        record(`REBUILD ${ids.map(curveLabel).join(' ')}`, made[0], `${num('rb-n')} POINTS · DEGREE ${num('rb-p')}`);
        await curvesChanged(made);
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => clearPreview();
    c.preview();
  }

  /** Plasticity's Trim: click pieces of curves to cut them away where other curves cross them. */
  function startTrim() {
    if (!backend.replaceCurves) return toast('TRIM IS NOT IN THIS BUILD YET');
    const c = cmd = { id: 'trim', count: 0 };
    lastTool = 'trim';
    showTool('trim');
    setState('none');
    setHud('CLICK A PIECE TO CUT AWAY');
    c.click = async e => {
      const hit = pickAt(e);
      const src = (hit?.kind === 'curve' || hit?.kind === 'region') && curveById(hit.id);
      if (!src || !hit.point) return true;
      const f = curveFrame(src), d = hit.point.clone().sub(f.o);
      try {
        const keep = trim(src, curveList.filter(o => o.id !== src.id), [d.dot(f.x), d.dot(f.y)]);
        const { ids: made } = await backend.replaceCurves([src.id], keep);
        c.count++;
        record(`TRIM ${curveLabel(src.id)}`, made[0] ?? src.id, made.length ? curveLabel(made[0]) : '—');
        await loadCurves();
        setHud(`${c.count} CUT · CLICK ANOTHER, OR ⏎`);
        setState('committed');
      } catch (err) { setState('failed'); toast(say(err)); }
      return true;
    };
    c.finish = () => endCmd(c.count ? 'committed' : 'cancelled');
    c.abort = () => endCmd(c.count ? 'committed' : 'cancelled');
  }

  /**
   * Plasticity's Cut Curve: the selected curves are cut wherever the cutter curves cross them, keeping
   * every piece. A cutter in another plane cuts by the surface it sweeps along its normal (S: along
   * the view); Tab carries short cutters on past their ends.
   */
  function startCutCurve() {
    if (!backend.replaceCurves) return toast('CUT CURVE IS NOT IN THIS BUILD YET');
    const targets = sel.curves.filter(curveById);
    if (!targets.length) return toast('SELECT THE CURVES TO CUT, THEN RUN CUT CURVE');
    const c = cmd = { id: 'cut-curve', targets, cutters: [], faces: [], sections: new Map(), extend: false, screen: false, out: null };
    // A face cuts each curve where the face crosses the curve's plane; those crossings, by face and plane.
    const sectionKey = (f, src) => `${f.body}:${f.n}:${src.origin.join()}:${src.normal.join()}`;
    lastTool = 'cut-curve';
    showTool('cut-curve');
    setState('none');
    setTarget(targets.map(curveLabel).join(' '));
    const dots = new THREE.Group();
    scene.add(dots);
    c.preview = () => {
      for (const o of [...dots.children]) { o.geometry.dispose(); o.removeFromParent(); }
      $('cc-targets').textContent = targets.length;
      $('cc-cutters').textContent = c.cutters.length;
      $('cc-faces').textContent = c.faces.length;
      $('cc-extend').setAttribute('aria-pressed', String(c.extend));
      $('cc-screen').setAttribute('aria-pressed', String(c.screen));
      c.out = null;
      if (!c.cutters.length && !c.faces.length) { $('cc-hint').textContent = 'CLICK THE CURVES OR FACES TO CUT WITH'; setHud('CLICK THE CUTTERS'); return setState('none'); }
      // Faces' crossings with each curve's plane come from the kernel; fetch any missing, then come back.
      const missing = [];
      for (const id of targets) { const src = curveById(id); for (const f of c.faces) if (!c.sections.has(sectionKey(f, src))) missing.push([f, src]); }
      if (missing.length) {
        setState('updating');
        // One at a time: a newer preview call answers an older one with nothing, and then takes over.
        (async () => {
          for (const [f, src] of missing) {
            const curves = await backend.previewProject({ mode: 'section', body: f.body, faces: [f.n], origin: src.origin, normal: src.normal });
            if (cmd !== c || curves == null) return;
            c.sections.set(sectionKey(f, src), curves);
          }
          c.preview();
        })().catch(e => { setState('failed'); toast(say(e)); });
        return;
      }
      const dir = c.screen ? camera.getWorldDirection(new THREE.Vector3()).toArray() : null;
      try {
        const others = c.cutters.map(curveById);
        const faceCuts = src => c.faces.flatMap(f => c.sections.get(sectionKey(f, src)));
        const out = targets.map(id => {
          const src = curveById(id);
          return { id, src, pieces: cutCurve(src, [...cuttersFor(src, others, { dir, extend: c.extend }), ...cuttersFor(src, faceCuts(src))]) };
        });
        const ends = [];
        for (const { src, pieces } of out) {
          if (pieces.length < 2 && pieces[0] === src) continue;
          const f = curveFrame(src);
          for (const q of pieces) { const pts = curveSamples(q).points; for (const p of [pts[0], pts[pts.length - 1]]) ends.push(lift(f, { x: p[0], y: p[1] })); }
        }
        if (ends.length) { const d = new THREE.Points(new THREE.BufferGeometry().setFromPoints(ends), hullDots); d.renderOrder = 12; dots.add(d); }
        const n = out.reduce((k, o) => k + o.pieces.length, 0);
        c.out = out;
        $('cc-hint').textContent = `${targets.length} CURVE${targets.length > 1 ? 'S' : ''} INTO ${n} PIECES`;
        setHud(`CUT INTO ${n} PIECES`);
        setState('updated');
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.key = action => {
      if (action === 'extend') { c.extend = !c.extend; c.preview(); return true; }
      if (action === 'screen') { c.screen = !c.screen; c.preview(); return true; }
      return false;
    };
    c.click = e => {
      const hit = pickAt(e);
      if (hit?.kind === 'face') {
        const has = c.faces.some(f => f.body === hit.body && f.n === hit.n);
        c.faces = has ? c.faces.filter(f => !(f.body === hit.body && f.n === hit.n)) : [...c.faces, { body: hit.body, n: hit.n }];
        c.preview();
        return true;
      }
      const id = (hit?.kind === 'curve' || hit?.kind === 'region') ? hit.id : null;
      if (id === null || targets.includes(id)) return true;
      c.cutters = c.cutters.includes(id) ? c.cutters.filter(x => x !== id) : [...c.cutters, id];
      c.preview();
      return true;
    };
    c.finish = async () => {
      const changed = (c.out ?? []).filter(o => !(o.pieces.length === 1 && o.pieces[0] === o.src));
      if (!changed.length) { setState('failed'); return toast(c.cutters.length || c.faces.length ? 'THE CUTTERS DO NOT CROSS THOSE CURVES (TAB EXTENDS THEM)' : 'CLICK THE CURVES OR FACES TO CUT WITH'); }
      try {
        const { ids: made } = await backend.replaceCurves(changed.map(o => o.id), changed.flatMap(o => o.pieces));
        endCmd('committed');
        record('CUT CURVE', made[0], `${made.length} PIECES`);
        await curvesChanged(made);
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => { for (const o of [...dots.children]) o.geometry.dispose(); dots.removeFromParent(); };
    c.preview();
  }

  /** Plasticity's Remove Face: the selected faces go and their neighbours close the gap. */
  function startRemoveFace() {
    const body = faceBody();
    if (body === null) return toast(sel.list('face').length ? 'REMOVE FACES OF ONE SOLID AT A TIME' : 'SELECT THE FACES TO REMOVE');
    if (!backend.previewRemoveFaces) return toast('REMOVE FACE NEEDS THE DESKTOP APP; THE BROWSER KERNEL CANNOT DO IT YET');
    const c = cmd = { id: 'remove-face', body, faces: [], sent: 0, shown: 0 };
    lastTool = 'remove-face';
    showTool('remove-face');
    setState('none');
    c.request = () => ({ body: c.body, faces: c.faces });
    c.preview = () => livePreview(c, () => backend.previewRemoveFaces(c.request()), b => { showPreviewBody(b); setHud(`REMOVE ${c.faces.length} FACE${c.faces.length > 1 ? 'S' : ''}`); }, 'rf-hint');
    c.onSelection = () => {
      drawOverlays();
      const b = faceBody();
      if (b === null) return setHud('SELECT FACES TO REMOVE');
      c.body = b;
      c.faces = sel.list('face').map(it => it.n).sort((x, y) => x - y);
      setTarget(label(b));
      $('rf-count').textContent = c.faces.length;
      $('rf-hint').textContent = `${c.faces.length} FACE${c.faces.length > 1 ? 'S' : ''} ON ${label(b)}`;
      c.preview();
    };
    c.click = e => {
      const hit = pickAt(e);
      if (hit?.kind !== 'face' || !(e.ctrlKey || e.metaKey || e.shiftKey)) return true;
      sel.toggle({ kind: 'face', body: hit.body, n: hit.n });
      selectionChanged();
      return true;
    };
    c.finish = async () => {
      try {
        const { id, scene: list } = await backend.commitRemoveFaces(c.request());
        endCmd('committed');
        record(`REMOVE FACE ×${c.faces.length}`, id);
        await showScene(list);
        sel.replace({ kind: 'solid', body: id });
        selectionChanged({ quiet: true });
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => clearPreview();
    c.onSelection();
  }

  /**
   * Plasticity's Cut: select the solids and the curves drawn across them, then Cut. Each curve
   * cuts straight through along its plane's normal; every piece becomes its own body, the biggest
   * keeping the solid's name. Shift+click adds or drops solids and curves while the preview shows.
   */
  function startCut() {
    if (!backend.previewCut) return toast('CUT IS NOT IN THIS BUILD YET');
    const c = cmd = { id: 'cut', bodies: [], curves: [], faces: [], plane: false, sent: 0, shown: 0 };
    lastTool = 'cut';
    showTool('cut');
    setState('none');
    $('cut-plane').setAttribute('aria-pressed', 'false');
    c.request = () => ({ bodies: c.bodies, curves: c.curves, tools: { faces: c.faces, plane: c.plane ? { origin: cplane.origin.toArray(), normal: cplane.normal.toArray() } : null } });
    c.key = action => {
      if (action !== 'plane') return false;
      c.plane = !c.plane;
      $('cut-plane').setAttribute('aria-pressed', c.plane);
      c.onSelection();
      return true;
    };
    c.preview = () => livePreview(c, () => backend.previewCut(c.request()), list => {
      showCopies(list);
      $('cut-pieces').textContent = list.length;
      setHud(`CUT INTO ${list.length} PIECES`);
    }, 'cut-hint');
    c.onSelection = () => {
      drawOverlays();
      c.bodies = sel.solids.filter(b => org.shows(b));
      c.curves = sel.curves.filter(curveById);
      c.faces = sel.list('face').map(it => ({ body: it.body, face: it.n }));
      $('cut-solids').textContent = c.bodies.length;
      $('cut-curves').textContent = c.curves.length;
      $('cut-faces').textContent = c.faces.length;
      $('cut-pieces').textContent = '—';
      setTarget(c.bodies.length === 1 ? label(c.bodies[0]) : c.bodies.length ? `${c.bodies.length} SOLIDS` : '—');
      const by = [c.curves.length && `${c.curves.length} CURVE${c.curves.length > 1 ? 'S' : ''}`, c.faces.length && `${c.faces.length} FACE${c.faces.length > 1 ? 'S' : ''}`, c.plane && `PLANE ${cplane.name}`].filter(Boolean);
      const missing = !c.bodies.length ? 'SELECT THE SOLIDS TO CUT' : !by.length ? 'SELECT CURVES OR FACES, OR P FOR THE PLANE' : null;
      $('cut-hint').textContent = missing ?? `${c.bodies.length} SOLID${c.bodies.length > 1 ? 'S' : ''} · ${by.join(' · ')}`;
      if (missing) { clearPreview(); return setHud(missing); }
      c.preview();
    };
    c.click = e => {
      if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return true;
      const hit = pickAt(e);
      if (hit?.kind === 'curve') sel.toggle({ kind: 'curve', id: hit.id });
      else if (hit?.kind === 'face' && e.altKey) sel.toggle({ kind: 'face', body: hit.body, n: hit.n });
      else if (hit?.body !== undefined) sel.toggle({ kind: 'solid', body: hit.body });
      else return true;
      selectionChanged();
      return true;
    };
    c.finish = async () => {
      if (!c.bodies.length || !(c.curves.length || c.faces.length || c.plane)) { setState('failed'); return toast($('cut-hint').textContent); }
      try {
        const { ids, scene: list } = await backend.commitCut(c.request());
        endCmd('committed');
        record(`CUT${c.plane ? ` BY PLANE ${cplane.name}` : ''}${c.curves.length ? ` ×${c.curves.length} CURVE` : ''}${c.faces.length ? ` ×${c.faces.length} FACE` : ''}`, ids[0], `${ids.length} PIECES`);
        await showScene(list);
        sel.clear();
        for (const b of ids) sel.add({ kind: 'solid', body: b });
        selectionChanged({ quiet: true });
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => clearPreview();
    c.onSelection();
  }

  /**
   * Plasticity's Imprint: the selected curves projected along their planes' normals onto the
   * selected faces of one solid (every face when the solid itself is selected), splitting them
   * there. The body stays whole; the new edges can be filleted and the new faces pushed or pulled.
   */
  function startImprint() {
    if (!backend.previewImprint) return toast('IMPRINT IS NOT IN THIS BUILD YET');
    const c = cmd = { id: 'imprint', body: null, faces: [], curves: [], tools: [], method: 'normal', axis: null, flip: false, screen: false, both: true, hide: false, complete: 'none', sent: 0, shown: 0 };
    lastTool = 'imprint';
    showTool('imprint');
    setState('none');
    const AXES = { x: [1, 0, 0], y: [0, 0, -1], z: [0, 1, 0] };
    // The Vector method's direction, in the viewport's axes: an axis, the view, or down the plane's normal.
    const vector = () => c.screen ? camera.getWorldDirection(new THREE.Vector3())
      : c.axis ? new THREE.Vector3(...AXES[c.axis]).multiplyScalar(c.flip ? -1 : 1) : cplane.normal.clone().negate();
    const dirName = () => c.screen ? 'SCREEN' : c.method === 'normal' ? 'EACH CURVE\'S NORMAL' : c.axis ? `${c.flip ? '−' : '+'}${c.axis.toUpperCase()}` : `−${cplane.name} NORMAL`;
    c.request = () => ({
      body: c.body, faces: c.faces, curves: c.curves, tools: { bodies: c.tools },
      projection: { dir: c.method === 'vector' || c.screen ? vector().toArray() : null, both: c.both, hide: c.hide, complete: c.complete === 'edge' },
    });
    const showOptions = () => {
      for (const b of $$('[data-imp]')) {
        const k = b.dataset.imp;
        b.setAttribute('aria-pressed', String(k === 'normal' ? c.method === 'normal' && !c.screen : k === 'vector' ? c.method === 'vector' && !c.screen : !!c[k]));
      }
      for (const b of $$('[data-impcomp]')) b.setAttribute('aria-pressed', String(b.dataset.impcomp === c.complete));
      $('imp-dir').textContent = dirName();
    };
    c.key = action => {
      if (action === 'screen') { c.screen = !c.screen; if (c.screen) c.both = c.hide = true; }
      else if (action.startsWith('axis-')) {
        const a = action.slice(5);
        c.flip = c.method === 'vector' && c.axis === a && !c.screen ? !c.flip : false;
        c.axis = a;
        // Choosing Vector turns Bidirectional and Hide Occlusion on, as the manual has it.
        if (c.method !== 'vector') c.both = c.hide = true;
        c.method = 'vector';
        c.screen = false;
      } else if (action === 'normal' || action === 'vector') {
        if (action === 'vector' && c.method !== 'vector') c.both = c.hide = true;
        c.method = action;
        c.screen = false;
      } else if (action === 'both' || action === 'hide') c[action] = !c[action];
      else if (action === 'complete') c.complete = c.complete === 'none' ? 'edge' : 'none';
      else if (action === 'complete-none' || action === 'complete-edge') c.complete = action.slice(9);
      else return false;
      c.onSelection();
      return true;
    };
    c.preview = () => livePreview(c, () => backend.previewImprint(c.request()), b => {
      showPreviewBody(b);
      setHud(`IMPRINT ${c.curves.length} CURVE${c.curves.length > 1 ? 'S' : ''}${c.curves.length ? ` · ${dirName()}${c.both ? ' · BOTH WAYS' : ''}${c.hide ? ' · SEEN FACES' : ''}${c.complete === 'edge' ? ' · TO EDGES' : ''}` : ''}`);
    }, 'imp-hint');
    c.onSelection = () => {
      drawOverlays();
      // The faces' body, or the first solid picked, takes the imprint; other solids make it.
      const fb = faceBody(), solids = sel.solids.filter(b => org.shows(b));
      c.body = fb ?? solids[0] ?? null;
      c.faces = fb === null ? [] : sel.list('face').map(it => it.n).sort((x, y) => x - y);
      c.curves = sel.curves.filter(curveById);
      c.tools = solids.filter(b => b !== c.body);
      $('imp-faces').textContent = c.faces.length || 'ALL';
      $('imp-curves').textContent = c.curves.length;
      $('imp-bodies').textContent = c.tools.length;
      showOptions();
      setTarget(c.body === null ? '—' : label(c.body));
      const by = [c.curves.length && `${c.curves.length} CURVE${c.curves.length > 1 ? 'S' : ''}`, ...c.tools.map(label)].filter(Boolean);
      const missing = c.body === null ? 'SELECT FACES OF ONE SOLID, OR THE SOLID' : !by.length ? 'SELECT CURVES, OR ANOTHER SOLID THAT MEETS IT' : null;
      $('imp-hint').textContent = missing ?? `${by.join(' · ')} ON ${c.faces.length || 'ALL'} FACE${c.faces.length === 1 ? '' : 'S'} OF ${label(c.body)}`;
      if (missing) { clearPreview(); return setHud(missing); }
      c.preview();
    };
    c.click = e => {
      if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return true;
      const hit = pickAt(e);
      if (hit?.kind === 'curve') sel.toggle({ kind: 'curve', id: hit.id });
      else if (hit?.kind === 'face' && e.altKey) sel.toggle({ kind: 'solid', body: hit.body });
      else if (hit?.kind === 'face') sel.toggle({ kind: 'face', body: hit.body, n: hit.n });
      else return true;
      selectionChanged();
      return true;
    };
    c.finish = async () => {
      if (c.body === null || !(c.curves.length || c.tools.length)) { setState('failed'); return toast($('imp-hint').textContent); }
      try {
        const { id, scene: list } = await backend.commitImprint(c.request());
        endCmd('committed');
        record(`IMPRINT${c.curves.length ? ` ×${c.curves.length} CURVE` : ''}${c.tools.length ? ` ${c.tools.map(label).join(' ')}` : ''}`, id);
        await showScene(list);
        sel.replace({ kind: 'solid', body: id });
        selectionChanged({ quiet: true });
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => clearPreview();
    c.onSelection();
  }

  /**
   * Plasticity's Project (I), by what is selected: curves and a solid (or faces of one) give the
   * curves carried onto it (Project Curve Body); two solids, the curves where they meet (Body Body);
   * two curves, where their sheets cross (Curve Curve). New curves are made; the projected ones stay.
   * Curve Body's methods, as the manual gives them: NORMAL goes along the construction plane's
   * normal and keeps every face crossed; VECTOR goes along a direction (X, Y or Z, again to flip;
   * down the plane's normal to start), with BIDIRECTIONAL and HIDE OCCLUDED. S uses the view.
   */
  function startProject() {
    if (!backend.previewProject) return toast('PROJECT IS NOT IN THIS BUILD YET');
    const c = cmd = { id: 'project', method: 'normal', axis: null, flip: false, screen: false, both: false, hide: false, out: null, req: null, sent: 0, shown: 0 };
    lastTool = 'project';
    showTool('project');
    setState('none');
    const AXES = { x: [1, 0, 0], y: [0, 0, -1], z: [0, 1, 0] };
    const dirName = () => c.screen ? 'SCREEN' : c.method === 'normal' ? `${cplane.name} NORMAL` : c.axis ? `${c.flip ? '−' : '+'}${c.axis.toUpperCase()}` : `−${cplane.name} NORMAL`;
    // Where Curve Body carries the curves, in the viewport's axes.
    c.dir = () => {
      if (c.screen) return camera.getWorldDirection(new THREE.Vector3());
      if (c.method === 'normal') return cplane.normal.clone();
      if (c.axis) return new THREE.Vector3(...AXES[c.axis]).multiplyScalar(c.flip ? -1 : 1);
      return cplane.normal.clone().negate();
    };
    c.request = () => {
      const fb = faceBody(), solids = sel.solids.filter(b => org.shows(b)), curves = sel.curves.filter(curveById);
      if (fb === null && solids.length === 2 && !curves.length) return { mode: 'body-body', bodies: solids };
      if (fb === null && !solids.length && curves.length === 2) return { mode: 'curve-curve', curves };
      // One solid alone: its outline seen along the construction plane's normal (Project Outline).
      if (fb === null && solids.length === 1 && !curves.length) return { mode: 'outline', body: solids[0], origin: cplane.origin.toArray(), normal: cplane.normal.toArray() };
      const body = fb ?? solids[0] ?? null;
      if (body === null || !curves.length) return null;
      const vector = c.method === 'vector' || c.screen;
      return {
        mode: 'curve-body', body, curves, dir: c.dir().toArray(),
        faces: fb === null ? [] : sel.list('face').map(it => it.n).sort((x, y) => x - y),
        both: vector && c.both, hide: vector && c.hide,
      };
    };
    const MODES = { 'curve-body': 'CURVES ON BODY', 'body-body': 'WHERE BODIES MEET', 'curve-curve': 'WHERE CURVES CROSS', outline: 'OUTLINE ON THE PLANE' };
    c.preview = () => livePreview(c, () => backend.previewProject(c.req), out => {
      c.out = out;
      showCurvePreview(out);
      $('proj-count').textContent = out.length;
      $('proj-hint').textContent = `${out.length} CURVE${out.length === 1 ? '' : 'S'} · ${MODES[c.req.mode]}`;
      setHud(`PROJECT ${out.length} CURVE${out.length === 1 ? '' : 'S'}`);
    }, 'proj-hint');
    c.onSelection = () => {
      drawOverlays();
      c.req = c.request();
      c.out = null;
      const curveBody = c.req?.mode === 'curve-body' || !c.req;
      for (const b of $$('[data-proj]')) {
        const k = b.dataset.proj;
        b.setAttribute('aria-pressed', String(k === 'normal' ? c.method === 'normal' && !c.screen : k === 'vector' ? c.method === 'vector' && !c.screen : !!c[k]));
        b.disabled = !curveBody || ((k === 'both' || k === 'hide') && c.method !== 'vector' && !c.screen);
      }
      $('proj-mode').textContent = c.req ? MODES[c.req.mode] : '—';
      $('proj-dir').textContent = curveBody ? dirName() : '—';
      setTarget(c.req?.mode === 'curve-body' || c.req?.mode === 'outline' ? label(c.req.body) : c.req?.mode === 'body-body' ? c.req.bodies.map(label).join(' · ') : c.req ? c.req.curves.map(curveLabel).join(' · ') : '—');
      if (!c.req) {
        const missing = 'SELECT A SOLID AND CURVES, A SOLID ALONE, TWO SOLIDS, OR TWO CURVES';
        $('proj-hint').textContent = missing;
        $('proj-count').textContent = 0;
        clearPreview();
        return setHud(missing);
      }
      c.preview();
    };
    c.key = action => {
      if (action === 'screen') c.screen = !c.screen;
      else if (action.startsWith('axis-')) {
        const a = action.slice(5);
        c.flip = c.method === 'vector' && c.axis === a && !c.screen ? !c.flip : false;
        c.axis = a;
        c.method = 'vector';
        c.screen = false;
      } else if (action === 'normal' || action === 'vector') { c.method = action; c.screen = false; }
      else if (action === 'both' || action === 'hide') c[action] = !c[action];
      else return false;
      c.onSelection();
      return true;
    };
    c.click = e => {
      if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return true;
      const hit = pickAt(e);
      if (hit?.kind === 'curve') sel.toggle({ kind: 'curve', id: hit.id });
      else if (hit?.kind === 'face' && e.altKey) sel.toggle({ kind: 'face', body: hit.body, n: hit.n });
      else if (hit?.kind === 'face') sel.toggle({ kind: 'solid', body: hit.body });
      else return true;
      selectionChanged();
      return true;
    };
    c.finish = async () => {
      if (!c.out?.length) { setState('failed'); return toast($('proj-hint').textContent); }
      try {
        const { ids: made } = await backend.addCurves(c.out);
        endCmd('committed');
        record(`PROJECT ×${made.length} ${MODES[c.req.mode]}`, made[0], curveLabel(made[0]));
        await curvesChanged(made);
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => clearPreview();
    c.onSelection();
  }

  /**
   * Plasticity's Extend on a sheet's edge: the sheet grown past the selected open edge, following its
   * curvature (Natural) or straight on from its face (Linear); Tab cycles them, D types the distance.
   * The sheet keeps its body.
   */
  function startExtendSheet({ auto = false } = {}) {
    if (!backend.previewExtendSheet) return toast('EXTEND SHEET IS NOT IN THIS BUILD YET');
    const isSheetBody = id => !!current.find(b => b.id === id)?.sheet;
    const picked = () => { const es = sel.list('edge'); return es.length === 1 && isSheetBody(es[0].body) ? es[0] : null; };
    if (!picked()) return toast('SELECT ONE EDGE OF A SHEET');
    // Auto-invoked, it waits for a distance (typed, D, or Enter for the one shown) before previewing,
    // and goes when the selection stops being one sheet edge, as the auto fillet does.
    const c = cmd = { id: 'extend-sheet', auto, armed: !auto, edge: picked(), shape: 'natural', limit: null, sent: 0, shown: 0 };
    lastTool = 'extend-sheet';
    showTool('extend-sheet');
    $('es-limit').textContent = '—';
    $('es-unlimit').hidden = true;
    $('es-limit-how').hidden = true;
    $('es-d').disabled = false;
    setState('none');
    c.outside = false;
    c.request = () => ({ body: c.edge.body, edge: c.edge.n, distance: num('es-d'), natural: c.shape === 'natural', shape: c.shape, ...(c.limit != null && { limit: c.limit, outside: c.outside }) });
    c.setOutside = on => {
      c.outside = on;
      for (const b of $$('[data-eslimit]')) b.setAttribute('aria-pressed', String((b.dataset.eslimit === 'outside') === on));
      c.preview();
    };
    for (const b of $$('[data-eslimit]')) b.setAttribute('aria-pressed', String(b.dataset.eslimit === 'minimal'));
    // Limit: Ctrl/Shift-click another body and the sheet carries on until it meets it.
    c.setLimit = id => {
      c.limit = id;
      $('es-limit').textContent = id == null ? '—' : label(id);
      $('es-unlimit').hidden = id == null;
      $('es-limit-how').hidden = id == null;
      $('es-d').disabled = id != null;
      c.preview();
    };
    c.click = e => {
      if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return false;
      const hit = pickAt(e);
      if (hit?.body === undefined || hit.body === c.edge?.body) return false;
      c.setLimit(c.limit === hit.body ? null : hit.body);
      return true;
    };
    c.setShape = k => {
      c.shape = k;
      for (const b of $$('[data-esshape]')) b.setAttribute('aria-pressed', String(b.dataset.esshape === k));
      c.preview();
    };
    c.preview = () => (c.armed = true) && livePreview(c, () => backend.previewExtendSheet(c.request()), b => {
      const m = showPreviewBody(b, phantom.add.face, phantom.add.edge);
      m.renderOrder = 5;
      const how = c.limit != null ? `${c.outside ? 'THROUGH' : 'UP TO'} ${label(c.limit)}` : `${num('es-d')} MM`;
      $('es-hint').textContent = `${label(c.edge.body)} · ${c.limit != null ? how : `${how} PAST THE EDGE`}`;
      setHud(`EXTEND SHEET ${how} · ${c.shape.toUpperCase()}`);
    }, 'es-hint');
    c.onSelection = () => {
      drawOverlays();
      const e = picked();
      if (!e && c.auto && !c.armed) { endCmd(null); return defaultCommand(); }
      if (!e) {
        const missing = 'SELECT ONE EDGE OF A SHEET';
        $('es-hint').textContent = missing;
        clearPreview();
        return setHud(missing);
      }
      c.edge = e;
      setTarget(label(e.body));
      if (!c.armed) {
        $('es-hint').textContent = `${label(e.body)} · TYPE A DISTANCE (D) OR ENTER FOR ${num('es-d')} MM`;
        return setHud('EXTEND SHEET');
      }
      c.preview();
    };
    c.key = action => {
      if (action === 'shape') { const all = ['natural', 'linear', 'soft', 'reflective']; c.setShape(all[(all.indexOf(c.shape) + 1) % all.length]); return true; }
      if (action !== 'distance') return false;
      c.entry = { label: 'DISTANCE', text: '', apply: v => { if (v > 0) { $('es-d').value = v; c.preview(); } else toast('THE DISTANCE MUST BE ABOVE ZERO'); } };
      setHud('DISTANCE _');
      return true;
    };
    c.finish = async () => {
      if (!picked()) { setState('failed'); return toast($('es-hint').textContent); }
      try {
        const { id, scene: list } = await backend.commitExtendSheet(c.request());
        endCmd('committed');
        record(`EXTEND SHEET ${c.limit != null ? `UP TO ${label(c.limit)}` : `${num('es-d')} MM`} ${c.shape.toUpperCase()}`, id);
        await showScene(list);
        sel.replace({ kind: 'solid', body: id });
        selectionChanged({ quiet: true });
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => clearPreview();
    c.onSelection();
  }

  /**
   * Plasticity's Thicken: the selected sheet made solid, D typing how far it grows along its faces'
   * normals and B how far behind them. The sheet body becomes the solid.
   */
  function startThicken() {
    if (!backend.previewThicken) return toast('THICKEN IS NOT IN THIS BUILD YET');
    const sheets = () => sel.solids.filter(id => current.find(b => b.id === id)?.sheet);
    // Thicken Face: faces picked on one body become a solid of their own and the body stays.
    const faces = () => sel.list('face');
    const target = () => {
      const fs = faces();
      if (fs.length) return fs.every(f => f.body === fs[0].body) ? { body: fs[0].body, faces: fs.map(f => f.n).sort((x, y) => x - y) } : null;
      return sheets().length === 1 ? { body: sheets()[0], faces: [] } : null;
    };
    const wrong = () => faces().length ? 'PICK FACES ON ONE BODY' : sel.solids.length ? 'THICKEN ONE SHEET AT A TIME' : 'SELECT A SHEET OR FACES TO THICKEN';
    if (!target()) return toast(wrong());
    const c = cmd = { id: 'thicken', ...target(), sent: 0, shown: 0 };
    lastTool = 'thicken';
    showTool('thicken');
    setState('none');
    const describe = () => `THICKEN ${c.faces.length ? `${c.faces.length} FACE${c.faces.length > 1 ? 'S' : ''} ` : ''}${num('th-f')}${num('th-b') ? ` + ${num('th-b')} BACK` : ''} MM`;
    c.request = () => ({ body: c.body, faces: c.faces, front: num('th-f'), back: num('th-b') });
    c.preview = () => livePreview(c, () => backend.previewThicken(c.request()), b => {
      // Thicken Face's solid is a new body; the one its faces are on stays in view.
      showPreviewBody(c.faces.length ? { ...b, id: -1 } : b);
      $('th-hint').textContent = `${label(c.body)}${c.faces.length ? ` · ${c.faces.length} FACE${c.faces.length > 1 ? 'S' : ''}` : ''} · ${num('th-f') + num('th-b')} MM THICK`;
      setHud(describe());
    }, 'th-hint');
    c.onSelection = () => {
      drawOverlays();
      const t = target();
      if (!t) {
        const missing = faces().length ? 'PICK FACES ON ONE BODY' : 'SELECT ONE SHEET OR FACES';
        $('th-hint').textContent = missing;
        clearPreview();
        return setHud(missing);
      }
      Object.assign(c, t);
      setTarget(label(c.body));
      c.preview();
    };
    c.key = action => {
      const field = { front: ['th-f', 'FRONT'], back: ['th-b', 'BACK'] }[action];
      if (!field) return false;
      c.entry = { label: field[1], text: '', apply: v => { if (v >= 0) { $(field[0]).value = v; c.preview(); } else toast("THE THICKNESS CAN'T BE BELOW ZERO"); } };
      setHud(`${field[1]} _`);
      return true;
    };
    c.finish = async () => {
      if (!target()) { setState('failed'); return toast($('th-hint').textContent); }
      try {
        const { id, scene: list } = await backend.commitThicken(c.request());
        endCmd('committed');
        record(describe(), id);
        await showScene(list);
        sel.replace({ kind: 'solid', body: id });
        selectionChanged({ quiet: true });
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => clearPreview();
    c.onSelection();
  }

  /**
   * Plasticity's Pipe: a tube along each selected curve. R types the radius, T the wall thickness
   * (0 leaves it solid) and V the number of sides (0 for round). Each tube is a body of its own and
   * the curves stay.
   */
  function startPipe() {
    if (!backend.previewPipe) return toast('PIPE IS NOT IN THIS BUILD YET');
    const c = cmd = { id: 'pipe', curves: [], sent: 0, shown: 0 };
    lastTool = 'pipe';
    showTool('pipe');
    setState('none');
    const sides = () => Math.round(num('pipe-v'));
    const describe = () => `PIPE R${num('pipe-r')}${num('pipe-t') ? ` · WALL ${num('pipe-t')}` : ''}${sides() ? ` · ${sides()} SIDES` : ''}`;
    c.request = () => ({ curves: c.curves, radius: num('pipe-r'), thickness: num('pipe-t'), sides: sides() });
    c.preview = () => livePreview(c, () => backend.previewPipe(c.request()), b => {
      showPreviewBody(b);
      $('pipe-hint').textContent = `${c.curves.length} ${c.curves.length === 1 ? 'PIPE' : 'PIPES'} · ${num('pipe-t') ? 'HOLLOW' : 'SOLID'}`;
      setHud(describe());
    }, 'pipe-hint');
    c.onSelection = () => {
      drawOverlays();
      c.curves = sel.curves.filter(curveById);
      setTarget(c.curves.length ? `${c.curves.length} CURVES` : '—');
      if (!c.curves.length) {
        const missing = 'SELECT THE CURVES TO RUN PIPES ALONG';
        $('pipe-hint').textContent = missing;
        clearPreview();
        return setHud(missing);
      }
      c.preview();
    };
    c.key = action => {
      const field = { radius: ['pipe-r', 'RADIUS', v => v > 0, 'THE RADIUS MUST BE ABOVE ZERO'], thickness: ['pipe-t', 'THICKNESS', v => v >= 0, "THE THICKNESS CAN'T BE BELOW ZERO"], sides: ['pipe-v', 'SIDES', v => v === 0 || (v >= 3 && v <= 256), 'SIDES ARE 0 (ROUND) OR 3 TO 256'] }[action];
      if (!field) return false;
      c.entry = { label: field[1], text: '', apply: v => { if (field[2](v)) { $(field[0]).value = v; c.preview(); } else toast(field[3]); } };
      setHud(`${field[1]} _`);
      return true;
    };
    c.finish = async () => {
      if (!c.curves.length) { setState('failed'); return toast($('pipe-hint').textContent); }
      try {
        const { ids, scene: list } = await backend.commitPipe(c.request());
        endCmd('committed');
        record(describe(), ids[0]);
        await showScene(list);
        selectSolids(ids);
        selectionChanged({ quiet: true });
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => clearPreview();
    c.onSelection();
  }

  /**
   * Plasticity's Bridge Surface: a sheet from one selected edge to another, leaving each tangent to
   * its face. T types the tension (1 is a smooth cubic; more carries each side further before it
   * turns). The sheet is a body of its own.
   */
  function startBridgeSurface() {
    if (!backend.previewBridgeSurface) return toast('BRIDGE SURFACE IS NOT IN THIS BUILD YET');
    // Two edges bridge across a gap; two crossing sheets get a bridge where they cross (Width,
    // Shape, Trim walls, Sense), as Plasticity's Bridge Surface between intersecting surfaces.
    const c = cmd = { id: 'bridge-surface', edges: [], sheets: [], shape: 'g2', trim: 'both', sense: [false, false], sent: 0, shown: 0 };
    lastTool = 'bridge-surface';
    showTool('bridge-surface');
    setState('none');
    const side = e => ({ body: e.body, edge: e.n });
    // A adds a wall pair: sheets pair up in the order they are picked, each pair bridged alike.
    const crossing = () => c.edges.length !== 2 && c.sheets.length >= 2 && c.sheets.length % 2 === 0;
    const pairs = () => Array.from({ length: c.sheets.length / 2 }, (_, i) => [c.sheets[2 * i], c.sheets[2 * i + 1]]);
    const sheetRequest = ([a, b]) => ({ a, b, width: num('bs-w'), shape: c.shape, trim: c.trim, sense: c.sense });
    c.request = () => crossing()
      ? sheetRequest(pairs()[0])
      : { a: side(c.edges[0]), b: side(c.edges[1]), tension: num('bs-t') };
    const text = () => crossing()
      ? `BRIDGE SURFACE · WIDTH ${num('bs-w')} · ${c.shape.toUpperCase()} · TRIM ${c.trim.toUpperCase()}${c.sense.some(Boolean) ? ` · SENSE ${c.sense.map((s, i) => s ? i + 1 : '').filter(Boolean).join(' ')}` : ''}`
      : `BRIDGE SURFACE · TENSION ${num('bs-t')}`;
    const sync = () => {
      $('bs-sheets').hidden = !crossing();
      $('bs-t-row').hidden = crossing();
      for (const b of $$('[data-bsshape]')) b.setAttribute('aria-pressed', String(b.dataset.bsshape === c.shape));
      for (const b of $$('[data-bstrim]')) b.setAttribute('aria-pressed', String(b.dataset.bstrim === c.trim));
      $('bs-s1').setAttribute('aria-pressed', String(c.sense[0]));
      $('bs-s2').setAttribute('aria-pressed', String(c.sense[1]));
    };
    c.set = (key, v) => { c[key] = v; sync(); c.preview(); };
    c.flip = i => { c.sense = c.sense.map((s, k) => k === i ? !s : s); sync(); c.preview(); };
    c.preview = () => livePreview(c, async () => {
      if (!crossing()) { const b = await backend.previewBridgeSurface(c.request()); return b ? [b] : null; }
      const out = [];
      for (const pr of pairs()) out.push(await backend.previewSheetBridge(sheetRequest(pr)));
      return out.some(b => !b) ? null : out;
    }, list => {
      for (const b of list) showPreviewBody(b, phantom.add.face, phantom.add.edge).renderOrder = 5;
      $('bs-hint').textContent = crossing() ? (list.length > 1 ? `WHERE EACH PAIR CROSSES · ${list.length} PAIRS · A ADDS ANOTHER` : 'WHERE THE SHEETS CROSS · A ADDS A WALL PAIR') : `TANGENT TO BOTH FACES · TENSION ${num('bs-t')}`;
      setHud(text() + (list.length > 1 ? ` ×${list.length}` : ''));
    }, 'bs-hint');
    c.onSelection = () => {
      drawOverlays();
      c.edges = sel.list('edge');
      c.sheets = sel.bodies.filter(id => current.find(b => b.id === id)?.sheet);
      sync();
      if (new Set(c.sheets).size !== c.sheets.length) c.sheets = [...new Set(c.sheets)];
      if (crossing()) { c.adding = false; setTarget(pairs().map(p => p.map(label).join('×')).join(' · ')); return c.preview(); }
      if (c.sheets.length >= 2 && c.edges.length !== 2) {
        const missing = 'SELECT ONE MORE SHEET TO MAKE THE PAIR';
        $('bs-hint').textContent = missing;
        clearPreview();
        return setHud(missing);
      }
      setTarget(c.edges.length ? c.edges.map(e => label(e.body)).join(' · ') : '—');
      if (c.edges.length !== 2) {
        const missing = 'SELECT TWO EDGES OF SHEETS OR SOLIDS, OR TWO SHEETS THAT CROSS';
        $('bs-hint').textContent = missing;
        clearPreview();
        return setHud(missing);
      }
      c.preview();
    };
    c.key = action => {
      if (action === 'add-pair') {
        if (!crossing()) return toast('SELECT TWO CROSSING SHEETS FIRST'), true;
        c.adding = true;
        $('bs-hint').textContent = 'SHIFT-CLICK TWO MORE SHEETS THAT CROSS';
        setHud('BRIDGE SURFACE · ADD WALL PAIR');
        return true;
      }
      if (action !== 'tension') return false;
      c.entry = { label: 'TENSION', text: '', apply: v => { if (v > 0) { $('bs-t').value = v; c.preview(); } else toast('THE TENSION MUST BE ABOVE ZERO'); } };
      setHud('TENSION _');
      return true;
    };
    c.click = e => {
      const hit = pickAt(e);
      // Adding a wall pair: a plain click picks the next sheet.
      if (c.adding && hit && hit.kind !== 'edge' && current.find(b => b.id === hit.body)?.sheet) {
        if (!sel.bodies.includes(hit.body)) { sel.add({ kind: 'solid', body: hit.body }); selectionChanged(); }
        return true;
      }
      if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return true;
      if (hit?.kind !== 'edge') return true;
      sel.toggle({ kind: 'edge', body: hit.body, n: hit.n });
      selectionChanged();
      return true;
    };
    c.finish = async () => {
      if (c.edges.length !== 2 && !crossing()) { setState('failed'); return toast($('bs-hint').textContent); }
      try {
        const made = [];
        let list = null;
        // One undo step per pair, as each is its own bridge.
        for (const r of crossing() ? pairs().map(sheetRequest) : [c.request()]) {
          const res = crossing() ? await backend.commitSheetBridge(r) : await backend.commitBridgeSurface(r);
          made.push(res.id);
          list = res.scene;
          record(text(), res.id);
        }
        endCmd('committed');
        await showScene(list);
        sel.clear();
        for (const id of made) sel.add({ kind: 'solid', body: id });
        selectionChanged({ quiet: true });
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => clearPreview();
    c.onSelection();
  }

  /**
   * Plasticity's Patch: a sheet filling one closed loop of the selected curves and edges. A flat
   * loop gives its plane; any other is filled with a smooth sheet. T makes the sheet leave the
   * selected edges tangent to their faces. The sheet is a body of its own; the loop stays.
   */
  /**
   * Patch's pieces sorted into loops: curves and body edges whose ends meet, each group with
   * whether it closes (every end met by another, or one closed curve).
   */
  function patchLoops(curves, edges) {
    const pieces = [];
    for (const id of curves) {
      const c = curveById(id);
      if (!c) continue;
      const f = curveFrame(c), pts = curve2d(c);
      pieces.push({ curve: id, closed: isClosed(c), ends: isClosed(c) ? [] : [lift(f, pts[0]), lift(f, pts.at(-1))] });
    }
    for (const e of edges) {
      const line = bodyOf(e.body)?.edges?.[e.n];
      if (!line) continue;
      const a = new THREE.Vector3().fromArray(line, 0), b = new THREE.Vector3().fromArray(line, line.length - 3);
      pieces.push({ edge: e, closed: a.distanceTo(b) < 1e-4, ends: a.distanceTo(b) < 1e-4 ? [] : [a, b] });
    }
    return groupLoops(pieces).map(g => ({ curves: g.filter(p => p.curve !== undefined).map(p => p.curve), edges: g.filter(p => p.edge).map(p => p.edge), closed: closesUp(g) }));
  }
  /** A curve or edge of a loop as a polyline in model space, kept in `cache.sides` while picked. */
  async function loopSide(it, cache) {
    const key = it.kind === 'curve' ? `c:${it.id}` : `${it.body}:${it.n}`;
    cache.sides ??= new Map();
    if (!cache.sides.has(key)) {
      if (it.kind === 'curve') {
        const src = curveById(it.id), f = curveFrame(src), { points } = curveSamples(src, 200);
        cache.sides.set(key, points.map(p => lift(f, { x: p[0], y: p[1], z: p[2] ?? 0 }).toArray()));
      } else cache.sides.set(key, (await backend.edgeCurvature({ body: it.body, edge: it.n, n: 200 })).map(t => t.at));
    }
    return cache.sides.get(key);
  }

  function startPatch() {
    if (!backend.previewPatch) return toast('PATCH IS NOT IN THIS BUILD YET');
    // Continuity (manual: Planar, G0, G1, G2): Planar fills flat and refuses a loop that is not,
    // G0 meets the loop only, G1 leaves the faces tangent and G2 matches their curvature too.
    const c = cmd = { id: 'patch', tangent: false, cont: 'G0', individual: false, quad: false, method: 'fill', methodSet: false, target: null, curves: [], edges: [], sent: 0, shown: 0 };
    const LEVEL = { planar: 0, G0: 0, G1: 1, G2: 2 };
    lastTool = 'patch';
    showTool('patch');
    setState('none');
    const tolerance = () => Math.max(1e-4, num('patch-tol') || 0.001);
    const request = (curves, edges) => ({ curves, edges: edges.map(e => ({ body: e.body, edge: e.n, tangent: LEVEL[c.cont] > 0, continuity: LEVEL[c.cont] })), tolerance: tolerance() });
    // Individual: one request per closed loop the pieces make; otherwise all of them as one loop.
    c.requests = () => {
      // Trim to hole / Trim to sheet: the target sheet cut by the base sheet's edges.
      if (c.method !== 'fill') {
        if (c.target === null) throw new Error('select the target sheet too, in body mode');
        if (c.curves.length) throw new Error('the trim methods take edges of the base sheet only');
        return [{ ...request([], c.edges), target: c.target, method: c.method }];
      }
      const groups = patchLoops(c.curves, c.edges);
      if (!c.individual) {
        if (groups.length > 1 && groups.every(g => g.closed)) throw new Error(`those make ${groups.length} loops; press I for a sheet in each`);
        return [request(c.curves, c.edges)];
      }
      if (groups.some(g => !g.closed)) throw new Error('some of the selection does not close into a loop');
      return groups.map(g => request(g.curves, g.edges));
    };
    // Quad-sided: the loop becomes a four-sided B-spline sheet, fitted as Square does (quadSides).
    c.quadFit = async () => {
      const sides = await Promise.all([...c.curves.map(id => ({ kind: 'curve', id })), ...c.edges].map(it => loopSide(it, c)));
      const size = Math.max(...sides.flat().map(p => Math.hypot(...p.map((x, k) => x - sides[0][0][k])))) || 1;
      return square(quadSides(sides, Math.max(0.01, 1e-3 * size)), { degree: 3, continuity: 'G0' });
    };
    c.preview = () => livePreview(c, async () => {
      if (c.quad && c.method === 'fill') {
        const fit = await c.quadFit();
        if (cmd !== c) return null;
        c.data = splineSheetData(fit);
        c.quadText = `QUAD-SIDED · ${fit.spans.join(' × ')} SPANS · SIDES WITHIN ${fit.gap < 1e-4 ? '< 0.0001' : fit.gap.toFixed(4)} MM`;
        const b = await backend.previewSplineSheet({ data: c.data });
        return b ? [b] : null;
      }
      c.data = null;
      const out = [];
      for (const r of c.requests()) out.push(await backend.previewPatch(r));
      return out.some(b => !b) ? null : out;
    }, list => {
      for (const b of list) showPreviewBody(b, phantom.add.face, phantom.add.edge).renderOrder = 5;
      const smooth = LEVEL[c.cont] && c.edges.length ? `SMOOTH SHEET, ${c.cont === 'G2' ? 'MATCHING THE CURVATURE OF' : 'TANGENT TO'} THE FACES` : null;
      // Planar: both builds fill a flat loop with its own plane, so a curved sheet means the loop is not flat.
      if (c.cont === 'planar' && list.some(b => !b.facePlanes?.[0])) {
        c.data = null;
        c.notFlat = true;
        clearPreview();
        $('patch-hint').textContent = 'THAT LOOP IS NOT FLAT; PRESS T FOR G0';
        setHud('PATCH · PLANAR');
        return setState('failed');
      }
      c.notFlat = false;
      if (c.method !== 'fill') {
        $('patch-hint').textContent = c.method === 'hole' ? 'THE TARGET SHEET TRIMMED TO THE HOLE' : 'THE TARGET SHEET TRIMMED WHERE THE BASE SHEET ENDS';
        return setHud(`PATCH · TRIM TO ${c.method.toUpperCase()}`);
      }
      $('patch-hint').textContent = c.quad ? c.quadText : (smooth ?? (list.length > 1 ? `A ${c.cont === 'planar' ? 'FLAT ' : ''}SHEET THROUGH EACH LOOP` : `${c.cont === 'planar' ? 'A FLAT' : ''} SHEET THROUGH THE LOOP`.trim())) + (list.length > 1 ? ` · ${list.length} SHEETS` : '');
      setHud(c.quad ? 'PATCH · QUAD-SIDED' : list.length > 1 ? `PATCH ×${list.length}` : 'PATCH');
    }, 'patch-hint');
    c.onSelection = () => {
      drawOverlays();
      c.curves = sel.curves.filter(curveById);
      c.edges = sel.list('edge');
      // The target: a sheet body selected along with the edges, other than the one they are on.
      const bases = new Set(c.edges.map(e => e.body));
      c.target = sel.solids.find(id => !bases.has(id) && bodyOf(id)?.sheet) ?? null;
      if (c.target !== null && !c.methodSet && c.method === 'fill') c.method = 'hole';
      $('patch-target').textContent = c.target === null ? '—' : `SHEET ${c.target}`;
      for (const b of $$('[data-pmethod]')) b.setAttribute('aria-pressed', String(b.dataset.pmethod === c.method));
      $('patch-curves').textContent = c.curves.length;
      $('patch-edges').textContent = c.edges.length;
      for (const b of $$('[data-pcont]')) b.setAttribute('aria-pressed', String(b.dataset.pcont === c.cont));
      $('patch-tangent').setAttribute('aria-pressed', String(LEVEL[c.cont] > 0));
      $('patch-tangent').disabled = !c.edges.length;
      $('patch-tangent').lastChild.textContent = c.cont === 'G2' ? 'CURVATURE TO FACES' : 'TANGENT TO FACES';
      $('patch-individual').setAttribute('aria-pressed', String(c.individual));
      $('patch-individual').disabled = c.quad;
      $('patch-quad').setAttribute('aria-pressed', String(c.quad));
      $('patch-quad').disabled = !backend.previewSplineSheet;
      setTarget(c.curves.length + c.edges.length ? `${c.curves.length + c.edges.length} PIECES` : '—');
      if (!c.curves.length && !c.edges.length) {
        const missing = 'SELECT CURVES OR EDGES THAT MAKE ONE CLOSED LOOP';
        $('patch-hint').textContent = missing;
        clearPreview();
        return setHud(missing);
      }
      c.preview();
    };
    c.setCont = g => { c.cont = g; c.tangent = LEVEL[g] > 0; c.onSelection(); };
    c.setMethod = m => { c.method = m; c.methodSet = true; c.onSelection(); };
    c.key = action => {
      // T cycles the continuity, as the manual lists it: Planar, G0, G1, G2.
      if (action === 'tangent') c.setCont({ planar: 'G0', G0: 'G1', G1: 'G2', G2: 'planar' }[c.cont]);
      else if (action === 'individual') c.individual = !c.individual;
      else if (action === 'quad') {
        if (!backend.previewSplineSheet) return toast('QUAD-SIDED IS NOT IN THIS BUILD YET'), true;
        c.quad = !c.quad;
      } else return false;
      c.onSelection();
      return true;
    };
    c.click = e => {
      if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return true;
      const hit = pickAt(e);
      if (hit?.kind === 'curve') sel.toggle({ kind: 'curve', id: hit.id });
      else if (hit?.kind === 'edge') sel.toggle({ kind: 'edge', body: hit.body, n: hit.n });
      else return true;
      selectionChanged();
      return true;
    };
    c.finish = async () => {
      if (!c.curves.length && !c.edges.length) { setState('failed'); return toast($('patch-hint').textContent); }
      if (c.notFlat) { setState('failed'); return toast($('patch-hint').textContent); }
      let list = null;
      const made = [];
      if (c.quad && c.method === 'fill') {
        if (!c.data) { setState('failed'); return toast($('patch-hint').textContent); }
        try {
          const { ids, scene } = await backend.commitSplineSheet({ data: c.data });
          made.push(ids[0]);
          list = scene;
          record('PATCH QUAD-SIDED', ids[0], c.quadText);
          endCmd('committed');
        } catch (e) { setState('failed'); return toast(say(e)); }
        await showScene(list);
        sel.clear();
        sel.add({ kind: 'solid', body: made[0] });
        return selectionChanged({ quiet: true });
      }
      try {
        // One undo step per sheet, as Plasticity's Individual makes separate patches.
        for (const r of c.requests()) {
          const { id, scene } = await backend.commitPatch(r);
          made.push(id);
          list = scene;
          record(c.method !== 'fill' ? `PATCH TRIM TO ${c.method.toUpperCase()}` : `PATCH${c.cont === 'planar' ? ' PLANAR' : LEVEL[c.cont] && c.edges.length ? ` ${c.cont}` : ''}`, id);
        }
        endCmd('committed');
      } catch (e) { setState('failed'); toast(say(e)); }
      if (!list) return;
      await showScene(list);
      sel.clear();
      for (const id of made) sel.add({ kind: 'solid', body: id });
      selectionChanged({ quiet: true });
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => clearPreview();
    c.onSelection();
  }

  /** Hole: click a flat face; a round cut of the panel's diameter goes in to its depth, or through. */
  function startHole({ at = null } = {}) {
    if (!backend.preview) return toast('HOLE IS NOT IN THIS BUILD YET');
    const c = cmd = { id: 'hole', at: null, through: false, sent: 0, shown: 0 };
    lastTool = 'hole';
    showTool('hole');
    setState('none');
    $('hole-through').setAttribute('aria-pressed', 'false');
    $('hole-depth-row').hidden = false;
    $('hole-hint').textContent = 'CLICK A FLAT FACE';
    c.request = () => {
      if (!c.at) return null;
      // Through all: deeper than the body is across.
      const box = new THREE.Box3().expandByObject(bodyMesh(c.at.target));
      const depth = c.through ? box.getSize(new THREE.Vector3()).length() * 1.5 : num('hole-depth');
      return { target: c.at.target, origin: c.at.origin.toArray(), normal: c.at.normal.toArray(), xAxis: frameFor(c.at.normal).toArray(), profile: { kind: 'circle', radius: num('hole-d') / 2 }, distance: -depth, op: 'difference' };
    };
    c.preview = () => {
      const req = c.request();
      if (!req) return;
      livePreview(c, async () => {
        const p = await backend.preview(req);
        if (p && p.outcome !== 'cut') throw new Error('the hole does not go into the body');
        return p;
      }, p => { if (p.result) showPreviewBody(p.result); if (p.tool) { const m = meshOf(p.tool, phantom.cut.face, phantom.cut.edge); m.renderOrder = 5; previewGroup.add(m); } setHud(`HOLE ⌀${num('hole-d')} ${c.through ? 'THROUGH' : `× ${num('hole-depth')}`}`); }, 'hole-hint');
    };
    c.place = p => {
      if (!p.target) { toast('CLICK A FLAT FACE OF A SOLID'); return; }
      c.at = p;
      setTarget(label(p.target));
      $('hole-hint').textContent = `ON ${label(p.target)} · ⏎ TO DRILL`;
      c.preview();
    };
    c.click = e => {
      const p = placeAt(e);
      if (p?.curved) { toast('HOLES GO INTO FLAT FACES'); return true; }
      if (p) c.place(p);
      return true;
    };
    c.key = action => {
      if (action !== 'through') return false;
      c.through = !c.through;
      $('hole-through').setAttribute('aria-pressed', c.through);
      $('hole-depth-row').hidden = c.through;
      c.preview();
      return true;
    };
    c.finish = async () => {
      const req = c.request();
      if (!req) return endCmd('cancelled');
      try {
        const { id, scene: list } = await backend.commit(req);
        endCmd('committed');
        record(`HOLE ⌀${num('hole-d')} ${c.through ? 'THROUGH' : `× ${num('hole-depth')}`}`, id);
        await showScene(list);
        sel.replace({ kind: 'solid', body: id });
        selectionChanged({ quiet: true });
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => clearPreview();
    setHud('CLICK A FLAT FACE');
    if (at) c.place(at);
  }

  /**
   * Plasticity's Tangent Circle: click two curves, then move the cursor to size a circle touching both
   * (F freezes it while the cursor moves on; Tab types its radius); click to place it. Clicking a third
   * curve instead makes the circle touch all three, the one nearest the cursor.
   */
  function startTangentCircle() {
    if (!backend.addCurves) return toast('DRAWING IS NOT IN THIS BUILD YET');
    const c = cmd = { id: 'tangent-circle', picks: [], radius: null, frozen: false, out: null, at: null };
    lastTool = 'tangent-circle';
    showTool('tangent-circle');
    setState('none');
    setHud('CLICK THE FIRST CURVE');
    const planeHit = e => {
      const f = curveFrame(c.picks[0]);
      ray(e);
      const p = raycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(f.n, f.o), new THREE.Vector3());
      if (!p) return null;
      const d = p.sub(f.o);
      return [d.dot(f.x), d.dot(f.y)];
    };
    const update = () => {
      clearPreview();
      if (!c.at) return;
      try {
        c.out = c.picks[2] ? tangentCircle3(c.picks[0], c.picks[1], c.picks[2], c.at) : tangentCircle(c.picks[0], c.picks[1], c.at, c.radius);
        showCurvePreview([c.out]);
        setHud(`TANGENT CIRCLE R ${c.out.radius.toFixed(2)}${c.picks[2] ? ' · THREE CURVES' : ''}${c.frozen ? ' · FROZEN' : ''}`);
        setState('updated');
      } catch (err) { c.out = null; setHud(say(err)); setState('failed'); }
    };
    c.move = e => {
      if (c.picks.length < 2 || c.frozen) return;
      c.at = planeHit(e);
      update();
    };
    c.click = async e => {
      if (c.picks.length < 2) {
        const hit = pickAt(e);
        const src = (hit?.kind === 'curve' || hit?.kind === 'region') && curveById(hit.id);
        if (!src) { toast('CLICK A CURVE'); return true; }
        if (c.picks.includes(src)) return true;
        c.picks.push(src);
        setTarget(c.picks.map(k => curveLabel(k.id)).join(' · '));
        setHud(c.picks.length === 1 ? 'CLICK THE SECOND CURVE' : 'MOVE TO SIZE THE CIRCLE, THEN CLICK; OR CLICK A THIRD CURVE');
        return true;
      }
      // A third curve: the circle touches all three, the one nearest the cursor.
      if (c.picks.length === 2) {
        const hit = pickAt(e), src = (hit?.kind === 'curve' || hit?.kind === 'region') && curveById(hit.id);
        if (src && !c.picks.includes(src)) {
          c.picks.push(src);
          c.radius = null;
          setTarget(c.picks.map(k => curveLabel(k.id)).join(' · '));
          c.at = planeHit(e) ?? c.at;
          update();
          return true;
        }
      }
      await c.finish();
      return true;
    };
    c.key = action => {
      if (action === 'freeze') { c.frozen = !c.frozen; update(); return true; }
      if (action === 'typed') {
        if (c.picks[2]) { toast('THREE CURVES SET THE RADIUS'); return true; }
        c.entry = { label: 'RADIUS', text: '', apply: v => { c.radius = Math.abs(v); update(); } };
        setHud('RADIUS _');
        return true;
      }
      return false;
    };
    c.finish = async () => {
      if (!c.out) return endCmd('cancelled');
      try {
        const { ids: made } = await backend.addCurves([c.out]);
        endCmd('committed');
        record(`TANGENT CIRCLE R ${c.out.radius.toFixed(2)}`, made[0], curveLabel(made[0]));
        await curvesChanged(made);
      } catch (err) { setState('failed'); toast(say(err)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => clearPreview();
  }

  /** Plasticity's Split Curve At Point: click a curve where it should become two. */
  function startSplit() {
    if (!backend.replaceCurves) return toast('SPLIT IS NOT IN THIS BUILD YET');
    const c = cmd = { id: 'split', count: 0 };
    lastTool = 'split';
    showTool('split');
    setState('none');
    setHud('CLICK A CURVE WHERE TO SPLIT IT');
    c.click = async e => {
      const hit = pickAt(e);
      const src = (hit?.kind === 'curve' || hit?.kind === 'region') && curveById(hit.id);
      if (!src || !hit.point) return true;
      const f = curveFrame(src), d = hit.point.clone().sub(f.o);
      try {
        const { ids: made } = await backend.replaceCurves([src.id], splitCurve(src, [d.dot(f.x), d.dot(f.y)]));
        c.count++;
        record(`SPLIT ${curveLabel(src.id)}`, made[0], made.map(curveLabel).join(' '));
        await loadCurves();
        setHud(`${c.count} SPLIT · CLICK ANOTHER, OR ⏎`);
        setState('committed');
      } catch (err) { setState('failed'); toast(say(err)); }
      return true;
    };
    c.finish = () => endCmd(c.count ? 'committed' : 'cancelled');
    c.abort = () => endCmd(c.count ? 'committed' : 'cancelled');
  }

  /** Plasticity's Measure Distance: click two points (they snap); the distance and its x, y, z show. */
  function startMeasureDistance() {
    const c = cmd = { id: 'measure-distance', a: null };
    lastTool = 'measure-distance';
    showTool('measure-distance');
    setState('none');
    setHud('CLICK THE FIRST POINT');
    const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: COLORS.accent, depthTest: false }));
    line.renderOrder = 12;
    scene.add(line);
    const pointOf = e => {
      const p = placeAt(e);
      if (p && !p.curved) return p.origin.clone();
      ray(e);
      return raycaster.ray.intersectPlane(planeOf(), new THREE.Vector3());
    };
    const show = (a, b) => {
      line.geometry.setFromPoints([a, b]);
      const [dx, dy, dz] = toUser(b.clone().sub(a).toArray());
      setHud(`DISTANCE ${a.distanceTo(b).toFixed(3)} MM · ΔX ${dx.toFixed(3)} ΔY ${dy.toFixed(3)} ΔZ ${dz.toFixed(3)}`);
    };
    c.move = e => { if (!c.a) return; const b = pointOf(e); if (b) show(c.a, b); };
    c.click = e => {
      const p = pointOf(e);
      if (!p) return true;
      if (!c.a || c.done) { c.a = p; c.done = false; line.geometry.setFromPoints([p, p]); setHud('CLICK THE SECOND POINT'); return true; }
      show(c.a, p);
      c.done = true;
      setState('updated');
      return true;
    };
    c.finish = () => endCmd(null);
    c.abort = () => endCmd(null);
    c.cleanup = () => { line.geometry.dispose(); line.removeFromParent(); };
  }

  /**
   * Plasticity's Export OBJ (and STL), with its export-mesh options: the tolerance from the true
   * surface, the angle between neighbouring normals, and a max width that splits longer edges (0 is
   * off). Exports the selected solids, or all of them.
   */
  /** The mass of the selected solids (or all), from their materials' densities; bodies without one don't count. */
  function renderMass() {
    const ids = sel.bodies.length ? sel.bodies : current.map(b => b.id);
    const weighed = ids.filter(id => materials.has(materialOf.get(id)));
    // With nothing selected, shown instances weigh as their masters do, at their scale.
    const placed = sel.bodies.length ? [] : placedSolids().filter(({ n }) => materials.has(materialOf.get(n.master)));
    const grams = weighed.reduce((g, id) => g + massOf(bodyOf(id)?.volume ?? 0, materials.get(materialOf.get(id)).density), 0)
      + placed.reduce((g, { n, b }) => g + massOf(b.volume * n.scale ** 3, materials.get(materialOf.get(n.master)).density), 0);
    $('mass').textContent = weighed.length || placed.length ? formatMass(grams) : '—';
  }
  /** Bodies that use the material changed: their faces take the new values. */
  function materialsChanged() {
    for (const m of bodies.children) m.material = faceMatFor(m.userData.id);
    paintCurves();
    drawInstances();
    applyView();
    renderMass();
  }

  /**
   * Plasticity's Set Material (M): a material for the selected solids and sheets (a group's bodies
   * when the group is picked in the outliner). When they already share one, it is that material that
   * changes, for every body using it; Fork gives them a copy of their own, Remove takes it off.
   * Selected curves take the material too (its colour draws their line).
   */
  function startMaterial() {
    const ids = [...sel.bodies.filter(id => org.picks(id)), ...sel.curves.filter(curveById).map(curveKey)];
    if (!ids.length) return toast('SELECT SOLIDS, SHEETS OR CURVES');
    const before = { materials: new Map([...materials].map(([k, v]) => [k, { ...v }])), materialOf: new Map(materialOf), next: nextMaterial };
    const shared = new Set(ids.map(id => materialOf.get(id)));
    let mat = shared.size === 1 && materials.get([...shared][0]);
    if (!mat) {
      mat = newMaterial(nextMaterial++, materials.get(materialOf.get(ids[0])) ? { ...materials.get(materialOf.get(ids[0])), id: undefined, name: undefined } : {});
      mat.id ??= nextMaterial - 1;
      mat.name ??= `MATERIAL ${mat.id}`;
      materials.set(mat.id, mat);
      for (const id of ids) materialOf.set(id, mat.id);
    }
    const c = cmd = { id: 'material', ids, mat };
    for (const b of $$('[data-matlib]')) b.setAttribute('aria-pressed', 'false');
    lastTool = 'material';
    showTool('material');
    setState('updated');
    setHud('SET MATERIAL · ⏎ TO KEEP');
    const sync = () => {
      const users = [...materialOf.values()].filter(m => m === c.mat.id).length;
      $('mat-hint').textContent = `${c.mat.name} · USED BY ${users}`;
      for (const input of $$('[data-mat]')) if (input !== document.activeElement) input.value = c.mat[input.dataset.mat];
      const g = ids.reduce((sum, id) => sum + massOf(bodyOf(id)?.volume ?? 0, c.mat.density), 0);
      $('mat-mass').textContent = formatMass(g);
      materialsChanged();
    };
    c.edit = (key, value) => {
      const next = { ...c.mat, [key]: isColorKey(key) ? value : parseFloat(value) };
      if (checkMaterial(next).length) return false;
      Object.assign(c.mat, next);
      sync();
      return true;
    };
    // A library material: these bodies get it as a material of their own, named after it.
    c.pick = i => {
      const preset = MATERIAL_LIBRARY[i];
      if (!preset) return;
      if ([...materialOf].some(([k, m]) => m === c.mat.id && !ids.includes(k))) c.fork();
      Object.assign(c.mat, newMaterial(c.mat.id, { ...preset }));
      for (const b of $$('[data-matlib]')) b.setAttribute('aria-pressed', String(b.dataset.matlib === String(i)));
      sync();
    };
    c.fork = () => {
      const copy = newMaterial(nextMaterial++, { ...c.mat });
      copy.id = nextMaterial - 1; copy.name = `MATERIAL ${copy.id}`;
      materials.set(copy.id, copy);
      for (const id of ids) materialOf.set(id, copy.id);
      c.mat = copy;
      sync();
    };
    c.remove = () => {
      for (const id of ids) materialOf.delete(id);
      for (const k of [...materials.keys()]) if (![...materialOf.values()].includes(k)) materials.delete(k);
      materialsChanged();
      endCmd('committed');
      toast(`MATERIAL REMOVED FROM ${ids.length}`);
    };
    c.finish = async () => {
      for (const k of [...materials.keys()]) if (![...materialOf.values()].includes(k)) materials.delete(k);
      endCmd('committed');
      toast(`${c.mat.name} · ${$('mat-mass').textContent}`);
    };
    c.abort = () => {
      materials.clear(); for (const [k, v] of before.materials) materials.set(k, v);
      materialOf.clear(); for (const [k, v] of before.materialOf) materialOf.set(k, v);
      nextMaterial = before.next;
      materialsChanged();
      endCmd('cancelled');
    };
    sync();
  }
  function removeMaterial() {
    const ids = [...sel.bodies, ...sel.curves.map(curveKey)].filter(id => materialOf.has(id));
    if (!ids.length) return toast('NO MATERIAL ON THE SELECTION');
    for (const id of ids) materialOf.delete(id);
    for (const k of [...materials.keys()]) if (![...materialOf.values()].includes(k)) materials.delete(k);
    materialsChanged();
  }

  function startExportMesh() {
    if (!backend.meshBodies) return toast('MESH EXPORT IS NOT IN THIS BUILD YET');
    const ids = (sel.bodies.length ? sel.bodies : current.map(b => b.id)).filter(id => org.shows(id));
    // With nothing selected, the shown instances of solids go too, each as its master's mesh where it stands.
    const placed = sel.bodies.length ? [] : instances.filter(n => !n.curve && !n.hidden && current.some(b => b.id === n.master));
    if (!ids.length && !placed.length) return toast('NOTHING TO EXPORT');
    const c = cmd = { id: 'export-mesh', format: 'obj', up: 'z', topology: 'tris', convex: false };
    lastTool = 'export-mesh';
    showTool('export-mesh');
    setState('none');
    $('mx-hint').textContent = [ids.length && `${ids.length} SOLID${ids.length > 1 ? 'S' : ''}`, placed.length && `${placed.length} INSTANCE${placed.length > 1 ? 'S' : ''}`].filter(Boolean).join(' · ');
    setHud('EXPORT MESH · ⏎ TO SAVE');
    const sync = () => {
      for (const b of $$('[data-mxf]')) b.setAttribute('aria-pressed', b.dataset.mxf === c.format);
      for (const b of $$('[data-mxup]')) b.setAttribute('aria-pressed', b.dataset.mxup === c.up);
      for (const b of $$('[data-mxtopo]')) b.setAttribute('aria-pressed', b.dataset.mxtopo === c.topology);
      $('mx-convex').setAttribute('aria-pressed', String(c.convex));
      // Scale, Up Axis and Topology are the OBJ options, as in Plasticity.
      for (const id of ['mx-obj-scale', 'mx-up-label', 'mx-up', 'mx-topo-label', 'mx-topo']) $(id).hidden = c.format !== 'obj';
      $('mx-convex-row').hidden = c.format !== 'obj' || c.topology !== 'ngons';
    };
    for (const b of $$('[data-mxup]')) b.onclick = () => { c.up = b.dataset.mxup; sync(); };
    for (const b of $$('[data-mxtopo]')) b.onclick = () => { c.topology = b.dataset.mxtopo; sync(); };
    $('mx-convex').onclick = () => { c.convex = !c.convex; sync(); };
    // Density (Plasticity's one setting that moves the others): 0 is 0.5 mm and 30°, 1 is 0.0005 mm and 3°.
    $('mx-density').oninput = () => {
      const d = Math.min(1, Math.max(0, +$('mx-density').value || 0));
      $('mx-tol').value = +(0.5 * 1000 ** -d).toPrecision(2);
      $('mx-angle').value = +(30 * 10 ** -d).toFixed(1);
    };
    c.key = action => { if (['obj', 'stl', 'glb', '3mf'].includes(action)) { c.format = action; sync(); return true; } return false; };
    c.finish = async () => {
      const tolerance = num('mx-tol'), angle = num('mx-angle') * DEG, maxWidth = num('mx-width'), minWidth = num('mx-min');
      const small = num('mx-small');
      const sized = (positions, indices) => {
        const m = mergeShortEdges(positions, indices, minWidth), l = limitEdges(m.positions, m.indices, maxWidth);
        const r = removeSmallParts(l, small);
        return c.format === 'obj' && c.topology !== 'tris' ? polygonize(r, c.topology, { convexOnly: c.convex }) : r;
      };
      try {
        const masters = placed.map(n => n.master).filter((id, i, all) => all.indexOf(id) === i);
        const made = await backend.meshBodies([...new Set([...ids, ...masters])], { tolerance, angle });
        // Each body's material, for the formats that carry one (glTF and 3MF).
        const look = id => { const m = materials.get(materialOf.get(id)); return m ? { color: m.color, roughness: m.roughness, metalness: m.metalness, opacity: m.opacity } : {}; };
        const sheet = id => !!current.find(b => b.id === id)?.sheet;
        const meshes = made.filter(m => ids.includes(m.id)).map(m => ({ name: label(m.id), ...look(m.id), sheet: sheet(m.id), ...sized(m.positions, m.indices) }));
        for (const n of placed) {
          const m = made.find(x => x.id === n.master), at = matrixOf(n), v = new THREE.Vector3(), pos = [];
          for (let i = 0; i < m.positions.length; i += 3) pos.push(...v.fromArray(m.positions, i).applyMatrix4(at).toArray());
          // A mirrored instance turns its triangles inside out; wind them back.
          const ix = at.determinant() < 0 ? m.indices.map((_, i) => m.indices[i - (i % 3) + [0, 2, 1][i % 3]]) : m.indices;
          meshes.push({ name: instanceLabel(n.id), ...look(n.master), sheet: sheet(n.master), ...sized(pos, ix) });
        }
        const triangles = meshes.reduce((n, m) => n + m.indices.length / 3, 0), polygons = meshes.reduce((n, m) => n + (m.polygons?.length ?? m.indices.length / 3), 0);
        const name = `witness3d-${ids.length === 1 ? label(ids[0]).toLowerCase() : 'model'}.${c.format}`;
        const write = { obj: toObj, stl: toStl, glb: toGlb, '3mf': to3mf }[c.format];
        const msg = await backend.saveExport(name, c.format === 'obj' ? toObj(meshes, undefined, { scale: num('mx-scale') || 1, up: c.up }) : write(meshes));
        endCmd(msg ? 'committed' : 'cancelled');
        if (msg) toast(`${msg} · ${c.format === 'obj' && c.topology !== 'tris' ? `${polygons} POLYGONS` : `${triangles} TRIANGLES`}`);
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    sync();
  }

  /**
   * Plasticity's SVG export (and DXF): a 2D drawing of the selected solids and curves, or all of
   * them, seen as the camera sees them, at 1:1 in mm. Hidden lines come dashed (H leaves them out);
   * curves are drawn flat in the view on a layer of their own (C leaves them out).
   */
  function startExportDrawing() {
    if (!backend.hiddenLines) return toast('DRAWING EXPORT IS NOT IN THIS BUILD YET');
    const ids = (sel.bodies.length ? sel.bodies : current.map(b => b.id)).filter(id => org.shows(id));
    const curves = (sel.bodies.length || sel.curves.length ? sel.curves : curveList.map(c => c.id)).map(curveById).filter(Boolean);
    // With nothing selected, shown solid instances are drawn too, as their masters where they stand.
    const placed = sel.bodies.length || sel.curves.length ? [] : placedSolids().map(({ n }) => ({ body: n.master, motion: motionOf(n), mirror: n.mirror ?? null }));
    if (!ids.length && !curves.length && !placed.length) return toast('NOTHING TO EXPORT');
    const c = cmd = { id: 'export-drawing', format: 'svg', hidden: true, curves: true };
    lastTool = 'export-drawing';
    showTool('export-drawing');
    setState('none');
    $('dr-hint').textContent = [ids.length && `${ids.length} SOLID${ids.length > 1 ? 'S' : ''}`, placed.length && `${placed.length} INSTANCE${placed.length > 1 ? 'S' : ''}`, curves.length && `${curves.length} CURVE${curves.length > 1 ? 'S' : ''}`].filter(Boolean).join(' · ');
    setHud('EXPORT DRAWING · ⏎ TO SAVE');
    const sync = () => {
      for (const b of $$('[data-drf]')) b.setAttribute('aria-pressed', b.dataset.drf === c.format);
      $('dr-hidden').setAttribute('aria-pressed', c.hidden);
      $('dr-curves').setAttribute('aria-pressed', c.curves);
    };
    c.key = action => {
      if (action === 'svg' || action === 'dxf') c.format = action;
      else if (action === 'hidden') c.hidden = !c.hidden;
      else if (action === 'curves') c.curves = !c.curves;
      else return false;
      sync();
      return true;
    };
    c.finish = async () => {
      // The camera's view: toward the viewer, its right as the drawing's x, about what it looks at.
      const toward = camera.getWorldDirection(new THREE.Vector3()).negate();
      const x = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const view = { origin: controls.target.toArray(), toward: toward.toArray(), x: x.toArray() };
      try {
        const lines = ids.length || placed.length ? await backend.hiddenLines({ bodies: ids, placed, ...view, deflection: num('dr-tol') }) : [];
        if (c.curves) for (const cv of curves) {
          const f = curveFrame(cv), pts = curve2d(cv).map(p => lift(f, p));
          if (isClosed(cv)) pts.push(pts[0]);
          lines.push({ curve: true, points: flatten(pts, view) });
        }
        const name = `witness3d-${ids.length === 1 && !curves.length ? label(ids[0]).toLowerCase() : 'drawing'}.${c.format}`;
        const text = c.format === 'svg' ? toSvg(lines, { hidden: c.hidden }) : toDxf(lines, { hidden: c.hidden });
        const msg = await backend.saveExport(name, text);
        endCmd(msg ? 'committed' : 'cancelled');
        if (msg) toast(`${msg} · ${lines.filter(l => c.hidden || !l.hidden).length} LINES`);
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    sync();
  }

  /** Plasticity's Measure Continuity: click near where two curves meet; G0, G1 or G2 with the numbers. */
  function startMeasureContinuity() {
    const c = cmd = { id: 'measure-continuity', first: null };
    lastTool = 'measure-continuity';
    showTool('measure-continuity');
    setState('none');
    setHud('CLICK THE FIRST CURVE NEAR ITS END');
    const endPick = e => {
      const hit = pickAt(e);
      const src = (hit?.kind === 'curve' || hit?.kind === 'region') && curveById(hit.id);
      if (!src || !hit.point) return null;
      const f = curveFrame(src), p = curve2d(src);
      const s = lift(f, p[0]), t = lift(f, p[p.length - 1]);
      return { src, end: hit.point.distanceTo(s) <= hit.point.distanceTo(t) ? 0 : 1 };
    };
    c.click = e => {
      const pick = endPick(e);
      if (!pick) { toast('CLICK A CURVE NEAR ONE OF ITS ENDS'); return true; }
      if (!c.first || c.done) { c.first = pick; c.done = false; setHud('CLICK THE SECOND CURVE NEAR ITS END'); return true; }
      try {
        const r = continuity(c.first.src, c.first.end, pick.src, pick.end);
        setHud(`${r.continuity} · GAP ${r.gap.toFixed(4)} MM · ANGLE ${r.angle.toFixed(3)}° · K ${r.ka.toFixed(4)} / ${r.kb.toFixed(4)}`);
        setState('updated');
      } catch (err) { setHud(say(err)); setState('failed'); }
      c.done = true;
      return true;
    };
    c.finish = () => endCmd(null);
    c.abort = () => endCmd(null);
  }

  /** Plasticity's Measure Radius: click a circle or arc, or a round edge of a solid. */
  function startMeasureRadius() {
    const c = cmd = { id: 'measure-radius' };
    lastTool = 'measure-radius';
    showTool('measure-radius');
    setState('none');
    setHud('CLICK A ROUND EDGE OR CURVE');
    c.click = e => {
      const hit = pickAt(e);
      let r = null;
      if (hit?.kind === 'curve' || hit?.kind === 'region') {
        const k = curveById(hit.id);
        if (k?.kind === 'circle') r = k.radius;
        else if (k?.kind === 'arc') { const g = circleThrough(k.start, k.mid, k.end); r = g?.radius ?? null; }
      } else if (hit?.kind === 'edge') {
        // The circle through three points of the edge; a straight edge has none.
        const e3 = bodyOf(hit.body)?.edges[hit.n] ?? [];
        const pts = []; for (let i = 0; i < e3.length; i += 3) pts.push(new THREE.Vector3(e3[i], e3[i + 1], e3[i + 2]));
        if (pts.length >= 3) {
          const [a, b, q] = [pts[0], pts[Math.floor(pts.length / 2)], pts[pts.length - 1].distanceTo(pts[0]) < 1e-6 ? pts[Math.floor(pts.length / 4)] : pts[pts.length - 1]];
          const ab = b.clone().sub(a), aq = q.clone().sub(a), n = ab.clone().cross(aq);
          if (n.lengthSq() > 1e-12) r = ab.length() * aq.length() * q.clone().sub(b).length() / (2 * n.length());
        }
      }
      if (r === null) { setHud('NO RADIUS THERE: PICK A CIRCLE, ARC OR ROUND EDGE'); return true; }
      setHud(`RADIUS ${r.toFixed(3)} MM · DIAMETER ${(2 * r).toFixed(3)} MM`);
      setState('updated');
      return true;
    };
    c.finish = () => endCmd(null);
    c.abort = () => endCmd(null);
  }

  /** Plasticity's Extend Curve: click near an open end of a line or arc to lengthen it by the panel's length. */
  function startExtend() {
    if (!backend.replaceCurves) return toast('EXTEND IS NOT IN THIS BUILD YET');
    const c = cmd = { id: 'extend', count: 0 };
    lastTool = 'extend';
    showTool('extend');
    setState('none');
    setHud('CLICK NEAR AN END');
    c.click = async e => {
      const hit = pickAt(e);
      const src = (hit?.kind === 'curve' || hit?.kind === 'region') && curveById(hit.id);
      if (!src || !hit.point) return true;
      const f = curveFrame(src), d = hit.point.clone().sub(f.o), at = [d.dot(f.x), d.dot(f.y)];
      try {
        const out = extendCurve(src, nearestEnd(src, at), num('ext-len'), extShape());
        const { ids: made } = await backend.replaceCurves([src.id], [out]);
        c.count++;
        record(`EXTEND ${curveLabel(src.id)} ${num('ext-len')} MM ${extShape().toUpperCase()}`, made[0], curveLabel(made[0]));
        await loadCurves();
        setHud(`${c.count} EXTENDED · CLICK ANOTHER, OR ⏎`);
        setState('committed');
      } catch (err) { setState('failed'); toast(say(err)); }
      return true;
    };
    c.key = action => {
      if (action !== 'shape') return false;
      setExtShape(EXTEND_SHAPES[(EXTEND_SHAPES.indexOf(extShape()) + 1) % EXTEND_SHAPES.length]);
      setHud(`${extShape().toUpperCase()} · CLICK NEAR AN END`);
      return true;
    };
    c.finish = () => endCmd(c.count ? 'committed' : 'cancelled');
    c.abort = () => endCmd(c.count ? 'committed' : 'cancelled');
  }
  const extShape = () => $$('[data-extshape]').find(b => b.getAttribute('aria-pressed') === 'true')?.dataset.extshape ?? 'natural';
  const setExtShape = shape => { for (const b of $$('[data-extshape]')) b.setAttribute('aria-pressed', String(b.dataset.extshape === shape)); };

  /** Plasticity's Bridge Curves: a smooth curve between the nearest ends of two selected open curves. */
  /** A bridge panel's G1, G2 and G3 tensions, [start, end] each (`prefix` br or be). */
  const bridgeTensions = prefix => ({ tension: ['a', 'b'].map(e => num(`${prefix}-t1${e}`)), tension2: ['a', 'b'].map(e => num(`${prefix}-t2${e}`)), tension3: ['a', 'b'].map(e => num(`${prefix}-t3${e}`)) });
  function startBridge() {
    if (!backend.addCurves) return toast('BRIDGE IS NOT IN THIS BUILD YET');
    // Bridge Vertex: two picked end vertices say which ends; else the nearest ends of two curves.
    const verts = sel.list('vertex').filter(v => curveById(v.id));
    let a, b, pick = null;
    if (verts.length === 2 && verts[0].id !== verts[1].id) {
      const endOfVertex = v => { const last = curveVertices(curveById(v.id)).length - 1; return v.n === 0 ? 0 : v.n === last ? 1 : null; };
      const [ea, eb] = verts.map(endOfVertex);
      if (ea === null || eb === null) return toast('BRIDGE VERTEX JOINS THE END VERTICES OF TWO OPEN CURVES');
      [a, b] = verts.map(v => curveById(v.id));
      pick = { ea, eb };
    } else {
      const ids = sel.curves.filter(curveById);
      if (!ids.length && sel.list('edge').length === 2) return startBridgeEdge();
      if (ids.length !== 2) return toast('SELECT TWO OPEN CURVES, TWO END VERTICES OR TWO EDGES TO BRIDGE');
      [a, b] = ids.map(curveById);
      // The nearest pair of ends, measured in the viewport.
      const endPoint = (cv, w) => { const f = curveFrame(cv), p = curve2d(cv), q = w ? p[p.length - 1] : p[0]; return lift(f, q); };
      for (const ea of [0, 1]) for (const eb of [0, 1]) {
        const d = endPoint(a, ea).distanceTo(endPoint(b, eb));
        if (!pick || d < pick.d) pick = { d, ea, eb };
      }
    }
    const c = cmd = { id: 'bridge', out: null, continuity: ['G1', 'G1'], axis: '', trim: false, comb: false };
    $('br-p1').value = pick.ea;
    $('br-p2').value = pick.eb;
    const cycle = g => BRIDGE_CONTINUITY[(BRIDGE_CONTINUITY.indexOf(g) + 1) % BRIDGE_CONTINUITY.length];
    c.cycleEnd = i => { c.continuity[i] = cycle(c.continuity[i]); c.preview(); };
    lastTool = 'bridge';
    showTool('bridge');
    setState('none');
    setTarget(`${curveLabel(a.id)} · ${curveLabel(b.id)}`);
    c.preview = () => {
      clearPreview();
      try {
        $('br-start').textContent = `START ${c.continuity[0]}`;
        $('br-end').textContent = `END ${c.continuity[1]}`;
        $('br-trim').setAttribute('aria-pressed', String(c.trim));
        $('br-comb').setAttribute('aria-pressed', String(c.comb));
        $('br-constrain').setAttribute('aria-pressed', String(bridgeConstrain));
        const at = [num('br-p1'), num('br-p2')];
        for (const b2 of $$('[data-braxis]')) b2.setAttribute('aria-pressed', String(b2.dataset.braxis === c.axis));
        c.out = bridgeContinuous(a, pick.ea, b, pick.eb, { ...bridgeTensions('br'), continuity: c.continuity, at, axis: c.axis ? toWorld(AXES[c.axis]) : null });
        // Trim: each curve keeps the part up to its bridge point (see bridgeEnd).
        c.trims = [[a, pick.ea, at[0]], [b, pick.eb, at[1]]].map(([cv, e, t]) => ({ id: cv.id, ...bridgeEnd(cv, e, t) })).filter(t => t.beyond);
        showCurvePreview([c.out]);
        if (c.comb) showCombPreview([c.out, ...[[a, pick.ea, at[0]], [b, pick.eb, at[1]]].map(([cv, e, t]) => c.trim ? bridgeEnd(cv, e, t).kept : cv)]);
        $('br-hint').textContent = `${curveLabel(a.id)} TO ${curveLabel(b.id)}${c.trim && c.trims.length ? ' · TRIMMED' : ''}`;
        setHud(`BRIDGE · ${c.continuity.join(' / ')} · TENSION ${num('br-t1a')} / ${num('br-t1b')}${c.axis ? ` · ${c.axis.toUpperCase()} AXIS` : ''}${c.trim ? ' · TRIM' : ''}`);
        setState('updated');
      } catch (e) { c.out = null; $('br-hint').textContent = say(e); setHud('BRIDGE FAILED'); setState('failed'); }
    };
    c.key = action => {
      if (action === 'continuity') {
        // Tab steps both ends together, as Plasticity's Tab cycles G0 to G3; the buttons set each end.
        const next = cycle(c.continuity[0]);
        c.continuity = [next, next];
        c.preview();
        return true;
      }
      if (action === 'trim') { c.trim = !c.trim; c.preview(); return true; }
      if (action === 'comb') { c.comb = !c.comb; c.preview(); return true; }
      if (action === 'constrain') { bridgeConstrain = !bridgeConstrain; c.preview(); return true; }
      // X, Y and Z constrain the bridge to that axis; the same key again lets it go.
      if (action?.startsWith('axis-')) { c.setAxis(action.slice(5)); return true; }
      if (action !== 'tension') return false;
      c.entry = { label: 'TENSION', text: '', apply: v => { if (v > 0) { $('br-t1a').value = $('br-t1b').value = v; c.preview(); } else toast('THE TENSION MUST BE ABOVE ZERO'); } };
      setHud('TENSION _');
      return true;
    };
    c.finish = async () => {
      if (!c.out) return toast($('br-hint').textContent);
      try {
        // With trim, the trimmed curves and the bridge go in one step; the bridge comes last.
        const trims = c.trim ? c.trims : [];
        const { ids: made } = trims.length ? await backend.replaceCurves(trims.map(t => t.id), [...trims.map(t => t.kept), c.out]) : await backend.addCurves([c.out]);
        const bridge = made[made.length - 1];
        if (bridgeConstrain) {
          // A trimmed curve now ends at its bridge point, so the constraint bridges from its end.
          const side = (cv, e, t) => { const i = trims.findIndex(x => x.id === cv.id); return i >= 0 ? [made[i], e] : [cv.id, t]; };
          const at = [num('br-p1'), num('br-p2')], [ia, ta] = side(a, pick.ea, at[0]), [ib, tb] = side(b, pick.eb, at[1]);
          constraints.addBridge(bridge, ia, pick.ea, ib, pick.eb, { ...bridgeTensions('br'), continuity: [...c.continuity], at: [ta, tb], axis: c.axis ? toWorld(AXES[c.axis]) : null });
        }
        endCmd('committed');
        record(`${trims.length ? 'BRIDGE CURVES · TRIM' : 'BRIDGE CURVES'}${bridgeConstrain ? ' · CONSTRAINED' : ''}`, bridge, curveLabel(bridge));
        await curvesChanged([bridge]);
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.setAxis = a => { c.axis = c.axis === a ? '' : a; c.preview(); };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => clearPreview();
    c.preview();
  }

  /**
   * Plasticity's Bridge Edge: a curve between points on two selected body edges, each at a parameter
   * from 0 to 1 along its edge, meeting each edge in position, direction or curvature (G0, G1, G2).
   */
  async function startBridgeEdge() {
    if (cmd) await finish();
    if (!backend.addCurves || !backend.edgeCurvature) return toast('BRIDGE EDGE IS NOT IN THIS BUILD YET');
    const edges = sel.list('edge');
    if (edges.length !== 2) return toast('SELECT TWO EDGES TO BRIDGE');
    if (edges[0].body === edges[1].body && edges[0].n === edges[1].n) return toast('SELECT TWO DIFFERENT EDGES');
    let teeth;
    try { teeth = await Promise.all(edges.map(e => backend.edgeCurvature({ body: e.body, edge: e.n, n: 1000 }))); }
    catch (e) { return toast(say(e)); }
    const c = cmd = { id: 'bridge-edge', out: null, continuity: ['G1', 'G1'], axis: '' };
    const cycle = g => EDGE_CONTINUITY[(EDGE_CONTINUITY.indexOf(g) + 1) % EDGE_CONTINUITY.length];
    c.cycleEnd = i => { c.continuity[i] = cycle(c.continuity[i]); c.preview(); };
    lastTool = 'bridge-edge';
    showTool('bridge-edge');
    setState('none');
    setTarget(edges.map(e => label(e.body)).join(' · '));
    c.preview = () => {
      clearPreview();
      try {
        $('be-start').textContent = `START ${c.continuity[0]}`;
        $('be-end').textContent = `END ${c.continuity[1]}`;
        const A = edgePoint(teeth[0], num('be-p1')), B = edgePoint(teeth[1], num('be-p2'));
        for (const b of $$('[data-beaxis]')) b.setAttribute('aria-pressed', String(b.dataset.beaxis === c.axis));
        c.out = bridgeCurve(bridgePoles(A, B, { ...bridgeTensions('be'), continuity: c.continuity, axis: c.axis ? toWorld(AXES[c.axis]) : null }));
        showCurvePreview([c.out]);
        $('be-hint').textContent = `${c.continuity.join(' / ')} WITH THE EDGES`;
        setHud(`BRIDGE EDGE · ${c.continuity.join(' / ')} · TENSION ${num('be-t1a')} / ${num('be-t1b')}${c.axis ? ` · ${c.axis.toUpperCase()} AXIS` : ''}`);
        setState('updated');
      } catch (e) { c.out = null; $('be-hint').textContent = say(e); setHud('BRIDGE EDGE FAILED'); setState('failed'); }
    };
    c.key = action => {
      if (action === 'continuity') {
        const next = cycle(c.continuity[0]);
        c.continuity = [next, next];
        c.preview();
        return true;
      }
      if (action?.startsWith('axis-')) { c.axis = c.axis === action.slice(5) ? '' : action.slice(5); c.preview(); return true; }
      if (action !== 'tension') return false;
      c.entry = { label: 'TENSION', text: '', apply: v => { if (v > 0) { $('be-t1a').value = $('be-t1b').value = v; c.preview(); } else toast('THE TENSION MUST BE ABOVE ZERO'); } };
      setHud('TENSION _');
      return true;
    };
    c.finish = async () => {
      if (!c.out) return toast($('be-hint').textContent);
      try {
        const { ids: made } = await backend.addCurves([c.out]);
        endCmd('committed');
        record('BRIDGE EDGE', made[0], curveLabel(made[0]));
        await curvesChanged(made);
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => clearPreview();
    c.preview();
  }

  /**
   * Plasticity's Align Surface: with two edges selected, the first (on a B-spline sheet) is the
   * target and the second the reference; the target sheet's side moves to meet the reference in G0,
   * G1 or G2 (Tab), its first rows of control points moved (alignSurface.js), with a live preview.
   */
  async function startAlignSurface() {
    if (cmd) await finish();
    if (!backend.edgeFaces || !backend.previewMoveFacePoles) return toast('ALIGN SURFACE IS NOT IN THIS BUILD YET');
    const edges = sel.list('edge');
    if (edges.length !== 2) return toast('SELECT THE EDGE TO MOVE, THEN THE EDGE TO MEET');
    const [target, reference] = edges.map(e => ({ body: e.body, edge: e.n }));
    const c = cmd = { id: 'align-surface', continuity: 'G1', symmetric: false, analysis: false, boundary: 'natural', req: null, sent: 0, shown: 0 };
    lastTool = 'align-surface';
    showTool('align-surface');
    setState('none');
    setTarget(`${label(target.body)} → ${label(reference.body)}`);
    const buttons = () => {
      for (const b of $$('[data-ascont]')) b.setAttribute('aria-pressed', String(b.dataset.ascont === c.continuity));
      $('as-symmetric').setAttribute('aria-pressed', String(c.symmetric));
      $('as-analysis').setAttribute('aria-pressed', String(c.analysis));
      for (const b of $$('[data-asbound]')) b.setAttribute('aria-pressed', String(b.dataset.asbound === c.boundary));
      $('as-analysis-row').hidden = !c.analysis;
      $('as-infl').disabled = !(num('as-blend') > 0);
    };
    // Analysis: the gap, angle and curvature difference along the aligned edge, each against its tolerance.
    const analyse = async req => {
      for (const k of [0, 1, 2]) $(`as-r${k}`).textContent = '—';
      if (!c.analysis || !req) return;
      try {
        const tol = { g0: num('as-tg0'), g1: num('as-tg1'), g2: num('as-tg2') };
        const r = await alignAnalysis(backend, req, tol);
        if (cmd !== c || c.req !== req) return;
        const mark = ok => ok === null ? '' : ok ? ' ✓' : ' ✗';
        $('as-r0').textContent = `${r.gap.toFixed(4)} MM${mark(r.ok.g0)}`;
        $('as-r1').textContent = `${r.angle.toFixed(3)}°${mark(r.ok.g1)}`;
        $('as-r2').textContent = r.bend === null ? 'NEEDS 3 ROWS' : `${r.bend.toFixed(1)}%${mark(r.ok.g2)}`;
      } catch (e) { $('as-r0').textContent = say(e); }
    };
    // Degree/Spans: the target sheet rebuilt first (an undo step of its own, taken back if Align is
    // cancelled or set back to 0), then aligned. The edges are found again by where they lie.
    const middleOf = (body, n) => { const e = bodyOf(body)?.edges?.[n] ?? []; const k = Math.floor(e.length / 6) * 3; return e.slice(k, k + 3); };
    const refind = (body, at) => {
      let best = -1, bd = Infinity;
      (bodyOf(body)?.edges ?? []).forEach((e, n) => { const m = middleOf(body, n), d = Math.hypot(m[0] - at[0], m[1] - at[1], m[2] - at[2]); if (d < bd) { bd = d; best = n; } });
      return best;
    };
    const marks = { t: middleOf(target.body, target.edge), r: middleOf(reference.body, reference.edge) };
    c.rebuilt = 0; c.rebuiltKey = '';
    const unbuild = async () => {
      if (!c.rebuilt) return;
      let list;
      while (c.rebuilt) { list = await backend.undo(); history.pop(); c.rebuilt--; }
      renderHistory();
      await showScene(list);
    };
    const rebuildTo = async () => {
      const d = Math.round(num('as-deg') || 0), sp = Math.round(num('as-spans') || 0), key = d > 0 && sp > 0 ? `${d}/${sp}` : '';
      if (key === c.rebuiltKey) return;
      await unbuild();
      c.rebuiltKey = key;
      if (key) {
        const face = await targetFace(backend, target, reference);
        const { id, scene: list, rebuilt } = await backend.commitRebuildFaces({ body: target.body, faces: [face], explicit: true, tolerance: 0.01, degree: [d, d], spans: [sp, sp], extend: [0, 0], shrink: false });
        c.rebuilt = 1;
        record(`REBUILD FACE ×1`, id, `${(rebuilt ?? []).map(f => `${f.poles[0]}×${f.poles[1]} CVS`).join(' ')} · FOR ALIGN`);
        await showScene(list);
      }
      target.edge = refind(target.body, marks.t);
      reference.edge = refind(reference.body, marks.r);
    };
    c.preview = () => {
      buttons();
      const text = `ALIGN ${c.continuity} · TENSION ${num('as-t')}`;
      $('as-hint').textContent = c.symmetric ? `${label(target.body)} AND ${label(reference.body)} MEET HALFWAY IN ${c.continuity}` : `${label(target.body)} MEETS ${label(reference.body)} IN ${c.continuity}`;
      setHud(text);
      livePreview(c, async () => {
        c.req = null;
        c.ready = (c.ready ?? Promise.resolve()).then(rebuildTo);
        await c.ready;
        const req = await alignRequest(backend, { target, reference, continuity: c.continuity, tension: num('as-t'), blend: Math.max(0, Math.round(num('as-blend') || 0)), influence: Math.min(1, Math.max(0, num('as-infl') || 0)), partial: [num('as-p0'), num('as-p1')], symmetric: c.symmetric, boundary: c.boundary });
        // Symmetric moves the other sheet too: both previewed.
        const list = [];
        for (const r of [req, ...(req.more ?? [])]) list.push(await backend.previewMoveFacePoles(r));
        c.req = req;
        analyse(req);
        return list;
      }, list => list.forEach(b => showPreviewBody(b)), 'as-hint');
    };
    // Symmetric meets halfway in G0 or G1 only, so G2 drops to G1 while it is on.
    c.setContinuity = g => { c.continuity = c.symmetric && g === 'G2' ? 'G1' : g; c.preview(); };
    c.setSymmetric = on => { c.symmetric = on; if (on && c.continuity === 'G2') c.continuity = 'G1'; c.preview(); };
    c.setAnalysis = on => { c.analysis = on; buttons(); analyse(c.req); };
    c.analyse = () => analyse(c.req);
    c.key = action => {
      if (action === 'continuity') return c.setContinuity(ALIGN_CONTINUITY[(ALIGN_CONTINUITY.indexOf(c.continuity) + 1) % ALIGN_CONTINUITY.length]), true;
      if (action !== 'tension') return false;
      c.entry = { label: 'TENSION', text: '', apply: v => { if (v > 0) { $('as-t').value = v; c.preview(); } else toast('THE TENSION MUST BE ABOVE ZERO'); } };
      setHud('TENSION _');
      return true;
    };
    c.finish = async () => {
      if (!c.req) return toast($('as-hint').textContent);
      try {
        const { id, scene: list } = await backend.commitMoveFacePoles(c.req);
        endCmd('committed');
        record(`ALIGN SURFACE ${c.continuity}${c.symmetric ? ' SYMMETRIC' : ''}`, id, label(id));
        await showScene(list);
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = async () => { await (c.ready ?? null)?.catch(() => {}); await unbuild(); endCmd('cancelled'); };
    c.cleanup = () => clearPreview();
    c.preview();
  }

  /**
   * Plasticity's Project Align: select the edge of a B-spline sheet to move, then a face of another
   * body (the reference surface); the sheet's side drops onto the surface along its normal or a
   * vector (X/Y/Z or the view) and meets it in G0, G1, G2 or square (Tab).
   */
  async function startProjectAlign() {
    if (cmd) await finish();
    if (!backend.edgeFaces || !backend.faceUvn || !backend.previewMoveFacePoles) return toast('PROJECT ALIGN IS NOT IN THIS BUILD YET');
    const edges = sel.list('edge'), faces = sel.list('face');
    if (edges.length !== 1 || faces.length !== 1) return toast('SELECT THE SHEET EDGE TO MOVE, THEN SHIFT-SELECT THE REFERENCE FACE');
    const target = { body: edges[0].body, edge: edges[0].n }, reference = { body: faces[0].body, face: faces[0].n };
    const c = cmd = { id: 'project-align', continuity: 'G1', dir: 'normal', screen: null, req: null, sent: 0, shown: 0 };
    lastTool = 'project-align';
    showTool('project-align');
    setState('none');
    setTarget(`${label(target.body)} → ${label(reference.body)}`);
    const buttons = () => {
      for (const b of $$('[data-pacont]')) b.setAttribute('aria-pressed', String(b.dataset.pacont === c.continuity));
      for (const b of $$('[data-padir]')) b.setAttribute('aria-pressed', String(b.dataset.padir === c.dir));
    };
    const direction = () => c.dir === 'normal' ? null : c.dir === 'screen' ? c.screen : toWorld(userAxis(c.dir));
    c.preview = () => {
      buttons();
      const along = c.dir === 'normal' ? 'ALONG ITS NORMAL' : c.dir === 'screen' ? 'ALONG THE VIEW' : `ALONG ${c.dir.toUpperCase()}`;
      $('pa-hint').textContent = `${label(target.body)} PROJECTS ONTO ${label(reference.body)} ${along} · ${c.continuity === 'PERP' ? 'PERPENDICULAR' : c.continuity}`;
      setHud(`PROJECT ALIGN ${c.continuity === 'PERP' ? 'PERPENDICULAR' : c.continuity} · TENSION ${num('pa-t')}`);
      livePreview(c, async () => {
        c.req = null;
        const req = await projectAlignRequest(backend, { target, reference, direction: direction(), continuity: c.continuity, tension: num('pa-t'), blend: Math.max(0, Math.round(num('pa-blend') || 0)) });
        const b = await backend.previewMoveFacePoles(req);
        c.req = req;
        return b;
      }, b => showPreviewBody(b), 'pa-hint');
    };
    c.setContinuity = g => { c.continuity = g; c.preview(); };
    c.setDirection = d => {
      c.dir = d;
      if (d === 'screen') c.screen = controls.target.clone().sub(camera.position).normalize().toArray();
      c.preview();
    };
    c.key = action => {
      if (action === 'continuity') return c.setContinuity(PROJECT_CONTINUITY[(PROJECT_CONTINUITY.indexOf(c.continuity) + 1) % PROJECT_CONTINUITY.length]), true;
      if (action === 'normal' || action === 'screen') return c.setDirection(action), true;
      if (action.startsWith('axis-')) return c.setDirection(action.slice(5)), true;
      if (action !== 'tension') return false;
      c.entry = { label: 'TENSION', text: '', apply: v => { if (v > 0) { $('pa-t').value = v; c.preview(); } else toast('THE TENSION MUST BE ABOVE ZERO'); } };
      setHud('TENSION _');
      return true;
    };
    c.finish = async () => {
      if (!c.req) return toast($('pa-hint').textContent);
      try {
        const { id, scene: list } = await backend.commitMoveFacePoles(c.req);
        endCmd('committed');
        record(`PROJECT ALIGN ${c.continuity === 'PERP' ? 'PERPENDICULAR' : c.continuity}`, id, label(id));
        await showScene(list);
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => clearPreview();
    c.preview();
  }

  /** Plasticity's Explode: split the selected lines and joined curves into their pieces, one undo step. */
  async function explodeSelected(verb = 'EXPLODE') {
    if (cmd) await finish();
    const ids = sel.curves.filter(curveById);
    if (!ids.length) return toast(`SELECT A CURVE TO ${verb}`);
    if (!backend.replaceCurves) return toast('EXPLODE IS NOT IN THIS BUILD YET');
    try {
      const list = ids.flatMap(id => explode(curveById(id)));
      const { ids: made } = await backend.replaceCurves(ids, list);
      record(`${verb} ${ids.map(curveLabel).join(' ')}`, made[0], `${made.length} CURVES`);
      await curvesChanged(made);
    } catch (e) { toast(verb === 'EXPLODE' ? say(e) : say(e).replace(/explode/gi, 'UNJOIN').replace(/UNJOIN LINES, RECTANGLES, POLYGONS AND JOINED CURVES/i, 'ONLY JOINED CURVES UNJOIN')); }
  }

  /** Plasticity's Reverse Curve: turn the selected curves round end for end, one undo step. */
  async function reverseSelected() {
    if (cmd) await finish();
    const ids = sel.curves.filter(curveById);
    if (!ids.length) return toast('SELECT A CURVE TO REVERSE');
    if (!backend.replaceCurves) return toast('REVERSE IS NOT IN THIS BUILD YET');
    try {
      const list = ids.map(id => reverseCurve(curveById(id)));
      const { ids: made } = await backend.replaceCurves(ids, list);
      record(`REVERSE ${ids.map(curveLabel).join(' ')}`, made[0], `${made.length} CURVE${made.length > 1 ? 'S' : ''}`);
      await curvesChanged(made);
      showDirection(made);
    } catch (e) { toast(say(e)); }
  }

  /** Plasticity's Reverse Sheet: the selected sheets face the other way (see the Face direction shader). */
  async function reverseSheets() {
    if (cmd) await finish();
    const ids = sel.bodies.filter(id => bodyOf(id)?.sheet && org.shows(id));
    if (!ids.length) return toast('SELECT A SHEET TO REVERSE');
    if (!backend.commitReverseSheets) return toast('REVERSE SHEET IS NOT IN THIS BUILD YET');
    try {
      const list = await backend.commitReverseSheets({ bodies: ids });
      record(`REVERSE SHEET ${ids.map(label).join(' ')}`, ids[0], `${ids.length} SHEET${ids.length > 1 ? 'S' : ''}`);
      await showScene(list);
    } catch (e) { toast(say(e)); }
  }

  /** Plasticity's Find Boundary Edges: the open edges of the selected bodies (all shown, with none) become the selection. */
  async function findBoundaryEdges() {
    if (cmd) await finish();
    const ids = (sel.bodies.length ? sel.bodies : current.map(b => b.id)).filter(id => org.shows(id));
    if (!ids.length) return toast('NOTHING TO SEARCH');
    if (!backend.boundaryEdges) return toast('FIND BOUNDARY EDGES IS NOT IN THIS BUILD YET');
    try {
      const found = await backend.boundaryEdges({ bodies: ids });
      sel.clear();
      for (const { body, edges } of found) for (const n of edges) sel.add({ kind: 'edge', body, n });
      const n = found.reduce((t, f) => t + f.edges.length, 0);
      if (n) sel.modes.add('edge');
      renderModes();
      selectionChanged();
      toast(n ? `${n} BOUNDARY EDGE${n === 1 ? '' : 'S'} ON ${found.filter(f => f.edges.length).length} BODY${found.filter(f => f.edges.length).length === 1 ? '' : 'IES'}` : 'NO BOUNDARY EDGES: EVERY EDGE IS SHARED');
    } catch (e) { toast(say(e)); }
  }

  /**
   * Plasticity's Remove Fillets: the fillets of the selected solid (or the fillet chains holding the
   * selected faces) are found and handed to Remove Face, which previews the solid without them.
   */
  async function removeFillets() {
    if (cmd) await finish();
    if (!backend.filletFaces || !backend.previewRemoveFaces) return toast('REMOVE FILLETS NEEDS THE DESKTOP APP; THE BROWSER KERNEL CANNOT DO IT YET');
    let body = faceBody(), seeds = [];
    if (body !== null) seeds = sel.list('face').map(it => it.n);
    else {
      const ids = targetBodies();
      if (ids.length !== 1) return toast('SELECT ONE SOLID, OR FACES OF ITS FILLETS');
      body = ids[0];
    }
    try {
      const faces = await backend.filletFaces({ body, faces: seeds });
      sel.clear();
      for (const n of faces) sel.add({ kind: 'face', body, n });
      sel.modes.add('face');
      renderModes();
      selectionChanged({ quiet: true });
      await startTool('remove-face');
      toast(`${faces.length} FILLET FACE${faces.length === 1 ? '' : 'S'} ON ${label(body)}`);
    } catch (e) { toast(say(e)); }
  }

  /** Plasticity's Delete Redundant Topology: faces on one surface and edges on one curve merged, on the selected bodies. */
  async function unifySelected() {
    if (cmd) await finish();
    const ids = targetBodies().filter(id => org.shows(id));
    if (!ids.length) return toast('SELECT A SOLID OR SHEET TO CLEAN UP');
    if (!backend.commitUnify) return toast('DELETE REDUNDANT TOPOLOGY IS NOT IN THIS BUILD YET');
    try {
      const { faces, edges, scene: list } = await backend.commitUnify({ bodies: ids });
      record(`DELETE REDUNDANT TOPOLOGY ${ids.map(label).join(' ')}`, ids[0], `−${faces} FACES −${edges} EDGES`);
      await showScene(list);
      toast(faces || edges ? `MERGED AWAY ${faces} FACE${faces === 1 ? '' : 'S'} AND ${edges} EDGE${edges === 1 ? '' : 'S'}` : 'NOTHING TO MERGE');
    } catch (e) { toast(say(e)); }
  }

  /** Plasticity's Convert Vertex: picked corners of lines become control vertices, one undo step. */
  async function convertSelected(picked = sel.list('vertex').filter(v => curveById(v.id))) {
    if (cmd) await finish();
    if (!picked.length) return toast('SELECT CORNERS OF A LINE TO CONVERT');
    if (!backend.replaceCurves) return toast('CONVERT VERTEX IS NOT IN THIS BUILD YET');
    try {
      const ids = [...new Set(picked.map(v => v.id))];
      const list = ids.map(id => convertVertices(curveById(id), picked.filter(v => v.id === id).map(v => v.n)));
      const { ids: made } = await backend.replaceCurves(ids, list);
      record(`CONVERT VERTEX ${ids.map(curveLabel).join(' ')}`, made[0], `${picked.length} VERTICES`);
      await curvesChanged(made);
    } catch (e) { toast(say(e)); }
  }

  /** Plasticity's Raise Degree: the selected curves one degree higher, same shape, one undo step. */
  /**
   * Plasticity's Raise Surface Degree (Shift+S): the selected faces, or every face of the selected
   * solids, get one more degree each way, so more control points without changing shape.
   */
  async function raiseSurfaces() {
    if (!backend.commitRaiseFaces) return toast('RAISE SURFACE DEGREE IS NOT IN THIS BUILD YET');
    const byBody = new Map();
    for (const it of sel.list('face')) byBody.set(it.body, [...(byBody.get(it.body) ?? []), it.n]);
    for (const id of sel.solids) byBody.set(id, []);
    try {
      let list = null, last = null;
      const done = [];
      for (const [body, faces] of byBody) {
        const r = await backend.commitRaiseFaces({ body, faces });
        list = r.scene; last = r.id;
        done.push(...r.rebuilt);
        record(`RAISE DEGREE ${faces.length ? `×${faces.length}` : 'ALL FACES'}`, r.id);
      }
      await showScene(list);
      sel.replace({ kind: 'solid', body: last });
      selectionChanged({ quiet: true });
      const degrees = [...new Set(done.map(f => `${f.degree[0]}×${f.degree[1]}`))].join(', ');
      toast(`${done.length} FACE${done.length > 1 ? 'S' : ''} RAISED TO DEGREE ${degrees}`);
    } catch (e) { toast(say(e)); }
  }

  async function raiseSelected() {
    if (cmd) await finish();
    const ids = sel.curves.filter(curveById);
    if (!ids.length && (sel.list('face').length || sel.solids.length)) return raiseSurfaces();
    if (!ids.length) return toast('SELECT A CURVE, FACES OR SOLIDS TO RAISE THEIR DEGREE');
    if (!backend.replaceCurves) return toast('RAISE DEGREE IS NOT IN THIS BUILD YET');
    try {
      const list = ids.map(id => raiseDegree(curveById(id)));
      const { ids: made } = await backend.replaceCurves(ids, list);
      record(`RAISE DEGREE ${ids.map(curveLabel).join(' ')}`, made[0], `DEGREE ${list.map(c => c.degree).join(' ')}`);
      await curvesChanged(made);
      toast(`DEGREE ${list.map(c => c.degree).join(', ')} · ${list.map(c => c.poles.length - (isClosed(c) ? 1 : 0)).join(', ')} CONTROL POINTS`);
    } catch (e) { toast(say(e)); }
  }

  /**
   * Plasticity's Subdivide: the selected curves get twice the control points (their new points are
   * selected, in point mode), the selected faces twice the spans each way; shapes stay as they were.
   */
  async function subdivideSelected() {
    if (cmd) await finish();
    const ids = sel.curves.filter(curveById);
    const byBody = new Map();
    for (const it of sel.list('face')) byBody.set(it.body, [...(byBody.get(it.body) ?? []), it.n]);
    if (!ids.length && !byBody.size) return toast('SELECT CURVES OR FACES TO SUBDIVIDE');
    if (ids.length && !backend.replaceCurves) return toast('SUBDIVIDE OF CURVES IS NOT IN THIS BUILD YET');
    if (byBody.size && !backend.commitSubdivideFaces) return toast('SUBDIVIDE OF FACES IS NOT IN THIS BUILD YET');
    try {
      const said = [];
      if (byBody.size) {
        let list = null;
        for (const [body, faces] of byBody) {
          ({ scene: list } = await backend.commitSubdivideFaces({ body, faces }));
          record(`SUBDIVIDE ×${faces.length}`, body, `${faces.length} FACE${faces.length > 1 ? 'S' : ''}`);
        }
        await showScene(list);
        const n = [...byBody.values()].flat().length;
        said.push(`${n} FACE${n > 1 ? 'S' : ''}`);
      }
      if (ids.length) {
        const out = ids.map(id => subdivideCurve(curveById(id)));
        const { ids: made } = await backend.replaceCurves(ids, out.map(o => o.curve));
        record(`SUBDIVIDE ${ids.map(curveLabel).join(' ')}`, made[0], `${out.map(o => curveVertices(o.curve).length).join(' ')} POINTS`);
        await curvesChanged(made);
        // Plasticity selects the new points.
        sel.clear();
        sel.modes.add('point');
        made.forEach((id, i) => { for (const n of out[i].added) sel.add({ kind: 'vertex', id, n }); });
        renderModes();
        selectionChanged({ quiet: true });
        said.push(`${ids.length} CURVE${ids.length > 1 ? 'S' : ''}`);
      }
      toast(`SUBDIVIDED ${said.join(' · ')}`);
    } catch (e) { toast(say(e)); }
  }

  /**
   * Plasticity's Complete Edge: each open end of the selected curves carries on (an arc round its
   * circle, anything else straight) until it meets another shown curve in its plane.
   */
  async function completeSelected() {
    if (cmd) await finish();
    const ids = sel.curves.filter(curveById);
    if (!ids.length) return toast('SELECT CURVES TO COMPLETE');
    if (!backend.replaceCurves) return toast('COMPLETE EDGE IS NOT IN THIS BUILD YET');
    const box = new THREE.Box3().expandByObject(curveGroup);
    for (const b of current) { const m = bodyMesh(b.id); if (m) box.expandByObject(m); }
    const reach = Math.max(100, 2 * (box.isEmpty() ? 0 : box.getSize(new THREE.Vector3()).length()));
    try {
      const others = id => curveList.filter(c => c.id !== id && !org.hidden.has(c.id));
      const out = ids.map(id => ({ id, ...completeCurve(curveById(id), others(id), reach) })).filter(o => o.grown);
      if (!out.length) return toast('NOTHING FOR THOSE CURVES TO MEET');
      const { ids: made } = await backend.replaceCurves(out.map(o => o.id), out.map(o => o.curve));
      const n = out.reduce((a, o) => a + o.grown, 0);
      record(`COMPLETE EDGE ${out.map(o => curveLabel(o.id)).join(' ')}`, made[0], `${n} END${n > 1 ? 'S' : ''}`);
      await curvesChanged(made);
      toast(`COMPLETED ${n} END${n > 1 ? 'S' : ''}`);
    } catch (e) { toast(say(e)); }
  }

  /** Plasticity's Insert Knot: click curves to add control points without changing their shape. */
  function startInsertKnot() {
    if (!backend.replaceCurves) return toast('INSERT KNOT IS NOT IN THIS BUILD YET');
    const c = cmd = { id: 'insert-knot', count: 0 };
    lastTool = 'insert-knot';
    showTool('insert-knot');
    setState('none');
    setHud('CLICK A CURVE TO ADD A CONTROL POINT');
    c.click = async e => {
      // Any curve under the pointer, whatever the selection mode (point mode shows the new points).
      ray(e);
      raycaster.params.Line.threshold = unitsPerPixel(controls.target) * 6;
      const hit = raycaster.intersectObjects(curveGroup.children.filter(o => o.userData.curve !== undefined), false)[0];
      const src = hit && curveById(hit.object.userData.curve);
      if (!src) return true;
      const f = curveFrame(src), d = hit.point.clone().sub(f.o);
      try {
        const out = insertKnotAt(src, [d.dot(f.x), d.dot(f.y)]);
        const { ids: made } = await backend.replaceCurves([src.id], [out]);
        c.count++;
        record(`INSERT KNOT ${curveLabel(src.id)}`, made[0], `${out.poles.length - (isClosed(out) ? 1 : 0)} CONTROL POINTS`);
        await loadCurves();
        setHud(`${c.count} ADDED · CLICK ANOTHER, OR ⏎`);
        setState('committed');
      } catch (err) { setState('failed'); toast(say(err)); }
      return true;
    };
    c.finish = () => endCmd(c.count ? 'committed' : 'cancelled');
    c.abort = () => endCmd(c.count ? 'committed' : 'cancelled');
  }

  // --- Round 6: Box, Cylinder, Sphere, Shell, Mirror and arrays ---------------------
  // Box, Cylinder and Sphere: click a point on a face or the construction plane, then set sizes in
  // the panel; the solid previews as you type. Shell: select faces of one solid to open, set the wall
  // thickness. Mirror, Rectangular and Radial Array act on the selected solids and preview their
  // copies; J joins the copies to the originals instead of making new bodies. Each finishes as one
  // undo step. Values in the panel are in the user's axes (x right, y back, z up).

  /** Run `compute` for command `c` and draw what it returns, keeping only the newest answer. */
  async function livePreview(c, compute, show, hintId) {
    const n = ++c.sent;
    setState('updating');
    const t0 = performance.now();
    let r;
    try { r = await compute(); }
    catch (e) {
      if (cmd !== c || n !== c.sent) return;
      clearPreview();
      setState('failed');
      if (hintId) $(hintId).textContent = say(e);
      return setHud(`${toolInfo(c.id).label} FAILED`);
    }
    if (r == null || cmd !== c || n < c.shown) return;
    c.shown = n;
    $('ms').textContent = Math.round(performance.now() - t0);
    clearPreview();
    show(r);
    if (n === c.sent) setState('updated');
  }
  const showCopies = list => { for (const b of list) { const m = meshOf(b, phantom.add.face, phantom.add.edge); m.renderOrder = 5; previewGroup.add(m); } };
  const num = id => parseFloat($(id).value);
  const userAxis = a => ({ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] })[a];

  /**
   * Plasticity's Corner Box, Center Box, Three Point Box, Cylinder and Sphere, step by step as the
   * manual gives them. A box: click the base's corners (or centre and corner, or corner, side and
   * width), then move the cursor up for the height and click. A cylinder: centre, radius, height. A
   * sphere: centre, size. The base snaps and takes X/Y/Z like any sketch; Tab types the size of the
   * current step. While sizing the height, Q W Shift+E Shift+Q join, cut, intersect or slice the body
   * the base sits on, and B keeps it separate (the start). The last click leaves the panel open to
   * adjust; Enter or right-click finishes as one undo step.
   */
  function startPrimitive(id, { at = null } = {}) {
    if (!backend.previewPrimitive) return toast(`${toolInfo(id).label} IS NOT IN THIS BUILD YET`);
    const box = id === 'box' || id === 'center-box' || id === 'box3';
    const c = cmd = { id, box, plane: null, pts: [], cursor: null, axis: null, centre: id === 'center-box', square: false, vertical: false,
      stage: 'base', size: null, height: null, drive: 'height', op: 'new', keep: false, target: null, sent: 0, shown: 0, entry: null };
    lastTool = id;
    showTool(id);
    setState('none');
    const rows = { 'prim-w-row': box, 'prim-d-row': box, 'prim-r-row': !box, 'prim-h-row': id !== 'sphere' };
    for (const [row, on] of Object.entries(rows)) $(row).hidden = !on;
    for (const b of $$('[data-popt]')) b.hidden = b.dataset.popt === 'vertical' ? id !== 'cylinder' : !(id === 'box' || id === 'center-box');
    const say1 = () => ({ box: 'CLICK THE FIRST CORNER', 'center-box': 'CLICK THE CENTRE OF THE BASE', box3: 'CLICK THE FIRST CORNER', cylinder: 'CLICK THE CENTRE OF THE BASE', sphere: 'CLICK THE CENTRE' })[id];
    syncOpts();
    hint(say1());

    function hint(text) { $('prim-hint').textContent = text; setHud(text); }
    function syncOpts() {
      for (const b of $$('[data-popt]')) b.setAttribute('aria-pressed', !!c[b.dataset.popt]);
      for (const b of $$('[data-pop]')) b.setAttribute('aria-pressed', b.dataset.pop === c.op);
      $('prim-hint').dataset.op = c.op;
      $('prim-keep').setAttribute('aria-pressed', c.keep);
    }
    /** The base in plane coordinates: a box's corner, its side along u and its extent along v; a circle's centre and radius. */
    function base() {
      const P = [...c.pts, ...(c.stage === 'base' && c.cursor ? [c.cursor.uv] : [])];
      if (!P.length) return null;
      if (!box) return P.length < 2 ? null : { centre: P[0], radius: P[0].distanceTo(P[1]) };
      if (id === 'box3') {
        if (P.length < 2) return null;
        const u = P[1].clone().sub(P[0]), w = u.length();
        if (w < 1e-9) return null;
        u.divideScalar(w);
        const v = new THREE.Vector2(-u.y, u.x), d = P.length > 2 ? P[2].clone().sub(P[0]).dot(v) : 0;
        return { corner: P[0], u, v, width: w, depth: d };
      }
      if (P.length < 2) return null;
      let dx = P[1].x - P[0].x, dy = P[1].y - P[0].y;
      if (c.square) { const m = Math.max(Math.abs(dx), Math.abs(dy)); dx = (Math.sign(dx) || 1) * m; dy = (Math.sign(dy) || 1) * m; }
      return c.centre ? { corner: new THREE.Vector2(P[0].x - dx, P[0].y - dy), u: new THREE.Vector2(1, 0), v: new THREE.Vector2(0, 1), width: 2 * dx, depth: 2 * dy }
        : { corner: P[0].clone(), u: new THREE.Vector2(1, 0), v: new THREE.Vector2(0, 1), width: dx, depth: dy };
    }
    /** Turn the base and a height into a backend request (viewport coordinates). */
    function request() {
      const b = base(), pl = c.plane;
      if (!b || !pl) return null;
      const at2 = q => pl.o.clone().addScaledVector(pl.x, q.x).addScaledVector(pl.y, q.y);
      const extra = { target: pl.target ?? null, op: c.op, keep: c.keep && c.op !== 'new' };
      if (id === 'sphere') return { kind: 'sphere', center: at2(b.centre).toArray(), radius: b.radius, ...extra };
      if (id === 'cylinder') {
        // V stands the base circle up: its axis runs along the plane instead of off it.
        const n = c.vertical ? pl.y.clone() : pl.n.clone(), x = c.vertical ? pl.x.clone() : pl.x.clone();
        return { kind: 'cylinder', frame: { origin: at2(b.centre).toArray(), x: x.toArray(), normal: n.toArray() }, radius: b.radius, height: c.height ?? 0, ...extra };
      }
      const x = pl.x.clone().multiplyScalar(b.u.x).addScaledVector(pl.y, b.u.y);
      return { kind: 'box', frame: { origin: at2(b.corner).toArray(), x: x.toArray(), normal: pl.n.toArray() }, width: b.width, depth: b.depth, height: c.height ?? 0, ...extra };
    }
    function syncFields() {
      const r = request();
      if (!r) return;
      if (r.kind === 'box') { $('prim-w').value = +Math.abs(r.width).toFixed(3); $('prim-d').value = +Math.abs(r.depth).toFixed(3); }
      if (r.kind !== 'box') $('prim-r').value = +(2 * r.radius).toFixed(3);
      if (r.kind !== 'sphere') $('prim-h').value = +(r.height ?? 0).toFixed(3);
    }
    function outline() {
      const b = base(), pl = c.plane;
      if (!b || !pl) { drawPreview.visible = false; return; }
      let pts;
      if (!box) pts = Array.from({ length: 64 }, (_, i) => new THREE.Vector2(b.centre.x + b.radius * Math.cos(i / 32 * Math.PI), b.centre.y + b.radius * Math.sin(i / 32 * Math.PI)));
      else pts = [b.corner, b.corner.clone().addScaledVector(b.u, b.width), b.corner.clone().addScaledVector(b.u, b.width).addScaledVector(b.v, b.depth), b.corner.clone().addScaledVector(b.v, b.depth)];
      drawPreview.geometry.setFromPoints([...pts, pts[0]].map(q => pl.o.clone().addScaledVector(pl.x, q.x).addScaledVector(pl.y, q.y).addScaledVector(pl.n, 0.03)));
      drawPreview.visible = true;
    }
    function solidPreview() {
      const req = request();
      if (!req || (req.kind !== 'sphere' && !req.height)) return;
      drawPreview.visible = false;
      if (c.stage === 'adjust') placeDots(req);
      livePreview(c, () => backend.previewPrimitive(req), p => {
        if (p.result) showPreviewBody(p.result);
        const look = phantom[p.outcome === 'cut' || p.outcome === 'slice' ? 'cut' : 'add'];
        if (p.tool) { const m = meshOf(p.tool, look.face, look.edge); m.renderOrder = 5; previewGroup.add(m); }
        if (p.piece) { const m = meshOf(p.piece, phantom.add.face, phantom.add.edge); m.renderOrder = 6; previewGroup.add(m); }
        setHud(`${toolInfo(id).label} · ${({ new: 'NEW BODY', join: 'UNION', cut: 'DIFFERENCE', intersect: 'INTERSECT', slice: 'SLICE' })[p.outcome] ?? p.outcome.toUpperCase()}`);
      }, 'prim-hint');
    }
    /**
     * The manual's yellow dots: drag a box's height, width and length, a cylinder's height and radius,
     * or a sphere's radius. Each is a distance along one direction from an anchor on the shape; they
     * follow the shape as it changes.
     */
    c.dots = {};
    function placeDots(req) {
      const V = a => new THREE.Vector3(...a);
      const want = {};
      if (req.kind === 'sphere') want.r = { at: V(req.center), dir: c.plane.x, value: req.radius, set: v => setField('prim-r', 2 * Math.abs(v)) };
      if (req.kind === 'cylinder') {
        const o = V(req.frame.origin), n = V(req.frame.normal).normalize(), x = V(req.frame.x).normalize();
        want.h = { at: o, dir: n, value: req.height, set: v => setField('prim-h', v) };
        want.r = { at: o, dir: x, value: req.radius, set: v => setField('prim-r', 2 * Math.abs(v)) };
      }
      if (req.kind === 'box') {
        const o = V(req.frame.origin), n = V(req.frame.normal).normalize(), u = V(req.frame.x).normalize(), w = n.clone().cross(u);
        const centre = o.clone().addScaledVector(u, req.width / 2).addScaledVector(w, req.depth / 2);
        want.h = { at: centre, dir: n, value: req.height, set: v => setField('prim-h', v) };
        want.w = { at: o.clone().addScaledVector(w, req.depth / 2), dir: u.clone().multiplyScalar(Math.sign(req.width) || 1), value: Math.abs(req.width), set: v => setField('prim-w', Math.abs(v)) };
        want.d = { at: o.clone().addScaledVector(u, req.width / 2), dir: w.clone().multiplyScalar(Math.sign(req.depth) || 1), value: Math.abs(req.depth), set: v => setField('prim-d', Math.abs(v)) };
      }
      for (const [k, d] of Object.entries(want)) {
        let g = c.dots[k];
        if (!g) {
          g = c.dots[k] = dot(d.at, d.dir, v => { if (Math.abs(v) > 1e-6) c.dots[k].apply(v); });
        }
        g.apply = d.set;
        if (g.state !== 'dragging' && g.state !== 'command') { g.setFrame(d.at, d.dir); g.render(d.value); }
      }
    }
    /** A size from a dot or a typed value, through the panel so everything stays in step. */
    function setField(id, v) { $(id).value = +v.toFixed(3); fromFields(id); }
    /** The height under the cursor: along the base's normal, on a plane through it facing the camera. */
    function heightAt(e) {
      ray(e);
      const pl = c.plane, b = base(), n = (id === 'cylinder' && c.vertical) ? pl.y : pl.n;
      // Measured from the last base click, where the cursor was: moving up from there is up.
      const last = c.pts[c.pts.length - 1];
      const o = pl.o.clone().addScaledVector(pl.x, last.x).addScaledVector(pl.y, last.y);
      const view = camera.position.clone().sub(o), side = view.addScaledVector(n, -view.dot(n));
      if (side.lengthSq() < 1e-12) side.copy(pl.x);
      const hit = raycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(side.normalize(), o), new THREE.Vector3());
      if (!hit) return null;
      let h = hit.sub(o).dot(n);
      if (snapping(e)) h = Math.round(h / gridStep()) * gridStep();
      return h;
    }
    const steps = { box: 2, 'center-box': 2, box3: 3, cylinder: 2, sphere: 2 }[id];
    function advance() {
      if (c.stage === 'base' && c.pts.length >= steps) {
        if (id === 'sphere') { c.stage = 'adjust'; syncFields(); solidPreview(); hint('⏎ OR RIGHT-CLICK TO FINISH'); return; }
        c.stage = 'height'; c.drive = 'height'; c.height = 0;
        hint('MOVE UP FOR THE HEIGHT, THEN CLICK');
      }
    }
    c.place = p => {
      const x = frameFor(p.normal);
      c.plane = { o: p.origin.clone(), n: p.normal.clone(), x, y: new THREE.Vector3().crossVectors(p.normal, x), target: p.target ?? null };
      c.pts = [new THREE.Vector2()];
      setTarget(p.target ? label(p.target) : cplane.name);
    };
    c.move = e => {
      if (c.stage === 'base') {
        const p = drawPoint(e);
        showSnap(p?.snap, e);
        if (p && !p.curved) { c.cursor = p; if (c.plane) { outline(); syncFields(); } }
        return;
      }
      if (c.stage === 'height' || (c.stage === 'adjust' && c.dragging)) {
        if (c.drive === 'height') { const h = heightAt(e); if (h !== null) c.height = h; }
        else if (c.drive === 'radius') {
          const p = drawPoint(e);
          if (p?.uv && c.pts.length > 1) { const b0 = c.pts[0]; c.pts[1] = b0.clone().add(p.uv.clone().sub(b0)); }
        }
        syncFields();
        solidPreview();
      }
    };
    c.click = e => {
      if (c.stage === 'base') {
        const p = drawPoint(e);
        if (p?.curved) { toast('START ON A FLAT FACE OR THE CONSTRUCTION PLANE'); return true; }
        if (!p) return true;
        if (!c.plane) { c.plane = p.plane; setTarget(p.plane.target ? label(p.plane.target) : cplane.name); }
        c.pts.push(p.uv.clone());
        c.cursor = null;
        if (c.pts.length === 1) hint(id === 'box3' ? 'CLICK ALONG THE FIRST SIDE' : id === 'cylinder' ? 'CLICK FOR THE RADIUS' : id === 'sphere' ? 'CLICK FOR THE SIZE' : 'CLICK THE OPPOSITE CORNER');
        else if (id === 'box3' && c.pts.length === 2) hint('CLICK FOR THE WIDTH');
        advance();
        return true;
      }
      if (c.stage === 'height' || c.dragging) { c.stage = 'adjust'; c.dragging = false; solidPreview(); hint('DRAG THE DOTS · Q W ⇧E ⇧Q B FOR THE TARGET · T KEEPS THE TOOL · ⏎ TO FINISH'); return true; }
      return true;
    };
    c.key = action => {
      if (action === 'centre' || action === 'square') { if (!(id === 'box' || id === 'center-box')) return false; c[action] = !c[action]; syncOpts(); outline(); syncFields(); solidPreview(); return true; }
      if (action === 'vertical') { if (id !== 'cylinder') return false; c.vertical = !c.vertical; syncOpts(); solidPreview(); return true; }
      if (['union', 'difference', 'intersect', 'slice', 'new'].includes(action)) {
        if (action !== 'new' && !c.plane?.target) { toast('START ON A FACE OF A SOLID TO COMBINE WITH IT'); return true; }
        c.op = action; syncOpts(); solidPreview(); return true;
      }
      // T, keep tools: after a union, difference, intersect or slice the primitive stays as well.
      if (action === 'keep') { c.keep = !c.keep; syncOpts(); return true; }
      if (action === 'height' || action === 'radius') {
        if (c.stage === 'base') return true;
        c.drive = id === 'sphere' ? 'radius' : action; c.dragging = true; c.stage = 'adjust';
        hint(`MOVE FOR THE ${action === 'radius' ? (id === 'sphere' ? 'DIAMETER' : 'RADIUS') : 'HEIGHT'}, THEN CLICK`);
        return true;
      }
      if (action.startsWith('axis-')) { const a = action.slice(5); c.axis = c.axis === a ? null : a; return true; }
      if (action === 'typed') {
        // Tab types the size of the step in hand, in the order the manual's dialog lists them.
        const field = c.stage !== 'base' ? (id === 'sphere' ? 'prim-r' : 'prim-h') : box ? 'prim-w' : 'prim-r';
        const name = { 'prim-w': 'WIDTH', 'prim-d': 'LENGTH', 'prim-r': 'DIAMETER', 'prim-h': 'HEIGHT' }[field];
        c.entry = { label: name, text: '', apply: v => { $(field).value = v; fromFields(field); } };
        setHud(`${name} _`);
        return true;
      }
      return false;
    };
    c.entryDone = () => { if (c.entry) setHud(`${c.entry.label} ${c.entry.text}_`); };
    /** Panel and typed values drive the shape: rebuild the clicks from the fields. */
    function fromFields(changed) {
      if (!c.plane) return;
      const w = +$('prim-w').value, d = +$('prim-d').value, r = +$('prim-r').value / 2, h = +$('prim-h').value;
      const b = base();
      if (box) {
        const o = b?.corner ?? c.pts[0], u = b?.u ?? new THREE.Vector2(1, 0), v = b?.v ?? new THREE.Vector2(0, 1);
        const sw = Math.sign(b?.width || 1), sd = Math.sign(b?.depth || 1);
        if (id === 'box3') c.pts = [o.clone(), o.clone().addScaledVector(u, Math.abs(w) * sw), o.clone().addScaledVector(v, Math.abs(d) * sd)];
        else if (c.centre) { const ctr = o.clone().addScaledVector(u, (b?.width ?? 0) / 2).addScaledVector(v, (b?.depth ?? 0) / 2); c.pts = [ctr, ctr.clone().add(new THREE.Vector2(sw * Math.abs(w) / 2, sd * Math.abs(d) / 2))]; }
        else c.pts = [o.clone(), o.clone().add(new THREE.Vector2(sw * Math.abs(w), sd * Math.abs(d)))];
      } else c.pts = [c.pts[0], c.pts[0].clone().add(new THREE.Vector2(r, 0))];
      if (id !== 'sphere') c.height = h;
      if (c.stage === 'base' && (changed === 'prim-w' || changed === 'prim-d' || changed === 'prim-r')) {
        if (id === 'sphere') { c.stage = 'adjust'; } else { c.stage = 'height'; c.drive = 'height'; }
      }
      if (c.stage === 'height' && changed === 'prim-h') c.stage = 'adjust';
      outline();
      solidPreview();
    }
    c.fromFields = fromFields;
    c.finish = async () => {
      const req = request();
      if (!req || (req.kind !== 'sphere' && !req.height)) return endCmd('cancelled');
      try {
        const { id: made, scene: list } = await backend.commitPrimitive(req);
        endCmd('committed');
        record(`${toolInfo(id).label}${c.op !== 'new' ? ` · ${c.op.toUpperCase()}${req.keep ? ' · KEEP TOOL' : ''}` : ''}`, made);
        await showScene(list);
        sel.replace({ kind: 'solid', body: made });
        selectionChanged({ quiet: true });
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => { clearPreview(); drawPreview.visible = false; for (const g of Object.values(c.dots)) g.dispose(); };
    if (at) {
      // Placed by a command in words: the base at `at`, sizes from the panel, ready to finish.
      c.place(at);
      if (box) c.pts.push(new THREE.Vector2(+$('prim-w').value, +$('prim-d').value));
      else c.pts.push(new THREE.Vector2(+$('prim-r').value / 2, 0));
      if (id === 'box3') c.pts[2] = new THREE.Vector2(0, +$('prim-d').value);
      c.height = +$('prim-h').value;
      c.stage = 'adjust';
      solidPreview();
      hint('⏎ OR RIGHT-CLICK TO FINISH');
    }
  }

  /**
   * Plasticity's Draft Face: select the reference face, then Shift-select the faces of the same
   * solid to draft; they tilt about the reference's plane (the neutral plane) so the part leaves its
   * mould along its normal. With no flat reference picked first, the construction plane serves.
   * The white dot or A sets the angle, D offsets the neutral plane; the DRAFT view shows which faces
   * still need it.
   */
  let draftAboutPlane = false;
  function startDraft() {
    const body = faceBody();
    if (body === null) return toast(sel.list('face').length ? 'DRAFT THE FACES OF ONE SOLID AT A TIME' : 'SELECT THE REFERENCE FACE, THEN SHIFT-SELECT THE FACES TO DRAFT');
    if (!backend.previewDraft) return toast('DRAFT FACE IS NOT IN THIS BUILD YET');
    const c = cmd = { id: 'draft', body, faces: [], ref: null, plane: draftAboutPlane, gizmo: null, taper: 'offset', grow: 'moving', hinge: null, sent: 0, shown: 0 };
    draftAboutPlane = false;
    lastTool = 'draft';
    showTool('draft');
    setState('none');
    $('draft-d').value = 0;
    // Plasticity's Draft Face: the first face picked (a flat one) is the reference; its plane is the
    // neutral plane and its normal the pull direction. Without one, the construction plane serves.
    const neutral = () => {
      const b = bodyOf(c.body), p = c.ref !== null && b?.facePlanes[c.ref];
      const n = p ? new THREE.Vector3(...p.normal).normalize() : cplane.normal.clone().normalize();
      const o = p ? faceCentre(b, c.ref).clone() : cplane.origin.clone();
      return { n, o: o.addScaledVector(n, num('draft-d') || 0) };
    };
    c.request = () => { const { n, o } = neutral(); return { body: c.body, faces: c.faces, pull: n.toArray(), origin: o.toArray(), angle: num('draft-a') * DEG, grow: c.grow }; };
    // Taper Method Curve: the faces tilt about the picked line. A line square to the pull is the
    // draft whose neutral plane runs through it; a slanted one turns its face about it (Move Face),
    // the way that leans the face's normal towards the pull, as the draft does.
    c.call = () => {
      const r = c.request();
      if (c.taper !== 'curve') return { draft: r };
      if (!c.hinge) throw new Error('click the straight curve or edge to tilt the faces about');
      const pull = new THREE.Vector3(...r.pull), { p, d } = c.hinge;
      if (Math.abs(d.dot(pull)) < 1e-6) return { draft: { ...r, origin: p.toArray() } };
      if (c.faces.length !== 1) throw new Error('a line slanted to the pull tilts one face at a time');
      if (!backend.previewMoveFaces) throw new Error('the browser demo tilts faces about lines square to the pull; the desktop app takes slanted ones too');
      const plane = bodyOf(c.body)?.facePlanes[c.faces[0]];
      if (!plane) throw new Error('only a flat face tilts about a line');
      const nf = new THREE.Vector3(...plane.normal);
      const lean = d.clone().cross(nf).dot(pull);
      if (Math.abs(lean) < 1e-6) throw new Error('turning about a line along the pull does not tilt the face towards it; pick a line across the face');
      const axis = d.clone().multiplyScalar(lean > 0 ? 1 : -1);
      return { turn: { body: c.body, faces: c.faces, offset: [0, 0, 0], pivot: p.toArray(), axis: axis.toArray(), angle: r.angle } };
    };
    const text = () => `DRAFT ${num('draft-a')}°${c.taper === 'curve' ? ' · ABOUT THE LINE' : num('draft-d') ? ` · OFFSET ${num('draft-d')}` : ''}${c.grow !== 'moving' ? ` · GROW ${c.grow.toUpperCase()}` : ''}`;
    c.preview = () => {
      c.gizmo?.render(num('draft-a'));
      for (const b of $$('[data-drtaper]')) b.setAttribute('aria-pressed', String(b.dataset.drtaper === c.taper));
      for (const b of $$('[data-drgrow]')) b.setAttribute('aria-pressed', String(b.dataset.drgrow === c.grow));
      $('draft-pull').textContent = c.taper === 'curve' ? (c.hinge ? 'THE LINE' : 'CLICK A LINE') : c.ref !== null ? `FACE ${c.ref}` : `PLANE ${cplane.name}`;
      if (!c.faces.length) { clearPreview(); setState('none'); return setHud('SHIFT-SELECT THE FACES TO DRAFT'); }
      if (c.taper === 'curve' && !c.hinge) { clearPreview(); setState('none'); return setHud('CLICK THE STRAIGHT CURVE OR EDGE TO TILT ABOUT'); }
      livePreview(c, () => { const q = c.call(); return q.draft ? backend.previewDraft(q.draft) : backend.previewMoveFaces(q.turn); }, b => { showPreviewBody(b); setHud(text()); }, 'draft-hint');
    };
    // A straight curve's or body edge's line in the world, or null.
    const lineOf = hit => {
      let pts = [];
      if (hit?.kind === 'curve' && curveById(hit.id)) { const src = curveById(hit.id), f = curveFrame(src); pts = curve2d(src).map(q => lift(f, q)); }
      else if (hit?.kind === 'edge') { const e = bodyOf(hit.body)?.edges[hit.n] ?? []; for (let i = 2; i < e.length; i += 3) pts.push(new THREE.Vector3(e[i - 2], e[i - 1], e[i])); }
      if (pts.length < 2) return null;
      const p = pts[0], d = pts[pts.length - 1].clone().sub(p);
      if (d.length() < 1e-9) return null;
      d.normalize();
      const off = q => q.clone().sub(p).sub(d.clone().multiplyScalar(q.clone().sub(p).dot(d))).length();
      return pts.every(q => off(q) < 1e-4) ? { p: p.clone(), d } : null;
    };
    c.taperTo = m => { c.taper = m; c.preview(); };
    // Grow (manual): for an inner face drafted out past the outer wall; Tab cycles Moving, Fixed, None.
    c.growTo = g => { c.grow = g; c.preview(); };
    // The white dot sets the angle: dragged out along the first drafted face's normal, a degree per unit.
    const place = () => {
      c.gizmo?.dispose();
      c.gizmo = null;
      const b = bodyOf(c.body), f = c.faces[0], p = f !== undefined && b?.facePlanes[f];
      if (!p) return;
      c.gizmo = dot(faceCentre(b, f), new THREE.Vector3(...p.normal).normalize(), v => { $('draft-a').value = +v.toFixed(2); c.preview(); });
    };
    c.onSelection = () => {
      drawOverlays();
      const b = faceBody();
      if (b === null) return setHud('SELECT FACES OF ONE SOLID TO DRAFT');
      c.body = b;
      const picked = sel.list('face').map(it => it.n);
      const flat = !c.plane && picked.length > 1 && bodyOf(b)?.facePlanes[picked[0]];
      c.ref = flat ? picked[0] : null;
      c.faces = (flat ? picked.slice(1) : picked).sort((x, y) => x - y);
      setTarget(label(b));
      $('draft-count').textContent = c.faces.length;
      $('draft-pull').textContent = c.ref !== null ? `FACE ${c.ref}` : `PLANE ${cplane.name}`;
      $('draft-hint').textContent = `${c.faces.length} FACE${c.faces.length === 1 ? '' : 'S'} OF ${label(b)} ABOUT ${c.ref !== null ? 'THE REFERENCE FACE' : `PLANE ${cplane.name}`}`;
      place();
      c.preview();
    };
    c.key = action => {
      if (action === 'angle') {
        c.entry = { label: 'ANGLE', text: '', apply: v => { $('draft-a').value = v; c.preview(); } };
        setHud('ANGLE _');
        return true;
      }
      if (action === 'grow') {
        c.growTo({ moving: 'fixed', fixed: 'none', none: 'moving' }[c.grow]);
        toast(`GROW ${c.grow.toUpperCase()}`);
        return true;
      }
      if (action === 'offset') {
        c.entry = { label: 'OFFSET', text: '', apply: v => { $('draft-d').value = v; c.preview(); } };
        setHud('OFFSET _');
        return true;
      }
      return false;
    };
    c.click = e => {
      const hit = pickAt(e);
      if (c.taper === 'curve' && !(e.ctrlKey || e.metaKey || e.shiftKey) && (hit?.kind === 'curve' || hit?.kind === 'edge')) {
        const line = lineOf(hit);
        if (!line) { toast('PICK A STRAIGHT CURVE OR EDGE'); return true; }
        c.hinge = line;
        c.preview();
        return true;
      }
      if (hit?.kind !== 'face' || !(e.ctrlKey || e.metaKey || e.shiftKey)) return true;
      sel.toggle({ kind: 'face', body: hit.body, n: hit.n });
      selectionChanged();
      return true;
    };
    c.finish = async () => {
      if (!c.faces.length) return toast('SHIFT-SELECT THE FACES TO DRAFT');
      try {
        const q = c.call();
        const { id, scene: list } = q.draft ? await backend.commitDraft(q.draft) : await backend.commitMoveFaces(q.turn);
        endCmd('committed');
        record(`DRAFT ${num('draft-a')}° ×${c.faces.length}`, id);
        await showScene(list);
        sel.replace({ kind: 'solid', body: id });
        selectionChanged({ quiet: true });
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => { c.gizmo?.dispose(); clearPreview(); };
    c.onSelection();
  }

  function startShell() {
    const body = faceBody();
    if (body === null) return toast(sel.list('face').length ? 'SHELL THE FACES OF ONE SOLID AT A TIME' : 'SELECT THE FACES TO LEAVE OPEN');
    if (!backend.previewShell) return toast('SHELL IS NOT IN THIS BUILD YET');
    const c = cmd = { id: 'shell', body, faces: [], sent: 0, shown: 0 };
    lastTool = 'shell';
    showTool('shell');
    setState('none');
    c.request = () => ({ body: c.body, faces: c.faces, thickness: num('shell-t') });
    c.preview = () => livePreview(c, () => backend.previewShell(c.request()), b => { showPreviewBody(b); setHud(`SHELL ${num('shell-t')} MM`); }, 'shell-hint');
    c.onSelection = () => {
      drawOverlays();
      const b = faceBody();
      if (b === null) return setHud('SELECT FACES TO OPEN');
      c.body = b;
      c.faces = sel.list('face').map(it => it.n).sort((x, y) => x - y);
      setTarget(label(b));
      $('shell-count').textContent = c.faces.length;
      $('shell-hint').textContent = `${c.faces.length} FACE${c.faces.length > 1 ? 'S' : ''} OPEN ON ${label(b)}`;
      c.preview();
    };
    c.key = action => {
      if (action !== 'thickness') return false;
      c.entry = { label: 'THICKNESS', text: '', apply: v => { $('shell-t').value = v; c.preview(); } };
      setHud('THICKNESS _');
      return true;
    };
    c.click = e => {
      const hit = pickAt(e);
      if (hit?.kind !== 'face' || !(e.ctrlKey || e.metaKey || e.shiftKey)) return true;
      sel.toggle({ kind: 'face', body: hit.body, n: hit.n });
      selectionChanged();
      return true;
    };
    c.finish = async () => {
      try {
        const { id, scene: list } = await backend.commitShell(c.request());
        endCmd('committed');
        record(`SHELL ${num('shell-t')} MM ×${c.faces.length}`, id);
        await showScene(list);
        sel.replace({ kind: 'solid', body: id });
        selectionChanged({ quiet: true });
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => clearPreview();
    c.onSelection();
  }

  /** The commands that copy the selected solids: Mirror and the two arrays. */
  function startCopies(id, request, describe) {
    const ids = targetBodies().filter(b => org.shows(b));
    if (!ids.length) { toast(`SELECT A SOLID TO ${toolInfo(id).label}`); return null; }
    const preview = id === 'mirror' ? 'previewMirror' : 'previewArray', commit = id === 'mirror' ? 'commitMirror' : 'commitArray';
    if (!backend[preview]) { toast(`${toolInfo(id).label} IS NOT IN THIS BUILD YET`); return null; }
    const hint = { mirror: 'mirror-hint', 'rect-array': 'ra-hint', 'radial-array': 'rr-hint', 'curve-array': 'ca-hint' }[id];
    const joinBtn = { mirror: 'mirror-join', 'rect-array': 'ra-join', 'radial-array': 'rr-join', 'curve-array': 'ca-join' }[id];
    const instanceBtn = { mirror: 'mirror-instance', 'rect-array': 'ra-instance', 'radial-array': 'rr-instance', 'curve-array': 'ca-instance' }[id];
    const c = cmd = { id, ids, join: false, instance: false, sent: 0, shown: 0 };
    lastTool = id;
    showTool(id);
    setState('none');
    setTarget(ids.length === 1 ? label(ids[0]) : `${ids.length} SOLIDS`);
    $(hint).textContent = `${ids.length} SOLID${ids.length > 1 ? 'S' : ''}`;
    $(joinBtn).setAttribute('aria-pressed', 'false');
    if (instanceBtn) $(instanceBtn).setAttribute('aria-pressed', 'false');
    c.preview = () => livePreview(c, () => backend[preview]({ bodies: c.ids, ...request(c) }), list => { showCopies(list); setHud(describe(c, list.length)); }, hint);
    c.key = action => {
      // An array of instances: each copy an instance of its solid, so they join nothing.
      if (action === 'instance' && instanceBtn) {
        c.instance = !c.instance;
        if (c.instance) { c.join = false; $(joinBtn).setAttribute('aria-pressed', 'false'); }
        $(instanceBtn).setAttribute('aria-pressed', c.instance);
        return true;
      }
      if (action === 'join') {
        if (c.instance) { toast('INSTANCES CANNOT JOIN; TURN INSTANCE (I) OFF'); return true; }
        c.join = !c.join; $(joinBtn).setAttribute('aria-pressed', c.join); return true;
      }
      if (['x', 'y', 'z'].includes(action) && id !== 'rect-array') { c.axis = action; syncAxis(c); c.preview(); return true; }
      return false;
    };
    c.finish = async () => {
      if (c.instance && id === 'mirror') {
        // Mirror with I: each solid gets a mirrored instance where its copy would stand.
        const plane = request(c);
        for (const b of c.ids) instances.push(mirroredInstance(nextInstance++, b, plane, new THREE.Box3().setFromObject(bodyMesh(b)).getCenter(new THREE.Vector3()).toArray()));
        endCmd('committed');
        drawInstances();
        renderOutliner();
        return toast(`${c.ids.length} MIRRORED INSTANCE${c.ids.length > 1 ? 'S' : ''}`);
      }
      if (c.instance) {
        try {
          const { spec } = request(c), motions = spec.kind === 'motions' ? spec.motions : arrayMotions(spec);
          if (!motions.length) return toast('THE ARRAY HAS NO COPIES');
          for (const id of c.ids) {
            const centre = new THREE.Box3().setFromObject(bodyMesh(id)).getCenter(new THREE.Vector3()).toArray();
            for (const m of motions) instances.push(instanceFromMotion(nextInstance++, id, m, centre));
          }
          endCmd('committed');
          drawInstances();
          renderOutliner();
          toast(`${motions.length * c.ids.length} INSTANCE${motions.length * c.ids.length > 1 ? 'S' : ''} · ${toolInfo(id).label}`);
        } catch (e) { setState('failed'); toast(say(e)); }
        return;
      }
      try {
        const { ids: made, scene: list } = await backend[commit]({ bodies: c.ids, ...request(c), join: c.join });
        endCmd('committed');
        record(`${toolInfo(id).label}${c.join ? ' · JOINED' : ''}`, made[0], c.join ? label(made[0]) : `${made.length} NEW`);
        await showScene(list);
        sel.clear();
        for (const b of made) sel.add({ kind: 'solid', body: b });
        selectionChanged({ quiet: true });
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => clearPreview();
    return c;
  }
  function syncAxis(c) {
    const attr = c.id === 'mirror' ? 'mx' : 'rx';
    for (const b of $$(`[data-${attr}]`)) b.setAttribute('aria-pressed', b.dataset[attr] === c.axis);
  }

  /**
   * Plasticity's Mirror (Alt+X): X/Y/Z mirror across that axis's plane (Shift for the negative way,
   * which only matters with Cut), AT where the plane crosses it; click a face for a plane on it
   * (a curved face: the plane touching it where clicked); F Freestyle, two clicks on the
   * construction plane; Cut down mirror plane cuts each solid by the plane first; Q unions halves.
   */
  function startMirror() {
    const c = startCopies('mirror', c => {
      const sign = c.neg ? -1 : 1;
      if (c.plane) return { origin: c.plane.origin.toArray(), normal: c.plane.normal.clone().multiplyScalar(sign).toArray(), cut: c.cut };
      const n = userAxis(c.axis), at = num('mirror-at');
      return { origin: toWorld(n.map(v => v * at)), normal: toWorld(n.map(v => v * sign)), cut: c.cut };
    }, c => `MIRROR ACROSS ${c.plane ? c.plane.name : `${c.neg ? '−' : ''}${c.axis.toUpperCase()} = ${num('mirror-at')}`}${c.cut ? ' · CUT' : ''}`);
    if (!c) return;
    c.axis = 'x'; c.neg = false; c.cut = false; c.plane = null; c.free = null;
    const sync = () => {
      syncAxis(c);
      if (c.plane) for (const b of $$('[data-mx]')) b.setAttribute('aria-pressed', 'false');
      $('mirror-neg').setAttribute('aria-pressed', c.neg);
      $('mirror-cut').setAttribute('aria-pressed', c.cut);
      $('mirror-free').setAttribute('aria-pressed', !!c.free);
    };
    const key = c.key;
    c.key = action => {
      if (['x', 'y', 'z', '-x', '-y', '-z'].includes(action)) {
        c.neg = action.startsWith('-'); c.axis = action.replace('-', ''); c.plane = null; c.free = null;
        sync(); c.preview(); return true;
      }
      if (action === 'negative') { c.neg = !c.neg; sync(); c.preview(); return true; }
      if (action === 'cut') { c.cut = !c.cut; sync(); c.preview(); return true; }
      if (action === 'freestyle') { c.free = c.free ? null : { pts: [] }; sync(); setHud(c.free ? 'FREESTYLE: CLICK THE MIRROR LINE’S START' : ''); return true; }
      return key(action);
    };
    c.click = e => {
      if (c.free) {
        const h = placeAt(e);
        if (!h || h.curved) return true;
        const p = h.origin.clone().addScaledVector(cplane.normal, -planeOf().distanceToPoint(h.origin));
        c.free.pts.push(p);
        if (c.free.pts.length === 1) { setHud('FREESTYLE: CLICK THE MIRROR LINE’S END'); return true; }
        const [a, b] = c.free.pts, d = b.clone().sub(a);
        const n = d.clone().cross(cplane.normal);
        c.free = null;
        if (n.lengthSq() < 1e-12) { toast('CLICK TWO DIFFERENT POINTS'); sync(); return true; }
        c.plane = { origin: a, normal: n.normalize(), name: 'FREESTYLE LINE' };
        sync(); c.preview(); return true;
      }
      // A face clicked: the plane on it (flat), or touching it where clicked (curved).
      const hit = pickAt(e);
      if (hit?.kind !== 'face' && hit?.kind !== 'solid') return true;
      ray(e);
      const meshHit = raycaster.intersectObjects(shownMeshes(), false)[0];
      if (!meshHit) return true;
      const { faceIds, facePlanes, id } = meshHit.object.userData, f = faceIds[meshHit.faceIndex], fp = facePlanes[f];
      const normal = fp ? new THREE.Vector3(...fp.normal) : meshHit.face.normal.clone().transformDirection(meshHit.object.matrixWorld);
      const origin = fp ? new THREE.Vector3(...fp.origin) : meshHit.point.clone();
      c.plane = { origin, normal: normal.normalize(), name: `${label(id)} FACE ${f + 1}${fp ? '' : ' (TOUCHING)'}` };
      sync(); c.preview(); return true;
    };
    sync();
    c.preview();
  }

  // Plasticity's Mode: Rectangular Spacing or Extent, Radial Total or Spacing (Tab switches);
  // Shift+wheel adds or takes away a copy (Rectangular: along the axis last picked with X/Y/Z).
  function startArray(id) {
    const radial = id === 'radial-array';
    const c = startCopies(id, c => radial
      ? { spec: radialSpec(cplane.origin.toArray(), toWorld(userAxis(c.axis)), num('rr-angle') * DEG, Math.round(num('rr-count')), c.mode) }
      : { spec: rectangularSpec(['x', 'y', 'z'].map(a => toWorld(userAxis(a).map(v => v * num(`ra-s${a}`)))), ['x', 'y', 'z'].map(a => Math.round(num(`ra-c${a}`))), c.mode) },
    (c, n) => `${n} ${n === 1 ? 'COPY' : 'COPIES'}${c.mode === 'extent' ? ' · EXTENT' : radial && c.mode === 'spacing' ? ' · SPACING' : ''}`);
    if (!c) return;
    c.axis = radial ? 'z' : 'x';
    const modes = radial ? ['total', 'spacing'] : ['spacing', 'extent'];
    c.mode = modes[0];
    const syncMode = () => {
      for (const m of modes) $(`${radial ? 'rr' : 'ra'}-${m}`).setAttribute('aria-pressed', c.mode === m);
      if (radial) $('rr-alabel').textContent = c.mode === 'spacing' ? 'STEP °' : 'ANGLE °';
      else $('ra-slabel').textContent = c.mode === 'extent' ? 'EXTENT X · Y · Z' : 'SPACING X · Y · Z';
    };
    syncMode();
    const key = c.key;
    c.key = action => {
      if (action === 'mode') { c.mode = modes[(modes.indexOf(c.mode) + 1) % 2]; syncMode(); c.preview(); return true; }
      if (modes.includes(action)) { c.mode = action; syncMode(); c.preview(); return true; }
      if (!radial && ['x', 'y', 'z'].includes(action)) { c.axis = action; setHud(`SHIFT+WHEEL ADDS OR TAKES AWAY ${action.toUpperCase()} COPIES`); return true; }
      return key(action);
    };
    c.wheel = d => {
      const field = radial ? 'rr-count' : `ra-c${c.axis}`;
      $(field).value = String(Math.max(1, Math.min(1000, Math.round(num(field)) + d)));
      c.preview();
    };
    if (radial) syncAxis(c);
    c.preview();
  }

  /**
   * Plasticity's Curve Array: the selected solids repeated evenly along a curve by length (round a
   * closed one), from its start. A selected curve is used; otherwise click one. A turns the copies
   * with the curve or keeps them square, J joins them.
   */
  function startCurveArray() {
    const c = startCopies('curve-array', c => ({ spec: { kind: 'motions', motions: curveArrayMotions(curveById(c.curve), Math.round(num('ca-count')), c.align) } }),
      (c, n) => `${n} ${n === 1 ? 'COPY' : 'COPIES'} ALONG ${curveLabel(c.curve)}${c.align ? '' : ' · NOT ALIGNED'}`);
    if (!c) return;
    c.curve = sel.curves.find(curveById) ?? null;
    c.align = true;
    $('ca-align').setAttribute('aria-pressed', 'true');
    const preview = c.preview;
    c.preview = () => {
      if (c.curve === null) { clearPreview(); return setHud('CLICK THE CURVE TO ARRAY ALONG'); }
      preview();
    };
    const key = c.key;
    c.key = action => {
      if (action === 'align') { c.align = !c.align; $('ca-align').setAttribute('aria-pressed', c.align); c.preview(); return true; }
      return key(action);
    };
    c.click = e => {
      const picked = curveAt(e);
      if (picked !== null) { c.curve = picked; c.preview(); }
      return true;
    };
    const finish = c.finish;
    c.finish = async () => { if (c.curve === null) return toast('CLICK THE CURVE TO ARRAY ALONG'); await finish(); };
    c.preview();
  }

  // --- revolve, loft (L) and sweep (⇧P) ------------------------------------------
  // Plasticity's Revolve: select a region, start Revolve (Suggested Commands or F), click the
  // axis's start and end; A sets the angle (360° to begin with). Loft: select two regions or more
  // in the order the solid flows through them and press L. Sweep: select the region, press Shift+P,
  // then click the curve to follow; D sets the twist and the panel the end scale. Revolve and
  // Sweep take Q union, W difference, Shift+E intersect with the body the region lies on, and B a
  // new body (the start). Enter, right-click or OK finishes and selects the result.
  const FOPS = ['union', 'difference', 'intersect', 'new'];
  /**
   * Plasticity's Loft with curves selected (rather than regions): a sheet through the curves, open
   * or closed, in the order they were selected. LOOP (three curves or more) runs the sheet on from
   * the last back to the first, so it closes on itself. Enter, right-click or OK keeps it.
   */
  function startLoftSheet(curves) {
    if (!backend.previewLoftSheet) return toast('LOFT OF CURVES IS NOT IN THIS BUILD YET');
    const c = cmd = { id: 'loft', sheet: true, curves, loop: false, simplify: true, cont: 'G0', data: null, sent: 0, shown: 0 };
    $('ls-t').value = '1';
    lastTool = 'loft';
    showTool('loft');
    $$('[data-panel="form"]')[0].hidden = true;
    $$('[data-panel="loft-sheet"]')[0].hidden = false;
    $('keys').innerHTML = keysHtml('loft-sheet');
    setState('none');
    setTarget('NEW SHEET');
    // Profiles: drawn curves by id, body edges as { key, body, n, curve } once their curve is read
    // (a smooth curve through points along the edge, closed when the edge is).
    const edgeCurve = it => {
      if (!c.read.has(it.key)) c.read.set(it.key, backend.edgeCurvature({ body: it.body, edge: it.n, n: 64 }).then(teeth => {
        const pts = teeth.map(t => t.at), closed = pts.length > 3 && Math.hypot(...pts[0].map((x, k) => x - pts.at(-1)[k])) < 1e-6;
        return curveFromNurbs(smoothThrough(closed ? pts.slice(0, -1) : pts, closed), [0, -1, 0]);
      }));
      return c.read.get(it.key);
    };
    c.read = new Map();
    // Limit points (L): up to two on each drawn profile, in its plane's coordinates; the curve goes
    // as the range they mark (loftLimits.js), clicking a point again lofting its other side.
    c.limits = new Map();
    c.picking = false;
    const profile = p => {
      if (typeof p === 'object') return edgeCurve(p);
      const l = c.limits.get(p);
      return l?.pts.length ? limitCurve(curveById(p), l.pts, l.flip) : p;
    };
    const showLimits = () => {
      for (const o of [...limitMarks.children]) dispose(o);
      const pts = [];
      for (const [id, l] of c.limits) {
        const f = curveFrame(curveById(id));
        for (const [u, v] of l.pts) pts.push(f.o.clone().addScaledVector(f.x, u).addScaledVector(f.y, v));
      }
      if (pts.length) limitMarks.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(pts), hullDots));
      $('ls-limits').textContent = pts.length;
      $('ls-limit').setAttribute('aria-pressed', String(c.picking));
    };
    const request = async () => ({ curves: await Promise.all(c.curves.map(profile)), loop: c.loop, simplify: c.simplify });
    const text = () => `${c.curves.map(p => typeof p === 'object' ? `${label(p.body)} EDGE ${p.n + 1}` : curveLabel(p)).join(' → ')}${c.loop ? ' → BACK TO THE FIRST' : ''}`;
    // Two Edges: two body edges alone (no loop, no limit points) take a continuity, G0 to G2, and a
    // tension. G1 and G2 leave each face as Square's two-sided fill does (square.js with each edge's
    // way out of its face, normals and curvatures); G0 is the plain loft.
    const twoEdges = () => !c.loop && c.curves.length === 2 && c.curves.every(p => typeof p === 'object') && backend.previewSplineSheet && backend.edgeFaces;
    const smooth = () => twoEdges() && c.cont !== 'G0';
    const reader = edgeSideReader(c.sides = c.sides ?? {});
    const fitEdges = async () => {
      const items = c.curves.map(p => ({ kind: 'edge', body: p.body, n: p.n }));
      const sides = await Promise.all(items.map(reader.sideOf));
      const all = sides.flat(), centre = [0, 1, 2].map(k => all.reduce((t, p) => t + p[k], 0) / all.length);
      const faced = await Promise.all(sides.map((pts, i) => reader.withOut(items[i], pts, centre)));
      const tension = num('ls-t');
      if (!(tension > 0)) throw new Error('the tension must be greater than zero');
      return square(faced, { degree: 3, continuity: c.cont, tension });
    };
    c.preview = () => livePreview(c, async () => {
      if (smooth()) {
        const fit = await fitEdges();
        if (cmd !== c) return null;
        c.data = splineSheetData(fit);
        const b = await backend.previewSplineSheet({ data: c.data });
        return b ? [b] : null;
      }
      c.data = null;
      const b = await backend.previewLoftSheet(await request());
      return b ? [b] : null;
    }, list => {
      for (const b of list) showPreviewBody(b, phantom.add.face, phantom.add.edge).renderOrder = 5;
      $('ls-hint').textContent = text() + (smooth() ? ` · ${c.cont} · TENSION ${num('ls-t')}` : '');
      setHud(`LOFT · SHEET${c.loop ? ' · LOOP' : ''}${smooth() ? ` · ${c.cont}` : ''}`);
    }, 'ls-hint');
    const refresh = () => {
      $('ls-count').textContent = c.curves.length;
      $('ls-loop').setAttribute('aria-pressed', String(c.loop));
      $('ls-loop').disabled = c.curves.length < 3;
      $('ls-simplify').setAttribute('aria-pressed', String(c.simplify));
      $('ls-edges-row').hidden = !twoEdges();
      for (const b of $$('[data-lscont]')) b.setAttribute('aria-pressed', String(b.dataset.lscont === c.cont));
      if (c.curves.length < 2) { clearPreview(); $('ls-hint').textContent = 'SELECT TWO CURVES OR MORE, IN ORDER'; return setState('none'); }
      c.preview();
    };
    c.onSelection = () => {
      drawOverlays();
      const now = [...sel.curves.filter(curveById), ...sel.list('edge').map(e => ({ key: `${e.body}:${e.n}`, body: e.body, n: e.n }))];
      const same = (a, b) => typeof a === 'object' ? typeof b === 'object' && a.key === b.key : a === b;
      // Keep the order the profiles were picked in; new ones go on the end.
      c.curves = [...c.curves.filter(p => now.some(q => same(p, q))), ...now.filter(q => !c.curves.some(p => same(p, q)))];
      if (c.curves.length < 3) c.loop = false;
      for (const id of c.limits.keys()) if (!c.curves.includes(id)) c.limits.delete(id);
      showLimits();
      refresh();
    };
    c.refresh = () => refresh();
    c.setCont = g => { c.cont = g; refresh(); };
    c.key = action => {
      if (action === 'simplify') { c.simplify = !c.simplify; refresh(); return true; }
      if (action === 'continuity') {
        if (!twoEdges()) return toast('CONTINUITY IS FOR TWO EDGES'), true;
        c.setCont({ G0: 'G1', G1: 'G2', G2: 'G0' }[c.cont]);
        return true;
      }
      if (action === 'tension') { $('ls-t').focus(); $('ls-t').select(); return true; }
      if (action === 'limit') {
        c.picking = !c.picking;
        showLimits();
        setHud(c.picking ? 'CLICK A PROFILE CURVE FOR A LIMIT POINT; CLICK ONE AGAIN TO REVERSE IT' : 'LOFT · SHEET');
        return true;
      }
      if (action !== 'loop') return false;
      if (c.curves.length < 3) return toast('A LOOP NEEDS THREE CURVES OR MORE'), true;
      c.loop = !c.loop;
      refresh();
      return true;
    };
    c.click = e => {
      const hit = pickAt(e);
      if (c.picking) {
        if (!hit?.point || (hit.kind !== 'curve' && hit.kind !== 'region')) return true;
        if (!c.curves.includes(hit.id)) return toast('CLICK ONE OF THE PROFILE CURVES'), true;
        const f = curveFrame(curveById(hit.id)), d = hit.point.clone().sub(f.o), at = [d.dot(f.x), d.dot(f.y)];
        const l = c.limits.get(hit.id) ?? { pts: [], flip: false };
        const reach = unitsPerPixel(controls.target) * 10;
        if (l.pts.some(q => Math.hypot(q[0] - at[0], q[1] - at[1]) < reach)) l.flip = !l.flip;
        else if (l.pts.length >= 2) return toast('UP TO TWO LIMIT POINTS ON EACH CURVE'), true;
        else l.pts.push(at);
        c.limits.set(hit.id, l);
        showLimits();
        refresh();
        return true;
      }
      if (hit?.kind === 'curve') sel.toggle({ kind: 'curve', id: hit.id });
      else if (hit?.kind === 'edge') sel.toggle({ kind: 'edge', body: hit.body, n: hit.n });
      else return true;
      selectionChanged();
      return true;
    };
    c.finish = async () => {
      if (c.curves.length < 2) { setState('failed'); return toast('SELECT TWO CURVES OR MORE, IN ORDER, TO LOFT'); }
      try {
        const { id, scene } = smooth()
          ? await (async () => { const { ids, scene } = await backend.commitSplineSheet({ data: c.data ?? splineSheetData(await fitEdges()) }); return { id: ids[0], scene }; })()
          : await backend.commitLoftSheet(await request());
        record(`LOFT ×${c.curves.length}${c.loop ? ' LOOP' : ''}`, id);
        endCmd('committed');
        await showScene(scene);
        sel.clear();
        sel.add({ kind: 'solid', body: id });
        selectionChanged({ quiet: true });
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => { clearPreview(); for (const o of [...limitMarks.children]) dispose(o); };
    showLimits();
    refresh();
  }

  function startForm(id) {
    // Curves or edges (not regions) selected: Loft makes a sheet through them.
    if (id === 'loft' && (sel.list('curve').length || sel.list('edge').length)) {
      startLoftSheet([]);
      return cmd?.onSelection?.();
    }
    const regions = sel.list('region').map(it => it.id).filter(rid => curveList.some(c => c.id === rid && isClosed(c)));
    if (!backend.previewForm) return toast(`${toolInfo(id).label} IS NOT IN THIS BUILD YET`);
    if (!regions.length || (id === 'loft' && regions.length < 2)) return toast(id === 'loft' ? 'SELECT TWO REGIONS OR MORE, IN ORDER, TO LOFT' : `SELECT A REGION TO ${toolInfo(id).label}`);
    const first = curveList.find(c => c.id === regions[0]);
    const target = bodyAt(regionCentre(first), curveFrame(first).n);
    const c = cmd = { id, regions: id === 'loft' ? regions : regions.slice(0, 1), target, op: 'new', angle: 360, thickness: 0, twist: 0, scale: 1, p1: null, p2: null, path: null, guides: [], method: 'point', align: 'normal', corner: 'mitre', outcome: null, sent: 0, shown: 0, line: null };
    lastTool = id;
    showTool(id);
    setState('none');
    setTarget(target ? label(target) : 'NEW BODY');
    $('form-angle-row').hidden = $('form-thickness-row').hidden = id !== 'revolve';
    $('form-twist-row').hidden = $('form-scale-row').hidden = id !== 'sweep';
    $('form-ops').hidden = id === 'loft';
    $('form-guides-row').hidden = id === 'revolve';
    $('form-method-row').hidden = $('form-align-row').hidden = $('form-corner-row').hidden = id !== 'sweep';
    setGuideChips(c);
    $('form-angle').value = c.angle; $('form-thickness').value = c.thickness; $('form-twist').value = c.twist; $('form-scale').value = c.scale;
    $('form-outcome').textContent = '—';
    setFormOps();
    const hint = () => {
      const guides = c.guides.length ? ` · GUIDES ${c.guides.map(g => g.key ? `${label(g.body)} EDGE ${g.n + 1}` : curveLabel(g)).join(', ')}` : '';
      const text = id === 'loft' ? `${c.regions.map(r => curveLabel(r)).join(' → ')}${guides || ' · CLICK GUIDES (OPTIONAL)'}`
        : id === 'revolve' ? (!c.p1 ? 'CLICK THE AXIS START' : !c.p2 ? 'CLICK THE AXIS END' : `${c.angle}° ABOUT THE AXIS${c.thickness ? ` · WALLS ${c.thickness}` : ''}`)
        : !c.path ? 'CLICK THE CURVE TO SWEEP ALONG' : `ALONG ${curveLabel(c.path)}${guides || ' · CLICK GUIDES (OPTIONAL, UP TO TWO)'}`;
      $('form-guides').textContent = c.guides.length;
      $('form-hint').textContent = text;
      setHud(text);
    };
    c.hint = hint;
    c.onSelection = () => drawOverlays();
    c.key = action => {
      if (action === 'angle' && id === 'revolve') {
        c.entry = { label: 'ANGLE °', text: '', apply: v => { if (v !== 0) setForm({ angle: v }); } };
        setHud('ANGLE ° _');
        return true;
      }
      if (action === 'thickness' && id === 'revolve') {
        c.entry = { label: 'THICKNESS', text: '', apply: v => setForm({ thickness: Math.abs(v) }) };
        setHud('THICKNESS _');
        return true;
      }
      if (action === 'method' && id === 'sweep') {
        const all = ['point', 'chord', 'curve'];
        setForm({ method: all[(all.indexOf(c.method) + 1) % all.length] });
        setGuideChips(c);
        return true;
      }
      if (action === 'align' && id === 'sweep') {
        setForm({ align: c.align === 'normal' ? 'parallel' : 'normal' });
        setGuideChips(c);
        return true;
      }
      if (action === 'twist' && id === 'sweep') {
        c.entry = { label: 'TWIST °', text: '', apply: v => setForm({ twist: v }) };
        setHud('TWIST ° _');
        return true;
      }
      if (!FOPS.includes(action) || id === 'loft') return false;
      c.op = action === c.op || action === 'new' ? 'new' : action;
      setFormOps();
      previewFormCmd();
      return true;
    };
    c.entryDone = () => { if (!c.entry) previewFormCmd(); };
    c.click = e => {
      if (id === 'revolve' && !c.p2) {
        const p = axisPointAt(e);
        if (!p) return true;
        if (!c.p1) { c.p1 = p; c.line = axisLine(); }
        else if (p.distanceTo(c.p1) > 1e-6) { c.p2 = p; c.move = null; updateAxisLine(c.p2); }
        hint();
        previewFormCmd();
        return true;
      }
      // Loft: each click on another curve adds it as a guide, or takes it off again. Sweep: the
      // first click picks the path, later ones its guides (past two the sections bend onto the rest).
      // A body edge can be a guide too (not a path): it goes as a curve through points along it.
      let picked = curveAt(e);
      if (picked === null && (id === 'loft' || (id === 'sweep' && c.path !== null))) {
        const hit = pickAt(e);
        if (hit?.kind === 'edge') {
          const key = `${hit.body}:${hit.n}`;
          picked = c.guides.find(g => g.key === key) ?? { key, body: hit.body, n: hit.n };
          if (!picked.curve) {
            const ask = picked;
            backend.edgeCurvature({ body: hit.body, edge: hit.n, n: 64 }).then(teeth => {
              ask.curve = curveFromNurbs(smoothThrough(teeth.map(t => t.at), false), [0, -1, 0]);
              if (cmd === c && c.guides.includes(ask)) previewFormCmd();
            }).catch(err => toast(say(err)));
          }
        }
      }
      if (picked === null || c.regions.includes(picked)) return true;
      if (id === 'sweep' && (c.path === null || picked === c.path)) c.path = picked;
      else if (id === 'sweep') c.guides = c.guides.includes(picked) ? c.guides.filter(g => g !== picked) : [...c.guides, picked];
      else if (id === 'loft') c.guides = c.guides.includes(picked) ? c.guides.filter(g => g !== picked) : [...c.guides, picked];
      hint();
      previewFormCmd();
      return true;
    };
    if (id === 'revolve') c.move = e => {
      if (!c.p1 || c.p2) return;
      const p = axisPointAt(e);
      if (!p || p.distanceTo(c.p1) < 1e-6) return;
      updateAxisLine(p);
      c.moving = p;
      previewFormCmd();
    };
    c.finish = () => commitFormCmd();
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => { if (c.line) dispose(c.line); clearPreview(); };
    hint();
    if (id === 'loft') previewFormCmd();
  }
  function setGuideChips(c) {
    for (const b of $$('[data-gmethod]')) b.setAttribute('aria-pressed', String(c.method === b.dataset.gmethod));
    for (const b of $$('[data-galign]')) b.setAttribute('aria-pressed', String(c.align === b.dataset.galign));
    for (const b of $$('[data-gcorner]')) b.setAttribute('aria-pressed', String(c.corner === b.dataset.gcorner));
  }
  function setFormOps() { for (const b of $$('[data-fop]')) b.setAttribute('aria-pressed', !!FORMS[cmd?.id] && cmd.op === b.dataset.fop); }
  function setForm(values) {
    const c = cmd;
    if (!FORMS[c?.id]) return;
    Object.assign(c, values);
    for (const k of ['angle', 'thickness', 'twist', 'scale']) if (document.activeElement !== $(`form-${k}`)) $(`form-${k}`).value = c[k];
    c.hint();
    previewFormCmd();
  }
  /** A point for the revolve axis: on a face or the construction plane, snapping like a sketch. */
  function axisPointAt(e) {
    const h = placeAt(e);
    if (h && !h.curved) return h.origin.clone();
    return pickAt(e)?.point?.clone() ?? null;
  }
  function axisLine() {
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([cmd.p1, cmd.p1]), new THREE.LineBasicMaterial({ color: COLORS.accent, depthTest: false }));
    l.renderOrder = 20;
    scene.add(l);
    return l;
  }
  function updateAxisLine(p) {
    const c = cmd;
    if (!c.line) return;
    // Drawn a little past both ends, like an axis.
    const d = p.clone().sub(c.p1), ext = Math.max(d.length() * 0.25, 5);
    d.normalize();
    c.line.geometry.setFromPoints([c.p1.clone().addScaledVector(d, -ext), p.clone().addScaledVector(d, ext)]);
  }
  /** The drawn curve under the pointer, whatever the selection modes, or null. */
  /** Loft and Sweep guides as the backends take them: drawn curves by id, edges as their curves (once read). */
  function guideRequest(c) { return c.guides.filter(g => !g.key || g.curve).map(g => g.key ? g.curve : g); }
  function curveAt(e) {
    ray(e);
    raycaster.params.Line.threshold = unitsPerPixel(controls.target) * 6;
    const h = raycaster.intersectObjects(curveGroup.children.filter(o => o.userData.curve !== undefined), false)[0];
    return h ? h.object.userData.curve : null;
  }
  function formRequest(c) {
    const req = { target: c.target, regions: c.regions, kind: c.id, op: c.op };
    if (c.id === 'revolve') {
      const p2 = c.p2 ?? c.moving;
      if (!c.p1 || !p2) return null;
      Object.assign(req, { axisPoint: c.p1.toArray(), axisDir: p2.clone().sub(c.p1).toArray(), angle: c.angle * DEG, thickness: c.thickness });
    }
    if (c.id === 'sweep') {
      if (c.path === null) return null;
      Object.assign(req, { path: c.path, twist: c.twist * DEG, scale: c.scale, guides: guideRequest(c), method: c.method, align: c.align, corner: c.corner });
    }
    if (c.id === 'loft') req.guides = guideRequest(c);
    return req;
  }
  async function previewFormCmd() {
    const c = cmd;
    if (!FORMS[c?.id]) return;
    const req = formRequest(c);
    const n = ++c.sent;
    if (!req) { clearPreview(); setState('none'); return; }
    setState('updating');
    const t0 = performance.now();
    let p;
    try { p = await backend.previewForm(req); }
    catch (e) {
      if (cmd !== c || n !== c.sent) return;
      clearPreview();
      setState('failed');
      $('form-outcome').textContent = 'FAILED';
      return setHud(say(e));
    }
    if (!p || cmd !== c || n < c.shown) return;
    c.shown = n;
    c.outcome = p.outcome;
    $('ms').textContent = Math.round(performance.now() - t0);
    clearPreview();
    if (p.result) showPreviewBody(p.result);
    if (p.tool) {
      const look = phantom[p.outcome === 'cut' ? 'cut' : 'add'];
      const m = meshOf(p.tool, look.face, look.edge);
      m.renderOrder = 5;
      previewGroup.add(m);
    }
    $('form-outcome').textContent = p.outcome.toUpperCase();
    if (n === c.sent) setState('updated');
  }
  async function commitFormCmd() {
    const c = cmd;
    const req = formRequest(c);
    if (!req) return endCmd('cancelled');
    try {
      const { id, scene: list } = await backend.commitForm(req);
      endCmd('committed');
      const what = c.id === 'revolve' ? `REVOLVE ${c.angle}°${c.thickness ? ` T ${c.thickness}` : ''}` : c.id === 'loft' ? `LOFT ×${c.regions.length}${c.guides.length ? ` · ${c.guides.length} GUIDES` : ''}` : `SWEEP${c.twist ? ` ${c.twist}°` : ''}${c.scale !== 1 ? ` ×${c.scale}` : ''}${c.guides.length ? ` · ${c.guides.length === 2 ? '2 GUIDES' : 'GUIDE'} ${c.method.toUpperCase()}` : ''}${c.align === 'parallel' ? ' · PARALLEL' : ''}${c.corner === 'round' ? ' · ROUND' : ''}`;
      record(`${what}${req.op === 'new' ? '' : ` ${req.op.toUpperCase()}`}`, id);
      await showScene(list);
      sel.replace({ kind: 'solid', body: id });
      selectionChanged({ quiet: true });
    } catch (e) { setState('failed'); toast(say(e)); }
  }

  // --- actions without a command --------------------------------------------
  async function step(dir) {
    if (cmd) abort();
    if (dir === 'undo' && undone >= history.length) return;
    if (dir === 'redo' && undone === 0) return;
    showScene(await backend[dir]());
    undone += dir === 'undo' ? 1 : -1;
    renderHistory();
  }
  async function deleteSelected() {
    if (cmd) await finish();
    const ids = sel.solids, curves = sel.curves;
    // Delete Control Point: picked vertices go from their curves (curveEdit.js deleteVertices).
    const verts = sel.list('vertex').filter(v => curveById(v.id));
    if (!ids.length && !curves.length && verts.length) {
      if (!backend.replaceCurves) return toast('DELETING POINTS IS NOT IN THIS BUILD YET');
      const byCurve = new Map();
      for (const v of verts) { if (!byCurve.has(v.id)) byCurve.set(v.id, []); byCurve.get(v.id).push(v.n); }
      try {
        const out = [...byCurve].map(([id, ns]) => deleteVertices(curveById(id), ns));
        await backend.replaceCurves([...byCurve.keys()], out);
        record(`DELETE ${verts.length} POINT${verts.length > 1 ? 'S' : ''}`, [...byCurve.keys()][0], curveLabel([...byCurve.keys()][0]));
        sel.clear();
        await loadCurves();
        selectionChanged({ quiet: true });
      } catch (e) { toast(say(e)); }
      return;
    }
    if (!ids.length && !curves.length) return toast(sel.size ? 'DELETE WORKS ON SOLIDS, CURVES AND CURVE POINTS FOR NOW' : 'SELECT SOMETHING TO DELETE');
    try {
      const list = backend.deleteItems ? await backend.deleteItems(ids, curves) : await backend.deleteBodies(ids);
      const names = [...ids.map(label), ...curves.map(curveLabel)];
      record(`DELETE ${names.join(' ')}`, ids[0] ?? curves[0], names[0]);
      sel.clear();
      await showScene(list);
    } catch (e) { toast(say(e)); }
  }
  /**
   * Plasticity's Join (J): the selected curves that meet end to end become one, which bounds a
   * region when it closes; selected sheets that meet edge to edge become one body, a solid when
   * they close.
   */
  async function joinSelected() {
    if (cmd) await finish();
    const sheets = sel.solids.filter(id => current.find(b => b.id === id)?.sheet);
    if (!sel.curves.length && sel.solids.length > 1) {
      if (sheets.length !== sel.solids.length) return toast('JOIN SHEETS; USE BOOLEAN TO JOIN SOLIDS');
      if (!backend.commitJoinSheets) return toast('JOINING SHEETS IS NOT IN THIS BUILD YET');
      try {
        const { id, scene: list } = await backend.commitJoinSheets({ bodies: sheets });
        record(`JOIN ${sheets.map(label).join(' ')}`, id);
        await showScene(list);
        sel.replace({ kind: 'solid', body: id });
        selectionChanged({ quiet: true });
      } catch (e) { toast(say(e)); }
      return;
    }
    const ids = sel.curves;
    if (ids.length < 2) return toast('SELECT TWO CURVES OR MORE TO JOIN');
    if (!backend.joinCurves) return toast('JOIN IS NOT IN THIS BUILD YET');
    try {
      const { ids: joined } = await backend.joinCurves(ids);
      record(`JOIN ${ids.map(curveLabel).join(' ')}`, joined[0], curveLabel(joined[0]));
      sel.clear();
      await loadCurves();
      for (const id of joined) sel.add({ kind: curveList.find(c => c.id === id && isClosed(c)) ? 'region' : 'curve', id });
      selectionChanged({ quiet: true });
    } catch (e) { toast(say(e)); }
  }
  /** Plasticity's Unjoin: the selected body taken apart into its faces (as sheets) or its separate pieces. */
  async function unjoinSelected(faces) {
    if (cmd) await finish();
    const ids = targetBodies();
    if (ids.length !== 1) return toast(ids.length ? 'UNJOIN ONE BODY AT A TIME' : 'SELECT A BODY TO UNJOIN');
    if (!backend.commitUnjoin) return toast('UNJOIN IS NOT IN THIS BUILD YET');
    try {
      const { ids: pieces, scene: list } = await backend.commitUnjoin({ body: ids[0], faces });
      record(`UNJOIN ${faces ? 'FACES' : 'SHELLS'} ${label(ids[0])} ×${pieces.length}`, pieces[0]);
      await showScene(list);
      sel.clear();
      for (const id of pieces) sel.add({ kind: 'solid', body: id });
      selectionChanged({ quiet: true });
    } catch (e) { toast(say(e)); }
  }
  /** Plasticity's Shift+D: copy, select the copies, and move them with the cursor. */
  async function duplicateSelected() {
    if (cmd) await finish();
    const ids = targetBodies();
    if (!ids.length) return toast('SELECT A SOLID TO DUPLICATE');
    try {
      const { ids: copies, scene: list } = await backend.duplicateBodies(ids);
      record(`DUPLICATE ${ids.map(label).join(' ')}`, copies[0]);
      sel.clear();
      for (const id of copies) sel.add({ kind: 'solid', body: id });
      showScene(list);
      startTransform('move', { follow: 'screen' });
    } catch (e) { toast(say(e)); }
  }
  /**
   * Plasticity's Alternative Duplicate / Duplicate Curve and Project (Alt+D): the selected curves and
   * edges copied flat onto the construction plane as new curves, then the Move gizmo to place them.
   */
  async function altDuplicate() {
    if (cmd) await finish();
    if (!backend.addCurves) return toast('DRAWING IS NOT IN THIS BUILD YET');
    const plane = { origin: cplane.origin.toArray(), x: frameFor(cplane.normal).toArray(), normal: cplane.normal.toArray() };
    const out = [];
    for (const id of sel.curves.filter(curveById)) {
      const src = curveById(id), f = curveFrame(src);
      out.push(flattenCurve(src, plane, curve2d(src).map(p => lift(f, p).toArray())));
    }
    for (const e of sel.list('edge')) {
      const xyz = bodyOf(e.body)?.edges[e.n];
      if (!xyz) continue;
      const pts = [];
      for (let i = 0; i + 2 < xyz.length; i += 3) pts.push([xyz[i], xyz[i + 1], xyz[i + 2]]);
      out.push(edgeCurve(pts, plane));
    }
    const made = out.filter(Boolean);
    if (!made.length) return toast(out.length ? 'NOTHING TO COPY: THOSE RUN STRAIGHT DOWN ONTO THE PLANE' : 'SELECT CURVES OR EDGES TO DUPLICATE ONTO THE PLANE');
    try {
      const { ids } = await backend.addCurves(made);
      record(`ALTERNATIVE DUPLICATE ×${ids.length} ONTO ${cplane.name}`, ids[0], curveLabel(ids[0]));
      await curvesChanged(ids);
      startTransform('move');
    } catch (e) { setState('failed'); toast(say(e)); }
  }
  /**
   * Plasticity's Create Outline: the selected solids' and sheets' outline seen along the construction
   * plane's normal, as 3D curves on the bodies (Project Outline's flat outline lifted back onto each
   * body), then the Move gizmo to place them.
   */
  async function createOutline() {
    if (cmd) await finish();
    if (!backend.previewProject || !backend.addCurves) return toast('CREATE OUTLINE IS NOT IN THIS BUILD YET');
    const ids = targetBodies().filter(b => org.shows(b));
    if (!ids.length) return toast('SELECT SOLIDS OR SHEETS TO OUTLINE');
    const normal = cplane.normal.toArray(), made = [];
    try {
      for (const id of ids) {
        const flat = await backend.previewProject({ mode: 'outline', body: id, origin: cplane.origin.toArray(), normal });
        const b = bodyOf(id), mesh = bodyMesh(id), size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()).length();
        const edges = (b?.edges ?? []).map(e => { const pts = []; for (let i = 0; i + 2 < e.length; i += 3) pts.push([e[i], e[i + 1], e[i + 2]]); return pts; });
        // The body's point over P: on the viewport mesh's silhouette seen along the normal.
        const tris = [];
        mesh.updateMatrixWorld();
        mesh.traverse(o => {
          if (!o.isMesh) return;
          const at = o.geometry.getAttribute('position'), ix = o.geometry.getIndex(), v = new THREE.Vector3();
          const n = ix ? ix.count : at.count;
          for (let i = 0; i < n; i++) { v.fromBufferAttribute(at, ix ? ix.getX(i) : i).applyMatrix4(o.matrixWorld); tris.push(v.x, v.y, v.z); }
        });
        const tol = Math.max(1e-3, size * 2e-4), rim = meshSilhouette(tris, normal, tol / 10);
        const cast = P => nearestOver(P, rim, normal, tol, size * 0.05);
        for (const piece of flat) made.push(...liftPiece(piece, { normal, edges, cast, tol, loose: size * 0.01 }));
      }
      if (!made.length) return toast('NO OUTLINE LIES ON THOSE BODIES');
      const { ids: curves } = await backend.addCurves(made);
      record(`CREATE OUTLINE ×${curves.length} ALONG ${cplane.name} NORMAL`, curves[0], curveLabel(curves[0]));
      await curvesChanged(curves);
      startTransform('move');
    } catch (e) { setState('failed'); toast(say(e)); }
  }
  function setHidden(ids, hide) {
    org.setHidden(ids, hide);
    organised();
  }
  /** After a change to what shows or locks: the viewport, the selection (nothing hidden or locked stays picked) and the outliner. */
  function organised() {
    for (const it of sel.list()) if (it.body !== undefined && !org.picks(it.body)) sel.remove(it);
    for (const m of bodies.children) m.visible = org.shows(m.userData.id);
    renderIsolated();
    selectionChanged({ quiet: true });
    bridgeOutline();
  }
  /** Tell the bridges (Blender, Cinema 4D) the scene changed, with its document name and groups. */
  function bridgeOutline() {
    if (!backend.sceneChanged) return;
    const document = $('file-name').textContent.replace(/\.W3D$/i, '');
    backend.sceneChanged({ document, objects: org.outline(current.map(b => b.id)) }).then(showBridge, () => {});
  }
  function renderIsolated() {
    const n = org.isolated, b = $('isolated');
    b.hidden = !n;
    b.querySelector('span').textContent = `${n} ISOLATED`;
  }
  function isolateSelected() {
    const ids = sel.bodies.filter(id => org.shows(id));
    if (!ids.length && !org.layers.length) return toast('SELECT WHAT TO ISOLATE');
    org.isolate(ids);
    organised();
  }
  function groupSelected() {
    const g = org.makeGroup(sel.bodies);
    if (!g) return toast('SELECT BODIES TO GROUP');
    toast(`${g.name} · ${sel.bodies.length} BODIES`);
    renderOutliner();
  }
  function ungroupSelected() {
    if (!org.ungroup(sel.bodies)) return toast('NOTHING SELECTED IS IN A GROUP');
    renderOutliner();
  }
  function lockSelected() {
    if (!sel.bodies.length) return toast('SELECT BODIES TO LOCK');
    org.setLocked(sel.bodies, true);
    organised();
  }
  async function exportSelected() {
    const ids = sel.bodies.length ? sel.bodies : current.map(b => b.id);
    // With nothing selected, each shown solid instance goes too, as its master where it stands.
    const jobs = [...ids.map(id => [id, {}]), ...(sel.bodies.length ? [] : placedSolids().map(({ n }) => [n.master, { motion: motionOf(n), mirror: n.mirror ?? null, name: `instance-${n.id}` }]))];
    for (const [id, opts] of jobs) {
      try { const msg = await backend.exportStep(id, opts); if (!msg) return; toast(msg); }
      catch (e) { toast(say(e)); }
    }
  }

  function renderModes() {
    const all = ['point', 'edge', 'face', 'solid'].every(k => sel.allows(k));
    for (const b of $$('[data-mode]')) b.setAttribute('aria-pressed', b.dataset.mode === 'all' ? all : sel.allows(b.dataset.mode));
    paintVertices();
  }

  /** Run a named action (keymap.js); returns false for names it doesn't know. */
  async function doAction(a) {
    const [kind, arg] = a.split(':');
    if (!['select', 'view', 'plane', 'sources', 'sidebar', 'grid', 'snap', 'constraints', 'overlays', 'undo', 'redo', 'app', 'radial'].includes(kind)) keepSources();
    switch (kind) {
      case 'sources': selectSources(arg === 'forward' ? 1 : -1); return true;
      case 'constraints':
        // Remove constraints: the bridges stay as they are and no longer follow their curves.
        toast(constraints.list.length ? `${constraints.list.length} CONSTRAINT${constraints.list.length > 1 ? 'S' : ''} REMOVED` : 'NO CONSTRAINTS');
        constraints.clear();
        return true;
      case 'snap':
        // Plasticity's palette command Toggle object snapping (no key by default).
        setSnaps({ ...snapSettings, on: !snapSettings.on });
        toast(snapSettings.on ? 'OBJECT SNAPPING ON' : 'OBJECT SNAPPING OFF');
        return true;
      case 'grid':
        // Plasticity's palette commands: Grid: increase / decrease grid size, toggle grid snapping.
        if (arg === 'snap') { view.snap = !view.snap; applyView(); snapsFor(view.snap); toast(view.snap ? 'GRID SNAPPING ON' : 'GRID SNAPPING OFF (CTRL SNAPS)'); }
        else { setGrid(arg === 'inc' ? 1 : -1); toast(`GRID ${gridStep()} MM`); }
        return true;
      case 'overlays': {
        // Alt+Shift+Z: the grid, navigation cube and key hints off or on, to look at the model alone.
        const off = !overlaysOff;
        overlaysOff = off;
        grid.visible = !off;
        for (const id of ['nav', 'keys']) $(id).style.visibility = off ? 'hidden' : '';
        return true;
      }
      case 'sidebar': {
        // Plasticity: Ctrl+B shows or hides the left sidebar, Ctrl+Shift+B the right one.
        const shell = root.querySelector('.w3d'), cls = arg === 'right' ? 'no-right' : 'no-left';
        shell.classList.toggle(cls);
        return true;
      }
      case 'view':
        if (arg === 'radial') openRadial(a.split(':')[2]);
        else if (arg === 'ortho') setOrtho(!camera.isOrthographicCamera);
        else if (arg === 'home') setView('iso');
        else if (arg === 'focus') focus();
        else if (arg === 'xray') { view.xray = !view.xray; applyView(); }
        else if (arg === 'curvature') { view.curvature = !view.curvature; applyView(); renderOutliner(); }
        else if (arg === 'surface-curvature') await toggleSurfaceCurvature();
        else if (arg === 'zebra' || arg === 'draft') { view.shader = view.shader === (arg === 'zebra' ? 'zebra-v' : 'draft') ? 'ceramic-dark' : arg === 'zebra' ? 'zebra-v' : 'draft'; view.render = false; applyView(); }
        else if (arg === 'render') { view.render = !view.render; applyView(); }
        else if (arg === 'edges' || arg === 'faces' || arg === 'curves') { view[arg] = !view[arg]; applyView(); }
        else setView(arg);
        return true;
      case 'mode': sel.setMode(arg); renderModes(); hover = null; drawOverlays(); return true;
      case 'mode-toggle': sel.toggleMode(arg); renderModes(); return true;
      case 'convert': sel.convert(arg, current); renderModes(); selectionChanged({ quiet: true }); return true;
      case 'select':
        if (arg === 'none') { if (cmd) abort(); sel.clear(); }
        else if (arg === 'all') sel.selectAll(current.filter(b => org.picks(b.id)));
        // Plasticity's Select All Solids / Sheets / Measurements: every visible one, in groups too.
        else if (arg === 'solids' || arg === 'sheets') {
          sel.clear();
          for (const b of current) if (org.picks(b.id) && !!b.sheet === (arg === 'sheets')) sel.add({ kind: 'solid', body: b.id });
          if (!sel.size) toast(`NO ${arg.toUpperCase()} TO SELECT`);
        } else if (arg === 'curves') {
          // Plasticity's Select All Curves: every curve in the viewport.
          sel.clear();
          if (curveGroup.visible) for (const o of curveGroup.children) if (o.visible && o.userData.curve !== undefined) sel.add({ kind: 'curve', id: o.userData.curve });
          if (!sel.size) toast('NO CURVES TO SELECT');
        } else if (arg === 'measurements') {
          sel.clear();
          for (const c of surfaceCombs) if (!c.hidden && org.shows(c.body)) sel.add(c.face === undefined ? { kind: 'edge', body: c.body, n: c.n } : { kind: 'face', body: c.body, n: c.face });
          if (!sel.size) toast('NO MEASUREMENTS TO SELECT');
        }
        else if (arg === 'adjacent') {
          // Faces gain the faces beside them, edges the edges at their corners, on each body.
          for (const kind of ['face', 'edge']) for (const [body, ns] of kind === 'face' ? sel.facesByBody() : sel.edgesByBody()) {
            const b = bodyOf(body);
            if (b) for (const n of adjacent(b, kind, ns, topologyOf(b))) sel.add({ kind, body, n });
          }
        }
        else sel.invert(current.filter(b => org.picks(b.id)));
        selectionChanged({ quiet: !['all', 'invert', 'solids', 'sheets', 'measurements', 'adjacent'].includes(arg) });
        return true;
      case 'tool': case 'draw': await startTool(arg); return true;
      case 'plane':
        if (arg === 'selection') planeFromSelection(true);
        else if (arg === 'selection-keep-view') planeFromSelection(false);
        else if (arg === 'view') planeFromView();
        else if (arg === 'view-at') planeFromViewAt();
        else if (arg === 'save') savePlane();
        else setPlane({ origin: new THREE.Vector3(), normal: UP, name: 'XY' });
        return true;
      case 'radial': openRadial(arg); return true;
      case 'app':
        if (arg === 'preferences') openPrefs();
        else if (arg === 'quit') { if (backend.quit) backend.quit(); else toast('CLOSE THE TAB TO QUIT'); }
        else openPMenu();
        return true;
      case 'file': {
        if (arg === 'recent') { openPMenu(); return true; }
        // A second window with a document of its own (the desktop starts another copy of the app).
        if (arg === 'new-window') {
          if (backend.newWindow) await backend.newWindow().catch(e => toast(say(e)));
          else window.open(location.href.split('#')[0], '_blank');
          return true;
        }
        if (arg === 'export') { openPalette(false, 'EXPORT'); return true; }
        if (arg === 'save-startup' || arg === 'reset-startup') {
          const fn = backend[arg === 'save-startup' ? 'saveStartupScene' : 'resetStartupScene'];
          if (!fn) { toast('NOT IN THE BROWSER YET'); return true; }
          await fileAction(async () => {
            if (arg === 'save-startup') { await keepAppState(); await fn.call(backend); toast('NEW FILES START FROM THIS SCENE'); }
            else toast(await fn.call(backend) ? 'NEW FILES START FROM THE DEFAULT SCENE' : 'NO STARTUP SCENE SAVED');
          });
          return true;
        }
        if (arg === 'save-as' || arg === 'save-version') {
          const fn = backend[arg === 'save-as' ? 'saveAs' : 'saveVersion'];
          if (!fn) { toast('NOT IN THE BROWSER YET'); return true; }
          await fileAction(async () => {
            await keepAppState();
            const name = await fn.call(backend);
            if (!name) return;
            if (arg === 'save-as') $('file-name').textContent = name.toUpperCase();
            remember(backend.filePath);
            toast(`SAVED ${name.toUpperCase()}`);
          });
          return true;
        }
        const b = $({ new: 'file-new', open: 'file-open', save: 'file-save' }[arg]);
        if (b.hidden) toast('NOT IN THE BROWSER YET'); else b.click();
        return true;
      }
      case 'export': if (arg === 'mesh' || arg === 'drawing') await startTool(`export-${arg}`); else exportSelected(); return true;
      case 'import': $('import').hidden ? toast('NOT IN THE BROWSER YET') : $('import').click(); return true;
      // Unjoin Curve (Alt+J), and Unjoin with only curves selected: joined curves back into the
      // curves they were joined from (as Explode does here: a contour's pieces, a polyline's lines).
      case 'unjoin': await (arg === 'curves' || (!targetBodies().length && sel.curves.some(curveById)) ? explodeSelected('UNJOIN') : unjoinSelected(arg !== 'pieces')); return true;
      case 'material': if (arg === 'remove') removeMaterial(); else await startTool('material'); return true;
    }
    switch (a) {
      case 'palette': openPalette(false); return true;
      case 'ask': openAsk(); return true;
      case 'suggest': openPalette(true); return true;
      case 'repeat': if (lastTool) await startTool(lastTool); else toast('NO COMMAND TO REPEAT'); return true;
      case 'delete': await deleteSelected(); return true;
      case 'duplicate': await duplicateSelected(); return true;
      case 'alt-duplicate': await altDuplicate(); return true;
      case 'create-outline': await createOutline(); return true;
      case 'toggle-points': await togglePoints(); return true;
      case 'create-instance': await createInstances(); return true;
      case 'cut-curve': if (cmd) await finish(); startCutCurve(); return true;
      case 'bridge-edge': await startBridgeEdge(); return true;
      case 'align-surface': await startAlignSurface(); return true;
      case 'project-align': await startProjectAlign(); return true;
      case 'constrained-surface': if (cmd) await finish(); startConstrainedSurface(); return true;
      case 'square': await startSquare(); return true;
      case 'xnurbs': await startSquare({ xnurbs: true }); return true;
      case 'realize-instance': if (cmd?.id === 'instance') await cmd.realize(); else toast('CLICK AN INSTANCE, THEN REALIZE IT'); return true;
      case 'join': await joinSelected(); return true;
      case 'trim': await startTool('trim'); return true;
      case 'extend': await startTool('extend'); return true;
      case 'split': await startTool('split'); return true;
      case 'measure': await startTool(arg === 'radius' ? 'measure-radius' : arg === 'continuity' ? 'measure-continuity' : 'measure-distance'); return true;
      case 'explode': await explodeSelected(); return true;
      case 'reverse': await reverseSelected(); return true;
      case 'align-vertex': await startAlignVertex(); return true;
      case 'align-curve': await startAlignCurve(); return true;
      case 'rebuild': await startRebuild(); return true;
      case 'raise-degree': await raiseSelected(); return true;
      case 'subdivide': await subdivideSelected(); return true;
      case 'complete-edge': await completeSelected(); return true;
      case 'convert-vertex': await convertSelected(); return true;
      case 'unify': await unifySelected(); return true;
      case 'boundary-edges': await findBoundaryEdges(); return true;
      case 'remove-fillets': await removeFillets(); return true;
      case 'isoparam': if (cmd) await finish(); startIsoparam(); return true;
      case 'match-face': if (cmd) await finish(); startMatchFace(); return true;
      case 'untrim': if (cmd) await finish(); startUntrim(); return true;
      case 'deform-curve': if (cmd) await finish(); startDeformCurve(); return true;
      case 'unwrap': if (cmd) await finish(); startUnwrap(); return true;
      case 'dimension': if (cmd) await finish(); await startDimension(); return true;
      case 'place': if (cmd) await finish(); startPlace(); return true;
      case 'copy-place': if (cmd) await finish(); startPlace({ mode: 'copy' }); return true;
      case 'paste-place': if (cmd) await finish(); startPlace({ mode: 'paste' }); return true;
      case 'text': if (cmd) await finish(); startText(); return true;
      case 'slide': if (cmd) await finish(); startSlide(); return true;
      case 'section': if (cmd && cmd.id !== 'section') await finish(); if (cmd?.id !== 'section') startSection(); return true;
      case 'reverse-sheet': await reverseSheets(); return true;
      // Plasticity's Slot: Offset Curve with Offset Region's slot on (an open curve closed round its ends).
      case 'slot': await startCurveEdit('offset-curve'); if (cmd?.id === 'offset-curve' && !cmd.slot) cmd.key('slot'); return true;
      case 'insert-knot': if (cmd) await finish(); startInsertKnot(); return true;
      case 'hide': setHidden(sel.bodies, true); return true;
      case 'hide-others': setHidden(current.map(b => b.id).filter(id => !sel.bodies.includes(id)), true); return true;
      case 'unhide-all': setHidden([...org.hidden], false); return true;
      case 'invert-hidden': org.invertHidden(current.map(b => b.id).filter(id => !org.disabled.has(id))); organised(); return true;
      case 'isolate': isolateSelected(); return true;
      case 'unisolate': org.unisolate(); organised(); return true;
      case 'group': groupSelected(); return true;
      case 'ungroup': ungroupSelected(); return true;
      case 'lock': lockSelected(); return true;
      case 'unlock-all': org.setLocked([...org.locked], false); organised(); return true;
      case 'undo': await step('undo'); return true;
      case 'redo': await step('redo'); return true;
    }
    return false;
  }

  // --- keys, the P-Menu and radial menus -------------------------------------
  // Keys the user set in the palette sit over the defaults and are kept in this browser or app.
  const store = {
    get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage off */ } },
  };
  let customKeys = store.get('w3d-keys', {});
  let keys = mergeKeys(VIEWPORT, customKeys);
  function bindKeys(list, action) {
    for (const k of list) customKeys[k] = action;
    // A key set back to the action it has by default needs no entry.
    for (const k of Object.keys(customKeys)) if ((customKeys[k] || undefined) === VIEWPORT[k]) delete customKeys[k];
    store.set('w3d-keys', customKeys);
    keys = mergeKeys(VIEWPORT, customKeys);
  }
  const keyLabel = action => showKey(Object.keys(keys).find(k => keys[k] === action));

  // P-Menu: the file menu under the app's name (Plasticity's P at the top left).
  let recent = store.get('w3d-recent', []);
  const remember = path => { if (!path) return; recent = [path, ...recent.filter(p => p !== path)].slice(0, 8); store.set('w3d-recent', recent); };
  const P_NEEDS = { 'file:new': 'newDocument', 'file:open': 'open', 'import:step': 'importStep', 'file:save': 'save', 'file:save-as': 'saveAs', 'file:save-version': 'saveVersion', 'file:save-startup': 'saveStartupScene', 'app:quit': 'quit' };
  function openPMenu() {
    const menu = $('pmenu');
    const can = e => e.action === 'import:step' ? !$('import').hidden : !P_NEEDS[e.action] || typeof backend[P_NEEDS[e.action]] === 'function';
    menu.innerHTML = P_MENU.map(e => {
      if (e.action === 'file:recent') {
        const files = typeof backend.open === 'function' ? recent : [];
        return `<div class="pm-title">RECENT FILES</div>` + (files.length ? files.map(p => `<button role="menuitem" data-recent="${encodeURIComponent(p)}" title="${p.replace(/"/g, '&quot;')}">${p.split(/[\\/]/).pop().toUpperCase()}</button>`).join('') : '<div class="pm-none">NONE YET</div>') + '<hr>';
      }
      if (e.action === 'app:version') return `<hr><div class="pm-none" data-id="pm-version">WITNESS 3D</div>`;
      return `<button role="menuitem" data-pm="${e.action}" ${can(e) ? '' : 'disabled title="Not in the browser yet"'}><span>${e.label}</span><kbd>${keyLabel(e.action)}</kbd></button>`;
    }).join('');
    menu.hidden = false;
    $('pmenu-open').setAttribute('aria-expanded', 'true');
    for (const b of menu.querySelectorAll('[data-pm]')) b.onclick = () => { closePMenu(); doAction(b.dataset.pm); };
    for (const b of menu.querySelectorAll('[data-recent]')) b.onclick = () => { closePMenu(); openFile(decodeURIComponent(b.dataset.recent)); };
    const v = backend.version ? backend.version() : Promise.resolve(null);
    v.then(n => { const el = $('pm-version'); if (el) el.textContent = `WITNESS 3D ${n ? `V${n}` : '· BROWSER'}`; }, () => {});
  }
  // Preferences: Plasticity's window of settings, by section; each change applies and is kept at once.
  // The bridge settings live with the desktop app and take effect the next time it starts.
  const PREF_SECTIONS = { navigation: 'NAVIGATION', appearance: 'APPEARANCE', commands: 'COMMANDS', performance: 'PERFORMANCE', network: 'NETWORK' };
  // Performance: the facets the bodies are drawn with, as last asked of the backend.
  let facetQuality = 1, aoShader = false;
  function applyPrefs() {
    Object.assign(controls, controlSettings(prefs.navigation));
    const perf = prefs.performance;
    renderer.setPixelRatio(Math.min(devicePixelRatio, perf.renderQuality));
    // Plasticity's camera FOV (Preferences › Navigation, 35° by default).
    if (persp.fov !== prefs.navigation.fov) { persp.fov = prefs.navigation.fov; persp.updateProjectionMatrix(); }
    resize(true);
    if (perf.aoShader !== aoShader) { aoShader = perf.aoShader; view.ao = aoShader; applyView(); }
    if (perf.facetQuality !== facetQuality && backend.setMeshQuality) {
      facetQuality = perf.facetQuality;
      backend.setMeshQuality(facetQuality).then(list => showScene(list)).catch(e => toast(say(e)));
    }
    // With Arcball off the view stands upright again.
    if (!prefs.navigation.arcball && camera.up.y !== 1) { camera.up.set(0, 1, 0); camera.lookAt(controls.target); }
    const look = prefs.appearance, c = viewColors(look);
    scene.background.setHex(c.ground);
    COLORS.ground = c.ground;
    paintGrid(c.gridMajor, c.grid);
    edgeMat.color.set(look.edge);
    vertexMat.normal.size = look.pointSize;
    vertexMat.hover.size = vertexMat.selected.size = look.pointSize + 4;
    // Zoom Factor scales the whole interface; the shell keeps filling the window.
    const shell = root.querySelector('.w3d'), z = look.uiScale;
    shell.style.zoom = z === 1 ? '' : String(z);
    shell.style.height = z === 1 ? '' : `${100 / z}vh`;
  }
  function paintGrid(major, minor) {
    // GridHelper's lines come four points a line pair; the middle pair is the major colour.
    const col = grid.geometry.getAttribute('color'), half = col.count / 8 - 0.5;
    const a = new THREE.Color(major), b = new THREE.Color(minor);
    for (let v = 0; v < col.count; v++) (Math.floor(v / 4) === half ? a : b).toArray(col.array, v * 3);
    col.needsUpdate = true;
  }
  async function openPrefs() {
    closePMenu();
    if (backend.networkPrefs) {
      try { const n = await backend.networkPrefs(); prefs = setPref(setPref(prefs, 'network', 'bridge', n.bridge), 'network', 'bridgePort', n.port); } catch { /* keep ours */ }
    }
    const el = $('prefs'), desktop = typeof backend.setNetworkPrefs === 'function';
    const field = (s, f) => {
      const v = prefs[s][f.key], off = f.desktop && !desktop, id = `pf-${s}-${f.key}`;
      const input = f.type === 'bool' ? `<input type="checkbox" id="${id}" ${v ? 'checked' : ''}>`
        : f.type === 'color' ? `<input type="color" id="${id}" value="${v}">`
        : `<input type="number" id="${id}" value="${v}" min="${f.min}" max="${f.max}" step="${f.step ?? 0.1}">`;
      const note = off ? 'DESKTOP APP ONLY' : f.restart ? 'AFTER A RESTART' : '';
      return `<label class="pf-row${off ? ' off' : ''}" data-pref="${s}.${f.key}" title="${note ? note.charAt(0) + note.slice(1).toLowerCase() : f.label}"><span>${f.label}${note ? `<small>${note}</small>` : ''}</span>${input.replace('>', off ? ' disabled>' : '>')}</label>`;
    };
    el.innerHTML = `<div class="pf-head"><span>PREFERENCES</span><button data-id="prefs-reset" title="Put every setting back to its default">RESET</button><button data-id="prefs-close" title="Close (Esc)" aria-label="Close">${icon('close')}</button></div>`
      + Object.entries(PREF_FIELDS).map(([s, fs]) => `<div class="pf-title">${PREF_SECTIONS[s]}</div>` + fs.map(f => field(s, f)).join('')).join('');
    el.hidden = false;
    for (const row of el.querySelectorAll('[data-pref]')) {
      const [s, key] = row.dataset.pref.split('.'), input = row.querySelector('input');
      input.onchange = input.oninput = () => {
        if (input.type === 'number' && input.value === '') return;
        prefs = setPref(prefs, s, key, input.type === 'checkbox' ? input.checked : input.value);
        keepPrefs(s);
      };
      input.onblur = () => { const v = prefs[s][key]; if (input.type !== 'checkbox') input.value = v; };
    }
    $('prefs-close').onclick = closePrefs;
    $('prefs-reset').onclick = () => { prefs = readPrefs(null); keepPrefs('network'); openPrefs(); toast('PREFERENCES BACK TO THEIR DEFAULTS'); };
  }
  function keepPrefs(section) {
    const { network, ...kept } = changedPrefs(prefs);
    store.set('w3d-prefs', kept);
    if (section === 'network' && backend.setNetworkPrefs) backend.setNetworkPrefs({ bridge: prefs.network.bridge, port: prefs.network.bridgePort }).catch(e => toast(say(e)));
    applyPrefs();
  }
  function closePrefs() { $('prefs').hidden = true; }
  function closePMenu() { $('pmenu').hidden = true; $('pmenu-open').setAttribute('aria-expanded', 'false'); }
  $('pmenu-open').onclick = () => $('pmenu').hidden ? openPMenu() : closePMenu();
  addEventListener('pointerdown', e => { if (!$('pmenu').hidden && !e.target.closest('.pmenu, .pmenu-open')) closePMenu(); }, true);

  // Radial menus: the items around the cursor; click one, or hold the menu's key, point and let go.
  const radials = new Map([...RADIALS, ...store.get('w3d-radials', [])].map(m => [m.command, m]));
  let radial = null, radialKey = null;
  const actionKnown = a => a in ACTIONS || TOOLS.some(t => `tool:${t.id}` === a);
  function openRadial(id) {
    const m = radials.get(id);
    if (!m) return toast('NO SUCH RADIAL MENU');
    const at = lastPointer ? [lastPointer.clientX, lastPointer.clientY] : [innerWidth / 2, innerHeight / 2];
    const host = $('radial'), box = host.parentElement.getBoundingClientRect();
    radial = { m, x: at[0], y: at[1], hot: -1, key: radialKey };
    host.style.left = `${at[0] - box.left}px`;
    host.style.top = `${at[1] - box.top}px`;
    for (const b of host.querySelectorAll('button')) b.remove();
    m.items.forEach((it, i) => {
      const [dx, dy] = slicePosition(i, m.items.length, 78);
      const b = document.createElement('button');
      b.className = 'radial-item';
      b.style.transform = `translate(calc(${dx}px - 50%), calc(${dy}px - 50%))`;
      b.innerHTML = icon(it.icon) || `<b>${shortLabel(it)}</b>`;
      b.title = it.label;
      b.onpointerenter = () => hotRadial(i);
      b.onclick = () => runRadial(i);
      host.append(b);
    });
    host.hidden = false;
    hotRadial(-1);
  }
  function hotRadial(i) {
    if (!radial) return;
    radial.hot = i;
    $('radial-hub').textContent = i < 0 ? radial.m.name.toUpperCase() : radial.m.items[i].label;
    $$('.radial-item').forEach((b, n) => b.setAttribute('aria-current', n === i));
  }
  function closeRadial() { radial = null; $('radial').hidden = true; }
  function runRadial(i) {
    const it = radial?.m.items[i];
    closeRadial();
    if (!it) return;
    if (it.command.startsWith('view:radial:')) return openRadial(it.command.slice(12));
    doAction(it.command);
  }
  addEventListener('pointermove', e => { if (radial) hotRadial(sliceAt(e.clientX - radial.x, e.clientY - radial.y, radial.m.items.length)); });
  addEventListener('pointerdown', e => { if (radial && !e.target.closest('.radial')) closeRadial(); }, true);
  addEventListener('keydown', e => { if (radial && e.key === 'Escape') { e.stopImmediatePropagation(); closeRadial(); } }, true);
  addEventListener('keydown', e => { if (!$('prefs').hidden && e.key === 'Escape') { e.stopImmediatePropagation(); closePrefs(); } }, true);
  addEventListener('keydown', e => { if (planeOriginPending && e.key === 'Escape') { e.stopImmediatePropagation(); planeOriginPending = false; setHud(''); } }, true);
  addEventListener('keyup', e => {
    // Let go of the key that opened the menu: run what the pointer is on, or leave it open to click.
    if (radial?.key && e.code === radial.key) { radial.key = null; if (radial.hot >= 0) runRadial(radial.hot); }
  });
  // A radial menu file (Plasticity's shape, this app's command names) dropped on the viewport.
  canvas.addEventListener('dragover', e => { if ([...e.dataTransfer.items].some(i => i.kind === 'file')) e.preventDefault(); });
  canvas.addEventListener('drop', async e => {
    const f = [...e.dataTransfer.files].find(f => /\.json$/i.test(f.name));
    if (!f) return;
    e.preventDefault();
    const { menu, error } = parseRadial(await f.text(), actionKnown);
    if (error) return toast(error);
    radials.set(menu.command, menu);
    store.set('w3d-radials', [...radials.values()].filter(m => !RADIALS.some(r => r.command === m.command)));
    ACTIONS[`radial:${menu.command}`] = `Radial menu: ${menu.name}`;
    ENTRIES.push({ action: `radial:${menu.command}`, label: `RADIAL MENU: ${menu.name.toUpperCase()}` });
    toast(`RADIAL MENU: ${menu.name.toUpperCase()} · RIGHT-CLICK IT IN F TO SET A KEY`);
  });

  // --- command palette (F) and suggestions (Shift+F) --------------------------
  const ENTRIES = [
    ...TOOLS.map(t => ({ action: `tool:${t.id}`, label: t.label })),
    ...Object.entries(ACTIONS).map(([action, l]) => ({ action, label: l.toUpperCase() })),
  ];
  for (const m of radials.values()) if (!RADIALS.some(r => r.command === m.command)) {
    ACTIONS[`radial:${m.command}`] = `Radial menu: ${m.name}`;
    ENTRIES.push({ action: `radial:${m.command}`, label: `RADIAL MENU: ${m.name.toUpperCase()}` });
  }
  /**
   * Commands that fit what is selected (Plasticity's Shift+F, Suggested Commands). With the toolbars
   * holding only drawing tools and the Command Bar's common commands, this is where the rest of the
   * modeling commands come up, by what they act on.
   */
  function suggestions() {
    const kinds = new Set(sel.list().map(it => it.kind));
    const out = [];
    if (sel.solids.length > 1) out.push('tool:boolean');
    if (sel.solids.length === 2) out.push('tool:project');
    if (kinds.has('solid')) out.push('tool:move', 'tool:rotate', 'tool:scale', 'duplicate', 'create-outline', 'toggle-points', 'place', 'copy-place', 'dimension', 'tool:mirror', 'tool:rect-array', 'tool:radial-array', 'tool:curve-array', 'unify', 'boundary-edges', 'remove-fillets', 'raise-degree', 'deform-curve', 'create-instance', 'delete', 'hide', 'isolate', 'group', 'lock', 'material:set', 'export:step', 'export:mesh', 'export:drawing');
    if (kinds.has('face')) out.push('tool:extrude', 'tool:offset', 'tool:thicken', 'tool:shell', 'tool:hole', 'tool:remove-face', 'remove-fillets', 'isoparam', 'rebuild', 'raise-degree', 'subdivide', 'match-face', 'untrim', 'unwrap', 'toggle-points', 'view:surface-curvature', 'plane:selection', 'plane:selection-keep-view');
    if (sel.list('edge').length === 1 && sel.list('face').length === 1) out.push('project-align');
    if (kinds.has('edge')) out.push('tool:fillet', 'tool:patch', 'alt-duplicate', 'measure:radius', 'view:surface-curvature', ...(sel.list('edge').length === 2 ? ['bridge-edge', 'align-surface'] : []), ...([2, 3, 4].includes(sel.list('edge').length) ? ['square'] : []));
    if (sel.list('edge').length === 2) out.push('tool:bridge-surface');
    if (sel.solids.some(id => current.find(b => b.id === id)?.sheet)) out.push('tool:thicken', 'reverse-sheet');
    if (sel.solids.length > 1 && sel.solids.every(id => current.find(b => b.id === id)?.sheet)) out.push('join');
    if (sel.solids.length === 1) out.push('unjoin:faces', 'unjoin:pieces');
    if (sel.list('edge').some(e => current.find(b => b.id === e.body)?.sheet)) out.push('tool:extend-sheet');
    if (kinds.has('region')) out.push('tool:extrude', 'tool:revolve', 'tool:loft', 'tool:sweep');
    if (kinds.has('curve') || kinds.has('region')) {
      if (kinds.has('solid')) out.push('tool:project', 'tool:cut', 'tool:imprint');
      if (sel.curves.length === 2) out.push('tool:project');
      out.push('tool:patch', 'tool:pipe', 'alt-duplicate', 'toggle-points', 'create-instance');
      if (kinds.has('face')) out.push('tool:imprint');
      if (kinds.has('face')) out.push('tool:draft');
      out.push('trim', 'split', 'cut-curve', 'extend', 'tool:offset-curve', 'slot', 'tool:fillet-curve');
      if (sel.curves.length === 2) out.push('tool:bridge', 'align-curve');
      if ([2, 3, 4].includes(sel.curves.length + sel.list('edge').length)) out.push('square');
      if (sel.curves.length > 1) out.push('join');
      out.push('explode', 'unjoin:curves', 'reverse', 'rebuild', 'insert-knot', 'raise-degree', 'subdivide', 'complete-edge', 'deform-curve', 'measure:continuity', 'delete');
    }
    // Curve vertices: Fillet Vertex (B), Offset Vertex and, with two ends, Bridge Vertex.
    if (kinds.has('pole')) out.push('slide', 'toggle-points');
    if (kinds.has('vertex')) out.push('tool:fillet', 'tool:offset-curve', 'slide', 'align-vertex', 'convert-vertex', ...(sel.list('vertex').length === 2 ? ['tool:bridge'] : []));
    if (kinds.size) out.push('convert:solid', 'select:invert', 'view:focus');
    else out.push('draw:line', 'draw:spline', 'draw:rect', 'draw:circle', 'draw:arc3', 'text', 'tool:box', 'tool:cylinder', 'tool:sphere', 'select:all', 'unhide-all', 'plane:view');
    if (!kinds.size && org.layers.length) out.push('isolate', 'unisolate');
    if (!kinds.size && org.locked.size) out.push('unlock-all');
    return [...new Set(out)].map(a => ENTRIES.find(e => e.action === a)).filter(Boolean);
  }
  let palette = null;
  const fuzzy = (q, s) => { let i = 0; for (const ch of s) if (ch === q[i]) i++; return i === q.length; };
  function openPalette(suggest, query = '') {
    palette = { suggest, index: 0, items: [], binding: null };
    $('palette').hidden = false;
    $('palette-title').textContent = suggest ? 'SUGGESTED FOR THE SELECTION' : 'SEARCH COMMANDS';
    $('palette-input').value = query;
    renderPalette();
    $('palette-input').focus();
  }
  function closePalette() { palette = null; $('palette').hidden = true; $('palette-input').blur(); }
  function renderPalette() {
    const q = $('palette-input').value.toUpperCase().replace(/\s+/g, '');
    const pool = palette.suggest ? suggestions() : ENTRIES;
    // Whole-word starts first, then anywhere in the name, then letters in order.
    const rank = e => {
      const l = e.label.replace(/[^A-Z0-9 ]/g, '');
      if (!q || l.split(' ').some(w => w.startsWith(q)) || l.startsWith(q)) return 0;
      if (l.replace(/\s+/g, '').includes(q)) return 1;
      return fuzzy(q, l.replace(/\s+/g, '')) ? 2 : 3;
    };
    palette.items = pool.map(e => [rank(e), e]).filter(([r]) => r < 3).sort((a, b) => a[0] - b[0]).map(([, e]) => e).slice(0, 12);
    palette.index = Math.min(palette.index, Math.max(0, palette.items.length - 1));
    const ul = $('palette-list');
    ul.innerHTML = '';
    palette.items.forEach((e, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', i === palette.index);
      const [kind, id] = e.action.split(':');
      li.innerHTML = `<span>${icon(kind === 'tool' || kind === 'draw' ? id : kind === 'palette' ? 'search' : kind)}${e.label}</span><kbd>${palette.binding === e ? 'PRESS A KEY · ⌫ CLEARS' : keyLabel(e.action)}</kbd>`;
      li.onmousedown = ev => { ev.preventDefault(); if (ev.button === 0) runPalette(i); };
      // Plasticity: right-click a command in the palette to give it a key of your own.
      li.oncontextmenu = ev => { ev.preventDefault(); palette.binding = e; palette.index = i; renderPalette(); };
      ul.append(li);
    });
    if (!palette.items.length) ul.innerHTML = '<li class="none">NOTHING MATCHES</li>';
  }
  function runPalette(i) {
    const e = palette?.items[i];
    closePalette();
    if (e) doAction(e.action);
  }
  $('palette-input').addEventListener('input', () => { palette.index = 0; renderPalette(); });
  $('palette-input').addEventListener('keydown', e => {
    if (palette.binding) {
      e.preventDefault();
      e.stopPropagation();
      const k = keyOf(e), action = palette.binding.action;
      if (['ctrl', 'alt', 'shift'].includes(k)) return;
      if (e.key === 'Escape') { palette.binding = null; return renderPalette(); }
      if (e.key === 'Backspace' || e.key === 'Delete') bindKeys(Object.keys(keys).filter(x => keys[x] === action), '');
      else bindKeys([k], action);
      toast(e.key === 'Backspace' || e.key === 'Delete' ? `${palette.binding.label} · NO KEY` : `${palette.binding.label} · ${showKey(k)}`);
      palette.binding = null;
      return renderPalette();
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      palette.index = (palette.index + (e.key === 'ArrowDown' ? 1 : -1) + palette.items.length) % Math.max(1, palette.items.length);
      renderPalette();
    } else if (e.key === 'Enter') { e.preventDefault(); runPalette(palette.index); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
    e.stopPropagation();
  });
  $('palette-input').addEventListener('blur', () => setTimeout(() => palette && closePalette(), 100));

  // --- AI text commands (Ctrl+K) ------------------------------------------------
  // A sentence becomes one registered tool, started with its preview exactly as if its key had
  // been pressed; Enter or right-click keeps it, Escape drops it. See ai.js.
  let asking = null, lastAsk = null, send = backend.ai ?? null;
  const session = {
    get: k => { try { return sessionStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { v ? sessionStorage.setItem(k, v) : sessionStorage.removeItem(k); } catch { /* storage off */ } },
  };
  async function sender() {
    if (send) return send;
    const key = backend.aiKey ? await backend.aiKey() : session.get('w3d-anthropic-key');
    if (!key) return null;
    return send = await claude(key);
  }
  function askMode(mode, note = '') {
    asking.mode = mode;
    const input = $('ask-input');
    input.value = '';
    input.type = mode === 'key' ? 'password' : 'text';
    input.placeholder = mode === 'key' ? 'PASTE YOUR ANTHROPIC API KEY' : 'E.G. ROUND THE TOP EDGES BY 4 MM';
    $('ask-title').textContent = mode === 'key'
      ? (backend.setAiKey ? 'API KEY · SAVED FOR THIS USER ON THIS COMPUTER' : 'API KEY · KEPT IN THIS TAB ONLY')
      : `ASK · ${MODEL.toUpperCase()} · ONE COMMAND, PREVIEWED FIRST`;
    $('ask-out').textContent = note;
    input.focus();
  }
  async function openAsk() {
    if (cmd) await finish();
    asking = { mode: 'prompt', busy: false };
    $('ask').hidden = false;
    askMode(send || (backend.aiKey ? await backend.aiKey() : session.get('w3d-anthropic-key')) ? 'prompt' : 'key');
  }
  function closeAsk() { asking = null; $('ask').hidden = true; $('ask-input').blur(); }
  /** Ask for `prompt` and start the tool that comes back. Returns { tool, args, text }. */
  async function ask(prompt) {
    const t = await sender();
    if (!t) throw new Error('add an Anthropic API key first');
    const described = describe({ bodies: current, curves: curveList, hidden: current.map(b => b.id).filter(id => !org.shows(id)), context: api.context(), toUser });
    const r = reply(await t(request(prompt, described)));
    lastAsk = { prompt, ...r, started: false };
    if (r.tool) { await api.run(r.tool, r.args); lastAsk.started = true; }
    return lastAsk;
  }
  async function submitAsk() {
    const text = $('ask-input').value.trim();
    if (!text || asking.busy) return;
    if (asking.mode === 'key') {
      if (backend.setAiKey) await backend.setAiKey(text); else session.set('w3d-anthropic-key', text);
      send = backend.ai ?? null;
      return askMode('prompt', 'KEY SAVED. NOW SAY WHAT TO DO.');
    }
    asking.busy = true;
    $('ask-out').textContent = 'THINKING…';
    try {
      const r = await ask(text);
      if (!r.tool) { $('ask-out').textContent = r.text.toUpperCase(); return; }
      closeAsk();
      toast(`${toolInfo(r.tool)?.label ?? r.tool.toUpperCase()} FROM “${text.toUpperCase()}” · ADJUST, THEN ⏎ TO KEEP`);
    } catch (e) {
      // A rejected key goes back to asking for one.
      if (e?.status === 401) { send = backend.ai ?? null; if (backend.setAiKey) await backend.setAiKey(''); else session.set('w3d-anthropic-key', ''); return askMode('key', 'THAT KEY WAS NOT ACCEPTED.'); }
      $('ask-out').textContent = say(e);
    } finally { if (asking) asking.busy = false; }
  }
  $('ask-input').addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); submitAsk(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeAsk(); }
  });

  // --- Blender bridge status (desktop) -------------------------------------------
  function showBridge([connected, live] = [0, 0]) {
    $('blender').hidden = false;
    $('blender-state').textContent = !connected ? 'NOT CONNECTED' : live ? `LIVE ×${live}` : `CONNECTED ×${connected}`;
  }
  if (backend.bridgeStatus) setInterval(() => backend.bridgeStatus().then(showBridge, () => {}), 2000);

  // --- files --------------------------------------------------------------
  function newScene(list, name) {
    if (cmd) abort();
    sel.clear();
    history.length = 0;
    undone = 0;
    renderHistory();
    showScene(list);
    $('file-name').textContent = name;
  }
  /** Groups, hidden and locked bodies and materials go into the file with the geometry. */
  async function keepAppState() {
    if (!backend.setAppState) return;
    await backend.setAppState({ organise: org.toJSON(), materials: [...materials.values()], materialOf: [...materialOf], nextMaterial, images, nextImage, instances: instances.filter(masterOf), nextInstance, planes: savedPlanes });
  }
  async function restoreAppState() {
    const st = backend.appState ? await backend.appState() : null;
    org = Organise.from(st?.organise);
    materials.clear(); materialOf.clear(); for (const m of bodyMats.values()) m.dispose(); bodyMats.clear();
    for (const m of Array.isArray(st?.materials) ? st.materials : []) if (Number.isInteger(m?.id) && !checkMaterial({ ...newMaterial(m.id), ...m }).length) materials.set(m.id, { ...newMaterial(m.id), ...m });
    for (const [b, m] of Array.isArray(st?.materialOf) ? st.materialOf : []) if (materials.has(m)) materialOf.set(b, m);
    nextMaterial = Math.max(Number.isInteger(st?.nextMaterial) ? st.nextMaterial : 1, ...[...materials.keys()].map(k => k + 1));
    for (const t of textures.values()) t.dispose();
    textures.clear();
    images = (Array.isArray(st?.images) ? st.images : []).filter(m => !checkImage(m).length);
    nextImage = Math.max(Number.isInteger(st?.nextImage) ? st.nextImage : 1, ...images.map(m => m.id + 1));
    drawImages();
    savedPlanes = (Array.isArray(st?.planes) ? st.planes : []).filter(q => typeof q?.name === 'string' && [q.origin, q.normal].every(v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)));
    drawSavedPlanes();
    instances = (Array.isArray(st?.instances) ? st.instances : []).filter(m => !checkInstance(m).length);
    nextInstance = Math.max(Number.isInteger(st?.nextInstance) ? st.nextInstance : 1, ...instances.map(m => m.id + 1));
    drawInstances();
    org.prune(current.map(b => b.id));
    materialsChanged();
    organised();
  }
  async function fileAction(fn) {
    try { await fn(); } catch (e) { toast(say(e)); }
  }
  for (const [id, method] of [['file-new', 'newDocument'], ['file-open', 'open'], ['file-save', 'save'], ['import', 'importStep']]) {
    $(id).hidden = typeof backend[method] !== 'function';
  }
  // Without a native import (the browser), Import still reads DXF drawings as curves.
  if (!backend.importStep && backend.addCurves) { $('import').hidden = false; $('import').title = 'Import a DXF drawing as curves, or a PNG or JPEG reference image'; }
  $('file-new').onclick = () => fileAction(async () => { newScene(await backend.newDocument(), 'UNTITLED.W3D'); await restoreAppState(); });
  function openFile(path) {
    return fileAction(async () => {
      const r = await backend.open(path);
      if (!r) return;
      newScene(r.scene, r.name.toUpperCase());
      await restoreAppState();
      remember(backend.filePath);
    });
  }
  $('file-open').onclick = () => openFile();
  $('file-save').onclick = () => fileAction(async () => {
    await keepAppState();
    const name = await backend.save();
    if (name) { $('file-name').textContent = name.toUpperCase(); toast(`SAVED ${name.toUpperCase()}`); remember(backend.filePath); }
  });
  /** A DXF drawing's curves added on the XY plane as one undo step, then selected. */
  async function importDxf(text, name) {
    const { curves, skipped, approximated, units } = readDxf(text);
    const { ids } = await backend.addCurves(curves);
    if (cmd) abort();
    record(`IMPORT DXF ${name.toUpperCase()}`, ids[0], curveLabel(ids[0]));
    await curvesChanged(ids);
    const left = Object.entries(skipped).map(([t, n]) => `${n} ${t}`).join(', ');
    toast(`${ids.length} CURVE${ids.length > 1 ? 'S' : ''} FROM ${name.toUpperCase()} (${units})${approximated ? ` · ${approximated} ELLIPSE ARC${approximated > 1 ? 'S' : ''} AS SPLINES` : ''}${left ? ` · LEFT OUT ${left}` : ''}`);
  }
  $('import-file').onchange = e => fileAction(async () => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (/\.(png|jpe?g)$/i.test(file.name)) return importImage(file, file.name);
    await importDxf(await file.text(), file.name);
  });
  $('import').onclick = () => fileAction(async () => {
    if (!backend.importStep) return $('import-file').click();
    const r = await backend.importStep();
    if (!r) return;
    if (r.dxf !== undefined) return importDxf(r.dxf, r.name);
    if (r.image) return importImage(r.image, r.name);
    if (cmd) abort();
    sel.clear();
    record('IMPORT STEP', r.id);
    showScene(r.scene);
  });

  // --- pointer input --------------------------------------------------------
  let down = null; // { x, y, button, consumed, box }
  /** The dot being dragged or under the pointer, among the command's dots; else its main one. */
  const liveGizmo = () => [cmd?.gizmo, ...(cmd?.extraGizmos?.() ?? [])].find(g => g && (g.busy || g.state === 'hover')) ?? cmd?.gizmo;
  canvas.addEventListener('pointerdown', e => {
    lastPointer = e;
    const g = liveGizmo();
    const grabbed = g?.busy || g?.state === 'hover' || (cmd?.tc && cmd.tc.axis !== null);
    down = { x: e.clientX, y: e.clientY, button: e.button, consumed: grabbed, box: null };
    if (e.button === 0 && cmd?.follow) { endFollow(true); down.consumed = true; }
  });
  canvas.addEventListener('pointermove', e => {
    lastPointer = e;
    ray(e);
    const p = raycaster.ray.intersectPlane(planeOf(), new THREE.Vector3());
    if (p) { const u = toUser(p.toArray()); $('cursor').textContent = `X ${u[0].toFixed(2)} Y ${u[1].toFixed(2)} Z ${u[2].toFixed(2)}`; }
    if (cmd?.follow) return followMove(e);
    if (down && down.button === 0 && !down.consumed && (e.buttons & 1)) {
      const a = local({ clientX: down.x, clientY: down.y }), b = local(e);
      if (down.box || Math.hypot(b.x - a.x, b.y - a.y) > 4) {
        down.box = b;
        const el = $('boxsel');
        el.hidden = false;
        el.dataset.touch = b.x < a.x;
        Object.assign(el.style, { left: `${Math.min(a.x, b.x)}px`, top: `${Math.min(a.y, b.y)}px`, width: `${Math.abs(b.x - a.x)}px`, height: `${Math.abs(b.y - a.y)}px` });
      }
      return;
    }
    if (e.buttons) return;
    if (cmd?.move) return cmd.move(e);
    if (cmd && !cmd.auto && cmd.id !== 'fillet') return;
    scheduleHover(e);
  });
  let hoverQueued = null;
  function scheduleHover(e) {
    if (hoverQueued) { hoverQueued = e; return; }
    hoverQueued = e;
    requestAnimationFrame(() => {
      const ev = hoverQueued;
      hoverQueued = null;
      const g = liveGizmo();
      const h = g?.state === 'hover' || g?.busy ? null : clickTarget(pickAt(ev), cmd?.id === 'fillet' ? 'add' : modOf(ev));
      const show = cmd?.id === 'fillet' && h && h.kind !== 'edge' ? null : h;
      if (JSON.stringify(show) !== JSON.stringify(hover)) { hover = show; drawOverlays(); }
    });
  }
  canvas.addEventListener('pointerleave', () => { if (hover) { hover = null; drawOverlays(); } });
  canvas.addEventListener('pointerup', async e => {
    const d = down;
    down = null;
    if (!d || d.button !== e.button) return;
    if (pickMenu?.held && e.button === 0) return choosePick(pickMenu.at, e.shiftKey);
    if (planeOriginPending && e.button === 0 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return placeViewPlane(e);
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4;
    if (e.button === 2) { if (!moved && cmd) await finish(); return; } // Plasticity: right-click finishes
    if (e.button !== 0 || d.consumed) return;
    if (d.box) {
      $('boxsel').hidden = true;
      if (cmd && !cmd.auto) return;
      return boxSelect(local({ clientX: d.x, clientY: d.y }), local(e), modOf(e));
    }
    if (moved) return;
    if (pickMenu) closePickMenu();
    // Ctrl+Shift+click: the selection context menu of what lies under the pointer.
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (!cmd || cmd.auto)) return openPickMenu(e);
    // Alt+click an edge: its loop; Ctrl+Alt+click: its ring (Shift adds either to the selection).
    // Also while Fillet picks its edges, or a command came up by itself on the selection.
    // Alt+click a control net line (shown with Toggle Points, in point mode): its row or column.
    if (e.altKey && (!cmd || cmd.auto) && sel.allows('point') && !(vertexAt(local(e)) ?? poleAt(local(e)))) {
      const run = hullLoopAt(local(e));
      if (run) {
        if (!e.shiftKey) sel.clear();
        for (const it of run) sel.add(it);
        hover = null;
        return selectionChanged();
      }
    }
    if (e.altKey && (!cmd || cmd.auto || cmd.id === 'fillet')) {
      const picked = pickAt(e), b = picked?.kind === 'edge' && bodyOf(picked.body);
      if (b) {
        const topo = topologyOf(b), run = (e.ctrlKey || e.metaKey) ? edgeRing(b, picked.n, topo) : edgeLoop(b, picked.n, topo);
        if (!e.shiftKey) sel.clear();
        for (const n of run) applySelect({ kind: 'edge', body: picked.body, n }, 'add');
        hover = null;
        return selectionChanged();
      }
    }
    if (e.altKey && (!cmd || cmd.auto)) {
      const run = await smartPick(e);
      if (run) {
        if (!e.shiftKey) sel.clear();
        for (const it of run) sel.add(it);
        hover = null;
        return selectionChanged();
      }
    }
    if (cmd?.click && await cmd.click(e)) return;
    if (cmd && !cmd.auto) return;
    const picked = pickAt(e), inst = instanceAt(e, picked);
    if (inst) { if (cmd) await finish(); startInstance(inst); return; }
    applySelect(clickTarget(picked, modOf(e)), modOf(e));
    hover = null;
    selectionChanged();
  });
  /**
   * Plasticity's smart clicks (faceGroups.js): Alt+click a face for its related faces, Ctrl+Alt+click
   * for the faces parallel to it (cylinders: parallel axes); Alt+click a curve or region for all
   * those on its plane; Alt+click a solid or sheet for all of its kind in its group. Null: nothing to add.
   */
  async function smartPick(e) {
    const t = clickTarget(pickAt(e), 'replace');
    if (!t) return null;
    const ctrl = e.ctrlKey || e.metaKey;
    if (t.kind === 'face') {
      const b = bodyOf(t.body);
      if (!b) return null;
      let faces;
      if (!ctrl) faces = relatedFaces(b, t.n, topologyOf(b));
      else if (b.facePlanes[t.n]) faces = parallelFlatFaces(b.facePlanes, t.n);
      else if (backend.faceSurfaces) faces = parallelCylinders(await backend.faceSurfaces({ body: t.body }), t.n);
      else faces = [t.n];
      return faces.map(n => ({ kind: 'face', body: t.body, n }));
    }
    if ((t.kind === 'curve' || t.kind === 'region') && !ctrl) {
      const c = curveById(t.id);
      if (!c) return null;
      const plane = c2 => { const f = curveFrame(c2); return { origin: f.o.toArray(), normal: f.n.toArray() }; };
      const flat = c2 => c2.kind !== 'spiral' && !(c2.kind === 'nurbs' && c2.poles.some(q => Math.abs(q[2] ?? 0) > 1e-9));
      if (!flat(c)) return null;
      const here = plane(c);
      const shown = new Set(curveGroup.children.filter(o => o.visible && o.userData.curve !== undefined).map(o => o.userData.curve));
      return curveList.filter(k => shown.has(k.id) && flat(k) && (t.kind === 'curve' || isClosed(k)) && samePlane(here, plane(k))).map(k => ({ kind: t.kind, id: k.id }));
    }
    if (t.kind === 'solid' && !ctrl) {
      const group = org.groupOf.get(t.body) ?? null, sheet = !!bodyOf(t.body)?.sheet;
      return current.filter(b => org.picks(b.id) && (org.groupOf.get(b.id) ?? null) === group && !!b.sheet === sheet).map(b => ({ kind: 'solid', body: b.id }));
    }
    return null;
  }
  canvas.addEventListener('dblclick', e => {
    if (cmd && !cmd.auto) return;
    const hit = pickAt(e);
    // Plasticity: double-click a curve vertex to convert it into a control vertex.
    if (hit?.kind === 'vertex' && curveById(hit.id)) { convertSelected([{ id: hit.id, n: hit.n }]); return; }
    if (!hit || hit.body === undefined) return;
    applySelect({ kind: 'solid', body: hit.body }, e.shiftKey ? 'add' : 'replace');
    selectionChanged();
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  // --- panel input ----------------------------------------------------------
  for (const b of $$('[data-profile]')) b.onclick = () => setProfile(b.dataset.profile);
  for (const b of $$('[data-op]')) b.onclick = () => setOperation(b.dataset.op);
  for (const b of $$('[data-toggle]')) b.onclick = () => { view[b.dataset.toggle] = !view[b.dataset.toggle]; applyView(); snapsFor(view.snap); if (b.dataset.toggle === 'curvature') renderOutliner(); };
  for (const input of $$('[data-move]')) input.addEventListener('input', () => setOffset($$('[data-move]').map(i => parseFloat(i.value) || 0)));
  $('angle').addEventListener('input', e => { const v = parseFloat(e.target.value); if (!isNaN(v)) setAngle(v); });
  $('factor').addEventListener('input', e => setFactor(parseFloat(e.target.value)));
  for (const b of $$('[data-axis]')) b.onclick = () => setAxis(b.dataset.axis);
  const nav = new ViewGizmo($('nav'), {
    view: name => setView(name),
    orbit: (dx, dy) => orbitBy(dx, dy),
    pan: (dx, dy) => panBy(dx, dy),
    zoom: dy => zoomBy(dy),
    ortho: () => setOrtho(!camera.isOrthographicCamera),
    focus: () => focus(),
    home: () => setView('iso'),
  });
  for (const b of $$('[data-mode]')) b.onclick = e => doAction(b.dataset.mode === 'all' ? 'mode:all' : `${e.shiftKey ? 'mode-toggle' : 'mode'}:${b.dataset.mode}`);
  for (const b of $$('[data-action]')) b.onclick = () => doAction(b.dataset.action);
  for (const el of $$('[data-spiral-field]')) el.addEventListener('change', e => { const v = parseFloat(e.target.value); if (!isNaN(v) && cmd?.id === 'spiral') cmd.set(e.target.dataset.spiralField, v); });
  for (const b of $$('[data-spiral]')) b.onclick = () => cmd?.id === 'spiral' && cmd.key(b.dataset.spiral);
  $('off-angle').addEventListener('input', e => { const v = parseFloat(e.target.value); if (!isNaN(v) && cmd?.id === 'offset') { cmd.auto = false; setOffsetAngle(v); } });
  $('off-distance').addEventListener('input', e => { const v = parseFloat(e.target.value); if (!isNaN(v) && cmd?.id === 'offset') { cmd.auto = false; setOffsetDistance(v, false); } });
  for (const k of ['angle', 'thickness', 'twist', 'scale']) $(`form-${k}`).addEventListener('input', e => { const v = parseFloat(e.target.value); if (!isNaN(v) && (k !== 'scale' || v > 0) && (k !== 'angle' || v !== 0) && (k !== 'thickness' || v >= 0)) setForm({ [k]: v }); });
  for (const b of $$('[data-fop]')) b.onclick = () => cmd?.key?.(b.dataset.fop);
  function setGrid(dir) {
    const i = Math.max(0, Math.min(GRID_STEPS.length - 1, GRID_STEPS.indexOf(gridStep()) + dir));
    $('grid').value = GRID_STEPS[i];
    $('distance').step = GRID_STEPS[i];
    if (cmd?.gizmo) cmd.gizmo.step = GRID_STEPS[i];
  }
  $('grid-dec').onclick = () => setGrid(-1);
  $('grid-inc').onclick = () => setGrid(1);
  $('snap-object').onclick = () => doAction('snap:object');
  for (const b of $$('[data-snapkind]')) b.onclick = () => {
    const id = b.dataset.snapkind, off = snapSettings.off.includes(id) ? snapSettings.off.filter(x => x !== id) : [...snapSettings.off, id];
    setSnaps({ ...snapSettings, off });
  };
  setSnaps(snapSettings);
  $('size').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (!(v > 0)) return;
    size = v;
    const c = cmd;
    if (c?.id === 'pushpull' && c.at) { placeOutline(c.at.origin, c.at.normal); if (c.distance) updatePushPull(); }
  });
  $('distance').addEventListener('input', e => { const v = parseFloat(e.target.value); if (!isNaN(v)) setDistance(v); });
  $('blend-distance').addEventListener('input', e => { const v = parseFloat(e.target.value); if (!isNaN(v) && cmd?.id === 'fillet') { cmd.auto = false; setFillet(v, false); } });
  $('blend-angle').addEventListener('input', e => { const v = parseFloat(e.target.value); if (cmd?.id === 'fillet' && v > 0 && v < 90) { cmd.angle = v; previewFillet(); } });
  $('ex-distance').addEventListener('input', e => { const v = parseFloat(e.target.value); if (!isNaN(v) && cmd?.id === 'extrude') { cmd.auto = false; setExtrude(v, false); } });
  for (const b of $$('[data-xop]')) b.onclick = () => cmd?.id === 'extrude' && cmd.key(b.dataset.xop);
  $('ex-lock').onclick = () => cmd?.id === 'extrude' && cmd.key('lock');
  $('ex-angle').addEventListener('input', e => { const v = parseFloat(e.target.value); if (!isNaN(v)) setExtrudeShape({ angle: v }); });
  $('ex-thickness').addEventListener('input', e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0) setExtrudeShape({ thickness: v }); });
  for (const b of $$('[data-bop]')) b.onclick = () => cmd?.id === 'boolean' && cmd.key(b.dataset.bop);
  for (const b of $$('[data-xforient]')) b.onclick = () => cmd?.setOrient?.(b.dataset.xforient);
  for (const b of $$('[data-xfpivot]')) b.onclick = () => cmd?.setPivotMode?.(b.dataset.xfpivot);
  $('xf-pick').onclick = () => cmd?.pickPivot?.(!cmd.picking);
  $('xf-unpivot').onclick = () => cmd?.removePivot?.();
  $('ls-loop').onclick = () => cmd?.key?.('loop');
  $('ls-limit').onclick = () => cmd?.key?.('limit');
  $('ls-simplify').onclick = () => cmd?.key?.('simplify');
  for (const b of $$('[data-lscont]')) b.onclick = () => cmd?.id === 'loft' && cmd.sheet && cmd.setCont(b.dataset.lscont);
  $('ls-t').oninput = () => cmd?.id === 'loft' && cmd.sheet && cmd.refresh();
  for (const b of $$('[data-btmat]')) b.onclick = () => { if (cmd?.id === 'boolean') { cmd.targetMaterial = b.dataset.btmat; previewBooleanCmd(); } };
  for (const b of $$('[data-bumat]')) b.onclick = () => { if (cmd?.id === 'boolean') { cmd.toolMaterial = b.dataset.bumat; previewBooleanCmd(); } };
  for (const id of ['hole-d', 'hole-depth']) $(id).addEventListener('input', () => cmd?.id === 'hole' && cmd.preview());
  $('hole-through').onclick = () => cmd?.id === 'hole' && cmd.key('through');
  for (const n of ['1', '2', '3']) for (const e of 'ab') $(`br-t${n}${e}`).addEventListener('input', () => cmd?.id === 'bridge' && cmd.preview());
  for (const b of $$('[data-matlib]')) b.onclick = () => cmd?.id === 'material' && cmd.pick(Number(b.dataset.matlib));
  for (const input of $$('[data-mat]')) input.addEventListener('input', () => { if (cmd?.id === 'material' && !cmd.edit(input.dataset.mat, input.value)) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); });
  $('mat-fork').onclick = () => cmd?.id === 'material' && cmd.fork();
  $('mat-remove').onclick = () => cmd?.id === 'material' && cmd.remove();
  for (const b of $$('[data-shader]')) b.onclick = () => { view.shader = b.dataset.shader; view.render = false; applyView(); };
  for (const b of $$('[data-env]')) b.onclick = () => { view.environment = b.dataset.env; applyView(); };
  $('tx-load').onclick = () => $('tx-file').click();
  /** Use a font's bytes as MY FONT, kept for next time. */
  function takeFont(buffer, name) {
    useCustomFont(buffer, name);
    try {
      let bin = '';
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      localStorage.setItem('w3d-font', JSON.stringify({ name, data: btoa(bin) }));
    } catch { toast('FONT LOADED; TOO BIG TO KEEP FOR NEXT TIME'); }
    if (cmd?.id === 'text') cmd.setFont(FONTS.length);
  }
  $('tx-file').addEventListener('change', async e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try { takeFont(await f.arrayBuffer(), f.name); } catch (err) { toast(say(err)); }
  });
  // SYSTEM FONT: the installed fonts, from the desktop app, or from the browser's Local Font Access
  // (Chrome and Edge ask first; fonts other than TrueType outlines are refused when picked).
  const systemFonts = backend.systemFonts ? () => backend.systemFonts()
    : typeof window.queryLocalFonts === 'function' ? async () => {
      const seen = new Set();
      return (await window.queryLocalFonts()).filter(f => !seen.has(f.fullName) && seen.add(f.fullName))
        .map(f => ({ name: f.fullName, read: () => f.blob().then(b => b.arrayBuffer()) }));
    } : null;
  let installed = null;
  $('tx-system').hidden = !systemFonts;
  $('tx-system').onclick = async () => {
    const list = $('tx-list');
    if (!list.hidden) { list.hidden = true; return; }
    try { installed ??= await systemFonts(); } catch (e) { return toast(say(e)); }
    if (!installed.length) return toast('NO INSTALLED TRUETYPE FONTS FOUND');
    list.replaceChildren(new Option('PICK A FONT', ''), ...installed.map((f, i) => new Option(f.name, String(i))));
    list.hidden = false;
    list.focus();
  };
  $('tx-list').addEventListener('change', async e => {
    const f = installed?.[Number(e.target.value)];
    if (!e.target.value || !f) return;
    try { takeFont(await f.read(), f.name); e.target.hidden = true; } catch (err) { toast(say(err)); }
  });
  $('matcap-load').onclick = () => $('matcap-file').click();
  $('matcap-file').addEventListener('change', async e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const url = await asDataUrl(f);
      await useMatcap(url);
      try { localStorage.setItem('w3d-matcap', url); } catch { toast('MATCAP LOADED; TOO BIG TO KEEP FOR NEXT TIME'); }
      view.shader = 'custom'; view.render = false; applyView();
    } catch (err) { toast(say(err)); }
  });
  $('matcap-custom').onclick = () => { view.shader = 'custom'; view.render = false; applyView(); };
  $('hdr-load').onclick = () => $('hdr-file').click();
  $('hdr-file').addEventListener('change', async e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try { await loadHdr(f); view.environment = 'hdr'; view.render = true; applyView(); toast(`${f.name.toUpperCase()} LIGHTS RENDER MODE`); } catch (err) { toast(say(err)); }
  });
  $('hdr-custom').onclick = () => { view.environment = 'hdr'; applyView(); };
  $('comb-scale').addEventListener('input', () => drawCombs());
  $('env-rot').addEventListener('input', e => { view.envRotation = parseFloat(e.target.value); applyView(); });
  $('env-int').addEventListener('input', e => { view.envIntensity = parseFloat(e.target.value); applyView(); });
  for (const [id, dir] of [['shader-option-dec', -1], ['shader-option-inc', 1]]) $(id).onclick = () => {
    const k = shader(view.shader).option, o = SHADER_OPTIONS[k];
    if (!k) return;
    shaderOpts[k] = Math.min(o.max, Math.max(o.min, +(shaderOpts[k] + dir * o.step).toFixed(2)));
    applyView();
  };
  for (const b of $$('[data-mxf]')) b.onclick = () => cmd?.id === 'export-mesh' && cmd.key(b.dataset.mxf);
  for (const b of $$('[data-drf]')) b.onclick = () => cmd?.id === 'export-drawing' && cmd.key(b.dataset.drf);
  for (const b of $$('[data-grow]')) b.onclick = () => setOffsetGrow(b.dataset.grow);
  $('dr-hidden').onclick = () => cmd?.id === 'export-drawing' && cmd.key('hidden');
  $('dr-curves').onclick = () => cmd?.id === 'export-drawing' && cmd.key('curves');
  $('av-v').addEventListener('input', () => cmd?.id === 'align-vertex' && cmd.preview());
  $('patch-tol').addEventListener('input', () => cmd?.id === 'patch' && cmd.preview());
  for (const id of ['rb-n', 'rb-p']) $(id).addEventListener('input', () => cmd?.id === 'rebuild' && cmd.preview());
  for (const id of ['dc-su', 'dc-sv', 'dc-sn', 'dc-ou', 'dc-ov', 'dc-on']) $(id).addEventListener('input', () => cmd?.id === 'deform-curve' && cmd.preview());
  for (const id of ['im-w', 'im-o']) $(id).addEventListener('input', () => cmd?.id === 'image' && cmd.input());
  for (const b of $$('[data-imdepth]')) b.onclick = () => cmd?.id === 'image' && cmd.set('depth', b.dataset.imdepth);
  for (const b of $$('[data-imcull]')) b.onclick = () => cmd?.id === 'image' && cmd.set('culling', b.dataset.imcull);
  $('im-delete').onclick = () => cmd?.id === 'image' && cmd.remove();
  for (const b of $$('[data-inmode]')) b.onclick = () => cmd?.id === 'instance' && cmd.mode(b.dataset.inmode);
  $('cc-extend').onclick = () => cmd?.id === 'cut-curve' && cmd.key('extend');
  $('cc-screen').onclick = () => cmd?.id === 'cut-curve' && cmd.key('screen');
  $('in-realize').onclick = () => cmd?.id === 'instance' && cmd.realize();
  $('in-dup').onclick = () => cmd?.id === 'instance' && cmd.duplicate();
  $('in-delete').onclick = () => cmd?.id === 'instance' && cmd.remove();
  for (const b of $$('[data-dcflip]')) b.onclick = () => cmd?.id === 'deform-curve' && cmd.setFlip(b.dataset.dcflip, !cmd.flips[b.dataset.dcflip]);
  $('dc-keep').onclick = () => cmd?.id === 'deform-curve' && cmd.setKeep(!cmd.keep);
  $('dc-reblend').onclick = () => cmd?.id === 'deform-curve' && cmd.setReblend(!cmd.reblend);
  for (const id of ['rf-tol', 'rf-du', 'rf-dv', 'rf-su', 'rf-sv', 'rf-eu', 'rf-ev']) $(id).addEventListener('input', () => cmd?.id === 'rebuild-face' && cmd.preview());
  for (const b of $$('[data-rbmethod]')) b.onclick = () => cmd?.id === 'rebuild-face' && cmd.setMethod(b.dataset.rbmethod);
  $('rf-shrink').onclick = () => cmd?.id === 'rebuild-face' && cmd.setShrink(!cmd.shrink);
  for (const b of $$('[data-mfgrow]')) b.onclick = () => cmd?.id === 'match-face' && cmd.setGrow(b.dataset.mfgrow);
  for (const b of $$('[data-drtaper]')) b.onclick = () => cmd?.id === 'draft' && cmd.taperTo(b.dataset.drtaper);
  for (const b of $$('[data-drgrow]')) b.onclick = () => cmd?.id === 'draft' && cmd.growTo(b.dataset.drgrow);
  $('ut-keep').onclick = () => cmd?.id === 'untrim' && cmd.setKeep(!cmd.keep);
  $('section-btn').onclick = () => doAction('section');
  $('pl-flip').onclick = () => cmd?.id === 'place' && cmd.key('flip');
  $('pl-instance').onclick = () => cmd?.id === 'place' && cmd.key('instance');
  for (const id of ['pl-scale', 'pl-angle', 'pl-d']) $(id).oninput = () => cmd?.id === 'place' && cmd.preview();
  for (const b of $$('[data-plaxis]')) b.onclick = () => cmd?.id === 'place' && cmd.key(b.dataset.plaxis === 'normal' ? 'axis-normal' : `axis-${b.dataset.plaxis}`);
  for (const b of $$('[data-plop]')) b.onclick = () => cmd?.id === 'place' && cmd.key(b.dataset.plop);
  $('sa-flip').onclick = () => cmd?.id === 'section' && cmd.key('flip');
  $('sa-d').oninput = () => cmd?.id === 'section' && cmd.preview();
  for (const b of $$('[data-txfont]')) b.onclick = () => cmd?.id === 'text' && cmd.setFont(+b.dataset.txfont);
  for (const b of $$('[data-txalign]')) b.onclick = () => cmd?.id === 'text' && cmd.setAlign(b.dataset.txalign);
  for (const b of $$('[data-saplane]')) b.onclick = () => cmd?.id === 'section' && cmd.setHow(b.dataset.saplane);
  $('oe-d').addEventListener('input', () => cmd?.id === 'offset-edge' && cmd.preview());
  for (const b of $$('[data-oecorner]')) b.onclick = () => cmd?.id === 'offset-edge' && cmd.setCorner(b.dataset.oecorner);
  $('oe-both').onclick = () => cmd?.id === 'offset-edge' && cmd.setBoth(!cmd.both);
  $('oe-individual').onclick = () => cmd?.id === 'offset-edge' && cmd.setIndividual(!cmd.individual);
  for (const b of $$('[data-isodir]')) b.onclick = () => cmd?.id === 'isoparam' && cmd.setDir(b.dataset.isodir === 'u');
  $('iso-subdivide').onclick = () => cmd?.id === 'isoparam' && cmd.setSubdivide(!cmd.subdivide);
  for (const k of ['iso-count', 'iso-param']) $(k).oninput = () => cmd?.id === 'isoparam' && cmd.preview();
  for (const b of $$('[data-accont]')) b.onclick = () => cmd?.id === 'align-curve' && cmd.setContinuity(b.dataset.accont);
  for (const id of ['ac-p', 'ac-t']) $(id).addEventListener('input', () => cmd?.id === 'align-curve' && cmd.preview());
  $('ac-comb').onclick = () => cmd?.id === 'align-curve' && cmd.key('view-curvature');
  $('ac-constrain').onclick = () => cmd?.id === 'align-curve' && cmd.key('constrain');
  for (const b of $$('[data-avaxis]')) b.onclick = () => cmd?.id === 'align-vertex' && cmd.setAxis(b.dataset.avaxis);
  for (const id of ['oc-d', 'fc-r', 'ov-d', 'fv-r', 'sl-d']) $(id).addEventListener('input', () => ['offset-curve', 'fillet-curve', 'offset-vertex', 'fillet-vertex', 'slide'].includes(cmd?.id) && cmd.preview());
  for (const b of $$('[data-sldir]')) b.onclick = () => cmd?.id === 'slide' && cmd.setDir(b.dataset.sldir);
  $('br-start').onclick = () => cmd?.id === 'bridge' && cmd.cycleEnd(0);
  for (const id of ['br-p1', 'br-p2']) $(id).addEventListener('input', () => cmd?.id === 'bridge' && cmd.preview());
  $('br-trim').onclick = () => cmd?.id === 'bridge' && cmd.key('trim');
  $('br-constrain').onclick = () => cmd?.id === 'bridge' && cmd.key('constrain');
  $('br-comb').onclick = () => cmd?.id === 'bridge' && cmd.key('comb');
  for (const b of $$('[data-braxis]')) b.onclick = () => cmd?.id === 'bridge' && cmd.setAxis(b.dataset.braxis);
  for (const b of $$('[data-beaxis]')) b.onclick = () => cmd?.id === 'bridge-edge' && cmd.key(`axis-${b.dataset.beaxis}`);
  for (const id of ['be-p1', 'be-p2', 'be-t1a', 'be-t1b', 'be-t2a', 'be-t2b', 'be-t3a', 'be-t3b']) $(id).addEventListener('input', () => cmd?.id === 'bridge-edge' && cmd.preview());
  $('be-start').onclick = () => cmd?.id === 'bridge-edge' && cmd.cycleEnd(0);
  for (const b of $$('[data-sqcont]')) b.onclick = () => cmd?.id === 'square' && cmd.setContinuity(b.dataset.sqcont);
  for (const id of ['sq-d', 'sq-u', 'sq-v', 'sq-t', 'sq-flat', 'sq-w']) $(id).addEventListener('input', () => cmd?.id === 'square' && cmd.preview());
  $('sq-quad').onclick = () => cmd?.id === 'square' && cmd.key('quad');
  $('sq-analysis').onclick = () => cmd?.id === 'square' && cmd.setAnalysis(!cmd.analysis);
  for (const id of ['sq-tg0', 'sq-tg1', 'sq-tg2']) $(id).addEventListener('input', () => cmd?.id === 'square' && cmd.analyse());
  for (const b of $$('[data-sqquality]')) b.onclick = () => { if (cmd?.id === 'square') { cmd.quality = b.dataset.sqquality; cmd.preview(); } };
  for (const b of $$('[data-sqbound]')) b.onclick = () => { if (cmd?.id === 'square') { cmd.boundary = b.dataset.sqbound; cmd.preview(); } };
  for (const b of $$('[data-csopt]')) b.onclick = () => { if (cmd?.id === 'constrained-surface') { cmd.optimize = b.dataset.csopt; cmd.preview(); } };
  for (const id of ['cs-tol', 'cs-ang']) $(id).addEventListener('input', () => cmd?.id === 'constrained-surface' && num(id) > 0 && cmd.preview());
  for (const b of $$('[data-pacont]')) b.onclick = () => cmd?.id === 'project-align' && cmd.setContinuity(b.dataset.pacont);
  for (const b of $$('[data-padir]')) b.onclick = () => cmd?.id === 'project-align' && cmd.setDirection(b.dataset.padir);
  for (const id of ['pa-t', 'pa-blend']) $(id).addEventListener('input', () => cmd?.id === 'project-align' && num('pa-t') > 0 && cmd.preview());
  for (const b of $$('[data-ascont]')) b.onclick = () => cmd?.id === 'align-surface' && cmd.setContinuity(b.dataset.ascont);
  $('as-symmetric').onclick = () => cmd?.id === 'align-surface' && cmd.setSymmetric(!cmd.symmetric);
  for (const b of $$('[data-asbound]')) b.onclick = () => { if (cmd?.id === 'align-surface') { cmd.boundary = b.dataset.asbound; cmd.preview(); } };
  $('as-analysis').onclick = () => cmd?.id === 'align-surface' && cmd.setAnalysis(!cmd.analysis);
  for (const id of ['as-tg0', 'as-tg1', 'as-tg2']) $(id).addEventListener('input', () => cmd?.id === 'align-surface' && cmd.analyse());
  $('as-t').addEventListener('input', () => cmd?.id === 'align-surface' && num('as-t') > 0 && cmd.preview());
  for (const id of ['as-blend', 'as-infl', 'as-p0', 'as-p1', 'as-deg', 'as-spans']) $(id).addEventListener('input', () => cmd?.id === 'align-surface' && cmd.preview());
  $('be-end').onclick = () => cmd?.id === 'bridge-edge' && cmd.cycleEnd(1);
  $('br-end').onclick = () => cmd?.id === 'bridge' && cmd.cycleEnd(1);
  $('oc-lock').onclick = () => cmd?.id === 'offset-curve' && cmd.key('lock');
  for (const b of $$('[data-extshape]')) b.onclick = () => setExtShape(b.dataset.extshape);
  $('oc-slot').onclick = () => cmd?.id === 'offset-curve' && cmd.key('slot');
  $('oc-combine').onclick = () => cmd?.id === 'offset-curve' && cmd.key('combine');
  $('oc-free').onclick = () => cmd?.id === 'offset-curve' && cmd.key('freestyle');
  for (const k of OFFSET_CORNERS) $(`oc-${k}`).onclick = () => {
    for (const j of OFFSET_CORNERS) $(`oc-${j}`).setAttribute('aria-pressed', j === k);
    if (cmd?.id === 'offset-curve') cmd.preview();
  };
  for (const id of ['prim-w', 'prim-d', 'prim-r', 'prim-h']) $(id).addEventListener('input', () => PRIMS[cmd?.id] && cmd.fromFields(id));
  $('prim-keep').onclick = () => PRIMS[cmd?.id] && cmd.key('keep');
  const setPoleOpt = (k, v) => {
    poleOpts[k] = v;
    for (const b of $$('[data-pfmode]')) b.setAttribute('aria-pressed', b.dataset.pfmode === poleOpts.mode);
    for (const b of $$('[data-pfmirror]')) b.setAttribute('aria-pressed', b.dataset.pfmirror === poleOpts.mirror);
    if (cmd?.poles?.length) apply();
  };
  for (const b of $$('[data-pfmode]')) b.onclick = () => setPoleOpt('mode', b.dataset.pfmode);
  for (const b of $$('[data-pfmirror]')) b.onclick = () => setPoleOpt('mirror', b.dataset.pfmirror);
  for (const [id, k] of [['pf-u', 'fu'], ['pf-v', 'fv']]) $(id).oninput = e => { const v = +e.target.value; if (v > 0) setPoleOpt(k, v); };
  for (const b of $$('[data-popt], [data-pop]')) b.onclick = () => PRIMS[cmd?.id] && cmd.key(b.dataset.popt ?? b.dataset.pop);
  $('shell-t').addEventListener('input', () => cmd?.id === 'shell' && cmd.preview());
  $('draft-a').addEventListener('input', () => cmd?.id === 'draft' && cmd.preview());
  $('draft-d').addEventListener('input', () => cmd?.id === 'draft' && cmd.preview());
  for (const id of ['mirror-at', 'ra-cx', 'ra-cy', 'ra-cz', 'ra-sx', 'ra-sy', 'ra-sz', 'rr-count', 'rr-angle', 'ca-count']) $(id).addEventListener('input', () => cmd?.preview?.());
  for (const b of $$('[data-mx], [data-rx]')) b.onclick = () => cmd?.key?.(b.dataset.mx ?? b.dataset.rx);
  $('mirror-neg').onclick = () => cmd?.id === 'mirror' && cmd.key('negative');
  $('mirror-cut').onclick = () => cmd?.id === 'mirror' && cmd.key('cut');
  $('mirror-free').onclick = () => cmd?.id === 'mirror' && cmd.key('freestyle');
  for (const id of ['mirror-join', 'ra-join', 'rr-join', 'ca-join']) $(id).onclick = () => cmd?.key?.('join');
  for (const [id, m] of [['ra-spacing', 'spacing'], ['ra-extent', 'extent'], ['rr-total', 'total'], ['rr-spacing', 'spacing']]) $(id).onclick = () => cmd?.key?.(m);
  $('ca-align').onclick = () => cmd?.id === 'curve-array' && cmd.key('align');
  for (const id of ['mirror-instance', 'ra-instance', 'rr-instance', 'ca-instance']) $(id).onclick = () => cmd?.key?.('instance');
  $('cut-plane').onclick = () => cmd?.id === 'cut' && cmd.key('plane');
  $('bs-t').addEventListener('input', () => cmd?.id === 'bridge-surface' && cmd.preview());
  $('bs-w').addEventListener('input', () => cmd?.id === 'bridge-surface' && cmd.preview());
  for (const b of $$('[data-bsshape]')) b.onclick = () => cmd?.id === 'bridge-surface' && cmd.set('shape', b.dataset.bsshape);
  for (const b of $$('[data-bstrim]')) b.onclick = () => cmd?.id === 'bridge-surface' && cmd.set('trim', b.dataset.bstrim);
  $('bs-add').onclick = () => cmd?.id === 'bridge-surface' && cmd.key('add-pair');
  $('bs-s1').onclick = () => cmd?.id === 'bridge-surface' && cmd.flip(0);
  $('bs-s2').onclick = () => cmd?.id === 'bridge-surface' && cmd.flip(1);
  $('es-d').addEventListener('input', () => cmd?.id === 'extend-sheet' && cmd.preview());
  for (const b of $$('[data-esshape]')) b.onclick = () => cmd?.id === 'extend-sheet' && cmd.setShape(b.dataset.esshape);
  for (const b of $$('[data-flshape]')) b.onclick = () => setFilletShape(b.dataset.flshape);
  $('blend-tangent').onclick = () => cmd?.id === 'fillet' && setFilletTangent(!cmd.tangent);
  $('blend-tension').addEventListener('input', () => {
    const t = parseFloat($('blend-tension').value);
    if (cmd?.id === 'fillet' && t >= 0.05 && t <= 0.95) { cmd.tension = t; cmd.good = cmd.bad = null; previewFillet(); }
  });
  for (const b of $$('[data-eslimit]')) b.onclick = () => cmd?.id === 'extend-sheet' && cmd.setOutside(b.dataset.eslimit === 'outside');
  $('es-unlimit').onclick = () => cmd?.id === 'extend-sheet' && cmd.setLimit(null);
  for (const f of ['th-f', 'th-b']) $(f).addEventListener('input', () => cmd?.id === 'thicken' && cmd.preview());
  for (const f of ['pipe-r', 'pipe-t', 'pipe-v']) $(f).addEventListener('input', () => cmd?.id === 'pipe' && cmd.preview());
  $('patch-tangent').onclick = () => cmd?.id === 'patch' && cmd.key('tangent');
  $('patch-quad').onclick = () => cmd?.id === 'patch' && cmd.key('quad');
  for (const b of $$('[data-pcont]')) b.onclick = () => cmd?.id === 'patch' && cmd.setCont(b.dataset.pcont);
  for (const b of $$('[data-pmethod]')) b.onclick = () => cmd?.id === 'patch' && cmd.setMethod(b.dataset.pmethod);
  $('patch-individual').onclick = () => cmd?.id === 'patch' && cmd.key('individual');
  $('ex-free').onclick = () => cmd?.id === 'extrude' && cmd.key('freestyle');
  $('ex-pivot').onclick = () => cmd?.id === 'extrude' && cmd.key('pivot');
  $('ex-individual').onclick = () => cmd?.id === 'extrude' && cmd.key('individual');
  for (const b of $$('[data-gmethod]')) b.onclick = () => { if (cmd?.id === 'sweep') { setForm({ method: b.dataset.gmethod }); setGuideChips(cmd); } };
  for (const b of $$('[data-galign]')) b.onclick = () => { if (cmd?.id === 'sweep') { setForm({ align: b.dataset.galign }); setGuideChips(cmd); } };
  for (const b of $$('[data-gcorner]')) b.onclick = () => { if (cmd?.id === 'sweep') { setForm({ corner: b.dataset.gcorner }); setGuideChips(cmd); } };
  for (const b of $$('[data-proj]')) b.onclick = () => cmd?.id === 'project' && cmd.key(b.dataset.proj);
  for (const b of $$('[data-imp]')) b.onclick = () => cmd?.id === 'imprint' && cmd.key(b.dataset.imp);
  for (const b of $$('[data-impcomp]')) b.onclick = () => cmd?.id === 'imprint' && cmd.key(`complete-${b.dataset.impcomp}`);
  $('bool-keep').onclick = () => cmd?.id === 'boolean' && cmd.key('keep');
  for (const b of $$('[data-draw]')) b.onclick = () => DRAW[cmd?.id] && cmd.key(b.dataset.draw);
  $('commit').onclick = () => finish();
  $('cancel').onclick = () => abort();
  $('undo').onclick = () => step('undo');
  $('isolated').onclick = () => doAction('unisolate');
  $('redo').onclick = () => step('redo');
  $('export').onclick = () => exportSelected();

  // --- keyboard -------------------------------------------------------------
  // In order: a handle or typed entry taking keys, the running command's own keys, then the
  // viewport's (keymap.js).
  addEventListener('keydown', async e => {
    if (palette || asking) return;
    // The Text command's box takes every key (its own handler finishes and cancels).
    if (e.target.tagName === 'TEXTAREA') return;
    const inInput = e.target.tagName === 'INPUT';
    if (inInput && e.key !== 'Enter' && e.key !== 'Escape') return;
    if (inInput) e.target.blur();
    const k = keyOf(e);
    if (k === 'ctrl' && cmd?.tc) snapsFor(!view.snap);
    // A dot being dragged or following the cursor.
    const live = liveGizmo();
    if (live?.busy && live.key(e)) { e.preventDefault(); return; }
    // The transform's cursor-follow.
    const f = cmd?.follow;
    if (f) {
      if (e.key === 'Escape') { e.preventDefault(); return endFollow(false); }
      if (e.key === 'Enter') { e.preventDefault(); return endFollow(true); }
      if (/^[0-9.\-]$/.test(e.key) || e.key === 'Backspace') {
        e.preventDefault();
        f.text = e.key === 'Backspace' ? f.text.slice(0, -1) : f.text + e.key;
        return followTyped(f);
      }
    }
    // A typed value (the fillet's A, a drawing's Tab).
    const entry = cmd?.entry;
    if (entry) {
      e.preventDefault();
      if (e.key === 'Escape') { cmd.entry = null; setHud(null); return cmd.entryDone?.(); }
      if (e.key === 'Enter') { cmd.entry = null; const v = typed(entry.text); if (v !== undefined) entry.apply(v); return cmd?.entryDone?.(); }
      // Tab takes the value and moves to the next one, where a command has several (Dimension).
      if (e.key === 'Tab' && entry.next) { cmd.entry = null; const v = typed(entry.text); if (v !== undefined) entry.apply(v); return entry.next(); }
      if (/^[0-9.\-]$/.test(e.key)) entry.text += e.key;
      else if (e.key === 'Backspace') entry.text = entry.text.slice(0, -1);
      return setHud(`${entry.label} ${entry.text}_`);
    }
    // Shift+X with a snap showing: skip that kind of snap for the rest of the command, so the
    // next one under the pointer comes up (Plasticity: switches off snap types, cycling).
    if (cmd && k === 'shift-x' && shownSnap && snapDot.visible) {
      e.preventDefault();
      cmd.snapSkip = [...(cmd.snapSkip ?? []), snapKindOf(shownSnap)];
      setHud(`${shownSnap} SNAPS SKIPPED`);
      if (lastPointer) canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: lastPointer.clientX, clientY: lastPointer.clientY, ctrlKey: lastPointer.ctrlKey, altKey: lastPointer.altKey, shiftKey: false, bubbles: true }));
      return;
    }
    if (cmd) {
      const action = COMMAND[cmd.id]?.[k];
      if (action && !(cmd.auto && !['distance', 'chamfer', 'angle', 'grow'].includes(action)) && cmd.key?.(action, e)) { e.preventDefault(); return; }
      if (e.key === 'Enter') { e.preventDefault(); return finish(); }
      if (e.key === 'Escape') {
        e.preventDefault();
        // An untouched default command goes, and Escape then deselects as it would with none.
        const auto = cmd.auto;
        abort();
        if (auto) { sel.clear(); selectionChanged({ quiet: true }); }
        return;
      }
    }
    const action = keys[k];
    if (!action) return;
    e.preventDefault();
    if (e.repeat && action.startsWith('radial:')) return;
    radialKey = action.startsWith('radial:') ? e.code : null;
    await doAction(action);
  });
  addEventListener('keyup', e => { if (e.key === 'Control' && cmd?.tc) snapsFor(view.snap); });

  // --- start --------------------------------------------------------------
  renderHistory();
  renderModes();
  setView('iso', { animate: false });
  setPlane({ origin: new THREE.Vector3(), normal: UP, name: 'XY' });
  showTool(null);
  showScene(await backend.scene());
  // The startup scene (Save As Startup Scene) carries groups, materials and images too.
  await restoreAppState();
  $('loading').hidden = true;
  // A model the app was started with opens straight away (desktop file association).
  if (typeof backend.startupFile === 'function') {
    const openStartup = async () => { try { const path = await backend.startupFile(); if (path) await openFile(path); } catch (e) { toast(say(e)); } };
    openStartup();
    backend.onOpenFile?.(openStartup);
  }

  function resize(force = false) {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (!force && canvas.width === Math.floor(w * renderer.getPixelRatio()) && canvas.height === Math.floor(h * renderer.getPixelRatio())) return;
    renderer.setSize(w, h, false);
    persp.aspect = w / h;
    persp.updateProjectionMatrix();
    const half = (ortho.top - ortho.bottom) / 2;
    ortho.left = -half * w / h; ortho.right = half * w / h;
    ortho.updateProjectionMatrix();
  }
  applyPrefs();
  renderer.setAnimationLoop(() => {
    resize();
    stepTurn(performance.now());
    if (!turning) controls.update();
    nav.update(camera, camera.isOrthographicCamera);
    if (cmd?.gizmo) cmd.gizmo.render(cmd.gizmo.value);
    for (const g of Object.values(cmd?.dots ?? {})) g.render(g.value);
    if (view.ao) renderAO(); else renderer.render(scene, camera);
  });

  /** Select by refs or numbers for `run`: edges of one body. */
  function selectEdgeRefs(refs) {
    const owner = current.find(b => refs?.length && refs.every(r => b.edgeRefs?.includes(r)));
    if (!owner) throw new Error('those edges are not all on one body any more');
    sel.clear();
    owner.edgeRefs.forEach((r, n) => { if (refs.includes(r)) sel.add({ kind: 'edge', body: owner.id, n }); });
  }
  function selectSolids(ids) {
    if (!ids.length || ids.some(id => !bodyOf(id))) throw new Error('that body no longer exists');
    sel.clear();
    for (const id of ids) sel.add({ kind: 'solid', body: id });
  }

  const api = {
    /** Start push/pull with its sketch placed, as a click would. */
    async begin(origin, normal, target) {
      await startTool('pushpull', { at: { origin: new THREE.Vector3(...origin), normal: new THREE.Vector3(...normal), target } });
    },
    setDistance: d => setDistance(d),
    commit: () => finish(), cancel: () => abort(), finish: () => finish(), abort: () => abort(), step,
    doAction, startTool, setView, setOrtho,
    /** Select edges by number on one body, as clicks would. */
    selectEdges(body, edges) {
      sel.clear();
      for (const n of edges) sel.add({ kind: 'edge', body, n });
      selectionChanged();
    },
    /** Replace the selection with `items` ({ kind, body, n } and the like), any kinds mixed. */
    select(items) {
      sel.clear();
      for (const it of items) sel.add(it);
      selectionChanged();
    },
    selectFaces(body, faces) {
      sel.clear();
      for (const n of faces) sel.add({ kind: 'face', body, n });
      selectionChanged();
    },
    selectBody(id, add = false) {
      if (!add) sel.clear();
      if (id !== null && id !== undefined) sel.add({ kind: 'solid', body: id });
      selectionChanged();
    },
    setMode: m => doAction(`mode:${m}`),
    setFillet: v => { if (cmd?.id === 'fillet') { cmd.auto = false; setFillet(v, false); } },
    setOffset, setAngle, setAxis, setFactor,
    setPlane(body, face) {
      if (body === undefined) return doAction('plane:world');
      sel.replace({ kind: 'face', body, n: face });
      selectionChanged({ quiet: true });
      planeFromSelection(false);
    },
    /** What a command would act on now, by ref: the context an AI request is checked against. */
    context() {
      const eb = edgeBody(), b = bodyOf(eb);
      const edges = sel.list('edge');
      return {
        revision: current[0]?.revision ?? 0,
        tool: cmd?.id ?? null,
        modes: [...sel.modes],
        edges: eb === null ? null : { body: eb, refs: edges.map(it => b.edgeRefs?.[it.n]).filter(r => r !== undefined), numbers: edges.map(it => it.n), count: b?.edges.length },
        faces: sel.list('face').map(it => ({ body: it.body, ref: bodyOf(it.body)?.faceRefs?.[it.n], number: it.n })),
        solids: sel.solids,
        body: sel.solids[0] ?? null,
        curves: sel.list('curve').map(it => it.id),
        regions: sel.list('region').map(it => it.id),
        plane: { name: cplane.name, origin: cplane.origin.toArray(), normal: cplane.normal.toArray() },
      };
    },
    /**
     * Start a registered tool with checked arguments and leave its preview for the user to adjust
     * and finish, as the AI command box will. Throws with the reasons when the arguments are wrong.
     * The selection is named by ref: `edges` (fillet), `body` (move, rotate, scale) or `face` (push/pull).
     */
    async run(id, args = {}) {
      const { edges, body, bodies: ids, face, faces, region, regions, path, target, tools, curves: curveIds, with: withBodies, ...rest } = args;
      const errors = check(id, rest);
      if (errors.length) throw new Error(errors.join('; '));
      const p = withDefaults(id, rest);
      if (cmd) abort();
      if (id === 'fillet') {
        selectEdgeRefs(edges);
        selectionChanged({ quiet: true });
        await startTool('fillet');
        cmd.angle = p.angle;
        $('blend-angle').value = p.angle;
        cmd.auto = false;
        setFillet(p.distance, false);
      } else if (id === 'move' || id === 'rotate' || id === 'scale') {
        selectSolids(ids ?? [body]);
        selectionChanged({ quiet: true });
        await startTool(id);
        if (id === 'move') setOffset(p.offset);
        else if (id === 'rotate') { setAxis(p.axis); setAngle(p.angle); }
        else setFactor(p.factor);
      } else if (id === 'pushpull') {
        const b = face !== undefined && current.find(x => x.faceRefs?.includes(face));
        const n = b ? b.faceRefs.indexOf(face) : -1, plane = b ? b.facePlanes[n] : null;
        if (face !== undefined && !plane) throw new Error('that face is gone or not flat');
        const at = plane ? { origin: faceCentre(b, n), normal: new THREE.Vector3(...plane.normal), target: b.id }
          : { origin: cplane.origin.clone(), normal: cplane.normal.clone(), target: null };
        setProfile(p.profile);
        size = p.size; $('size').value = size;
        await startTool('pushpull', { at });
        cmd.newBody = p.newBody;
        if (p.distance) setDistance(p.distance);
      } else if (id === 'extrude') {
        sel.clear();
        if (region !== undefined) {
          if (!curveList.some(c => c.id === region && isClosed(c))) throw new Error('that region is gone');
          sel.add({ kind: 'region', id: region });
        } else {
          const b = current.find(x => x.faceRefs?.includes(face));
          if (!b) throw new Error('give a region or a face to extrude');
          sel.add({ kind: 'face', body: b.id, n: b.faceRefs.indexOf(face) });
        }
        selectionChanged({ quiet: true });
        await startTool('extrude');
        if (cmd?.id !== 'extrude') throw new Error('that face is not flat');
        if (p.op !== 'auto') cmd.key(p.op);
        Object.assign(cmd, { angle: p.angle, thickness: p.thickness, lock: p.bothSides });
        setExtrudeShape({});
        setExtrude(p.distance, false);
      } else if (id === 'boolean') {
        selectSolids([target, ...(tools ?? [])]);
        selectionChanged({ quiet: true });
        await startTool('boolean');
        if (cmd?.id !== 'boolean') throw new Error('a boolean needs a target and at least one tool');
        cmd.op = p.op;
        cmd.keep = p.keepTools;
        await previewBooleanCmd();
      } else if (id === 'offset') {
        const b = current.find(x => (faces ?? []).every(r => x.faceRefs?.includes(r)));
        if (!b || !faces?.length) throw new Error('give faces of one body to offset');
        sel.clear();
        for (const r of faces) sel.add({ kind: 'face', body: b.id, n: b.faceRefs.indexOf(r) });
        selectionChanged({ quiet: true });
        await startTool('offset');
        if (cmd?.id !== 'offset') throw new Error('those faces cannot be offset');
        cmd.auto = false;
        if (p.angle) setOffsetAngle(p.angle);
        setOffsetDistance(p.distance ?? 0, false);
      } else if (id === 'draft') {
        const b = current.find(x => (faces ?? []).every(r => x.faceRefs?.includes(r)));
        if (!b || !faces?.length) throw new Error('give faces of one body to draft');
        sel.clear();
        for (const r of faces) sel.add({ kind: 'face', body: b.id, n: b.faceRefs.indexOf(r) });
        selectionChanged({ quiet: true });
        $('draft-a').value = p.angle;
        draftAboutPlane = true; // the AI's draft tilts all its faces about the construction plane
        await startTool('draft');
        if (cmd?.id !== 'draft') throw new Error('those faces cannot be drafted');
      } else if (id === 'remove-face') {
        const b = current.find(x => (faces ?? []).every(r => x.faceRefs?.includes(r)));
        if (!b || !faces?.length) throw new Error('give faces of one body to remove');
        sel.clear();
        for (const r of faces) sel.add({ kind: 'face', body: b.id, n: b.faceRefs.indexOf(r) });
        selectionChanged({ quiet: true });
        await startTool('remove-face');
      } else if (id === 'hole') {
        const b = current.find(x => x.faceRefs?.includes(face));
        const n = b ? b.faceRefs.indexOf(face) : -1, plane = b ? b.facePlanes[n] : null;
        if (!plane) throw new Error('give a flat face of a solid for the hole');
        $('hole-d').value = p.diameter;
        $('hole-depth').value = p.depth;
        await startTool('hole', { at: { origin: faceCentre(b, n), normal: new THREE.Vector3(...plane.normal), target: b.id } });
        if (p.through) cmd.key('through');
      } else if (id === 'bridge') {
        const ids = (curveIds ?? []).filter(cid => curveList.some(c => c.id === cid));
        if (ids.length !== 2) throw new Error('give two open curves by id');
        sel.clear();
        for (const cid of ids) sel.add({ kind: 'curve', id: cid });
        selectionChanged({ quiet: true });
        $('br-t1a').value = $('br-t1b').value = p.tension;
        await startTool('bridge');
      } else if (id === 'cut') {
        const cs = (curveIds ?? []).filter(cid => curveList.some(c => c.id === cid));
        const bs = (ids ?? []).filter(b => current.some(x => x.id === b));
        const fs = (faces ?? []).map(r => { const b = current.find(x => x.faceRefs?.includes(r)); return b && { body: b.id, n: b.faceRefs.indexOf(r) }; }).filter(Boolean);
        if (!bs.length || !(cs.length || fs.length || p.plane)) throw new Error('give the solids to cut, by id, and curves, faces or the plane to cut with');
        sel.clear();
        for (const b of bs) sel.add({ kind: 'solid', body: b });
        for (const cid of cs) sel.add({ kind: 'curve', id: cid });
        for (const f of fs) sel.add({ kind: 'face', body: f.body, n: f.n });
        selectionChanged({ quiet: true });
        await startTool('cut');
        if (p.plane) cmd.key('plane');
      } else if (id === 'project') {
        const cs = (curveIds ?? []).filter(cid => curveList.some(c => c.id === cid));
        const bs = (ids ?? []).filter(b => current.some(x => x.id === b));
        if (!(bs.length === 1 && cs.length) && !(bs.length === 2 && !cs.length) && !(cs.length === 2 && !bs.length)) throw new Error('give a solid and curves, two solids, or two curves, by id');
        sel.clear();
        for (const b of bs) sel.add({ kind: 'solid', body: b });
        for (const cid of cs) sel.add({ kind: 'curve', id: cid });
        selectionChanged({ quiet: true });
        await startTool('project');
        const d = p.direction ?? '-z';
        if (p.method === 'vector' || d === 'screen') {
          if (d === 'screen') cmd.key('screen');
          else { cmd.key('vector'); cmd.key(`axis-${d.at(-1)}`); if (d.startsWith('-')) cmd.key(`axis-${d.at(-1)}`); }
          if (p.bidirectional) cmd.key('both');
          if (p.hideOccluded) cmd.key('hide');
        }
      } else if (id === 'extend-sheet') {
        if (edges?.length !== 1) throw new Error('give the one sheet edge to extend, by ref');
        const owner = current.find(b => b.edgeRefs?.includes(edges[0]));
        if (!owner) throw new Error('that edge no longer exists');
        sel.replace({ kind: 'edge', body: owner.id, n: owner.edgeRefs.indexOf(edges[0]) });
        selectionChanged({ quiet: true });
        $('es-d').value = p.distance;
        await startTool('extend-sheet');
        if (cmd?.id !== 'extend-sheet') throw new Error('give an edge of a sheet to extend');
      } else if (id === 'thicken') {
        selectSolids([body]);
        selectionChanged({ quiet: true });
        $('th-f').value = p.front;
        $('th-b').value = p.back;
        await startTool('thicken');
        if (cmd?.id !== 'thicken') throw new Error('give a sheet body to thicken');
      } else if (id === 'bridge-surface') {
        if (edges?.length !== 2) throw new Error('give the two edges to bridge, by ref');
        sel.clear();
        for (const r of edges) {
          const owner = current.find(b => b.edgeRefs?.includes(r));
          if (!owner) throw new Error('that edge no longer exists');
          sel.add({ kind: 'edge', body: owner.id, n: owner.edgeRefs.indexOf(r) });
        }
        selectionChanged({ quiet: true });
        $('bs-t').value = p.tension;
        await startTool('bridge-surface');
      } else if (id === 'pipe') {
        const cs = (curveIds ?? []).filter(cid => curveList.some(c => c.id === cid));
        if (!cs.length) throw new Error('give the curves to run pipes along, by id');
        sel.clear();
        for (const cid of cs) sel.add({ kind: 'curve', id: cid });
        selectionChanged({ quiet: true });
        $('pipe-r').value = p.radius;
        $('pipe-t').value = p.thickness;
        $('pipe-v').value = p.sides;
        await startTool('pipe');
        if (cmd?.id !== 'pipe') throw new Error('give the curves to run pipes along');
      } else if (id === 'patch') {
        const cs = (curveIds ?? []).filter(cid => curveList.some(c => c.id === cid));
        if (!cs.length && !edges?.length) throw new Error('give curves by id or edges by ref that make one closed loop');
        if (edges?.length) selectEdgeRefs(edges); else sel.clear();
        for (const cid of cs) sel.add({ kind: 'curve', id: cid });
        selectionChanged({ quiet: true });
        await startTool('patch');
        if (p.tangent) cmd.key('tangent');
      } else if (id === 'imprint') {
        const cs = (curveIds ?? []).filter(cid => curveList.some(c => c.id === cid));
        const b = body !== undefined ? current.find(x => x.id === body) : current.find(x => (faces ?? []).length && faces.every(r => x.faceRefs?.includes(r)));
        const others = (withBodies ?? []).filter(o => o !== b?.id && current.some(x => x.id === o));
        if (!b || !(cs.length || others.length)) throw new Error('give the body or faces of one body to imprint on, and curves or other bodies by id');
        sel.clear();
        if (faces?.length) for (const r of faces) sel.add({ kind: 'face', body: b.id, n: b.faceRefs.indexOf(r) });
        else sel.add({ kind: 'solid', body: b.id });
        for (const o of others) sel.add({ kind: 'solid', body: o });
        for (const cid of cs) sel.add({ kind: 'curve', id: cid });
        selectionChanged({ quiet: true });
        await startTool('imprint');
      } else if (id === 'offset-curve' || id === 'fillet-curve') {
        const ids = (curveIds ?? []).filter(cid => curveList.some(c => c.id === cid));
        if (!ids.length) throw new Error('give the curves by id');
        sel.clear();
        for (const cid of ids) sel.add({ kind: 'curve', id: cid });
        selectionChanged({ quiet: true });
        $(id === 'offset-curve' ? 'oc-d' : 'fc-r').value = id === 'offset-curve' ? p.distance : p.radius;
        if (id === 'offset-curve') for (const k of OFFSET_CORNERS) $(`oc-${k}`).setAttribute('aria-pressed', k === (p.corner ?? 'linear'));
        await startTool(id);
      } else if (PRIMS[id]) {
        const b = face !== undefined && current.find(x => x.faceRefs?.includes(face));
        const n = b ? b.faceRefs.indexOf(face) : -1, plane = b ? b.facePlanes[n] : null;
        if (face !== undefined && !plane) throw new Error('that face is gone or not flat');
        const at = plane ? { origin: faceCentre(b, n), normal: new THREE.Vector3(...plane.normal), target: b.id }
          : { origin: cplane.origin.clone(), normal: cplane.normal.clone(), target: null };
        if (id === 'box' || id === 'center-box' || id === 'box3') { $('prim-w').value = p.width; $('prim-d').value = p.depth; $('prim-h').value = p.height; }
        if (id === 'cylinder') { $('prim-r').value = 2 * p.radius; $('prim-h').value = p.height; }
        if (id === 'sphere') $('prim-r').value = 2 * p.radius;
        await startTool(id, { at });
      } else if (id === 'shell') {
        const b = current.find(x => (faces ?? []).every(r => x.faceRefs?.includes(r)));
        if (!b || !faces?.length) throw new Error('give faces of one body to leave open');
        sel.clear();
        for (const r of faces) sel.add({ kind: 'face', body: b.id, n: b.faceRefs.indexOf(r) });
        $('shell-t').value = p.thickness;
        selectionChanged({ quiet: true });
        await startTool('shell');
      } else if (id === 'curve-array') {
        if (!curveList.some(c => c.id === path)) throw new Error('give the curve to array along, by id');
        selectSolids(ids ?? [body]);
        selectionChanged({ quiet: true });
        $('ca-count').value = Math.max(1, Math.round(p.count));
        await startTool(id);
        if (cmd?.id !== id) throw new Error('select a solid to array along a curve');
        cmd.curve = path;
        if (p.align === false) cmd.key('align'); else cmd.preview();
        if (p.join) cmd.key('join');
      } else if (id === 'mirror' || id === 'rect-array' || id === 'radial-array') {
        selectSolids(ids ?? [body]);
        selectionChanged({ quiet: true });
        if (id === 'mirror') $('mirror-at').value = p.position;
        if (id === 'rect-array') ['x', 'y', 'z'].forEach((a, i) => { $(`ra-c${a}`).value = Math.max(1, Math.round(p.counts[i])); $(`ra-s${a}`).value = p.spacing[i]; });
        if (id === 'radial-array') { $('rr-count').value = Math.max(1, Math.round(p.count)); $('rr-angle').value = p.angle; }
        await startTool(id);
        if (cmd?.id !== id) throw new Error(`select a solid to ${toolInfo(id).label.toLowerCase()}`);
        if (p.axis && id !== 'rect-array') cmd.key(p.axis);
        if (p.join) cmd.key('join');
      } else if (FORMS[id]) {
        const list = id === 'loft' ? regions ?? [] : [region];
        if (!list.length || !list.every(r => curveList.some(c => c.id === r && isClosed(c)))) throw new Error('that region is gone');
        if (id === 'sweep' && !curveList.some(c => c.id === path)) throw new Error('that path is gone');
        sel.clear();
        for (const r of list) sel.add({ kind: 'region', id: r });
        selectionChanged({ quiet: true });
        await startTool(id);
        if (cmd?.id !== id) throw new Error(`those regions cannot be used for ${id}`);
        const fromUser = ([x, y, z]) => new THREE.Vector3(x, z, -y);
        if (id === 'revolve') {
          cmd.p1 = fromUser(p.axisPoint);
          cmd.p2 = cmd.p1.clone().add(fromUser(p.axisDir));
          if (cmd.p2.distanceTo(cmd.p1) < 1e-9) throw new Error('the axis needs a direction');
          cmd.line = axisLine();
          updateAxisLine(cmd.p2);
        }
        if (id === 'sweep') cmd.path = path;
        if (id !== 'revolve') {
          const guides = (curveIds ?? []).filter(cid => curveList.some(c => c.id === cid));
          if (guides.length !== (curveIds ?? []).length) throw new Error('that guide is gone');
          cmd.guides = guides;
        }
        if (id !== 'loft') { cmd.op = p.op; setFormOps(); }
        setForm(id === 'revolve' ? { angle: p.angle, thickness: p.thickness } : id === 'sweep' ? { twist: p.twist, scale: p.scale, method: p.method, align: p.align } : {});
        setGuideChips(cmd);
      }
    },
    /** Where a point (viewport coordinates) is on the page, in CSS pixels. */
    project(p) {
      const r = canvas.getBoundingClientRect(), s = new THREE.Vector3(...p).project(camera);
      return [(s.x + 1) / 2 * r.width + r.left, (1 - s.y) / 2 * r.height + r.top];
    },
    get selection() { return sel.list().map(it => ({ ...it })) },
    get modes() { return [...sel.modes] },
    get command() {
      const c = cmd;
      if (!c) return null;
      // Not every command's handle is a dot with a direction (Place carries the move gizmo).
      const out = { id: c.id, auto: !!c.auto, dot: c.gizmo?.direction ? { at: c.gizmo.position.toArray(), dir: c.gizmo.direction.toArray(), state: c.gizmo.state } : null };
      if (c.id === 'fillet') Object.assign(out, { body: c.body, edges: c.edges, value: c.value, angle: c.angle, max: c.bad !== null ? c.good : null });
      // Place carries the move gizmo without a transform of its own, so its offset may be unset.
      if (c.tc) Object.assign(out, { bodies: c.ids, offset: c.offset ? toUser(c.offset.toArray()) : null, angle: c.quat ? angleAbout(c.quat, c.axis) : 0, axis: c.axis, scale: c.scale, follow: c.follow?.name ?? null });
      if (c.id === 'pushpull') Object.assign(out, { placed: !!c.at, distance: c.distance });
      if (c.dots) out.dots = Object.fromEntries(Object.entries(c.dots).map(([k, g]) => [k, { at: g.position.toArray(), dir: g.direction.toArray(), value: g.value, state: g.state }]));
      if (c.id === 'extrude') Object.assign(out, { region: c.src.region ?? null, face: c.src.face ?? null, target: c.src.target, distance: c.distance, op: c.op, outcome: c.outcome, angle: c.angle, thickness: c.thickness, lock: c.lock });
      if (c.id === 'boolean') Object.assign(out, { target: c.target, tools: c.tools, op: c.op, keep: c.keep });
      if (c.id === 'offset') Object.assign(out, { body: c.body, faces: c.faces, distance: c.distance, angle: c.angle });
      if (FORMS[c.id]) Object.assign(out, { regions: c.regions, target: c.target, op: c.op, outcome: c.outcome, axis: c.p1 && c.p2 ? [c.p1.toArray(), c.p2.toArray()] : null, angle: c.angle, thickness: c.thickness, path: c.path, twist: c.twist, scale: c.scale });
      if (c.id === 'spiral') Object.assign(out, { step: c.step, turns: c.turns, radius: c.radius, length: c.length, left: c.left, angle: c.length ? spiralAngle(c) / DEG : 0, axis: c.axis, entry: c.entry?.label ?? null });
      else if (DRAW[c.id]) Object.assign(out, { placed: !!c.plane, points: c.pts.length, square: c.square, centre: c.centre, vertical: c.vertical, axis: c.axis, flip: c.flip, entry: c.entry?.label ?? null });
      return out;
    },
    get plane() { return { name: cplane.name, origin: cplane.origin.toArray(), normal: cplane.normal.toArray() } },
    get hidden() { return current.map(b => b.id).filter(id => !org.shows(id)) },
    get organise() { return { locked: [...org.locked], isolated: org.isolated, layers: org.layers.length, groups: org.groups.map(g => ({ ...g, members: org.allMembers(g.id, current.map(b => b.id)) })) } },
    get ortho() { return camera.isOrthographicCamera },
    get camera() { return { position: camera.position.toArray(), target: controls.target.toArray(), up: camera.up.toArray() } },
    get bodies() { return current },
    get curves() { return curveList },
    get instances() { return instances.map(n => ({ id: n.id, master: n.master, curve: !!n.curve })) },
    get history() { return history.slice(0, history.length - undone).map(h => h.text) },
    /** Turn a sentence into a command with its preview, as the ASK box does. */
    ask,
    get lastAsk() { return lastAsk },
  };
  return api;
}

/** Whether segments pq and rs cross. */
function crosses(p, q, r, s) {
  const d = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(r, s, p), d2 = d(r, s, q), d3 = d(p, q, r), d4 = d(p, q, s);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
function inTriangle(p, a, b, c) {
  const d = (u, v, w) => (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x);
  const s1 = d(a, b, p), s2 = d(b, c, p), s3 = d(c, a, p);
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
}
