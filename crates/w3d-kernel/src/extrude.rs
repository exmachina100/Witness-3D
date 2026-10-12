//! Push/pull extrude that turns into a boolean when it meets a body, after Plasticity's
//! `PossiblyBooleanExtrudeFactory` (src/commands/extrude/ExtrudeFactory.ts:115-117, :150):
//! pulling out of a face joins, pushing in cuts, and an extrude that touches nothing is a new body.

use crate::{BooleanOp, Frame, History, Kernel, KernelError, Profile};

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
}

#[derive(Clone, Debug)]
pub struct ExtrudeParams {
    pub profile: Profile,
    pub frame: Frame,
    pub distance: f64,
    pub operation: Operation,
    /// Extrude this face of the target along its normal instead of `profile` (Plasticity's
    /// Extrude on a face). `frame` and `profile` are then unused.
    pub face: Option<u32>,
}

/// The extruded shape on its own, before any boolean.
pub fn tool<K: Kernel>(k: &K, target: Option<&K::Solid>, p: &ExtrudeParams) -> Result<K::Solid, KernelError> {
    match p.face {
        Some(face) => k.extrude_face(target.ok_or(KernelError::Invalid("that body no longer exists"))?, face, p.distance),
        None => k.extrude(&p.profile, &p.frame, p.distance),
    }
}

#[derive(Clone, Debug)]
pub enum ExtrudeResult<S> {
    /// The target body, replaced by the joined or cut result.
    Replace { solid: S, op: BooleanOp, history: History },
    /// A separate new body.
    New(S),
}

pub fn extrude<K: Kernel>(k: &K, target: Option<&K::Solid>, p: &ExtrudeParams) -> Result<ExtrudeResult<K::Solid>, KernelError> {
    if p.distance.abs() < 1e-9 {
        return Err(KernelError::NoOp);
    }
    let tool = tool(k, target, p)?;
    let Some(body) = target.filter(|_| p.operation != Operation::NewBody) else {
        return Ok(ExtrudeResult::New(tool));
    };

    let op = match p.operation {
        Operation::Union => BooleanOp::Union,
        Operation::Difference => BooleanOp::Difference,
        Operation::Intersect => BooleanOp::Intersection,
        _ if p.distance > 0.0 => BooleanOp::Union,
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
        return match p.operation {
            Operation::Auto | Operation::Union => Ok(ExtrudeResult::New(tool)),
            _ => Err(KernelError::Invalid("the extrude does not meet the body")),
        };
    }
    if k.solid_count(&result) == 0 {
        return Err(KernelError::Invalid("boolean produced an empty body"));
    }
    Ok(ExtrudeResult::Replace { solid: result, op, history })
}
