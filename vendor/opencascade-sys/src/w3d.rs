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
            variable: &[f64],
        ) -> Result<UniquePtr<W3dResult>>;
        pub fn w3d_result_shape(r: &W3dResult) -> UniquePtr<TopoDS_Shape>;
        pub fn w3d_result_pairs(r: &W3dResult, input: i32, kind: i32) -> Vec<i32>;

        pub fn w3d_revolve(section: &[f64], axis: &[f64], angle: f64, thickness: f64) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_loft(sections: &[f64]) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_sweep(section: &[f64], path: &[f64], twist: f64, scale: f64) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_sweep_guided(section: &[f64], path: &[f64], guide: &[f64], method: i32, parallel: bool) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_loft_guided(sections: &[f64], guides: &[f64]) -> Result<UniquePtr<TopoDS_Shape>>;
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
        pub fn w3d_refillet(shape: &TopoDS_Shape, faces: &[i32], radius: f64) -> Result<UniquePtr<W3dResult>>;
        pub fn w3d_unify(shape: &TopoDS_Shape) -> Result<UniquePtr<W3dResult>>;
        pub fn w3d_cut(shape: &TopoDS_Shape, data: &[f64], length: f64, extra: &TopoDS_Shape) -> Result<UniquePtr<W3dResult>>;
        pub fn w3d_face_sheet(shape: &TopoDS_Shape, index: i32, size: f64) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_plane_sheet(plane: &[f64], size: f64) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_imprint(shape: &TopoDS_Shape, faces: &[i32], data: &[f64], length: f64, extra: &TopoDS_Shape) -> Result<UniquePtr<W3dResult>>;
        pub fn w3d_draft_faces(shape: &TopoDS_Shape, faces: &[i32], frame: &[f64], angle: f64) -> Result<UniquePtr<W3dResult>>;
        pub fn w3d_result_others(r: &W3dResult) -> UniquePtr<TopoDS_Shape>;
        pub fn w3d_solid_count(shape: &TopoDS_Shape) -> i32;
        pub fn w3d_reversed(shape: &TopoDS_Shape) -> UniquePtr<TopoDS_Shape>;
        pub fn w3d_boundary_edges(shape: &TopoDS_Shape) -> Vec<i32>;
        pub fn w3d_edge_angles(shape: &TopoDS_Shape) -> Vec<f64>;
        pub fn w3d_face_surfaces(shape: &TopoDS_Shape) -> Vec<f64>;
        pub fn w3d_face_poles(shape: &TopoDS_Shape) -> Vec<f64>;
        pub fn w3d_fillet_faces(shape: &TopoDS_Shape, seeds: &[i32]) -> Vec<i32>;
        pub fn w3d_solid_at(shape: &TopoDS_Shape, index: i32) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_project(shape: &TopoDS_Shape, faces: &[i32], data: &[f64], length: f64, both: bool, hide: bool) -> Result<Vec<f64>>;
        pub fn w3d_meet_curves(a: &TopoDS_Shape, b: &TopoDS_Shape) -> Result<Vec<f64>>;
        pub fn w3d_isoparam(shape: &TopoDS_Shape, face: i32, point: &[f64], along_u: bool) -> Result<Vec<f64>>;
        pub fn w3d_face_uvn(shape: &TopoDS_Shape, face: i32, map: bool, data: &[f64]) -> Result<Vec<f64>>;
        pub fn w3d_project_curve_curve(data: &[f64], length: f64) -> Result<Vec<f64>>;
        pub fn w3d_bridge_surface(shape: &TopoDS_Shape, a: i32, b: i32, tension: f64) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_project_outline(shape: &TopoDS_Shape, plane: &[f64]) -> Result<Vec<f64>>;
        pub fn w3d_hidden_lines(shape: &TopoDS_Shape, frame: &[f64], deflection: f64) -> Result<Vec<f64>>;
        pub fn w3d_thicken(shape: &TopoDS_Shape, front: f64, back: f64) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_thicken_faces(shape: &TopoDS_Shape, faces: &[i32], front: f64, back: f64) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_subdivide_faces(shape: &TopoDS_Shape, faces: &[i32]) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_move_face_poles(shape: &TopoDS_Shape, moves: &[f64]) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_rebuild_faces(shape: &TopoDS_Shape, faces: &[i32], p: &[f64]) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_raise_faces(shape: &TopoDS_Shape, faces: &[i32]) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_match_faces(shape: &TopoDS_Shape, faces: &[i32], target: &TopoDS_Shape, tface: i32, caps: &[f64]) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_offset_edge_faces(shape: &TopoDS_Shape, edges: &[i32], side: i32) -> Result<Vec<i32>>;
        pub fn w3d_edge_tube(shape: &TopoDS_Shape, edges: &[i32], d: f64) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_reshape_fillets(shape: &TopoDS_Shape, faces: &[i32], kind: i32, tension: f64) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_volume(shape: &TopoDS_Shape) -> Result<f64>;
        pub fn w3d_round_piece(body: &TopoDS_Shape, rounded: &TopoDS_Shape, planes: &[f64]) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_unwrap_face(shape: &TopoDS_Shape, index: i32) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_untrim_face(shape: &TopoDS_Shape, index: i32, keep: bool) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_edge_curvature(shape: &TopoDS_Shape, index: i32, n: i32) -> Result<Vec<f64>>;
        pub fn w3d_face_deviation(a: &TopoDS_Shape, b: &TopoDS_Shape, index: i32) -> Result<f64>;
        pub fn w3d_face_spline(shape: &TopoDS_Shape, index: i32) -> Result<Vec<i32>>;
        pub fn w3d_extend_sheet(shape: &TopoDS_Shape, index: i32, distance: f64, kind: i32) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_extend_sheet_to(shape: &TopoDS_Shape, index: i32, target: &TopoDS_Shape, kind: i32, through: bool) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_child_count(shape: &TopoDS_Shape) -> i32;
        pub fn w3d_child_at(shape: &TopoDS_Shape, index: i32) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_join_sheets(all: &TopoDS_Shape, tol: f64) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_unjoin(shape: &TopoDS_Shape, faces: bool) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn w3d_patch(data: &[f64], shape: &TopoDS_Shape, edges: &[i32], tangent: &[i32], tol: f64) -> Result<UniquePtr<TopoDS_Shape>>;
    }
}
