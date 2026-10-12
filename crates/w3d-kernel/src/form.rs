//! Revolve, Loft and Sweep, which grow a solid from drawn regions, and Offset Face, which moves
//! faces of a body. The first three end like Extrude: the new shape becomes a body of its own, or
//! Plasticity's Q, W and Shift+E join it to, cut it from or intersect it with the body the profile
//! lies on (manual v26.1, solid/revolve, solid/loft and solid/sweep).

use glam::DVec3;

use crate::extrude::{combine, ExtrudeResult, Operation};
use crate::{Frame, Kernel, KernelError, Path, Profile, Traced};

#[derive(Clone, Debug)]
pub enum FormKind {
    /// Turn the profile `angle` radians about an axis (Plasticity picks it with two clicks).
    Revolve {
        axis_point: DVec3,
        axis_dir: DVec3,
        angle: f64,
    },
    /// Pass a solid through the profile and then each of `more`, in selection order.
    Loft { more: Vec<(Profile, Frame)> },
    /// Sweep the profile along `path`, turning its far end by `twist` radians and scaling it by `scale`.
    Sweep { path: Path, twist: f64, scale: f64 },
}

#[derive(Clone, Debug)]
pub struct FormParams {
    pub profile: Profile,
    pub frame: Frame,
    pub kind: FormKind,
    pub operation: Operation,
}

/// The new shape on its own, before any boolean.
pub fn tool<K: Kernel>(k: &K, p: &FormParams) -> Result<K::Solid, KernelError> {
    match &p.kind {
        FormKind::Revolve {
            axis_point,
            axis_dir,
            angle,
        } => {
            if !angle.is_finite() || angle.abs() < 1e-9 {
                return Err(KernelError::NoOp);
            }
            if axis_dir.length() < 1e-9 || !axis_dir.is_finite() || !axis_point.is_finite() {
                return Err(KernelError::Invalid(
                    "pick two different points for the axis",
                ));
            }
            let angle = angle.clamp(-std::f64::consts::TAU, std::f64::consts::TAU);
            k.revolve(
                &p.profile,
                &p.frame,
                *axis_point,
                axis_dir.normalize(),
                angle,
            )
        }
        FormKind::Loft { more } => {
            if more.is_empty() {
                return Err(KernelError::Invalid("select two regions or more to loft"));
            }
            let mut all = vec![(p.profile.clone(), p.frame)];
            all.extend(more.iter().cloned());
            k.loft(&all)
        }
        FormKind::Sweep { path, twist, scale } => {
            if !twist.is_finite() || !(*scale > 0.0) || !scale.is_finite() {
                return Err(KernelError::Invalid(
                    "the end scale must be greater than zero",
                ));
            }
            k.sweep(&p.profile, &p.frame, path, *twist, *scale)
        }
    }
}

pub fn form<K: Kernel>(
    k: &K,
    target: Option<&K::Solid>,
    p: &FormParams,
) -> Result<ExtrudeResult<K::Solid>, KernelError> {
    let tool = tool(k, p)?;
    if !k.is_valid(&tool) || k.solid_count(&tool) == 0 {
        return Err(KernelError::Invalid(
            "the shape crosses itself; change the axis, path or profiles",
        ));
    }
    combine(
        k,
        target,
        tool,
        p.operation,
        true,
        "the shape does not meet the body",
    )
}

/// Offset Face: checked inputs, then a check that the body is still one valid solid.
pub fn offset_faces<K: Kernel>(
    k: &K,
    body: &K::Solid,
    faces: &[u32],
    distance: f64,
) -> Result<Traced<K::Solid>, KernelError> {
    if faces.is_empty() {
        return Err(KernelError::Invalid("select at least one face"));
    }
    if !distance.is_finite() {
        return Err(KernelError::Invalid("the distance is not a number"));
    }
    if distance.abs() < 1e-9 {
        return Err(KernelError::NoOp);
    }
    let count = k.face_count(body);
    if faces.iter().any(|&f| f as usize >= count) {
        return Err(KernelError::Invalid(
            "a face in the selection is not on this body; select the faces again",
        ));
    }
    let mut faces = faces.to_vec();
    faces.sort_unstable();
    faces.dedup();
    let traced = k.offset_faces(body, &faces, distance)?;
    if !k.is_valid(&traced.solid) || k.solid_count(&traced.solid) != k.solid_count(body) {
        return Err(KernelError::Invalid(
            "offsetting that far breaks the body; try a smaller distance",
        ));
    }
    Ok(traced)
}
