//! Witness 3D additions to `Shape`: numbered edges and faces, fillet and chamfer that report
//! failure instead of aborting, a validity check, and BREP text I/O. See vendor/README.md.

use super::{Edge, Face, Shape};
use glam::DVec3;
use opencascade_sys as ffi;

/// Why a fillet or chamfer failed: the edges the kernel could not blend (by number, possibly
/// empty when it cannot tell) and a sentence for the user.
#[derive(Debug, Clone, PartialEq)]
pub struct BlendError {
    pub edges: Vec<usize>,
    pub reason: String,
}

impl std::fmt::Display for BlendError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str(&self.reason) }
}

impl std::error::Error for BlendError {}

impl Shape {
    /// Number of distinct edges; edges are numbered 0..n in a stable order for this shape.
    pub fn edge_count(&self) -> usize { ffi::w3d::w3d_count(&self.inner, false) as usize }

    /// Number of distinct faces, numbered like [`Shape::faces`].
    pub fn face_count(&self) -> usize { ffi::w3d::w3d_count(&self.inner, true) as usize }

    /// Edge number `index`.
    pub fn edge_at(&self, index: usize) -> Option<Edge> {
        let e = ffi::w3d::w3d_edge(&self.inner, index as i32).ok()?;
        Some(Edge::from_edge(&e))
    }

    /// Face number `index`.
    pub fn face_at(&self, index: usize) -> Option<Face> {
        let f = ffi::w3d::w3d_face(&self.inner, index as i32).ok()?;
        Some(Face::from_face(&f))
    }

    /// Every edge, in number order.
    pub fn numbered_edges(&self) -> Vec<Edge> {
        (0..self.edge_count()).filter_map(|i| self.edge_at(i)).collect()
    }

    /// Round (`chamfer == false`) or bevel the numbered edges by `size`. A chamfer with an `angle`
    /// other than 45° (radians; 0 means 45°) is `size` on each edge's first face, at that angle.
    pub fn blend_edges(&self, edges: &[usize], size: f64, chamfer: bool, angle: f64) -> Result<Shape, BlendError> {
        let ids: Vec<i32> = edges.iter().map(|&e| e as i32).collect();
        match ffi::w3d::w3d_blend_edges(&self.inner, &ids, size, chamfer, angle) {
            Ok(shape) => Ok(Shape::from_shape(&shape)),
            Err(e) => Err(parse_blend_error(e.what())),
        }
    }

    /// Whether OpenCascade's checker finds the shape's topology and geometry consistent.
    pub fn is_valid(&self) -> bool { ffi::w3d::w3d_is_valid(&self.inner) }

    /// The shape with small gaps, tolerances and orientations repaired (ShapeFix_Shape).
    pub fn healed(&self) -> Result<Shape, String> {
        let s = ffi::w3d::w3d_heal(&self.inner).map_err(|e| e.what().to_string())?;
        Ok(Shape::from_shape(&s))
    }

    /// The exact shape as OpenCascade BREP text.
    pub fn to_brep_text(&self) -> Result<String, crate::Error> {
        ffi::w3d::w3d_write_brep(&self.inner).map_err(|_| crate::Error::BrepWriteFailed)
    }

    pub fn from_brep_text(text: &str) -> Result<Shape, crate::Error> {
        let s = ffi::w3d::w3d_read_brep(text).map_err(|_| crate::Error::BrepReadFailed)?;
        Ok(Shape::from_shape(&s))
    }
}

/// Which result faces and edges came from which input faces and edges, by number.
/// `faces[k]` / `edges[k]` hold (source number in input k, result number) pairs; a source that was
/// split appears once per piece, and pieces merged from several sources appear once per source.
/// `generated_faces` holds (input edge number, result face number) for faces grown from an edge,
/// such as the round of a fillet.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ShapeHistory {
    pub faces: [Vec<(usize, usize)>; 2],
    pub edges: [Vec<(usize, usize)>; 2],
    pub generated_faces: Vec<(usize, usize)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BooleanKind {
    Union,
    Difference,
    Intersection,
}

/// The flat pairs, each once (a source split into pieces that land on one face appears once).
fn pairs(v: Vec<i32>) -> Vec<(usize, usize)> {
    let mut out: Vec<(usize, usize)> = Vec::new();
    for p in v.chunks_exact(2).map(|p| (p[0] as usize, p[1] as usize)) {
        if !out.contains(&p) { out.push(p) }
    }
    out
}

fn history(r: &ffi::w3d::W3dResult, inputs: usize) -> ShapeHistory {
    let mut h = ShapeHistory::default();
    for k in 0..inputs {
        h.faces[k] = pairs(ffi::w3d::w3d_result_pairs(r, k as i32, 0));
        h.edges[k] = pairs(ffi::w3d::w3d_result_pairs(r, k as i32, 1));
    }
    h.generated_faces = pairs(ffi::w3d::w3d_result_pairs(r, 0, 2));
    h
}

impl Shape {
    /// A boolean followed by merging coplanar faces (as [`Shape::clean`]), with its history.
    pub fn boolean_with_history(&self, other: &Shape, kind: BooleanKind) -> Result<(Shape, ShapeHistory), String> {
        let op = match kind { BooleanKind::Union => 0, BooleanKind::Difference => 1, BooleanKind::Intersection => 2 };
        let r = ffi::w3d::w3d_boolean(&self.inner, &other.inner, op).map_err(|e| e.what().to_string())?;
        Ok((Shape::from_shape(&ffi::w3d::w3d_result_shape(&r)), history(&r, 2)))
    }

    /// [`Shape::blend_edges`] with its history.
    /// `variable` is [edge, x, y, z, scale] per variable point of a fillet (see `w3d.hxx`).
    pub fn blend_edges_with_history(&self, edges: &[usize], size: f64, chamfer: bool, angle: f64, variable: &[f64]) -> Result<(Shape, ShapeHistory), BlendError> {
        let ids: Vec<i32> = edges.iter().map(|&e| e as i32).collect();
        match ffi::w3d::w3d_blend_edges_history(&self.inner, &ids, size, chamfer, angle, variable) {
            Ok(r) => Ok((Shape::from_shape(&ffi::w3d::w3d_result_shape(&r)), history(&r, 1))),
            Err(e) => Err(parse_blend_error(e.what())),
        }
    }
}

/// Strip the "kernel: " wrapper the shim puts on OpenCascade's own failures; keep our sentences.
fn reason(e: cxx::Exception) -> String { e.what().to_string() }

impl Shape {
    /// The profile (see `w3d.hxx` for the number layout) turned `angle` radians about `axis`
    /// (a point then a direction).
    pub fn revolve_section(section: &[f64], axis: [f64; 6], angle: f64, thickness: f64) -> Result<Shape, String> {
        let s = ffi::w3d::w3d_revolve(section, &axis, angle, thickness).map_err(reason)?;
        Ok(Shape::from_shape(&s))
    }

    /// A solid through the profiles, given one after another.
    pub fn loft_sections(sections: &[f64]) -> Result<Shape, String> {
        let s = ffi::w3d::w3d_loft(sections).map_err(reason)?;
        Ok(Shape::from_shape(&s))
    }

    /// The profile swept along `path`, its far end turned by `twist` radians and scaled by `scale`.
    pub fn sweep_section(section: &[f64], path: &[f64], twist: f64, scale: f64) -> Result<Shape, String> {
        let s = ffi::w3d::w3d_sweep(section, path, twist, scale).map_err(reason)?;
        Ok(Shape::from_shape(&s))
    }

    /// The profile swept along `path` following `guide` (empty for none) by `method` (0 Point,
    /// 1 Chord, 2 Curve), or kept at its drawn orientation when `parallel`.
    pub fn sweep_guided(section: &[f64], path: &[f64], guide: &[f64], method: i32, parallel: bool, round: bool) -> Result<Shape, String> {
        let s = ffi::w3d::w3d_sweep_guided(section, path, guide, method, parallel, round).map_err(reason)?;
        Ok(Shape::from_shape(&s))
    }

    /// A solid through the profiles, given one after another, its sides along the guides.
    pub fn loft_guided(sections: &[f64], guides: &[f64]) -> Result<Shape, String> {
        let s = ffi::w3d::w3d_loft_guided(sections, guides).map_err(reason)?;
        Ok(Shape::from_shape(&s))
    }

    /// The numbered faces moved `distance` along their normals, neighbours following, with history.
    /// The profile extruded along `dir` by `distance`, and `back` the other way; its sides lean in
    /// by `angle` radians and `thickness` leaves walls instead of a filled solid.
    pub fn extrude_section(section: &[f64], dir: [f64; 3], distance: f64, back: f64, angle: f64, thickness: f64) -> Result<Shape, String> {
        let s = ffi::w3d::w3d_extrude(section, &dir, distance, back, angle, thickness).map_err(reason)?;
        Ok(Shape::from_shape(&s))
    }

    /// The numbered face extruded along `dir`, with the options of [`Shape::extrude_section`].
    pub fn extrude_face_shaped(&self, face: usize, dir: [f64; 3], distance: f64, back: f64, angle: f64, thickness: f64) -> Result<Shape, String> {
        let s = ffi::w3d::w3d_extrude_face(&self.inner, face as i32, &dir, distance, back, angle, thickness).map_err(reason)?;
        Ok(Shape::from_shape(&s))
    }

    /// `n + 1` points along a profile or path, evenly spaced in its parameter.
    pub fn sample_section(section: &[f64], n: usize) -> Result<Vec<DVec3>, String> {
        let v = ffi::w3d::w3d_sample(section, n as i32).map_err(reason)?;
        Ok(v.chunks_exact(3).map(|p| DVec3::new(p[0], p[1], p[2])).collect())
    }

    pub fn offset_faces_with_history(&self, faces: &[usize], distance: f64, angle: f64) -> Result<(Shape, ShapeHistory), String> {
        let ids: Vec<i32> = faces.iter().map(|&f| f as i32).collect();
        let r = ffi::w3d::w3d_offset_faces(&self.inner, &ids, distance, angle).map_err(reason)?;
        Ok((Shape::from_shape(&ffi::w3d::w3d_result_shape(&r)), history(&r, 1)))
    }

    /// The numbered faces carried by a rigid motion (offset, pivot, axis, angle), their neighbours
    /// following (Move Face).
    pub fn move_faces_with_history(&self, faces: &[usize], motion: [f64; 10]) -> Result<(Shape, ShapeHistory), String> {
        let ids: Vec<i32> = faces.iter().map(|&f| f as i32).collect();
        let r = ffi::w3d::w3d_move_faces(&self.inner, &ids, &motion).map_err(reason)?;
        Ok((Shape::from_shape(&ffi::w3d::w3d_result_shape(&r)), history(&r, 1)))
    }

    /// The numbered edges and their corners carried by a rigid motion, the flat faces beside them
    /// tilting to follow (Move Edge).
    pub fn move_edges_with_history(&self, edges: &[usize], motion: [f64; 10]) -> Result<(Shape, ShapeHistory), String> {
        let ids: Vec<i32> = edges.iter().map(|&e| e as i32).collect();
        let r = ffi::w3d::w3d_move_edges(&self.inner, &ids, &motion).map_err(reason)?;
        Ok((Shape::from_shape(&ffi::w3d::w3d_result_shape(&r)), history(&r, 1)))
    }

    /// Hollowed to walls `thickness` thick inside the outer surface, open at the numbered faces
    /// (Plasticity's Shell).
    pub fn shell_with_history(&self, faces: &[usize], thickness: f64) -> Result<(Shape, ShapeHistory), String> {
        let ids: Vec<i32> = faces.iter().map(|&f| f as i32).collect();
        let r = ffi::w3d::w3d_shell(&self.inner, &ids, thickness).map_err(reason)?;
        Ok((Shape::from_shape(&ffi::w3d::w3d_result_shape(&r)), history(&r, 1)))
    }

    /// The numbered faces deleted and the gap closed by their neighbours (Plasticity's Remove Face).
    pub fn remove_faces_with_history(&self, faces: &[usize]) -> Result<(Shape, ShapeHistory), String> {
        let ids: Vec<i32> = faces.iter().map(|&f| f as i32).collect();
        let r = ffi::w3d::w3d_remove_faces(&self.inner, &ids).map_err(reason)?;
        Ok((Shape::from_shape(&ffi::w3d::w3d_result_shape(&r)), history(&r, 1)))
    }

    /// The numbered fillet faces made again at `radius` (Plasticity's Dimension on a fillet).
    pub fn refillet_with_history(&self, faces: &[usize], radius: f64) -> Result<(Shape, ShapeHistory), String> {
        let ids: Vec<i32> = faces.iter().map(|&f| f as i32).collect();
        let r = ffi::w3d::w3d_refillet(&self.inner, &ids, radius).map_err(reason)?;
        Ok((Shape::from_shape(&ffi::w3d::w3d_result_shape(&r)), history(&r, 1)))
    }

    /// Faces on one surface and edges on one curve merged (Plasticity's Delete Redundant Topology).
    pub fn unify_with_history(&self) -> Result<(Shape, ShapeHistory), String> {
        let r = ffi::w3d::w3d_unify(&self.inner).map_err(reason)?;
        Ok((Shape::from_shape(&ffi::w3d::w3d_result_shape(&r)), history(&r, 1)))
    }

    /// The same faces facing the other way (Reverse Sheet); faces and edges keep their numbers.
    pub fn reversed(&self) -> Shape {
        Shape::from_shape(&ffi::w3d::w3d_reversed(&self.inner))
    }

    /// Numbers of the edges that bound only one face: a sheet's open sides (Find Boundary Edges).
    pub fn boundary_edges(&self) -> Vec<usize> {
        ffi::w3d::w3d_boundary_edges(&self.inner).into_iter().map(|i| i as usize).collect()
    }

    /// Per edge, the largest angle in degrees between its two faces' normals (0 = tangent); -1 for
    /// edges that do not join two faces.
    pub fn edge_angles(&self) -> Vec<f64> {
        ffi::w3d::w3d_edge_angles(&self.inner).into_iter().collect()
    }

    /// Per face, nine numbers: kind (0 other, 1 plane, 2 cylinder, 3 sphere), radius, a point, a
    /// direction and +1 for a boss or ball, -1 for a hole (see w3d.hxx).
    pub fn face_surfaces(&self) -> Vec<f64> {
        ffi::w3d::w3d_face_surfaces(&self.inner).into_iter().collect()
    }

    /// Per face, its control points: nu, nv, then nu × nv points (see w3d.hxx).
    /// Drops the shape's facets, so the next mesh is made afresh even when coarser.
    pub fn clear_mesh(&self) { ffi::w3d::w3d_clear_mesh(&self.inner) }

    pub fn face_poles(&self) -> Vec<f64> {
        ffi::w3d::w3d_face_poles(&self.inner).into_iter().collect()
    }

    /// Surface control points moved: (face, pole, offset) each, poles numbered as `face_poles` gives them.
    pub fn move_face_poles(&self, moves: &[(usize, usize, [f64; 3])]) -> Result<Shape, String> {
        let flat: Vec<f64> = moves.iter().flat_map(|&(f, p, [x, y, z])| [f as f64, p as f64, x, y, z]).collect();
        let shape = ffi::w3d::w3d_move_face_poles(&self.inner, &flat).map_err(reason)?;
        Ok(Shape::from_shape(&shape))
    }

    /// Plasticity's Subdivide on faces: their spans doubled in u and v, shape unchanged.
    pub fn subdivide_faces(&self, faces: &[usize]) -> Result<Shape, String> {
        let faces: Vec<i32> = faces.iter().map(|&f| f as i32).collect();
        let shape = ffi::w3d::w3d_subdivide_faces(&self.inner, &faces).map_err(reason)?;
        Ok(Shape::from_shape(&shape))
    }

    /// Numbers of the faces that look like fillets; with `seeds`, the fillet chains holding them.
    pub fn fillet_faces(&self, seeds: &[usize]) -> Vec<usize> {
        let seeds: Vec<i32> = seeds.iter().map(|&i| i as i32).collect();
        ffi::w3d::w3d_fillet_faces(&self.inner, &seeds).into_iter().map(|i| i as usize).collect()
    }

    /// Split by sheets swept from curves (see `w3d_cut`): the biggest piece with its history, and the rest.
    /// `extra` are further tools (sheets or solids) beside the curves.
    pub fn cut_with_history(&self, data: &[f64], length: f64, extra: &[&Shape]) -> Result<(Shape, ShapeHistory, Vec<Shape>), String> {
        let extra = Shape::from(crate::primitives::Compound::from_shapes(extra.iter().copied()));
        let r = ffi::w3d::w3d_cut(&self.inner, data, length, &extra.inner).map_err(reason)?;
        let others = ffi::w3d::w3d_result_others(&r);
        let rest = (0..ffi::w3d::w3d_solid_count(&others))
            .map(|i| ffi::w3d::w3d_solid_at(&others, i).map(|s| Shape::from_shape(&s)).map_err(reason))
            .collect::<Result<Vec<_>, _>>()?;
        Ok((Shape::from_shape(&ffi::w3d::w3d_result_shape(&r)), history(&r, 1), rest))
    }

    /// The numbered faces (all when empty) split where sheets swept from curves cross them (see `w3d_imprint`).
    pub fn imprint_with_history(&self, faces: &[usize], data: &[f64], length: f64, extra: &[&Shape]) -> Result<(Shape, ShapeHistory), String> {
        let faces: Vec<i32> = faces.iter().map(|&f| f as i32).collect();
        let extra = Shape::from(crate::primitives::Compound::from_shapes(extra.iter().copied()));
        let r = ffi::w3d::w3d_imprint(&self.inner, &faces, data, length, &extra.inner).map_err(reason)?;
        Ok((Shape::from_shape(&ffi::w3d::w3d_result_shape(&r)), history(&r, 1)))
    }

    /// Imprint Curve Body with its options: the faces split along the curves projected as
    /// [`Shape::project_curves`] projects them, `extend` carrying open curves on past their ends.
    pub fn imprint_projected_with_history(&self, faces: &[usize], data: &[f64], length: f64, both: bool, hide: bool, extend: bool) -> Result<(Shape, ShapeHistory), String> {
        let faces: Vec<i32> = faces.iter().map(|&f| f as i32).collect();
        let r = ffi::w3d::w3d_imprint_projected(&self.inner, &faces, data, length, both, hide, extend).map_err(reason)?;
        Ok((Shape::from_shape(&ffi::w3d::w3d_result_shape(&r)), history(&r, 1)))
    }

    /// Curves projected onto the numbered faces (all when empty), as `w3d_project` writes them:
    /// a count, then each curve as NURBS numbers.
    pub fn project_curves(&self, faces: &[usize], data: &[f64], length: f64, both: bool, hide: bool) -> Result<Vec<f64>, String> {
        let faces: Vec<i32> = faces.iter().map(|&f| f as i32).collect();
        ffi::w3d::w3d_project(&self.inner, &faces, data, length, both, hide).map_err(reason)
    }

    /// The curves where this shape and `other` meet, numbered as for [`Shape::project_curves`].
    pub fn meet_curves(&self, other: &Shape) -> Result<Vec<f64>, String> {
        ffi::w3d::w3d_meet_curves(&self.inner, &other.inner).map_err(reason)
    }

    /// Deform Curve's face coordinates: points to (s, t, n), or back with `map`; the face's lengths along u and v first (see w3d.hxx).
    pub fn face_uvn(&self, face: usize, map: bool, data: &[f64]) -> Result<Vec<f64>, String> {
        ffi::w3d::w3d_face_uvn(&self.inner, face as i32, map, data).map_err(reason)
    }

    /// Align Surface: the faces along edge `edge` and their frames at the points of `data` (see `w3d_edge_faces`).
    pub fn edge_faces(&self, edge: usize, data: &[f64]) -> Result<Vec<f64>, String> {
        ffi::w3d::w3d_edge_faces(&self.inner, edge as i32, data).map_err(reason)
    }

    /// Plasticity's Deform Solid and Sheet: `bodies` wrapped from face `rface` of `reference` onto
    /// face `tface` of `target`; `opts` are scale u v n, offset u v n, then mirror, swap, normal as
    /// 1 or 0, and optionally reblend as 1 or 0 (see `w3d_deform`). The results come back in order.
    pub fn deform(bodies: &[&Shape], reference: &Shape, rface: usize, target: &Shape, tface: usize, opts: &[f64]) -> Result<Vec<Shape>, String> {
        let all = Shape::from(crate::primitives::Compound::from_shapes(bodies.iter().copied()));
        let out = ffi::w3d::w3d_deform(&all.inner, &reference.inner, rface as i32, &target.inner, tface as i32, opts).map_err(reason)?;
        (0..ffi::w3d::w3d_child_count(&out))
            .map(|i| ffi::w3d::w3d_child_at(&out, i).map(|s| Shape::from_shape(&s)).map_err(reason))
            .collect()
    }

    /// The isoparametric curve of a face through a point (see `w3d_isoparam`).
    pub fn isoparam(&self, face: usize, point: [f64; 3], along_u: bool) -> Result<Vec<f64>, String> {
        ffi::w3d::w3d_isoparam(&self.inner, face as i32, &point, along_u).map_err(reason)
    }

    /// The curves where the sheets of two curves meet (see `w3d_project_curve_curve`).
    pub fn project_curve_curve(data: &[f64], length: f64) -> Result<Vec<f64>, String> {
        ffi::w3d::w3d_project_curve_curve(data, length).map_err(reason)
    }

    /// A sheet filling one closed loop of drawn curves and edges of `bodies`, each edge with its
    /// continuity with the body along it (0 none, 1 tangent, 2 curvature; see `w3d_patch`). Edges
    /// are numbered within their own body.
    pub fn patch(data: &[f64], bodies: &[(&Shape, Vec<(usize, u32)>)], tol: f64) -> Result<Shape, String> {
        let all = Shape::from(crate::primitives::Compound::from_shapes(bodies.iter().map(|(s, _)| *s)));
        let (mut edges, mut tangent, mut offset) = (vec![], vec![], 0);
        for (s, picked) in bodies {
            for &(e, t) in picked {
                edges.push((offset + e) as i32);
                tangent.push(t as i32);
            }
            offset += ffi::w3d::w3d_count(&s.inner, false) as usize;
        }
        let sheet = ffi::w3d::w3d_patch(data, &all.inner, &edges, &tangent, tol).map_err(reason)?;
        Ok(Shape::from_shape(&sheet))
    }

    /// Plasticity's Bridge Surface from edge `a` of `sa` to edge `b` of `sb`, tangent to their faces
    /// (see `w3d_bridge_surface`). The shapes may be the same.
    pub fn bridge_surface(sa: &Shape, a: usize, sb: &Shape, b: usize, same: bool, tension: f64) -> Result<Shape, String> {
        let (all, b) = if same {
            (Shape::from(crate::primitives::Compound::from_shapes([sa])), b)
        } else {
            (Shape::from(crate::primitives::Compound::from_shapes([sa, sb])), b + ffi::w3d::w3d_count(&sa.inner, false) as usize)
        };
        let sheet = ffi::w3d::w3d_bridge_surface(&all.inner, a as i32, b as i32, tension).map_err(reason)?;
        Ok(Shape::from_shape(&sheet))
    }

    /// The outline seen along `normal`, drawn on the plane through `origin` (see `w3d_project_outline`).
    pub fn project_outline(&self, origin: DVec3, normal: DVec3, x: DVec3) -> Result<Vec<f64>, String> {
        let plane = [origin.x, origin.y, origin.z, normal.x, normal.y, normal.z, x.x, x.y, x.z];
        ffi::w3d::w3d_project_outline(&self.inner, &plane).map_err(reason)
    }

    /// Plasticity's Thicken: this sheet made solid, `front` along its normals and `back` behind (see `w3d_thicken`).
    pub fn thicken(&self, front: f64, back: f64) -> Result<Shape, String> {
        let solid = ffi::w3d::w3d_thicken(&self.inner, front, back).map_err(reason)?;
        Ok(Shape::from_shape(&solid))
    }

    /// Plasticity's Thicken Face on a solid: `faces` made a solid of their own (see `w3d_thicken_faces`).
    pub fn thicken_faces(&self, faces: &[usize], front: f64, back: f64) -> Result<Shape, String> {
        let faces: Vec<i32> = faces.iter().map(|&f| f as i32).collect();
        let solid = ffi::w3d::w3d_thicken_faces(&self.inner, &faces, front, back).map_err(reason)?;
        Ok(Shape::from_shape(&solid))
    }

    /// Plasticity's Rebuild Face: `faces` given new B-spline surfaces (see `w3d_rebuild_faces` for `p`).
    pub fn rebuild_faces(&self, faces: &[usize], p: &[f64; 9]) -> Result<Shape, String> {
        let faces: Vec<i32> = faces.iter().map(|&f| f as i32).collect();
        let shape = ffi::w3d::w3d_rebuild_faces(&self.inner, &faces, p).map_err(reason)?;
        Ok(Shape::from_shape(&shape))
    }

    /// Plasticity's Raise Surface Degree: `faces` with their U and V degree raised by one.
    pub fn raise_faces(&self, faces: &[usize]) -> Result<Shape, String> {
        let faces: Vec<i32> = faces.iter().map(|&f| f as i32).collect();
        let shape = ffi::w3d::w3d_raise_faces(&self.inner, &faces).map_err(reason)?;
        Ok(Shape::from_shape(&shape))
    }

    /// Plasticity's Match Face: `faces` of this solid replaced by the surface of `target`'s face `tface`.
    pub fn match_faces(&self, faces: &[usize], target: &Shape, tface: usize, caps: &[f64]) -> Result<Shape, String> {
        let faces: Vec<i32> = faces.iter().map(|&f| f as i32).collect();
        let shape = ffi::w3d::w3d_match_faces(&self.inner, &faces, &target.inner, tface as i32, caps).map_err(reason)?;
        Ok(Shape::from_shape(&shape))
    }

    /// Offset Edge on any faces: the faces either side of `edges` on side `side` (0, 1, or 2 for both).
    pub fn offset_edge_faces(&self, edges: &[usize], side: i32) -> Result<Vec<usize>, String> {
        let edges: Vec<i32> = edges.iter().map(|&e| e as i32).collect();
        Ok(ffi::w3d::w3d_offset_edge_faces(&self.inner, &edges, side).map_err(reason)?.iter().map(|&f| f as usize).collect())
    }

    /// The tube of radius `d` round `edges` whose meeting with the faces is Offset Edge's offset.
    pub fn edge_tube(&self, edges: &[usize], d: f64) -> Result<Shape, String> {
        let edges: Vec<i32> = edges.iter().map(|&e| e as i32).collect();
        let tube = ffi::w3d::w3d_edge_tube(&self.inner, &edges, d).map_err(reason)?;
        Ok(Shape::from_shape(&tube))
    }

    /// Plasticity's Conic (`kind` 2) and G2 (3) fillet shapes on the round `faces` (see `w3d_reshape_fillets`).
    pub fn reshape_fillets(&self, faces: &[usize], kind: i32, tension: f64) -> Result<Shape, String> {
        let faces: Vec<i32> = faces.iter().map(|&f| f as i32).collect();
        let shape = ffi::w3d::w3d_reshape_fillets(&self.inner, &faces, kind, tension).map_err(reason)?;
        Ok(Shape::from_shape(&shape))
    }

    /// The solid's exact volume, from its surfaces rather than a mesh.
    pub fn exact_volume(&self) -> Result<f64, String> {
        ffi::w3d::w3d_volume(&self.inner).map_err(reason)
    }

    /// What `rounded` took off this body, between two planes (see `w3d_round_piece`).
    pub fn round_piece(&self, rounded: &Shape, planes: &[f64]) -> Result<Shape, String> {
        let piece = ffi::w3d::w3d_round_piece(&self.inner, &rounded.inner, planes).map_err(reason)?;
        Ok(Shape::from_shape(&piece))
    }

    /// Plasticity's Unwrap Face: face `face` laid flat on the XY plane (see `w3d_unwrap_face`).
    pub fn unwrap_face(&self, face: usize) -> Result<Shape, String> {
        let shape = ffi::w3d::w3d_unwrap_face(&self.inner, face as i32).map_err(reason)?;
        Ok(Shape::from_shape(&shape))
    }

    /// Plasticity's Untrim: a sheet of the whole surface under face `face`, with its edges
    /// imprinted when `keep`.
    pub fn untrim_face(&self, face: usize, keep: bool) -> Result<Shape, String> {
        let shape = ffi::w3d::w3d_untrim_face(&self.inner, face as i32, keep).map_err(reason)?;
        Ok(Shape::from_shape(&shape))
    }

    /// `n + 1` samples along edge `edge`: point, unit direction away from the bend, curvature.
    pub fn edge_curvature(&self, edge: usize, n: usize) -> Result<Vec<([f64; 3], [f64; 3], f64)>, String> {
        let v = ffi::w3d::w3d_edge_curvature(&self.inner, edge as i32, n as i32).map_err(reason)?;
        Ok(v.chunks_exact(7).map(|s| ([s[0], s[1], s[2]], [s[3], s[4], s[5]], s[6])).collect())
    }

    /// How far `other`'s face `face` strays from this shape's, at the same surface parameters.
    pub fn face_deviation(&self, other: &Shape, face: usize) -> Result<f64, String> {
        ffi::w3d::w3d_face_deviation(&self.inner, &other.inner, face as i32).map_err(reason)
    }

    /// Face `face`'s surface as [degree u, degree v, poles u, poles v], or None if not a B-spline.
    pub fn face_spline(&self, face: usize) -> Result<Option<[u32; 4]>, String> {
        let v = ffi::w3d::w3d_face_spline(&self.inner, face as i32).map_err(reason)?;
        Ok(if v[0] < 0 { None } else { Some([v[0] as u32, v[1] as u32, v[2] as u32, v[3] as u32]) })
    }

    /// Plasticity's Extend Sheet: this sheet grown `distance` past its open edge `edge`; `kind` is 0
    /// Linear, 1 Natural, 2 Soft or 3 Reflective (see `w3d_extend_sheet`).
    pub fn extend_sheet(&self, edge: usize, distance: f64, kind: i32) -> Result<Shape, String> {
        let sheet = ffi::w3d::w3d_extend_sheet(&self.inner, edge as i32, distance, kind).map_err(reason)?;
        Ok(Shape::from_shape(&sheet))
    }

    /// Extend Sheet's Limit: this sheet carried on past `edge` in shape `kind` until it meets `target`.
    pub fn extend_sheet_to(&self, edge: usize, target: &Shape, kind: i32, through: bool) -> Result<Shape, String> {
        let sheet = ffi::w3d::w3d_extend_sheet_to(&self.inner, edge as i32, &target.inner, kind, through).map_err(reason)?;
        Ok(Shape::from_shape(&sheet))
    }

    /// Plasticity's SVG and DXF export: the hidden-line drawing of `shapes` seen along `toward`
    /// (pointing at the viewer), as [kind, n, x, y, ...] runs in the drawing's x, y (see `w3d_hidden_lines`).
    pub fn hidden_lines(shapes: &[&Shape], origin: DVec3, toward: DVec3, x: DVec3, deflection: f64) -> Result<Vec<f64>, String> {
        let all = Shape::from(crate::primitives::Compound::from_shapes(shapes.iter().copied()));
        let frame = [origin.x, origin.y, origin.z, toward.x, toward.y, toward.z, x.x, x.y, x.z];
        ffi::w3d::w3d_hidden_lines(&all.inner, &frame, deflection).map_err(reason)
    }

    /// Plasticity's Join for sheets: `sheets` sewn into one body within `tol`; closed, a solid (see `w3d_join_sheets`).
    pub fn join_sheets(sheets: &[&Shape], tol: f64) -> Result<Shape, String> {
        let all = Shape::from(crate::primitives::Compound::from_shapes(sheets.iter().copied()));
        let joined = ffi::w3d::w3d_join_sheets(&all.inner, tol).map_err(reason)?;
        Ok(Shape::from_shape(&joined))
    }

    /// Plasticity's Bridge Surface between crossing sheets `a` and `b` (see `w3d_sheet_fillet`): the
    /// new first sheet, second sheet and bridge body, each `None` where there is none.
    pub fn sheet_fillet(a: &Shape, b: &Shape, width: f64, chamfer: bool, sense: [bool; 2], trim: i32) -> Result<[Option<Shape>; 3], String> {
        let all = Shape::from(crate::primitives::Compound::from_shapes([a, b]));
        let out = ffi::w3d::w3d_sheet_fillet(&all.inner, width, chamfer, sense[0], sense[1], trim).map_err(reason)?;
        let piece = |i: i32| -> Result<Option<Shape>, String> {
            let s = ffi::w3d::w3d_child_at(&out, i).map_err(reason)?;
            Ok(if ffi::w3d::w3d_child_count(&s) == 0 { None } else { Some(Shape::from_shape(&s)) })
        };
        Ok([piece(0)?, piece(1)?, piece(2)?])
    }

    /// Plasticity's Unjoin: each face as a sheet (`faces`), or each separate shell or solid (see `w3d_unjoin`).
    pub fn unjoin(&self, faces: bool) -> Result<Vec<Shape>, String> {
        let all = ffi::w3d::w3d_unjoin(&self.inner, faces).map_err(reason)?;
        (0..ffi::w3d::w3d_child_count(&all))
            .map(|i| ffi::w3d::w3d_child_at(&all, i).map(|s| Shape::from_shape(&s)).map_err(reason))
            .collect()
    }

    /// Whether the shape holds no solid: a sheet of faces, as Patch makes.
    pub fn is_sheet(&self) -> bool { ffi::w3d::w3d_solid_count(&self.inner) == 0 }

    /// Face `index` as a cutting tool grown `size` past the body (see `w3d_face_sheet`).
    pub fn face_sheet(&self, index: usize, size: f64) -> Result<Shape, String> {
        let sheet = ffi::w3d::w3d_face_sheet(&self.inner, index as i32, size).map_err(reason)?;
        Ok(Shape::from_shape(&sheet))
    }

    /// The plane through `origin` with `normal` as a square sheet `size` each way.
    pub fn plane_sheet(origin: DVec3, normal: DVec3, size: f64) -> Result<Shape, String> {
        let plane = [origin.x, origin.y, origin.z, normal.x, normal.y, normal.z];
        let sheet = ffi::w3d::w3d_plane_sheet(&plane, size).map_err(reason)?;
        Ok(Shape::from_shape(&sheet))
    }

    /// A sheet of one B-spline surface given as numbers (see `w3d_spline_sheet`).
    pub fn spline_sheet(data: &[f64]) -> Result<Shape, String> {
        let sheet = ffi::w3d::w3d_spline_sheet(data).map_err(reason)?;
        Ok(Shape::from_shape(&sheet))
    }

    /// The numbered faces drafted by `angle` radians about the neutral plane through `origin` square to `pull`.
    pub fn draft_faces_with_history(&self, faces: &[usize], pull: DVec3, origin: DVec3, angle: f64) -> Result<(Shape, ShapeHistory), String> {
        let faces: Vec<i32> = faces.iter().map(|&f| f as i32).collect();
        let frame = [pull.x, pull.y, pull.z, origin.x, origin.y, origin.z];
        let r = ffi::w3d::w3d_draft_faces(&self.inner, &faces, &frame, angle).map_err(reason)?;
        Ok((Shape::from_shape(&ffi::w3d::w3d_result_shape(&r)), history(&r, 1)))
    }

    /// A copy reflected in the plane through `origin` with normal `normal`.
    pub fn mirrored_in_plane(&self, origin: DVec3, normal: DVec3) -> Result<Shape, String> {
        let plane = [origin.x, origin.y, origin.z, normal.x, normal.y, normal.z];
        let s = ffi::w3d::w3d_mirror(&self.inner, &plane).map_err(reason)?;
        Ok(Shape::from_shape(&s))
    }
}

fn parse_blend_error(msg: &str) -> BlendError {
    match msg.strip_prefix("BLEND|").and_then(|m| m.split_once('|')) {
        Some((list, reason)) => BlendError {
            edges: list.split(',').filter_map(|n| n.parse().ok()).collect(),
            reason: reason.to_string(),
        },
        None => BlendError { edges: vec![], reason: msg.to_string() },
    }
}
