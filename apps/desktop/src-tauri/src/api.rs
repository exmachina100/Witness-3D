//! What the viewport can ask of the model, as plain data. Kept apart from Tauri so it can be tested
//! without a window.

use std::path::PathBuf;

use glam::DVec3;
use serde::{Deserialize, Serialize};
use w3d_kernel::document::{BodyId, Document};
use w3d_kernel::engine::Engine;
use w3d_kernel::occt::Occt;
use w3d_kernel::{file, Blend, BlendParams, BooleanOp, ExtrudeParams, ExtrudeResult, Frame, Kernel, KernelError, Operation, Profile, Tessellation};

/// Chord tolerance for display meshes, in millimetres.
const MESH_TOLERANCE: f64 = 0.05;

pub type Model = Engine<Occt>;

/// The product-enclosure blank every new document starts with: 80 × 30 × 50 mm on the ground.
fn seed(doc: &mut Document<Occt>) {
    let body = doc.kernel.box_from_corners(DVec3::new(-40.0, 0.0, -25.0), DVec3::new(40.0, 30.0, 25.0));
    doc.replace_all([(1, body)], 2);
}

pub fn start() -> Model {
    let engine = Engine::new(|| Occt);
    engine.call(seed);
    engine
}

/// An error the viewport can act on: what to tell the user, and the edges to point at if the
/// kernel named any.
#[derive(Serialize, Debug)]
pub struct ApiError {
    pub message: String,
    pub edges: Vec<u32>,
}

impl From<KernelError> for ApiError {
    fn from(e: KernelError) -> Self {
        let edges = if let KernelError::Blend { edges, .. } = &e { edges.clone() } else { vec![] };
        ApiError { message: e.to_string(), edges }
    }
}

impl From<String> for ApiError {
    fn from(message: String) -> Self { ApiError { message, edges: vec![] } }
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Body {
    pub id: BodyId,
    /// x, y, z per vertex.
    pub positions: Vec<f32>,
    pub indices: Vec<u32>,
    /// The B-rep face each triangle belongs to.
    pub face_ids: Vec<u32>,
    /// Per face: its plane if flat, else null.
    pub face_planes: Vec<Option<FacePlane>>,
    /// Each edge as a polyline, x, y, z per point.
    pub edges: Vec<Vec<f32>>,
    pub volume: f64,
}

#[derive(Serialize, Debug)]
pub struct FacePlane {
    pub origin: [f64; 3],
    pub normal: [f64; 3],
}

#[derive(Deserialize, Debug, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ProfileShape {
    Rect { width: f64, height: f64 },
    Circle { radius: f64 },
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExtrudeRequest {
    /// The body the sketch sits on; none when sketching on the ground.
    pub target: Option<BodyId>,
    pub origin: [f64; 3],
    pub normal: [f64; 3],
    pub x_axis: [f64; 3],
    pub profile: ProfileShape,
    pub distance: f64,
    #[serde(default)]
    pub new_body: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Outcome { Join, Cut, New, None }

#[derive(Serialize, Debug)]
pub struct Preview {
    pub outcome: Outcome,
    /// The extruded profile alone, drawn as a translucent phantom.
    pub tool: Option<Body>,
    /// The target body as it would be after the join or cut.
    pub result: Option<Body>,
}

#[derive(Serialize, Debug)]
pub struct Committed {
    pub id: BodyId,
    pub scene: Vec<Body>,
}

fn body(k: &Occt, id: BodyId, solid: &<Occt as Kernel>::Solid) -> Result<Body, String> {
    let t: Tessellation = k.tessellate(solid, MESH_TOLERANCE).map_err(|e| e.to_string())?;
    Ok(Body {
        id,
        volume: t.volume(),
        positions: t.positions.iter().flatten().map(|&c| c as f32).collect(),
        indices: t.indices,
        face_ids: t.face_ids,
        face_planes: t.face_planes.iter().map(|p| p.map(|p| FacePlane { origin: p.origin.to_array(), normal: p.normal.to_array() })).collect(),
        edges: t.edges.iter().map(|e| e.iter().flatten().map(|&c| c as f32).collect()).collect(),
    })
}

fn bodies(doc: &Document<Occt>) -> Result<Vec<Body>, String> {
    doc.ids().into_iter().map(|id| body(&doc.kernel, id, doc.get(id).unwrap())).collect()
}

impl ExtrudeRequest {
    fn params(&self) -> ExtrudeParams {
        let profile = match self.profile {
            ProfileShape::Rect { width, height } => Profile::rectangle(width, height),
            ProfileShape::Circle { radius } => Profile::Circle { center: (0.0, 0.0), radius },
        };
        ExtrudeParams {
            profile,
            frame: Frame::new(DVec3::from_array(self.origin), DVec3::from_array(self.x_axis), DVec3::from_array(self.normal)),
            distance: self.distance,
            operation: if self.new_body { Operation::NewBody } else { Operation::Auto },
        }
    }
}

pub fn scene(m: &Model) -> Result<Vec<Body>, String> {
    m.call(|doc| bodies(doc))
}

/// `None` means a newer drag arrived first and this one was skipped.
pub fn preview(m: &Model, req: ExtrudeRequest) -> Option<Result<Preview, String>> {
    m.preview(move |doc| {
        let p = req.params();
        let result = match doc.preview_extrude(req.target, &p) {
            Err(KernelError::NoOp) => return Ok(Preview { outcome: Outcome::None, tool: None, result: None }),
            r => r.map_err(|e| e.to_string())?,
        };
        let tool = doc.kernel.extrude(&p.profile, &p.frame, p.distance).map_err(|e| e.to_string())?;
        let tool = Some(body(&doc.kernel, 0, &tool)?);
        Ok(match result {
            ExtrudeResult::New(_) => Preview { outcome: Outcome::New, tool, result: None },
            ExtrudeResult::Replace { solid, op } => Preview {
                outcome: if op == BooleanOp::Union { Outcome::Join } else { Outcome::Cut },
                result: Some(body(&doc.kernel, req.target.unwrap(), &solid)?),
                tool,
            },
        })
    })
}

pub fn commit(m: &Model, req: ExtrudeRequest) -> Result<Committed, String> {
    m.call(move |doc| {
        let id = doc.commit_extrude(req.target, &req.params()).map_err(|e| e.to_string())?;
        Ok(Committed { id, scene: bodies(doc)? })
    })
}

pub fn undo(m: &Model) -> Result<Vec<Body>, String> {
    m.call(|doc| { doc.undo(); bodies(doc) })
}

pub fn redo(m: &Model) -> Result<Vec<Body>, String> {
    m.call(|doc| { doc.redo(); bodies(doc) })
}

pub fn export_step(m: &Model, id: BodyId, path: PathBuf) -> Result<(), String> {
    m.call(move |doc| {
        let solid = doc.get(id).ok_or("no such body")?;
        doc.kernel.write_step(solid, &path).map_err(|e| e.to_string())
    })
}

#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BlendKind { Fillet, Chamfer }

#[derive(Deserialize, Debug, Clone)]
pub struct BlendRequest {
    pub body: BodyId,
    /// Edge numbers, as indices into the body's `edges`.
    pub edges: Vec<u32>,
    /// Radius or distance, in millimetres.
    pub size: f64,
    pub kind: BlendKind,
}

impl BlendRequest {
    fn params(&self) -> BlendParams {
        BlendParams {
            edges: self.edges.clone(),
            size: self.size,
            kind: if self.kind == BlendKind::Chamfer { Blend::Chamfer } else { Blend::Fillet },
        }
    }
}

/// The body as it would be after the fillet or chamfer. `None` means a newer request superseded it.
pub fn preview_blend(m: &Model, req: BlendRequest) -> Option<Result<Body, ApiError>> {
    m.preview(move |doc| {
        let solid = doc.preview_blend(req.body, &req.params())?;
        Ok(body(&doc.kernel, req.body, &solid)?)
    })
}

pub fn commit_blend(m: &Model, req: BlendRequest) -> Result<Committed, ApiError> {
    m.call(move |doc| {
        let id = doc.commit_blend(req.body, &req.params())?;
        Ok(Committed { id, scene: bodies(doc)? })
    })
}

/// Start over with the seed enclosure.
pub fn new_document(m: &Model) -> Result<Vec<Body>, String> {
    m.call(|doc| { seed(doc); bodies(doc) })
}

pub fn save(m: &Model, path: PathBuf) -> Result<(), String> {
    m.call(move |doc| file::save(doc, &path).map_err(|e| e.to_string()))
}

/// Replace the document with a saved one. History starts empty.
pub fn open(m: &Model, path: PathBuf) -> Result<Vec<Body>, String> {
    m.call(move |doc| { file::open(doc, &path).map_err(|e| e.to_string())?; bodies(doc) })
}

/// Add the STEP file's geometry as one new body, as an undoable step.
pub fn import_step(m: &Model, path: PathBuf) -> Result<Committed, String> {
    m.call(move |doc| {
        let solid = doc.kernel.read_step(&path).map_err(|e| e.to_string())?;
        let id = doc.add(solid);
        Ok(Committed { id, scene: bodies(doc)? })
    })
}
