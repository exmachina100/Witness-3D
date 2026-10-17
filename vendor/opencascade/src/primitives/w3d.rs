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
    pub fn blend_edges_with_history(&self, edges: &[usize], size: f64, chamfer: bool, angle: f64) -> Result<(Shape, ShapeHistory), BlendError> {
        let ids: Vec<i32> = edges.iter().map(|&e| e as i32).collect();
        match ffi::w3d::w3d_blend_edges_history(&self.inner, &ids, size, chamfer, angle) {
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

    /// The curves where the sheets of two curves meet (see `w3d_project_curve_curve`).
    pub fn project_curve_curve(data: &[f64], length: f64) -> Result<Vec<f64>, String> {
        ffi::w3d::w3d_project_curve_curve(data, length).map_err(reason)
    }

    /// A sheet filling one closed loop of drawn curves and edges of `bodies`, each edge with
    /// whether the sheet leaves it tangent to the body (see `w3d_patch`). Edges are numbered within
    /// their own body.
    pub fn patch(data: &[f64], bodies: &[(&Shape, Vec<(usize, bool)>)], tol: f64) -> Result<Shape, String> {
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
