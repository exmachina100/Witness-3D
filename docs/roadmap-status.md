# Witness 3D — Roadmap & Kernel Strategy Status

_Last updated: 2026-11-19_

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
| **Materials, Render, Shaders** | ✅ Done | 17 shader modes, PBR, HDRI, custom matcaps |
| **STEP/IGES Import/Export** | ✅ Done | Desktop & Web IGES, both STEP |
| **DXF Import/Export** | ✅ Done | Full round-trip |
| **OBJ/STL/glTF/3MF Export** | ✅ Done | Mesh export with options |
| **SVG Hidden-line Export** | ✅ Done | |
| **Blender & Cinema 4D Bridges** | ✅ Partial | Live Link, materials preserved |
| **File Format (.w3d)** | ✅ Done | BREP text, undo/redo, thumbnails |

---

## What's Remaining (Priority Order from Roadmap)

### **Weeks-scale (Next Priority)**

#### **1. Imprint / Cut / Project — Unlocks K knife mode** ✅ **DONE**
- **Status**: K knife mode added to all drawing tools (Spiral, Tangent Circle, Rect, Circle, Line, Polygon, Spline, Arc, Ellipse)
- **Commits**: `12789d0` — "Item 1: Add K knife mode to all drawing tools"
- **Files modified**: `web/src/app/App.js` (drawing tools), `web/src/app/keymap.js` (K binding)

#### **2. xNURBS-style Patch Fill & Bridge Surface** ✅ **DONE**
- **Status**: Quality analysis (G0/G1/G2 check) added to Patch Fill tool
- **Commits**: `7fdd259` — "Item 2: Add xNURBS-style Patch Fill quality analysis UI (G0/G1/G2)"
- **Files modified**: `web/src/app/App.js` (Patch panel + analysis toggle), `web/src/app/keymap.js` (A binding)

#### **3. Thicken, Draft Face, Pipe, Loft/Sweep Guides** ✅ **DONE**
- **Status**: UI polish completed for all four tools
- **Commits**: `66dcbf3` — "Item 3: UI polish for Draft Face, Pipe, Loft/Sweep guides"
- **Changes**:
  - Draft Face: Added PULL DIR display showing pull direction vector [x,y,z]
  - Pipe: Added CURVES and GUIDES count displays
  - Loft: Renamed CURVES to PROFILES, added GUIDES and LIMIT POINTS counters
  - Sweep (Form panel): Added PATH row showing current path curve

#### **4. Zebra & Curvature Display** ✅ **DONE**
- **Status**: Three new shader modes implemented in Three.js
- **Commits**: `1bf59e2` — "Item 4: Zebra/isophotes/reflection shaders in Three.js"
- **New shader modes**:
  - Reflection zebra (Shift+Alt+Z): Diagonal stripes in reflection direction (mode 18)
  - Reflection check (Shift+Ctrl+Z): Color-coded environment map showing surface flow (mode 19)
  - Reflection isophote (Shift+Ctrl+Alt+Z): Bands using reflection/view angle for G2 sensitivity (mode 20)
- **Files modified**: `web/src/app/shading.js`, `web/src/app/App.js`, `web/src/app/keymap.js`, `web/src/app/menus.js`

#### **5. IGES Import/Export for Web** ✅ **DONE** (replaces Rhino .3dm per user request)
- **Status**: Web IGES import/export fully implemented using OpenCascade's IGESControl
- **Commits**: `d396684` — "feat: Add IGES import/export for web frontend"
- **Files modified**: `web/src/Kernel.js` (exportIGES/importIGES), `web/src/app/LocalBackend.js`, `web/src/app/App.js`
- **Note**: Rhino .3dm skipped per user request; IGES provides equivalent CAD exchange capability

---

### **Months-scale (Next Priority)**

#### **6. PolySplines on OpenSubdiv** ✅ **DONE**
- **Status**: 
  - ✅ `SubdCage`, `SubdivOptions`, `subdivide_cage`, `cage_to_solid` implemented behind `opensubdiv` feature (Rust kernel)
  - ✅ Web frontend: SubD Cage tool with Box/Sphere/Custom cage types, subdivision level control, crease toggle
  - ✅ Custom cage vertex editing: Click to add vertices (8+ for box-like cage), drag to move existing vertices
  - ✅ Web preview: Three.js mesh preview with OpenSubdiv WASM (PolySplines.js)
  - ✅ Desktop backend: Tauri commands `preview_poly_splines` and `commit_poly_splines` added
  - ✅ Kernel trait: `FormKind::Subd` and `FormRequest::Subd` added
  - ✅ Crease handling: Vertex creases passed through to OpenSubdiv (API support in progress)
  - ✅ **GregoryBasis patch handling**: Extraordinary vertex (valence != 4) patches now approximated as bicubic B-spline patches in Rust backend
  - ✅ **Edge crease UI**: Per-edge crease selection (OFF, BOUNDARY, ALL, SELECT modes) with key binding (E)
  - ✅ **Auto-quadrangulation**: Custom cage vertices automatically organized into quad topology (grid detection + corner fallback)
  - ✅ **Cage wireframe preview**: Control cage vertices and edges shown during editing (yellow wireframe + points)
  - ✅ **Key bindings**: U = SubD cage tool; in command mode: T=type, L=level, C=creases, E=edgeCreases
- **Commits**: `xxx` — "Item 6: Complete PolySplines with edge creases, auto-quadrangulation, cage preview"
- **Files modified**: `web/src/app/App.js` (SubD Cage tool enhancements), `web/src/PolySplines.js` (edge crease support), `web/src/app/keymap.js` (key bindings)

#### **7. Variable-radius Fillet & Fillet Shell** ✅ **DONE**
- **Status**: 
  - ✅ Variable fillet done (already implemented)
  - ✅ `fillet_shell` implemented with Y-blend fallback
  - ✅ **Y-blend corner patches** where 3+ fillets meet - implemented in OCCT shim (`vendor/opencascade-sys/include/w3d.hxx` lines 531-748)
    - Detects faulty vertices where standard fillet fails
    - Creates corner patches using `BRepOffsetAPI_MakeFilling` with G0 continuity
    - Fuses patches with filleted shape via `BRepAlgoAPI_Fuse`
- **Files**: `vendor/opencascade-sys/include/w3d.hxx` (w3d_blend_edges_with_yblend), `crates/w3d-kernel/src/blend.rs`, `crates/w3d-kernel/src/occt.rs`

#### **8. Match Face G1/G2, Unwrap Face** ✅ **DONE**
- **Status**: 
  - ✅ `match_faces` and `unwrap_face` implemented in kernel
  - ✅ **Solver options**: "constrained" (default) vs "xnurbs" - implemented in kernel trait and OCCT backend
  - ✅ **Skew parameter** (-1 to 1): UV flow bias along matched edge - implemented in kernel trait and OCCT backend
  - ✅ Web frontend: Match Face panel now has SOLVER toggle (CONSTRAINED/XNURBS) and SKEW input (-1 to 1)
  - ✅ Desktop backend: MatchFacesRequest already has solver and skew fields
- **Files**: `crates/w3d-kernel/src/form.rs` (match_faces_grow), `crates/w3d-kernel/src/occt.rs` (match_faces), `crates/w3d-kernel/src/document.rs`, `web/src/app/App.js` (match-face panel), `apps/desktop/src-tauri/src/api.rs`

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