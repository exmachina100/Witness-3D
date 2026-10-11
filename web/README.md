# Witness 3D push/pull extrude

A live push/pull extrude for a Three.js modeler, built on the pattern Plasticity uses for every
modeling command. Click a face, drag the arrow: pulling out joins material, pushing in cuts it,
and extruding off any body makes a new one. Enter commits, Esc cancels, Ctrl+Z undoes.

## How Plasticity works (from its source)

Studied at [nkallen/plasticity@5de7620](https://github.com/nkallen/plasticity/tree/5de762059f1dcb836b2d2925d63b14820c721713).
Every release tag up to `v26.1.4` points at that same October 2023 commit (`git ls-remote --tags`),
so the repo hosts the 26.x installers but its public source stops at app version 0.6.30.

| Layer | What it is | Evidence |
|---|---|---|
| Shell | Electron app, TypeScript + Three.js renderer | `package.json` (electron-forge scripts, `@types/three`) |
| Geometry kernel | C3D, a commercial B-rep kernel from C3D Labs, loaded as a native Node addon | `src/kernel/kernel.ts:1` re-exports `build/Release/c3d.node`; `generate/templates/binding.gyp` links `libc3d` |
| Bindings | Generated C++/TS wrappers for the C3D API | `generate/src/generate.mjs`, `generate/api.mjs` |
| Commands | Each tool is a `Command` that owns "resources" (factory, gizmo, dialog) and finishes or cancels them together | `src/command/Command.ts:29-39`, `src/commands/extrude/ExtrudeCommand.ts:16-68` |
| Factories | A state machine (`none/updating/updated/failed/cancelled/committed`) with `update()` for previews and `commit()` for real; extra drag events collapse into one `hasNext` flag | `src/command/GeometryFactory.ts:12-17`, `:239-291`, `:46-50` |
| Flicker-free previews | Compute async, then swap temporaries synchronously; check `abortEarly` after every await | `src/command/GeometryFactory.ts:86-142` |
| Extrude to boolean | Extrude wraps a boolean; positive distance unions, negative cuts | `src/commands/extrude/ExtrudeFactory.ts:115-117`, `:150` (`PossiblyBooleanExtrudeFactory`) |
| Phantoms | Translucent tool body, blue for union, red for difference, green for intersect | `src/commands/boolean/BooleanFactory.ts:79-91` |
| Snapping | Point, axis, and plane snaps feed the point picker and gizmos | `src/editor/snaps/Snap.ts:8`, `AxisSnap.ts:24`, `PlaneSnap.ts:11` |
| Undo | Whole-editor mementos (geometry, selection, snaps, curves) | `src/editor/History.ts:19-33` |

## What this module ports

| Plasticity | Here |
|---|---|
| `GeometryFactory` state machine | `src/GeometryFactory.js` |
| `PossiblyBooleanExtrudeFactory` | `src/ExtrudeFactory.js` |
| `ExtrudeGizmo` distance handle | `src/ExtrudeGizmo.js` |
| `GeometryDatabase` + `History` | `src/Document.js` |
| C3D kernel (`ExtrusionSolid`, `UnionResult`) | OpenCascade via [replicad-opencascadejs](https://www.npmjs.com/package/replicad-opencascadejs) (WASM, LGPL-2.1): `src/Kernel.js` |

Bodies are exact B-rep solids: `BRepPrimAPI_MakePrism` for the extrude, `BRepAlgoAPI_Fuse`/`Cut`
plus `ShapeUpgrade_UnifySameDomain` for join and cut, `BRepMesh_IncrementalMesh` for display, and
the drawn edges are the solid's real B-rep edges. Bodies export to STEP (`exportSTEP`).
OCCT currently runs on the main thread; moving it into a Web Worker is the next step.

## Run

```sh
npm install
npm test          # 9 tests: join, cut, true-circle cut, new body, coalescing, no-op, undo/redo, B-rep edges, STEP
npx serve .       # then open index.html
```
