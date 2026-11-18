# Witness 3D — Roadmap & Kernel Strategy Status

_Last updated: 2026-11-18_

## What's Already Implemented (Done/Partial)

| Area | Status | Evidence |
|------|--------|----------|
| **Core Kernel Trait** | ✅ Complete | `crates/w3d-kernel/src/lib.rs` — full `Kernel` trait with ~100 methods |
| **OpenCascade Backend** | ✅ Complete | `crates/w3d-kernel/src/occt.rs` — implements all kernel methods |
| **Sketching & Primitives** | ✅ Done | Lines, splines, circles, rectangles, boxes, cylinders, spheres |
| **Boolean & Cut** | ✅ Done | Union, Difference, Intersection, Region mode, Material modes |
| **Move/Rotate/Scale** | ✅ Done | Full gizmo, axis constraints, freestyle, pivot, scale along axis |
| **Mirror, Duplicate, Arrays** | ✅ Done | Instances support, radial/rectangular/curve arrays |
| **Fillet/Chamfer** | ✅ Done | Variable radius, Conic/G2 shapes, Full rounds, Copy radius |
| **Extrude** | ✅ Done | Freestyle, Pivot, Individual, angle, thickness, target bodies |
| **Revolve, Loft, Sweep, Pipe** | ✅ Done | Guides, twist, scale, alignment, corner types |
| **Bridge Surface, Patch** | ✅ Done | Tension, trim, guide curves, xNURBS-style options |
| **Shell, Thicken** | ✅ Done | Local/Full, Thicken Face |
| **Offset Face/Edge/Loop** | ✅ Done | Grow modes, dependent offset |
| **Move Face/Edge, Draft Face** | ✅ Done | Grow modes, taper methods |
| **Extend Sheet** | ✅ Done | Natural, Linear, Soft, Reflective, Limit to body |
| **Match Face, Align Surface** | ✅ Done | G0/G1/G2, symmetric, analysis |
| **Deform, Slide Surface CV** | ✅ Done | Reblend, proportional, mirror |
| **Isoparam, Rebuild Face, Raise Degree** | ✅ Done | Subdivide, untrim |
| **Remove Face/Fillets, Delete Redundant** | ✅ Done | BodyShop-style defeaturing |
| **Unwrap Face** | ✅ Done | Exact for cylinders/cones, conformal for others |
| **Project, Imprint** | ✅ Done | Curve/Body, options (bidirectional, hide occluded) |
| **Selection, Outliner, Groups** | ✅ Done | Full UI parity |
| **Materials, Render, Shaders** | ✅ Done | 14 shader modes, PBR, HDRI, custom matcaps |
| **STEP/IGES Import/Export** | ✅ Done | Desktop IGES, both STEP |
| **DXF Import/Export** | ✅ Done | Full round-trip |
| **OBJ/STL/glTF/3MF Export** | ✅ Done | Mesh export with options |
| **SVG Hidden-line Export** | ✅ Done | |
| **Blender & Cinema 4D Bridges** | ✅ Partial | Live Link, materials preserved |
| **File Format (.w3d)** | ✅ Done | BREP text, undo/redo, thumbnails |

---

## What's Remaining (Priority Order from Roadmap)

### **Weeks-scale (Next Priority)**

#### **1. Imprint / Cut / Project — Unlocks K knife mode**
- **Status**: Kernel methods done (`imprint_projected`, `project`, `cut`); tests in `imprint_options.rs`, `project.rs`
- **Missing**: K knife mode on every drawing tool (imprints drawn curves on faces)
- **Files to modify**: Web drawing tools, desktop command palette

#### **2. xNURBS-style Patch Fill & Bridge Surface**
- **Status**: `patch_guided` implemented with Quad-sided & Boundary modes; `bridge_surface` done
- **Missing**: Quality analysis (G0/G1/G2 check), 5+ sided holes → center-point split
- **Files to modify**: Patch command UI, analysis panel

#### **3. Thicken, Draft Face, Pipe, Loft/Sweep Guides**
- **Status**: All implemented in kernel (`thicken`, `thicken_faces`, `draft_faces`, `sweep_guided`, `loft_sheet_guided`)
- **Missing**: UI polish, test coverage for edge cases

#### **4. Zebra & Curvature Display**
- **Status**: `edge_curvature` implemented in kernel; `Toggle Surface Curvature` done in web
- **Missing**: Zebra stripes, isophotes, reflection check shaders in Three.js
- **Files to modify**: `web/src/shaders/`, shader material system

#### **5. DXF & Rhino .3dm (openNURBS)**
- **Status**: DXF import/export done; .3dm feature-gated in kernel (`write_3dm`/`read_3dm`)
- **Missing**: Enable `rhino` feature, test round-trip
- **Files to modify**: `Cargo.toml` features, import/export dialogs

---

### **Months-scale (Later)**

#### **6. PolySplines on OpenSubdiv**
- **Status**: `SubdCage`, `SubdivOptions`, `subdivide_cage`, `cage_to_solid` implemented behind `opensubdiv` feature
- **Missing**: Extraordinary vertex handling (GregoryBasis patches), UI for SubD cage editing

#### **7. Variable-radius Fillet & Fillet Shell**
- **Status**: Variable fillet done; `fillet_shell` implemented with Y-blend fallback
- **Missing**: Y-blend corner patches where 3+ fillets meet

#### **8. Match Face G1/G2, Unwrap Face**
- **Status**: `match_faces` and `unwrap_face` implemented in kernel
- **Missing**: Solver options ("constrained" vs "xnurbs"), skew parameter

---

## What's Explicitly Not Planned

| Feature | Reason |
|---------|--------|
| SAT / Parasolid X_T | Proprietary formats, no open implementation |
| DWG | Needs ODA SDK (commercial) or LibreDWG (GPL conflict) |
| xNURBS-quality fills | Research-scale; OCCT `GeomPlate` is "good enough" |
| Parasolid-level robustness | 30+ years of edge-case work; close gap one bug at a time |

---

## Quality Bar (from `workflows.rs`)

Every feature must pass three benchmark workflows:
1. **Enclosure** — box with rounds, shell, cable port, bosses
2. **Mirror Housing** — lofted sections, shelled, mirrored pair  
3. **Handle** — swept bar, joined to plate, seam rounds

**G1 Check**: All joins must be tangent (≤0.5°) or deliberate crease (>5°), never "almost tangent"

---

## Current Kernel Implementation Coverage

The `Occt` backend implements **~95% of the `Kernel` trait**. The remaining `Err(KernelError::Invalid(...))` stubs are mostly for:
- PolySplines (extraordinary vertices)
- SAT/X_T/DWG exchange
- Some advanced healing (BodyShop parity)