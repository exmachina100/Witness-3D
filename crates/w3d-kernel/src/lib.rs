//! Witness 3D modeling core.
//!
//! Plasticity splits a modeler into commands, factories and a geometry kernel (C3D, linked as a
//! native addon in nkallen/plasticity `src/kernel/kernel.ts:1`). This crate keeps that split, in
//! Rust: [`Kernel`] is the only place geometry is computed, so OpenCascade today ([`occt::Occt`])
//! can be swapped for a pure-Rust kernel later without touching the tools built on top.

use glam::DVec3;

pub mod document;
pub mod engine;
pub mod extrude;
#[cfg(feature = "occt")]
pub mod occt;

pub use extrude::{extrude, ExtrudeParams, ExtrudeResult, Operation};

/// A closed 2D profile, drawn in a sketch plane.
#[derive(Clone, Debug, PartialEq)]
pub enum Profile {
    /// Corner points in plane coordinates, in order; the last connects back to the first.
    Polygon(Vec<(f64, f64)>),
    /// An exact circle around (x, y).
    Circle { center: (f64, f64), radius: f64 },
}

impl Profile {
    pub fn rectangle(width: f64, height: f64) -> Self {
        let (w, h) = (width / 2.0, height / 2.0);
        Profile::Polygon(vec![(-w, -h), (w, -h), (w, h), (-w, h)])
    }
}

/// A sketch plane: origin, in-plane x axis, and normal (the extrude direction).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Frame {
    pub origin: DVec3,
    pub x: DVec3,
    pub normal: DVec3,
}

impl Frame {
    pub fn new(origin: DVec3, x: DVec3, normal: DVec3) -> Self {
        let normal = normal.normalize();
        let x = (x - normal * x.dot(normal)).normalize();
        Frame { origin, x, normal }
    }
    pub fn y(&self) -> DVec3 { self.normal.cross(self.x) }
    pub fn point(&self, (u, v): (f64, f64)) -> DVec3 { self.origin + self.x * u + self.y() * v }
}

/// A triangle mesh for display, plus the solid's true edges as polylines.
#[derive(Clone, Debug, Default)]
pub struct Tessellation {
    pub positions: Vec<[f64; 3]>,
    pub indices: Vec<u32>,
    /// For each triangle, the index of the B-rep face it belongs to, so a click picks a face.
    pub face_ids: Vec<u32>,
    /// For each face, its plane when it is flat: the faces a sketch can be drawn on.
    pub face_planes: Vec<Option<Plane>>,
    pub edges: Vec<Vec<[f64; 3]>>,
}

/// A point on a flat face and its outward normal.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Plane {
    pub origin: DVec3,
    pub normal: DVec3,
}

impl Tessellation {
    /// Enclosed volume by the divergence theorem; exact for planar solids, close for curved ones.
    pub fn volume(&self) -> f64 {
        self.indices.chunks_exact(3).map(|t| {
            let [a, b, c] = [t[0], t[1], t[2]].map(|i| DVec3::from_array(self.positions[i as usize]));
            a.dot(b.cross(c)) / 6.0
        }).sum()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum KernelError {
    #[error("operation has no effect")]
    NoOp,
    #[error("invalid input: {0}")]
    Invalid(&'static str),
    #[error("kernel failure: {0}")]
    Failed(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BooleanOp { Union, Difference, Intersection }

/// Everything a modeling tool may ask of geometry. One implementation per kernel.
pub trait Kernel {
    type Solid;

    fn box_from_corners(&self, a: DVec3, b: DVec3) -> Self::Solid;
    /// Sweep `profile` along the frame normal by `distance` (negative goes backwards).
    fn extrude(&self, profile: &Profile, frame: &Frame, distance: f64) -> Result<Self::Solid, KernelError>;
    /// The boolean result, with coplanar faces merged.
    fn boolean(&self, a: &Self::Solid, b: &Self::Solid, op: BooleanOp) -> Result<Self::Solid, KernelError>;
    /// Number of disconnected solids in the shape.
    fn solid_count(&self, s: &Self::Solid) -> usize;
    fn face_count(&self, s: &Self::Solid) -> usize;
    fn tessellate(&self, s: &Self::Solid, tolerance: f64) -> Result<Tessellation, KernelError>;
    fn write_step(&self, s: &Self::Solid, path: &std::path::Path) -> Result<(), KernelError>;
}
