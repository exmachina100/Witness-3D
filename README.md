# Witness 3D

A direct modeler in the spirit of Plasticity: exact B-rep solids, live push/pull previews, edge
fillets and chamfers, and whole-document undo, on the OpenCascade kernel. Documents are in
millimetres and save as `.w3d` files (exact geometry); STEP is for exchange.

| Folder | What it is |
|---|---|
| [`web/`](web/) | The push/pull extrude running in the browser: Three.js plus OpenCascade compiled to WebAssembly. Includes the notes on how Plasticity is built, with file and line evidence. |
| [`apps/desktop/`](apps/desktop/) | The desktop app: the Rust core in a Tauri window with the Three.js viewport. |
| [`crates/w3d-kernel/`](crates/w3d-kernel/) | The Rust modeling core. Geometry goes through a `Kernel` trait, implemented today by OpenCascade via [opencascade-rs](https://github.com/bschwind/opencascade-rs). It also holds the extrude-to-boolean logic, fillet/chamfer, the native file format, the document with undo/redo, and the engine thread that keeps previews on the newest drag. |
| [`tools/blender/`](tools/blender/) | The Blender add-on: Connect, Refresh and Live Link to the desktop app on 127.0.0.1:8981. Meshes only; updates keep Blender's materials and camera. |
| [`vendor/`](vendor/) | opencascade-rs 0.3.0 with small Witness 3D additions (checked fillets, edge numbering, BREP text); see its README. |

## Run it

```sh
# Web demo and its tests
cd web && npm install && npm test
npx serve .            # then open http://localhost:3000

# Desktop app (see apps/desktop/README.md for Linux prerequisites)
cd apps/desktop && npm install && npm run tauri dev

# Rust core (the first build compiles OpenCascade from source, which takes a while)
cargo test --release
cargo check --no-default-features   # the core without any kernel linked
```

## AI commands and Blender

**Ask (Ctrl+K)** turns a sentence such as "round the top edges by 4 mm" into one of the registered
tools, started with its normal preview; adjust it, then Enter keeps it or Esc drops it. It calls
Claude with your own Anthropic API key: paste it when asked (the web demo keeps it for the tab only;
the desktop app stores it in its config folder), or set `ANTHROPIC_API_KEY` before starting the
desktop app. The key is never written to this repository.

**Blender**: in Blender, Edit > Preferences > Add-ons > Install from Disk, pick
`tools/blender/witness3d_bridge.py`, then use the "Witness 3D" tab in the 3D view sidebar while the
desktop app runs. Its test runs against Blender as a Python module (`pip install bpy`):
`python tools/blender/test_bridge.py target/release/examples/bridge_demo`.

## Licensing note

OpenCascade is LGPL-2.1. Both the WebAssembly build and opencascade-rs link it, so a shipped
Witness 3D must let users relink against a modified OCCT, or keep OCCT in a separately loaded library.
