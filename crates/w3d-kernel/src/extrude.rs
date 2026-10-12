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
}

#[derive(Clone, Debug)]
pub struct ExtrudeParams {
    pub profile: Profile,
    pub frame: Frame,
    pub distance: f64,
    pub operation: Operation,
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
    let tool = k.extrude(&p.profile, &p.frame, p.distance)?;
    let Some(body) = target.filter(|_| p.operation == Operation::Auto) else {
        return Ok(ExtrudeResult::New(tool));
    };

    let op = if p.distance > 0.0 { BooleanOp::Union } else { BooleanOp::Difference };
    let crate::Traced { solid: result, history } = k.boolean(body, &tool, op)?;
    // Touching or overlapping fuses into the same number of solids; a cut that changed nothing missed.
    let met = match op {
        BooleanOp::Union => k.solid_count(&result) == k.solid_count(body),
        _ => k.face_count(&result) != k.face_count(body),
    };
    if !met {
        return Ok(ExtrudeResult::New(tool));
    }
    if k.solid_count(&result) == 0 {
        return Err(KernelError::Invalid("boolean produced an empty body"));
    }
    Ok(ExtrudeResult::Replace { solid: result, op, history })
}
