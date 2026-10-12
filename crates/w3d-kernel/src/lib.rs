//! Witness 3D modeling core.
//!
//! Plasticity splits a modeler into commands, factories and a geometry kernel (C3D, linked as a
//! native addon in nkallen/plasticity `src/kernel/kernel.ts:1`). This crate keeps that split, in
//! Rust: [`Kernel`] is the only place geometry is computed, so OpenCascade today ([`occt::Occt`])
//! can be swapped for a pure-Rust kernel later without touching the tools built on top.

use glam::DVec3;

pub mod blend;
pub mod document;
pub mod engine;
pub mod extrude;
pub mod file;
#[cfg(feature = "occt")]
pub mod occt;

pub use blend::{blend, Blend, BlendParams};
pub use document::{Ref, Refs};
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
    /// The true edges as polylines. The index is the edge's number: what a click on an edge
    /// selects and what [`Kernel::blend`] takes.
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
    /// A fillet or chamfer the kernel could not build, with the edges it names (maybe none).
    #[error("{reason}")]
    Blend { edges: Vec<u32>, reason: String },
    #[error("{0}")]
    File(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BooleanOp { Union, Difference, Intersection }

/// Where an operation's result faces and edges came from, by number (see [`Tessellation`]).
/// `faces[k]` and `edges[k]` hold (number in input k, number in the result) pairs: input 0 is the
/// body being changed, input 1 the tool of a boolean. A split source appears once per piece.
/// `generated_faces` holds (input edge, result face) for faces grown from an edge, like a round.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct History {
    pub faces: [Vec<(u32, u32)>; 2],
    pub edges: [Vec<(u32, u32)>; 2],
    pub generated_faces: Vec<(u32, u32)>,
}

/// A solid together with the [`History`] of the operation that made it.
#[derive(Clone, Debug)]
pub struct Traced<S> {
    pub solid: S,
    pub history: History,
}

/// A rigid motion: rotate by `angle` radians about `axis` through `pivot`, then move by `offset`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Motion {
    pub offset: DVec3,
    pub pivot: DVec3,
    pub axis: DVec3,
    pub angle: f64,
}

impl Motion {
    pub fn translation(offset: DVec3) -> Self { Motion { offset, pivot: DVec3::ZERO, axis: DVec3::Y, angle: 0.0 } }
    pub fn rotation(pivot: DVec3, axis: DVec3, angle: f64) -> Self { Motion { offset: DVec3::ZERO, pivot, axis, angle } }
    pub fn is_identity(&self) -> bool { self.offset.length() < 1e-12 && self.angle.abs() < 1e-12 }
    /// Where the motion takes point `p`.
    pub fn apply(&self, p: DVec3) -> DVec3 {
        let q = if self.angle == 0.0 { p } else {
            glam::DQuat::from_axis_angle(self.axis.normalize(), self.angle) * (p - self.pivot) + self.pivot
        };
        q + self.offset
    }
}

/// Everything a modeling tool may ask of geometry. One implementation per kernel.
pub trait Kernel {
    type Solid;

    fn box_from_corners(&self, a: DVec3, b: DVec3) -> Self::Solid;
    /// Sweep `profile` along the frame normal by `distance` (negative goes backwards).
    fn extrude(&self, profile: &Profile, frame: &Frame, distance: f64) -> Result<Self::Solid, KernelError>;
    /// The boolean result, with coplanar faces merged, and where its faces and edges came from.
    fn boolean(&self, a: &Self::Solid, b: &Self::Solid, op: BooleanOp) -> Result<Traced<Self::Solid>, KernelError>;
    /// Number of disconnected solids in the shape.
    fn solid_count(&self, s: &Self::Solid) -> usize;
    fn face_count(&self, s: &Self::Solid) -> usize;
    fn edge_count(&self, s: &Self::Solid) -> usize;
    /// Round or bevel the numbered edges (see [`Tessellation::edges`]) by `size`.
    fn blend(&self, s: &Self::Solid, edges: &[u32], size: f64, kind: Blend) -> Result<Traced<Self::Solid>, KernelError>;
    /// The solid moved rigidly. Faces and edges keep their numbers.
    fn transform(&self, s: &Self::Solid, m: &Motion) -> Self::Solid;
    /// Whether the kernel's own checker accepts the shape.
    fn is_valid(&self, s: &Self::Solid) -> bool;
    fn tessellate(&self, s: &Self::Solid, tolerance: f64) -> Result<Tessellation, KernelError>;
    fn write_step(&self, s: &Self::Solid, path: &std::path::Path) -> Result<(), KernelError>;
    fn read_step(&self, path: &std::path::Path) -> Result<Self::Solid, KernelError>;
    /// The exact shape in the kernel's own text format, for the native file.
    /// Names the format [`Kernel::to_native`] writes, so a file is only read by a kernel that can.
    fn native_format(&self) -> &'static str;
    fn to_native(&self, s: &Self::Solid) -> Result<String, KernelError>;
    fn from_native(&self, text: &str) -> Result<Self::Solid, KernelError>;
}
