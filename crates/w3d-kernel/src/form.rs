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
    /// Pass a solid through the profile and then each of `more`, in selection order, its sides
    /// along the `guides` when there are any.
    Loft { more: Vec<(Profile, Frame)>, guides: Vec<Path> },
    /// Sweep the profile along `path`, turning its far end by `twist` radians and scaling it by
    /// `scale`; or following `guide` by `method`; or kept parallel to itself (`align`).
    Sweep { path: Path, twist: f64, scale: f64, guides: Vec<Path>, method: GuideMethod, align: Alignment, round: bool },
}

/// How a swept section follows its guide (Plasticity's Guide method).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum GuideMethod {
    /// The section turns and scales so it keeps touching the guide.
    #[default]
    Point,
    /// The section turns toward the guide without scaling.
    Chord,
    /// As Chord, matched by length along the guide.
    Curve,
}

/// How a swept section is held along the path (Plasticity's Alignment).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Alignment {
    /// Turned with the path, staying square to it.
    #[default]
    Normal,
    /// Kept at its drawn orientation all along.
    Parallel,
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
        FormKind::Loft { more, guides } => {
            if more.is_empty() {
                return Err(KernelError::Invalid("select two regions or more to loft"));
            }
            let mut all = vec![(p.profile.clone(), p.frame)];
            all.extend(more.iter().cloned());
            if guides.is_empty() { k.loft(&all) } else { k.loft_guided(&all, guides) }
        }
        FormKind::Sweep { path, twist, scale, guides, method, align, round } => {
            if !twist.is_finite() || !(*scale > 0.0) || !scale.is_finite() {
                return Err(KernelError::Invalid(
                    "the end scale must be greater than zero",
                ));
            }
            let plain = twist.abs() < 1e-12 && (scale - 1.0).abs() < 1e-12;
            if guides.is_empty() && *align == Alignment::Normal && !*round { return k.sweep(&p.profile, &p.frame, path, *twist, *scale) }
            if !plain { return Err(KernelError::Invalid("twist and scale don't go with a guide, Parallel alignment or Round corners; set them back to 0 and 1")) }
            let method = match method { GuideMethod::Point => 0, GuideMethod::Chord => 1, GuideMethod::Curve => 2 };
            k.sweep_guided(&p.profile, &p.frame, path, guides, method, *align == Alignment::Parallel, *round)
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

/// Offset Face's grow mode (Tab), for an inner face pushed out until it reaches the body's outer
/// wall beyond it (manual, solid/offset-face): Moving takes the whole wall along, Fixed stops at the
/// wall, None carries on by itself past it, leaving the wall where it was. Short of the wall all three
/// are the same.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Grow {
    #[default]
    Moving,
    Fixed,
    None,
}

/// Offset Face: checked inputs, then a check that the body is still one valid solid.
pub fn offset_faces<K: Kernel>(
    k: &K,
    body: &K::Solid,
    faces: &[u32],
    distance: f64,
    angle: f64,
) -> Result<Traced<K::Solid>, KernelError> {
    offset_faces_grow(k, body, faces, distance, angle, Grow::default())
}

/// [`offset_faces`] with a grow mode.
pub fn offset_faces_grow<K: Kernel>(
    k: &K,
    body: &K::Solid,
    faces: &[u32],
    distance: f64,
    angle: f64,
    grow: Grow,
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
    let traced = match grown_past_wall(k, body, &faces, distance, angle, grow)? {
        Some(t) => t,
        None => k.offset_faces(body, &faces, distance, angle)?,
    };
    if !k.is_valid(&traced.solid) || k.solid_count(&traced.solid) != k.solid_count(body) {
        return Err(KernelError::Invalid(
            "offsetting that far breaks the body; try a smaller distance",
        ));
    }
    Ok(traced)
}

/// Flat faces pushed out as far as the body's outer wall beyond them or further: each face's slab
/// is joined on, stopping at the wall (Fixed), going on past it (None), or with the wall's own
/// faces pushed out to the same place (Moving). None when no face gets that far, or when an angle
/// or a curved face leaves it to the kernel's offset.
fn grown_past_wall<K: Kernel>(
    k: &K,
    body: &K::Solid,
    faces: &[u32],
    distance: f64,
    angle: f64,
    grow: Grow,
) -> Result<Option<Traced<K::Solid>>, KernelError> {
    const TOL: f64 = 1e-6;
    if distance <= TOL || angle.abs() > 1e-12 {
        return Ok(None);
    }
    let mesh = k.tessellate(body, 0.1)?;
    let mut planes = Vec::new();
    for &f in faces {
        match mesh.face_planes.get(f as usize).copied().flatten() {
            Some(p) => planes.push(p),
            None => return Ok(None),
        }
    }
    // How far the body reaches beyond each face along its normal: zero for an outside face.
    let reach = |p: &crate::Plane| {
        mesh.positions.iter().map(|q| (DVec3::from(*q) - p.origin).dot(p.normal)).fold(0.0, f64::max)
    };
    let walls: Vec<f64> = planes.iter().map(reach).collect();
    if !walls.iter().any(|&w| w > TOL && distance >= w - TOL) {
        return Ok(None);
    }
    let mut tool: Option<K::Solid> = None;
    let mut add = |s: K::Solid, k: &K| -> Result<(), KernelError> {
        tool = Some(match tool.take() {
            Some(t) => k.boolean(&t, &s, BooleanOp::Union)?.solid,
            None => s,
        });
        Ok(())
    };
    for ((&f, p), &w) in faces.iter().zip(&planes).zip(&walls) {
        let past = w > TOL && distance >= w - TOL;
        let d = if past && grow == Grow::Fixed { w } else { distance };
        if d > TOL {
            add(k.extrude_face(body, f, &crate::Extent::to(d))?, k)?;
        }
        if past && grow == Grow::Moving && distance > w + TOL {
            // The outer wall: flat faces facing the same way at the far end of the body.
            for (g, q) in mesh.face_planes.iter().enumerate() {
                let Some(q) = q else { continue };
                if q.normal.dot(p.normal) > 1.0 - 1e-9 && ((q.origin - p.origin).dot(p.normal) - w).abs() < TOL * 10.0 {
                    add(k.extrude_face(body, g as u32, &crate::Extent::to(distance - w))?, k)?;
                }
            }
        }
    }
    let Some(tool) = tool else { return Ok(None) };
    Ok(Some(k.boolean(body, &tool, BooleanOp::Union)?))
}

/// Match Face with its grow mode, for an inner flat face matched to a surface beyond the body's
/// outer wall (manual, solid/match-face): Moving takes the wall's own faces to the surface too,
/// Fixed stops at the wall, None carries on past it by itself. `keep` is a face of the body never
/// to take along (the target, when it is on the same body).
pub fn match_faces_grow<K: Kernel>(
    k: &K,
    body: &K::Solid,
    faces: &[u32],
    target: &K::Solid,
    tface: u32,
    grow: Grow,
    keep: Option<u32>,
) -> Result<K::Solid, KernelError> {
    const TOL: f64 = 1e-6;
    let mesh = k.tessellate(body, 0.1)?;
    let reach = |positions: &[[f64; 3]], p: &crate::Plane| {
        positions.iter().map(|q| (DVec3::from(*q) - p.origin).dot(p.normal)).fold(0.0, f64::max)
    };
    // Each flat face's plane and how far the body reaches beyond it: its outer wall.
    let walls: Vec<Option<(crate::Plane, f64)>> = faces.iter().map(|&f| {
        mesh.face_planes.get(f as usize).copied().flatten().map(|p| (p, reach(&mesh.positions, &p))).filter(|(_, w)| *w > TOL)
    }).collect();
    let caps: Vec<f64> = walls.iter().map(|w| match (grow, w) { (Grow::Fixed, Some((_, w))) => *w, _ => 0.0 }).collect();
    let matched = k.match_faces(body, faces, target, tface, &caps)?;
    if grow != Grow::Moving || walls.iter().all(Option::is_none) { return Ok(matched) }
    let after = k.tessellate(&matched, 0.1)?;
    let mut all = faces.to_vec();
    for (p, w) in walls.iter().flatten() {
        if reach(&after.positions, p) <= w + TOL { continue }
        // Past the wall: the flat faces facing the same way at the far end of the body go too.
        for (g, q) in mesh.face_planes.iter().enumerate() {
            let Some(q) = q else { continue };
            let g = g as u32;
            if q.normal.dot(p.normal) > 1.0 - 1e-9 && ((q.origin - p.origin).dot(p.normal) - w).abs() < TOL * 10.0 && !all.contains(&g) && keep != Some(g) {
                all.push(g);
            }
        }
    }
    if all.len() == faces.len() { return Ok(matched) }
    k.match_faces(body, &all, target, tface, &[])
}

/// Plasticity's Pipe: a tube of `radius` along `path`, its section a circle (`sides` 0) or a
/// regular polygon with corners on the radius; with a `thickness` its walls are that thick and
/// the middle is hollow. The section starts square to the path and is swept along it.
pub fn pipe<K: Kernel>(k: &K, path: &Path, radius: f64, thickness: f64, sides: u32) -> Result<K::Solid, KernelError> {
    pipe_with(k, path, radius, thickness, sides, 0.0, 1.0)
}

/// Pipe with Plasticity's Angle (the polygon section turned about the path, radians) and Scale
/// (the section's size at the far end, the start's being 1; it changes evenly along the path).
pub fn pipe_with<K: Kernel>(k: &K, path: &Path, radius: f64, thickness: f64, sides: u32, angle: f64, scale: f64) -> Result<K::Solid, KernelError> {
    if !angle.is_finite() { return Err(KernelError::Invalid("the angle must be a number")) }
    if !scale.is_finite() || scale <= 1e-6 { return Err(KernelError::Invalid("the end scale must be greater than zero")) }
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
        Profile::Polygon((0..sides).map(|i| { let a = std::f64::consts::TAU * i as f64 / sides as f64 + angle; (r * a.cos(), r * a.sin()) }).collect())
    };
    let outer = k.sweep(&section(radius), &frame, path, 0.0, scale)?;
    if thickness <= 1e-9 { return Ok(outer) }
    let inner = k.sweep(&section(radius - thickness), &frame, path, 0.0, scale)?;
    Ok(k.boolean(&outer, &inner, BooleanOp::Difference)?.solid)
}
