//! Witness 3D additions to `Shape`: numbered edges and faces, fillet and chamfer that report
//! failure instead of aborting, a validity check, and BREP text I/O. See vendor/README.md.

use super::{Edge, Face, Shape};
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

    /// Round (`chamfer == false`) or bevel the numbered edges by `size`.
    pub fn blend_edges(&self, edges: &[usize], size: f64, chamfer: bool) -> Result<Shape, BlendError> {
        let ids: Vec<i32> = edges.iter().map(|&e| e as i32).collect();
        match ffi::w3d::w3d_blend_edges(&self.inner, &ids, size, chamfer) {
            Ok(shape) => Ok(Shape::from_shape(&shape)),
            Err(e) => {
                let msg = e.what().to_string();
                match msg.strip_prefix("BLEND|").and_then(|m| m.split_once('|')) {
                    Some((list, reason)) => Err(BlendError {
                        edges: list.split(',').filter_map(|n| n.parse().ok()).collect(),
                        reason: reason.to_string(),
                    }),
                    None => Err(BlendError { edges: vec![], reason: msg }),
                }
            }
        }
    }

    /// Whether OpenCascade's checker finds the shape's topology and geometry consistent.
    pub fn is_valid(&self) -> bool { ffi::w3d::w3d_is_valid(&self.inner) }

    /// The exact shape as OpenCascade BREP text.
    pub fn to_brep_text(&self) -> Result<String, crate::Error> {
        ffi::w3d::w3d_write_brep(&self.inner).map_err(|_| crate::Error::BrepWriteFailed)
    }

    pub fn from_brep_text(text: &str) -> Result<Shape, crate::Error> {
        let s = ffi::w3d::w3d_read_brep(text).map_err(|_| crate::Error::BrepReadFailed)?;
        Ok(Shape::from_shape(&s))
    }
}
