//! The model: named bodies plus whole-document undo, after Plasticity's GeometryDatabase and
//! History mementos (src/editor/History.ts:19-33). Solids are immutable once made, so a snapshot
//! is just a list of shared pointers and undo costs no geometry work.

use std::collections::BTreeMap;
use std::rc::Rc;

use crate::blend::{blend, BlendParams};
use crate::extrude::{extrude, ExtrudeParams, ExtrudeResult};
use crate::{Kernel, KernelError};

/// Length unit of every coordinate in a document. Fixed for now; stored in files so a later
/// version can convert.
pub const UNITS: &str = "mm";
/// Distance under which two points count as the same, in [`UNITS`]. OpenCascade's own default.
pub const TOLERANCE: f64 = 1e-7;

pub type BodyId = u32;

struct Snapshot<S> {
    bodies: BTreeMap<BodyId, Rc<S>>,
    next_id: BodyId,
}

impl<S> Clone for Snapshot<S> {
    fn clone(&self) -> Self { Snapshot { bodies: self.bodies.clone(), next_id: self.next_id } }
}

pub struct Document<K: Kernel> {
    pub kernel: K,
    state: Snapshot<K::Solid>,
    undo: Vec<Snapshot<K::Solid>>,
    redo: Vec<Snapshot<K::Solid>>,
}

impl<K: Kernel> Document<K> {
    pub fn new(kernel: K) -> Self {
        Document { kernel, state: Snapshot { bodies: BTreeMap::new(), next_id: 1 }, undo: vec![], redo: vec![] }
    }

    pub fn ids(&self) -> Vec<BodyId> { self.state.bodies.keys().copied().collect() }
    pub fn get(&self, id: BodyId) -> Option<&K::Solid> { self.state.bodies.get(&id).map(|s| &**s) }

    /// Forget undo and redo, e.g. after loading a file or seeding a new document.
    pub fn clear_history(&mut self) {
        self.undo.clear();
        self.redo.clear();
    }

    fn checkpoint(&mut self) {
        self.undo.push(self.state.clone());
        self.redo.clear();
    }

    pub fn add(&mut self, solid: K::Solid) -> BodyId {
        self.checkpoint();
        let id = self.state.next_id;
        self.state.next_id += 1;
        self.state.bodies.insert(id, Rc::new(solid));
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

    /// Replace everything, e.g. when opening a file. History starts empty.
    pub fn replace_all(&mut self, bodies: impl IntoIterator<Item = (BodyId, K::Solid)>, next_id: BodyId) {
        let bodies: BTreeMap<_, _> = bodies.into_iter().map(|(id, s)| (id, Rc::new(s))).collect();
        let next_id = next_id.max(bodies.keys().max().map_or(1, |m| m + 1));
        self.state = Snapshot { bodies, next_id };
        self.clear_history();
    }

    /// Compute a fillet or chamfer without changing the document.
    pub fn preview_blend(&self, body: BodyId, p: &BlendParams) -> Result<K::Solid, KernelError> {
        let solid = self.get(body).ok_or(KernelError::Invalid("that body no longer exists"))?;
        blend(&self.kernel, solid, p)
    }

    /// Run a fillet or chamfer and record it as one undoable step.
    pub fn commit_blend(&mut self, body: BodyId, p: &BlendParams) -> Result<BodyId, KernelError> {
        let solid = self.preview_blend(body, p)?;
        self.checkpoint();
        self.state.bodies.insert(body, Rc::new(solid));
        Ok(body)
    }

    /// Compute an extrude without changing the document: what a live preview shows.
    pub fn preview_extrude(&self, target: Option<BodyId>, p: &ExtrudeParams) -> Result<ExtrudeResult<K::Solid>, KernelError> {
        extrude(&self.kernel, target.and_then(|id| self.get(id)), p)
    }

    /// Run an extrude and record it as one undoable step. Returns the body it created or changed.
    pub fn commit_extrude(&mut self, target: Option<BodyId>, p: &ExtrudeParams) -> Result<BodyId, KernelError> {
        match self.preview_extrude(target, p)? {
            ExtrudeResult::New(solid) => Ok(self.add(solid)),
            ExtrudeResult::Replace { solid, .. } => {
                let id = target.expect("a replace always has a target");
                self.checkpoint();
                self.state.bodies.insert(id, Rc::new(solid));
                Ok(id)
            }
        }
    }

    pub fn undo(&mut self) -> bool {
        let Some(prev) = self.undo.pop() else { return false };
        self.redo.push(std::mem::replace(&mut self.state, prev));
        true
    }

    pub fn redo(&mut self) -> bool {
        let Some(next) = self.redo.pop() else { return false };
        self.undo.push(std::mem::replace(&mut self.state, next));
        true
    }
}
