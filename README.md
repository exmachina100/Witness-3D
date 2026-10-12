# Witness 3D

A direct modeler in the OpenCascade kernel.

| Folder | What it is |
|---|---|
| [`web/`](web/) | The push/pull extrude running in the browser: Three.js plus OpenCascade compiled to WebAssembly. Includes the notes on how Plasticity is built, with file and line evidence. |
| [`apps/desktop/`](apps/desktop/) | The desktop app: the Rust core in a Tauri window with the Three.js viewport. |
| [`crates/w3d-kernel/`](crates/w3d-kernel/) | The Rust modeling core. Geometry goes through a `Kernel` trait, implemented today by OpenCascade via [opencascade-rs](https://github.com/bschwind/opencascade-rs). It also holds the extrude-to-boolean logic, the document with undo/redo, and the engine thread that keeps previews on the newest drag. |

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

## Licensing note

OpenCascade is LGPL-2.1. Both the WebAssembly build and opencascade-rs link it, so a shipped
Witness 3D must let users relink against a modified OCCT, or keep OCCT in a separately loaded library.
