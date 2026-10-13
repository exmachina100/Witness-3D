# Features Plasticity gets from licensed kernels: what's left in Witness 3D

Status review, 2026-10-13. These are the features that Plasticity 26.1.4 gets from commercial SDKs (Parasolid + BodyShop, xNURBS, PolyhedralSplinesLib, HOOPS Exchange, ODA), plus the advanced surfacing tools built on them. Plasticity's SDKs are listed in `docs/plasticity-26-teardown.md`, and the status of each feature comes from `docs/plasticity-parity.md` on PR #13. For each one, the table gives the open route on OpenCascade.

I haven't checked which of these OCCT classes the browser build (replicad-opencascadejs 1.1.0) includes, because the CDN was blocked from here. "Desktop first" is an assumption until someone checks.

## Hard: we would mostly build these ourselves

| Feature (Plasticity source) | Status | OCCT route | Caveat |
|---|---|---|---|
| **xNURBS patch**: Boundary and Quad-sided fills (xNURBS) | Missing | `BRepOffsetAPI_MakeFilling` (GeomPlate) for N-sided fills; Coons / `GeomFill_ConstrainedFilling` for four-sided fills | Approximate: tangency within a tolerance, no true G2. Heavier surfaces. |
| **PolySplines**: quad mesh or SubD cage to smooth NURBS (PolyhedralSplinesLib) | Missing | None in OCCT. We'd have to write a Catmull-Clark limit-surface-to-bicubic-patch converter. | The largest of these jobs. Extraordinary vertices need special patches. |
| **Fillet Shell, Y-blend, variable radius** (Parasolid blending) | Constant-radius fillet and chamfer only | `BRepFilletAPI_MakeFillet` with radius laws for variable radius | OCCT corner blends where three or more fillets meet often fail or look poor. Y-blend quality won't match Parasolid. |
| **Match Face** with G1/G2 side options (Parasolid) | Missing | Our own code that edits B-spline poles next to the shared edge | No OCCT function does this. Accurate G2 is real numerical work. |
| **Unwrap Face**: flatten a face (Parasolid) | Missing | None in OCCT. Needs our own flattening, for example a least-squares conformal map on the mesh, then a fit. | Developable faces are exact. Doubly curved faces only approximate. |
| **Bridge Surface** with tension and trim | Missing | `GeomFill` blend or a two-section `ThruSections` with tangent constraints | Tension maps onto tangent magnitudes. The trim step is extra work. |

## Medium: OCCT has the algorithm, we need the tool around it

| Feature | Status | OCCT route | Caveat |
|---|---|---|---|
| **Imprint / Cut / Project** (curve on body, body on body) | Missing | `BRepAlgoAPI_Splitter`, `BRepFeat_SplitShape`, `BRepProj_Projection` | This also unlocks **K knife mode** on every drawing tool. |
| **Thicken / Thicken Face** | Missing (Hollow is done as Shell) | `BRepOffsetAPI_MakeThickSolid` / `MakeOffsetShape` | Offsets of tight curved surfaces can self-intersect and fail. |
| **Draft Face** | Partly covered by Offset Face's angle option | `BRepOffsetAPI_DraftAngle` | Reliable on planar and cylindrical faces. |
| **Remove Fillets, Delete Redundant Topology, healing** (BodyShop) | Remove Face is done on desktop only | `BRepAlgoAPI_Defeaturing`, `ShapeFix_*`, `ShapeUpgrade_UnifySameDomain` | Defeaturing fails more often than BodyShop on messy imports. |
| **Pipe, sweep alignment, Loft/Sweep guide curves** | Missing | `BRepOffsetAPI_MakePipe` / `MakePipeShell` with an auxiliary spine, and `ThruSections` | Close to Plasticity. |
| **Extend Sheet, Rebuild Face, Raise Degree, Isoparam, Untrim, Reverse** | Missing | `GeomLib::ExtendSurfByLength`, `GeomConvert`, B-spline `IncreaseDegree`, and the iso-curves | Straightforward. Each is a small tool. |
| **Surface CV editing** (Slide Surface CV, Deform) | Missing | Edit `Geom_BSplineSurface` poles and rebuild the face | Most of the work is UI: showing the CVs and dragging them. |

## Display and analysis (no licence issue; mostly Three.js)

| Feature | Status | Route |
|---|---|---|
| Zebra, isophotes, reflection, curvature and draft shaders; Toggle Surface Curvature | Missing | Three.js shaders, with curvature from `BRepLProp_SLProps` per mesh vertex |
| PBR materials and HDRI | Missing | `MeshPhysicalMaterial` with CC0 assets |
| Text tool | Missing | Three.js typeface fonts turned into OCCT wires |

## Exchange (HOOPS / ODA)

| Format | Status | Route |
|---|---|---|
| STEP | Done | OCCT |
| IGES | Done on desktop (PR #13) | OCCT, desktop only |
| DXF | Missing | Write our own reader and writer |
| DWG | Not planned | Needs the ODA SDK, or LibreDWG, which is GPL |
| SAT, Parasolid X_T | Not planned | There is no open implementation |

## Suggested order, if you want one

1. Imprint/Cut/Project, which also gives K knife on every tool.
2. The xNURBS-style patch fill, then Bridge Surface.
3. Thicken, Draft Face, Pipe and the guide curves.
4. Analysis shaders (zebra and curvature), so the surface quality of steps 1 to 3 can be judged.
5. Variable-radius fillet and Fillet Shell.
6. Match Face, Unwrap and PolySplines last, since these are custom geometry work.
