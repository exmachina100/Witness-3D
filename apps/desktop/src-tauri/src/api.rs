//! What the viewport can ask of the model, as plain data. Kept apart from Tauri so it can be tested
//! without a window.

use std::path::PathBuf;

use glam::DVec3;
use serde::{Deserialize, Serialize};
use w3d_kernel::document::{BodyId, Document, FormRequest as FormKindRequest, Tools};
use w3d_kernel::engine::Engine;
use w3d_kernel::occt::Occt;
use w3d_kernel::blend::FilletShape;
use w3d_kernel::{extrude, file, form, ArraySpec, Primitive, FormParams, Blend, BlendParams, BooleanOp, Curve, CurveId, CurveShape, ExtrudeParams, ExtrudeResult, Frame, Kernel, KernelError, Motion, Operation, Profile, Ref, Refs, FaceRebuild, RebuiltFace, SheetExtension, Tessellation};

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
    /// Faces that enclose no solid (a Patch's sheet): listed under SHEETS, with no volume.
    pub sheet: bool,
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
    /// Freestyle (F): the direction to extrude in instead of the normal.
    #[serde(default)]
    pub direction: Option<[f64; 3]>,
    /// More faces of the same body to extrude with `face`.
    #[serde(default)]
    pub faces: Vec<u32>,
    /// Individual (I): each face along its own normal.
    #[serde(default)]
    pub individual: bool,
    /// More regions extruded with `region`, and the regions inside them cut out as holes.
    #[serde(default)]
    pub more_regions: Vec<CurveId>,
    #[serde(default)]
    pub holes: Vec<CurveId>,
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
        volume: if k.is_sheet(solid) { 0.0 } else { t.volume() },
        sheet: k.is_sheet(solid),
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
            let p = doc.regions_params(id, &self.more_regions, &self.holes, self.distance, self.operation()).map_err(|e| e.to_string())?;
            return Ok(ExtrudeParams { back: self.back, angle: self.angle, thickness: self.thickness, direction: self.direction.map(DVec3::from_array), ..p });
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
            direction: self.direction.map(DVec3::from_array),
            more_faces: self.faces.clone(),
            individual: self.individual,
            more_regions: vec![],
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
    /// Loft and Sweep: guide curves the sides run along.
    #[serde(default)]
    pub guides: Vec<CurveId>,
    /// Sweep: how the section follows its guide.
    #[serde(default)]
    pub method: GuideName,
    /// Sweep: whether the section turns with the path or stays parallel to itself.
    #[serde(default)]
    pub align: AlignName,
}

#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FormName { Revolve, Loft, Sweep }

#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum GuideName { #[default] Point, Chord, Curve }

#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum AlignName { #[default] Normal, Parallel }

fn turn() -> f64 { std::f64::consts::TAU }
fn new_op() -> OpChoice { OpChoice::New }

impl FormRequest {
    fn params(&self, doc: &Document<Occt>) -> Result<FormParams, ApiError> {
        let kind = match self.kind {
            FormName::Revolve => FormKindRequest::Revolve { axis_point: DVec3::from_array(self.axis_point), axis_dir: DVec3::from_array(self.axis_dir), angle: self.angle, thickness: self.thickness },
            FormName::Loft if self.guides.is_empty() => FormKindRequest::Loft,
            FormName::Loft => FormKindRequest::LoftGuided { guides: self.guides.clone() },
            FormName::Sweep => {
                let path = self.path.ok_or_else(|| ApiError::from(String::from("pick the path to sweep along")))?;
                if self.guides.len() > 1 { return Err(String::from("this build's Sweep follows one guide; select just one").into()) }
                if self.guides.is_empty() && self.align == AlignName::Normal {
                    FormKindRequest::Sweep { path, twist: self.twist, scale: self.scale }
                } else {
                    if self.twist.abs() > 1e-12 || (self.scale - 1.0).abs() > 1e-12 { return Err(String::from("twist and scale don't go with a guide or Parallel alignment; set them back to 0 and 1").into()) }
                    let method = match self.method { GuideName::Point => form::GuideMethod::Point, GuideName::Chord => form::GuideMethod::Chord, GuideName::Curve => form::GuideMethod::Curve };
                    let align = match self.align { AlignName::Normal => form::Alignment::Normal, AlignName::Parallel => form::Alignment::Parallel };
                    FormKindRequest::SweepGuided { path, guide: self.guides.first().copied(), method, align }
                }
            }
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
    /// Offset Face's grow mode (Tab): "moving" (the default), "fixed" or "none".
    #[serde(default)]
    pub grow: String,
}

fn grow_of(s: &str) -> w3d_kernel::Grow {
    match s {
        "fixed" => w3d_kernel::Grow::Fixed,
        "none" => w3d_kernel::Grow::None,
        _ => w3d_kernel::Grow::Moving,
    }
}

/// The body as it would be after the offset. `None` means a newer request superseded it.
pub fn preview_offset(m: &Model, req: OffsetRequest) -> Option<Result<Body, ApiError>> {
    m.preview(move |doc| {
        let solid = doc.preview_offset(req.body, &req.faces, req.distance, req.angle, grow_of(&req.grow))?;
        Ok(body(&doc.kernel, req.body, &solid)?)
    })
}

pub fn commit_offset(m: &Model, req: OffsetRequest) -> Result<Committed, ApiError> {
    m.call(move |doc| {
        let id = doc.commit_offset(req.body, &req.faces, req.distance, req.angle, grow_of(&req.grow))?;
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

/// Curve edits: the curves `ids` replaced by `curves`, as one undoable step.
#[derive(Deserialize, Debug, Clone)]
pub struct ReplaceCurvesRequest {
    pub ids: Vec<CurveId>,
    pub curves: Vec<Curve>,
}

pub fn replace_curves(m: &Model, req: ReplaceCurvesRequest) -> Result<AddedCurves, ApiError> {
    m.call(move |doc| Ok(AddedCurves { ids: doc.commit_replace_curves(&req.ids, req.curves)? }))
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
        if is_iges(&path) { doc.kernel.write_iges(solid, &path) } else { doc.kernel.write_step(solid, &path) }.map_err(|e| e.to_string())
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
    /// Variable points of a fillet: radius `size` × scale at a point on one of the edges.
    #[serde(default)]
    pub variable: Vec<VariableIn>,
    /// Plasticity's fillet Shape: "round" (the default), "chordal", "conic", "g2" or "full".
    #[serde(default)]
    pub shape: String,
    /// The Conic shape's rho, or how far the G2 shape reaches toward the corner.
    #[serde(default = "half")]
    pub tension: f64,
    /// Limit points (L): none, or two points on the edges between which the round runs.
    #[serde(default)]
    pub limits: Vec<[f64; 3]>,
}

fn half() -> f64 { 0.5 }

#[derive(Deserialize, Debug, Clone, Copy)]
pub struct VariableIn {
    pub edge: u32,
    pub point: [f64; 3],
    pub scale: f64,
}

fn equal() -> f64 { w3d_kernel::blend::EQUAL }

impl BlendRequest {
    fn params(&self) -> BlendParams {
        BlendParams {
            edges: self.edges.clone(),
            size: self.size,
            kind: if self.kind == BlendKind::Chamfer { Blend::Chamfer } else { Blend::Fillet },
            angle: self.angle,
            variable: self.variable.iter().map(|v| w3d_kernel::blend::VariablePoint { edge: v.edge, point: v.point.into(), scale: v.scale }).collect(),
            shape: match self.shape.as_str() {
                "chordal" => FilletShape::Chordal,
                "conic" => FilletShape::Conic,
                "g2" => FilletShape::G2,
                "full" => FilletShape::Full,
                _ => FilletShape::Round,
            },
            tension: self.tension,
            limits: self.limits.iter().map(|&p| p.into()).collect(),
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
    m.call(|doc| { doc.app_state = None; seed(doc); bodies(doc) })
}

/// The app's own state saved with the document (groups, locks, materials), or null.
pub fn app_state(m: &Model) -> Result<Option<serde_json::Value>, String> {
    Ok(m.call(|doc| doc.app_state.clone()))
}

pub fn set_app_state(m: &Model, state: Option<serde_json::Value>) -> Result<(), String> {
    m.call(move |doc| doc.app_state = state);
    Ok(())
}

pub fn save(m: &Model, path: PathBuf) -> Result<(), String> {
    m.call(move |doc| file::save(doc, &path).map_err(|e| e.to_string()))
}

/// Replace the document with a saved one. History starts empty.
pub fn open(m: &Model, path: PathBuf) -> Result<Vec<Body>, String> {
    m.call(move |doc| { file::open(doc, &path).map_err(|e| e.to_string())?; bodies(doc) })
}

/// Add the STEP file's geometry as one new body, as an undoable step.
/// Whether a path names an IGES file; anything else is read and written as STEP.
fn is_iges(path: &std::path::Path) -> bool {
    matches!(path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref(), Some("igs" | "iges"))
}

/// Import a STEP or IGES file (by its extension) as a new body.
pub fn import_step(m: &Model, path: PathBuf) -> Result<Committed, String> {
    m.call(move |doc| {
        let solid = if is_iges(&path) { doc.kernel.read_iges(&path) } else { doc.kernel.read_step(&path) }.map_err(|e| e.to_string())?;
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

// --- Round 6: Box, Cylinder, Sphere, Shell, Mirror and arrays -------------------------------------
// The requests mirror web/src/app/LocalBackend.js, so the shared UI sends the same JSON to both.

#[derive(Deserialize, Debug, Clone, Copy)]
pub struct FrameIn {
    pub origin: [f64; 3],
    pub x: [f64; 3],
    pub normal: [f64; 3],
}

impl FrameIn {
    fn frame(&self) -> Result<Frame, ApiError> {
        let (o, x, n) = (DVec3::from_array(self.origin), DVec3::from_array(self.x), DVec3::from_array(self.normal));
        if !(o.is_finite() && x.is_finite() && n.is_finite()) || x.cross(n).length() < 1e-9 {
            return Err(KernelError::Invalid("the construction plane is not valid").into());
        }
        Ok(Frame::new(o, x, n))
    }
}

/// Plasticity's Box, Cylinder or Sphere.
#[derive(Deserialize, Debug, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PrimitiveShape {
    Box { frame: FrameIn, width: f64, depth: f64, height: f64 },
    Cylinder { frame: FrameIn, radius: f64, height: f64 },
    Sphere { center: [f64; 3], radius: f64 },
}

/// A primitive and what to do with the body it was drawn on: Q, W, Shift+E, Shift+Q or B (new).
#[derive(Deserialize, Debug, Clone)]
pub struct PrimitiveRequest {
    #[serde(flatten)]
    pub shape: PrimitiveShape,
    #[serde(default)]
    pub target: Option<BodyId>,
    #[serde(default = "primitive_new_op")]
    pub op: OpChoice,
}

fn primitive_new_op() -> OpChoice { OpChoice::New }

impl PrimitiveRequest {
    fn primitive(&self) -> Result<Primitive, ApiError> {
        Ok(match self.shape {
            PrimitiveShape::Box { frame, width, depth, height } => Primitive::Box { frame: frame.frame()?, width, depth, height },
            PrimitiveShape::Cylinder { frame, radius, height } => Primitive::Cylinder { frame: frame.frame()?, radius, height },
            PrimitiveShape::Sphere { center, radius } => Primitive::Sphere { center: DVec3::from_array(center), radius },
        })
    }
    fn operation(&self) -> Operation {
        match self.op {
            OpChoice::Union => Operation::Union,
            OpChoice::Difference => Operation::Difference,
            OpChoice::Intersect => Operation::Intersect,
            OpChoice::Slice => Operation::Slice,
            OpChoice::New | OpChoice::Auto => Operation::NewBody,
        }
    }
}

/// What the primitive would make or change; nothing changes. `None` means a newer request came first.
pub fn preview_primitive(m: &Model, req: PrimitiveRequest) -> Option<Result<Preview, ApiError>> {
    m.preview(move |doc| {
        let p = req.primitive()?;
        let tool = Some(body(&doc.kernel, 0, &w3d_kernel::solids::primitive(&doc.kernel, &p)?)?);
        let target = req.target.filter(|_| req.operation() != Operation::NewBody);
        let result = doc.preview_primitive(&p, target, req.operation())?;
        Ok(preview_of(doc, target, result, tool)?)
    })
}

pub fn commit_primitive(m: &Model, req: PrimitiveRequest) -> Result<Committed, ApiError> {
    m.call(move |doc| {
        let target = req.target.filter(|_| req.operation() != Operation::NewBody);
        let id = doc.commit_primitive(&req.primitive()?, target, req.operation())?;
        Ok(Committed { id, scene: bodies(doc)? })
    })
}

/// Shell: hollow one body, open at the given faces.
#[derive(Deserialize, Debug, Clone)]
pub struct ShellRequest {
    pub body: BodyId,
    pub faces: Vec<u32>,
    pub thickness: f64,
}

pub fn preview_shell(m: &Model, req: ShellRequest) -> Option<Result<Body, ApiError>> {
    m.preview(move |doc| {
        let solid = doc.preview_shell(req.body, &req.faces, req.thickness)?;
        Ok(body(&doc.kernel, req.body, &solid)?)
    })
}

pub fn commit_shell(m: &Model, req: ShellRequest) -> Result<Committed, ApiError> {
    m.call(move |doc| {
        let id = doc.commit_shell(req.body, &req.faces, req.thickness)?;
        Ok(Committed { id, scene: bodies(doc)? })
    })
}

/// Mirror bodies in the plane through `origin` with normal `normal`; `join` fuses each copy into its body.
#[derive(Deserialize, Debug, Clone)]
pub struct MirrorRequest {
    pub bodies: Vec<BodyId>,
    pub origin: [f64; 3],
    pub normal: [f64; 3],
    #[serde(default)]
    pub join: bool,
}

/// The copies, drawn as phantoms; nothing changes.
pub fn preview_mirror(m: &Model, req: MirrorRequest) -> Option<Result<Vec<Body>, ApiError>> {
    m.preview(move |doc| {
        let copies = doc.preview_mirror(&req.bodies, DVec3::from_array(req.origin), DVec3::from_array(req.normal))?;
        Ok(copies.iter().map(|s| body(&doc.kernel, 0, s)).collect::<Result<Vec<_>, _>>()?)
    })
}

pub fn commit_mirror(m: &Model, req: MirrorRequest) -> Result<Duplicated, ApiError> {
    m.call(move |doc| {
        let ids = doc.commit_mirror(&req.bodies, DVec3::from_array(req.origin), DVec3::from_array(req.normal), req.join)?;
        Ok(Duplicated { ids, scene: bodies(doc)? })
    })
}

#[derive(Deserialize, Debug, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ArraySpecIn {
    Rectangular { steps: [[f64; 3]; 3], counts: [u32; 3] },
    /// `angle` in radians.
    Radial { pivot: [f64; 3], axis: [f64; 3], angle: f64, count: u32 },
    /// Curve Array: each copy turned `angle` radians about `axis` through `pivot`, then moved by `offset`.
    Motions { motions: Vec<ArrayMotionIn> },
}

#[derive(Deserialize, Debug, Clone, Copy)]
pub struct ArrayMotionIn {
    pub offset: [f64; 3],
    pub pivot: [f64; 3],
    pub axis: [f64; 3],
    pub angle: f64,
}

impl From<ArraySpecIn> for ArraySpec {
    fn from(s: ArraySpecIn) -> Self {
        match s {
            ArraySpecIn::Rectangular { steps, counts } => ArraySpec::Rectangular { steps: steps.map(DVec3::from_array), counts },
            ArraySpecIn::Radial { pivot, axis, angle, count } => ArraySpec::Radial { pivot: DVec3::from_array(pivot), axis: DVec3::from_array(axis), angle, count },
            ArraySpecIn::Motions { motions } => ArraySpec::Motions(motions.into_iter().map(|m| Motion {
                offset: DVec3::from_array(m.offset), pivot: DVec3::from_array(m.pivot), axis: DVec3::from_array(m.axis), angle: m.angle, scale: 1.0,
            }).collect()),
        }
    }
}

/// Rectangular or Radial Array of bodies; `join` fuses the copies into each body.
#[derive(Deserialize, Debug, Clone)]
pub struct ArrayRequest {
    pub bodies: Vec<BodyId>,
    pub spec: ArraySpecIn,
    #[serde(default)]
    pub join: bool,
}

pub fn preview_array(m: &Model, req: ArrayRequest) -> Option<Result<Vec<Body>, ApiError>> {
    m.preview(move |doc| {
        let copies = doc.preview_array(&req.bodies, &req.spec.into())?;
        Ok(copies.iter().map(|s| body(&doc.kernel, 0, s)).collect::<Result<Vec<_>, _>>()?)
    })
}

pub fn commit_array(m: &Model, req: ArrayRequest) -> Result<Duplicated, ApiError> {
    m.call(move |doc| {
        let ids = doc.commit_array(&req.bodies, &req.spec.into(), req.join)?;
        if ids.is_empty() { return Err(KernelError::NoOp.into()) }
        Ok(Duplicated { ids, scene: bodies(doc)? })
    })
}

/// Remove Face: delete faces of one body and close the gap.
#[derive(Deserialize, Debug, Clone)]
pub struct RemoveFacesRequest {
    pub body: BodyId,
    pub faces: Vec<u32>,
}

pub fn preview_remove_faces(m: &Model, req: RemoveFacesRequest) -> Option<Result<Body, ApiError>> {
    m.preview(move |doc| {
        let solid = doc.preview_remove_faces(req.body, &req.faces)?;
        Ok(body(&doc.kernel, req.body, &solid)?)
    })
}

/// Plasticity's Delete Redundant Topology on the bodies.
#[derive(Deserialize, Debug, Clone)]
pub struct UnifyRequest {
    pub bodies: Vec<BodyId>,
}

#[derive(Serialize, Debug)]
pub struct Unified {
    pub faces: usize,
    pub edges: usize,
    pub scene: Vec<Body>,
}

#[derive(Serialize, Debug)]
pub struct BoundaryEdges {
    pub body: BodyId,
    pub edges: Vec<u32>,
}

pub fn commit_reverse_sheets(m: &Model, req: UnifyRequest) -> Result<Vec<Body>, ApiError> {
    m.call(move |doc| {
        doc.commit_reverse_sheets(&req.bodies)?;
        Ok(bodies(doc)?)
    })
}

pub fn boundary_edges(m: &Model, req: UnifyRequest) -> Result<Vec<BoundaryEdges>, ApiError> {
    m.call(move |doc| {
        Ok(doc.boundary_edges(&req.bodies)?.into_iter().map(|(body, edges)| BoundaryEdges { body, edges }).collect())
    })
}

/// Remove Fillets: the fillet faces of a body, or the fillet chains holding `faces`.
pub fn fillet_faces(m: &Model, req: RemoveFacesRequest) -> Result<Vec<u32>, ApiError> {
    m.call(move |doc| Ok(doc.fillet_faces(req.body, &req.faces)?))
}

pub fn commit_unify(m: &Model, req: UnifyRequest) -> Result<Unified, ApiError> {
    m.call(move |doc| {
        let (faces, edges) = doc.commit_unify(&req.bodies)?;
        Ok(Unified { faces, edges, scene: bodies(doc)? })
    })
}

pub fn commit_remove_faces(m: &Model, req: RemoveFacesRequest) -> Result<Committed, ApiError> {
    m.call(move |doc| {
        let id = doc.commit_remove_faces(req.body, &req.faces)?;
        Ok(Committed { id, scene: bodies(doc)? })
    })
}

/// Dimension on a fillet: the fillet faces of one body made again at `radius`.
#[derive(Deserialize, Debug, Clone)]
pub struct RefilletRequest {
    pub body: BodyId,
    pub faces: Vec<u32>,
    pub radius: f64,
}

pub fn preview_refillet(m: &Model, req: RefilletRequest) -> Option<Result<Body, ApiError>> {
    m.preview(move |doc| {
        let solid = doc.preview_refillet(req.body, &req.faces, req.radius)?;
        Ok(body(&doc.kernel, req.body, &solid)?)
    })
}

pub fn commit_refillet(m: &Model, req: RefilletRequest) -> Result<Committed, ApiError> {
    m.call(move |doc| {
        let id = doc.commit_refillet(req.body, &req.faces, req.radius)?;
        Ok(Committed { id, scene: bodies(doc)? })
    })
}

/// A body's triangles for export, at `tolerance` mm from the true surface.
#[derive(Serialize, Debug)]
pub struct MeshOut {
    pub id: BodyId,
    pub positions: Vec<f32>,
    pub indices: Vec<u32>,
}

pub fn mesh_bodies(m: &Model, ids: Vec<BodyId>, tolerance: f64) -> Result<Vec<MeshOut>, ApiError> {
    if !(tolerance > 0.0) || !tolerance.is_finite() { return Err(KernelError::Invalid("the tolerance must be greater than zero").into()) }
    m.call(move |doc| {
        ids.iter().map(|&id| {
            let solid = doc.get(id).ok_or(KernelError::Invalid("that body no longer exists"))?;
            let t = doc.kernel.tessellate(solid, tolerance)?;
            Ok(MeshOut { id, positions: t.positions.iter().flatten().map(|&c| c as f32).collect(), indices: t.indices })
        }).collect()
    })
}

/// Plasticity's SVG and DXF export: the hidden-line drawing of `bodies` seen from the camera.
#[derive(Deserialize, Debug, Clone)]
pub struct DrawingRequest {
    pub bodies: Vec<BodyId>,
    pub origin: [f64; 3],
    /// From the scene toward the viewer.
    pub toward: [f64; 3],
    /// The drawing's x: the camera's right.
    pub x: [f64; 3],
    pub deflection: f64,
}

/// A drawn line in the drawing's x, y: [x0, y0, x1, y1, ...].
#[derive(Serialize, Debug, Clone)]
pub struct DrawnLineOut {
    pub hidden: bool,
    pub points: Vec<f64>,
}

pub fn hidden_lines(m: &Model, req: DrawingRequest) -> Result<Vec<DrawnLineOut>, ApiError> {
    if !(req.deflection > 0.0) || !req.deflection.is_finite() { return Err(KernelError::Invalid("the tolerance must be greater than zero").into()) }
    if req.bodies.is_empty() { return Err(KernelError::Invalid("nothing to draw").into()) }
    m.call(move |doc| {
        let solids = req.bodies.iter().map(|&id| doc.get(id).ok_or(KernelError::Invalid("that body no longer exists"))).collect::<Result<Vec<_>, _>>()?;
        let lines = doc.kernel.hidden_lines(&solids, DVec3::from(req.origin), DVec3::from(req.toward), DVec3::from(req.x), req.deflection)?;
        Ok(lines.into_iter().map(|l| DrawnLineOut { hidden: l.hidden, points: l.points.into_iter().flatten().collect() }).collect())
    })
}

/// Write an exported mesh or drawing the viewport made, to a path the user chose in the save dialog.
/// Only those formats, so this can't be turned into writing anything anywhere.
pub fn write_export(path: PathBuf, data: Vec<u8>) -> Result<(), ApiError> {
    let ext = path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase());
    if !matches!(ext.as_deref(), Some("obj" | "stl" | "svg" | "dxf")) { return Err(KernelError::Invalid("exports are .obj, .stl, .svg or .dxf files").into()) }
    std::fs::write(&path, data).map_err(|e| ApiError::from(e.to_string()))
}

/// Plasticity's Cut: bodies split by curves drawn across them.
#[derive(Deserialize, Debug, Clone)]
pub struct CutRequest {
    pub bodies: Vec<BodyId>,
    #[serde(default)]
    pub curves: Vec<CurveId>,
    /// Faces, a plane or bodies to cut with beside the curves.
    #[serde(default)]
    pub tools: Tools,
}

/// Every piece the cut would make, the kept ones with their body's id; nothing changes.
pub fn preview_cut(m: &Model, req: CutRequest) -> Option<Result<Vec<Body>, ApiError>> {
    m.preview(move |doc| {
        let mut out = Vec::new();
        for (id, piece, rest) in doc.preview_cut(&req.bodies, &req.curves, &req.tools)? {
            out.push(body(&doc.kernel, id, &piece.solid)?);
            for s in &rest { out.push(body(&doc.kernel, 0, s)?); }
        }
        Ok(out)
    })
}

pub fn commit_cut(m: &Model, req: CutRequest) -> Result<Duplicated, ApiError> {
    m.call(move |doc| {
        let ids = doc.commit_cut(&req.bodies, &req.curves, &req.tools)?;
        Ok(Duplicated { ids, scene: bodies(doc)? })
    })
}

/// Plasticity's Imprint: curves projected onto a body's faces (all of them when `faces` is empty)
/// and the faces split there. `consume` deletes the curves too (the knife, K).
#[derive(Deserialize, Debug, Clone)]
pub struct ImprintRequest {
    pub body: BodyId,
    #[serde(default)]
    pub faces: Vec<u32>,
    #[serde(default)]
    pub curves: Vec<CurveId>,
    /// Other bodies to imprint (their intersection with the faces).
    #[serde(default)]
    pub tools: Tools,
    #[serde(default)]
    pub consume: bool,
}

pub fn preview_imprint(m: &Model, req: ImprintRequest) -> Option<Result<Body, ApiError>> {
    m.preview(move |doc| {
        let t = doc.preview_imprint(req.body, &req.faces, &req.curves, &req.tools)?;
        Ok(body(&doc.kernel, req.body, &t.solid)?)
    })
}

pub fn commit_imprint(m: &Model, req: ImprintRequest) -> Result<Committed, ApiError> {
    m.call(move |doc| {
        let id = doc.commit_imprint(req.body, &req.faces, &req.curves, &req.tools, req.consume)?;
        Ok(Committed { id, scene: bodies(doc)? })
    })
}

/// Plasticity's Offset Edge on curved faces or across several faces: `edges` moved `distance`
/// across the faces on `side` (0 or 1, 2 for both) and imprinted there.
#[derive(Deserialize, Debug, Clone)]
pub struct OffsetEdgesRequest {
    pub body: BodyId,
    pub edges: Vec<u32>,
    pub distance: f64,
    #[serde(default)]
    pub side: u32,
    /// The side without this face instead (the curved side of an edge on a flat face).
    #[serde(default)]
    pub away: Option<u32>,
}

pub fn preview_offset_edges(m: &Model, req: OffsetEdgesRequest) -> Option<Result<Body, ApiError>> {
    m.preview(move |doc| {
        let t = doc.preview_offset_edges(req.body, &req.edges, req.distance, req.side, req.away)?;
        Ok(body(&doc.kernel, req.body, &t.solid)?)
    })
}

pub fn commit_offset_edges(m: &Model, req: OffsetEdgesRequest) -> Result<Committed, ApiError> {
    m.call(move |doc| {
        let id = doc.commit_offset_edges(req.body, &req.edges, req.distance, req.side, req.away)?;
        Ok(Committed { id, scene: bodies(doc)? })
    })
}

/// Plasticity's Bridge Surface: a sheet from one body edge to another, tangent to their faces.
#[derive(Deserialize, Debug, Clone)]
pub struct BridgeSurfaceRequest {
    pub a: PatchEdge,
    pub b: PatchEdge,
    #[serde(default = "one")]
    pub tension: f64,
}

pub fn preview_bridge_surface(m: &Model, req: BridgeSurfaceRequest) -> Option<Result<Body, ApiError>> {
    m.preview(move |doc| {
        let sheet = doc.preview_bridge_surface((req.a.body, req.a.edge), (req.b.body, req.b.edge), req.tension)?;
        Ok(body(&doc.kernel, 0, &sheet)?)
    })
}

pub fn commit_bridge_surface(m: &Model, req: BridgeSurfaceRequest) -> Result<Committed, ApiError> {
    m.call(move |doc| {
        let id = doc.commit_bridge_surface((req.a.body, req.a.edge), (req.b.body, req.b.edge), req.tension)?;
        Ok(Committed { id, scene: bodies(doc)? })
    })
}

/// Plasticity's Patch: a sheet filling one closed loop of curves and body edges, each edge with
/// whether the sheet leaves it tangent to the body's face.
#[derive(Deserialize, Debug, Clone)]
pub struct PatchRequest {
    #[serde(default)]
    pub curves: Vec<CurveId>,
    #[serde(default)]
    pub edges: Vec<PatchEdge>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct PatchEdge {
    pub body: BodyId,
    pub edge: u32,
    #[serde(default)]
    pub tangent: bool,
}

impl PatchRequest {
    fn edges(&self) -> Vec<(BodyId, u32, bool)> { self.edges.iter().map(|e| (e.body, e.edge, e.tangent)).collect() }
}

pub fn preview_patch(m: &Model, req: PatchRequest) -> Option<Result<Body, ApiError>> {
    m.preview(move |doc| {
        let sheet = doc.preview_patch(&req.curves, &req.edges())?;
        Ok(body(&doc.kernel, 0, &sheet)?)
    })
}

pub fn commit_patch(m: &Model, req: PatchRequest) -> Result<Committed, ApiError> {
    m.call(move |doc| {
        let id = doc.commit_patch(&req.curves, &req.edges())?;
        Ok(Committed { id, scene: bodies(doc)? })
    })
}

/// Plasticity's Project, by what is selected: curves onto a body (`body`, with `dir`, `both` and
/// `hide`), two bodies against each other (`bodies`), or two curves against each other.
#[derive(Deserialize, Debug, Clone)]
#[serde(tag = "mode", rename_all = "kebab-case")]
pub enum ProjectRequest {
    CurveBody {
        body: BodyId,
        #[serde(default)]
        faces: Vec<u32>,
        curves: Vec<CurveId>,
        dir: [f64; 3],
        #[serde(default)]
        both: bool,
        #[serde(default)]
        hide: bool,
    },
    BodyBody { bodies: [BodyId; 2] },
    /// The body's outline seen along `normal`, drawn on the plane through `origin`.
    Outline { body: BodyId, origin: [f64; 3], normal: [f64; 3] },
    CurveCurve { curves: [CurveId; 2] },
    /// Isoparam: the curve on `face` through `point`, along u (`u`) or v.
    Isoparam { body: BodyId, face: u32, point: [f64; 3], u: bool },
}

/// The curves Project would make, without changing the document; Add Curves keeps them.
pub fn preview_project(m: &Model, req: ProjectRequest) -> Option<Result<Vec<Curve>, ApiError>> {
    m.preview(move |doc| Ok(match req {
        ProjectRequest::CurveBody { body, faces, curves, dir, both, hide } => doc.preview_project(body, &faces, &curves, DVec3::from(dir), both, hide)?,
        ProjectRequest::BodyBody { bodies: [a, b] } => doc.preview_meet(a, b)?,
        ProjectRequest::Outline { body, origin, normal } => {
            let normal = DVec3::from(normal);
            doc.preview_outline(body, DVec3::from(origin), normal, normal.any_orthonormal_vector())?
        }
        ProjectRequest::CurveCurve { curves: [a, b] } => doc.preview_project_curves(a, b)?,
        ProjectRequest::Isoparam { body, face, point, u } => vec![doc.preview_isoparam(body, face, DVec3::from(point), u)?],
    }))
}

/// Plasticity's Draft Face: `faces` of `body` tilted by `angle` radians about the neutral plane
/// through `origin` square to `pull`.
#[derive(Deserialize, Debug, Clone)]
pub struct DraftRequest {
    pub body: BodyId,
    pub faces: Vec<u32>,
    pub pull: [f64; 3],
    pub origin: [f64; 3],
    pub angle: f64,
}

pub fn preview_draft(m: &Model, req: DraftRequest) -> Option<Result<Body, ApiError>> {
    m.preview(move |doc| {
        let t = doc.preview_draft(req.body, &req.faces, DVec3::from(req.pull), DVec3::from(req.origin), req.angle)?;
        Ok(body(&doc.kernel, req.body, &t.solid)?)
    })
}

pub fn commit_draft(m: &Model, req: DraftRequest) -> Result<Committed, ApiError> {
    m.call(move |doc| {
        let id = doc.commit_draft(req.body, &req.faces, DVec3::from(req.pull), DVec3::from(req.origin), req.angle)?;
        Ok(Committed { id, scene: bodies(doc)? })
    })
}

/// Thicken: a sheet body made solid, `front` along its faces' normals and `back` behind them. With
/// `faces`, Thicken Face: those faces of the body made into a new solid, the body kept.
#[derive(Deserialize, Debug, Clone)]
pub struct ThickenRequest {
    pub body: BodyId,
    pub front: f64,
    #[serde(default)]
    pub back: f64,
    #[serde(default)]
    pub faces: Vec<u32>,
}

pub fn preview_thicken(m: &Model, req: ThickenRequest) -> Option<Result<Body, ApiError>> {
    m.preview(move |doc| {
        let solid = if req.faces.is_empty() { doc.preview_thicken(req.body, req.front, req.back)? } else { doc.preview_thicken_faces(req.body, &req.faces, req.front, req.back)? };
        Ok(body(&doc.kernel, req.body, &solid)?)
    })
}

pub fn commit_thicken(m: &Model, req: ThickenRequest) -> Result<Committed, ApiError> {
    m.call(move |doc| {
        let id = if req.faces.is_empty() { doc.commit_thicken(req.body, req.front, req.back)? } else { doc.commit_thicken_faces(req.body, &req.faces, req.front, req.back)? };
        Ok(Committed { id, scene: bodies(doc)? })
    })
}

/// Pipe: a tube along each of `curves`, round (`sides` 0) or polygonal, hollow with a `thickness`.
#[derive(Deserialize, Debug, Clone)]
pub struct PipeRequest {
    pub curves: Vec<CurveId>,
    pub radius: f64,
    #[serde(default)]
    pub thickness: f64,
    #[serde(default)]
    pub sides: u32,
}

pub fn preview_pipe(m: &Model, req: PipeRequest) -> Option<Result<Body, ApiError>> {
    m.preview(move |doc| {
        let mut tubes = doc.preview_pipe(&req.curves, req.radius, req.thickness, req.sides)?.into_iter();
        let first = tubes.next().ok_or(KernelError::Invalid("select the curves to run pipes along"))?;
        // Several tubes show as one preview body.
        let all = tubes.try_fold(first, |a, t| doc.kernel.boolean(&a, &t, BooleanOp::Union).map(|r| r.solid))?;
        Ok(body(&doc.kernel, 0, &all)?)
    })
}

pub fn commit_pipe(m: &Model, req: PipeRequest) -> Result<Duplicated, ApiError> {
    m.call(move |doc| {
        let ids = doc.commit_pipe(&req.curves, req.radius, req.thickness, req.sides)?;
        Ok(Duplicated { ids, scene: bodies(doc)? })
    })
}

/// Toggle Surface Curvature: comb teeth along edge `edge` of `body`, `n` spans (160 if left out).
#[derive(Deserialize, Debug, Clone)]
pub struct EdgeCurvatureRequest {
    pub body: BodyId,
    pub edge: u32,
    #[serde(default)]
    pub n: Option<usize>,
}

pub fn edge_curvature(m: &Model, req: EdgeCurvatureRequest) -> Result<Vec<w3d_kernel::CombTooth>, ApiError> {
    m.call(move |doc| Ok(doc.edge_curvature(req.body, req.edge, req.n.unwrap_or(160).clamp(1, 2000))?))
}

/// Constrained Surface: a sheet of the B-spline surface the UI fitted, as flat numbers (see
/// `Kernel::spline_sheet`).
#[derive(Deserialize, Debug, Clone)]
pub struct SplineSheetRequest {
    pub data: Vec<f64>,
}

pub fn preview_spline_sheet(m: &Model, req: SplineSheetRequest) -> Option<Result<Body, ApiError>> {
    m.preview(move |doc| {
        let sheet = doc.preview_spline_sheet(&req.data)?;
        Ok(body(&doc.kernel, 0, &sheet)?)
    })
}

pub fn commit_spline_sheet(m: &Model, req: SplineSheetRequest) -> Result<Duplicated, ApiError> {
    m.call(move |doc| {
        let id = doc.commit_spline_sheet(&req.data)?;
        Ok(Duplicated { ids: vec![id], scene: bodies(doc)? })
    })
}

/// Untrim: a sheet of the whole surface under each of `faces` of `body`, with the faces' edges
/// imprinted on it with `keep`.
#[derive(Deserialize, Debug, Clone)]
pub struct UntrimRequest {
    pub body: BodyId,
    pub faces: Vec<u32>,
    /// Keep edges: the faces' edges imprinted on the sheets.
    #[serde(default)]
    pub keep: bool,
}

pub fn preview_untrim(m: &Model, req: UntrimRequest) -> Option<Result<Body, ApiError>> {
    m.preview(move |doc| {
        let sheets = doc.preview_untrim(req.body, &req.faces, req.keep)?;
        let mut sheets = sheets.into_iter();
        let first = sheets.next().ok_or(KernelError::Invalid("select the faces to untrim"))?;
        // Several sheets show as one preview body.
        let all = sheets.try_fold(first, |a, s| doc.kernel.boolean(&a, &s, BooleanOp::Union).map(|r| r.solid))?;
        Ok(body(&doc.kernel, 0, &all)?)
    })
}

pub fn commit_untrim(m: &Model, req: UntrimRequest) -> Result<Duplicated, ApiError> {
    m.call(move |doc| {
        let ids = doc.commit_untrim(req.body, &req.faces, req.keep)?;
        Ok(Duplicated { ids, scene: bodies(doc)? })
    })
}

/// Unwrap Face: each of `faces` of `body` laid flat on the XY plane as a new sheet.
#[derive(Deserialize, Debug, Clone)]
pub struct UnwrapRequest {
    pub body: BodyId,
    pub faces: Vec<u32>,
}

pub fn preview_unwrap(m: &Model, req: UnwrapRequest) -> Option<Result<Body, ApiError>> {
    m.preview(move |doc| {
        let mut sheets = doc.preview_unwrap(req.body, &req.faces)?.into_iter();
        let first = sheets.next().ok_or(KernelError::Invalid("select the faces to unwrap"))?;
        let all = sheets.try_fold(first, |a, s| doc.kernel.boolean(&a, &s, BooleanOp::Union).map(|r| r.solid))?;
        Ok(body(&doc.kernel, 0, &all)?)
    })
}

pub fn commit_unwrap(m: &Model, req: UnwrapRequest) -> Result<Duplicated, ApiError> {
    m.call(move |doc| {
        let ids = doc.commit_unwrap(req.body, &req.faces)?;
        Ok(Duplicated { ids, scene: bodies(doc)? })
    })
}

/// Extend Sheet: a sheet body grown `distance` past its open edge `edge`.
#[derive(Deserialize, Debug, Clone)]
pub struct ExtendSheetRequest {
    pub body: BodyId,
    pub edge: u32,
    pub distance: f64,
    /// Natural (follow the curvature) rather than Linear (straight on), when `shape` is not given.
    #[serde(default)]
    pub natural: bool,
    /// linear, natural, soft or reflective.
    #[serde(default)]
    pub shape: Option<SheetExtension>,
    /// Limit: carry on until this body, instead of by `distance`.
    #[serde(default)]
    pub limit: Option<BodyId>,
    /// Limit Outside: on through the body until the sheet comes out of its far side.
    #[serde(default)]
    pub outside: bool,
}

impl ExtendSheetRequest {
    fn shape(&self) -> SheetExtension {
        self.shape.unwrap_or(if self.natural { SheetExtension::Natural } else { SheetExtension::Linear })
    }
}

/// Surface control points of `body` moved: per point its face, its pole (as `face_poles` numbers
/// them) and the offset.
#[derive(Deserialize, Debug, Clone)]
pub struct MoveFacePolesRequest {
    pub body: BodyId,
    pub moves: Vec<(u32, u32, [f64; 3])>,
}

fn pole_moves(req: &MoveFacePolesRequest) -> Vec<(u32, u32, DVec3)> {
    req.moves.iter().map(|&(f, p, d)| (f, p, DVec3::from_array(d))).collect()
}

pub fn preview_move_face_poles(m: &Model, req: MoveFacePolesRequest) -> Option<Result<Body, ApiError>> {
    m.preview(move |doc| {
        let solid = doc.preview_move_face_poles(req.body, &pole_moves(&req))?;
        Ok(body(&doc.kernel, req.body, &solid)?)
    })
}

pub fn commit_move_face_poles(m: &Model, req: MoveFacePolesRequest) -> Result<Committed, ApiError> {
    m.call(move |doc| {
        doc.commit_move_face_poles(req.body, &pole_moves(&req))?;
        Ok(Committed { id: req.body, scene: bodies(doc)? })
    })
}

/// Subdivide: `faces` of `body` with their spans doubled.
#[derive(Deserialize, Debug, Clone)]
pub struct SubdivideFacesRequest {
    pub body: BodyId,
    pub faces: Vec<u32>,
}

pub fn commit_subdivide_faces(m: &Model, req: SubdivideFacesRequest) -> Result<Committed, ApiError> {
    m.call(move |doc| {
        doc.commit_subdivide_faces(req.body, &req.faces)?;
        Ok(Committed { id: req.body, scene: bodies(doc)? })
    })
}

/// Rebuild Face: `faces` of `body` given new B-spline surfaces (see `FaceRebuild`).
#[derive(Deserialize, Debug, Clone)]
pub struct RebuildFacesRequest {
    pub body: BodyId,
    pub faces: Vec<u32>,
    #[serde(flatten)]
    pub how: FaceRebuild,
}

/// A Rebuild Face preview: the body, plus what each face became.
#[derive(Serialize, Debug)]
pub struct RebuildPreview {
    #[serde(flatten)]
    pub body: Body,
    pub rebuilt: Vec<RebuiltFace>,
}

#[derive(Serialize, Debug)]
pub struct RebuildCommitted {
    pub id: BodyId,
    pub scene: Vec<Body>,
    pub rebuilt: Vec<RebuiltFace>,
}

/// Match Face: `faces` of `body` replaced by the surface of face `tface` of body `target`.
#[derive(Deserialize, Debug, Clone)]
pub struct MatchFacesRequest {
    pub body: BodyId,
    pub faces: Vec<u32>,
    pub target: BodyId,
    pub tface: u32,
    /// "moving" (the default), "fixed" or "none": what an inner face does past the outer wall.
    #[serde(default)]
    pub grow: String,
}

pub fn preview_match_faces(m: &Model, req: MatchFacesRequest) -> Option<Result<Body, ApiError>> {
    m.preview(move |doc| {
        let solid = doc.preview_match_faces(req.body, &req.faces, req.target, req.tface, grow_of(&req.grow))?;
        Ok(body(&doc.kernel, req.body, &solid)?)
    })
}

pub fn commit_match_faces(m: &Model, req: MatchFacesRequest) -> Result<Committed, ApiError> {
    m.call(move |doc| {
        let id = doc.commit_match_faces(req.body, &req.faces, req.target, req.tface, grow_of(&req.grow))?;
        Ok(Committed { id, scene: bodies(doc)? })
    })
}

/// Raise Surface Degree: `faces` of `body`, or all its faces when empty.
#[derive(Deserialize, Debug, Clone)]
pub struct RaiseFacesRequest {
    pub body: BodyId,
    #[serde(default)]
    pub faces: Vec<u32>,
}

pub fn commit_raise_faces(m: &Model, req: RaiseFacesRequest) -> Result<RebuildCommitted, ApiError> {
    m.call(move |doc| {
        let rebuilt = doc.commit_raise_faces(req.body, &req.faces)?;
        Ok(RebuildCommitted { id: req.body, scene: bodies(doc)?, rebuilt })
    })
}

pub fn preview_rebuild_faces(m: &Model, req: RebuildFacesRequest) -> Option<Result<RebuildPreview, ApiError>> {
    m.preview(move |doc| {
        let (solid, rebuilt) = doc.preview_rebuild_faces(req.body, &req.faces, &req.how)?;
        Ok(RebuildPreview { body: body(&doc.kernel, req.body, &solid)?, rebuilt })
    })
}

pub fn commit_rebuild_faces(m: &Model, req: RebuildFacesRequest) -> Result<RebuildCommitted, ApiError> {
    m.call(move |doc| {
        let rebuilt = doc.commit_rebuild_faces(req.body, &req.faces, &req.how)?;
        Ok(RebuildCommitted { id: req.body, scene: bodies(doc)?, rebuilt })
    })
}

pub fn preview_extend_sheet(m: &Model, req: ExtendSheetRequest) -> Option<Result<Body, ApiError>> {
    m.preview(move |doc| {
        let sheet = doc.preview_extend_sheet(req.body, req.edge, req.distance, req.shape(), req.limit, req.outside)?;
        Ok(body(&doc.kernel, req.body, &sheet)?)
    })
}

pub fn commit_extend_sheet(m: &Model, req: ExtendSheetRequest) -> Result<Committed, ApiError> {
    m.call(move |doc| {
        let id = doc.commit_extend_sheet(req.body, req.edge, req.distance, req.shape(), req.limit, req.outside)?;
        Ok(Committed { id, scene: bodies(doc)? })
    })
}

/// Join sheets: the bodies sewn into one where their open edges meet; closed, a solid.
#[derive(Deserialize, Debug, Clone)]
pub struct JoinSheetsRequest {
    pub bodies: Vec<BodyId>,
}

pub fn preview_join_sheets(m: &Model, req: JoinSheetsRequest) -> Option<Result<Body, ApiError>> {
    m.preview(move |doc| {
        let joined = doc.preview_join_sheets(&req.bodies)?;
        Ok(body(&doc.kernel, req.bodies[0], &joined)?)
    })
}

pub fn commit_join_sheets(m: &Model, req: JoinSheetsRequest) -> Result<Committed, ApiError> {
    m.call(move |doc| {
        let id = doc.commit_join_sheets(&req.bodies)?;
        Ok(Committed { id, scene: bodies(doc)? })
    })
}

/// Unjoin: a body taken apart into its faces (`faces`) or its separate pieces.
#[derive(Deserialize, Debug, Clone)]
pub struct UnjoinRequest {
    pub body: BodyId,
    #[serde(default)]
    pub faces: bool,
}

pub fn commit_unjoin(m: &Model, req: UnjoinRequest) -> Result<Duplicated, ApiError> {
    m.call(move |doc| {
        let ids = doc.commit_unjoin(req.body, req.faces)?;
        Ok(Duplicated { ids, scene: bodies(doc)? })
    })
}

/// Plasticity's Place: the bodies copied by one motion (scale, then turn, about `pivot`, then move by
/// `offset`), and with `op` combined with the body `target` the copies land on.
#[derive(Deserialize, Debug, Clone)]
pub struct PlaceRequest {
    pub bodies: Vec<BodyId>,
    pub motion: PlaceMotionIn,
    #[serde(default)]
    pub target: Option<BodyId>,
    #[serde(default = "primitive_new_op")]
    pub op: OpChoice,
}

#[derive(Deserialize, Debug, Clone, Copy)]
pub struct PlaceMotionIn {
    pub offset: [f64; 3],
    pub pivot: [f64; 3],
    pub axis: [f64; 3],
    pub angle: f64,
    #[serde(default = "one")]
    pub scale: f64,
}

impl PlaceRequest {
    fn motion(&self) -> Motion {
        let m = self.motion;
        Motion { offset: DVec3::from_array(m.offset), pivot: DVec3::from_array(m.pivot), axis: DVec3::from_array(m.axis), angle: m.angle, scale: m.scale }
    }
    fn operation(&self) -> Operation {
        match self.op {
            OpChoice::Union => Operation::Union,
            OpChoice::Difference => Operation::Difference,
            OpChoice::Intersect => Operation::Intersect,
            OpChoice::Slice => Operation::Slice,
            OpChoice::New | OpChoice::Auto => Operation::NewBody,
        }
    }
}

/// Place's preview: the copies as phantoms, the target as it would be, and the new bodies a slice
/// (or a union that misses) would add.
#[derive(Serialize, Debug)]
pub struct PlacePreview {
    pub tools: Vec<Body>,
    pub result: Option<Body>,
    pub pieces: Vec<Body>,
}

pub fn preview_place(m: &Model, req: PlaceRequest) -> Option<Result<PlacePreview, ApiError>> {
    m.preview(move |doc| {
        let p = doc.preview_place(&req.bodies, &req.motion(), req.target, req.operation())?;
        let result = match (&p.result, req.target) { (Some(t), Some(id)) => Some(body(&doc.kernel, id, &t.solid)?), _ => None };
        let next = doc.next_id();
        Ok(PlacePreview {
            tools: p.copies.iter().map(|s| body(&doc.kernel, 0, s)).collect::<Result<Vec<_>, _>>()?,
            result,
            pieces: p.pieces.iter().chain(&p.loose).enumerate().map(|(i, s)| body(&doc.kernel, next + i as BodyId, s)).collect::<Result<Vec<_>, _>>()?,
        })
    })
}

pub fn commit_place(m: &Model, req: PlaceRequest) -> Result<Duplicated, ApiError> {
    m.call(move |doc| {
        let ids = doc.commit_place(&req.bodies, &req.motion(), req.target, req.operation())?;
        Ok(Duplicated { ids, scene: bodies(doc)? })
    })
}

/// Deform Solid and Sheet: `bodies` wrapped from a face of `reference` onto a face of `target`.
#[derive(Deserialize, Debug, Clone)]
pub struct DeformRequest {
    pub bodies: Vec<BodyId>,
    pub reference: BodyId,
    pub rface: u32,
    pub target: BodyId,
    pub tface: u32,
    #[serde(default = "unit_scale")]
    pub scale: [f64; 3],
    #[serde(default)]
    pub offset: [f64; 3],
    #[serde(default)]
    pub mirror: bool,
    #[serde(default)]
    pub swap: bool,
    #[serde(default)]
    pub normal: bool,
    #[serde(default)]
    pub reblend: bool,
    #[serde(default)]
    pub keep: bool,
}

fn unit_scale() -> [f64; 3] { [1.0; 3] }

impl DeformRequest {
    fn options(&self) -> w3d_kernel::DeformOptions {
        w3d_kernel::DeformOptions { scale: self.scale, offset: self.offset, mirror: self.mirror, swap: self.swap, normal: self.normal, reblend: self.reblend }
    }
}

pub fn preview_deform(m: &Model, req: DeformRequest) -> Option<Result<Vec<Body>, ApiError>> {
    m.preview(move |doc| {
        let made = doc.preview_deform(&req.bodies, req.reference, req.rface, req.target, req.tface, &req.options())?;
        Ok(req.bodies.iter().zip(made).map(|(id, s)| body(&doc.kernel, *id, &s)).collect::<Result<Vec<_>, _>>()?)
    })
}

pub fn commit_deform(m: &Model, req: DeformRequest) -> Result<Duplicated, ApiError> {
    m.call(move |doc| {
        let ids = doc.commit_deform(&req.bodies, req.reference, req.rface, req.target, req.tface, &req.options(), req.keep)?;
        Ok(Duplicated { ids, scene: bodies(doc)? })
    })
}

/// Deform Curve: points on face `face` of `body` to (s, t, n) face coordinates, or back with `map`.
#[derive(Deserialize, Debug, Clone)]
pub struct FaceUvnRequest {
    pub body: BodyId,
    pub face: u32,
    #[serde(default)]
    pub map: bool,
    pub points: Vec<[f64; 3]>,
}

#[derive(Serialize, Debug)]
pub struct FaceUvn {
    pub size: [f64; 2],
    pub points: Vec<[f64; 3]>,
}

pub fn face_uvn(m: &Model, req: FaceUvnRequest) -> Result<FaceUvn, ApiError> {
    m.call(move |doc| {
        let pts: Vec<DVec3> = req.points.iter().map(|p| DVec3::from(*p)).collect();
        let (size, out) = doc.face_uvn(req.body, req.face, req.map, &pts)?;
        Ok(FaceUvn { size, points: out.into_iter().map(|p| p.to_array()).collect() })
    })
}

#[derive(Deserialize, Debug)]
pub struct EdgeFacesRequest {
    pub body: BodyId,
    pub edge: u32,
    #[serde(default)]
    pub points: Vec<[f64; 3]>,
}

/// Align Surface: the faces along an edge and their frames at the points, flat (see w3d_edge_faces).
pub fn edge_faces(m: &Model, req: EdgeFacesRequest) -> Result<Vec<f64>, ApiError> {
    m.call(move |doc| {
        let pts: Vec<DVec3> = req.points.iter().map(|p| DVec3::from(*p)).collect();
        Ok(doc.edge_faces(req.body, req.edge, &pts)?)
    })
}

/// Toggle Points: each face's control points, as rows of [x, y, z] (u slowest).
pub fn face_poles(m: &Model, req: FaceSurfacesRequest) -> Result<Vec<Vec<Vec<[f64; 3]>>>, ApiError> {
    m.call(move |doc| Ok(doc.face_poles(req.body)?.into_iter().map(|rows| rows.into_iter().map(|r| r.into_iter().map(|p| p.to_array()).collect()).collect()).collect()))
}

/// Dimension: what each face of a body lies on, with its size.
#[derive(Deserialize, Debug, Clone)]
pub struct FaceSurfacesRequest {
    pub body: BodyId,
}

#[derive(Serialize, Debug)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum FaceSurfaceOut {
    Other,
    Plane { origin: [f64; 3], normal: [f64; 3] },
    Cylinder { origin: [f64; 3], axis: [f64; 3], radius: f64, outward: bool },
    Sphere { centre: [f64; 3], radius: f64, outward: bool },
}

pub fn face_surfaces(m: &Model, req: FaceSurfacesRequest) -> Result<Vec<FaceSurfaceOut>, ApiError> {
    m.call(move |doc| {
        Ok(doc.face_surfaces(req.body)?.into_iter().map(|f| match f {
            w3d_kernel::FaceSurface::Other => FaceSurfaceOut::Other,
            w3d_kernel::FaceSurface::Plane { origin, normal } => FaceSurfaceOut::Plane { origin: origin.to_array(), normal: normal.to_array() },
            w3d_kernel::FaceSurface::Cylinder { origin, axis, radius, outward } => FaceSurfaceOut::Cylinder { origin: origin.to_array(), axis: axis.to_array(), radius, outward },
            w3d_kernel::FaceSurface::Sphere { centre, radius, outward } => FaceSurfaceOut::Sphere { centre: centre.to_array(), radius, outward },
        }).collect())
    })
}
