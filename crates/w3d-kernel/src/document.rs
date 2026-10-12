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
use crate::form::{form, offset_faces, FormKind, FormParams};
use crate::{BooleanOp, Frame, History, Kernel, KernelError, Motion, Path, Profile, Segment, Traced};

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
#[derive(Clone, Copy, Debug)]
pub enum FormRequest {
    Revolve { axis_point: DVec3, axis_dir: DVec3, angle: f64, thickness: f64 },
    Loft,
    /// Sweep along the curve `path`.
    Sweep { path: CurveId, twist: f64, scale: f64 },
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
}

impl Curve {
    pub fn frame(&self) -> Frame { Frame::new(DVec3::from_array(self.origin), DVec3::from_array(self.x), DVec3::from_array(self.normal)) }

    /// The region inside the curve, if it is closed.
    pub fn profile(&self) -> Option<Profile> {
        match &self.shape {
            CurveShape::Polyline { points, closed: true } if points.len() >= 3 => Some(Profile::Polygon(points.iter().map(|p| (p[0], p[1])).collect())),
            CurveShape::Circle { center, radius } => Some(Profile::Circle { center: (center[0], center[1]), radius: *radius }),
            CurveShape::Spline { points, closed: true } if points.len() >= 3 => Some(Profile::Spline(points.iter().map(|p| (p[0], p[1])).collect())),
            CurveShape::Ellipse { center, major, minor } => Some(Profile::Ellipse { center: (center[0], center[1]), major: (major[0], major[1]), minor: *minor }),
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

    fn path_of(f: &Frame, shape: &CurveShape) -> Path {
        let f = *f;
        match shape {
            CurveShape::Polyline { points, closed } => Path::Polyline { points: points.iter().map(|p| f.point((p[0], p[1]))).collect(), closed: *closed },
            CurveShape::Circle { center, radius } => Path::Circle { center: f.point((center[0], center[1])), normal: f.normal, radius: *radius },
            CurveShape::Spline { points, closed } => Path::Spline { points: points.iter().map(|p| f.point((p[0], p[1]))).collect(), closed: *closed },
            CurveShape::Arc { start, mid, end } => Path::Arc { start: f.point((start[0], start[1])), mid: f.point((mid[0], mid[1])), end: f.point((end[0], end[1])) },
            CurveShape::Ellipse { center, major, minor } => Path::Ellipse { center: f.point((center[0], center[1])), normal: f.normal, major: f.point((major[0], major[1])) - f.origin, minor: *minor },
            CurveShape::Contour { pieces } => Path::Contour(pieces.iter().map(|p| Self::path_of(&f, p)).collect()),
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
}

impl<K: Kernel> Document<K> {
    pub fn new(kernel: K) -> Self {
        Document { kernel, state: Snapshot::empty(1, 1), undo: vec![], redo: vec![], revision: 0 }
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
            FormRequest::Loft => FormKind::Loft { more: rest.iter().map(|&id| self.region(id)).collect::<Result<_, _>>()? },
            FormRequest::Sweep { path, twist, scale } => {
                if regions.contains(&path) { return Err(KernelError::Invalid("pick a path other than the profile")) }
                let path = self.curve(path).ok_or(KernelError::Invalid("that path no longer exists"))?.path();
                FormKind::Sweep { path, twist, scale }
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
    pub fn preview_offset(&self, body: BodyId, faces: &[u32], distance: f64) -> Result<K::Solid, KernelError> {
        let solid = self.get(body).ok_or(KernelError::Invalid("that body no longer exists"))?;
        Ok(offset_faces(&self.kernel, solid, faces, distance)?.solid)
    }

    /// Run an Offset Face as one undoable step; faces and edges keep their refs.
    pub fn commit_offset(&mut self, body: BodyId, faces: &[u32], distance: f64) -> Result<BodyId, KernelError> {
        let solid = self.get(body).ok_or(KernelError::Invalid("that body no longer exists"))?;
        let t = offset_faces(&self.kernel, solid, faces, distance)?;
        self.checkpoint();
        self.replace_traced(body, t);
        Ok(body)
    }

    /// Extrude a closed curve's region (Plasticity's Extrude on a region).
    pub fn region_params(&self, curve: CurveId, distance: f64, operation: crate::Operation) -> Result<ExtrudeParams, KernelError> {
        let c = self.curve(curve).ok_or(KernelError::Invalid("that curve no longer exists"))?;
        let profile = c.profile().ok_or(KernelError::Invalid("only a closed curve has a region to extrude"))?;
        Ok(ExtrudeParams { profile, frame: c.frame(), distance, back: 0.0, angle: 0.0, thickness: 0.0, operation, face: None })
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
