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
| Move · Rotate · Scale | Done |
| Mirror | Done (copy or join) |
| Duplicate | Done |
| Radial Array · Rectangular Array | Done |
| Curve Array (along a curve) | Missing |
| Copy / Paste with Placement · Place | Missing |
| Set / Fork / Remove Material | Missing |
| Measure Distance · Dimension · Section Analysis | Missing |
| Complete Edge · Subdivide | Missing |
| Publish to Plasticity Share | Not planned (Plasticity's own service) |

## 3. Sketch commands

| Group | Commands | Status |
|---|---|---|
| Bridge and Connect | Bridge, Bridge Curve, Bridge Edge, Bridge Vertex | Bridge Curve done; others missing |
| Cut and Trim | Cut Curve, Trim, Split Segment | Trim partial; others missing |
| Deform and Slide | Deform, Deform Curve, Slide, Slide Curve CV | Missing |
| Align | Align, Align Vertex | Missing |
| Extend | Extend, Extend Curve (26.1: extend-curve shape option) | Extend Curve done (lines, arcs); shape option missing |
| Fillet | Fillet, Fillet Curve, Fillet Vertex | Fillet Curve done (all corners); per-vertex missing |
| Join and Unjoin | Join, Join Curves, Unjoin, Unjoin Curve | Join Curves done; Explode stands in for Unjoin Curve |
| Offset | Offset Curve (26.1: Round / Linear / Natural), Offset Planar Curve, Offset Region, Offset Vertex | Offset Curve done with sharp corners; Round/Natural corner styles and the rest missing |
| Slot | | Missing |
| Project | Project, Project Body Body, Project Curve Body, Project Curve Curve, Project Outline (26.1: method, bidirectional, hide occluded) | Project (I) done in both builds: Curve Body (Normal or Vector X/Y/Z, S screen space, Bidirectional, Hide Occluded, chosen faces or all), Body Body and Curve Curve, picked by the selection; results are new NURBS curves, flat ones usable as regions. Hide Occluded is exact on the desktop and casts rays on the mesh in the browser. Project Outline done in both builds: one body selected and no curves draws its outline seen along the construction plane's normal onto that plane (hidden-line removal, then the shadow region's boundary), holes through the body included |
| Duplication | Alternative Duplicate, Duplicate Curve and Project, Create Outline | Missing |
| Rebuild and Refine | Convert Vertex, Delete Redundant Topology, Insert Knot, Raise (Curve) Degree, Rebuild (Curve), Reverse (Curve) | Missing |
| Instances | Create / Realize (Curve) Instance | Missing |
| Text | Text (Plasticity ships 21 typeface fonts) | Missing |
| Display and Analysis | Toggle Curve Curvature, Toggle Points | Missing |

## 4. Solid commands

| Group | Commands (26.1 options from REA) | Status |
|---|---|---|
| Boolean and Cut | Boolean, Cut | Boolean done; Cut by curves, faces (flat ones as their plane, round ones as their cylinder) and the construction plane done (both builds); Cut by free-form surface extension missing |
| Create and Duplicate | Alternative Duplicate, instances | Missing |
| Surface Creation | Extrude (Individual option), Revolve, Loft, Sweep (alignment, scale, twist), Pipe, Bridge Surface (tension, trim), Constrained Surface, Patch, PolySplines, Square, Xnurbs (boundary, quad-sided) | Extrude, Revolve, Loft, Sweep (scale, twist) done. Patch done in both builds: a sheet in one closed loop of curves and body edges, the exact plane when the loop is flat, otherwise a GeomPlate fill within 0.01 mm of the loop; T leaves body edges tangent to their faces within 0.5°, and walls standing square to the loop are refused with the reason. Sheets list under SHEETS. Bridge Surface done in both builds: two edges of sheets or solids joined by a sheet tangent to both faces (G1), with tension; open edges pair end to end, closed ones go round together; on a solid's edge it leaves the first face found. Its trim option, Xnurbs' quad-sided option, per-edge G2, Individual, sweep alignment, Pipe, Constrained Surface, PolySplines and Square missing |
| Deform and Slide | Deform, Deform Solid and Sheet, Slide, Slide Surface CV | Missing |
| Delete and Remove | Delete Face, Delete Redundant Topology, Remove Fillets from Shell, Remove Nominal Surface | Delete Face done on desktop (Remove Face); rest missing |
| Draft and Align | Align, Align Surface, Draft Face (draft illustration) | Offset Face's angle covers part of Draft Face; rest missing |
| Extend | Extend, Extend Sheet (extend-sheet shape) | Extend Sheet done in both builds (linear): one open edge of a sheet, D for the distance; works on a side of the sheet's surface (Patch and Bridge Surface sheets) or a straight edge of a flat sheet, and keeps one face. Edges trimmed across a curved surface are refused. Natural shape missing |
| Fillet | Fillet, Fillet Shell (shell shape, Y-blend) | Fillet and chamfer done; variable radius and Fillet Shell missing |
| Hollow and Thicken | Hollow, Thicken, Thicken Face | Hollow done (as Shell). Thicken done in both builds: a selected sheet body becomes a solid, D typing the front thickness (along its normals) and B the back; walls are ruled along its open edges. Thicken Face missing |
| Imprint | Imprint, Imprint Body Body, Imprint Curve Body (method, complete, bidirectional, hide occluded) | Imprint Curve Body and Imprint Body Body done (both builds; curves projected along their plane normals, or where another solid meets the body, onto chosen faces or all faces); the projection options missing |
| Join and Unjoin | Join, Join Sheets, Unjoin, Unjoin Faces, Unjoin Shells | Done in both builds: J joins selected sheets that meet edge to edge (within 0.01 mm) into one body, a solid when they close; Unjoin Faces makes each face of a body its own sheet and Unjoin Shells splits a body into its separate pieces (F search or Shift+F) |
| Offset | Offset Edge, Offset Face (face-change grow, transform-face step), Offset Face Loop | Offset Face done (+ angle); grow, step, edge and loop missing |
| Rebuild and Refine | Isoparam, Match Face (side option), Raise (Surface) Degree, Rebuild Face, Reverse Sheet | Missing |
| Trim and Unwrap | Untrim, Unwrap Face | Missing |
| Display and Analysis | Find Boundary Edges, Toggle Surface Curvature | Missing |
| Hole (Witness 3D extra) | | Done |

## 5. Interface, display and files

| Area | Manual pages (REA assets) | Status |
|---|---|---|
| Navigation | View Cube, Camera Settings, Operating the Viewport | Done (axis gizmo, zoom, pan, ortho, frame, home) |
| Selection | Selection Mode, Selecting Objects, Group Objects, Toggle Object States, Focus and Isolate | Modes and hide done; groups, lock, isolate missing |
| Menus | P-Menu, Radial Menu, Command Palette, Command Bar | Palette and bar done; toolbar grouped in tool families with variant strips; P-Menu and radial missing |
| Shader modes | Shader Mode, Render Mode, Curvature (REA: matcap, silhouette, isophotes, zebra stripes, reflection check, topographic, draft, face direction) | Zebra stripes and draft (against the construction plane normal, 1°) done (VIEW › ZEBRA, DRAFT); the rest missing |
| Materials and lighting | Assets (REA: 22 PBR materials, 14 HDR environments) | Missing (use CC0 assets, not Plasticity's) |
| Grid, units, snap, construction plane | | Done |
| Import / export | STEP in/out done; OBJ export (REA: angle tolerance, inflection, max width), SVG export, hidden-line export, reference images | Missing except STEP |
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
| DWG / DXF | DWG import (ODA) | DXF read and write in-house; DWG needs the ODA SDK | Missing (DXF) |
| OBJ | export (manual: Export OBJ; options angle tolerance, inflection, max width) | Re-meshed at the chosen tolerance in each build; max width splits long edges; written by `web/src/meshExport.js` | Done (the desktop mesher takes no separate angle; inflection not yet) |
| SVG, hidden line | export (manual) | Project edges and silhouettes to 2D | Missing |
| STL, glTF, 3MF | not listed | Binary STL done with OBJ; glTF and 3MF later | STL done |

| Distribution | Plasticity 26.1.4 | Witness 3D plan | Status |
|---|---|---|---|
| Installers | per-user Squirrel `Setup.exe` with auto-update; machine-wide WiX MSI wrapping it | Tauri bundler: NSIS per-user and WiX MSI per-machine; Tauri updater plugin | Missing |
| File association | registered by the app at run time | `.w3d` through the bundler's `fileAssociations`, so it's there from install | Missing |
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
6. PolySplines on OpenSubdiv, variable-radius fillet and Fillet Shell, Match Face, Unwrap Face

Quality bar for every feature, reported with numbers when missed:
- Steps, keys and options as in Plasticity's manual
- G0 gap under 0.01 mm and G1 within 0.5° at joins, checked with Measure Continuity and zebra
- Every operation in the three test workflows (enclosure, mirror housing, handle) succeeds on the
  benchmark models; a failure shows a message and leaves the model as it was

Also still open from earlier rounds: Extrude I/F/V, Offset Face Tab, and Spline Tab.
