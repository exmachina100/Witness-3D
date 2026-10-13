//! What the viewport can ask of the model, as plain data. Kept apart from Tauri so it can be tested
//! without a window.

use std::path::PathBuf;

use glam::DVec3;
use serde::{Deserialize, Serialize};
use w3d_kernel::document::{BodyId, Document, FormRequest as FormKindRequest};
use w3d_kernel::engine::Engine;
use w3d_kernel::occt::Occt;
use w3d_kernel::{extrude, file, form, FormParams, Blend, BlendParams, BooleanOp, Curve, CurveId, CurveShape, ExtrudeParams, ExtrudeResult, Frame, Kernel, KernelError, Motion, Operation, Profile, Ref, Refs, Tessellation};

/// Chord tolerance for display meshes, in millimetres.
const MESH_TOLERANCE: f64 = 0.05;

pub type Model = Engine<Occt>;

/// The product-enclosure blank every new document starts with: 80 × 30 × 50 mm on the ground.
fn seed(doc: &mut Document<Occt>) {
    let body = doc.kernel.box_from_corners(DVec3::new(-40.0, 0.0, -25.0), DVec3::new(40.0, 30.0, 25.0));
    doc.replace_all([(1, body, None)], 2, 1);
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
    /// Persistent ids of the faces and edges, by number; empty for previews of new geometry.
    /// A selection kept as refs survives edits that renumber the body.
    pub face_refs: Vec<Ref>,
    pub edge_refs: Vec<Ref>,
    /// The document revision this body was drawn from.
    pub revision: u64,
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

#[derive(Deserialize, Debug, Clone, Copy, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum OpChoice {
    /// Join pulling out, cut pushing in.
    #[default]
    Auto,
    Union,
    Difference,
    Intersect,
    New,
    /// Shift+Q: cut the body in two along the extrude.
    Slice,
}

/// What to extrude: a push/pull sketch (`profile` at `origin`), a drawn region (`region`, a closed
/// curve's id) or a face of the target (`face`).
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExtrudeRequest {
    /// The body to join or cut; none for a separate body.
    pub target: Option<BodyId>,
    #[serde(default)]
    pub origin: [f64; 3],
    #[serde(default = "up")]
    pub normal: [f64; 3],
    #[serde(default = "east")]
    pub x_axis: [f64; 3],
    pub profile: Option<ProfileShape>,
    #[serde(default)]
    pub region: Option<CurveId>,
    #[serde(default)]
    pub face: Option<u32>,
    pub distance: f64,
    #[serde(default)]
    pub new_body: bool,
    /// Plasticity's Q, W, Shift+E and B inside Extrude.
    #[serde(default)]
    pub op: OpChoice,
    /// The other way as well (S locks it to `distance`).
    #[serde(default)]
    pub back: f64,
    /// Radians the sides lean in (A).
    #[serde(default)]
    pub angle: f64,
    /// Wall thickness; zero for a filled solid (Shift+T).
    #[serde(default)]
    pub thickness: f64,
}

fn east() -> [f64; 3] { [1.0, 0.0, 0.0] }

#[derive(Serialize, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Outcome { Join, Cut, Intersect, New, Slice, None }

#[derive(Serialize, Debug)]
pub struct Preview {
    pub outcome: Outcome,
    /// The extruded profile alone, drawn as a translucent phantom.
    pub tool: Option<Body>,
    /// The target body as it would be after the join or cut.
    pub result: Option<Body>,
    /// For a slice, the part cut off, which becomes a new body.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub piece: Option<Body>,
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
        face_refs: vec![],
        edge_refs: vec![],
        revision: 0,
    })
}

/// A committed body, with its refs and the document revision.
fn doc_body(doc: &Document<Occt>, id: BodyId) -> Result<Body, String> {
    let mut b = body(&doc.kernel, id, doc.get(id).ok_or("no such body")?)?;
    let Refs { faces, edges } = doc.refs(id).cloned().unwrap_or_default();
    (b.face_refs, b.edge_refs, b.revision) = (faces, edges, doc.revision());
    Ok(b)
}

fn bodies(doc: &Document<Occt>) -> Result<Vec<Body>, String> {
    doc.ids().into_iter().map(|id| doc_body(doc, id)).collect()
}

impl ExtrudeRequest {
    fn operation(&self) -> Operation {
        match self.op {
            _ if self.new_body => Operation::NewBody,
            OpChoice::Auto => Operation::Auto,
            OpChoice::Union => Operation::Union,
            OpChoice::Difference => Operation::Difference,
            OpChoice::Intersect => Operation::Intersect,
            OpChoice::New => Operation::NewBody,
            OpChoice::Slice => Operation::Slice,
        }
    }

    fn params(&self, doc: &Document<Occt>) -> Result<ExtrudeParams, String> {
        if let Some(id) = self.region {
            let p = doc.region_params(id, self.distance, self.operation()).map_err(|e| e.to_string())?;
            return Ok(ExtrudeParams { back: self.back, angle: self.angle, thickness: self.thickness, ..p });
        }
        let profile = match self.profile {
            Some(ProfileShape::Rect { width, height }) => Profile::rectangle(width, height),
            Some(ProfileShape::Circle { radius }) => Profile::Circle { center: (0.0, 0.0), radius },
            None if self.face.is_some() => Profile::rectangle(1.0, 1.0),
            None => return Err("say what to extrude: a profile, a region or a face".into()),
        };
        Ok(ExtrudeParams {
            profile,
            frame: Frame::new(DVec3::from_array(self.origin), DVec3::from_array(self.x_axis), DVec3::from_array(self.normal)),
            distance: self.distance,
            back: self.back,
            angle: self.angle,
            thickness: self.thickness,
            operation: self.operation(),
            face: self.face,
        })
    }
}

pub fn scene(m: &Model) -> Result<Vec<Body>, String> {
    m.call(|doc| bodies(doc))
}

/// `None` means a newer drag arrived first and this one was skipped.
pub fn preview(m: &Model, req: ExtrudeRequest) -> Option<Result<Preview, String>> {
    m.preview(move |doc| {
        let p = req.params(doc)?;
        let result = match doc.preview_extrude(req.target, &p) {
            Err(KernelError::NoOp) => return Ok(Preview { outcome: Outcome::None, tool: None, result: None, piece: None }),
            r => r.map_err(|e| e.to_string())?,
        };
        let tool = extrude::tool(&doc.kernel, req.target.and_then(|id| doc.get(id)), &p).map_err(|e| e.to_string())?;
        let tool = Some(body(&doc.kernel, 0, &tool)?);
        Ok(preview_of(doc, req.target, result, tool)?)
    })
}

pub fn commit(m: &Model, req: ExtrudeRequest) -> Result<Committed, String> {
    m.call(move |doc| {
        let p = req.params(doc)?;
        let id = doc.commit_extrude(req.target, &p).map_err(|e| e.to_string())?;
        Ok(Committed { id, scene: bodies(doc)? })
    })
}

/// Revolve, Loft or Sweep of drawn regions (Plasticity's commands of those names).
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FormRequest {
    /// The body to join, cut or intersect with; ignored for a new body.
    pub target: Option<BodyId>,
    /// Closed curves whose regions are the profiles; a loft takes them in this order.
    pub regions: Vec<CurveId>,
    pub kind: FormName,
    /// Revolve: a point on the axis and its direction.
    #[serde(default)]
    pub axis_point: [f64; 3],
    #[serde(default = "up")]
    pub axis_dir: [f64; 3],
    /// Revolve: how far to turn, in radians.
    #[serde(default = "turn")]
    pub angle: f64,
    /// Revolve: walls this thick instead of a filled solid (Shift+T); zero for solid.
    #[serde(default)]
    pub thickness: f64,
    /// Sweep: the curve to follow.
    #[serde(default)]
    pub path: Option<CurveId>,
    /// Sweep: the far end's turn in radians and scale.
    #[serde(default)]
    pub twist: f64,
    #[serde(default = "one")]
    pub scale: f64,
    /// New body unless Q, W or Shift+E asks for a boolean.
    #[serde(default = "new_op")]
    pub op: OpChoice,
}

#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FormName { Revolve, Loft, Sweep }

fn turn() -> f64 { std::f64::consts::TAU }
fn new_op() -> OpChoice { OpChoice::New }

impl FormRequest {
    fn params(&self, doc: &Document<Occt>) -> Result<FormParams, ApiError> {
        let kind = match self.kind {
            FormName::Revolve => FormKindRequest::Revolve { axis_point: DVec3::from_array(self.axis_point), axis_dir: DVec3::from_array(self.axis_dir), angle: self.angle, thickness: self.thickness },
            FormName::Loft => FormKindRequest::Loft,
            FormName::Sweep => FormKindRequest::Sweep { path: self.path.ok_or_else(|| ApiError::from(String::from("pick the path to sweep along")))?, twist: self.twist, scale: self.scale },
        };
        let operation = match self.op {
            OpChoice::Union => Operation::Union,
            OpChoice::Difference => Operation::Difference,
            OpChoice::Intersect => Operation::Intersect,
            OpChoice::Slice => Operation::Slice,
            OpChoice::New | OpChoice::Auto => Operation::NewBody,
        };
        Ok(doc.form_params(&self.regions, kind, operation)?)
    }
}

fn preview_of(doc: &Document<Occt>, target: Option<BodyId>, result: ExtrudeResult<<Occt as Kernel>::Solid>, tool: Option<Body>) -> Result<Preview, String> {
    Ok(match result {
        ExtrudeResult::New(solid) => Preview { outcome: Outcome::New, tool: Some(match tool { Some(t) => t, None => body(&doc.kernel, 0, &solid)? }), result: None, piece: None },
        ExtrudeResult::Replace { solid, op, .. } => Preview {
            outcome: match op { BooleanOp::Union => Outcome::Join, BooleanOp::Difference => Outcome::Cut, BooleanOp::Intersection => Outcome::Intersect },
            result: Some(body(&doc.kernel, target.unwrap(), &solid)?),
            tool,
            piece: None,
        },
        ExtrudeResult::Slice { solid, piece, .. } => Preview {
            outcome: Outcome::Slice,
            result: Some(body(&doc.kernel, target.unwrap(), &solid)?),
            piece: Some(body(&doc.kernel, doc.next_id(), &piece)?),
            tool,
        },
    })
}

/// What a Revolve, Loft or Sweep would make. `None` means a newer request superseded it.
pub fn preview_form(m: &Model, req: FormRequest) -> Option<Result<Preview, ApiError>> {
    m.preview(move |doc| {
        let p = req.params(doc)?;
        let target = req.target.filter(|_| p.operation != Operation::NewBody);
        let result = match doc.preview_form(target, &p) {
            Err(KernelError::NoOp) => return Ok(Preview { outcome: Outcome::None, tool: None, result: None, piece: None }),
            r => r?,
        };
        let tool = match &result {
            ExtrudeResult::New(_) => None,
            ExtrudeResult::Replace { .. } | ExtrudeResult::Slice { .. } => Some(body(&doc.kernel, 0, &form::tool(&doc.kernel, &p)?)?),
        };
        Ok(preview_of(doc, target, result, tool)?)
    })
}

/// Run a Revolve, Loft or Sweep as one undoable step.
pub fn commit_form(m: &Model, req: FormRequest) -> Result<Committed, ApiError> {
    m.call(move |doc| {
        let p = req.params(doc)?;
        let target = req.target.filter(|_| p.operation != Operation::NewBody);
        let id = doc.commit_form(target, &p)?;
        Ok(Committed { id, scene: bodies(doc)? })
    })
}

/// Offset Face: faces of one body moved along their normals.
#[derive(Deserialize, Debug, Clone)]
pub struct OffsetRequest {
    pub body: BodyId,
    pub faces: Vec<u32>,
    pub distance: f64,
    /// Radians the neighbouring faces lean (A, Angle Adjacent); positive shrinks the face.
    #[serde(default)]
    pub angle: f64,
}

/// The body as it would be after the offset. `None` means a newer request superseded it.
pub fn preview_offset(m: &Model, req: OffsetRequest) -> Option<Result<Body, ApiError>> {
    m.preview(move |doc| {
        let solid = doc.preview_offset(req.body, &req.faces, req.distance, req.angle)?;
        Ok(body(&doc.kernel, req.body, &solid)?)
    })
}

pub fn commit_offset(m: &Model, req: OffsetRequest) -> Result<Committed, ApiError> {
    m.call(move |doc| {
        let id = doc.commit_offset(req.body, &req.faces, req.distance, req.angle)?;
        Ok(Committed { id, scene: bodies(doc)? })
    })
}

/// A drawn curve as the viewport gets it: its id plus the curve.
#[derive(Serialize, Debug)]
pub struct CurveOut {
    pub id: CurveId,
    #[serde(flatten)]
    pub curve: Curve,
    /// For a spline or a joined contour, points along it in its plane, which the viewport draws.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub samples: Option<Vec<[f64; 2]>>,
}

/// Points along a curve the viewport can't draw itself, in its plane: a spline, or a contour piece
/// by piece so its corners stay sharp.
fn samples(k: &Occt, curve: &Curve) -> Option<Vec<[f64; 2]>> {
    let f = curve.frame();
    let flat = |pts: Vec<glam::DVec3>| pts.iter().map(|p| { let d = *p - f.origin; [d.dot(f.x), d.dot(f.y())] }).collect::<Vec<_>>();
    match &curve.shape {
        CurveShape::Spline { .. } => Some(flat(k.sample(&curve.path(), 64).unwrap_or_default())),
        CurveShape::Contour { pieces } => {
            let mut out: Vec<[f64; 2]> = Vec::new();
            for piece in pieces {
                let part = match piece {
                    CurveShape::Polyline { points, .. } => points.clone(),
                    _ => flat(k.sample(&Curve { shape: piece.clone(), ..curve.clone() }.path(), 32).unwrap_or_default()),
                };
                out.extend(part.into_iter().skip(if out.is_empty() { 0 } else { 1 }));
            }
            Some(out)
        }
        _ => None,
    }
}

pub fn curves(m: &Model) -> Vec<CurveOut> {
    m.call(|doc| {
        doc.curve_ids().into_iter().map(|id| {
            let curve = doc.curve(id).unwrap().clone();
            let samples = samples(&doc.kernel, &curve);
            CurveOut { id, curve, samples }
        }).collect()
    })
}

#[derive(Serialize, Debug)]
pub struct AddedCurves {
    pub ids: Vec<CurveId>,
}

/// Add drawn curves, as one undoable step.
pub fn add_curves(m: &Model, curves: Vec<Curve>) -> Result<AddedCurves, ApiError> {
    m.call(move |doc| Ok(AddedCurves { ids: doc.commit_curves(curves)? }))
}

/// Join Curves (J): the curves replaced by their joined runs, as one undoable step.
pub fn join_curves(m: &Model, ids: Vec<CurveId>) -> Result<AddedCurves, ApiError> {
    m.call(move |doc| Ok(AddedCurves { ids: doc.commit_join(&ids)? }))
}

/// Delete bodies and curves together, as one undoable step.
pub fn delete_items(m: &Model, bodies_: Vec<BodyId>, curves: Vec<CurveId>) -> Result<Vec<Body>, ApiError> {
    m.call(move |doc| { doc.commit_delete_items(&bodies_, &curves)?; Ok(bodies(doc)?) })
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BooleanRequest {
    pub target: BodyId,
    pub tools: Vec<BodyId>,
    pub op: OpChoice,
    #[serde(default)]
    pub keep_tools: bool,
}

impl BooleanRequest {
    /// The boolean to run, or `None` for Shift+Q's slice.
    fn op(&self) -> Result<Option<BooleanOp>, ApiError> {
        match self.op {
            OpChoice::Union | OpChoice::Auto => Ok(Some(BooleanOp::Union)),
            OpChoice::Difference => Ok(Some(BooleanOp::Difference)),
            OpChoice::Intersect => Ok(Some(BooleanOp::Intersection)),
            OpChoice::Slice => Ok(None),
            OpChoice::New => Err(String::from("a boolean needs union, difference, intersect or slice").into()),
        }
    }
}

/// The target after a boolean, and for a slice the pieces cut off it.
#[derive(Serialize, Debug)]
pub struct BooleanPreview {
    #[serde(flatten)]
    pub body: Body,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub pieces: Vec<Body>,
}

/// The target as it would be after the boolean. `None` means a newer request superseded it.
pub fn preview_boolean(m: &Model, req: BooleanRequest) -> Option<Result<BooleanPreview, ApiError>> {
    m.preview(move |doc| {
        match req.op()? {
            Some(op) => {
                let t = doc.preview_boolean(req.target, &req.tools, op)?;
                Ok(BooleanPreview { body: body(&doc.kernel, req.target, &t.solid)?, pieces: vec![] })
            }
            None => {
                let (rest, pieces) = doc.preview_boolean_slice(req.target, &req.tools)?;
                let pieces = pieces.iter().map(|p| body(&doc.kernel, 0, p)).collect::<Result<_, _>>()?;
                Ok(BooleanPreview { body: body(&doc.kernel, req.target, &rest.solid)?, pieces })
            }
        }
    })
}

/// Plasticity's Boolean, as one undoable step: the target changes and the tools go unless kept. A
/// slice also adds the pieces as new bodies.
pub fn commit_boolean(m: &Model, req: BooleanRequest) -> Result<Committed, ApiError> {
    m.call(move |doc| {
        match req.op()? {
            Some(op) => { doc.commit_boolean(req.target, &req.tools, op, req.keep_tools)?; }
            None => { doc.commit_boolean_slice(req.target, &req.tools, req.keep_tools)?; }
        }
        Ok(Committed { id: req.target, scene: bodies(doc)? })
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
    /// Chamfer angle from each edge's first face, in radians; π/4 (the default) is equal distances.
    #[serde(default = "equal")]
    pub angle: f64,
}

fn equal() -> f64 { w3d_kernel::blend::EQUAL }

impl BlendRequest {
    fn params(&self) -> BlendParams {
        BlendParams {
            edges: self.edges.clone(),
            size: self.size,
            kind: if self.kind == BlendKind::Chamfer { Blend::Chamfer } else { Blend::Fillet },
            angle: self.angle,
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

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MotionRequest {
    pub bodies: Vec<BodyId>,
    /// Moved by this much after the turn, in millimetres.
    #[serde(default)]
    pub offset: [f64; 3],
    /// Scaled by `scale`, then turned by `angle` radians about `axis`, both about `pivot`.
    #[serde(default)]
    pub pivot: [f64; 3],
    #[serde(default = "up")]
    pub axis: [f64; 3],
    #[serde(default)]
    pub angle: f64,
    #[serde(default = "one")]
    pub scale: f64,
}

fn up() -> [f64; 3] { [0.0, 1.0, 0.0] }
fn one() -> f64 { 1.0 }

impl MotionRequest {
    fn motion(&self) -> Result<Motion, ApiError> {
        let axis = DVec3::from_array(self.axis);
        let all = self.offset.iter().chain(&self.pivot).chain(&self.axis).chain([&self.angle, &self.scale]);
        if all.into_iter().any(|v| !v.is_finite()) || (self.angle != 0.0 && axis.length() < 1e-9) {
            return Err(String::from("the move, turn or scale is not a valid number").into());
        }
        Ok(Motion { offset: DVec3::from_array(self.offset), pivot: DVec3::from_array(self.pivot), axis, angle: self.angle, scale: self.scale })
    }
}

/// Move, turn or scale bodies, as one undoable step. The viewport previews this itself, since it
/// needs no geometry work; the bodies' faces and edges keep their refs.
pub fn commit_motion(m: &Model, req: MotionRequest) -> Result<Committed, ApiError> {
    let motion = req.motion()?;
    m.call(move |doc| {
        doc.commit_motion(&req.bodies, &motion)?;
        Ok(Committed { id: req.bodies[0], scene: bodies(doc)? })
    })
}

/// Delete bodies, as one undoable step.
pub fn delete_bodies(m: &Model, ids: Vec<BodyId>) -> Result<Vec<Body>, ApiError> {
    m.call(move |doc| { doc.commit_delete(&ids)?; Ok(bodies(doc)?) })
}

#[derive(Serialize, Debug)]
pub struct Duplicated {
    pub ids: Vec<BodyId>,
    pub scene: Vec<Body>,
}

/// Copy bodies in place, as one undoable step.
pub fn duplicate_bodies(m: &Model, ids: Vec<BodyId>) -> Result<Duplicated, ApiError> {
    m.call(move |doc| { let ids = doc.commit_duplicate(&ids)?; Ok(Duplicated { ids, scene: bodies(doc)? }) })
}
