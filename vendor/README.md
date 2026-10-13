# Vendored crates

| Crate | Upstream | License |
|---|---|---|
| `opencascade` 0.3.0 | [bschwind/opencascade-rs](https://github.com/bschwind/opencascade-rs) | LGPL-2.1 |
| `opencascade-sys` 0.3.0 | same repository | LGPL-2.1 |

Both are the crates.io 0.3.0 sources, patched in through `[patch.crates-io]` in the root
`Cargo.toml`. OpenCascade itself still comes unmodified from `occt-sys` 7.8.1.

## What Witness 3D changed

Additions, plus one portability fix to upstream lines:

- **Windows (MSVC) fix:** OpenCascade defines `Handle_Geom_Surface` and friends as their own classes
  under MSVC (a typedef elsewhere; see `Standard_Handle.hxx`), so upstream's
  `std::unique_ptr<Handle_X>(new opencascade::handle<X>(...))` does not compile there. The headers in
  `opencascade-sys/include/` construct `new Handle_X(...)` instead, which is the same type on every
  other compiler.

- `opencascade-sys/include/w3d.hxx`, `opencascade-sys/src/w3d.rs` (registered in `build.rs` and
  `src/lib.rs`): numbered edge and face access through `TopExp::MapShapes`; fillet and chamfer that
  check `IsDone()` and report the faulty edges and the kernel's reason; `BRepCheck_Analyzer`; BREP
  text read and write. OpenCascade's `Standard_Failure` is caught and rethrown as
  `std::runtime_error`, because cxx only converts `std::exception` and anything else aborts.
- `opencascade/src/primitives/w3d.rs` (registered in `src/primitives.rs`): the safe Rust side of
  the above on `Shape`.

Upstream `Shape::fillet_edges` calls `Shape()` without checking `IsDone()`; when the fillet
fails, OpenCascade throws through cxx and the process aborts. That is why Witness 3D needs these.
