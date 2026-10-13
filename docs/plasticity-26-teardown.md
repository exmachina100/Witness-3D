# What Plasticity 26.1.4 is built on

What the shipped Plasticity 26.1.4 installer contains, compared with the open-source code (nkallen/plasticity, app 0.6.30, October 2023), and what that means for Witness 3D.

The headline is that **Plasticity no longer runs on C3D.** 26.1.4 ships Siemens Parasolid as its modeling kernel. It also ships three other commercial SDKs:
- Tech Soft 3D's HOOPS Exchange, for CAD import and export;
- the Open Design Alliance SDK, for DWG/DXF;
- xNURBS, for N-sided surface patches.

## How this was read

| Step | Detail |
|---|---|
| Installer | `Plasticity-26.1.4.Setup.exe` from the v26.1.4 GitHub release, 287,720,992 bytes, sha256 `38dafadd0e45be50abd084df50be5025d0d077632ee697cfb29394fba37efbd8` |
| REA | `rea-agents@3.1.0` (MIT, github.com/morluto/rea), pinned to a release that is two months old. `rea inspect-artifact` identified the file as a PE and stopped, because it doesn't open Squirrel installers. |
| Unpacking | 7-Zip: the PE resource `.rsrc/DATA/131` is a zip holding `Plasticity-26.1.4-full.nupkg` (sha256 `f5b34e8b…a8d25f`). That nupkg holds the Electron app under `lib/net45/`. |
| What was read | Only metadata: `resources/app/package.json`, file names and sizes, the version resources of the bundled DLLs (company, description, version), and asset file names. |
| What was not read | The app's JavaScript ships as V8 bytecode (`.jsc`, via `bytenode`), and the kernels are licensed binaries. Neither was decompiled or disassembled. No Plasticity code is copied into Witness 3D. |

## The stack, 0.6.30 vs 26.1.4

| Layer | Open source 0.6.30 (2023) | Shipped 26.1.4 (Aug 2026) | Evidence |
|---|---|---|---|
| Shell | Electron + TypeScript | Electron 26.6.9 (a fork, `gerhardberger-electron`), TypeScript 5.9, webpack via electron-forge, Squirrel/WiX/deb/rpm/zip makers | `package.json` devDependencies |
| UI | React | Preact 10 + `@preact/signals`, Tailwind 3, Lingui 5 (translations) | `package.json` |
| Renderer | Three.js | A Three.js fork, `@plastic-software/three@0.183.0` | `dependencies.three` |
| Modeling kernel | C3D (C3D Labs) via a generated `c3d.node` addon | **Parasolid 38.01.167** (`pskernel.dll`, 72 MB, "Siemens") plus **Parasolid BodyShop 34.1** (`psbodyshop.dll`, model repair). Accessed through the `pk.node` addon (21 MB); Parasolid's C API is called PK. | DLL version resources; `P_SCHEMA=parasolid-schema` in the test scripts; `main/parasolid-schema/*.sch_txt` |
| CAD exchange | C3D converters | **HOOPS Exchange 25.8** (Tech Soft 3D: `A3DLIBS.dll`, `TfKernel.dll`, and STEP/IGES/SAT/X_T readers and writers such as `stepstep30.dll`, `igestep30.dll`, `satstep31.dll`, `xtstep30.dll`, `dwgstep30.dll`, `rdmstep30.dll`). `hepb.dll` is described as "Parasolid Bridge". | DLL version resources |
| DWG/DXF | none | **ODA SDK 26.8** (Open Design Alliance: `TD_*` and `*.tx` modules, including Brep Builder, ACIS Builder, Constraint solver and Raster Services) | DLL version resources |
| N-sided patches | C3D surfaces | **xNURBS** (`xnkernel.dll` 2025.0.9, 51 MB). The options artwork is named `xnurbs-boundary` and `xnurbs-quad-sided`. | DLL description, `renderer/img/` |
| SubD / spline conversion | none | `PolyhedralSplinesLib.dll` (3.7 MB, no version info). Probably polyhedral-net splines for turning quad meshes into surfaces; this is inferred from the name. | file name |
| Threading | none | Intel oneTBB 2022.2 (`tbb12.dll`) | DLL version resources |
| Mesh export | in-house | `meshoptimizer` 0.25 | `dependencies` |
| Text tool | none in 0.6.30 | Three.js typeface-JSON fonts (Inter, Roboto, Space Mono, Space Grotesk, Poppins and about 20 others) | `renderer/img/*.typeface-json` |
| Materials | matcaps | PBR material library (brushed aluminum, brass, car paint, walnut, marble, leather and others, with base-color, roughness and normal maps) plus HDRI environments (`plasticity_studio_01`, `kloofendal_puresky_1k` and others) | `renderer/img/` |
| Licensing | none | Ed25519/ECDSA signatures (`@noble/ed25519`, `elliptic`) bound to `node-machine-id` | `dependencies`; this is inferred to be offline license checks |
| Web and cloud | none | A web build (`web:vite`) and a Cloudflare Workers backend (`hono`, `kysely-d1`, `wrangler`, D1 migrations), plus S3 presigned uploads | `scripts`, `dependencies` |
| Other | | `plasticity__ws`, a WebSocket that the documented Blender bridge probably uses; `atom-keymap-plasticity` for the keymap; a `thumbnail_provider.dll` that adds Windows Explorer thumbnails for `.plasticity` files | `dependencies`, `main/` |

The option-illustration asset names also list command options that 26.1 has and 0.6.30 lacked:
- bridge surface tension and trim;
- fillet shell shape and Y-blend;
- imprint and project curve methods (bidirectional, hide occluded);
- extend curve and extend sheet shapes;
- sweep alignment, scale and twist;
- offset round, linear and natural;
- match face side;
- face-change grow;
- export-mesh angle tolerance, inflection and max width;
- transform-face step.

## The machine-wide MSI (added 2026-10-13)

`Plasticity.msi` from the same v26.1.4 release, 293,920,768 bytes, sha256
`dfd7b2517b9cf79c878b9fc8400a350924515f5a30e8e1644abbc38f115a2f70` (matches GitHub's digest for the
release asset). Read with Windows Installer's read-only database API: tables only, nothing installed
or run. The dump is in [rea/plasticity-26.1.4-msi-tables.txt](rea/plasticity-26.1.4-msi-tables.txt).

| Finding | Evidence |
|---|---|
| A WiX MSI wraps the per-user Squirrel app for machine-wide installs, with auto-update on | `ProductName` "Plasticity (Machine - MSI)", `ALLUSERS=1`, `AUTOUPDATEENABLED=1`, `UPDATERUSERGROUP=Users`; `Squirrel.exe` 2.0.1.1 in the File table |
| Windows Explorer thumbnails for `.plasticity` files | Custom actions run `regsvr32 /s …\.webpack\main	humbnail_provider.dll` (and `/u` on uninstall) |
| No file association in the installer | No Extension, ProgId or Verb tables; the app must register `.plasticity` itself |
| CAD import through HOOPS Exchange 25.8: STEP, IGES, ACIS SAT, Parasolid X_T, DWG, plus `rdmstep30` | Readers `stepstep30`, `igestep30`, `satstep31`, `xtstep30`, `dwgstep30`, `rdmstep30` (all 25.8.0.19) |
| CAD export: IGES, SAT, STEP, X_T | Writers `wiges`, `wsat`, `wstp`, `wxt` (25.8.0.19); `hepb` / `HEPBMP` bridge them to Parasolid |
| Graphics fallbacks: ANGLE on Direct3D, then SwiftShader Vulkan | `libEGL`, `libGLESv2` 2.1.21343, `d3dcompiler_47`, `vk_swiftshader`, `vulkan-1` |
| Threading: oneTBB and OpenMP | `tbb12` / `tbbmalloc` 2022.2, `vcomp140` |
| Release line | 26.1.0 (Apr 16), 26.1.1, 26.1.2, 26.1.3 (Apr 21) and 26.1.4 (Aug 14, 2026) on GitHub |

## What it means for Witness 3D

Every geometry SDK in 26.1.4 is commercial and licensed per seat. Witness 3D stays on OpenCascade (LGPL), with the kernel behind the `Kernel` trait as before. Here is how each 26.1.4 capability maps onto open pieces:

| Plasticity 26.1.4 uses | Witness 3D path | Notes |
|---|---|---|
| Parasolid modeling and BodyShop repair | OpenCascade `BRepAlgoAPI_*`, `BRepFilletAPI_*`, `BRepOffsetAPI_*`, and `ShapeFix_*` / `ShapeUpgrade_*` for healing | Fillet and chamfer are the next big unlock; OCCT has them. |
| HOOPS Exchange (STEP, IGES, SAT, X_T) | OCCT `STEPControl`, `IGESControl`; no SAT or X_T | STEP export already works, so STEP/IGES import is next. |
| ODA DWG/DXF | OCCT has no DWG. LibreDWG is GPL, which conflicts with a closed app; DXF can be written in-house. | Later; decide on licensing first. |
| xNURBS N-sided patches | OCCT `BRepFill_Filling` / `GeomPlate` | Lower quality than xNURBS, but free. |
| oneTBB threading | OCCT's own parallel mode (`BOPAlgo` `SetRunParallel`) | |
| meshoptimizer | the same library (MIT); it has Rust bindings | Can be used directly. |
| Typeface-JSON text | Three.js `FontLoader` produces the same font format; turn the outlines into OCCT wires | Same approach as Plasticity. |
| PBR materials and HDRI | Three.js `MeshPhysicalMaterial` + `RGBELoader`/`EXRLoader`, with CC0 textures (ambientCG, Poly Haven) | Use your own assets, not Plasticity's. |
| Preact + signals UI | Witness 3D keeps its vanilla-JS shell (`web/src/app`) | Revisit if the UI grows. |

## Next for Witness 3D, in order

1. **Fillet and chamfer** on selected edges: OCCT `BRepFilletAPI_MakeFillet`, plus edge selection mode (2).
2. **STEP and IGES import**, with healing through `ShapeFix_Shape`.
3. **Boolean as its own tool** (Q), with keep-tools (T) and intersect.
4. **Offset face and draft face**: `BRepOffsetAPI_MakeOffsetShape` and `BRepOffsetAPI_DraftAngle`.
5. **Curves and sketching**: line, arc, rectangle, circle, trim, and turning text into curves.
6. **Materials and environments** for display.
