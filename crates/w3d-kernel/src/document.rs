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
use crate::extrude::{extrude, ExtrudeParams, ExtrudeResult};
use crate::{BooleanOp, Frame, History, Kernel, KernelError, Motion, Profile, Traced};

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
}

impl Curve {
    pub fn frame(&self) -> Frame { Frame::new(DVec3::from_array(self.origin), DVec3::from_array(self.x), DVec3::from_array(self.normal)) }

    /// The region inside the curve, if it is closed.
    pub fn profile(&self) -> Option<Profile> {
        match &self.shape {
            CurveShape::Polyline { points, closed: true } if points.len() >= 3 => Some(Profile::Polygon(points.iter().map(|p| (p[0], p[1])).collect())),
            CurveShape::Circle { center, radius } => Some(Profile::Circle { center: (center[0], center[1]), radius: *radius }),
            _ => None,
        }
    }

    fn check(&self) -> Result<(), KernelError> {
        let finite = |a: &[f64]| a.iter().all(|v| v.is_finite());
        if !finite(&self.origin) || !finite(&self.x) || !finite(&self.normal) { return Err(KernelError::Invalid("the curve's plane is not valid")) }
        let (x, n) = (DVec3::from_array(self.x), DVec3::from_array(self.normal));
        if n.length() < 1e-9 || x.cross(n).length() < 1e-9 { return Err(KernelError::Invalid("the curve's plane is not valid")) }
        match &self.shape {
            CurveShape::Polyline { points, closed } => {
                if points.len() < 2 || (*closed && points.len() < 3) { return Err(KernelError::Invalid("a line needs two points, a closed one three")) }
                if !points.iter().all(|p| finite(p)) { return Err(KernelError::Invalid("a point is not a number")) }
            }
            CurveShape::Circle { center, radius } => {
                if !finite(center) || !(*radius > 0.0) || !radius.is_finite() { return Err(KernelError::Invalid("the circle's radius must be greater than zero")) }
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
        match self.preview_extrude(target, p)? {
            ExtrudeResult::New(solid) => Ok(self.add(solid)),
            ExtrudeResult::Replace { solid, history, .. } => {
                let id = target.expect("a replace always has a target");
                self.checkpoint();
                self.replace_traced(id, Traced { solid, history });
                Ok(id)
            }
        }
    }

    /// Extrude a closed curve's region (Plasticity's Extrude on a region).
    pub fn region_params(&self, curve: CurveId, distance: f64, operation: crate::Operation) -> Result<ExtrudeParams, KernelError> {
        let c = self.curve(curve).ok_or(KernelError::Invalid("that curve no longer exists"))?;
        let profile = c.profile().ok_or(KernelError::Invalid("only a closed curve has a region to extrude"))?;
        Ok(ExtrudeParams { profile, frame: c.frame(), distance, operation, face: None })
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
