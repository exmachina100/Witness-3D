//! Revolve, Loft and Sweep, which grow a solid from drawn regions, and Offset Face, which moves
//! faces of a body. The first three end like Extrude: the new shape becomes a body of its own, or
//! Plasticity's Q, W and Shift+E join it to, cut it from or intersect it with the body the profile
//! lies on (manual v26.1, solid/revolve, solid/loft and solid/sweep).

use glam::DVec3;

use crate::extrude::{combine, ExtrudeResult, Operation};
use crate::{BooleanOp, Frame, Kernel, KernelError, Path, Profile, Traced};

#[derive(Clone, Debug)]
pub enum FormKind {
    /// Turn the profile `angle` radians about an axis (Plasticity picks it with two clicks).
    Revolve {
        axis_point: DVec3,
        axis_dir: DVec3,
        angle: f64,
        /// Walls this thick inside the outline instead of a filled solid (Shift+T); zero for solid.
        thickness: f64,
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
            thickness,
        } => {
            if !angle.is_finite() || angle.abs() < 1e-9 {
                return Err(KernelError::NoOp);
            }
            if axis_dir.length() < 1e-9 || !axis_dir.is_finite() || !axis_point.is_finite() {
                return Err(KernelError::Invalid(
                    "pick two different points for the axis",
                ));
            }
            if !thickness.is_finite() || *thickness < 0.0 {
                return Err(KernelError::Invalid("the thickness can't be negative"));
            }
            let angle = angle.clamp(-std::f64::consts::TAU, std::f64::consts::TAU);
            k.revolve(
                &p.profile,
                &p.frame,
                *axis_point,
                axis_dir.normalize(),
                angle,
                *thickness,
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
    angle: f64,
) -> Result<Traced<K::Solid>, KernelError> {
    if faces.is_empty() {
        return Err(KernelError::Invalid("select at least one face"));
    }
    if !distance.is_finite() {
        return Err(KernelError::Invalid("the distance is not a number"));
    }
    if !angle.is_finite() || angle.abs() >= std::f64::consts::FRAC_PI_2 {
        return Err(KernelError::Invalid("the angle must be between -90° and 90°"));
    }
    if distance.abs() < 1e-9 && angle.abs() < 1e-9 {
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
    let traced = k.offset_faces(body, &faces, distance, angle)?;
    if !k.is_valid(&traced.solid) || k.solid_count(&traced.solid) != k.solid_count(body) {
        return Err(KernelError::Invalid(
            "offsetting that far breaks the body; try a smaller distance",
        ));
    }
    Ok(traced)
}

/// Plasticity's Pipe: a tube of `radius` along `path`, its section a circle (`sides` 0) or a
/// regular polygon with corners on the radius; with a `thickness` its walls are that thick and
/// the middle is hollow. The section starts square to the path and is swept along it.
pub fn pipe<K: Kernel>(k: &K, path: &Path, radius: f64, thickness: f64, sides: u32) -> Result<K::Solid, KernelError> {
    if !radius.is_finite() || radius <= 1e-6 { return Err(KernelError::Invalid("the radius must be greater than zero")) }
    if !thickness.is_finite() || thickness < 0.0 { return Err(KernelError::Invalid("the thickness can't be negative")) }
    if thickness >= radius - 1e-6 { return Err(KernelError::Invalid("the wall is as thick as the pipe; use a thinner wall or leave it solid")) }
    if sides == 1 || sides == 2 || sides > 256 { return Err(KernelError::Invalid("a pipe's section is round (0 sides) or has 3 to 256 sides")) }
    let pts = k.sample(path, 4096)?;
    if pts.len() < 2 { return Err(KernelError::Invalid("the path is too short")) }
    let tangent = pts.iter().skip(1).map(|p| *p - pts[0]).find(|d| d.length() > 1e-9).ok_or(KernelError::Invalid("the path is too short"))?;
    let normal = tangent.normalize();
    let x = if normal.x.abs() < 0.9 { DVec3::X } else { DVec3::Y };
    let frame = Frame::new(pts[0], x, normal);
    let section = |r: f64| if sides == 0 {
        Profile::Circle { center: (0.0, 0.0), radius: r }
    } else {
        Profile::Polygon((0..sides).map(|i| { let a = std::f64::consts::TAU * i as f64 / sides as f64; (r * a.cos(), r * a.sin()) }).collect())
    };
    let outer = k.sweep(&section(radius), &frame, path, 0.0, 1.0)?;
    if thickness <= 1e-9 { return Ok(outer) }
    let inner = k.sweep(&section(radius - thickness), &frame, path, 0.0, 1.0)?;
    Ok(k.boolean(&outer, &inner, BooleanOp::Difference)?.solid)
}
