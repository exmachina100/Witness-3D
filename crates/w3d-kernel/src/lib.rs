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
pub mod form;
pub mod solids;
#[cfg(feature = "occt")]
pub mod occt;

pub use blend::{blend, Blend, BlendParams};
pub use document::{Ref, Refs};
pub use extrude::{extrude, ExtrudeParams, ExtrudeResult, Operation};
pub use form::{form, offset_faces, FormKind, FormParams};
pub use solids::{ArraySpec, Primitive};
pub use document::{Curve, CurveId, CurveShape};
pub mod join;

/// A closed 2D profile, drawn in a sketch plane.
#[derive(Clone, Debug, PartialEq)]
pub enum Profile {
    /// Corner points in plane coordinates, in order; the last connects back to the first.
    Polygon(Vec<(f64, f64)>),
    /// An exact circle around (x, y).
    Circle { center: (f64, f64), radius: f64 },
    /// A smooth closed curve through the points, in order (Plasticity's Spline Curve, closed).
    Spline(Vec<(f64, f64)>),
    /// An ellipse around `center` with radius `|major|` along `major` and `minor` across it.
    Ellipse { center: (f64, f64), major: (f64, f64), minor: f64 },
    /// Pieces joined end to end into a loop (Plasticity's Join Curves).
    Contour(Vec<Segment>),
    /// A closed control-point curve (Plasticity's Control Point Curve).
    Cv(Vec<(f64, f64)>),
    /// A closed NURBS curve, its first and last poles the same (a projected loop lying flat).
    Nurbs { degree: usize, poles: Vec<(f64, f64)>, weights: Vec<f64>, knots: Vec<f64> },
}

/// One open piece of a [`Profile::Contour`], in plane coordinates.
#[derive(Clone, Debug, PartialEq)]
pub enum Segment {
    /// Straight lines through the points.
    Line(Vec<(f64, f64)>),
    /// A circular arc from the first point through the second to the third.
    Arc((f64, f64), (f64, f64), (f64, f64)),
    /// A smooth curve through the points.
    Spline(Vec<(f64, f64)>),
}

impl Profile {
    pub fn rectangle(width: f64, height: f64) -> Self {
        let (w, h) = (width / 2.0, height / 2.0);
        Profile::Polygon(vec![(-w, -h), (w, -h), (w, h), (-w, h)])
    }
}

/// A path to sweep along, in model coordinates.
#[derive(Clone, Debug, PartialEq)]
pub enum Path {
    Polyline { points: Vec<DVec3>, closed: bool },
    Circle { center: DVec3, normal: DVec3, radius: f64 },
    /// A smooth curve through the points.
    Spline { points: Vec<DVec3>, closed: bool },
    /// A circular arc from `start` through `mid` to `end`.
    Arc { start: DVec3, mid: DVec3, end: DVec3 },
    /// An ellipse with radius `|major|` along `major` and `minor` across it.
    Ellipse { center: DVec3, normal: DVec3, major: DVec3, minor: f64 },
    /// Open pieces joined end to end.
    Contour(Vec<Path>),
    /// A helix up `axis` from `origin`, starting towards `x`: `turns` turns of `radius` over
    /// `length`, anticlockwise about the axis unless `left`.
    Spiral { origin: DVec3, axis: DVec3, x: DVec3, radius: f64, length: f64, turns: f64, left: bool },
    /// A control-point curve: a uniform B-spline shaped by these points, clamped to its ends when open.
    Cv { points: Vec<DVec3>, closed: bool },
    /// A NURBS curve: `poles.len() + degree + 1` knots, repeated as often as they occur, and a
    /// weight per pole. What Project makes.
    Nurbs { degree: usize, poles: Vec<DVec3>, weights: Vec<f64>, knots: Vec<f64> },
}

/// How far and in what form an extrude goes (Plasticity's Extrude options).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Extent {
    /// Along the normal; negative goes backwards.
    pub distance: f64,
    /// The other way as well, at least zero (S locks it to `distance`).
    pub back: f64,
    /// Radians the sides lean in going away from the profile (A); negative leans out.
    pub angle: f64,
    /// Walls this thick inside the outline instead of a filled solid (Shift+T); zero for solid.
    pub thickness: f64,
}

impl Extent {
    pub fn to(distance: f64) -> Self { Extent { distance, back: 0.0, angle: 0.0, thickness: 0.0 } }
    pub fn is_plain(&self) -> bool { self.back.abs() < 1e-12 && self.angle.abs() < 1e-12 && self.thickness.abs() < 1e-12 }
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
    /// The kernel could not build the shape, in a sentence for the user.
    #[error("{0}")]
    Refused(String),
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

/// A similarity motion about `pivot`: scale by `scale`, rotate by `angle` radians about `axis`,
/// then move by `offset`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Motion {
    pub offset: DVec3,
    pub pivot: DVec3,
    pub axis: DVec3,
    pub angle: f64,
    pub scale: f64,
}

impl Motion {
    pub fn translation(offset: DVec3) -> Self { Motion { offset, pivot: DVec3::ZERO, axis: DVec3::Y, angle: 0.0, scale: 1.0 } }
    pub fn rotation(pivot: DVec3, axis: DVec3, angle: f64) -> Self { Motion { offset: DVec3::ZERO, pivot, axis, angle, scale: 1.0 } }
    pub fn scaling(pivot: DVec3, scale: f64) -> Self { Motion { offset: DVec3::ZERO, pivot, axis: DVec3::Y, angle: 0.0, scale } }
    pub fn is_identity(&self) -> bool {
        self.offset.length() < 1e-12 && self.angle.abs() < 1e-12 && (self.scale - 1.0).abs() < 1e-12
    }
    /// Where the motion takes point `p`.
    pub fn apply(&self, p: DVec3) -> DVec3 {
        let mut q = (p - self.pivot) * self.scale;
        if self.angle != 0.0 { q = glam::DQuat::from_axis_angle(self.axis.normalize(), self.angle) * q }
        q + self.pivot + self.offset
    }
}

/// Everything a modeling tool may ask of geometry. One implementation per kernel.
pub trait Kernel {
    type Solid;

    fn box_from_corners(&self, a: DVec3, b: DVec3) -> Self::Solid;
    /// Sweep `profile` along the frame normal as `extent` says (a negative distance goes backwards).
    fn extrude(&self, profile: &Profile, frame: &Frame, extent: &Extent) -> Result<Self::Solid, KernelError>;
    /// Sweep the numbered face of `s` along its outward normal as `extent` says (negative goes in).
    fn extrude_face(&self, s: &Self::Solid, face: u32, extent: &Extent) -> Result<Self::Solid, KernelError>;
    /// The boolean result, with coplanar faces merged, and where its faces and edges came from.
    fn boolean(&self, a: &Self::Solid, b: &Self::Solid, op: BooleanOp) -> Result<Traced<Self::Solid>, KernelError>;
    /// Whether the shape is a sheet: faces that enclose no solid, as Patch makes.
    fn is_sheet(&self, _s: &Self::Solid) -> bool { false }
    /// Number of disconnected solids in the shape.
    fn solid_count(&self, s: &Self::Solid) -> usize;
    fn face_count(&self, s: &Self::Solid) -> usize;
    fn edge_count(&self, s: &Self::Solid) -> usize;
    /// Round or bevel the numbered edges (see [`Tessellation::edges`]) by `size`. A chamfer's
    /// `angle` (radians) is measured from each edge's first face; π/4 gives equal distances.
    fn blend(&self, s: &Self::Solid, edges: &[u32], size: f64, kind: Blend, angle: f64) -> Result<Traced<Self::Solid>, KernelError>;
    /// The solid moved rigidly. Faces and edges keep their numbers.
    fn transform(&self, s: &Self::Solid, m: &Motion) -> Self::Solid;
    /// `profile` turned `angle` radians about the axis through `axis_point` along `axis_dir`; with a
    /// `thickness`, only walls that thick inside its outline.
    fn revolve(&self, _profile: &Profile, _frame: &Frame, _axis_point: DVec3, _axis_dir: DVec3, _angle: f64, _thickness: f64) -> Result<Self::Solid, KernelError> {
        Err(KernelError::Invalid("this kernel cannot revolve"))
    }
    /// A solid through the profiles, in order.
    fn loft(&self, _sections: &[(Profile, Frame)]) -> Result<Self::Solid, KernelError> {
        Err(KernelError::Invalid("this kernel cannot loft"))
    }
    /// `profile` swept along `path`; the far end turned by `twist` radians and scaled by `scale`.
    fn sweep(&self, _profile: &Profile, _frame: &Frame, _path: &Path, _twist: f64, _scale: f64) -> Result<Self::Solid, KernelError> {
        Err(KernelError::Invalid("this kernel cannot sweep"))
    }
    /// The numbered faces moved `distance` along their outward normals, the faces around them
    /// stretching to meet them (Plasticity's Offset Face).
    fn offset_faces(&self, _s: &Self::Solid, _faces: &[u32], _distance: f64, _angle: f64) -> Result<Traced<Self::Solid>, KernelError> {
        Err(KernelError::Invalid("this kernel cannot offset faces"))
    }
    /// Hollowed to walls `thickness` thick inside the outer surface, open at the numbered faces
    /// (Plasticity's Shell). The outer faces and edges are traced; the inner walls are new.
    fn shell(&self, _s: &Self::Solid, _faces: &[u32], _thickness: f64) -> Result<Traced<Self::Solid>, KernelError> {
        Err(KernelError::Invalid("this kernel cannot shell"))
    }
    /// Plasticity's Cut: the solid split by sheets swept `length` both ways from each path along its
    /// normal. The biggest piece, traced, and the others.
    /// `extra` are further tools: sheets from `face_sheet` or `plane_sheet`, or solids.
    fn cut(&self, _s: &Self::Solid, _cutters: &[(Path, DVec3)], _extra: &[&Self::Solid], _length: f64) -> Result<(Traced<Self::Solid>, Vec<Self::Solid>), KernelError> {
        Err(KernelError::Invalid("this kernel cannot cut"))
    }
    /// Plasticity's Imprint: the numbered faces (every face when empty) split where the sheets of
    /// `cutters` (as for `cut`) cross them. The solid stays whole.
    fn imprint(&self, _s: &Self::Solid, _faces: &[u32], _cutters: &[(Path, DVec3)], _extra: &[&Self::Solid], _length: f64) -> Result<Traced<Self::Solid>, KernelError> {
        Err(KernelError::Invalid("this kernel cannot imprint"))
    }
    /// Plasticity's Project Curve Body: each path carried along its direction, `length` forwards
    /// (and backwards as well when `both`), onto the numbered faces (all when empty). With `hide`,
    /// only the parts seen looking along the direction from the curve. The curves it leaves there.
    fn project(&self, _s: &Self::Solid, _faces: &[u32], _curves: &[(Path, DVec3)], _length: f64, _both: bool, _hide: bool) -> Result<Vec<Path>, KernelError> {
        Err(KernelError::Invalid("this kernel cannot project curves"))
    }
    /// Plasticity's Project Body Body: the curves where two bodies meet.
    fn meet(&self, _a: &Self::Solid, _b: &Self::Solid) -> Result<Vec<Path>, KernelError> {
        Err(KernelError::Invalid("this kernel cannot project bodies"))
    }
    /// Plasticity's Project Curve Curve: where the sheets of two curves, each swept `length` both
    /// ways along its direction, meet.
    fn project_curve_curve(&self, _a: &(Path, DVec3), _b: &(Path, DVec3), _length: f64) -> Result<Vec<Path>, KernelError> {
        Err(KernelError::Invalid("this kernel cannot project curves"))
    }
    /// A face as a cutting tool grown `size` past the body: a plane, a whole cylinder, or the face itself.
        /// Plasticity's Project Outline: the outline of the body seen along the plane's normal, drawn on
    /// the plane (`x` fixes its axes), holes through the body included.
    fn project_outline(&self, _s: &Self::Solid, _origin: DVec3, _normal: DVec3, _x: DVec3) -> Result<Vec<Path>, KernelError> {
        Err(KernelError::Invalid("this kernel cannot project outlines"))
    }
    /// Plasticity's Bridge Surface: a sheet from edge `a` of one body to edge `b` of another (or the
    /// same), tangent to their faces; `tension` 1 is a smooth cubic, more carries each side further.
    fn bridge_surface(&self, _a: (&Self::Solid, u32), _b: (&Self::Solid, u32), _same: bool, _tension: f64) -> Result<Self::Solid, KernelError> {
        Err(KernelError::Invalid("this kernel cannot bridge surfaces"))
    }
    /// Plasticity's Patch: a sheet filling one closed loop of `curves` and edges of bodies, each
    /// edge with whether the sheet leaves it tangent to the body. Flat loops give the exact plane.
    fn patch(&self, _curves: &[Path], _edges: &[(&Self::Solid, Vec<(u32, bool)>)]) -> Result<Self::Solid, KernelError> {
        Err(KernelError::Invalid("this kernel cannot patch"))
    }
    fn face_sheet(&self, _s: &Self::Solid, _face: u32, _size: f64) -> Result<Self::Solid, KernelError> {
        Err(KernelError::Invalid("this kernel cannot cut with faces"))
    }
    /// A plane as a cutting tool, a square `size` each way.
    fn plane_sheet(&self, _origin: DVec3, _normal: DVec3, _size: f64) -> Result<Self::Solid, KernelError> {
        Err(KernelError::Invalid("this kernel cannot cut with planes"))
    }
    /// Plasticity's Draft Face: the numbered faces tilted by `angle` radians about the neutral plane
    /// through `origin` square to `pull`; positive closes them in along the pull.
    fn draft_faces(&self, _s: &Self::Solid, _faces: &[u32], _pull: DVec3, _origin: DVec3, _angle: f64) -> Result<Traced<Self::Solid>, KernelError> {
        Err(KernelError::Invalid("this kernel cannot draft faces"))
    }
    /// The numbered faces deleted and the gap closed by the faces around them (Remove Face).
    fn remove_faces(&self, _s: &Self::Solid, _faces: &[u32]) -> Result<Traced<Self::Solid>, KernelError> {
        Err(KernelError::Invalid("this kernel cannot remove faces"))
    }
    /// A copy reflected in the plane through `origin` with normal `normal`.
    fn mirror(&self, _s: &Self::Solid, _origin: DVec3, _normal: DVec3) -> Result<Self::Solid, KernelError> {
        Err(KernelError::Invalid("this kernel cannot mirror"))
    }
    /// A ball of `radius` around `center`.
    fn sphere(&self, _center: DVec3, _radius: f64) -> Result<Self::Solid, KernelError> {
        Err(KernelError::Invalid("this kernel cannot make spheres"))
    }
    /// `n + 1` points along the path, for drawing curves like splines that only the kernel knows.
    fn sample(&self, _path: &Path, _n: usize) -> Result<Vec<DVec3>, KernelError> {
        Err(KernelError::Invalid("this kernel cannot sample curves"))
    }
    /// Whether the kernel's own checker accepts the shape.
    fn is_valid(&self, s: &Self::Solid) -> bool;
    fn tessellate(&self, s: &Self::Solid, tolerance: f64) -> Result<Tessellation, KernelError>;
    fn write_step(&self, s: &Self::Solid, path: &std::path::Path) -> Result<(), KernelError>;
    fn read_step(&self, path: &std::path::Path) -> Result<Self::Solid, KernelError>;
    /// IGES out and in (Plasticity 26 reads and writes it through HOOPS Exchange; see the teardown).
    fn write_iges(&self, _s: &Self::Solid, _path: &std::path::Path) -> Result<(), KernelError> {
        Err(KernelError::Invalid("this kernel cannot write IGES"))
    }
    fn read_iges(&self, _path: &std::path::Path) -> Result<Self::Solid, KernelError> {
        Err(KernelError::Invalid("this kernel cannot read IGES"))
    }
    /// The exact shape in the kernel's own text format, for the native file.
    /// Names the format [`Kernel::to_native`] writes, so a file is only read by a kernel that can.
    fn native_format(&self) -> &'static str;
    fn to_native(&self, s: &Self::Solid) -> Result<String, KernelError>;
    fn from_native(&self, text: &str) -> Result<Self::Solid, KernelError>;
}
