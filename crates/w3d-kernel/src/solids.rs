//! Round 6: solids made from nothing (Plasticity's Box, Cylinder and Sphere), Shell, Mirror, and
//! Rectangular and Radial Array. Each checks its inputs here, so every kernel and every front end
//! refuses the same things with the same sentence.

use glam::DVec3;

use crate::{Extent, Frame, Kernel, KernelError, Motion, Profile, Traced};

/// A solid made from dimensions alone. Lengths may be negative to grow the other way along an axis,
/// as when a box is dragged left of its first corner.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Primitive {
    /// From the frame's origin: `width` along its x, `depth` along its y, `height` along its normal.
    Box { frame: Frame, width: f64, depth: f64, height: f64 },
    /// A circle of `radius` centred on the frame's origin, raised `height` along its normal.
    Cylinder { frame: Frame, radius: f64, height: f64 },
    Sphere { center: DVec3, radius: f64 },
}

const SMALL: f64 = 1e-6;

fn finite(v: &[f64]) -> bool { v.iter().all(|x| x.is_finite()) }
fn frame_ok(f: &Frame) -> bool { finite(&f.origin.to_array()) && finite(&f.x.to_array()) && finite(&f.normal.to_array()) && f.x.cross(f.normal).length() > 1e-9 }

/// The primitive as a solid.
pub fn primitive<K: Kernel>(k: &K, p: &Primitive) -> Result<K::Solid, KernelError> {
    match *p {
        Primitive::Box { frame, width, depth, height } => {
            if !frame_ok(&frame) || !finite(&[width, depth, height]) { return Err(KernelError::Invalid("the box's size is not a number")) }
            if width.abs() < SMALL || depth.abs() < SMALL || height.abs() < SMALL { return Err(KernelError::Invalid("a box needs a width, a depth and a height")) }
            // The rectangle from the corner, extruded: one code path for every construction plane.
            let pts = vec![(0.0, 0.0), (width, 0.0), (width, depth), (0.0, depth)];
            let pts = if width * depth < 0.0 { pts.into_iter().rev().collect() } else { pts };
            k.extrude(&Profile::Polygon(pts), &frame, &Extent::to(height))
        }
        Primitive::Cylinder { frame, radius, height } => {
            if !frame_ok(&frame) || !finite(&[radius, height]) { return Err(KernelError::Invalid("the cylinder's size is not a number")) }
            if !(radius > SMALL) { return Err(KernelError::Invalid("the cylinder's radius must be greater than zero")) }
            if height.abs() < SMALL { return Err(KernelError::Invalid("a cylinder needs a height")) }
            k.extrude(&Profile::Circle { center: (0.0, 0.0), radius }, &frame, &Extent::to(height))
        }
        Primitive::Sphere { center, radius } => {
            if !finite(&center.to_array()) || !radius.is_finite() { return Err(KernelError::Invalid("the sphere's size is not a number")) }
            if !(radius > SMALL) { return Err(KernelError::Invalid("the sphere's radius must be greater than zero")) }
            k.sphere(center, radius)
        }
    }
}

/// Shell: checked inputs, then a check that the result is still one valid solid.
pub fn shell<K: Kernel>(k: &K, body: &K::Solid, faces: &[u32], thickness: f64) -> Result<Traced<K::Solid>, KernelError> {
    if faces.is_empty() { return Err(KernelError::Invalid("select the faces to open")) }
    if !thickness.is_finite() { return Err(KernelError::Invalid("the thickness is not a number")) }
    if !(thickness > SMALL) { return Err(KernelError::Invalid("the wall thickness must be greater than zero")) }
    let count = k.face_count(body);
    if faces.iter().any(|&f| f as usize >= count) {
        return Err(KernelError::Invalid("a face in the selection is not on this body; select the faces again"));
    }
    let mut faces = faces.to_vec();
    faces.sort_unstable();
    faces.dedup();
    if faces.len() == count { return Err(KernelError::Invalid("leave at least one face closed")) }
    let traced = k.shell(body, &faces, thickness)?;
    if !k.is_valid(&traced.solid) || k.solid_count(&traced.solid) != k.solid_count(body) {
        return Err(KernelError::Invalid("a shell that thick breaks the body; try a thinner one"));
    }
    Ok(traced)
}

/// Mirror: checked plane, then the reflected copy.
pub fn mirror<K: Kernel>(k: &K, body: &K::Solid, origin: DVec3, normal: DVec3) -> Result<K::Solid, KernelError> {
    if !finite(&origin.to_array()) || !finite(&normal.to_array()) { return Err(KernelError::Invalid("the mirror plane is not a number")) }
    if normal.length() < 1e-9 { return Err(KernelError::Invalid("the mirror plane has no direction")) }
    k.mirror(body, origin, normal.normalize())
}

/// Place's motion: finite, with a scale above zero and an axis when it turns.
pub fn check_motion(m: &Motion) -> Result<(), KernelError> {
    if !finite(&m.offset.to_array()) || !finite(&m.pivot.to_array()) || !finite(&m.axis.to_array()) || !m.angle.is_finite() || !m.scale.is_finite() {
        return Err(KernelError::Invalid("the placement is not a number"));
    }
    if m.scale <= 1e-9 { return Err(KernelError::Invalid("the scale must be above zero")) }
    if m.angle.abs() > 1e-12 && m.axis.length() < 1e-9 { return Err(KernelError::Invalid("the placement's axis has no direction")) }
    Ok(())
}

/// How to repeat bodies (Plasticity's Rectangular, Radial and Curve Array). Counts include the original.
#[derive(Clone, Debug, PartialEq)]
pub enum ArraySpec {
    /// `count[i]` copies `step[i]` apart along each of up to three directions, in a grid.
    Rectangular { steps: [DVec3; 3], counts: [u32; 3] },
    /// `count` copies turned evenly through `angle` radians about the axis through `pivot`. A full
    /// turn spaces them `angle / count` apart so the last doesn't land on the first.
    Radial { pivot: DVec3, axis: DVec3, angle: f64, count: u32 },
    /// Each copy's motion given outright (Curve Array works them out along its curve).
    Motions(Vec<Motion>),
}

/// At most this many bodies from one array, so a typo can't freeze the app.
pub const MAX_ARRAY: u32 = 1000;

impl ArraySpec {
    /// The motion of every copy, the original (identity) excluded, in grid or turn order.
    pub fn motions(&self) -> Result<Vec<Motion>, KernelError> {
        match *self {
            ArraySpec::Motions(ref motions) => {
                if motions.len() > MAX_ARRAY as usize { return Err(KernelError::Invalid("that array makes more than 1000 bodies")) }
                if motions.is_empty() { return Err(KernelError::NoOp) }
                for m in motions {
                    if !finite(&m.offset.to_array()) || !finite(&m.pivot.to_array()) || !finite(&m.axis.to_array()) || !m.angle.is_finite() { return Err(KernelError::Invalid("an array copy is not placed at a number")) }
                    if m.angle.abs() > 1e-12 && m.axis.length() < 1e-9 { return Err(KernelError::Invalid("the array's axis has no direction")) }
                }
                Ok(motions.iter().map(|m| Motion { axis: if m.axis.length() < 1e-9 { DVec3::Y } else { m.axis.normalize() }, scale: 1.0, ..*m }).collect())
            }
            ArraySpec::Rectangular { steps, counts } => {
                if steps.iter().any(|s| !finite(&s.to_array())) { return Err(KernelError::Invalid("an array step is not a number")) }
                if counts.iter().any(|&c| c == 0) { return Err(KernelError::Invalid("each array count must be at least 1")) }
                let total = counts.iter().map(|&c| c as u64).product::<u64>();
                if total > MAX_ARRAY as u64 { return Err(KernelError::Invalid("that array makes more than 1000 bodies")) }
                if total < 2 { return Err(KernelError::NoOp) }
                for i in 0..3 {
                    if counts[i] > 1 && steps[i].length() < SMALL { return Err(KernelError::Invalid("an array direction with more than one copy needs a spacing")) }
                }
                let mut out = Vec::new();
                for a in 0..counts[0] { for b in 0..counts[1] { for c in 0..counts[2] {
                    if a + b + c == 0 { continue }
                    out.push(Motion::translation(steps[0] * a as f64 + steps[1] * b as f64 + steps[2] * c as f64));
                }}}
                Ok(out)
            }
            ArraySpec::Radial { pivot, axis, angle, count } => {
                if !finite(&pivot.to_array()) || !finite(&axis.to_array()) || !angle.is_finite() { return Err(KernelError::Invalid("the array's axis or angle is not a number")) }
                if axis.length() < 1e-9 { return Err(KernelError::Invalid("the array's axis has no direction")) }
                if count == 0 { return Err(KernelError::Invalid("the array count must be at least 1")) }
                if count > MAX_ARRAY { return Err(KernelError::Invalid("that array makes more than 1000 bodies")) }
                if count < 2 || angle.abs() < 1e-9 { return Err(KernelError::NoOp) }
                let full = (angle.abs() - std::f64::consts::TAU).abs() < 1e-9;
                let step = if full { angle / count as f64 } else { angle / (count - 1) as f64 };
                Ok((1..count).map(|i| Motion::rotation(pivot, axis.normalize(), step * i as f64)).collect())
            }
        }
    }
}

/// Remove Face: checked inputs, then a check that the result is still one valid solid.
pub fn remove_faces<K: Kernel>(k: &K, body: &K::Solid, faces: &[u32]) -> Result<Traced<K::Solid>, KernelError> {
    if faces.is_empty() { return Err(KernelError::Invalid("select the faces to remove")) }
    let count = k.face_count(body);
    if faces.iter().any(|&f| f as usize >= count) {
        return Err(KernelError::Invalid("a face in the selection is not on this body; select the faces again"));
    }
    let mut faces = faces.to_vec();
    faces.sort_unstable();
    faces.dedup();
    if faces.len() == count { return Err(KernelError::Invalid("that would remove the whole body; delete it instead")) }
    let traced = k.remove_faces(body, &faces)?;
    if !k.is_valid(&traced.solid) || k.solid_count(&traced.solid) != k.solid_count(body) {
        return Err(KernelError::Invalid("removing those faces breaks the body"));
    }
    Ok(traced)
}

/// Dimension on a fillet: the fillet faces made again at `radius`, checked to leave one valid solid.
pub fn refillet<K: Kernel>(k: &K, body: &K::Solid, faces: &[u32], radius: f64) -> Result<Traced<K::Solid>, KernelError> {
    if faces.is_empty() { return Err(KernelError::Invalid("select a fillet")) }
    if !(radius > 0.0) || !radius.is_finite() { return Err(KernelError::Invalid("the radius must be above zero")) }
    if faces.iter().any(|&f| f as usize >= k.face_count(body)) {
        return Err(KernelError::Invalid("a face in the selection is not on this body; select the faces again"));
    }
    let traced = k.refillet(body, faces, radius)?;
    if !k.is_valid(&traced.solid) || k.solid_count(&traced.solid) != k.solid_count(body) {
        return Err(KernelError::Invalid("a fillet that size breaks the body"));
    }
    Ok(traced)
}
