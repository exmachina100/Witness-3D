//! Fillet and chamfer on chosen edges. The kernel does the geometry; this checks the inputs first
//! and the result after, so a bad request or a broken solid comes back as a sentence the user can
//! act on rather than as a kernel crash or a quietly corrupt body.

use glam::DVec3;

use crate::{BooleanOp, Kernel, KernelError, Traced};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Blend {
    /// A round of constant radius.
    Fillet,
    /// A flat bevel at equal distance on both faces.
    Chamfer,
}

#[derive(Clone, Debug, PartialEq)]
pub struct BlendParams {
    /// Edge numbers, as in [`crate::Tessellation::edges`].
    pub edges: Vec<u32>,
    /// Fillet radius or chamfer distance, in document units.
    pub size: f64,
    pub kind: Blend,
    /// Chamfer angle from each edge's first face, in radians; π/4 is an equal-distance chamfer.
    pub angle: f64,
    /// Plasticity's variable points (V): fillets only, ignored for chamfers.
    pub variable: Vec<VariablePoint>,
    /// Plasticity's fillet Shape: fillets only.
    pub shape: FilletShape,
    /// The Conic shape's rho, or how far toward the corner the G2 shape reaches (0.05 to 0.95).
    pub tension: f64,
    /// Plasticity's limit points (L): none, or two points on the edges; the round runs only
    /// between the planes square to the edge through them, ending flat.
    pub limits: Vec<DVec3>,
}

/// Plasticity's fillet Shape: the section across a round.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum FilletShape {
    /// A circular arc of the radius.
    #[default]
    Round,
    /// A circular arc whose chord (the width across the round) is the distance.
    Chordal,
    /// A conic between the same spring lines as the round, its rho the tension.
    Conic,
    /// A curve leaving both faces with no curvature (curvature continuous to flat faces).
    G2,
}

/// A point on a rounded edge where the radius is `size` × `scale`; the radius runs smoothly from
/// point to point and back to `size` at the ends of the edge's contour.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct VariablePoint {
    pub edge: u32,
    /// On (or near) the edge, in document coordinates.
    pub point: DVec3,
    pub scale: f64,
}

/// The equal-distance chamfer angle.
pub const EQUAL: f64 = std::f64::consts::FRAC_PI_4;

impl Blend {
    pub fn noun(self) -> &'static str {
        match self { Blend::Fillet => "radius", Blend::Chamfer => "distance" }
    }
}

pub fn blend<K: Kernel>(k: &K, body: &K::Solid, p: &BlendParams) -> Result<Traced<K::Solid>, KernelError> {
    if p.edges.is_empty() {
        return Err(KernelError::Invalid("select at least one edge"));
    }
    if !(p.size > 0.0) || !p.size.is_finite() {
        return Err(match p.kind {
            Blend::Fillet => KernelError::Invalid("the radius must be greater than zero"),
            Blend::Chamfer => KernelError::Invalid("the distance must be greater than zero"),
        });
    }
    let count = k.edge_count(body);
    if p.edges.iter().any(|&e| e as usize >= count) {
        return Err(KernelError::Invalid("an edge in the selection is not on this body; select the edges again"));
    }
    let mut edges = p.edges.clone();
    edges.sort_unstable();
    edges.dedup();

    if p.kind == Blend::Chamfer && !(p.angle > 0.0 && p.angle < std::f64::consts::FRAC_PI_2) {
        return Err(KernelError::Invalid("the chamfer angle must be between 0 and 90 degrees"));
    }
    let variable: &[VariablePoint] = if p.kind == Blend::Fillet { &p.variable } else { &[] };
    for v in variable {
        if !edges.contains(&v.edge) {
            return Err(KernelError::Invalid("a variable point is on an edge that isn't being rounded"));
        }
        if !(v.scale > 0.0) || !v.scale.is_finite() || !v.point.is_finite() {
            return Err(KernelError::Invalid("a variable point's radius must be greater than zero"));
        }
    }
    let shape = if p.kind == Blend::Fillet { p.shape } else { FilletShape::Round };
    if matches!(shape, FilletShape::Conic | FilletShape::G2) && !(p.tension >= 0.05 && p.tension <= 0.95) {
        return Err(KernelError::Invalid("the tension must be between 0.05 and 0.95"));
    }
    let mut size = p.size;
    let mut chordal = Vec::new();
    if shape == FilletShape::Chordal {
        if !variable.is_empty() { return Err(KernelError::Invalid("a chordal round takes one distance; remove the variable points")) }
        // The radius whose arc spans the distance between the faces' spring lines: the arc turns
        // through the angle between the faces' normals.
        let angles = k.edge_angles(body);
        let radii: Vec<f64> = edges.iter().map(|&e| {
            let turn = angles.get(e as usize).copied().unwrap_or(-1.0).to_radians();
            if turn > 1e-6 { Ok(p.size / (2.0 * (turn / 2.0).sin())) } else { Err(KernelError::Invalid("a chordal round needs faces that meet at an angle")) }
        }).collect::<Result<_, _>>()?;
        size = radii[0];
        if radii.iter().any(|r| (r - size).abs() > 1e-9 * size) {
            // Edges at different angles: each edge's own radius, held along it as variable points.
            let t = k.tessellate(body, 0.01)?;
            for (&e, &r) in edges.iter().zip(&radii) {
                let line = t.edges.get(e as usize).filter(|l| !l.is_empty()).ok_or(KernelError::Invalid("an edge in the selection is not on this body; select the edges again"))?;
                for at in [line[0], line[line.len() / 2], line[line.len() - 1]] {
                    chordal.push(VariablePoint { edge: e, point: DVec3::from_array(at), scale: r / size });
                }
            }
        }
    }
    let variable = if chordal.is_empty() { variable } else { &chordal[..] };
    let mut traced = k.blend(body, &edges, size, p.kind, p.angle, variable)?;
    if matches!(shape, FilletShape::Conic | FilletShape::G2) {
        let mut rounds: Vec<u32> = traced.history.generated_faces.iter().map(|&(_, f)| f).collect();
        rounds.sort_unstable();
        rounds.dedup();
        traced.solid = k.reshape_fillets(&traced.solid, &rounds, shape == FilletShape::G2, p.tension)?;
    }
    if !p.limits.is_empty() {
        traced = limited(k, body, &traced.solid, &edges, &p.limits)?;
    }
    let result = &traced.solid;
    if !k.is_valid(result) {
        return Err(KernelError::Blend {
            edges,
            reason: format!("the kernel built a {} but the solid it produced is invalid; try a smaller {}",
                if p.kind == Blend::Fillet { "round" } else { "chamfer" }, p.kind.noun()),
        });
    }
    if k.solid_count(result) != k.solid_count(body) {
        return Err(KernelError::Blend { edges, reason: "the result split the body apart; try a smaller size".into() });
    }
    Ok(traced)
}

/// The round `rounded` kept only between the planes square to `edges` through the two `limits`:
/// the material it took off the body between them, taken off the body.
fn limited<K: Kernel>(k: &K, body: &K::Solid, rounded: &K::Solid, edges: &[u32], limits: &[DVec3]) -> Result<Traced<K::Solid>, KernelError> {
    let [a, b] = limits else { return Err(KernelError::Invalid("place two limit points, one at each end of the stretch to round")) };
    if a.distance(*b) < 1e-6 { return Err(KernelError::Invalid("the limit points are on top of each other")) }
    let t = k.tessellate(body, 0.01)?;
    // The edge's direction at a point: along the nearest piece of the picked edges' polylines.
    let along = |p: DVec3| -> Result<DVec3, KernelError> {
        let mut best = (f64::INFINITY, DVec3::ZERO);
        for &e in edges {
            for w in t.edges.get(e as usize).map(|l| &l[..]).unwrap_or(&[]).windows(2) {
                let (s, f) = (DVec3::from_array(w[0]), DVec3::from_array(w[1]));
                let d = f - s;
                if d.length_squared() < 1e-24 { continue }
                let q = s + d * ((p - s).dot(d) / d.length_squared()).clamp(0.0, 1.0);
                if q.distance(p) < best.0 { best = (q.distance(p), d.normalize()) }
            }
        }
        if best.0 > 1e-3 { return Err(KernelError::Invalid("a limit point is not on an edge being rounded")) }
        Ok(best.1)
    };
    let (ta, tb) = (along(*a)?, along(*b)?);
    // Each plane faces the other point: the round is kept on that side of both.
    let na = if ta.dot(*b - *a) >= 0.0 { ta } else { -ta };
    let nb = if tb.dot(*a - *b) >= 0.0 { tb } else { -tb };
    let piece = k.round_piece(body, rounded, (*a, na), (*b, nb))?;
    k.boolean(body, &piece, BooleanOp::Difference)
}
