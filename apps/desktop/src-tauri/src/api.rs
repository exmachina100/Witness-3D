//! What the viewport can ask of the model, as plain data. Kept apart from Tauri so it can be tested
//! without a window.

use std::path::PathBuf;

use glam::DVec3;
use serde::{Deserialize, Serialize};
use w3d_kernel::document::{BodyId, Document};
use w3d_kernel::engine::Engine;
use w3d_kernel::occt::Occt;
use w3d_kernel::{BooleanOp, ExtrudeParams, ExtrudeResult, Frame, Kernel, KernelError, Operation, Profile, Tessellation};

/// Chord tolerance for display meshes, in model units.
const MESH_TOLERANCE: f64 = 0.01;

pub type Model = Engine<Occt>;

pub fn start() -> Model {
    let engine = Engine::new(|| Occt);
    engine.call(|doc| {
        let body = doc.kernel.box_from_corners(DVec3::new(-2.0, 0.0, -1.5), DVec3::new(2.0, 2.0, 1.5));
        doc.add(body);
        doc.clear_history();
    });
    engine
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
