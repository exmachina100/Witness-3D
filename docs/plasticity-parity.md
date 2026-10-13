# Plasticity parity roadmap

Rebuilt 2026-10-13 from two sources, so nothing is left out by memory:

1. **The official manual** (doc.plasticity.xyz, v26.1): its navigation lists every command, and each
   tool page gives its click steps and option keys. The tables below follow the manual's sections.
2. **The REA package listing** of Plasticity 26.1.4 (`Plasticity-26.1.4-full.nupkg`, sha256
   `f5b34e8b…`): file names only, as in [plasticity-26-teardown.md](plasticity-26-teardown.md). Its
   `renderer/img/` holds one illustration per command option; those names are the "26.1 options"
   column. Nothing was decompiled; the JavaScript ships as V8 bytecode and stays unread.

Status: **Done** (command, options, preview, one undo step, tests, both builds) · **Partial** (what's
missing is listed) · **Missing**. "Desktop only" means the browser's opencascade.js build lacks the
algorithm. Order of work follows the manual: sketching and primitives first, then common, sketch
and solid commands, then display and files.

Every creation tool shares the manual's Sketching Essentials keys: **Tab** typed dimensions,
**X/Y/Z** axis constraint, **K** knife mode (cut faces with the drawn curve), Ctrl to snap while
moving, Shift for snap reference lines. Knife mode is missing everywhere for now (it needs face
splitting; see Solid › Imprint).

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
| Measure Continuity · Toggle Curvature | | Missing |

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
| Project | Project, Project Body Body, Project Curve Body, Project Curve Curve, Project Outline (26.1: method, bidirectional, hide occluded) | Missing |
| Duplication | Alternative Duplicate, Duplicate Curve and Project, Create Outline | Missing |
| Rebuild and Refine | Convert Vertex, Delete Redundant Topology, Insert Knot, Raise (Curve) Degree, Rebuild (Curve), Reverse (Curve) | Missing |
| Instances | Create / Realize (Curve) Instance | Missing |
| Text | Text (Plasticity ships 21 typeface fonts) | Missing |
| Display and Analysis | Toggle Curve Curvature, Toggle Points | Missing |

## 4. Solid commands

| Group | Commands (26.1 options from REA) | Status |
|---|---|---|
| Boolean and Cut | Boolean, Cut | Boolean done; Cut (by curve/surface) missing |
| Create and Duplicate | Alternative Duplicate, instances | Missing |
| Surface Creation | Extrude (Individual option), Revolve, Loft, Sweep (alignment, scale, twist), Pipe, Bridge Surface (tension, trim), Constrained Surface, Patch, PolySplines, Square, Xnurbs (boundary, quad-sided) | Extrude, Revolve, Loft, Sweep (scale, twist) done; Individual, sweep alignment, Pipe and all surface creation missing |
| Deform and Slide | Deform, Deform Solid and Sheet, Slide, Slide Surface CV | Missing |
| Delete and Remove | Delete Face, Delete Redundant Topology, Remove Fillets from Shell, Remove Nominal Surface | Delete Face done on desktop (Remove Face); rest missing |
| Draft and Align | Align, Align Surface, Draft Face (draft illustration) | Offset Face's angle covers part of Draft Face; rest missing |
| Extend | Extend, Extend Sheet (extend-sheet shape) | Missing |
| Fillet | Fillet, Fillet Shell (shell shape, Y-blend) | Fillet and chamfer done; variable radius and Fillet Shell missing |
| Hollow and Thicken | Hollow, Thicken, Thicken Face | Hollow done (as Shell); Thicken missing |
| Imprint | Imprint, Imprint Body Body, Imprint Curve Body (method, complete, bidirectional, hide occluded) | Missing |
| Join and Unjoin | Join, Join Sheets, Unjoin, Unjoin Faces, Unjoin Shells | Missing |
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
| Menus | P-Menu, Radial Menu, Command Palette, Command Bar | Palette and bar done; P-Menu and radial missing |
| Shader modes | Shader Mode, Render Mode, Curvature (REA: matcap, silhouette, isophotes, zebra stripes, reflection check, topographic, draft, face direction) | Missing |
| Materials and lighting | Assets (REA: 22 PBR materials, 14 HDR environments) | Missing (use CC0 assets, not Plasticity's) |
| Grid, units, snap, construction plane | | Done |
| Import / export | STEP in/out done; OBJ export (REA: angle tolerance, inflection, max width), SVG export, hidden-line export, reference images | Missing except STEP |
| Integrations | Blender bridge done; Cinema 4D bridge missing | Partial |
