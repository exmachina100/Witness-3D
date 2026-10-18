//! The model: named bodies plus whole-document undo, after Plasticity's GeometryDatabase and
//! History mementos (src/editor/History.ts:19-33). Solids are immutable once made, so a snapshot
//! is just a list of shared pointers and undo costs no geometry work.
//!
//! Every face and edge also carries a [`Ref`]: a document-wide id that survives operations. Face
//! and edge *numbers* are just positions in one version of a body; when a fillet or boolean
//! rebuilds the body, the kernel's [`History`] says which new faces and edges came from which old
//! ones, and they inherit the old refs. A selection, or a proposal that names edges, is kept as
//! refs and turned back into numbers against whatever version of the body is current.

use std::collections::BTreeMap;
use std::rc::Rc;

use glam::DVec3;
use serde::{Deserialize, Serialize};

use crate::blend::{blend, BlendParams};
use crate::extrude::{extrude, ExtrudeParams, ExtrudeResult, Operation};
use crate::form::{form, offset_faces_grow, FormKind, FormParams, Grow};
use crate::solids::{ArraySpec, Primitive};
use crate::{BooleanOp, FaceRebuild, Frame, History, Kernel, KernelError, Motion, Path, Profile, RebuiltFace, Segment, SheetExtension, Traced};

/// Length unit of every coordinate in a document. Fixed for now; stored in files so a later
/// version can convert.
pub const UNITS: &str = "mm";
/// Distance under which two points count as the same, in [`UNITS`]. OpenCascade's own default.
pub const TOLERANCE: f64 = 1e-7;

pub type BodyId = u32;

/// A persistent face or edge id, unique within a document. Pieces split from one face or edge
/// share its ref; faces and edges an operation creates get fresh ones.
pub type Ref = u64;

/// The refs of a body's faces and edges, indexed by face and edge number.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Refs {
    pub faces: Vec<Ref>,
    pub edges: Vec<Ref>,
}

impl Refs {
    /// The current numbers of the edges carrying any of `refs`.
    pub fn edges_with(&self, refs: &[Ref]) -> Vec<u32> {
        (0..self.edges.len() as u32).filter(|&i| refs.contains(&self.edges[i as usize])).collect()
    }
    pub fn faces_with(&self, refs: &[Ref]) -> Vec<u32> {
        (0..self.faces.len() as u32).filter(|&i| refs.contains(&self.faces[i as usize])).collect()
    }
}

pub type CurveId = u32;

/// What a Revolve, Loft or Sweep needs besides its regions.
#[derive(Clone, Debug)]
pub enum FormRequest {
    Revolve { axis_point: DVec3, axis_dir: DVec3, angle: f64, thickness: f64 },
    Loft,
    /// Sweep along the curve `path`.
    Sweep { path: CurveId, twist: f64, scale: f64 },
    /// Loft whose sides run along the `guides` curves.
    LoftGuided { guides: Vec<CurveId> },
    /// Sweep along `path` following the curve `guide` (if any) by `method`, held by `align`.
    SweepGuided { path: CurveId, guide: Option<CurveId>, method: crate::form::GuideMethod, align: crate::form::Alignment },
}

/// A planar curve drawn on a construction plane (Plasticity's Line, Rectangle and Circle). A closed
/// one bounds a region that Extrude can turn into a solid. Points are in the plane's coordinates.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Curve {
    pub origin: [f64; 3],
    pub x: [f64; 3],
    pub normal: [f64; 3],
    #[serde(flatten)]
    pub shape: CurveShape,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum CurveShape {
    Polyline { points: Vec<[f64; 2]>, closed: bool },
    Circle { center: [f64; 2], radius: f64 },
    /// A smooth curve through the points (Plasticity's Spline Curve).
    Spline { points: Vec<[f64; 2]>, closed: bool },
    /// A circular arc from `start` through `mid` to `end` (Three Point and Center Point Arc).
    Arc { start: [f64; 2], mid: [f64; 2], end: [f64; 2] },
    /// An ellipse around `center`, its radius along `major` the length of `major` and `minor` across
    /// it (Plasticity's Center and Three Point Ellipse).
    Ellipse { center: [f64; 2], major: [f64; 2], minor: f64 },
    /// Open lines, arcs and splines joined end to end (Plasticity's Join Curves).
    Contour { pieces: Vec<CurveShape> },
    /// A helix (Plasticity's Spiral) up the plane's normal from its origin: `turns` turns of
    /// `radius` over `length`, starting along the plane's x; `left` turns it the other way.
    Spiral { radius: f64, length: f64, turns: f64, #[serde(default)] left: bool },
    /// A curve shaped by control points it need not pass through (Plasticity's Control Point Curve).
    Cv { points: Vec<[f64; 2]>, closed: bool },
    /// A NURBS curve, free in space: its poles as (x, y, height up the normal) in the plane's
    /// coordinates, a weight each, and `poles + degree + 1` knots repeated as often as they occur.
    /// What Project makes; it lies in the plane when every height is zero.
    Nurbs { degree: usize, poles: Vec<[f64; 3]>, weights: Vec<f64>, knots: Vec<f64> },
}

impl Curve {
    pub fn frame(&self) -> Frame { Frame::new(DVec3::from_array(self.origin), DVec3::from_array(self.x), DVec3::from_array(self.normal)) }

    /// The region inside the curve, if it is closed.
    pub fn profile(&self) -> Option<Profile> {
        match &self.shape {
            CurveShape::Polyline { points, closed: true } if points.len() >= 3 => Some(Profile::Polygon(points.iter().map(|p| (p[0], p[1])).collect())),
            CurveShape::Circle { center, radius } => Some(Profile::Circle { center: (center[0], center[1]), radius: *radius }),
            CurveShape::Spline { points, closed: true } if points.len() >= 3 => Some(Profile::Spline(points.iter().map(|p| (p[0], p[1])).collect())),
            CurveShape::Cv { points, closed: true } if points.len() >= 3 => Some(Profile::Cv(points.iter().map(|p| (p[0], p[1])).collect())),
            CurveShape::Ellipse { center, major, minor } => Some(Profile::Ellipse { center: (center[0], center[1]), major: (major[0], major[1]), minor: *minor }),
            CurveShape::Nurbs { degree, poles, weights, knots } if Self::flat_loop(poles) => Some(Profile::Nurbs {
                degree: *degree, poles: poles.iter().map(|p| (p[0], p[1])).collect(), weights: weights.clone(), knots: knots.clone(),
            }),
            CurveShape::Contour { pieces } if crate::join::loops(pieces) => {
                let pts = |p: &Vec<[f64; 2]>| p.iter().map(|q| (q[0], q[1])).collect();
                Some(Profile::Contour(pieces.iter().map(|p| match p {
                    CurveShape::Polyline { points, .. } => Segment::Line(pts(points)),
                    CurveShape::Spline { points, .. } => Segment::Spline(pts(points)),
                    CurveShape::Arc { start, mid, end } => Segment::Arc((start[0], start[1]), (mid[0], mid[1]), (end[0], end[1])),
                    _ => unreachable!("checked when the contour was added"),
                }).collect()))
            }
            _ => None,
        }
    }

    /// The curve in model space, as a path to sweep along.
    pub fn path(&self) -> Path { Self::path_of(&self.frame(), &self.shape) }

    /// Whether NURBS poles close up and lie in their plane, bounding a region.
    fn flat_loop(poles: &[[f64; 3]]) -> bool {
        let (Some(a), Some(b)) = (poles.first(), poles.last()) else { return false };
        poles.len() >= 3 && poles.iter().all(|p| p[2].abs() < 1e-7) && (a[0] - b[0]).hypot(a[1] - b[1]) < 1e-7
    }

    /// A kernel's NURBS path as a curve. It lies in its own plane when it is flat (normal facing
    /// back against `dir`, the way it was projected); otherwise its plane is square to `dir`.
    pub fn from_nurbs(path: &Path, dir: DVec3) -> Result<Curve, KernelError> {
        let Path::Nurbs { degree, poles, weights, knots } = path else { return Err(KernelError::Invalid("not a NURBS curve")) };
        let first = *poles.first().ok_or(KernelError::Invalid("a curve needs poles"))?;
        let size = poles.iter().map(|p| (*p - first).length()).fold(0.0, f64::max).max(1.0);
        let back = -dir.try_normalize().ok_or(KernelError::Invalid("the projection has no direction"))?;
        // The plane through the first pole, the farthest from it and the one farthest off that line.
        let far = poles.iter().copied().max_by(|a, b| (*a - first).length().total_cmp(&(*b - first).length())).unwrap();
        let side = poles.iter().map(|p| (far - first).cross(*p - first)).max_by(|a, b| a.length().total_cmp(&b.length())).unwrap();
        let normal = side.try_normalize()
            .filter(|n| poles.iter().all(|p| (*p - first).dot(*n).abs() < 1e-9 * size))
            .map(|n| if n.dot(back) < 0.0 { -n } else { n })
            .filter(|n| n.dot(back).abs() > 1e-9)
            .unwrap_or(back);
        let x = (far - first).try_normalize().filter(|x| x.cross(normal).length() > 1e-6)
            .unwrap_or_else(|| normal.any_orthonormal_vector());
        let f = Frame::new(first, x, normal);
        let local = |p: DVec3| { let d = p - f.origin; [d.dot(f.x), d.dot(f.y()), d.dot(f.normal)] };
        let mut poles: Vec<[f64; 3]> = poles.iter().map(|p| local(*p)).collect();
        // Flat curves are flat exactly, so they bound regions.
        if poles.iter().all(|p| p[2].abs() < 1e-9 * size) { for p in &mut poles { p[2] = 0.0 } }
        let c = Curve {
            origin: f.origin.to_array(), x: f.x.to_array(), normal: f.normal.to_array(),
            shape: CurveShape::Nurbs { degree: *degree, poles, weights: weights.clone(), knots: knots.clone() },
        };
        c.check()?;
        Ok(c)
    }

    fn path_of(f: &Frame, shape: &CurveShape) -> Path {
        let f = *f;
        match shape {
            CurveShape::Polyline { points, closed } => Path::Polyline { points: points.iter().map(|p| f.point((p[0], p[1]))).collect(), closed: *closed },
            CurveShape::Circle { center, radius } => Path::Circle { center: f.point((center[0], center[1])), normal: f.normal, radius: *radius },
            CurveShape::Spline { points, closed } => Path::Spline { points: points.iter().map(|p| f.point((p[0], p[1]))).collect(), closed: *closed },
            CurveShape::Arc { start, mid, end } => Path::Arc { start: f.point((start[0], start[1])), mid: f.point((mid[0], mid[1])), end: f.point((end[0], end[1])) },
            CurveShape::Ellipse { center, major, minor } => Path::Ellipse { center: f.point((center[0], center[1])), normal: f.normal, major: f.point((major[0], major[1])) - f.origin, minor: *minor },
            CurveShape::Contour { pieces } => Path::Contour(pieces.iter().map(|p| Self::path_of(&f, p)).collect()),
            CurveShape::Cv { points, closed } => Path::Cv { points: points.iter().map(|p| f.point((p[0], p[1]))).collect(), closed: *closed },
            CurveShape::Nurbs { degree, poles, weights, knots } => Path::Nurbs {
                degree: *degree,
                poles: poles.iter().map(|p| f.point((p[0], p[1])) + f.normal * p[2]).collect(),
                weights: weights.clone(),
                knots: knots.clone(),
            },
            CurveShape::Spiral { radius, length, turns, left } => Path::Spiral { origin: f.origin, axis: f.normal, x: f.x, radius: *radius, length: *length, turns: *turns, left: *left },
        }
    }

    fn check(&self) -> Result<(), KernelError> {
        let finite = |a: &[f64]| a.iter().all(|v| v.is_finite());
        if !finite(&self.origin) || !finite(&self.x) || !finite(&self.normal) { return Err(KernelError::Invalid("the curve's plane is not valid")) }
        let (x, n) = (DVec3::from_array(self.x), DVec3::from_array(self.normal));
        if n.length() < 1e-9 || x.cross(n).length() < 1e-9 { return Err(KernelError::Invalid("the curve's plane is not valid")) }
        Self::check_shape(&self.shape)
    }

    fn check_shape(shape: &CurveShape) -> Result<(), KernelError> {
        let finite = |a: &[f64]| a.iter().all(|v| v.is_finite());
        match shape {
            CurveShape::Polyline { points, closed } => {
                if points.len() < 2 || (*closed && points.len() < 3) { return Err(KernelError::Invalid("a line needs two points, a closed one three")) }
                if !points.iter().all(|p| finite(p)) { return Err(KernelError::Invalid("a point is not a number")) }
            }
            CurveShape::Circle { center, radius } => {
                if !finite(center) || !(*radius > 0.0) || !radius.is_finite() { return Err(KernelError::Invalid("the circle's radius must be greater than zero")) }
            }
            CurveShape::Spline { points, closed } => {
                if points.len() < 2 || (*closed && points.len() < 3) { return Err(KernelError::Invalid("a curve needs two points, a closed one three")) }
                if !points.iter().all(|p| finite(p)) { return Err(KernelError::Invalid("a point is not a number")) }
                if points.windows(2).any(|w| (w[0][0] - w[1][0]).hypot(w[0][1] - w[1][1]) < 1e-6) { return Err(KernelError::Invalid("two points of the curve are in the same place")) }
            }
            CurveShape::Arc { start, mid, end } => {
                if !finite(start) || !finite(mid) || !finite(end) { return Err(KernelError::Invalid("a point is not a number")) }
                let cross = (mid[0] - start[0]) * (end[1] - start[1]) - (mid[1] - start[1]) * (end[0] - start[0]);
                if cross.abs() < 1e-9 { return Err(KernelError::Invalid("the three points of an arc must not lie on a line")) }
            }
            CurveShape::Ellipse { center, major, minor } => {
                if !finite(center) || !finite(major) { return Err(KernelError::Invalid("a point is not a number")) }
                if !(major[0].hypot(major[1]) > 1e-9) || !(*minor > 1e-9) || !minor.is_finite() { return Err(KernelError::Invalid("an ellipse needs two radii greater than zero")) }
            }
            CurveShape::Cv { points, closed } => {
                if points.len() < 2 || (*closed && points.len() < 3) { return Err(KernelError::Invalid("a curve needs two control points, a closed one three")) }
                if !points.iter().all(|p| finite(p)) { return Err(KernelError::Invalid("a point is not a number")) }
            }
            CurveShape::Contour { pieces } => {
                if pieces.is_empty() { return Err(KernelError::Invalid("a contour needs a piece")) }
                for p in pieces {
                    if crate::join::ends(p).is_none() { return Err(KernelError::Invalid("a contour is made of lines, arcs and splines with two ends")) }
                    Self::check_shape(p)?;
                }
                for w in pieces.windows(2) {
                    let (a, b) = (crate::join::ends(&w[0]).unwrap().1, crate::join::ends(&w[1]).unwrap().0);
                    if (a[0] - b[0]).hypot(a[1] - b[1]) > crate::join::MEET { return Err(KernelError::Invalid("the pieces of a contour must meet end to end")) }
                }
            }
            CurveShape::Nurbs { degree, poles, weights, knots } => {
                let (d, n) = (*degree, poles.len());
                if d < 1 || n < d + 1 || weights.len() != n || knots.len() != n + d + 1 { return Err(KernelError::Invalid("a NURBS curve's knots and weights do not match its poles")) }
                if !poles.iter().all(|p| finite(p)) || !finite(knots) { return Err(KernelError::Invalid("a point is not a number")) }
                if !weights.iter().all(|w| w.is_finite() && *w > 0.0) { return Err(KernelError::Invalid("a NURBS curve's weights must be positive")) }
                if knots.windows(2).any(|w| w[1] < w[0]) || knots[n] - knots[d] < 1e-12 { return Err(KernelError::Invalid("a NURBS curve's knots must increase")) }
            }
            CurveShape::Spiral { radius, length, turns, .. } => {
                let ok = |v: f64| v.is_finite() && v > 1e-9;
                if !ok(*radius) || !ok(*length) || !ok(*turns) { return Err(KernelError::Invalid("a spiral needs a radius, a length and turns greater than zero")) }
            }
        }
        Ok(())
    }
}

struct Body<S> {
    solid: S,
    refs: Refs,
}

struct Snapshot<S> {
    bodies: BTreeMap<BodyId, Rc<Body<S>>>,
    next_id: BodyId,
    next_ref: Ref,
    curves: BTreeMap<CurveId, Rc<Curve>>,
    next_curve: CurveId,
}

impl<S> Clone for Snapshot<S> {
    fn clone(&self) -> Self {
        Snapshot { bodies: self.bodies.clone(), next_id: self.next_id, next_ref: self.next_ref, curves: self.curves.clone(), next_curve: self.next_curve }
    }
}

impl<S> Snapshot<S> {
    fn empty(next_id: BodyId, next_ref: Ref) -> Self {
        Snapshot { bodies: BTreeMap::new(), next_id, next_ref, curves: BTreeMap::new(), next_curve: 1 }
    }
}

pub struct Document<K: Kernel> {
    pub kernel: K,
    state: Snapshot<K::Solid>,
    undo: Vec<Snapshot<K::Solid>>,
    redo: Vec<Snapshot<K::Solid>>,
    revision: u64,
    /// What the app keeps with the document and the kernel never reads (groups, hidden and locked
    /// bodies, materials), saved in the file as it is.
    pub app_state: Option<serde_json::Value>,
}

impl<K: Kernel> Document<K> {
    pub fn new(kernel: K) -> Self {
        Document { kernel, state: Snapshot::empty(1, 1), undo: vec![], redo: vec![], revision: 0, app_state: None }
    }

    pub fn ids(&self) -> Vec<BodyId> { self.state.bodies.keys().copied().collect() }
    pub fn get(&self, id: BodyId) -> Option<&K::Solid> { self.state.bodies.get(&id).map(|b| &b.solid) }
    pub fn refs(&self, id: BodyId) -> Option<&Refs> { self.state.bodies.get(&id).map(|b| &b.refs) }

    /// Changes with every edit, undo and redo, so a proposal made against one version of the
    /// document can tell it is stale.
    pub fn revision(&self) -> u64 { self.revision }

    /// Forget undo and redo, e.g. after loading a file or seeding a new document.
    pub fn clear_history(&mut self) {
        self.undo.clear();
        self.redo.clear();
    }

    fn checkpoint(&mut self) {
        self.undo.push(self.state.clone());
        self.redo.clear();
        self.revision += 1;
    }

    fn fresh(&mut self, n: usize) -> Vec<Ref> {
        let start = self.state.next_ref;
        self.state.next_ref += n as u64;
        (start..start + n as u64).collect()
    }

    /// Refs for a solid nothing is known about: all new.
    fn new_refs(&mut self, solid: &K::Solid) -> Refs {
        let (f, e) = (self.kernel.face_count(solid), self.kernel.edge_count(solid));
        Refs { faces: self.fresh(f), edges: self.fresh(e) }
    }

    /// Refs for `solid`, made from the body whose refs are `old` by an operation with `history`.
    /// A face or edge inherits the ref of its first source in the body; anything else is new.
    fn traced_refs(&mut self, solid: &K::Solid, old: &Refs, history: &History) -> Refs {
        let (nf, ne) = (self.kernel.face_count(solid), self.kernel.edge_count(solid));
        let mut faces: Vec<Option<Ref>> = vec![None; nf];
        let mut edges: Vec<Option<Ref>> = vec![None; ne];
        for &(from, to) in &history.faces[0] {
            if let (Some(slot), Some(&r)) = (faces.get_mut(to as usize), old.faces.get(from as usize)) { slot.get_or_insert(r); }
        }
        for &(from, to) in &history.edges[0] {
            if let (Some(slot), Some(&r)) = (edges.get_mut(to as usize), old.edges.get(from as usize)) { slot.get_or_insert(r); }
        }
        let faces = faces.into_iter().map(|r| r.unwrap_or_else(|| self.fresh(1)[0])).collect();
        let edges = edges.into_iter().map(|r| r.unwrap_or_else(|| self.fresh(1)[0])).collect();
        Refs { faces, edges }
    }

    pub fn add(&mut self, solid: K::Solid) -> BodyId {
        self.checkpoint();
        let id = self.state.next_id;
        self.state.next_id += 1;
        let refs = self.new_refs(&solid);
        self.state.bodies.insert(id, Rc::new(Body { solid, refs }));
        id
    }

    pub fn remove(&mut self, id: BodyId) -> bool {
        if !self.state.bodies.contains_key(&id) { return false }
        self.checkpoint();
        self.state.bodies.remove(&id);
        true
    }

    /// The next id [`Document::add`] will hand out; saved so ids survive a reopen.
    pub fn next_id(&self) -> BodyId { self.state.next_id }
    pub fn next_ref(&self) -> Ref { self.state.next_ref }

    /// Replace everything, e.g. when opening a file. History starts empty. Bodies without refs
    /// get new ones.
    pub fn replace_all(&mut self, bodies: impl IntoIterator<Item = (BodyId, K::Solid, Option<Refs>)>, next_id: BodyId, next_ref: Ref) {
        self.state = Snapshot::empty(next_id, next_ref.max(1));
        for (id, solid, refs) in bodies {
            let refs = match refs {
                Some(r) if r.faces.len() == self.kernel.face_count(&solid) && r.edges.len() == self.kernel.edge_count(&solid) => r,
                _ => self.new_refs(&solid),
            };
            let top = refs.faces.iter().chain(&refs.edges).max().map_or(0, |m| m + 1);
            self.state.next_ref = self.state.next_ref.max(top);
            self.state.bodies.insert(id, Rc::new(Body { solid, refs }));
        }
        self.state.next_id = self.state.next_id.max(self.state.bodies.keys().max().map_or(1, |m| m + 1));
        self.clear_history();
        self.revision += 1;
    }

    fn replace_traced(&mut self, id: BodyId, t: Traced<K::Solid>) {
        let old = self.state.bodies[&id].refs.clone();
        let refs = self.traced_refs(&t.solid, &old, &t.history);
        self.state.bodies.insert(id, Rc::new(Body { solid: t.solid, refs }));
    }

    /// Compute a fillet or chamfer without changing the document.
    pub fn preview_blend(&self, body: BodyId, p: &BlendParams) -> Result<K::Solid, KernelError> {
        let solid = self.get(body).ok_or(KernelError::Invalid("that body no longer exists"))?;
        Ok(blend(&self.kernel, solid, p)?.solid)
    }

    /// Run a fillet or chamfer and record it as one undoable step.
    pub fn commit_blend(&mut self, body: BodyId, p: &BlendParams) -> Result<BodyId, KernelError> {
        let solid = self.get(body).ok_or(KernelError::Invalid("that body no longer exists"))?;
        let t = blend(&self.kernel, solid, p)?;
        self.checkpoint();
        self.replace_traced(body, t);
        Ok(body)
    }

    /// Move, turn or scale bodies about one pivot, as one undoable step. Their faces and edges keep
    /// their refs.
    pub fn commit_motion(&mut self, bodies: &[BodyId], m: &Motion) -> Result<(), KernelError> {
        if bodies.is_empty() { return Err(KernelError::Invalid("select something to transform")) }
        if !(m.scale > 0.0) || !m.scale.is_finite() { return Err(KernelError::Invalid("the scale must be greater than zero")) }
        if m.is_identity() { return Err(KernelError::NoOp) }
        let mut moved = Vec::with_capacity(bodies.len());
        for id in bodies {
            let b = self.state.bodies.get(id).ok_or(KernelError::Invalid("that body no longer exists"))?;
            moved.push((*id, Body { solid: self.kernel.transform(&b.solid, m), refs: b.refs.clone() }));
        }
        self.checkpoint();
        for (id, b) in moved { self.state.bodies.insert(id, Rc::new(b)); }
        Ok(())
    }

    /// Delete bodies, as one undoable step.
    pub fn commit_delete(&mut self, bodies: &[BodyId]) -> Result<(), KernelError> { self.commit_delete_items(bodies, &[]) }

    /// Delete bodies and curves together, as one undoable step.
    pub fn commit_delete_items(&mut self, bodies: &[BodyId], curves: &[CurveId]) -> Result<(), KernelError> {
        if bodies.is_empty() && curves.is_empty() { return Err(KernelError::NoOp) }
        if bodies.iter().any(|id| !self.state.bodies.contains_key(id)) { return Err(KernelError::Invalid("that body no longer exists")) }
        if curves.iter().any(|id| !self.state.curves.contains_key(id)) { return Err(KernelError::Invalid("that curve no longer exists")) }
        self.checkpoint();
        for id in bodies { self.state.bodies.remove(id); }
        for id in curves { self.state.curves.remove(id); }
        Ok(())
    }

    pub fn curve_ids(&self) -> Vec<CurveId> { self.state.curves.keys().copied().collect() }
    pub fn curve(&self, id: CurveId) -> Option<&Curve> { self.state.curves.get(&id).map(|c| c.as_ref()) }
    pub fn next_curve(&self) -> CurveId { self.state.next_curve }

    /// Put back saved curves, e.g. after [`Document::replace_all`] when opening a file.
    pub fn replace_curves(&mut self, curves: impl IntoIterator<Item = (CurveId, Curve)>, next_curve: CurveId) {
        self.state.curves = curves.into_iter().map(|(id, c)| (id, Rc::new(c))).collect();
        self.state.next_curve = next_curve.max(self.state.curves.keys().max().map_or(1, |m| m + 1));
    }

    /// Add drawn curves, as one undoable step. Returns their ids, in order.
    pub fn commit_curves(&mut self, curves: Vec<Curve>) -> Result<Vec<CurveId>, KernelError> {
        if curves.is_empty() { return Err(KernelError::NoOp) }
        for c in &curves { c.check()?; }
        self.checkpoint();
        Ok(curves.into_iter().map(|c| {
            let id = self.state.next_curve;
            self.state.next_curve += 1;
            self.state.curves.insert(id, Rc::new(c));
            id
        }).collect())
    }

    /// Join Curves (J): the curves replaced by their joined runs, as one undoable step. Returns the
    /// new curves' ids.
    pub fn commit_join(&mut self, ids: &[CurveId]) -> Result<Vec<CurveId>, KernelError> {
        let curves = ids.iter().map(|id| self.curve(*id).cloned().ok_or(KernelError::Invalid("that curve no longer exists"))).collect::<Result<Vec<_>, _>>()?;
        let joined = crate::join::join(&curves)?;
        for c in &joined { c.check()?; }
        self.checkpoint();
        for id in ids { self.state.curves.remove(id); }
        Ok(joined.into_iter().map(|c| {
            let id = self.state.next_curve;
            self.state.next_curve += 1;
            self.state.curves.insert(id, Rc::new(c));
            id
        }).collect())
    }

    /// Curve edits (Trim, Fillet Curve, Explode): the curves `ids` replaced by `curves`, as one
    /// undoable step. Returns the new curves' ids, in order.
    pub fn commit_replace_curves(&mut self, ids: &[CurveId], curves: Vec<Curve>) -> Result<Vec<CurveId>, KernelError> {
        if ids.is_empty() && curves.is_empty() { return Err(KernelError::NoOp) }
        if ids.iter().any(|id| !self.state.curves.contains_key(id)) { return Err(KernelError::Invalid("that curve no longer exists")) }
        for c in &curves { c.check()?; }
        self.checkpoint();
        for id in ids { self.state.curves.remove(id); }
        Ok(curves.into_iter().map(|c| {
            let id = self.state.next_curve;
            self.state.next_curve += 1;
            self.state.curves.insert(id, Rc::new(c));
            id
        }).collect())
    }

    /// The target as it would be after a boolean with each tool in turn.
    pub fn preview_boolean(&self, target: BodyId, tools: &[BodyId], op: BooleanOp) -> Result<Traced<K::Solid>, KernelError> {
        if tools.is_empty() { return Err(KernelError::Invalid("select a tool body as well as the target")) }
        if tools.contains(&target) { return Err(KernelError::Invalid("the target can't also be a tool")) }
        let mut cur: Option<Traced<K::Solid>> = None;
        for t in tools {
            let tool = self.get(*t).ok_or(KernelError::Invalid("that body no longer exists"))?;
            let base = match &cur { Some(c) => &c.solid, None => self.get(target).ok_or(KernelError::Invalid("that body no longer exists"))? };
            let next = self.kernel.boolean(base, tool, op)?;
            cur = Some(match cur {
                // Chain the histories so the result's faces and edges trace back to the target.
                Some(prev) => Traced { solid: next.solid, history: chain(&prev.history, &next.history) },
                None => next,
            });
        }
        let t = cur.expect("at least one tool");
        if self.kernel.face_count(&t.solid) == 0 { return Err(KernelError::Invalid("the boolean leaves nothing")) }
        Ok(t)
    }

    /// Plasticity's Boolean: change the target by the tools and remove the tools unless kept, as
    /// one undoable step.
    pub fn commit_boolean(&mut self, target: BodyId, tools: &[BodyId], op: BooleanOp, keep_tools: bool) -> Result<BodyId, KernelError> {
        let t = self.preview_boolean(target, tools, op)?;
        self.checkpoint();
        self.replace_traced(target, t);
        if !keep_tools { for id in tools { self.state.bodies.remove(id); } }
        Ok(target)
    }

    /// Boolean's Shift+Q slice: the target with the tools cut away, and for each tool the piece of
    /// the target inside it.
    pub fn preview_boolean_slice(&self, target: BodyId, tools: &[BodyId]) -> Result<(Traced<K::Solid>, Vec<K::Solid>), KernelError> {
        let rest = self.preview_boolean(target, tools, BooleanOp::Difference)?;
        let body = self.get(target).ok_or(KernelError::Invalid("that body no longer exists"))?;
        let pieces = tools.iter().map(|t| {
            let tool = self.get(*t).ok_or(KernelError::Invalid("that body no longer exists"))?;
            let piece = self.kernel.boolean(body, tool, BooleanOp::Intersection)?.solid;
            if self.kernel.face_count(&piece) == 0 { return Err(KernelError::Invalid("a tool does not meet the body")) }
            Ok(piece)
        }).collect::<Result<Vec<_>, KernelError>>()?;
        Ok((rest, pieces))
    }

    /// Run a slice as one undoable step: the target keeps its id and the pieces become new bodies,
    /// returned in tool order. The tools go unless kept.
    pub fn commit_boolean_slice(&mut self, target: BodyId, tools: &[BodyId], keep_tools: bool) -> Result<Vec<BodyId>, KernelError> {
        let (rest, pieces) = self.preview_boolean_slice(target, tools)?;
        self.checkpoint();
        self.replace_traced(target, rest);
        if !keep_tools { for id in tools { self.state.bodies.remove(id); } }
        Ok(pieces.into_iter().map(|solid| self.add_unrecorded(solid)).collect())
    }

    fn add_unrecorded(&mut self, solid: K::Solid) -> BodyId {
        let id = self.state.next_id;
        self.state.next_id += 1;
        let refs = self.new_refs(&solid);
        self.state.bodies.insert(id, Rc::new(Body { solid, refs }));
        id
    }

    /// Copy bodies in place, as one undoable step. Returns the new ids, in order. The copies get
    /// their own refs.
    pub fn commit_duplicate(&mut self, bodies: &[BodyId]) -> Result<Vec<BodyId>, KernelError> {
        if bodies.is_empty() { return Err(KernelError::NoOp) }
        let copies = bodies.iter().map(|id| {
            let b = self.state.bodies.get(id).ok_or(KernelError::Invalid("that body no longer exists"))?;
            Ok(self.kernel.transform(&b.solid, &Motion::translation(DVec3::ZERO)))
        }).collect::<Result<Vec<_>, KernelError>>()?;
        self.checkpoint();
        Ok(copies.into_iter().map(|solid| {
            let id = self.state.next_id;
            self.state.next_id += 1;
            let refs = self.new_refs(&solid);
            self.state.bodies.insert(id, Rc::new(Body { solid, refs }));
            id
        }).collect())
    }

    /// Compute an extrude without changing the document: what a live preview shows.
    pub fn preview_extrude(&self, target: Option<BodyId>, p: &ExtrudeParams) -> Result<ExtrudeResult<K::Solid>, KernelError> {
        extrude(&self.kernel, target.and_then(|id| self.get(id)), p)
    }

    /// Run an extrude and record it as one undoable step. Returns the body it created or changed.
    pub fn commit_extrude(&mut self, target: Option<BodyId>, p: &ExtrudeParams) -> Result<BodyId, KernelError> {
        let r = self.preview_extrude(target, p)?;
        Ok(self.commit_result(target, r))
    }

    fn commit_result(&mut self, target: Option<BodyId>, r: ExtrudeResult<K::Solid>) -> BodyId {
        match r {
            ExtrudeResult::New(solid) => self.add(solid),
            ExtrudeResult::Replace { solid, history, .. } => {
                let id = target.expect("a replace always has a target");
                self.checkpoint();
                self.replace_traced(id, Traced { solid, history });
                id
            }
            ExtrudeResult::Slice { solid, history, piece } => {
                let id = target.expect("a slice always has a target");
                self.checkpoint();
                self.replace_traced(id, Traced { solid, history });
                self.add_unrecorded(piece);
                id
            }
        }
    }

    /// The region inside a closed curve, as a profile on its plane.
    fn region(&self, curve: CurveId) -> Result<(Profile, Frame), KernelError> {
        let c = self.curve(curve).ok_or(KernelError::Invalid("that curve no longer exists"))?;
        let profile = c.profile().ok_or(KernelError::Invalid("only a closed curve has a region"))?;
        Ok((profile, c.frame()))
    }

    /// Revolve, Loft or Sweep of drawn regions. Loft takes them in order; the others take one.
    pub fn form_params(&self, regions: &[CurveId], kind: FormRequest, operation: Operation) -> Result<FormParams, KernelError> {
        let (first, rest) = regions.split_first().ok_or(KernelError::Invalid("select a region first"))?;
        let (profile, frame) = self.region(*first)?;
        let kind = match kind {
            FormRequest::Revolve { axis_point, axis_dir, angle, thickness } => FormKind::Revolve { axis_point, axis_dir, angle, thickness },
            FormRequest::Loft => FormKind::Loft { more: rest.iter().map(|&id| self.region(id)).collect::<Result<_, _>>()?, guides: vec![] },
            FormRequest::LoftGuided { guides } => {
                if guides.iter().any(|g| regions.contains(g)) { return Err(KernelError::Invalid("a curve can't be both a profile and a guide")) }
                let guides = guides.iter().map(|&g| self.curve(g).map(|c| c.path()).ok_or(KernelError::Invalid("that guide no longer exists"))).collect::<Result<_, _>>()?;
                FormKind::Loft { more: rest.iter().map(|&id| self.region(id)).collect::<Result<_, _>>()?, guides }
            }
            FormRequest::Sweep { path, twist, scale } => {
                if regions.contains(&path) { return Err(KernelError::Invalid("pick a path other than the profile")) }
                let path = self.curve(path).ok_or(KernelError::Invalid("that path no longer exists"))?.path();
                FormKind::Sweep { path, twist, scale, guide: None, method: Default::default(), align: Default::default() }
            }
            FormRequest::SweepGuided { path, guide, method, align } => {
                if regions.contains(&path) { return Err(KernelError::Invalid("pick a path other than the profile")) }
                if guide.is_some_and(|g| g == path || regions.contains(&g)) { return Err(KernelError::Invalid("pick a guide other than the path and the profile")) }
                let path = self.curve(path).ok_or(KernelError::Invalid("that path no longer exists"))?.path();
                let guide = guide.map(|g| self.curve(g).map(|c| c.path()).ok_or(KernelError::Invalid("that guide no longer exists"))).transpose()?;
                FormKind::Sweep { path, twist: 0.0, scale: 1.0, guide, method, align }
            }
        };
        Ok(FormParams { profile, frame, kind, operation })
    }

    pub fn preview_form(&self, target: Option<BodyId>, p: &FormParams) -> Result<ExtrudeResult<K::Solid>, KernelError> {
        form(&self.kernel, target.and_then(|id| self.get(id)), p)
    }

    /// Run a Revolve, Loft or Sweep as one undoable step. Returns the body it created or changed.
    pub fn commit_form(&mut self, target: Option<BodyId>, p: &FormParams) -> Result<BodyId, KernelError> {
        let r = self.preview_form(target, p)?;
        Ok(self.commit_result(target, r))
    }

    /// Compute an Offset Face without changing the document.
    pub fn preview_offset(&self, body: BodyId, faces: &[u32], distance: f64, angle: f64, grow: Grow) -> Result<K::Solid, KernelError> {
        let solid = self.get(body).ok_or(KernelError::Invalid("that body no longer exists"))?;
        Ok(offset_faces_grow(&self.kernel, solid, faces, distance, angle, grow)?.solid)
    }

    /// Run an Offset Face as one undoable step; faces and edges keep their refs.
    pub fn commit_offset(&mut self, body: BodyId, faces: &[u32], distance: f64, angle: f64, grow: Grow) -> Result<BodyId, KernelError> {
        let solid = self.get(body).ok_or(KernelError::Invalid("that body no longer exists"))?;
        let t = offset_faces_grow(&self.kernel, solid, faces, distance, angle, grow)?;
        self.checkpoint();
        self.replace_traced(body, t);
        Ok(body)
    }

    /// Box, Cylinder or Sphere, as a new body or combined with `target` by `operation` (Plasticity's
    /// Q, W, Shift+E, Shift+Q and B while sizing a primitive), without changing the document.
    pub fn preview_primitive(&self, p: &Primitive, target: Option<BodyId>, operation: Operation) -> Result<ExtrudeResult<K::Solid>, KernelError> {
        let solid = crate::solids::primitive(&self.kernel, p)?;
        let body = target.map(|id| self.get(id).ok_or(KernelError::Invalid("that body no longer exists"))).transpose()?;
        let operation = if operation == Operation::Auto { Operation::NewBody } else { operation };
        crate::extrude::combine(&self.kernel, body, solid, operation, true, "the solid does not meet the body")
    }

    /// Run a primitive as one undoable step. Returns the body it created or changed.
    pub fn commit_primitive(&mut self, p: &Primitive, target: Option<BodyId>, operation: Operation) -> Result<BodyId, KernelError> {
        let r = self.preview_primitive(p, target, operation)?;
        Ok(self.commit_result(target, r))
    }

    /// Compute a Shell without changing the document.
    pub fn preview_shell(&self, body: BodyId, faces: &[u32], thickness: f64) -> Result<K::Solid, KernelError> {
        let solid = self.get(body).ok_or(KernelError::Invalid("that body no longer exists"))?;
        Ok(crate::solids::shell(&self.kernel, solid, faces, thickness)?.solid)
    }

    /// Run a Shell as one undoable step; the outer faces and edges keep their refs.
    pub fn commit_shell(&mut self, body: BodyId, faces: &[u32], thickness: f64) -> Result<BodyId, KernelError> {
        let solid = self.get(body).ok_or(KernelError::Invalid("that body no longer exists"))?;
        let t = crate::solids::shell(&self.kernel, solid, faces, thickness)?;
        self.checkpoint();
        self.replace_traced(body, t);
        Ok(body)
    }

    /// Plasticity's Delete Redundant Topology on the bodies, as one undoable step: faces that share a
    /// surface merge, and edges that share a curve. Returns how many faces and edges went.
    /// Plasticity's Reverse Sheet: the sheets' faces turned to face the other way, as one undoable
    /// step. Faces and edges keep their numbers and refs.
    pub fn commit_reverse_sheets(&mut self, bodies: &[BodyId]) -> Result<(), KernelError> {
        if bodies.is_empty() { return Err(KernelError::Invalid("select the sheets to reverse")) }
        let mut done = Vec::with_capacity(bodies.len());
        for id in bodies {
            let b = self.state.bodies.get(id).ok_or(KernelError::Invalid("that body no longer exists"))?;
            if !self.kernel.is_sheet(&b.solid) { return Err(KernelError::Invalid("Reverse Sheet works on sheets; a solid always faces out")) }
            done.push((*id, Body { solid: self.kernel.reversed(&b.solid)?, refs: b.refs.clone() }));
        }
        self.checkpoint();
        for (id, b) in done { self.state.bodies.insert(id, Rc::new(b)); }
        Ok(())
    }

    /// Plasticity's Find Boundary Edges: each body's edges that bound only one face (its open sides).
    pub fn boundary_edges(&self, bodies: &[BodyId]) -> Result<Vec<(BodyId, Vec<u32>)>, KernelError> {
        bodies.iter().map(|&id| {
            let solid = self.get(id).ok_or(KernelError::Invalid("that body no longer exists"))?;
            Ok((id, self.kernel.boundary_edges(solid)))
        }).collect()
    }

    /// The faces of a body that look like fillets (Remove Fillets); with `seeds`, only the fillet
    /// chains holding those faces.
    pub fn fillet_faces(&self, body: BodyId, seeds: &[u32]) -> Result<Vec<u32>, KernelError> {
        let solid = self.get(body).ok_or(KernelError::Invalid("that body no longer exists"))?;
        let faces = self.kernel.fillet_faces(solid, seeds);
        if faces.is_empty() {
            return Err(KernelError::Invalid(if seeds.is_empty() { "no fillets found on that body" } else { "those faces are not fillets" }));
        }
        Ok(faces)
    }

    pub fn commit_unify(&mut self, bodies: &[BodyId]) -> Result<(usize, usize), KernelError> {
        if bodies.is_empty() { return Err(KernelError::Invalid("select the bodies to clean up")) }
        let mut done = Vec::new();
        let (mut faces, mut edges) = (0, 0);
        for &id in bodies {
            let solid = self.get(id).ok_or(KernelError::Invalid("that body no longer exists"))?;
            let t = self.kernel.unify(solid)?;
            faces += self.kernel.face_count(solid).saturating_sub(self.kernel.face_count(&t.solid));
            edges += self.kernel.edge_count(solid).saturating_sub(self.kernel.edge_count(&t.solid));
            done.push((id, t));
        }
        self.checkpoint();
        for (id, t) in done { self.replace_traced(id, t); }
        Ok((faces, edges))
    }

    /// Compute a Remove Face without changing the document.
    pub fn preview_remove_faces(&self, body: BodyId, faces: &[u32]) -> Result<K::Solid, KernelError> {
        let solid = self.get(body).ok_or(KernelError::Invalid("that body no longer exists"))?;
        Ok(crate::solids::remove_faces(&self.kernel, solid, faces)?.solid)
    }

    /// Run a Remove Face as one undoable step; the faces that stay keep their refs.
    pub fn commit_remove_faces(&mut self, body: BodyId, faces: &[u32]) -> Result<BodyId, KernelError> {
        let solid = self.get(body).ok_or(KernelError::Invalid("that body no longer exists"))?;
        let t = crate::solids::remove_faces(&self.kernel, solid, faces)?;
        self.checkpoint();
        self.replace_traced(body, t);
        Ok(body)
    }

    /// Plasticity's Cut, without changing the document: per body, its biggest piece (traced) and the rest.
    pub fn preview_cut(&self, bodies: &[BodyId], curves: &[CurveId], tools: &Tools) -> Result<Vec<(BodyId, Traced<K::Solid>, Vec<K::Solid>)>, KernelError> {
        if bodies.is_empty() { return Err(KernelError::Invalid("select a solid to cut")) }
        let cutters = self.cutters(curves)?;
        let sheets = self.sheets(tools)?;
        if cutters.is_empty() && sheets.is_empty() && tools.bodies.is_empty() { return Err(KernelError::Invalid("select curves, faces or a plane to cut with")) }
        bodies.iter().map(|&id| {
            let s = self.get(id).ok_or(KernelError::Invalid("that body no longer exists"))?;
            let extra = self.extra(&sheets, tools, id)?;
            let (piece, rest) = self.kernel.cut(s, &cutters, &extra, SHEET)?;
            Ok((id, piece, rest))
        }).collect()
    }

    /// The faces and plane of `tools` as cutting sheets.
    fn sheets(&self, tools: &Tools) -> Result<Vec<K::Solid>, KernelError> {
        let mut out = Vec::new();
        for f in &tools.faces {
            let s = self.get(f.body).ok_or(KernelError::Invalid("that body no longer exists"))?;
            out.push(self.kernel.face_sheet(s, f.face, SHEET)?);
        }
        if let Some(p) = &tools.plane { out.push(self.kernel.plane_sheet(DVec3::from(p.origin), DVec3::from(p.normal), SHEET)?) }
        Ok(out)
    }

    /// The sheets and the tool bodies other than `target`, as the kernel takes them.
    fn extra<'a>(&'a self, sheets: &'a [K::Solid], tools: &Tools, target: BodyId) -> Result<Vec<&'a K::Solid>, KernelError> {
        let mut out: Vec<&K::Solid> = sheets.iter().collect();
        for &b in tools.bodies.iter().filter(|&&b| b != target) {
            out.push(self.get(b).ok_or(KernelError::Invalid("that body no longer exists"))?);
        }
        Ok(out)
    }

    /// The curves as cutting paths with their plane normals, for Cut and Imprint.
    fn cutters(&self, curves: &[CurveId]) -> Result<Vec<(Path, DVec3)>, KernelError> {
        curves.iter().map(|id| {
            let c = self.curve(*id).ok_or(KernelError::Invalid("that curve no longer exists"))?;
            Ok((c.path(), c.frame().normal))
        }).collect()
    }

    /// Plasticity's Imprint, without changing the document: the body with the numbered faces (all
    /// when `faces` is empty) split where the curves, projected along their normals, cross them.
    pub fn preview_imprint(&self, body: BodyId, faces: &[u32], curves: &[CurveId], tools: &Tools) -> Result<Traced<K::Solid>, KernelError> {
        let mut cutters = self.cutters(curves)?;
        for c in &tools.shapes {
            c.check()?;
            cutters.push((c.path(), c.frame().normal));
        }
        let s = self.get(body).ok_or(KernelError::Invalid("that body no longer exists"))?;
        let sheets = self.sheets(tools)?;
        let extra = self.extra(&sheets, tools, body)?;
        if cutters.is_empty() && extra.is_empty() { return Err(KernelError::Invalid("select curves or another body to imprint")) }
        self.kernel.imprint(s, faces, &cutters, &extra, SHEET)
    }

    /// Imprint as one undoable step; `consume` also deletes the curves (the knife).
    pub fn commit_imprint(&mut self, body: BodyId, faces: &[u32], curves: &[CurveId], tools: &Tools, consume: bool) -> Result<BodyId, KernelError> {
        let traced = self.preview_imprint(body, faces, curves, tools)?;
        self.checkpoint();
        self.replace_traced(body, traced);
        if consume { for id in curves { self.state.curves.remove(id); } }
        Ok(body)
    }

    /// Plasticity's Project Curve Body, without changing the document: the curves carried along
    /// `dir` onto the body's numbered faces (all when empty), forwards only unless `both`, and only
    /// where seen along `dir` when `hide`.
    pub fn preview_project(&self, body: BodyId, faces: &[u32], curves: &[CurveId], dir: DVec3, both: bool, hide: bool) -> Result<Vec<Curve>, KernelError> {
        if curves.is_empty() { return Err(KernelError::Invalid("select the curves to project")) }
        let s = self.get(body).ok_or(KernelError::Invalid("that body no longer exists"))?;
        let dir = dir.try_normalize().ok_or(KernelError::Invalid("the projection has no direction"))?;
        let paths: Vec<(Path, DVec3)> = self.cutters(curves)?.into_iter().map(|(p, _)| (p, dir)).collect();
        self.kernel.project(s, faces, &paths, SHEET, both, hide)?.iter().map(|p| Curve::from_nurbs(p, dir)).collect()
    }

    /// Plasticity's Isoparam, without changing the document: the curve on face `face` through
    /// `point` along the face's u (v held) or v, cut to the face.
    pub fn preview_isoparam(&self, body: BodyId, face: u32, point: DVec3, along_u: bool) -> Result<Curve, KernelError> {
        let s = self.get(body).ok_or(KernelError::Invalid("that body no longer exists"))?;
        let paths = self.kernel.isoparam(s, face, point, along_u)?;
        Curve::from_nurbs(paths.first().ok_or(KernelError::Invalid("the isoparam could not be found there"))?, DVec3::NEG_Y)
    }

    /// Plasticity's Project Body Body, without changing the document: the curves where two bodies meet.
    pub fn preview_meet(&self, a: BodyId, b: BodyId) -> Result<Vec<Curve>, KernelError> {
        if a == b { return Err(KernelError::Invalid("select two different bodies")) }
        let (sa, sb) = (self.get(a), self.get(b));
        let (Some(sa), Some(sb)) = (sa, sb) else { return Err(KernelError::Invalid("that body no longer exists")) };
        // Curves that are not flat get a plane facing up.
        self.kernel.meet(sa, sb)?.iter().map(|p| Curve::from_nurbs(p, DVec3::NEG_Y)).collect()
    }

    /// Plasticity's Project Curve Curve, without changing the document: where the two curves'
    /// sheets, each swept along its own plane's normal, meet.
    pub fn preview_project_curves(&self, a: CurveId, b: CurveId) -> Result<Vec<Curve>, KernelError> {
        let cs = self.cutters(&[a, b])?;
        if a == b { return Err(KernelError::Invalid("select two different curves")) }
        let dir = cs[0].1;
        self.kernel.project_curve_curve(&cs[0], &cs[1], SHEET)?.iter().map(|p| Curve::from_nurbs(p, -dir)).collect()
    }

    /// Plasticity's Project Outline, without changing the document: the body's outline seen along
    /// the plane's normal, as flat curves on the plane.
    pub fn preview_outline(&self, body: BodyId, origin: DVec3, normal: DVec3, x: DVec3) -> Result<Vec<Curve>, KernelError> {
        let s = self.get(body).ok_or(KernelError::Invalid("that body no longer exists"))?;
        let normal = normal.try_normalize().ok_or(KernelError::Invalid("the plane has no direction"))?;
        let x = x.reject_from(normal).try_normalize().ok_or(KernelError::Invalid("the plane's x lies along its normal"))?;
        self.kernel.project_outline(s, origin, normal, x)?.iter().map(|p| Curve::from_nurbs(p, -normal)).collect()
    }

    /// Any of the Project previews' curves added as one undoable step. The curves projected stay.
    pub fn commit_project(&mut self, curves: Vec<Curve>) -> Result<Vec<CurveId>, KernelError> {
        if curves.is_empty() { return Err(KernelError::Invalid("nothing was projected")) }
        self.commit_curves(curves)
    }

    /// Plasticity's Bridge Surface, without changing the document: a sheet from edge `a` to edge
    /// `b` (each a body and its edge number), tangent to their faces, with `tension`.
    pub fn preview_bridge_surface(&self, a: (BodyId, u32), b: (BodyId, u32), tension: f64) -> Result<K::Solid, KernelError> {
        if a == b { return Err(KernelError::Invalid("select two different edges")) }
        let sa = self.get(a.0).ok_or(KernelError::Invalid("that body no longer exists"))?;
        let sb = self.get(b.0).ok_or(KernelError::Invalid("that body no longer exists"))?;
        self.kernel.bridge_surface((sa, a.1), (sb, b.1), a.0 == b.0, tension)
    }

    /// Bridge Surface as one undoable step: the sheet becomes a body of its own.
    pub fn commit_bridge_surface(&mut self, a: (BodyId, u32), b: (BodyId, u32), tension: f64) -> Result<BodyId, KernelError> {
        let sheet = self.preview_bridge_surface(a, b, tension)?;
        Ok(self.add(sheet))
    }

    /// Plasticity's Thicken, without changing the document: sheet `body` made solid.
    pub fn preview_thicken(&self, body: BodyId, front: f64, back: f64) -> Result<K::Solid, KernelError> {
        let sheet = self.get(body).ok_or(KernelError::Invalid("that body no longer exists"))?;
        self.kernel.thicken(sheet, front, back)
    }

    /// Thicken as one undoable step: the sheet becomes the solid, keeping its body.
    pub fn commit_thicken(&mut self, body: BodyId, front: f64, back: f64) -> Result<BodyId, KernelError> {
        let solid = self.preview_thicken(body, front, back)?;
        self.checkpoint();
        self.replace_traced(body, Traced { solid, history: History::default() });
        Ok(body)
    }

    /// Plasticity's Thicken Face, without changing the document: `faces` of `body` made a solid of
    /// their own, `front` along their normals (out of the body) and `back` behind them. On a sheet the
    /// faces are copied into a sheet of their own and thickened.
    pub fn preview_thicken_faces(&self, body: BodyId, faces: &[u32], front: f64, back: f64) -> Result<K::Solid, KernelError> {
        let s = self.get(body).ok_or(KernelError::Invalid("that body no longer exists"))?;
        if faces.is_empty() { return Err(KernelError::Invalid("select the faces to thicken")) }
        if !self.kernel.is_sheet(s) { return self.kernel.thicken_faces(s, faces, front, back) }
        // A body of one face is its own sheet.
        if self.kernel.face_count(s) == 1 {
            if faces != [0] { return Err(KernelError::Invalid("no such face")) }
            return self.kernel.thicken(s, front, back);
        }
        let mut pieces: Vec<Option<K::Solid>> = self.kernel.unjoin(s, true)?.into_iter().map(Some).collect();
        let mut picked = vec![];
        for &f in faces {
            let piece = pieces.get_mut(f as usize).ok_or(KernelError::Invalid("no such face"))?;
            picked.push(piece.take().ok_or(KernelError::Invalid("a face is picked twice"))?);
        }
        let sheet = if picked.len() == 1 { picked.pop().unwrap() } else { self.kernel.join_sheets(&picked.iter().collect::<Vec<_>>())? };
        self.kernel.thicken(&sheet, front, back)
    }

    /// Thicken Face as one undoable step: the solid is a new body and the faces' body stays.
    pub fn commit_thicken_faces(&mut self, body: BodyId, faces: &[u32], front: f64, back: f64) -> Result<BodyId, KernelError> {
        let solid = self.preview_thicken_faces(body, faces, front, back)?;
        Ok(self.add(solid))
    }

    /// Plasticity's Toggle Surface Curvature: `n + 1` comb teeth along edge `edge` of `body`.
    pub fn edge_curvature(&self, body: BodyId, edge: u32, n: usize) -> Result<Vec<crate::CombTooth>, KernelError> {
        let s = self.get(body).ok_or(KernelError::Invalid("that body no longer exists"))?;
        self.kernel.edge_curvature(s, edge, n)
    }

    /// Plasticity's Untrim, without changing the document: for each of `faces` of `body`, a sheet
    /// of the whole surface under it, with the face's edges imprinted when `keep_edges`.
    pub fn preview_untrim(&self, body: BodyId, faces: &[u32], keep_edges: bool) -> Result<Vec<K::Solid>, KernelError> {
        let s = self.get(body).ok_or(KernelError::Invalid("that body no longer exists"))?;
        if faces.is_empty() { return Err(KernelError::Invalid("select the faces to untrim")) }
        faces.iter().map(|&f| self.kernel.untrim_face(s, f, keep_edges)).collect()
    }

    /// Untrim as one undoable step: each sheet is a body of its own and the faces' body stays.
    pub fn commit_untrim(&mut self, body: BodyId, faces: &[u32], keep_edges: bool) -> Result<Vec<BodyId>, KernelError> {
        let sheets = self.preview_untrim(body, faces, keep_edges)?;
        self.checkpoint();
        Ok(sheets.into_iter().map(|s| self.add_unrecorded(s)).collect())
    }

    /// Plasticity's Rebuild Face, without changing the document: `faces` of `body` given new
    /// B-spline surfaces, with what each became.
    pub fn preview_rebuild_faces(&self, body: BodyId, faces: &[u32], how: &FaceRebuild) -> Result<(K::Solid, Vec<RebuiltFace>), KernelError> {
        let s = self.get(body).ok_or(KernelError::Invalid("that body no longer exists"))?;
        if faces.is_empty() { return Err(KernelError::Invalid("select the faces to rebuild")) }
        self.kernel.rebuild_faces(s, faces, how)
    }

    /// Rebuild Face as one undoable step. Faces and edges keep their numbers and refs.
    pub fn commit_rebuild_faces(&mut self, body: BodyId, faces: &[u32], how: &FaceRebuild) -> Result<Vec<RebuiltFace>, KernelError> {
        let (solid, info) = self.preview_rebuild_faces(body, faces, how)?;
        let refs = self.state.bodies.get(&body).ok_or(KernelError::Invalid("that body no longer exists"))?.refs.clone();
        self.checkpoint();
        self.state.bodies.insert(body, Rc::new(Body { solid, refs }));
        Ok(info)
    }

    /// Plasticity's Match Face, without changing the document: `faces` of `body` replaced by the
    /// surface of face `tface` of body `target`.
    pub fn preview_match_faces(&self, body: BodyId, faces: &[u32], target: BodyId, tface: u32) -> Result<K::Solid, KernelError> {
        let s = self.get(body).ok_or(KernelError::Invalid("that body no longer exists"))?;
        let t = self.get(target).ok_or(KernelError::Invalid("the target body no longer exists"))?;
        if faces.is_empty() { return Err(KernelError::Invalid("select the faces to match")) }
        if target == body && faces.contains(&tface) { return Err(KernelError::Invalid("match the faces to another face, not one of themselves")) }
        self.kernel.match_faces(s, faces, t, tface)
    }

    /// Match Face as one undoable step: the body keeps its id.
    pub fn commit_match_faces(&mut self, body: BodyId, faces: &[u32], target: BodyId, tface: u32) -> Result<BodyId, KernelError> {
        let solid = self.preview_match_faces(body, faces, target, tface)?;
        self.checkpoint();
        self.replace_traced(body, Traced { solid, history: History::default() });
        Ok(body)
    }

    /// Plasticity's Raise Surface Degree as one undoable step, on `faces` of `body` (all its faces
    /// when empty). Faces and edges keep their numbers and refs.
    pub fn commit_raise_faces(&mut self, body: BodyId, faces: &[u32]) -> Result<Vec<RebuiltFace>, KernelError> {
        let b = self.state.bodies.get(&body).ok_or(KernelError::Invalid("that body no longer exists"))?;
        let all: Vec<u32> = if faces.is_empty() { (0..self.kernel.face_count(&b.solid) as u32).collect() } else { faces.to_vec() };
        let (solid, info) = self.kernel.raise_faces(&b.solid, &all)?;
        let refs = b.refs.clone();
        self.checkpoint();
        self.state.bodies.insert(body, Rc::new(Body { solid, refs }));
        Ok(info)
    }

    /// Plasticity's Extend Sheet, without changing the document: sheet `body` grown past its open `edge`,
    /// by `distance` or, with `limit`, until it meets that body.
    pub fn preview_extend_sheet(&self, body: BodyId, edge: u32, distance: f64, shape: SheetExtension, limit: Option<BodyId>) -> Result<K::Solid, KernelError> {
        let sheet = self.get(body).ok_or(KernelError::Invalid("that body no longer exists"))?;
        match limit {
            Some(t) if t == body => Err(KernelError::Invalid("limit the sheet by another body, not itself")),
            Some(t) => self.kernel.extend_sheet_to(sheet, edge, self.get(t).ok_or(KernelError::Invalid("the limiting body no longer exists"))?, shape),
            None => self.kernel.extend_sheet(sheet, edge, distance, shape),
        }
    }

    /// Extend Sheet as one undoable step: the sheet keeps its body.
    pub fn commit_extend_sheet(&mut self, body: BodyId, edge: u32, distance: f64, shape: SheetExtension, limit: Option<BodyId>) -> Result<BodyId, KernelError> {
        let sheet = self.preview_extend_sheet(body, edge, distance, shape, limit)?;
        self.checkpoint();
        self.replace_traced(body, Traced { solid: sheet, history: History::default() });
        Ok(body)
    }

    /// Plasticity's Join for sheets, without changing the document.
    pub fn preview_join_sheets(&self, bodies: &[BodyId]) -> Result<K::Solid, KernelError> {
        let mut ids = bodies.to_vec();
        ids.dedup();
        if ids.len() < 2 { return Err(KernelError::Invalid("select two or more sheets to join")) }
        let sheets = ids.iter().map(|&b| self.get(b).ok_or(KernelError::Invalid("that body no longer exists"))).collect::<Result<Vec<_>, _>>()?;
        self.kernel.join_sheets(&sheets)
    }

    /// Join as one undoable step: the first body becomes the joined one, the others go.
    pub fn commit_join_sheets(&mut self, bodies: &[BodyId]) -> Result<BodyId, KernelError> {
        let joined = self.preview_join_sheets(bodies)?;
        self.checkpoint();
        self.replace_traced(bodies[0], Traced { solid: joined, history: History::default() });
        for id in &bodies[1..] { if *id != bodies[0] { self.state.bodies.remove(id); } }
        Ok(bodies[0])
    }

    /// Plasticity's Unjoin, without changing the document: the pieces `body` comes apart into.
    pub fn preview_unjoin(&self, body: BodyId, faces: bool) -> Result<Vec<K::Solid>, KernelError> {
        let s = self.get(body).ok_or(KernelError::Invalid("that body no longer exists"))?;
        self.kernel.unjoin(s, faces)
    }

    /// Unjoin as one undoable step: `body` keeps the first piece and the rest become new bodies.
    pub fn commit_unjoin(&mut self, body: BodyId, faces: bool) -> Result<Vec<BodyId>, KernelError> {
        let mut pieces = self.preview_unjoin(body, faces)?.into_iter();
        let first = pieces.next().ok_or(KernelError::NoOp)?;
        self.checkpoint();
        self.replace_traced(body, Traced { solid: first, history: History::default() });
        let mut ids = vec![body];
        ids.extend(pieces.map(|p| self.add_unrecorded(p)));
        Ok(ids)
    }

    /// Plasticity's Pipe, without changing the document: a tube along each curve.
    pub fn preview_pipe(&self, curves: &[CurveId], radius: f64, thickness: f64, sides: u32) -> Result<Vec<K::Solid>, KernelError> {
        if curves.is_empty() { return Err(KernelError::Invalid("select the curves to run pipes along")) }
        self.cutters(curves)?.iter().map(|(path, _)| {
            let tube = crate::form::pipe(&self.kernel, path, radius, thickness, sides)?;
            if !self.kernel.is_valid(&tube) || self.kernel.solid_count(&tube) == 0 {
                return Err(KernelError::Invalid("the pipe crosses itself; use a smaller radius"));
            }
            Ok(tube)
        }).collect()
    }

    /// Pipe as one undoable step: each tube is a body of its own and the curves stay.
    pub fn commit_pipe(&mut self, curves: &[CurveId], radius: f64, thickness: f64, sides: u32) -> Result<Vec<BodyId>, KernelError> {
        let tubes = self.preview_pipe(curves, radius, thickness, sides)?;
        self.checkpoint();
        Ok(tubes.into_iter().map(|t| self.add_unrecorded(t)).collect())
    }

    /// Plasticity's Patch, without changing the document: a sheet filling one closed loop of
    /// `curves` and body `edges`, each edge with whether the sheet leaves it tangent to its body.
    pub fn preview_patch(&self, curves: &[CurveId], edges: &[(BodyId, u32, bool)]) -> Result<K::Solid, KernelError> {
        if curves.is_empty() && edges.is_empty() { return Err(KernelError::Invalid("select a closed loop of curves or edges to patch")) }
        let paths: Vec<Path> = self.cutters(curves)?.into_iter().map(|(p, _)| p).collect();
        let mut bodies: Vec<(BodyId, Vec<(u32, bool)>)> = vec![];
        for &(b, e, t) in edges {
            match bodies.iter_mut().find(|(id, _)| *id == b) {
                Some((_, list)) => list.push((e, t)),
                None => bodies.push((b, vec![(e, t)])),
            }
        }
        let mut picked = vec![];
        for (b, list) in bodies {
            picked.push((self.get(b).ok_or(KernelError::Invalid("that body no longer exists"))?, list));
        }
        self.kernel.patch(&paths, &picked)
    }

    /// Patch as one undoable step: the sheet becomes a body of its own, and the loop stays.
    pub fn commit_patch(&mut self, curves: &[CurveId], edges: &[(BodyId, u32, bool)]) -> Result<BodyId, KernelError> {
        let sheet = self.preview_patch(curves, edges)?;
        Ok(self.add(sheet))
    }

    /// Plasticity's Draft Face, without changing the document.
    pub fn preview_draft(&self, body: BodyId, faces: &[u32], pull: DVec3, origin: DVec3, angle: f64) -> Result<Traced<K::Solid>, KernelError> {
        let s = self.get(body).ok_or(KernelError::Invalid("that body no longer exists"))?;
        self.kernel.draft_faces(s, faces, pull, origin, angle)
    }

    /// Draft Face as one undoable step.
    pub fn commit_draft(&mut self, body: BodyId, faces: &[u32], pull: DVec3, origin: DVec3, angle: f64) -> Result<BodyId, KernelError> {
        let traced = self.preview_draft(body, faces, pull, origin, angle)?;
        self.checkpoint();
        self.replace_traced(body, traced);
        Ok(body)
    }

    /// Run a Cut as one undoable step: each body keeps its biggest piece; the others become new
    /// bodies. Returns every piece's id, the kept ones first for each body.
    pub fn commit_cut(&mut self, bodies: &[BodyId], curves: &[CurveId], tools: &Tools) -> Result<Vec<BodyId>, KernelError> {
        let all = self.preview_cut(bodies, curves, tools)?;
        self.checkpoint();
        let mut ids = Vec::new();
        for (id, piece, rest) in all {
            self.replace_traced(id, piece);
            ids.push(id);
            for s in rest { ids.push(self.add_unrecorded(s)); }
        }
        Ok(ids)
    }

    /// The copies Mirror or Array would make, per body in `bodies` order, without changing anything.
    fn copies(&self, bodies: &[BodyId], make: impl Fn(&K::Solid) -> Result<Vec<K::Solid>, KernelError>) -> Result<Vec<(BodyId, Vec<K::Solid>)>, KernelError> {
        if bodies.is_empty() { return Err(KernelError::Invalid("select a solid first")) }
        bodies.iter().map(|&id| {
            let s = self.get(id).ok_or(KernelError::Invalid("that body no longer exists"))?;
            Ok((id, make(s)?))
        }).collect()
    }

    /// Each body with its copies fused in; refs trace back to the body.
    fn fused(&self, body: BodyId, copies: Vec<K::Solid>) -> Result<Traced<K::Solid>, KernelError> {
        let mut cur: Option<Traced<K::Solid>> = None;
        for c in copies {
            let base = match &cur { Some(t) => &t.solid, None => self.get(body).expect("checked by copies") };
            let next = self.kernel.boolean(base, &c, BooleanOp::Union)?;
            cur = Some(match cur { Some(prev) => Traced { solid: next.solid, history: chain(&prev.history, &next.history) }, None => next });
        }
        cur.ok_or(KernelError::NoOp)
    }

    /// Put copies in the document: fused into their bodies when `join`, else as new bodies. Returns
    /// the new bodies' ids, or the joined bodies' ids.
    fn place_copies(&mut self, all: Vec<(BodyId, Vec<K::Solid>)>, join: bool) -> Result<Vec<BodyId>, KernelError> {
        if join {
            let fused = all.into_iter().map(|(id, c)| Ok((id, self.fused(id, c)?))).collect::<Result<Vec<_>, KernelError>>()?;
            self.checkpoint();
            Ok(fused.into_iter().map(|(id, t)| { self.replace_traced(id, t); id }).collect())
        } else {
            self.checkpoint();
            Ok(all.into_iter().flat_map(|(_, c)| c).map(|s| self.add_unrecorded(s)).collect())
        }
    }

    /// Mirror's copies, one per body, for a preview.
    pub fn preview_mirror(&self, bodies: &[BodyId], origin: DVec3, normal: DVec3) -> Result<Vec<K::Solid>, KernelError> {
        Ok(self.copies(bodies, |s| Ok(vec![crate::solids::mirror(&self.kernel, s, origin, normal)?]))?.into_iter().flat_map(|(_, c)| c).collect())
    }

    /// Mirror bodies in a plane as one undoable step: as new bodies, or joined to the originals.
    pub fn commit_mirror(&mut self, bodies: &[BodyId], origin: DVec3, normal: DVec3, join: bool) -> Result<Vec<BodyId>, KernelError> {
        let all = self.copies(bodies, |s| Ok(vec![crate::solids::mirror(&self.kernel, s, origin, normal)?]))?;
        self.place_copies(all, join)
    }

    /// An array's copies, for a preview.
    pub fn preview_array(&self, bodies: &[BodyId], spec: &ArraySpec) -> Result<Vec<K::Solid>, KernelError> {
        let motions = spec.motions()?;
        Ok(self.copies(bodies, |s| Ok(motions.iter().map(|m| self.kernel.transform(s, m)).collect()))?.into_iter().flat_map(|(_, c)| c).collect())
    }

    /// Rectangular or Radial Array as one undoable step: copies as new bodies, or joined.
    pub fn commit_array(&mut self, bodies: &[BodyId], spec: &ArraySpec, join: bool) -> Result<Vec<BodyId>, KernelError> {
        let motions = spec.motions()?;
        let all = self.copies(bodies, |s| Ok(motions.iter().map(|m| self.kernel.transform(s, m)).collect()))?;
        self.place_copies(all, join)
    }

    /// Extrude a closed curve's region (Plasticity's Extrude on a region).
    pub fn region_params(&self, curve: CurveId, distance: f64, operation: crate::Operation) -> Result<ExtrudeParams, KernelError> {
        let c = self.curve(curve).ok_or(KernelError::Invalid("that curve no longer exists"))?;
        let profile = c.profile().ok_or(KernelError::Invalid("only a closed curve has a region to extrude"))?;
        Ok(ExtrudeParams { profile, frame: c.frame(), distance, back: 0.0, angle: 0.0, thickness: 0.0, operation, face: None, direction: None, more_faces: vec![], individual: false })
    }

    pub fn undo(&mut self) -> bool {
        let Some(prev) = self.undo.pop() else { return false };
        self.redo.push(std::mem::replace(&mut self.state, prev));
        self.revision += 1;
        true
    }

    pub fn redo(&mut self) -> bool {
        let Some(next) = self.redo.pop() else { return false };
        self.undo.push(std::mem::replace(&mut self.state, next));
        self.revision += 1;
        true
    }
}

/// The history of doing `a` then `b`: input-0 pairs composed through the intermediate shape.
fn chain(a: &History, b: &History) -> History {
    let compose = |x: &[(u32, u32)], y: &[(u32, u32)]| {
        let mut out: Vec<(u32, u32)> = x.iter().flat_map(|&(f, m)| y.iter().filter(move |&&(m2, _)| m2 == m).map(move |&(_, t)| (f, t))).collect();
        out.sort_unstable();
        out.dedup();
        out
    };
    History { faces: [compose(&a.faces[0], &b.faces[0]), vec![]], edges: [compose(&a.edges[0], &b.edges[0]), vec![]], generated_faces: vec![] }
}

/// How far cutting sheets reach each way: 100 m, past any body the document is likely to hold.
const SHEET: f64 = 1e5;

/// Cut and Imprint's tools beside curves: faces (grown past their body), a plane, whole bodies.
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub struct Tools {
    #[serde(default)]
    pub faces: Vec<ToolFace>,
    #[serde(default)]
    pub plane: Option<ToolPlane>,
    #[serde(default)]
    pub bodies: Vec<BodyId>,
    /// Curves that aren't in the document (Offset Edge's offsets), used by Imprint like its curves.
    #[serde(default)]
    pub shapes: Vec<Curve>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct ToolFace {
    pub body: BodyId,
    pub face: u32,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct ToolPlane {
    pub origin: [f64; 3],
    pub normal: [f64; 3],
}
