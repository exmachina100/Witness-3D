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
| Measure Distance | Done (Measure distance, radius and continuity; see Inspect) |
| Section Analysis | Done in both builds (view only): the VIEW section button or the palette slices the viewport through a selected flat face, the previous section or the construction plane; D sets how far in, F flips the kept side, the cut-open inside shows in the accent colour, and the button again ends it. The model is not changed |
| Dimension | Missing |
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
| Extend | Extend, Extend Sheet (extend-sheet shape) | Extend Sheet done in both builds with Natural and Linear shapes (Tab; Natural first): one open edge of a sheet, D for the distance; works on a side of the sheet's surface (Patch and Bridge Surface sheets) or a straight edge of a flat sheet, and keeps one face. Natural carries the surface's curvature on (C2: GeomLib's extender on the desktop, the end span's polynomial blossomed on in the browser); Linear goes straight on (C1). Edges trimmed across a curved surface are refused. Soft and Reflective done in both builds on a side of a B-spline sheet, each as a face of its own sewn to the sheet's side (same poles along it): Soft leaves with the surface's tangent and curvature (G2) and eases out flat by its far end (a cubic per pole column); Reflective turns the strip of sheet `distance` deep inside the edge through it (2e − S: tangent carries on, the bend mirrors into an S) and is refused when the sheet is narrower than the distance. Tab cycles Natural, Linear, Soft, Reflective. Limit done in both builds as Plasticity's Minimal: Ctrl-click another body and the sheet carries on (Linear, Natural or Soft) until it first meets it, the distance set aside; the sheet is extended past the body, split by it, and the pieces reached from the edge without crossing it kept (it stops at a wall across its path, or at the near side of a round post; Reflective, and a body the edge never meets, are refused with a reason). In the browser Soft and Reflective on a flat sheet carry it straight on, as one face. Limit's Outside done in both builds (the panel's MINIMAL / OUTSIDE, shown once a body is picked): the sheet goes on into a solid body and stops where it comes out of the far side (through the round post to x = 38, area 380 mm²); a sheet body has no inside, so Outside stops at it as Minimal does. A sheet whose edge already lies inside the body keeps all of its own pieces and stops where the extension comes out (fixed for Minimal too). Inside and Modify missing: the manual's lines for them don't say what they change over Minimal and the single sewn sheet the extension already makes |
| Fillet | Fillet, Fillet Shell (shell shape, Y-blend) | Fillet and chamfer done; variable radius done (V adds points along a rounded edge, each with its own dot, both builds). Shape done: Chordal in both builds (the distance is the width across the round; edges at different angles keep their own radius); Conic (Tension is rho) and G2 (zero curvature where it meets the faces; Tension is how far it reaches toward the corner) on the desktop, between the round's own spring lines and tangent to the faces there, on straight or curved edges and tangent chains. Conic and G2 refuse rounds that meet at a corner and ends that aren't square to the edge; the browser build refuses them. L limit points done in both builds: two points on the rounded edges, the round kept between the planes square to the edge there, ending flat (Plasticity's run-out shape at the limits is not documented). Full shape, Y-blend and Fillet Shell missing |
| Hollow and Thicken | Hollow, Thicken, Thicken Face | Hollow done (as Shell). Thicken done in both builds: a selected sheet body becomes a solid, D typing the front thickness (along its normals) and B the back; walls are ruled along its open edges (on the desktop, faces meeting at an angle are joined at the corner; the browser still uses the simple offset there). Thicken Face done in both builds: faces picked on a solid (Alt+click) become a solid of their own, front out of the body and back into it, the ends cut where the other faces lie and corners joined; faces of a sheet are copied out and thickened; the body stays |
| Imprint | Imprint, Imprint Body Body, Imprint Curve Body (method, complete, bidirectional, hide occluded) | Imprint Curve Body and Imprint Body Body done (both builds; curves projected along their plane normals, or where another solid meets the body, onto chosen faces or all faces); the projection options missing |
| Join and Unjoin | Join, Join Sheets, Unjoin, Unjoin Faces, Unjoin Shells | Done in both builds: J joins selected sheets that meet edge to edge (within 0.01 mm) into one body, a solid when they close; Unjoin Faces makes each face of a body its own sheet and Unjoin Shells splits a body into its separate pieces (F search or Shift+F) |
| Offset | Offset Edge, Offset Face (face-change grow, transform-face step), Offset Face Loop | Offset Face done (+ angle) with its Tab grow modes in both builds: an inner flat face pushed out past the body's outer wall takes the wall along (Moving), stops at it (Fixed) or carries on past it (None). Offset Edge done (O with edges picked): the edges, joined where they meet, move the distance across a flat face they border and carry on straight to its sides, splitting it there (Imprint); a negative distance goes onto the other flat face; V cycles the gap fill. Offset Face Loop done (O with one face picked): the flat face's outline moves in and its holes out, imprinted as a new inner face. Lines and arcs stay exact. S offsets onto both flat faces of straight edges at once (each side's line is swept along the other face, so neither split strays onto the other face). Curved faces and chains over several faces done in both builds: when no one flat face holds the picked edges (or − or S reaches a curved face), the offset is where a tube of the distance round the edges meets the faces on one side, so it stays that far from the edges in space and its corners are round (no V gap fill there); − flips the side, S does both; edges whose faces don't split into two sides are refused. Offset Face Loop is still flat faces only, and its Individual (I) is missing. Dependent offset done in both builds: while offsetting, Alt-click another face and the distance becomes the run from the offset face's centre, along its normal, to that face (exact for a parallel face; another face is met at the centre, not tilted to match). Step is not in the manual's Offset Face page; skipped |
| Rebuild and Refine | Isoparam, Match Face (side option), Raise (Surface) Degree, Rebuild Face, Reverse Sheet | Reverse Sheet done in both builds: the selected sheets face the other way (one undo step, face and edge refs kept; solids are refused). Faces now draw on both sides, so a sheet shows from behind and the Face direction shader shows its back in red. Isoparam done in both builds: hover a face to see its u or v curve through the pointer, cut to the face (the piece under the pointer where holes split it); each click keeps one as a curve, Tab (or U, V) switches direction. Rebuild Face done in both builds (Rebuild with faces selected): each face gets a new polynomial B-spline surface fitted to the old one, keeping its edges and trims and its face and edge numbers. Tolerance (M toggles) fits degree 3 with as few uniform spans as keep the face within it; Explicit sets the U and V degree and spans; Extend U/V (mm) carries the surface on past the face; Shrink (H, on by default) fits the face's own extent rather than its whole surface. The panel shows the control points and the largest deviation. Checked on a bridge sheet, a cylinder wall across its seam, a sphere through its poles, a fillet round and a face with a hole (volumes within 0.5 mm³ or better). The browser build remakes the face and sews it back, so its face numbers can change, and it refuses a trimmed face with a seam. Raise Surface Degree done in both builds (Shift+S, or Raise Degree with faces or solids selected; curves still raise their own degree): each face's U and V degree goes up by one, exactly for a B-spline face; a plane, cylinder or other analytic face is first fitted as a degree 3 B-spline within 1e-3 mm. The desktop keeps face and edge numbers. Match Face done in both builds (palette or Suggested Commands on faces): select faces of a solid, run it, click the face whose surface they should take (Shift-click adds faces). The target's surface is carried on past its edges, so a small sheet still reaches across; the body grows out to it or is cut back to it, inside the faces' columns. Checked on a box top grown to a sheet above, cut back to one inside from either side, and matched to an S-bend sheet (volume within 0.5 mm³ of 1250). Grow done in both builds (Tab, or the panel): an inner flat face matched to a surface beyond the body's outer wall takes the wall's faces along (Moving, the default), stops at the wall (Fixed) or carries on past it by itself (None); checked on a pocket floor matched past the block's top (volumes 5200, 4000, 4300 mm³) and short of it (all 3800). Side (Front) is missing, as the manual doesn't say what it does when off; a surface running along the face is refused |
| Trim and Unwrap | Untrim, Unwrap Face | Untrim done in both builds (Alt+T, or Suggested Commands on faces): each selected face's whole underlying surface becomes a new sheet, out past its trims and holes, and the body stays. A plane, or the open direction of a cylinder or cone, has no end of its own, so it goes out to the face's extent. Keep edges (Tab) imprints the face's edges on the sheet. Checked on a block's top with a round dimple (the sheet is the full 100 × 100 square, two faces with Keep edges) and the dimple itself (the whole ball, area within 0.5%). Unwrap Face done in both builds (command search, or Suggested Commands on faces): each selected face is laid flat on the ground (XY) as a new sheet, outward side up and centred under where the face was; the body stays. Flat faces just turn, holes and arcs kept exact. Cylinders and cones unroll exactly, so lengths are kept (a 5 mm round on a 30 mm edge unrolls to 7.854 × 30 mm). Other faces are flattened conformally (least-squares conformal map on a 33 × 33 grid, scaled to keep the area), so their edges stretch where the face curves both ways: half a 20 mm ball keeps its area to within 1% and comes out up to 1.25 times longer one way than the other, because it is cut open along its seam. A round lies along its edge as seen from above. Plasticity's own flattening method and where it places the piece are not documented, so those may differ |
| Display and Analysis | Find Boundary Edges, Toggle Surface Curvature | Find Boundary Edges done in both builds: the edges that bound only one face (a sheet's open sides) on the selected bodies, or every shown body, become the selection, and it says how many; seams and closed solids give none. Toggle Surface Curvature done in both builds (palette, or Suggested Commands on edges): the selected edges of bodies get curvature combs, each tooth standing away from the bend and as long as the curvature (1 / radius), joined by an envelope; straight stretches have none. Running it again on the same edges, or with nothing selected, takes them off. A Comb Scale slider in the View panel sizes these combs and the curve combs, and the message gives the tightest radius. The combs follow their edges through later changes to the body. Checked on the 20 mm rim of a dimple (every tooth 0.05, pointing out) and a straight edge (none). Combs along isoparams and an Outliner Measurements entry are missing |
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
6. PolySplines on OpenSubdiv, Fillet Shell, Match Face

Quality bar for every feature, reported with numbers when missed:
- Steps, keys and options as in Plasticity's manual
- G0 gap under 0.01 mm and G1 within 0.5° at joins, checked with Measure Continuity and zebra
- Every operation in the three test workflows (enclosure, mirror housing, handle) succeeds on the
  benchmark models; a failure shows a message and leaves the model as it was

The three workflows run end to end in `crates/w3d-kernel/tests/workflows.rs` (desktop kernel,
through the Document as the app drives it; `cargo test -p w3d-kernel --test workflows -- --nocapture`
prints each step):
- Enclosure: box 80 × 30 × 50, corners r8, top r3, shell 2 mm open at the bottom, cable port r4,
  four bosses r3.5 drilled r1.25; 12 steps, all valid, volumes within 5 mm³ of hand-computed
  values, saves and reopens unchanged, undoes back to the box. A top round of r40 is refused.
- Mirror housing: loft of three oval splines, shell 2.5 mm open at the door, cap edge r1.5, mirrored
  pair. Shell on the loft used to hand the body back untouched (OCCT's sharp join gives up on it);
  it now falls back to the rounded join in both builds. A 40 mm shell is refused.
- Handle: r6 bar swept along an arch, joined to a base plate, seams r2, plate rim r2. A r30 seam
  round is refused.
The browser build runs the same three in `web/test/workflows.test.js` through LocalBackend. Its
volumes now use Gauss–Kronrod integration: the plain Gauss rule read the shelled loft as 44 225 mm³
against 40 054 mm³ (desktop 40 053, mesh 40 042) and made a 1.5 mm cap round look like it added
material.
G1 at the joins (desktop): after every rounding step each edge's two faces are compared at 17
points along it (`Kernel::edge_angles`). Every join must be tangent (within 0.5°) or a real crease
(over 5°), with nothing in between, and the expected number must be tangent. Results: enclosure
64 tangent joins, worst 0.0000°; mirror housing cap 2, worst 0.0002°; handle 12, worst 0.0004°.
Not covered yet: the same G1 check in the browser build.

