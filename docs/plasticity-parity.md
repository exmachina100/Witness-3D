# Plasticity parity roadmap

Rebuilt 2026-10-13 from two sources, so nothing is left out by memory:

1. **The official manual** (doc.plasticity.xyz, v26.1): its navigation lists every command, and each
   tool page gives its click steps and option keys. The tables below follow the manual's sections.
2. **The REA package listings** of Plasticity 26.1.4 (the `.nupkg`, and the machine-wide `Plasticity.msi`) (`Plasticity-26.1.4-full.nupkg`, sha256
   `f5b34e8b…`): file names only, as in [plasticity-26-teardown.md](plasticity-26-teardown.md). Its
   `renderer/img/` holds one illustration per command option; those names are the "26.1 options"
   column. Nothing was decompiled; the JavaScript ships as V8 bytecode and stays unread.

Status: **Done** (command, options, preview, one undo step, tests, both builds) · **Partial** (what's
missing is listed) · **Missing**. "Desktop only" means the browser's opencascade.js build lacks the
algorithm. Order of work follows the manual: sketching and primitives first, then common, sketch
and solid commands, then display and files.

Every creation tool shares the manual's Sketching Essentials keys: **Tab** typed dimensions,
**X/Y/Z** axis constraint, **K** knife mode (cut faces with the drawn curve), Ctrl to snap while
moving, Shift for snap reference lines. Knife mode (K) is in every drawing tool: a curve drawn on
a flat face imprints that face and is used up (round 10).

## 1. Sketching and primitive tools

| Tool | Manual keys and steps | Status |
|---|---|---|
| Line (Shift+A) | points; Tab, K, Ctrl+Z, X/Y/Z | Partial: K |
| Spline Curve | through points; Tab → Control Point Curve, K, Ctrl+Z, X/Y/Z | Partial: K |
| Control Point Curve | clicked points are control points; Tab → Spline, K, Ctrl+Z, X/Y/Z | Partial: K (exact cubic B-spline in both kernels) |
| Bridge Curve | | Done |
| Split Curve At Point | | Done for lines, arcs and open splines |
| Insert CV At Point | | Missing (needs control-point curves) |
| Trim | | Partial: splines, ellipses, joined curves |
| Center Circle | centre, size; Tab, K, V, X/Y | Partial: K |
| Two Point Circle | | Partial: K |
| Three Point Circle | | Partial: K |
| Tangent Circle | pick two curves (optional third edge), size; F freeze, Tab radius | Partial: third edge (exact for lines, circles, arcs) |
| Ellipse (centre, three point) | | Partial: K |
| Center Point Arc · Three Point Arc · Tangent Arc | | Partial: K |
| Regular Polygon | | Partial: K |
| Spiral | | Done |
| Corner Rectangle | corner, corner; Tab, K, C → centre, S square | Partial: K |
| Center Rectangle | centre, corner; Tab, K, C → corner, S square | Partial: K |
| Three Point Rectangle | corner, edge point, size; Tab, K, X/Y/Z | Partial: K |
| Corner Box | corner, corner, drag height; C → centre, S square, Tab; height step: Q W Shift+E B Shift+Q T (boolean with target bodies), H height; yellow dots; Width/Length/Height | Partial: yellow dots, T |
| Center Box | as Corner Box from the centre | Partial: yellow dots, T |
| Three Point Box | corner, edge point, size, height; X/Y/Z; target bodies | Done |
| Cylinder | centre, drag radius, drag height; Tab, V vertical, X/Y/Z; Q W Shift+E B Shift+Q T; F radius, D height; dots | Partial: yellow dots, T |
| Sphere | centre, drag size; Tab, X/Y/Z; boolean keys; D diameter; dot | Partial: yellow dot, T |
| Measure Distance · Measure Radius | | Done |
| Measure Continuity · Toggle Curvature | | Done (combs on the convex side; G0/G1/G2 exact for lines and arcs) |

## 2. Common commands

| Command | Status |
|---|---|
| Move · Rotate · Scale | Done for solids, curves and curve vertices: whole curves move, turn and scale (shape and plane together); picked vertices, and a NURBS curve's control points (shown as its vertices in point mode), move within their curve's plane, any move across it dropped. Faces and edges with G are missing |
| Mirror | Done (copy or join) |
| Duplicate | Done |
| Radial Array · Rectangular Array | Done |
| Curve Array (along a curve) | Done: selected bodies copied evenly by length along a picked curve (count, A align to tangent, J join); closed curves stop short of the start. Both builds share the placement (web/src/curveArray.js) and send it as a motions array spec |
| Copy / Paste with Placement · Place | Missing |
| Set / Fork / Remove Material | Done in both builds: M sets a material on the selected solids and sheets (color, roughness, metalness, IOR, opacity, density); bodies that share a material change together, FORK gives them their own copy, REMOVE (or the palette's Remove Material) takes it off. Mass from density shows in the panel and under the outliner. The advanced parameters (clearcoat, sheen, iridescence, transmission) and materials on curves are missing; materials are saved in the .w3d file |
| Measure Distance · Dimension · Section Analysis | Missing |
| Complete Edge · Subdivide | Missing |
| Publish to Plasticity Share | Not planned (Plasticity's own service) |

## 3. Sketch commands

| Group | Commands | Status |
|---|---|---|
| Bridge and Connect | Bridge, Bridge Curve, Bridge Edge, Bridge Vertex | Bridge Curve and Bridge Vertex done (G0, G1, G2 per end, Tab cycles, tension T); G3 and Bridge Edge missing |
| Cut and Trim | Cut Curve, Trim, Split Segment | Trim partial; others missing |
| Deform and Slide | Deform, Deform Curve, Slide, Slide Curve CV | Missing |
| Align | Align, Align Vertex | Align Vertex done (X/Y/Z, value from the first vertex or typed; arcs keep their sweep); Align (bodies) missing |
| Extend | Extend, Extend Curve (26.1: extend-curve shape option) | Extend Curve done for any open curve with the 26.1 shape option (S: Natural carries on round an arc's circle or with a curve's end curvature, Linear goes straight along the end); joined curves extend their end piece |
| Fillet | Fillet, Fillet Curve, Fillet Vertex | Fillet Curve done (all corners). Fillet Vertex done: B with curve vertices picked rounds just those corners; the dot dragged into the corner rounds, out of it chamfers (D and C type them); chamfered polylines stay polylines |
| Join and Unjoin | Join, Join Curves, Unjoin, Unjoin Curve | Join Curves done; Explode stands in for Unjoin Curve |
| Offset | Offset Curve (26.1: Round / Linear / Natural), Offset Planar Curve, Offset Region, Offset Vertex | Offset Curve done with 26.1's corner styles (C cycles Linear, Round, Natural): lines and arcs, and contours of them, are offset exactly (arcs stay arcs), outside corners close by the chosen style and inside corners are cut where the pieces cross; splines and ellipses are offset through their points. Offset Planar Curve's keys done: V cycles the gap fill (C still works), S locks distances (both sides), F freestyle (a click sets the distance and side), a yellow dot drags the distance. Closed curves (regions) offset one by one; Offset Region O (slot) done: an open curve offset both ways and closed by half circles round its ends becomes a region; Offset Region I (combined) done: closed offsets merge where they overlap into the outline of their union (holes as loops of their own); lines and arcs stay exact, smooth curves come back as spline pieces through their points. Offset Vertex done: with point mode on, curve vertices pick (grey dots on the curves in play, orange when picked), and Offset Curve on picked vertices adds a vertex the distance along the curve either side, cutting lines and arcs without changing the shape |
| Slot | | Done: Slot (F search, or right-click a curve) starts Offset Curve with Offset Region's slot on, so an open curve becomes a closed slot round it with half circles at its ends; D sets the half width |
| Project | Project, Project Body Body, Project Curve Body, Project Curve Curve, Project Outline (26.1: method, bidirectional, hide occluded) | Project (I) done in both builds: Curve Body (Normal or Vector X/Y/Z, S screen space, Bidirectional, Hide Occluded, chosen faces or all), Body Body and Curve Curve, picked by the selection; results are new NURBS curves, flat ones usable as regions. Hide Occluded is exact on the desktop and casts rays on the mesh in the browser. Project Outline done in both builds: one body selected and no curves draws its outline seen along the construction plane's normal onto that plane (hidden-line removal, then the shadow region's boundary), holes through the body included |
| Duplication | Alternative Duplicate, Duplicate Curve and Project, Create Outline | Missing |
| Rebuild and Refine | Convert Vertex, Delete Redundant Topology, Insert Knot, Raise (Curve) Degree, Rebuild (Curve), Reverse (Curve) | Reverse Curve done (arrows show the new start; circles and ellipses have no stored direction). Rebuild Curve done: control points C and degree D, least-squares NURBS fit that keeps open ends and closes closed curves smoothly (periodic fit), new control polygon shown, max deviation in the hint (half circle r=10 with 8 points: 0.003 mm). Rebuilt curves' control points can be moved with G/R/S. Insert Knot done: click a curve to add a control point there, shape unchanged. Raise Degree done: one degree up, shape unchanged (exact in homogeneous coordinates, so arcs and circles stay round). Both turn lines, arcs, circles and control-point curves into exact NURBS first; splines, ellipses and joined curves need Rebuild Curve first. Convert Vertex done: picked corners of a line (command, or double-click a vertex in point mode) become control vertices the curve rounds past; the corners kept and the ends stay put, and converting every inner corner gives a control-point curve. The result is one NURBS curve, so its straight runs show extra control points at their middles. Delete Redundant Topology done (see Solid › Delete and Remove) |
| Instances | Create / Realize (Curve) Instance | Missing |
| Text | Text (Plasticity ships 21 typeface fonts) | Missing |
| Display and Analysis | Toggle Curve Curvature, Toggle Points | Missing |

## 4. Solid commands

| Group | Commands (26.1 options from REA) | Status |
|---|---|---|
| Boolean and Cut | Boolean, Cut | Boolean done; Cut by curves, faces (flat ones as their plane, round ones as their cylinder) and the construction plane done (both builds); Cut by free-form surface extension missing |
| Create and Duplicate | Alternative Duplicate, instances | Missing |
| Surface Creation | Extrude (Individual option), Revolve, Loft, Sweep (alignment, scale, twist), Pipe, Bridge Surface (tension, trim), Constrained Surface, Patch, PolySplines, Square, Xnurbs (boundary, quad-sided) | Extrude, Revolve, Loft, Sweep (scale, twist) done. Extrude Freestyle (F: click a start and an end point for the direction and distance; inward cuts), Pivot (V: click where the gizmo sits) and Individual (I: several selected faces of one body each along its own normal; Direct takes all along the first face's and refuses a face lying along it) done in both builds. Patch done in both builds: a sheet in one closed loop of curves and body edges, the exact plane when the loop is flat, otherwise a GeomPlate fill within 0.01 mm of the loop; T leaves body edges tangent to their faces within 0.5°, and walls standing square to the loop are refused with the reason. Sheets list under SHEETS. Bridge Surface done in both builds: two edges of sheets or solids joined by a sheet tangent to both faces (G1), with tension; open edges pair end to end, closed ones go round together; on a solid's edge it leaves the first face found. Pipe done in both builds: a tube along each selected curve, round or a regular polygon of 3 to 256 sides with corners on the radius (V), hollow with a wall thickness (T), radius R; each tube is a body of its own and the curves stay. Loft and Sweep guides done in both builds: after L, clicks on other curves add up to two guides, each touching every region, and the loft's sides run along them (within 0.01 mm at the tested guides); after picking Sweep's path, a click picks one guide, followed by Guide method Point (turns and scales to keep touching), Chord or Curve (turn only), M cycling them. Sweep Alignment Normal or Parallel (N). Loft guides beyond two, Sweep guides beyond one, edges as guides, Trim overlap and limit points missing. Its trim option, Xnurbs' quad-sided option, per-edge G2, Individual, Constrained Surface, PolySplines and Square missing |
| Deform and Slide | Deform, Deform Solid and Sheet, Slide, Slide Surface CV | Missing |
| Delete and Remove | Delete Face, Delete Redundant Topology, Remove Fillets from Shell, Remove Nominal Surface | Delete Face done on desktop (Remove Face). Delete Redundant Topology done in both builds: on the selected bodies, faces on one surface and edges on one curve merge (an imprint's split face goes back to one), one undo step, and it says how many went. Remove Fillets done on desktop: with a solid selected it finds every fillet (curved faces running smoothly into two or more others, corner balls included, a cylinder rounded at both ends excluded); with faces selected, the fillet chains holding them. They open in Remove Face, which previews the solid without them. The browser kernel cannot remove faces yet. Remove Nominal Surface missing |
| Draft and Align | Align, Align Surface, Draft Face (draft illustration) | Offset Face's angle covers part of Draft Face; rest missing |
| Extend | Extend, Extend Sheet (extend-sheet shape) | Extend Sheet done in both builds with Natural and Linear shapes (Tab; Natural first): one open edge of a sheet, D for the distance; works on a side of the sheet's surface (Patch and Bridge Surface sheets) or a straight edge of a flat sheet, and keeps one face. Natural carries the surface's curvature on (C2: GeomLib's extender on the desktop, the end span's polynomial blossomed on in the browser); Linear goes straight on (C1). Edges trimmed across a curved surface are refused. Soft and Reflective shapes, Limit (to a target body) and Modify missing |
| Fillet | Fillet, Fillet Shell (shell shape, Y-blend) | Fillet and chamfer done; variable radius done (V adds points along a rounded edge, each with its own dot, both builds); L limit points, Conic/Chordal/G2 shapes and Fillet Shell missing |
| Hollow and Thicken | Hollow, Thicken, Thicken Face | Hollow done (as Shell). Thicken done in both builds: a selected sheet body becomes a solid, D typing the front thickness (along its normals) and B the back; walls are ruled along its open edges (on the desktop, faces meeting at an angle are joined at the corner; the browser still uses the simple offset there). Thicken Face done in both builds: faces picked on a solid (Alt+click) become a solid of their own, front out of the body and back into it, the ends cut where the other faces lie and corners joined; faces of a sheet are copied out and thickened; the body stays |
| Imprint | Imprint, Imprint Body Body, Imprint Curve Body (method, complete, bidirectional, hide occluded) | Imprint Curve Body and Imprint Body Body done (both builds; curves projected along their plane normals, or where another solid meets the body, onto chosen faces or all faces); the projection options missing |
| Join and Unjoin | Join, Join Sheets, Unjoin, Unjoin Faces, Unjoin Shells | Done in both builds: J joins selected sheets that meet edge to edge (within 0.01 mm) into one body, a solid when they close; Unjoin Faces makes each face of a body its own sheet and Unjoin Shells splits a body into its separate pieces (F search or Shift+F) |
| Offset | Offset Edge, Offset Face (face-change grow, transform-face step), Offset Face Loop | Offset Face done (+ angle) with its Tab grow modes in both builds: an inner flat face pushed out past the body's outer wall takes the wall along (Moving), stops at it (Fixed) or carries on past it (None). Offset Edge done (O with edges picked): the edges, joined where they meet, move the distance across a flat face they border and carry on straight to its sides, splitting it there (Imprint); a negative distance goes onto the other flat face; V cycles the gap fill. Offset Face Loop done (O with one face picked): the flat face's outline moves in and its holes out, imprinted as a new inner face. Lines and arcs stay exact. One face at a time; Lock distances (S, both sides) and the loop's Individual (I) are missing, as are curved faces. Dependent offset (match a second face) and step missing |
| Rebuild and Refine | Isoparam, Match Face (side option), Raise (Surface) Degree, Rebuild Face, Reverse Sheet | Reverse Sheet done in both builds: the selected sheets face the other way (one undo step, face and edge refs kept; solids are refused). Faces now draw on both sides, so a sheet shows from behind and the Face direction shader shows its back in red. Isoparam, Match Face, Raise Degree and Rebuild Face missing |
| Trim and Unwrap | Untrim, Unwrap Face | Missing |
| Display and Analysis | Find Boundary Edges, Toggle Surface Curvature | Find Boundary Edges done in both builds: the edges that bound only one face (a sheet's open sides) on the selected bodies, or every shown body, become the selection, and it says how many; seams and closed solids give none. Toggle Surface Curvature missing |
| Hole (Witness 3D extra) | | Done |

## 5. Interface, display and files

| Area | Manual pages (REA assets) | Status |
|---|---|---|
| Navigation | View Cube, Camera Settings, Operating the Viewport | Done (axis gizmo, zoom, pan, ortho, frame, home) |
| Selection | Selection Mode, Selecting Objects, Group Objects, Toggle Object States, Focus and Isolate | Done in both builds: modes; Hide H, Hide Unselected Shift+H, Unhide All Alt+H, Invert Hidden Ctrl+H; Isolate . in layers (. with nothing selected steps out one, Alt+. all; "N ISOLATED" button at the top unisolates; bodies made while isolated stay shown); Group Ctrl+G as nesting outliner folders (click selects everything inside, eye and padlock act on all, double-click renames, empty groups dimmed), Ungroup Alt+G; Lock Selected / Unlock All from F, and a padlock per outliner row (locked bodies show but can't be picked, box-selected or selected with A). Groups, hidden and locked bodies are saved in the .w3d file (isolation is a view and isn't); Disable state and active collection missing |
| Menus | P-Menu, Radial Menu, Command Palette, Command Bar | Palette and bar done; toolbar grouped in tool families with variant strips. P-Menu done under the app's name (Recent Files, New, Open, Import Ctrl+Shift+O, Save, Save As Ctrl+Shift+S, Export Ctrl+Shift+E, Quick Save Version, version, Quit Ctrl+Q; file entries desktop only). Radial menus done in both builds: Selection Mode and Viewport Settings, no default key as in Plasticity; click an item or hold the menu's key, point and let go; .json radial files in Plasticity's shape (with this app's command names) dropped on the viewport add menus, view:radial:<id> nests. Right-click a palette entry to set its key (kept per browser or app). New Window, Save As Startup Scene, Preferences and the Share entries missing |
| Shader modes | Shader Mode, Render Mode, Curvature (REA: matcap, silhouette, isophotes, zebra stripes, reflection check, topographic, draft, face direction) | All 14 of the manual's shader modes done in both builds (VIEW › SHADER), drawn in the face shader from the normal rather than from matcap images: ceramic dark, metal carpaint, dark shiny, gradient, ceramic lightbulb, color matcap, black and color silhouette, isophote, draft angle, horizontal and vertical zebra, topography, face direction; the colour modes show material colours; Material Options for stripe count, draft threshold and topography spacing. Viewport toggles for edges, faces and curves. Custom matcap files and ambient occlusion missing |
| Materials and lighting | Assets (REA: 22 PBR materials, 14 HDR environments) | Render mode done in both builds (VIEW › RENDER): physical materials lit by four environments made in the viewport (studio, three point, vertical stripes, sky) with rotation and intensity; transparent materials show at half strength outside it, as in Plasticity. HDR files, the material library and custom environments missing (use CC0 assets, not Plasticity's) |
| Grid, units, snap, construction plane | | Done |
| Import / export | STEP in/out done; OBJ export (REA: angle tolerance, inflection, max width), SVG export, hidden-line export, reference images | STEP, OBJ/STL and SVG/DXF hidden-line drawings done; reference images missing |
| Integrations | Blender bridge done; Cinema 4D bridge missing | Partial |

## 6. Exchange and distribution (from the 26.1.4 MSI)

Plasticity imports five CAD formats and exports four through HOOPS Exchange; Witness 3D maps each to
OpenCascade where an open path exists. "Desktop" means OCCT on the Rust side; "browser" means
opencascade.js (which lacks IGES).

| Format | Plasticity 26.1.4 | Witness 3D plan | Status |
|---|---|---|---|
| STEP | import, export | `STEPControl` in both builds | Done |
| IGES | import, export | `IGESControl` (TKDEIGES) on the desktop, through the STEP dialogs by extension | Done on the desktop |
| ACIS SAT | import, export | No open implementation | Not planned |
| Parasolid X_T | import, export | No open implementation | Not planned |
| DWG / DXF | DWG import (ODA) | DXF read and write in-house; DWG needs the ODA SDK | DXF drawing export done (R12, layers VISIBLE/HIDDEN/CURVES); DXF import done in both builds (File › Import): lines, polylines with bulges (as lines and arcs), circles, arcs, ellipses, splines (exact NURBS) become curves on the XY plane in mm by $INSUNITS; elliptical arcs come in as splines; blocks, text, hatches and dimensions are left out and counted |
| OBJ | export (manual: Export OBJ; options angle tolerance, inflection, max width) | Re-meshed at the chosen tolerance in each build; max width splits long edges; written by `web/src/meshExport.js` | Done (the desktop mesher takes no separate angle; inflection not yet) |
| SVG, hidden line | export (manual) | `HLRBRep` hidden-line removal seen from the camera, written by `web/src/drawingExport.js` in both builds | Done (Export drawing: hidden lines dashed, H leaves them out; drawn curves on their own layer, not occluded) |
| STL, glTF, 3MF | not listed | Binary STL done with OBJ; glTF and 3MF later | STL done |

| Distribution | Plasticity 26.1.4 | Witness 3D plan | Status |
|---|---|---|---|
| Installers | per-user Squirrel `Setup.exe` with auto-update; machine-wide WiX MSI wrapping it | Tauri bundler: NSIS per-user and WiX MSI per-machine (tauri.conf.json `bundle.windows`), .deb/.rpm/AppImage on Linux, .dmg on macOS. No auto-update yet (needs the updater plugin and a signing key) | Partial |
| File association | registered by the app at run time | `.w3d` through the bundler's `fileAssociations`, so it's there from install. A double-clicked model opens on start (argument on Windows/Linux, open event on macOS) | Done |
| Explorer thumbnails | `thumbnail_provider.dll` COM handler, registered with regsvr32 | A small thumbnail handler that reads the preview PNG a `.w3d` file stores | Missing |
| Graphics fallback | ANGLE, then SwiftShader | WebView2 brings its own GPU fallback; the browser build needs WebGL2 | Covered by the platform |

## 7. Licensed-kernel equivalents (kernel strategy, adopted 2026-10-13)

Plasticity 26.1.4 gets its hardest features from commercial SDKs (Parasolid, xNURBS, PolySplines,
HOOPS Exchange, ODA; see the teardown). Witness 3D builds open equivalents on OpenCascade behind the
`Kernel` trait, so a licensed kernel can slot in later. The reasoning, access routes and difficulty
are in [kernel-strategy.md](kernel-strategy.md); the feature-by-feature table is in
[licensed-features-status.md](licensed-features-status.md).

Order of work:

1. Imprint, Cut and Project, which also gives **K knife mode** on every drawing tool
2. Patch fill (xNURBS-style Boundary and Quad-sided) and Bridge Surface
3. Thicken, Draft Face, Pipe, Loft and Sweep guide curves
4. Zebra and curvature display
5. DXF and Rhino `.3dm` (openNURBS)
6. PolySplines on OpenSubdiv, Fillet Shell, Match Face, Unwrap Face

Quality bar for every feature, reported with numbers when missed:
- Steps, keys and options as in Plasticity's manual
- G0 gap under 0.01 mm and G1 within 0.5° at joins, checked with Measure Continuity and zebra
- Every operation in the three test workflows (enclosure, mirror housing, handle) succeeds on the
  benchmark models; a failure shows a message and leaves the model as it was

