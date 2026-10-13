# Plasticity parity: what's built, what's left

Updated 2026-10-13, at `main` 533ab5b plus the `round6-solids-patterns` branch. Sources: the
open-source Plasticity 0.6.30 command list (nkallen/plasticity `src/commands/`), the 26.1 command
options listed in [plasticity-26-teardown.md](plasticity-26-teardown.md), and the teardown's own
"Next for Witness 3D" list. Both builds (browser and desktop) count; a tool is **Done** when it has a
command, preview, one-step undo and tests.

Plasticity first; Blender-style extras only where Plasticity has no equivalent.

## Done

| Area | Tools |
|---|---|
| Curves | Line, Corner / Center / Three Point Rectangle, Center / Two Point / Three Point Circle, Three Point / Center Point / Tangent Arc, Regular Polygon, Spline Curve, Center / Three Point Ellipse, Spiral, Join Curves, **Offset Curve, Fillet Curve, Trim, Extend, Bridge, Explode** |
| Solids | Push/Pull, Extrude (angle, thickness, both sides, slice, forced booleans), Boolean (union, difference, intersect, slice, keep tools), Fillet and Chamfer (angle), Offset Face (+ angle), Revolve, Loft, Sweep (twist, scale), Box, Cylinder, Sphere, Shell, **Hole (depth or through), Remove Face (desktop only)** |
| Organise | Move, Rotate, Scale, Duplicate, Delete, Mirror (copy or join), Rectangular Array, Radial Array, Hide / Hide others / Unhide |
| Selection | Point / edge / face / solid / all modes, box select, convert selection, invert, select all |
| Views | Navigation gizmo (axis balls, orbit, zoom, pan, ortho, frame, home), numpad views, x-ray, construction planes (world, from face, from view) |
| Files | Native `.w3d` save and open, STEP import (with repair) and export |
| Extras | AI command box (Ctrl+K), Blender bridge, command palette (F), suggestions (Shift+F), repeat (Shift+R) |

## Left, in suggested order

**Round 7 remainder: curve editing.** Offset, Fillet, Trim, Extend, Bridge and Explode are done
(web/src/curveEdit.js, shared by both builds). Still to do:
- Trim of splines, ellipses and joined contours (lines, polylines, circles and arcs trim today)
- Fillet Curve on chosen corners from the viewport (the geometry takes corner numbers already)
- Split curve at a point; Duplicate curve
- Control-point editing of splines (move / add / remove points)

**Round 8: face and body editing.**
- Remove Face in the browser build (desktop is done; opencascade.js lacks `BRepAlgoAPI_Defeaturing`)
- Draft Face (`BRepOffsetAPI_DraftAngle`)
- Cut / Split body by a curve or a face; Split face by a curve
- Imprint and Project curve onto faces (26.1 options: bidirectional, hide occluded)
- Place (drop a solid onto a face) and Align
- Move / rotate faces, edges and vertices directly (26.1 "transform-face step")
- Slot; counterbored and countersunk holes (plain holes are done)

**Round 9: sheets and surfaces.**
- Open sheets as first-class bodies: thicken, sew, extend sheet (26.1: extend sheet shapes)
- Patch from a closed loop of edges or curves (`BRepOffsetAPI_MakeFilling`; xNURBS's role in 26.1)
- Bridge surface (26.1: tension, trim), match face side
- Curve network / loft with guide curves
- Variable-radius fillet; fillet shell shape and Y-blend (26.1)

**Round 10: look, output and organisation.**
- Materials and environments: matcaps, then PBR with HDRI (Three.js; CC0 textures, not Plasticity's)
- Mesh export: STL, OBJ, 3MF with tolerance, angle and max-edge settings (26.1 export-mesh options; meshoptimizer)
- IGES import and export (`IGESControl`)
- Groups, layers and naming in the outliner; isolate
- Reference images and image planes; DXF/SVG curve import
- Text to curves (Three.js typeface fonts, as Plasticity 26.x)
- Measure (distance, angle, radius) and section view

**Not planned without a decision:** Parasolid/SAT/X_T and DWG (commercial SDKs), native
`.plasticity` files, a full editable feature history (undo snapshots only today).

## Blender-style extras worth adding (after parity)

- Section box / clipping planes, walk/fly navigation, a pie menu for selection modes
- Modifier-like non-destructive arrays and mirrors (would need the history work above)
