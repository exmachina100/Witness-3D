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
import { MagnitudeGizmo, typed } from '../MagnitudeGizmo.js';
import { TOOLS, check, tool as toolInfo, withDefaults } from './tools.js';
import { ACTIONS, COMMAND, VIEWPORT, keyFor, keyOf } from './keymap.js';
import { Selection } from './Selection.js';
import { Organise } from './Organise.js';
import { P_MENU, RADIALS, mergeKeys, parseRadial, shortLabel, showKey, sliceAt, slicePosition } from './menus.js';
import { ENVIRONMENTS, SHADERS, SHADER_OPTIONS, checkMaterial, formatMass, massOf, newMaterial, shader } from './shading.js';
import { claude, describe, MODEL, reply, request } from './ai.js';
import { icon } from './icons.js';
import { limitEdges, toObj, toStl } from '../meshExport.js';
import { flatten, toDxf, toSvg } from '../drawingExport.js';
import { readDxf } from '../dxf.js';
import { bridgeCurves, continuity, curvatureComb, explode, extendCurve, filletCurve, nearestEnd, OFFSET_CORNERS, offsetCurve, offsetThrough, splitCurve, tangentCircle, trim } from '../curveEdit.js';
import { ViewGizmo } from './ViewGizmo.js';
import { Toolbar } from './Toolbar.js';
import { arcPoints, circleThrough, cvPoints, ellipsePoints, endTangent, helixPoints, loops, nurbsLoop, nurbsPoints, polygonCorners, spiralAngle, tangentArc } from '../curves.js';

const KEYS = {
  material: [['FORK', 'OWN COPY'], ['⏎ / RMB', 'OK'], ['ESC', 'CANCEL']],
  idle: [['CLICK', 'SELECT'], ['⇧ CLICK', 'ADD'], ['CTRL CLICK', 'REMOVE'], ['DRAG', 'BOX'], ['MMB', 'ORBIT'], ['RMB', 'PAN'], ['F', 'SEARCH']],
  fillet: [['DRAG DOT', 'RADIUS'], ['IN', 'CHAMFER'], ['D', 'DISTANCE'], ['C', 'CHAMFER'], ['A', 'ANGLE'], ['V', 'VARIABLE POINT'], ['CTRL CLICK', 'EDGES'], ['⏎ / RMB', 'OK']],
  move: [['X Y Z', 'AXIS'], ['⇧ X Y Z', 'PLANE'], ['G', 'SCREEN'], ['CTRL', 'SNAP'], ['⏎ / RMB', 'OK']],
  rotate: [['X Y Z', 'AXIS'], ['R', 'SCREEN'], ['CTRL', '15°'], ['⏎ / RMB', 'OK']],
  scale: [['S', 'UNIFORM'], ['CTRL', '0.1'], ['⏎ / RMB', 'OK']],
  extrude: [['DRAG DOT', 'DISTANCE'], ['D', 'DISTANCE'], ['F', 'FREESTYLE: CLICK START · END'], ['V', 'PIVOT: CLICK'], ['I', 'INDIVIDUAL'], ['A', 'ANGLE'], ['⇧T', 'THICKNESS'], ['S', 'BOTH SIDES'], ['Q', 'UNION'], ['W', 'DIFFERENCE'], ['⇧E', 'INTERSECT'], ['⇧Q', 'SLICE'], ['B', 'NEW BODY'], ['⏎ / RMB', 'OK']],
  boolean: [['Q', 'UNION'], ['W', 'DIFFERENCE'], ['⇧E', 'INTERSECT'], ['⇧Q', 'SLICE'], ['T', 'KEEP TOOLS'], ['⏎ / RMB', 'OK']],
  offset: [['DRAG DOT', 'DISTANCE'], ['D', 'DISTANCE'], ['A', 'ANGLE ADJACENT'], ['TAB', 'GROW MODE'], ['⇧ CLICK', 'FACES'], ['⏎ / RMB', 'OK']],
  revolve: [['CLICK', 'AXIS START · END'], ['A', 'ANGLE'], ['⇧T', 'THICKNESS'], ['Q', 'UNION'], ['W', 'DIFFERENCE'], ['⇧E', 'INTERSECT'], ['B', 'NEW BODY'], ['⏎ / RMB', 'OK']],
  loft: [['CLICK', 'GUIDES (OPTIONAL)'], ['⏎ / RMB', 'OK'], ['ESC', 'CANCEL']],
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
  'offset-curve': [['DRAG DOT', 'DISTANCE'], ['D', 'DISTANCE'], ['V / C', 'GAP FILL'], ['S', 'BOTH SIDES'], ['F', 'FREESTYLE: CLICK'], ['⏎ / RMB', 'OK']],
  'fillet-curve': [['D', 'RADIUS'], ['TYPE', 'IN PANEL'], ['⏎ / RMB', 'OK']],
  'remove-face': [['⇧ CLICK', 'FACES'], ['⏎ / RMB', 'OK']],
  cut: [['⇧ CLICK', 'SOLIDS · CURVES'], ['⇧ ALT CLICK', 'FACES'], ['P', 'CONSTRUCTION PLANE'], ['⏎ / RMB', 'OK']],
  draft: [['A', 'ANGLE'], ['⇧ CLICK', 'FACES'], ['⏎ / RMB', 'OK']],
  imprint: [['⇧ CLICK', 'FACES · CURVES'], ['⇧ ALT CLICK', 'BODY THAT IMPRINTS'], ['⏎ / RMB', 'OK']],
  project: [['⇧ CLICK', 'SOLID · CURVES'], ['X Y Z', 'VECTOR'], ['S', 'SCREEN SPACE'], ['⏎ / RMB', 'OK']],
  'bridge-surface': [['⇧ CLICK', 'TWO EDGES'], ['T', 'TENSION'], ['⏎ / RMB', 'OK']],
  'extend-sheet': [['CLICK', "A SHEET'S EDGE"], ['D', 'DISTANCE'], ['⏎ / RMB', 'OK']],
  thicken: [['CLICK', 'A SHEET'], ['ALT CLICK', 'FACES (THICKEN FACE)'], ['D', 'FRONT'], ['B', 'BACK'], ['⏎ / RMB', 'OK']],
  pipe: [['⇧ CLICK', 'CURVES'], ['R', 'RADIUS'], ['T', 'THICKNESS'], ['V', 'SIDES'], ['⏎ / RMB', 'OK']],
  patch: [['⇧ CLICK', 'CURVES · EDGES'], ['T', 'TANGENT TO FACES'], ['⏎ / RMB', 'OK']],
  hole: [['CLICK', 'A FLAT FACE'], ['T', 'THROUGH ALL'], ['TYPE', 'SIZE IN PANEL'], ['⏎ / RMB', 'OK']],
  split: [['CLICK', 'WHERE TO SPLIT'], ['ESC / ⏎', 'DONE']],
  'measure-distance': [['CLICK', 'TWO POINTS'], ['CLICK', 'AGAIN TO RESTART'], ['ESC', 'DONE']],
  'measure-radius': [['CLICK', 'A ROUND EDGE OR CURVE'], ['ESC', 'DONE']],
  'measure-continuity': [['CLICK', 'NEAR TWO CURVE ENDS'], ['ESC', 'DONE']],
  'export-mesh': [['TYPE', 'OPTIONS IN PANEL'], ['⏎ / RMB', 'SAVE'], ['ESC', 'CANCEL']],
  'export-drawing': [['VIEW', 'AS THE CAMERA SEES IT'], ['H', 'HIDDEN LINES'], ['C', 'CURVES'], ['⏎ / RMB', 'SAVE'], ['ESC', 'CANCEL']],
  'tangent-circle': [['CLICK', 'FIRST · SECOND CURVE · SIZE'], ['F', 'FREEZE'], ['TAB', 'RADIUS'], ['ESC', 'CANCEL']],
  extend: [['CLICK', 'NEAR AN END'], ['TYPE', 'LENGTH IN PANEL'], ['ESC / ⏎', 'DONE']],
  bridge: [['T', 'TENSION'], ['⏎ / RMB', 'OK']],
  trim: [['CLICK', 'PIECE TO CUT AWAY'], ['CTRL Z', 'UNDO ONE'], ['ESC / ⏎', 'DONE']],
  box: [['CLICK', 'CORNER · CORNER · HEIGHT'], ['C', 'FROM CENTRE'], ['S', 'SQUARE'], ['TAB', 'TYPE'], ['H', 'HEIGHT'], ['Q W ⇧E ⇧Q', 'BOOLEAN'], ['B', 'NEW BODY'], ['⏎ / RMB', 'OK']],
  'center-box': [['CLICK', 'CENTRE · CORNER · HEIGHT'], ['C', 'FROM CORNER'], ['S', 'SQUARE'], ['TAB', 'TYPE'], ['H', 'HEIGHT'], ['Q W ⇧E ⇧Q', 'BOOLEAN'], ['B', 'NEW BODY'], ['⏎ / RMB', 'OK']],
  box3: [['CLICK', 'CORNER · SIDE · WIDTH · HEIGHT'], ['X Y Z', 'AXIS'], ['TAB', 'TYPE'], ['Q W ⇧E ⇧Q', 'BOOLEAN'], ['B', 'NEW BODY'], ['⏎ / RMB', 'OK']],
  cylinder: [['CLICK', 'CENTRE · RADIUS · HEIGHT'], ['V', 'VERTICAL'], ['TAB', 'TYPE'], ['F', 'RADIUS'], ['D', 'HEIGHT'], ['Q W ⇧E ⇧Q', 'BOOLEAN'], ['B', 'NEW BODY'], ['⏎ / RMB', 'OK']],
  sphere: [['CLICK', 'CENTRE · SIZE'], ['TAB', 'TYPE'], ['D', 'DIAMETER'], ['Q W ⇧E ⇧Q', 'BOOLEAN'], ['B', 'NEW BODY'], ['⏎ / RMB', 'OK']],
  shell: [['D', 'THICKNESS'], ['⇧ CLICK', 'FACES'], ['⏎ / RMB', 'OK']],
  mirror: [['X Y Z', 'PLANE'], ['J', 'JOIN'], ['⏎ / RMB', 'OK']],
  'rect-array': [['TYPE', 'COUNTS · SPACING'], ['J', 'JOIN'], ['⏎ / RMB', 'OK']],
  'radial-array': [['X Y Z', 'AXIS'], ['J', 'JOIN'], ['⏎ / RMB', 'OK']],
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
const EDITS = { material: 'SET MATERIAL', 'export-mesh': 'EXPORT MESH', 'export-drawing': 'EXPORT DRAWING', 'measure-continuity': 'MEASURE CONTINUITY', trim: 'TRIM', extend: 'EXTEND CURVE', 'tangent-circle': 'TANGENT CIRCLE', split: 'SPLIT CURVE', 'measure-distance': 'MEASURE DISTANCE', 'measure-radius': 'MEASURE RADIUS' };
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
    <input type="file" data-id="import-file" accept=".dxf" hidden>
    <button class="export" data-id="export" disabled title="Export STEP">${icon('export')}STEP</button>
    <span class="file" data-id="file-name">UNTITLED.W3D</span>
  </header>
  <div class="pmenu" data-id="pmenu" role="menu" hidden></div>

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
      <div class="field"><label>EDGES</label><output data-id="blend-count">0</output></div>
      <div class="field"><label>VARIABLE POINTS</label><output data-id="blend-vars" title="V adds one on a rounded edge; drag its dot for the radius there">0</output></div>
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
      <div class="seg" role="group" aria-label="Boolean operation">
        <button data-bop="union" aria-pressed="true"><kbd>Q</kbd>UNION</button>
        <button data-bop="difference" aria-pressed="false"><kbd>W</kbd>DIFF</button>
        <button data-bop="intersect" aria-pressed="false"><kbd>⇧E</kbd>INTER</button>
        <button data-bop="slice" aria-pressed="false"><kbd>⇧Q</kbd>SLICE</button>
      </div>
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
      <div class="seg" role="group" aria-label="Mesh format"><button data-mxf="obj" aria-pressed="true">OBJ</button><button data-mxf="stl" aria-pressed="false">STL</button></div>
      <div class="field"><label for="w3d-mx-tol">TOLERANCE</label><input id="w3d-mx-tol" data-id="mx-tol" type="number" step="0.01" min="0.001" value="0.05"></div>
      <div class="field"><label for="w3d-mx-angle">ANGLE °</label><input id="w3d-mx-angle" data-id="mx-angle" type="number" step="1" min="0.5" value="15"></div>
      <div class="field"><label for="w3d-mx-width">MAX WIDTH</label><input id="w3d-mx-width" data-id="mx-width" type="number" step="1" min="0" value="0"></div>
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
      <div class="chips"><button data-id="oc-lock" aria-pressed="false" title="Lock distances: offset both sides (S)"><kbd>S</kbd>BOTH SIDES</button><button data-id="oc-free" aria-pressed="false" title="Freestyle: click where the offset goes (F)"><kbd>F</kbd>FREESTYLE</button></div>
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
      <div class="field"><label>PULL</label><output data-id="draft-pull">—</output></div>
    </div>
    <div class="sec" data-panel="imprint" hidden>
      <span class="hint" data-id="imp-hint">—</span>
      <div class="field"><label>FACES</label><output data-id="imp-faces">ALL</output></div>
      <div class="field"><label>CURVES</label><output data-id="imp-curves">0</output></div>
      <div class="field"><label>BODIES</label><output data-id="imp-bodies">0</output></div>
    </div>
    <div class="sec" data-panel="project" hidden>
      <span class="hint" data-id="proj-hint">—</span>
      <div class="field"><label>MAKES</label><output data-id="proj-mode">—</output></div>
      <div class="chips" data-id="proj-opts">
        <button data-proj="normal" aria-pressed="true">NORMAL</button>
        <button data-proj="vector" aria-pressed="false">VECTOR</button>
        <button data-proj="both" aria-pressed="false">BIDIRECTIONAL</button>
        <button data-proj="hide" aria-pressed="false">HIDE OCCLUDED</button>
        <button data-proj="screen" aria-pressed="false"><kbd>S</kbd>SCREEN SPACE</button>
      </div>
      <div class="field"><label>DIRECTION</label><output data-id="proj-dir">—</output></div>
      <div class="field"><label>CURVES</label><output data-id="proj-count">0</output></div>
    </div>
    <div class="sec" data-panel="patch" hidden>
      <span class="hint" data-id="patch-hint">—</span>
      <div class="chips"><button data-id="patch-tangent" aria-pressed="false"><kbd>T</kbd>TANGENT TO FACES</button></div>
      <div class="field"><label>CURVES</label><output data-id="patch-curves">0</output></div>
      <div class="field"><label>EDGES</label><output data-id="patch-edges">0</output></div>
    </div>
    <div class="sec" data-panel="bridge-surface" hidden>
      <span class="hint" data-id="bs-hint">—</span>
      <div class="field"><label for="w3d-bs-t">TENSION</label><input id="w3d-bs-t" data-id="bs-t" type="number" step="0.1" min="0.05" value="1"></div>
    </div>
    <div class="sec" data-panel="extend-sheet" hidden>
      <span class="hint" data-id="es-hint">—</span>
      <div class="field"><label for="w3d-es-d">DISTANCE</label><input id="w3d-es-d" data-id="es-d" type="number" step="0.5" min="0.01" value="5"></div>
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
      <span class="hint" data-id="ext-hint">CLICK NEAR THE END OF A LINE OR ARC</span>
      <div class="field"><label for="w3d-ext-len">LENGTH</label><input id="w3d-ext-len" data-id="ext-len" type="number" step="1" min="0.01" value="10"></div>
    </div>
    <div class="sec" data-panel="bridge" hidden>
      <span class="hint" data-id="br-hint">—</span>
      <div class="field"><label for="w3d-br-t">TENSION</label><input id="w3d-br-t" data-id="br-t" type="number" step="0.1" min="0.05" value="1"></div>
    </div>
    <div class="sec" data-panel="trim" hidden>
      <span class="hint" data-id="trim-hint">CLICK THE PIECE OF A CURVE TO CUT AWAY; IT ENDS WHERE OTHER CURVES CROSS IT</span>
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
    </div>
    <div class="sec" data-panel="material" hidden>
      <span class="hint" data-id="mat-hint">—</span>
      <div class="field"><label for="w3d-mat-color">COLOR</label><input id="w3d-mat-color" data-mat="color" type="color" value="#9a968c"></div>
      <div class="field"><label for="w3d-mat-rough">ROUGHNESS</label><input id="w3d-mat-rough" data-mat="roughness" type="number" step="0.05" min="0" max="1" value="0.5"></div>
      <div class="field"><label for="w3d-mat-metal">METALNESS</label><input id="w3d-mat-metal" data-mat="metalness" type="number" step="0.05" min="0" max="1" value="0"></div>
      <div class="field"><label for="w3d-mat-ior">IOR</label><input id="w3d-mat-ior" data-mat="ior" type="number" step="0.01" min="1" max="2.333" value="1.5"></div>
      <div class="field"><label for="w3d-mat-opacity">OPACITY</label><input id="w3d-mat-opacity" data-mat="opacity" type="number" step="0.05" min="0" max="1" value="1"></div>
      <div class="field"><label for="w3d-mat-density">DENSITY G/CM³</label><input id="w3d-mat-density" data-mat="density" type="number" step="0.01" min="0.001" value="1"></div>
      <div class="field"><label>MASS</label><output data-id="mat-mass">—</output></div>
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
      <div class="seg" role="group" aria-label="Mirror axis"><button data-mx="x" aria-pressed="true"><kbd>X</kbd>X</button><button data-mx="y" aria-pressed="false"><kbd>Y</kbd>Y</button><button data-mx="z" aria-pressed="false"><kbd>Z</kbd>Z</button></div>
      <div class="field"><label for="w3d-mirror-at">AT</label><input id="w3d-mirror-at" data-id="mirror-at" type="number" step="1" value="0"></div>
      <div class="chips"><button data-id="mirror-join" aria-pressed="false"><kbd>J</kbd>JOIN</button></div>
    </div>
    <div class="sec" data-panel="rect-array" hidden>
      <span class="hint" data-id="ra-hint">—</span>
      <div class="field"><label>COUNT X · Y · Z</label><span class="trio"><input data-id="ra-cx" type="number" step="1" min="1" value="3" aria-label="Count along x"><input data-id="ra-cy" type="number" step="1" min="1" value="1" aria-label="Count along y"><input data-id="ra-cz" type="number" step="1" min="1" value="1" aria-label="Count along z"></span></div>
      <div class="field"><label>SPACING X · Y · Z</label><span class="trio"><input data-id="ra-sx" type="number" step="1" value="30" aria-label="Spacing along x"><input data-id="ra-sy" type="number" step="1" value="30" aria-label="Spacing along y"><input data-id="ra-sz" type="number" step="1" value="30" aria-label="Spacing along z"></span></div>
      <div class="chips"><button data-id="ra-join" aria-pressed="false"><kbd>J</kbd>JOIN</button></div>
    </div>
    <div class="sec" data-panel="radial-array" hidden>
      <span class="hint" data-id="rr-hint">—</span>
      <div class="field"><label for="w3d-rr-count">COUNT</label><input id="w3d-rr-count" data-id="rr-count" type="number" step="1" min="1" value="6"></div>
      <div class="field"><label for="w3d-rr-angle">ANGLE °</label><input id="w3d-rr-angle" data-id="rr-angle" type="number" step="15" value="360"></div>
      <span class="label">AXIS</span>
      <div class="seg" role="group" aria-label="Radial array axis"><button data-rx="x" aria-pressed="false"><kbd>X</kbd>X</button><button data-rx="y" aria-pressed="false"><kbd>Y</kbd>Y</button><button data-rx="z" aria-pressed="true"><kbd>Z</kbd>Z</button></div>
      <div class="chips"><button data-id="rr-join" aria-pressed="false"><kbd>J</kbd>JOIN</button></div>
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
    <div class="sec" data-panel="move" hidden>
      <span class="hint" data-id="move-hint">DRAG AN ARROW, PRESS X Y Z, OR TYPE</span>
      <div class="field"><label for="w3d-dx">ΔX</label><input id="w3d-dx" data-move="0" type="number" step="2.5" value="0"></div>
      <div class="field"><label for="w3d-dy">ΔY</label><input id="w3d-dy" data-move="1" type="number" step="2.5" value="0"></div>
      <div class="field"><label for="w3d-dz">ΔZ</label><input id="w3d-dz" data-move="2" type="number" step="2.5" value="0"></div>
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
      <div class="chips">
        <button data-toggle="edges" aria-pressed="true">EDGES</button>
        <button data-toggle="faces" aria-pressed="true">FACES</button>
        <button data-toggle="xray" aria-pressed="false" title="Alt+Z">X-RAY</button>
        <button data-toggle="snap" aria-pressed="false" title="Snap without holding Ctrl">SNAP</button>
        <button data-toggle="curves" aria-pressed="true" title="Viewport: toggle curves">CURVES</button>
        <button data-toggle="curvature" aria-pressed="false" title="Curvature combs on curves (Toggle Curvature)">CURVATURE</button>
        <button data-toggle="render" aria-pressed="false" title="Render mode: lit by an environment, with the materials' roughness and metal">RENDER</button>
      </div>
      <span class="label">SHADER <output data-id="shader-name">CERAMIC DARK</output></span>
      <div class="swatches" role="group" aria-label="Shader mode">${SHADERS.map(s => `<button data-shader="${s.id}" aria-pressed="${s.id === 'ceramic-dark'}" aria-label="${s.name}" title="${s.name}: ${s.use}" style="background: ${s.swatch}"></button>`).join('')}</div>
      <div class="stepper" data-id="shader-option" hidden><span data-id="shader-option-label">STRIPES</span><button data-id="shader-option-dec" aria-label="Less">−</button><output data-id="shader-option-value">24</output><button data-id="shader-option-inc" aria-label="More">+</button></div>
      <div data-id="render-options" hidden>
        <span class="label">ENVIRONMENT</span>
        <div class="chips">${ENVIRONMENTS.map(e => `<button data-env="${e.id}" aria-pressed="${e.id === 'studio'}" title="${e.use}">${e.name.toUpperCase()}</button>`).join('')}</div>
        <div class="field"><label for="w3d-env-rot">ROTATION</label><input id="w3d-env-rot" data-id="env-rot" type="range" min="-180" max="180" step="1" value="0"></div>
        <div class="field"><label for="w3d-env-int">INTENSITY</label><input id="w3d-env-int" data-id="env-int" type="range" min="0" max="10" step="0.1" value="1"></div>
      </div>
      <div class="stepper"><span>GRID</span><button data-id="grid-dec" aria-label="Smaller grid step">−</button><output data-id="grid">2.5</output><button data-id="grid-inc" aria-label="Larger grid step">+</button></div>
    </div>
    <div class="sec">
      <span class="label">CONSTRUCTION PLANE <output data-id="plane">XY</output></span>
      <div class="seg" role="group" aria-label="Construction plane">
        <button data-action="plane:selection" title="Space: a plane on the selected face, view aligned"><kbd>␣</kbd>FROM FACE</button>
        <button data-action="plane:view" title="Ctrl+Space: a plane facing the view"><kbd>^␣</kbd>VIEW</button>
        <button data-action="plane:world" title="The world XY plane">XY</button>
      </div>
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
    <span data-id="blender" hidden>BLENDER <output data-id="blender-state">—</output></span>
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
  for (const b of root.querySelectorAll('[data-draw],[data-bop],[data-xop],[data-fop],[data-spiral],[data-toggle],[data-gmethod],[data-galign],[data-grow],[data-id="ex-lock"],[data-id="bool-keep"],[data-id="ex-free"],[data-id="ex-pivot"],[data-id="ex-individual"],[data-id="dr-hidden"],[data-id="dr-curves"],[data-id="oc-lock"],[data-id="oc-free"]')) {
    const name = b.dataset.draw ?? b.dataset.bop ?? b.dataset.xop ?? b.dataset.fop ?? b.dataset.spiral ?? (b.dataset.toggle && `view-${b.dataset.toggle}`)
      ?? (b.dataset.gmethod && `guide-${b.dataset.gmethod}`) ?? (b.dataset.galign && `align-${b.dataset.galign}`) ?? (b.dataset.grow && `grow-${b.dataset.grow}`)
      ?? { 'ex-lock': 'lock', 'bool-keep': 'keep', 'ex-free': 'freestyle', 'ex-pivot': 'pivot', 'ex-individual': 'individual', 'dr-hidden': 'hidden-lines', 'dr-curves': 'drawing-curves', 'oc-lock': 'lock', 'oc-free': 'freestyle' }[b.dataset.id];
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
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.ground);
  const persp = new THREE.PerspectiveCamera(36, 1, 1, 4000);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -4000, 4000);
  let camera = persp;
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.zoomToCursor = true;
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
  viewEl.addEventListener('pointerdown', e => {
    if (e.button === 1) controls.mouseButtons.MIDDLE = (e.ctrlKey || e.metaKey) ? THREE.MOUSE.DOLLY : THREE.MOUSE.ROTATE;
  }, true);
  // Regular Polygon: Shift+wheel adds or takes away a side instead of zooming.
  viewEl.addEventListener('wheel', e => {
    if (cmd?.id !== 'polygon' || !e.shiftKey) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    setSides(cmd.sides + (e.deltaY < 0 || e.deltaX < 0 ? 1 : -1));
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
  const view = { edges: true, faces: true, curves: true, xray: false, snap: false, curvature: false, shader: 'ceramic-dark', render: false, environment: 'studio', envRotation: 0, envIntensity: 1 };
  const shadeU = {
    mode: { value: 0 }, pull: { value: new THREE.Vector3(0, 1, 0) }, stripes: { value: SHADER_OPTIONS.stripes.value },
    draftSin: { value: Math.sin(SHADER_OPTIONS.draft.value * DEG) }, spacing: { value: SHADER_OPTIONS.spacing.value },
  };
  const shaderOpts = Object.fromEntries(Object.entries(SHADER_OPTIONS).map(([k, o]) => [k, o.value]));
  const faceMat = new THREE.MeshStandardMaterial({ color: COLORS.face, roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const edgeMat = new THREE.LineBasicMaterial({ color: COLORS.ink, transparent: true, opacity: 0.8 });
  const phantom = {
    add: { face: new THREE.MeshBasicMaterial({ color: COLORS.ink, transparent: true, opacity: 0.1, depthWrite: false }), edge: new THREE.LineBasicMaterial({ color: COLORS.ink }) },
    cut: { face: new THREE.MeshBasicMaterial({ color: COLORS.accent, transparent: true, opacity: 0.16, depthWrite: false }), edge: new THREE.LineBasicMaterial({ color: COLORS.accent }) },
  };
  // Shader modes (shading.js), drawn from the face normal in view space rather than from matcap
  // images. Zebra stripes mirror even bands, so they stay smooth over G2 joins, kink at G1 ones and
  // break where faces only touch (G0). In render mode the faces keep the lit physical material.
  const shade = (own = false) => shader => {
    Object.assign(shader.uniforms, { ownColor: { value: own }, shadeMode: shadeU.mode, pull: shadeU.pull, stripes: shadeU.stripes, draftSin: shadeU.draftSin, spacing: shadeU.spacing });
    shader.fragmentShader = 'uniform bool ownColor;\nuniform int shadeMode;\nuniform vec3 pull;\nuniform float stripes;\nuniform float draftSin;\nuniform float spacing;\n' + shader.fragmentShader.replace('#include <dithering_fragment>', `
      vec3 n = normalize(normal);
      if (!gl_FrontFacing) n = -n;
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
      mat = new THREE.MeshPhysicalMaterial({ polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      mat.onBeforeCompile = shade(true);
      mat.customProgramCacheKey = () => 'own';
      bodyMats.set(id, mat);
    }
    mat.color.set(m.color);
    Object.assign(mat, { roughness: m.roughness, metalness: m.metalness, ior: m.ior });
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
  function applyView() {
    const sh = shader(view.shader);
    shadeU.mode.value = view.render ? -1 : sh.mode;
    shadeU.pull.value.copy(cplane.normal);
    shadeU.stripes.value = shaderOpts.stripes;
    shadeU.draftSin.value = Math.sin(shaderOpts.draft * DEG);
    shadeU.spacing.value = shaderOpts.spacing;
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
    $('render-options').hidden = !view.render;
    const opt = !view.render && sh.option ? SHADER_OPTIONS[sh.option] : null;
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
    current = list;
    sel.fromRefs(saved, list);
    org.prune(list.map(b => b.id));
    renderIsolated();
    for (const m of [...bodies.children]) dispose(m);
    for (const id of [...materialOf.keys()]) if (!list.some(b => b.id === id)) { materialOf.delete(id); bodyMats.get(id)?.dispose(); bodyMats.delete(id); }
    for (const b of list) {
      const m = meshOf(b, faceMatFor(b.id));
      m.visible = org.shows(b.id);
      bodies.add(m);
    }
    $('volume').textContent = list.reduce((v, b) => v + b.volume, 0).toFixed(3);
    $('faces').textContent = list.reduce((n, b) => n + b.facePlanes.length, 0);
    $('export').disabled = list.length === 0;
    hover = null;
    selectionChanged({ quiet: true });
    if (backend.sceneChanged) backend.sceneChanged().then(showBridge, () => {});
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
  const curveName = c => ({ circle: 'CIRCLE', arc: 'ARC', spline: 'SPLINE', cv: 'CV CURVE', ellipse: 'ELLIPSE', contour: 'CONTOUR', spiral: 'SPIRAL', nurbs: 'PROJECTED CURVE' })[c.kind] ?? (!c.closed ? 'LINE' : c.points.length === 4 ? 'RECTANGLE' : 'POLYGON');
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
  function drawCombs() {
    for (const o of [...combGroup.children]) dispose(o);
    if (!view.curvature || !curveList.length) return;
    const combs = curveList.filter(c => c.kind !== 'spiral' && c.kind !== 'nurbs').map(c => { try { return { c, comb: curvatureComb(c) }; } catch { return null; } }).filter(Boolean);
    const kMax = Math.max(1e-12, ...combs.flatMap(x => x.comb.map(t => t.k)));
    const box = new THREE.Box3();
    for (const o of curveGroup.children) box.expandByObject(o);
    const scale = 0.25 * box.getSize(new THREE.Vector3()).length() / kMax;
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

  async function loadCurves() {
    curveList = backend.curves ? await backend.curves() : [];
    sel.keepCurves(curveList.map(c => c.id));
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
    renderOutliner();
    drawCombs();
  }
  /** Colour curves and regions for hover and selection. */
  function paintCurves() {
    const is = (kind, id) => sel.has({ kind, id }) ? 'selected' : hover?.kind === kind && hover.id === id ? 'hover' : 'normal';
    for (const o of curveGroup.children) {
      if (o.userData.curve !== undefined) o.material = curveMat[is('curve', o.userData.curve) === 'normal' && sel.has({ kind: 'region', id: o.userData.curve }) ? 'selected' : is('curve', o.userData.curve)];
      else o.material = regionMat[is('region', o.userData.region)];
    }
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
  function record(text, id, tag = label(id)) {
    history.splice(history.length - undone, undone, { text, id, tag });
    undone = 0;
    renderHistory();
  }
  function renderOutliner() {
    const out = $('outliner');
    out.innerHTML = '<div class="group-title">▾ SOLIDS</div>';
    const ids = current.map(b => b.id);
    const solids = current.filter(b => !b.sheet), sheets = current.filter(b => b.sheet);
    const toggles = (shown, locked) => `<button class="lk" aria-pressed="${locked}" aria-label="Lock or unlock" title="${locked ? 'Unlock' : 'Lock'}">${icon(locked ? 'padlock' : 'unlock')}</button><button class="eye" aria-pressed="${shown}" aria-label="Show or hide">◉</button>`;
    const indent = depth => `padding-left: ${14 + 14 * depth}px`;
    const bodyRow = (b, depth) => {
      const row = document.createElement('div');
      const locked = org.locked.has(b.id), shown = !org.hidden.has(b.id);
      row.className = 'row-item' + (locked ? ' locked' : '') + (org.shows(b.id) ? '' : ' off');
      row.style = indent(depth);
      row.setAttribute('aria-current', sel.has({ kind: 'solid', body: b.id }));
      row.innerHTML = `<span class="sq"></span><span class="name">${b.sheet ? 'SHEET' : 'BODY'} ${b.id}</span><span class="tag">${label(b.id)}</span>${toggles(shown, locked)}`;
      row.onclick = e => {
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
      const row = document.createElement('div');
      row.className = 'row-item folder' + (all.length ? '' : ' empty-group');
      row.style = indent(depth);
      row.setAttribute('aria-current', all.length > 0 && all.every(id => sel.has({ kind: 'solid', body: id })));
      row.innerHTML = `<span class="tw">${g.open ? '▾' : '▸'}</span>${icon('folder')}<span class="name" title="Double-click to rename">${g.name}</span><span class="tag">${all.length}</span>${toggles(shown, locked)}`;
      const name = row.querySelector('.name');
      row.onclick = e => {
        if (name.isContentEditable) return;
        if (e.target.closest('.tw')) { g.open = !g.open; return renderOutliner(); }
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
  function planeFromSelection(alignView) {
    const faces = sel.list('face');
    const f = faces[faces.length - 1];
    const b = f && bodyOf(f.body), p = b?.facePlanes[f.n];
    if (!p) return toast('SELECT A FLAT FACE FOR THE CONSTRUCTION PLANE');
    const origin = faceCentre(b, f.n), normal = new THREE.Vector3(...p.normal);
    setPlane({ origin, normal, name: `FACE · ${label(b.id)}` });
    if (!alignView) return;
    const dist = camera.position.distanceTo(controls.target);
    controls.target.copy(origin);
    const dir = normal.clone();
    if (Math.abs(dir.dot(UP)) > 0.9999) dir.z += 0.0001;
    camera.position.copy(origin).addScaledVector(dir.normalize(), dist);
  }
  function planeFromView() {
    setPlane({ origin: new THREE.Vector3(), normal: camera.position.clone().sub(controls.target).normalize(), name: 'VIEW' });
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
    const meshes = shownMeshes().filter(m => !org.locked.has(m.userData.id));
    const faceHit = raycaster.intersectObjects(meshes, false)[0];
    const reach = faceHit ? faceHit.distance * 1.01 + 0.5 : Infinity; // in front of the face, or on it
    raycaster.params.Line.threshold = unitsPerPixel(faceHit?.point ?? controls.target) * 6;
    // Curves pick with edges or solids (Plasticity picks a curve whole), regions with faces.
    const curveHit = (sel.allows('edge') || sel.allows('solid'))
      && raycaster.intersectObjects(curveGroup.children.filter(o => o.userData.curve !== undefined), false).find(h => h.distance <= reach);
    let edgeHit = null;
    if (sel.allows('edge')) {
      const hits = raycaster.intersectObjects(meshes.map(m => m.userData.lines), false);
      edgeHit = hits.find(h => !faceHit || h.distance <= faceHit.distance * 1.01 + 1e-6);
    }
    if (curveHit && (!edgeHit || curveHit.distance <= edgeHit.distance + 0.5)) return { kind: 'curve', id: curveHit.object.userData.curve, point: curveHit.point };
    if (edgeHit) return { kind: 'edge', body: edgeHit.object.parent.userData.id, n: edgeHit.object.userData.segEdge[edgeHit.index / 2], point: edgeHit.point };
    if (sel.allows('face')) {
      const r = raycaster.intersectObjects(curveGroup.children.filter(o => o.userData.region !== undefined), false).find(h => h.distance <= reach);
      if (r) return { kind: 'region', id: r.object.userData.region, point: r.point };
    }
    if (!faceHit) return null;
    const { id, faceIds } = faceHit.object.userData;
    if (sel.allows('face')) return { kind: 'face', body: id, n: faceIds[faceHit.faceIndex], point: faceHit.point };
    if (sel.allows('solid')) return { kind: 'solid', body: id, point: faceHit.point };
    return null;
  }

  // --- selection ------------------------------------------------------------
  // Clicks follow Plasticity 0.6.30 (src/selection/Click.ts): with solids selectable, the first
  // click on a solid takes the whole solid, and a click on a solid already selected (or one with
  // faces or edges selected) drills down to the face or edge. Shift adds, Ctrl removes or adds back,
  // a double-click takes the solid, and a click on nothing clears.
  function clickTarget(hit, mod) {
    if (!hit) return null;
    if (hit.body === undefined) return { kind: hit.kind, id: hit.id };
    const solid = { kind: 'solid', body: hit.body };
    if (hit.kind === 'solid') return solid;
    if (sel.allows('solid')) {
      const children = sel.list().some(it => it.body === hit.body && it.kind !== 'solid');
      if (sel.has(solid)) { if (mod !== 'replace') return solid; }
      else if (!children) return solid;
    }
    return { kind: hit.kind, body: hit.body, n: hit.n };
  }
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
    $('sel-count').textContent = n ? `${n} ${[...new Set(sel.list().map(it => it.kind))].join('+').toUpperCase()}` : '—';
    renderMass();
    if (cmd?.onSelection) return cmd.onSelection();
    if (quiet) return;
    // Plasticity's default command: with edges selected the fillet's dot is already there to drag.
    defaultCommand();
  }
  /** Plasticity's default commands: the fillet's dot with edges selected, the extrude's with regions, Offset Face's with faces. */
  function defaultCommand() {
    if (cmd) return;
    if (edgeBody()) startFillet({ auto: true });
    else if (regionsOnly()) startExtrude({ auto: true });
    else if (faceBody() !== null) startOffset({ auto: true });
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
  // Plasticity: Ctrl snaps to the ends and middles of edges and the centres of faces, shown as a dot
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
    return m.userData.snaps = out;
  }
  function snapNear(e, meshes, plane = null) {
    const c = local(e);
    let best = null, bestD = SNAP_PX;
    for (const m of meshes) for (const s of snapCandidates(m)) {
      if (plane && Math.abs(plane.distanceToPoint(s.point)) > 1e-3) continue;
      const p = screenOf(s.point);
      if (p.behind) continue;
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best && { point: best.point.clone(), kind: best.kind };
  }
  function showSnap(s, e) {
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
    lastTool = id;
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
      id: 'fillet', auto, value: 0, angle: 45, sent: 0, shown: 0, good: null, bad: null, body: null, edges: [],
      gizmo: null, entry: null, entryDone: () => previewFillet(),
      // Plasticity's variable points (V): { edge, point, scale, gizmo }, the radius there being value × scale.
      vars: [], placing: false, extraGizmos() { return this.vars.map(v => v.gizmo) },
      get kind() { return this.value < 0 ? 'chamfer' : 'fillet' },
    };
    lastTool = 'fillet';
    showTool('fillet');
    setState('none');
    c.onSelection = () => {
      drawOverlays();
      const body = edgeBody();
      if (!body) {
        // In Plasticity the default command goes when the selection stops being edges.
        if (c.auto && c.value === 0) return abortFillet(null);
        for (const v of [...c.vars]) dropVariable(v);
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
        c.placing = true;
        setHud('CLICK A ROUNDED EDGE · VARIABLE POINT');
        return true;
      }
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
        c.placing = false;
        if (hit?.kind !== 'edge' || hit.body !== c.body || !c.edges.includes(hit.n)) { toast('CLICK ONE OF THE ROUNDED EDGES'); previewFillet(); return true; }
        addVariable(hit.n, hit.point);
        return true;
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

  function setFillet(v, fromGizmo = true) {
    const c = cmd;
    if (c?.id !== 'fillet') return;
    c.value = v;
    c.auto = c.auto && v === 0;
    if (!fromGizmo) c.gizmo?.render(v);
    // Variable points keep their share of the radius; a chamfer has none.
    for (const p of c.vars) { p.gizmo.visible = v > 0; if (v > 0) p.gizmo.render(v * p.scale); }
    if (document.activeElement !== $('blend-distance')) $('blend-distance').value = +v.toFixed(3);
    $('blend-kind').textContent = v < 0 ? 'CHAMFER' : 'ROUND';
    previewFillet();
  }

  const filletRequest = (c, v = c.value) => ({
    body: c.body, edges: c.edges, size: Math.abs(v), kind: v < 0 ? 'chamfer' : 'fillet', angle: c.angle * DEG,
    variable: v > 0 ? c.vars.map(p => ({ edge: p.edge, point: p.point.toArray(), scale: p.scale })) : [],
  });

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
    setHud(`${v < 0 ? 'CHAMFER' : 'R'} ${Math.abs(v).toFixed(2)}${at}`);
    if (n === c.sent) setState('updated');
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
    const text = `${req.kind === 'chamfer' ? 'CHAMFER' : 'FILLET'} ${req.size.toFixed(2)} ×${req.edges.length}`;
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
  function startTransform(kind, { follow = null } = {}) {
    const ids = targetBodies().filter(id => org.shows(id));
    if (!ids.length) return toast(`SELECT A SOLID TO ${kind.toUpperCase()}`);
    const box = new THREE.Box3();
    for (const id of ids) box.expandByObject(bodyMesh(id));
    const pivot = box.getCenter(new THREE.Vector3());
    const handle = new THREE.Object3D();
    handle.position.copy(pivot);
    scene.add(handle);
    const tc = new TransformControls(camera, canvas);
    tc.setMode({ move: 'translate', rotate: 'rotate', scale: 'scale' }[kind]);
    tc.setSpace('world');
    tc.attach(handle);
    tc.addEventListener('dragging-changed', e => { controls.enabled = !e.value; if (e.value) c.follow = null; });
    tc.addEventListener('objectChange', () => fromHandle());
    scene.add(tc.getHelper());
    const c = cmd = { id: kind, ids, pivot, handle, tc, offset: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: 1, axis: 'z', follow: null };
    lastTool = kind;
    showTool(kind);
    setTarget(ids.map(label).join(' '));
    setState('none');
    setAxis('z');
    snapsFor(false);

    function fromHandle() {
      c.offset.copy(handle.position).sub(pivot);
      c.quat.copy(handle.quaternion);
      if (kind === 'scale') {
        // Uniform only: take whichever component the drag changed.
        const s = handle.scale.toArray().reduce((a, b) => Math.abs(b - c.scale) > Math.abs(a - c.scale) ? b : a, c.scale);
        c.scale = Math.max(0.001, s);
      }
      apply();
    }
    c.key = (action, e) => {
      const p = lastPointer ?? centreEvent();
      if (kind === 'move') {
        if ('xyz'.includes(action)) beginFollow({ type: 'axis', dir: worldAxis(action), name: action.toUpperCase() }, p);
        else if (['yz', 'xz', 'xy'].includes(action)) beginFollow({ type: 'plane', normal: worldAxis('xyz'.replace(action[0], '').replace(action[1], '')), name: action.toUpperCase() }, p);
        else if (action === 'screen') beginFollow({ type: 'plane', normal: null, name: 'SCREEN' }, p);
        else return false;
      } else if (kind === 'rotate') {
        if ('xyz'.includes(action)) { setAxis(action); beginFollow({ type: 'rotate', dir: worldAxis(action), name: action.toUpperCase() }, p); }
        else if (action === 'screen') beginFollow({ type: 'rotate', dir: null, name: 'SCREEN' }, p);
        else return false;
      } else if (action === 'uniform') beginFollow({ type: 'scale', name: 'UNIFORM' }, p);
      else return false;
      return true;
    };
    c.click = () => true; // clicks don't change the selection while transforming
    c.finish = () => commitTransform();
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => {
      for (const id of ids) { const m = bodyMesh(id); if (m) { m.position.set(0, 0, 0); m.quaternion.identity(); m.scale.set(1, 1, 1); } }
      tc.detach();
      tc.getHelper().removeFromParent();
      tc.dispose();
      handle.removeFromParent();
      controls.enabled = true;
    };
    apply();
    if (follow) c.key(follow);
  }

  function setAxis(a) {
    for (const b of $$('[data-axis]')) b.setAttribute('aria-pressed', b.dataset.axis === a);
    if (cmd?.id !== 'rotate') return;
    const angle = angleAbout(cmd.quat, a);
    cmd.axis = a;
    setAngle(angle);
  }
  /** The turn of `q` about a user axis, in degrees. */
  function angleAbout(q, a) {
    const ax = worldAxis(a);
    return Math.round(2 * Math.atan2(new THREE.Vector3(q.x, q.y, q.z).dot(ax), q.w) / DEG * 1e6) / 1e6;
  }
  function setAngle(deg) {
    const c = cmd;
    if (c?.id !== 'rotate') return;
    c.quat.setFromAxisAngle(worldAxis(c.axis), deg * DEG);
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

  /** Preview: M = T(pivot + offset) · R · S · T(−pivot) on every target mesh, and the panel. */
  function apply() {
    const c = cmd;
    const { pivot, offset, quat, scale } = c;
    c.handle.position.copy(pivot).add(offset);
    c.handle.quaternion.copy(quat);
    c.handle.scale.setScalar(scale);
    for (const id of c.ids) {
      const m = bodyMesh(id);
      m.scale.setScalar(scale);
      m.quaternion.copy(quat);
      m.position.copy(pivot).add(offset).sub(pivot.clone().multiplyScalar(scale).applyQuaternion(quat));
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

  async function commitTransform() {
    const c = cmd;
    endFollow(true);
    const moved = c.offset.lengthSq() > 1e-18 || Math.abs(c.quat.w) < 1 - 1e-12 || Math.abs(c.scale - 1) > 1e-12;
    if (!moved) return endCmd('cancelled');
    const q = c.quat.clone().normalize();
    if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
    const angle = 2 * Math.acos(Math.min(1, q.w)), s = Math.sqrt(Math.max(0, 1 - q.w * q.w));
    const axis = s < 1e-9 ? [0, 1, 0] : [q.x / s, q.y / s, q.z / s];
    const req = { bodies: c.ids, offset: c.offset.toArray(), pivot: c.pivot.toArray(), axis, angle: s < 1e-9 ? 0 : angle, scale: c.scale };
    const user = toUser(req.offset);
    const text = c.id === 'move' ? `MOVE ${user.map(fmt).join(' ')}`
      : c.id === 'rotate' ? `ROTATE ${fmt(angle / DEG)}°` : `SCALE ×${c.scale.toFixed(3)}`;
    try {
      const { id, scene: list } = await backend.commitMotion(req);
      endCmd('committed');
      record(text, id);
      showScene(list);
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
      else if (p) addPoint(p, e);
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
    const s = e.altKey ? null : snapNear(e, shownMeshes(), plane);
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
    target: c.src.target, ...(c.src.region !== undefined ? { region: c.src.region } : { face: c.src.face, faces: c.src.faces ?? [], individual: c.individual }), distance: c.distance, op: c.op,
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
  // The target changes and the tools go.
  function startBoolean() {
    const ids = sel.solids.filter(id => org.shows(id));
    if (ids.length < 2) return toast('SELECT THE TARGET, THEN THE TOOLS');
    if (!backend.previewBoolean) return toast('BOOLEAN IS NOT IN THIS BUILD YET');
    const c = cmd = { id: 'boolean', target: ids[0], tools: ids.slice(1), op: 'union', keep: false, sent: 0, shown: 0 };
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
    $('bool-keep').setAttribute('aria-pressed', c.keep);
    const n = ++c.sent;
    setState('updating');
    const t0 = performance.now();
    let body;
    try { body = await backend.previewBoolean({ target: c.target, tools: c.tools, op: c.op }); }
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
    setHud(`${c.op.toUpperCase()}${c.keep ? ' · KEEP TOOLS' : ''}`);
    if (n === c.sent) setState('updated');
  }
  async function commitBooleanCmd() {
    const c = cmd;
    try {
      const { id, scene: list } = await backend.commitBoolean({ target: c.target, tools: c.tools, op: c.op, keepTools: c.keep });
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
    if (!ids.length) return toast(`SELECT A CURVE TO ${offset ? 'OFFSET' : 'FILLET'}`);
    if (!backend.addCurves || (!offset && !backend.replaceCurves)) return toast(`${toolInfo(id).label} IS NOT IN THIS BUILD YET`);
    const field = offset ? 'oc-d' : 'fc-r', hint = offset ? 'oc-hint' : 'fc-hint';
    // Offset Curve's S (lock distances: both sides) and F (freestyle: a click sets the distance).
    const c = cmd = { id, ids, out: null, both: false, placing: false, gizmo: null };
    lastTool = id;
    showTool(id);
    setState('none');
    setTarget(ids.length === 1 ? curveLabel(ids[0]) : `${ids.length} CURVES`);
    const corner = () => OFFSET_CORNERS.find(k => $(`oc-${k}`).getAttribute('aria-pressed') === 'true') ?? 'linear';
    c.compute = () => ids.flatMap(cid => {
      const src = curveById(cid), d = num(field);
      if (!offset) return [filletCurve(src, d)];
      return c.both ? [offsetCurve(src, d, corner()), offsetCurve(src, -d, corner())] : [offsetCurve(src, d, corner())];
    });
    c.preview = () => {
      clearPreview();
      c.gizmo?.render(num(field));
      for (const [k, on] of [['oc-lock', c.both], ['oc-free', c.placing]]) if (offset) $(k).setAttribute('aria-pressed', String(on));
      try {
        c.out = c.compute();
        showCurvePreview(c.out);
        $(hint).textContent = `${ids.length} CURVE${ids.length > 1 ? 'S' : ''}`;
        setHud(c.placing ? 'CLICK WHERE THE OFFSET GOES' : `${toolInfo(id).label} ${num(field)} MM${offset ? ` · ${corner().toUpperCase()}${c.both ? ' · BOTH SIDES' : ''}` : ''}`);
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
    const c = cmd = { id: 'imprint', body: null, faces: [], curves: [], tools: [], sent: 0, shown: 0 };
    lastTool = 'imprint';
    showTool('imprint');
    setState('none');
    c.request = () => ({ body: c.body, faces: c.faces, curves: c.curves, tools: { bodies: c.tools } });
    c.preview = () => livePreview(c, () => backend.previewImprint(c.request()), b => {
      showPreviewBody(b);
      setHud(`IMPRINT ${c.curves.length} CURVE${c.curves.length > 1 ? 'S' : ''}`);
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
   * Plasticity's Extend on a sheet's edge: the sheet grown past the selected open edge, carrying
   * straight on from its face. D types the distance; the sheet keeps its body.
   */
  function startExtendSheet() {
    if (!backend.previewExtendSheet) return toast('EXTEND SHEET IS NOT IN THIS BUILD YET');
    const isSheetBody = id => !!current.find(b => b.id === id)?.sheet;
    const picked = () => { const es = sel.list('edge'); return es.length === 1 && isSheetBody(es[0].body) ? es[0] : null; };
    if (!picked()) return toast('SELECT ONE EDGE OF A SHEET');
    const c = cmd = { id: 'extend-sheet', edge: picked(), sent: 0, shown: 0 };
    lastTool = 'extend-sheet';
    showTool('extend-sheet');
    setState('none');
    c.request = () => ({ body: c.edge.body, edge: c.edge.n, distance: num('es-d') });
    c.preview = () => livePreview(c, () => backend.previewExtendSheet(c.request()), b => {
      const m = showPreviewBody(b, phantom.add.face, phantom.add.edge);
      m.renderOrder = 5;
      $('es-hint').textContent = `${label(c.edge.body)} · ${num('es-d')} MM PAST THE EDGE`;
      setHud(`EXTEND SHEET ${num('es-d')} MM`);
    }, 'es-hint');
    c.onSelection = () => {
      drawOverlays();
      const e = picked();
      if (!e) {
        const missing = 'SELECT ONE EDGE OF A SHEET';
        $('es-hint').textContent = missing;
        clearPreview();
        return setHud(missing);
      }
      c.edge = e;
      setTarget(label(e.body));
      c.preview();
    };
    c.key = action => {
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
        record(`EXTEND SHEET ${num('es-d')} MM`, id);
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
    const c = cmd = { id: 'bridge-surface', edges: [], sent: 0, shown: 0 };
    lastTool = 'bridge-surface';
    showTool('bridge-surface');
    setState('none');
    const side = e => ({ body: e.body, edge: e.n });
    c.request = () => ({ a: side(c.edges[0]), b: side(c.edges[1]), tension: num('bs-t') });
    c.preview = () => livePreview(c, () => backend.previewBridgeSurface(c.request()), b => {
      const m = showPreviewBody(b, phantom.add.face, phantom.add.edge);
      m.renderOrder = 5;
      $('bs-hint').textContent = `TANGENT TO BOTH FACES · TENSION ${num('bs-t')}`;
      setHud(`BRIDGE SURFACE · TENSION ${num('bs-t')}`);
    }, 'bs-hint');
    c.onSelection = () => {
      drawOverlays();
      c.edges = sel.list('edge');
      setTarget(c.edges.length ? c.edges.map(e => label(e.body)).join(' · ') : '—');
      if (c.edges.length !== 2) {
        const missing = 'SELECT TWO EDGES OF SHEETS OR SOLIDS';
        $('bs-hint').textContent = missing;
        clearPreview();
        return setHud(missing);
      }
      c.preview();
    };
    c.key = action => {
      if (action !== 'tension') return false;
      c.entry = { label: 'TENSION', text: '', apply: v => { if (v > 0) { $('bs-t').value = v; c.preview(); } else toast('THE TENSION MUST BE ABOVE ZERO'); } };
      setHud('TENSION _');
      return true;
    };
    c.click = e => {
      if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return true;
      const hit = pickAt(e);
      if (hit?.kind !== 'edge') return true;
      sel.toggle({ kind: 'edge', body: hit.body, n: hit.n });
      selectionChanged();
      return true;
    };
    c.finish = async () => {
      if (c.edges.length !== 2) { setState('failed'); return toast($('bs-hint').textContent); }
      try {
        const { id, scene: list } = await backend.commitBridgeSurface(c.request());
        endCmd('committed');
        record(`BRIDGE SURFACE · TENSION ${num('bs-t')}`, id);
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
   * Plasticity's Patch: a sheet filling one closed loop of the selected curves and edges. A flat
   * loop gives its plane; any other is filled with a smooth sheet. T makes the sheet leave the
   * selected edges tangent to their faces. The sheet is a body of its own; the loop stays.
   */
  function startPatch() {
    if (!backend.previewPatch) return toast('PATCH IS NOT IN THIS BUILD YET');
    const c = cmd = { id: 'patch', tangent: false, curves: [], edges: [], sent: 0, shown: 0 };
    lastTool = 'patch';
    showTool('patch');
    setState('none');
    c.request = () => ({ curves: c.curves, edges: c.edges.map(e => ({ body: e.body, edge: e.n, tangent: c.tangent })) });
    c.preview = () => livePreview(c, () => backend.previewPatch(c.request()), b => {
      const m = showPreviewBody(b, phantom.add.face, phantom.add.edge);
      m.renderOrder = 5;
      $('patch-hint').textContent = c.tangent && c.edges.length ? 'SMOOTH SHEET, TANGENT TO THE FACES' : 'SHEET THROUGH THE LOOP';
      setHud('PATCH');
    }, 'patch-hint');
    c.onSelection = () => {
      drawOverlays();
      c.curves = sel.curves.filter(curveById);
      c.edges = sel.list('edge');
      $('patch-curves').textContent = c.curves.length;
      $('patch-edges').textContent = c.edges.length;
      $('patch-tangent').setAttribute('aria-pressed', String(c.tangent));
      $('patch-tangent').disabled = !c.edges.length;
      setTarget(c.curves.length + c.edges.length ? `${c.curves.length + c.edges.length} PIECES` : '—');
      if (!c.curves.length && !c.edges.length) {
        const missing = 'SELECT CURVES OR EDGES THAT MAKE ONE CLOSED LOOP';
        $('patch-hint').textContent = missing;
        clearPreview();
        return setHud(missing);
      }
      c.preview();
    };
    c.key = action => {
      if (action !== 'tangent') return false;
      c.tangent = !c.tangent;
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
      try {
        const { id, scene: list } = await backend.commitPatch(c.request());
        endCmd('committed');
        record(`PATCH${c.tangent && c.edges.length ? ' TANGENT' : ''}`, id);
        await showScene(list);
        sel.replace({ kind: 'solid', body: id });
        selectionChanged({ quiet: true });
      } catch (e) { setState('failed'); toast(say(e)); }
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
   * (F freezes it while the cursor moves on; Tab types its radius); click to place it.
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
        c.out = tangentCircle(c.picks[0], c.picks[1], c.at, c.radius);
        showCurvePreview([c.out]);
        setHud(`TANGENT CIRCLE R ${c.out.radius.toFixed(2)}${c.frozen ? ' · FROZEN' : ''}`);
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
        setHud(c.picks.length === 1 ? 'CLICK THE SECOND CURVE' : 'MOVE TO SIZE THE CIRCLE, THEN CLICK');
        return true;
      }
      await c.finish();
      return true;
    };
    c.key = action => {
      if (action === 'freeze') { c.frozen = !c.frozen; update(); return true; }
      if (action === 'typed') {
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
    $('mass').textContent = weighed.length ? formatMass(weighed.reduce((g, id) => g + massOf(bodyOf(id)?.volume ?? 0, materials.get(materialOf.get(id)).density), 0)) : '—';
  }
  /** Bodies that use the material changed: their faces take the new values. */
  function materialsChanged() {
    for (const m of bodies.children) m.material = faceMatFor(m.userData.id);
    applyView();
    renderMass();
  }

  /**
   * Plasticity's Set Material (M): a material for the selected solids and sheets (a group's bodies
   * when the group is picked in the outliner). When they already share one, it is that material that
   * changes, for every body using it; Fork gives them a copy of their own, Remove takes it off.
   */
  function startMaterial() {
    const ids = sel.bodies.filter(id => org.picks(id));
    if (!ids.length) return toast('SELECT SOLIDS OR SHEETS');
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
    lastTool = 'material';
    showTool('material');
    setState('updated');
    setHud('SET MATERIAL · ⏎ TO KEEP');
    const sync = () => {
      const users = [...materialOf.values()].filter(m => m === c.mat.id).length;
      $('mat-hint').textContent = `${c.mat.name} · ${users} BOD${users > 1 ? 'IES' : 'Y'}`;
      for (const input of $$('[data-mat]')) if (input !== document.activeElement) input.value = c.mat[input.dataset.mat];
      const g = ids.reduce((sum, id) => sum + massOf(bodyOf(id)?.volume ?? 0, c.mat.density), 0);
      $('mat-mass').textContent = formatMass(g);
      materialsChanged();
    };
    c.edit = (key, value) => {
      const next = { ...c.mat, [key]: key === 'color' ? value : parseFloat(value) };
      if (checkMaterial(next).length) return false;
      Object.assign(c.mat, next);
      sync();
      return true;
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
      toast(`MATERIAL REMOVED · ${ids.length} BOD${ids.length > 1 ? 'IES' : 'Y'}`);
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
    const ids = sel.bodies.filter(id => materialOf.has(id));
    if (!ids.length) return toast('NO MATERIAL ON THE SELECTION');
    for (const id of ids) materialOf.delete(id);
    for (const k of [...materials.keys()]) if (![...materialOf.values()].includes(k)) materials.delete(k);
    materialsChanged();
  }

  function startExportMesh() {
    if (!backend.meshBodies) return toast('MESH EXPORT IS NOT IN THIS BUILD YET');
    const ids = (sel.bodies.length ? sel.bodies : current.map(b => b.id)).filter(id => org.shows(id));
    if (!ids.length) return toast('NOTHING TO EXPORT');
    const c = cmd = { id: 'export-mesh', format: 'obj' };
    lastTool = 'export-mesh';
    showTool('export-mesh');
    setState('none');
    $('mx-hint').textContent = `${ids.length} SOLID${ids.length > 1 ? 'S' : ''}`;
    setHud('EXPORT MESH · ⏎ TO SAVE');
    const sync = () => { for (const b of $$('[data-mxf]')) b.setAttribute('aria-pressed', b.dataset.mxf === c.format); };
    c.key = action => { if (action === 'obj' || action === 'stl') { c.format = action; sync(); return true; } return false; };
    c.finish = async () => {
      const tolerance = num('mx-tol'), angle = num('mx-angle') * DEG, maxWidth = num('mx-width');
      try {
        const meshes = (await backend.meshBodies(ids, { tolerance, angle })).map(m => ({ name: label(m.id), ...limitEdges(m.positions, m.indices, maxWidth) }));
        const triangles = meshes.reduce((n, m) => n + m.indices.length / 3, 0);
        const name = `witness3d-${ids.length === 1 ? label(ids[0]).toLowerCase() : 'model'}.${c.format}`;
        const msg = await backend.saveExport(name, c.format === 'obj' ? toObj(meshes) : toStl(meshes));
        endCmd(msg ? 'committed' : 'cancelled');
        if (msg) toast(`${msg} · ${triangles} TRIANGLES`);
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
    if (!ids.length && !curves.length) return toast('NOTHING TO EXPORT');
    const c = cmd = { id: 'export-drawing', format: 'svg', hidden: true, curves: true };
    lastTool = 'export-drawing';
    showTool('export-drawing');
    setState('none');
    $('dr-hint').textContent = [ids.length && `${ids.length} SOLID${ids.length > 1 ? 'S' : ''}`, curves.length && `${curves.length} CURVE${curves.length > 1 ? 'S' : ''}`].filter(Boolean).join(' · ');
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
        const lines = ids.length ? await backend.hiddenLines({ bodies: ids, ...view, deflection: num('dr-tol') }) : [];
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
        const out = extendCurve(src, nearestEnd(src, at), num('ext-len'));
        const { ids: made } = await backend.replaceCurves([src.id], [out]);
        c.count++;
        record(`EXTEND ${curveLabel(src.id)} ${num('ext-len')} MM`, made[0], curveLabel(made[0]));
        await loadCurves();
        setHud(`${c.count} EXTENDED · CLICK ANOTHER, OR ⏎`);
        setState('committed');
      } catch (err) { setState('failed'); toast(say(err)); }
      return true;
    };
    c.finish = () => endCmd(c.count ? 'committed' : 'cancelled');
    c.abort = () => endCmd(c.count ? 'committed' : 'cancelled');
  }

  /** Plasticity's Bridge Curves: a smooth curve between the nearest ends of two selected open curves. */
  function startBridge() {
    const ids = sel.curves.filter(curveById);
    if (ids.length !== 2) return toast('SELECT TWO OPEN CURVES TO BRIDGE');
    if (!backend.addCurves) return toast('BRIDGE IS NOT IN THIS BUILD YET');
    const [a, b] = ids.map(curveById);
    // The nearest pair of ends, measured in the viewport.
    const endPoint = (cv, w) => { const f = curveFrame(cv), p = curve2d(cv), q = w ? p[p.length - 1] : p[0]; return lift(f, q); };
    let pick = null;
    for (const ea of [0, 1]) for (const eb of [0, 1]) {
      const d = endPoint(a, ea).distanceTo(endPoint(b, eb));
      if (!pick || d < pick.d) pick = { d, ea, eb };
    }
    const c = cmd = { id: 'bridge', out: null };
    lastTool = 'bridge';
    showTool('bridge');
    setState('none');
    setTarget(`${curveLabel(a.id)} · ${curveLabel(b.id)}`);
    c.preview = () => {
      clearPreview();
      try {
        c.out = bridgeCurves(a, pick.ea, b, pick.eb, num('br-t'));
        showCurvePreview([c.out]);
        $('br-hint').textContent = `${curveLabel(a.id)} TO ${curveLabel(b.id)}`;
        setHud(`BRIDGE · TENSION ${num('br-t')}`);
        setState('updated');
      } catch (e) { c.out = null; $('br-hint').textContent = say(e); setHud('BRIDGE FAILED'); setState('failed'); }
    };
    c.key = action => {
      if (action !== 'tension') return false;
      c.entry = { label: 'TENSION', text: '', apply: v => { $('br-t').value = v; c.preview(); } };
      setHud('TENSION _');
      return true;
    };
    c.finish = async () => {
      if (!c.out) return toast($('br-hint').textContent);
      try {
        const { ids: made } = await backend.addCurves([c.out]);
        endCmd('committed');
        record('BRIDGE CURVES', made[0], curveLabel(made[0]));
        await curvesChanged(made);
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => clearPreview();
    c.preview();
  }

  /** Plasticity's Explode: split the selected lines and joined curves into their pieces, one undo step. */
  async function explodeSelected() {
    if (cmd) await finish();
    const ids = sel.curves.filter(curveById);
    if (!ids.length) return toast('SELECT A CURVE TO EXPLODE');
    if (!backend.replaceCurves) return toast('EXPLODE IS NOT IN THIS BUILD YET');
    try {
      const list = ids.flatMap(id => explode(curveById(id)));
      const { ids: made } = await backend.replaceCurves(ids, list);
      record(`EXPLODE ${ids.map(curveLabel).join(' ')}`, made[0], `${made.length} CURVES`);
      await curvesChanged(made);
    } catch (e) { toast(say(e)); }
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
      stage: 'base', size: null, height: null, drive: 'height', op: 'new', target: null, sent: 0, shown: 0, entry: null };
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
      const extra = { target: pl.target ?? null, op: c.op };
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
      if (c.stage === 'height' || c.dragging) { c.stage = 'adjust'; c.dragging = false; solidPreview(); hint('DRAG THE DOTS · Q W ⇧E ⇧Q B FOR THE TARGET · ⏎ TO FINISH'); return true; }
      return true;
    };
    c.key = action => {
      if (action === 'centre' || action === 'square') { if (!(id === 'box' || id === 'center-box')) return false; c[action] = !c[action]; syncOpts(); outline(); syncFields(); solidPreview(); return true; }
      if (action === 'vertical') { if (id !== 'cylinder') return false; c.vertical = !c.vertical; syncOpts(); solidPreview(); return true; }
      if (['union', 'difference', 'intersect', 'slice', 'new'].includes(action)) {
        if (action !== 'new' && !c.plane?.target) { toast('START ON A FACE OF A SOLID TO COMBINE WITH IT'); return true; }
        c.op = action; syncOpts(); solidPreview(); return true;
      }
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
        record(`${toolInfo(id).label}${c.op !== 'new' ? ` · ${c.op.toUpperCase()}` : ''}`, made);
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
   * Plasticity's Draft Face: the selected faces of one solid tilt about the construction plane, the
   * neutral plane, so the part leaves its mould along the plane's normal. A types the angle; the
   * DRAFT view shows which faces still need it.
   */
  function startDraft() {
    const body = faceBody();
    if (body === null) return toast(sel.list('face').length ? 'DRAFT THE FACES OF ONE SOLID AT A TIME' : 'SELECT THE FACES TO DRAFT');
    if (!backend.previewDraft) return toast('DRAFT FACE IS NOT IN THIS BUILD YET');
    const c = cmd = { id: 'draft', body, faces: [], sent: 0, shown: 0 };
    lastTool = 'draft';
    showTool('draft');
    setState('none');
    $('draft-pull').textContent = cplane.name;
    c.request = () => ({ body: c.body, faces: c.faces, pull: cplane.normal.toArray(), origin: cplane.origin.toArray(), angle: num('draft-a') * DEG });
    c.preview = () => livePreview(c, () => backend.previewDraft(c.request()), b => { showPreviewBody(b); setHud(`DRAFT ${num('draft-a')}°`); }, 'draft-hint');
    c.onSelection = () => {
      drawOverlays();
      const b = faceBody();
      if (b === null) return setHud('SELECT FACES OF ONE SOLID TO DRAFT');
      c.body = b;
      c.faces = sel.list('face').map(it => it.n).sort((x, y) => x - y);
      setTarget(label(b));
      $('draft-count').textContent = c.faces.length;
      $('draft-hint').textContent = `${c.faces.length} FACE${c.faces.length > 1 ? 'S' : ''} OF ${label(b)} ABOUT PLANE ${cplane.name}`;
      c.preview();
    };
    c.key = action => {
      if (action !== 'angle') return false;
      c.entry = { label: 'ANGLE', text: '', apply: v => { $('draft-a').value = v; c.preview(); } };
      setHud('ANGLE _');
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
        const { id, scene: list } = await backend.commitDraft(c.request());
        endCmd('committed');
        record(`DRAFT ${num('draft-a')}° ×${c.faces.length}`, id);
        await showScene(list);
        sel.replace({ kind: 'solid', body: id });
        selectionChanged({ quiet: true });
      } catch (e) { setState('failed'); toast(say(e)); }
    };
    c.abort = () => endCmd('cancelled');
    c.cleanup = () => clearPreview();
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
    const hint = { mirror: 'mirror-hint', 'rect-array': 'ra-hint', 'radial-array': 'rr-hint' }[id];
    const joinBtn = { mirror: 'mirror-join', 'rect-array': 'ra-join', 'radial-array': 'rr-join' }[id];
    const c = cmd = { id, ids, join: false, sent: 0, shown: 0 };
    lastTool = id;
    showTool(id);
    setState('none');
    setTarget(ids.length === 1 ? label(ids[0]) : `${ids.length} SOLIDS`);
    $(hint).textContent = `${ids.length} SOLID${ids.length > 1 ? 'S' : ''}`;
    $(joinBtn).setAttribute('aria-pressed', 'false');
    c.preview = () => livePreview(c, () => backend[preview]({ bodies: c.ids, ...request(c) }), list => { showCopies(list); setHud(describe(c, list.length)); }, hint);
    c.key = action => {
      if (action === 'join') { c.join = !c.join; $(joinBtn).setAttribute('aria-pressed', c.join); return true; }
      if (['x', 'y', 'z'].includes(action) && id !== 'rect-array') { c.axis = action; syncAxis(c); c.preview(); return true; }
      return false;
    };
    c.finish = async () => {
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

  function startMirror() {
    const c = startCopies('mirror', c => {
      const n = userAxis(c.axis), at = num('mirror-at');
      return { origin: toWorld(n.map(v => v * at)), normal: toWorld(n) };
    }, c => `MIRROR ACROSS ${c.axis.toUpperCase()} = ${num('mirror-at')}`);
    if (!c) return;
    c.axis = 'x';
    syncAxis(c);
    c.preview();
  }

  function startArray(id) {
    const radial = id === 'radial-array';
    const c = startCopies(id, c => radial
      ? { spec: { kind: 'radial', pivot: cplane.origin.toArray(), axis: toWorld(userAxis(c.axis)), angle: num('rr-angle') * DEG, count: Math.round(num('rr-count')) } }
      : { spec: { kind: 'rectangular', steps: ['x', 'y', 'z'].map(a => toWorld(userAxis(a).map(v => v * num(`ra-s${a}`)))), counts: ['x', 'y', 'z'].map(a => Math.round(num(`ra-c${a}`))) } },
    (c, n) => `${n} ${n === 1 ? 'COPY' : 'COPIES'}`);
    if (!c) return;
    c.axis = 'z';
    if (radial) syncAxis(c);
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
  function startForm(id) {
    const regions = sel.list('region').map(it => it.id).filter(rid => curveList.some(c => c.id === rid && isClosed(c)));
    if (!backend.previewForm) return toast(`${toolInfo(id).label} IS NOT IN THIS BUILD YET`);
    if (!regions.length || (id === 'loft' && regions.length < 2)) return toast(id === 'loft' ? 'SELECT TWO REGIONS OR MORE, IN ORDER, TO LOFT' : `SELECT A REGION TO ${toolInfo(id).label}`);
    const first = curveList.find(c => c.id === regions[0]);
    const target = bodyAt(regionCentre(first), curveFrame(first).n);
    const c = cmd = { id, regions: id === 'loft' ? regions : regions.slice(0, 1), target, op: 'new', angle: 360, thickness: 0, twist: 0, scale: 1, p1: null, p2: null, path: null, guides: [], method: 'point', align: 'normal', outcome: null, sent: 0, shown: 0, line: null };
    lastTool = id;
    showTool(id);
    setState('none');
    setTarget(target ? label(target) : 'NEW BODY');
    $('form-angle-row').hidden = $('form-thickness-row').hidden = id !== 'revolve';
    $('form-twist-row').hidden = $('form-scale-row').hidden = id !== 'sweep';
    $('form-ops').hidden = id === 'loft';
    $('form-guides-row').hidden = id === 'revolve';
    $('form-method-row').hidden = $('form-align-row').hidden = id !== 'sweep';
    setGuideChips(c);
    $('form-angle').value = c.angle; $('form-thickness').value = c.thickness; $('form-twist').value = c.twist; $('form-scale').value = c.scale;
    $('form-outcome').textContent = '—';
    setFormOps();
    const hint = () => {
      const guides = c.guides.length ? ` · GUIDES ${c.guides.map(g => curveLabel(g)).join(', ')}` : '';
      const text = id === 'loft' ? `${c.regions.map(r => curveLabel(r)).join(' → ')}${guides || ' · CLICK GUIDES (OPTIONAL)'}`
        : id === 'revolve' ? (!c.p1 ? 'CLICK THE AXIS START' : !c.p2 ? 'CLICK THE AXIS END' : `${c.angle}° ABOUT THE AXIS${c.thickness ? ` · WALLS ${c.thickness}` : ''}`)
        : !c.path ? 'CLICK THE CURVE TO SWEEP ALONG' : `ALONG ${curveLabel(c.path)}${guides || ' · CLICK A GUIDE (OPTIONAL)'}`;
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
      // first click picks the path, a later one the guide (this build follows one).
      const picked = curveAt(e);
      if (picked === null || c.regions.includes(picked)) return true;
      if (id === 'sweep' && (c.path === null || picked === c.path)) c.path = picked;
      else if (id === 'sweep') c.guides = c.guides[0] === picked ? [] : [picked];
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
      Object.assign(req, { path: c.path, twist: c.twist * DEG, scale: c.scale, guides: c.guides, method: c.method, align: c.align });
    }
    if (c.id === 'loft') req.guides = c.guides;
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
      const what = c.id === 'revolve' ? `REVOLVE ${c.angle}°${c.thickness ? ` T ${c.thickness}` : ''}` : c.id === 'loft' ? `LOFT ×${c.regions.length}${c.guides.length ? ` · ${c.guides.length} GUIDES` : ''}` : `SWEEP${c.twist ? ` ${c.twist}°` : ''}${c.scale !== 1 ? ` ×${c.scale}` : ''}${c.guides.length ? ` · GUIDE ${c.method.toUpperCase()}` : ''}${c.align === 'parallel' ? ' · PARALLEL' : ''}`;
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
    if (!ids.length && !curves.length) return toast(sel.size ? 'DELETE WORKS ON SOLIDS AND CURVES FOR NOW' : 'SELECT SOMETHING TO DELETE');
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
    for (const id of ids) {
      try { const msg = await backend.exportStep(id); if (!msg) return; toast(msg); }
      catch (e) { toast(say(e)); }
    }
  }

  function renderModes() {
    const all = ['point', 'edge', 'face', 'solid'].every(k => sel.allows(k));
    for (const b of $$('[data-mode]')) b.setAttribute('aria-pressed', b.dataset.mode === 'all' ? all : sel.allows(b.dataset.mode));
  }

  /** Run a named action (keymap.js); returns false for names it doesn't know. */
  async function doAction(a) {
    const [kind, arg] = a.split(':');
    switch (kind) {
      case 'view':
        if (arg === 'radial') openRadial(a.split(':')[2]);
        else if (arg === 'ortho') setOrtho(!camera.isOrthographicCamera);
        else if (arg === 'focus') focus();
        else if (arg === 'xray') { view.xray = !view.xray; applyView(); }
        else if (arg === 'curvature') { view.curvature = !view.curvature; applyView(); }
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
        else sel.invert(current.filter(b => org.picks(b.id)));
        selectionChanged({ quiet: arg !== 'all' && arg !== 'invert' });
        return true;
      case 'tool': case 'draw': await startTool(arg); return true;
      case 'plane':
        if (arg === 'selection') planeFromSelection(true);
        else if (arg === 'selection-keep-view') planeFromSelection(false);
        else if (arg === 'view') planeFromView();
        else setPlane({ origin: new THREE.Vector3(), normal: UP, name: 'XY' });
        return true;
      case 'radial': openRadial(arg); return true;
      case 'app':
        if (arg === 'quit') { if (backend.quit) backend.quit(); else toast('CLOSE THE TAB TO QUIT'); }
        else openPMenu();
        return true;
      case 'file': {
        if (arg === 'recent') { openPMenu(); return true; }
        if (arg === 'export') { openPalette(false, 'EXPORT'); return true; }
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
      case 'unjoin': await unjoinSelected(arg !== 'pieces'); return true;
      case 'material': if (arg === 'remove') removeMaterial(); else await startTool('material'); return true;
    }
    switch (a) {
      case 'palette': openPalette(false); return true;
      case 'ask': openAsk(); return true;
      case 'suggest': openPalette(true); return true;
      case 'repeat': if (lastTool) await startTool(lastTool); else toast('NO COMMAND TO REPEAT'); return true;
      case 'delete': await deleteSelected(); return true;
      case 'duplicate': await duplicateSelected(); return true;
      case 'join': await joinSelected(); return true;
      case 'trim': await startTool('trim'); return true;
      case 'extend': await startTool('extend'); return true;
      case 'split': await startTool('split'); return true;
      case 'measure': await startTool(arg === 'radius' ? 'measure-radius' : arg === 'continuity' ? 'measure-continuity' : 'measure-distance'); return true;
      case 'explode': await explodeSelected(); return true;
      case 'hide': setHidden(sel.bodies, true); return true;
      case 'hide-others': setHidden(current.map(b => b.id).filter(id => !sel.bodies.includes(id)), true); return true;
      case 'unhide-all': setHidden([...org.hidden], false); return true;
      case 'invert-hidden': org.invertHidden(current.map(b => b.id)); organised(); return true;
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
  const P_NEEDS = { 'file:new': 'newDocument', 'file:open': 'open', 'import:step': 'importStep', 'file:save': 'save', 'file:save-as': 'saveAs', 'file:save-version': 'saveVersion', 'app:quit': 'quit' };
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
    if (kinds.has('solid')) out.push('tool:move', 'tool:rotate', 'tool:scale', 'duplicate', 'tool:mirror', 'tool:rect-array', 'tool:radial-array', 'delete', 'hide', 'isolate', 'group', 'lock', 'material:set', 'export:step', 'export:mesh', 'export:drawing');
    if (kinds.has('face')) out.push('tool:extrude', 'tool:offset', 'tool:thicken', 'tool:shell', 'tool:hole', 'tool:remove-face', 'plane:selection', 'plane:selection-keep-view');
    if (kinds.has('edge')) out.push('tool:fillet', 'tool:patch', 'measure:radius');
    if (sel.list('edge').length === 2) out.push('tool:bridge-surface');
    if (sel.solids.some(id => current.find(b => b.id === id)?.sheet)) out.push('tool:thicken');
    if (sel.solids.length > 1 && sel.solids.every(id => current.find(b => b.id === id)?.sheet)) out.push('join');
    if (sel.solids.length === 1) out.push('unjoin:faces', 'unjoin:pieces');
    if (sel.list('edge').some(e => current.find(b => b.id === e.body)?.sheet)) out.push('tool:extend-sheet');
    if (kinds.has('region')) out.push('tool:extrude', 'tool:revolve', 'tool:loft', 'tool:sweep');
    if (kinds.has('curve') || kinds.has('region')) {
      if (kinds.has('solid')) out.push('tool:project', 'tool:cut', 'tool:imprint');
      if (sel.curves.length === 2) out.push('tool:project');
      out.push('tool:patch', 'tool:pipe');
      if (kinds.has('face')) out.push('tool:imprint');
      if (kinds.has('face')) out.push('tool:draft');
      out.push('trim', 'split', 'extend', 'tool:offset-curve', 'tool:fillet-curve');
      if (sel.curves.length === 2) out.push('tool:bridge');
      if (sel.curves.length > 1) out.push('join');
      out.push('explode', 'measure:continuity', 'delete');
    }
    if (kinds.size) out.push('convert:solid', 'select:invert', 'view:focus');
    else out.push('draw:line', 'draw:spline', 'draw:rect', 'draw:circle', 'draw:arc3', 'tool:box', 'tool:cylinder', 'tool:sphere', 'select:all', 'unhide-all', 'plane:view');
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
    await backend.setAppState({ organise: org.toJSON(), materials: [...materials.values()], materialOf: [...materialOf], nextMaterial });
  }
  async function restoreAppState() {
    const st = backend.appState ? await backend.appState() : null;
    org = Organise.from(st?.organise);
    materials.clear(); materialOf.clear(); for (const m of bodyMats.values()) m.dispose(); bodyMats.clear();
    for (const m of Array.isArray(st?.materials) ? st.materials : []) if (Number.isInteger(m?.id) && !checkMaterial({ ...newMaterial(m.id), ...m }).length) materials.set(m.id, { ...newMaterial(m.id), ...m });
    for (const [b, m] of Array.isArray(st?.materialOf) ? st.materialOf : []) if (materials.has(m)) materialOf.set(b, m);
    nextMaterial = Math.max(Number.isInteger(st?.nextMaterial) ? st.nextMaterial : 1, ...[...materials.keys()].map(k => k + 1));
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
  if (!backend.importStep && backend.addCurves) { $('import').hidden = false; $('import').title = 'Import a DXF drawing as curves'; }
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
    if (file) await importDxf(await file.text(), file.name);
  });
  $('import').onclick = () => fileAction(async () => {
    if (!backend.importStep) return $('import-file').click();
    const r = await backend.importStep();
    if (!r) return;
    if (r.dxf !== undefined) return importDxf(r.dxf, r.name);
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
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4;
    if (e.button === 2) { if (!moved && cmd) await finish(); return; } // Plasticity: right-click finishes
    if (e.button !== 0 || d.consumed) return;
    if (d.box) {
      $('boxsel').hidden = true;
      if (cmd && !cmd.auto) return;
      return boxSelect(local({ clientX: d.x, clientY: d.y }), local(e), modOf(e));
    }
    if (moved) return;
    if (cmd?.click && await cmd.click(e)) return;
    if (cmd && !cmd.auto) return;
    applySelect(clickTarget(pickAt(e), modOf(e)), modOf(e));
    hover = null;
    selectionChanged();
  });
  canvas.addEventListener('dblclick', e => {
    if (cmd && !cmd.auto) return;
    const hit = pickAt(e);
    if (!hit || hit.body === undefined) return;
    applySelect({ kind: 'solid', body: hit.body }, e.shiftKey ? 'add' : 'replace');
    selectionChanged();
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  // --- panel input ----------------------------------------------------------
  for (const b of $$('[data-profile]')) b.onclick = () => setProfile(b.dataset.profile);
  for (const b of $$('[data-op]')) b.onclick = () => setOperation(b.dataset.op);
  for (const b of $$('[data-toggle]')) b.onclick = () => { view[b.dataset.toggle] = !view[b.dataset.toggle]; applyView(); snapsFor(view.snap); };
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
  for (const id of ['hole-d', 'hole-depth']) $(id).addEventListener('input', () => cmd?.id === 'hole' && cmd.preview());
  $('hole-through').onclick = () => cmd?.id === 'hole' && cmd.key('through');
  $('br-t').addEventListener('input', () => cmd?.id === 'bridge' && cmd.preview());
  for (const input of $$('[data-mat]')) input.addEventListener('input', () => { if (cmd?.id === 'material' && !cmd.edit(input.dataset.mat, input.value)) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); });
  $('mat-fork').onclick = () => cmd?.id === 'material' && cmd.fork();
  $('mat-remove').onclick = () => cmd?.id === 'material' && cmd.remove();
  for (const b of $$('[data-shader]')) b.onclick = () => { view.shader = b.dataset.shader; view.render = false; applyView(); };
  for (const b of $$('[data-env]')) b.onclick = () => { view.environment = b.dataset.env; applyView(); };
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
  for (const id of ['oc-d', 'fc-r']) $(id).addEventListener('input', () => (cmd?.id === 'offset-curve' || cmd?.id === 'fillet-curve') && cmd.preview());
  $('oc-lock').onclick = () => cmd?.id === 'offset-curve' && cmd.key('lock');
  $('oc-free').onclick = () => cmd?.id === 'offset-curve' && cmd.key('freestyle');
  for (const k of OFFSET_CORNERS) $(`oc-${k}`).onclick = () => {
    for (const j of OFFSET_CORNERS) $(`oc-${j}`).setAttribute('aria-pressed', j === k);
    if (cmd?.id === 'offset-curve') cmd.preview();
  };
  for (const id of ['prim-w', 'prim-d', 'prim-r', 'prim-h']) $(id).addEventListener('input', () => PRIMS[cmd?.id] && cmd.fromFields(id));
  for (const b of $$('[data-popt], [data-pop]')) b.onclick = () => PRIMS[cmd?.id] && cmd.key(b.dataset.popt ?? b.dataset.pop);
  $('shell-t').addEventListener('input', () => cmd?.id === 'shell' && cmd.preview());
  $('draft-a').addEventListener('input', () => cmd?.id === 'draft' && cmd.preview());
  for (const id of ['mirror-at', 'ra-cx', 'ra-cy', 'ra-cz', 'ra-sx', 'ra-sy', 'ra-sz', 'rr-count', 'rr-angle']) $(id).addEventListener('input', () => cmd?.preview?.());
  for (const b of $$('[data-mx], [data-rx]')) b.onclick = () => cmd?.key?.(b.dataset.mx ?? b.dataset.rx);
  for (const id of ['mirror-join', 'ra-join', 'rr-join']) $(id).onclick = () => cmd?.key?.('join');
  $('cut-plane').onclick = () => cmd?.id === 'cut' && cmd.key('plane');
  $('bs-t').addEventListener('input', () => cmd?.id === 'bridge-surface' && cmd.preview());
  $('es-d').addEventListener('input', () => cmd?.id === 'extend-sheet' && cmd.preview());
  for (const f of ['th-f', 'th-b']) $(f).addEventListener('input', () => cmd?.id === 'thicken' && cmd.preview());
  for (const f of ['pipe-r', 'pipe-t', 'pipe-v']) $(f).addEventListener('input', () => cmd?.id === 'pipe' && cmd.preview());
  $('patch-tangent').onclick = () => cmd?.id === 'patch' && cmd.key('tangent');
  $('ex-free').onclick = () => cmd?.id === 'extrude' && cmd.key('freestyle');
  $('ex-pivot').onclick = () => cmd?.id === 'extrude' && cmd.key('pivot');
  $('ex-individual').onclick = () => cmd?.id === 'extrude' && cmd.key('individual');
  for (const b of $$('[data-gmethod]')) b.onclick = () => { if (cmd?.id === 'sweep') { setForm({ method: b.dataset.gmethod }); setGuideChips(cmd); } };
  for (const b of $$('[data-galign]')) b.onclick = () => { if (cmd?.id === 'sweep') { setForm({ align: b.dataset.galign }); setGuideChips(cmd); } };
  for (const b of $$('[data-proj]')) b.onclick = () => cmd?.id === 'project' && cmd.key(b.dataset.proj);
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
      if (/^[0-9.\-]$/.test(e.key)) entry.text += e.key;
      else if (e.key === 'Backspace') entry.text = entry.text.slice(0, -1);
      return setHud(`${entry.label} ${entry.text}_`);
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
  $('loading').hidden = true;

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
  renderer.setAnimationLoop(() => {
    resize();
    stepTurn(performance.now());
    if (!turning) controls.update();
    nav.update(camera, camera.isOrthographicCamera);
    if (cmd?.gizmo) cmd.gizmo.render(cmd.gizmo.value);
    for (const g of Object.values(cmd?.dots ?? {})) g.render(g.value);
    renderer.render(scene, camera);
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
        $('br-t').value = p.tension;
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
      const out = { id: c.id, auto: !!c.auto, dot: c.gizmo ? { at: c.gizmo.position.toArray(), dir: c.gizmo.direction.toArray(), state: c.gizmo.state } : null };
      if (c.id === 'fillet') Object.assign(out, { body: c.body, edges: c.edges, value: c.value, angle: c.angle, max: c.bad !== null ? c.good : null });
      if (c.tc) Object.assign(out, { bodies: c.ids, offset: toUser(c.offset.toArray()), angle: angleAbout(c.quat, c.axis), axis: c.axis, scale: c.scale, follow: c.follow?.name ?? null });
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
    get camera() { return { position: camera.position.toArray(), target: controls.target.toArray() } },
    get bodies() { return current },
    get curves() { return curveList },
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
