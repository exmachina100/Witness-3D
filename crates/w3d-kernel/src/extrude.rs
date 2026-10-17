//! Push/pull extrude that turns into a boolean when it meets a body, after Plasticity's
//! `PossiblyBooleanExtrudeFactory` (src/commands/extrude/ExtrudeFactory.ts:115-117, :150):
//! pulling out of a face joins, pushing in cuts, and an extrude that touches nothing is a new body.

use glam::DVec3;

use crate::{BooleanOp, Extent, Frame, History, Kernel, KernelError, Profile};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Operation {
    /// Join when pulling out, cut when pushing in.
    Auto,
    /// Always a separate body.
    NewBody,
    /// Plasticity's Q, W and Shift+E inside Extrude: this boolean with the target whatever the
    /// direction.
    Union,
    Difference,
    Intersect,
    /// Plasticity's Shift+Q: cut the body in two along the tool; the part inside becomes a new body.
    Slice,
}

#[derive(Clone, Debug)]
pub struct ExtrudeParams {
    pub profile: Profile,
    pub frame: Frame,
    pub distance: f64,
    /// The other way as well (S locks it to `distance`).
    pub back: f64,
    /// Radians the sides lean in (A).
    pub angle: f64,
    /// Wall thickness, zero for a filled solid (Shift+T).
    pub thickness: f64,
    pub operation: Operation,
    /// Extrude this face of the target along its normal instead of `profile` (Plasticity's
    /// Extrude on a face). `frame` and `profile` are then unused.
    pub face: Option<u32>,
    /// Plasticity's Freestyle (F): extrude along this direction instead of the normal.
    pub direction: Option<DVec3>,
    /// More faces of the target extruded with `face`, the tools joined into one.
    pub more_faces: Vec<u32>,
    /// Plasticity's Individual (I): each face along its own normal instead of all along the first
    /// face's (Direct).
    pub individual: bool,
}

impl ExtrudeParams {
    pub fn extent(&self) -> Extent { Extent { distance: self.distance, back: self.back, angle: self.angle, thickness: self.thickness } }
}

/// The extruded shape on its own, before any boolean.
pub fn tool<K: Kernel>(k: &K, target: Option<&K::Solid>, p: &ExtrudeParams) -> Result<K::Solid, KernelError> {
    let e = p.extent();
    if !e.distance.is_finite() || !e.back.is_finite() || !e.angle.is_finite() || !e.thickness.is_finite() {
        return Err(KernelError::Invalid("a distance is not a number"));
    }
    if e.back < 0.0 || e.thickness < 0.0 { return Err(KernelError::Invalid("the far side and the thickness can't be negative")) }
    if e.angle.abs() >= std::f64::consts::FRAC_PI_2 - 1e-6 { return Err(KernelError::Invalid("the angle must be less than 90 degrees")) }
    let direction = match p.direction {
        Some(d) if !d.is_finite() || d.length() < 1e-9 => return Err(KernelError::Invalid("the freestyle direction has no length")),
        d => d.map(|d| d.normalize()),
    };
    let Some(face) = p.face else {
        return match direction {
            Some(d) => k.extrude_along(&p.profile, &p.frame, d, &e),
            None => k.extrude(&p.profile, &p.frame, &e),
        };
    };
    let target = target.ok_or(KernelError::Invalid("that body no longer exists"))?;
    let mut faces = vec![face];
    for &f in &p.more_faces { if !faces.contains(&f) { faces.push(f) } }
    if faces.len() == 1 && direction.is_none() { return k.extrude_face(target, face, &e) }
    let normal = |f: u32| k.face_normal(target, f).ok_or(KernelError::Invalid("that face has no direction to extrude in"));
    // Direct: every face along the first face's normal (or the freestyle direction); Individual:
    // each along its own.
    let common = match direction { Some(d) => d, None => normal(face)? };
    let mut out: Option<K::Solid> = None;
    for f in faces {
        let dir = if p.individual { normal(f)? } else { common };
        if dir.dot(normal(f)?).abs() < 1e-6 { return Err(KernelError::Invalid("a face lies along the extrude's direction; use Individual (I) or pick other faces")) }
        let piece = k.extrude_face_along(target, f, dir, &e)?;
        out = Some(match out { None => piece, Some(all) => k.boolean(&all, &piece, BooleanOp::Union)?.solid });
    }
    Ok(out.expect("at least one face"))
}

/// Whether a positive distance moves away from the body: false when the freestyle direction
/// points back into the face or region it starts from.
fn outward<K: Kernel>(k: &K, target: Option<&K::Solid>, p: &ExtrudeParams) -> bool {
    let reference = match p.face {
        Some(f) => target.and_then(|t| k.face_normal(t, f)),
        None => Some(p.frame.normal),
    };
    let along = match (p.direction, reference) {
        (Some(d), Some(n)) if !p.individual || p.face.is_none() => d.dot(n) >= 0.0,
        _ => true,
    };
    (p.distance > 0.0) == along
}

#[derive(Clone, Debug)]
pub enum ExtrudeResult<S> {
    /// The target body, replaced by the joined or cut result.
    Replace { solid: S, op: BooleanOp, history: History },
    /// A separate new body.
    New(S),
    /// The target cut in two: `solid` replaces it, `piece` (the part inside the tool) is a new body.
    Slice { solid: S, history: History, piece: S },
}

pub fn extrude<K: Kernel>(k: &K, target: Option<&K::Solid>, p: &ExtrudeParams) -> Result<ExtrudeResult<K::Solid>, KernelError> {
    if p.distance.abs() < 1e-9 && p.back.abs() < 1e-9 {
        return Err(KernelError::NoOp);
    }
    let tool = tool(k, target, p)?;
    combine(k, target, tool, p.operation, outward(k, target, p), "the extrude does not meet the body")
}

/// Join `tool` to `target`, cut it out or intersect with it, as `operation` says; `Auto` joins when
/// `outward` and cuts otherwise. A tool that misses the body becomes a new body under `Auto` and
/// `Union`, and the error `miss` for the others.
pub fn combine<K: Kernel>(k: &K, target: Option<&K::Solid>, tool: K::Solid, operation: Operation, outward: bool, miss: &'static str) -> Result<ExtrudeResult<K::Solid>, KernelError> {
    let Some(body) = target.filter(|_| operation != Operation::NewBody) else {
        return Ok(ExtrudeResult::New(tool));
    };

    if operation == Operation::Slice {
        let crate::Traced { solid, history } = k.boolean(body, &tool, BooleanOp::Difference)?;
        let piece = k.boolean(body, &tool, BooleanOp::Intersection)?.solid;
        if k.solid_count(&solid) == 0 || k.solid_count(&piece) == 0 || k.face_count(&piece) == 0 {
            return Err(KernelError::Invalid("the slice does not cut through the body"));
        }
        return Ok(ExtrudeResult::Slice { solid, history, piece });
    }
    let op = match operation {
        Operation::Union => BooleanOp::Union,
        Operation::Difference => BooleanOp::Difference,
        Operation::Intersect => BooleanOp::Intersection,
        Operation::Slice => unreachable!(),
        _ if outward => BooleanOp::Union,
        _ => BooleanOp::Difference,
    };
    let crate::Traced { solid: result, history } = k.boolean(body, &tool, op)?;
    // Touching or overlapping fuses into the same number of solids; a cut that changed nothing missed.
    let met = match op {
        BooleanOp::Union => k.solid_count(&result) == k.solid_count(body),
        // A tool face left in the result means the cut reached the body; a slab off the top
        // changes no face count, so that alone can't tell.
        BooleanOp::Difference => !history.faces[1].is_empty() || k.face_count(&result) != k.face_count(body),
        BooleanOp::Intersection => k.face_count(&result) > 0,
    };
    if !met {
        return match operation {
            Operation::Auto | Operation::Union => Ok(ExtrudeResult::New(tool)),
            _ => Err(KernelError::Invalid(miss)),
        };
    }
    if k.solid_count(&result) == 0 {
        return Err(KernelError::Invalid("boolean produced an empty body"));
    }
    Ok(ExtrudeResult::Replace { solid: result, op, history })
}
