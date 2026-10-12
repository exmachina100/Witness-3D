//! Witness 3D additions: numbered edge and face access, checked fillet/chamfer, validity and BREP
//! text I/O. See include/w3d.hxx and vendor/README.md.
pub use inner::*;

#[cxx::bridge]
mod inner {
    unsafe extern "C++" {
        include!("opencascade-sys/include/w3d.hxx");

        type TopoDS_Shape = crate::topo_ds::TopoDS_Shape;
        type TopoDS_Edge = crate::topo_ds::TopoDS_Edge;
        type TopoDS_Face = crate::topo_ds::TopoDS_Face;

        pub fn w3d_count(shape: &TopoDS_Shape, faces: bool) -> i32;
        pub fn w3d_edge(shape: &TopoDS_Shape, index: i32) -> Result<UniquePtr<TopoDS_Edge>>;
        pub fn w3d_face(shape: &TopoDS_Shape, index: i32) -> Result<UniquePtr<TopoDS_Face>>;
        pub fn w3d_blend_edges(
            shape: &TopoDS_Shape,
            edges: &[i32],
            size: f64,
            chamfer: bool,
        ) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_is_valid(shape: &TopoDS_Shape) -> bool;
        pub fn w3d_write_brep(shape: &TopoDS_Shape) -> Result<String>;
        pub fn w3d_read_brep(text: &str) -> Result<UniquePtr<TopoDS_Shape>>;
    }
}
