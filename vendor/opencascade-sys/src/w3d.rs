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
            angle: f64,
        ) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_is_valid(shape: &TopoDS_Shape) -> bool;
        pub fn w3d_heal(shape: &TopoDS_Shape) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_write_brep(shape: &TopoDS_Shape) -> Result<String>;
        pub fn w3d_read_brep(text: &str) -> Result<UniquePtr<TopoDS_Shape>>;

        type W3dResult;
        pub fn w3d_boolean(a: &TopoDS_Shape, b: &TopoDS_Shape, op: i32) -> Result<UniquePtr<W3dResult>>;
        pub fn w3d_blend_edges_history(
            shape: &TopoDS_Shape,
            edges: &[i32],
            size: f64,
            chamfer: bool,
            angle: f64,
        ) -> Result<UniquePtr<W3dResult>>;
        pub fn w3d_result_shape(r: &W3dResult) -> UniquePtr<TopoDS_Shape>;
        pub fn w3d_result_pairs(r: &W3dResult, input: i32, kind: i32) -> Vec<i32>;

        pub fn w3d_revolve(section: &[f64], axis: &[f64], angle: f64, thickness: f64) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_loft(sections: &[f64]) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_sweep(section: &[f64], path: &[f64], twist: f64, scale: f64) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_extrude(section: &[f64], dir: &[f64], distance: f64, back: f64, angle: f64, thickness: f64) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_extrude_face(
            shape: &TopoDS_Shape,
            face: i32,
            dir: &[f64],
            distance: f64,
            back: f64,
            angle: f64,
            thickness: f64,
        ) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_sample(section: &[f64], n: i32) -> Result<Vec<f64>>;
        pub fn w3d_offset_faces(shape: &TopoDS_Shape, faces: &[i32], distance: f64, angle: f64) -> Result<UniquePtr<W3dResult>>;
        pub fn w3d_shell(shape: &TopoDS_Shape, faces: &[i32], thickness: f64) -> Result<UniquePtr<W3dResult>>;
        pub fn w3d_mirror(shape: &TopoDS_Shape, plane: &[f64]) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_remove_faces(shape: &TopoDS_Shape, faces: &[i32]) -> Result<UniquePtr<W3dResult>>;
        pub fn w3d_cut(shape: &TopoDS_Shape, data: &[f64], length: f64, extra: &TopoDS_Shape) -> Result<UniquePtr<W3dResult>>;
        pub fn w3d_face_sheet(shape: &TopoDS_Shape, index: i32, size: f64) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_plane_sheet(plane: &[f64], size: f64) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_imprint(shape: &TopoDS_Shape, faces: &[i32], data: &[f64], length: f64, extra: &TopoDS_Shape) -> Result<UniquePtr<W3dResult>>;
        pub fn w3d_draft_faces(shape: &TopoDS_Shape, faces: &[i32], frame: &[f64], angle: f64) -> Result<UniquePtr<W3dResult>>;
        pub fn w3d_result_others(r: &W3dResult) -> UniquePtr<TopoDS_Shape>;
        pub fn w3d_solid_count(shape: &TopoDS_Shape) -> i32;
        pub fn w3d_solid_at(shape: &TopoDS_Shape, index: i32) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_project(shape: &TopoDS_Shape, faces: &[i32], data: &[f64], length: f64, both: bool, hide: bool) -> Result<Vec<f64>>;
        pub fn w3d_meet_curves(a: &TopoDS_Shape, b: &TopoDS_Shape) -> Result<Vec<f64>>;
        pub fn w3d_project_curve_curve(data: &[f64], length: f64) -> Result<Vec<f64>>;
        pub fn w3d_patch(data: &[f64], shape: &TopoDS_Shape, edges: &[i32], tangent: &[i32], tol: f64) -> Result<UniquePtr<TopoDS_Shape>>;
    }
}
