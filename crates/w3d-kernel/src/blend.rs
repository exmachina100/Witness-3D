//! Fillet and chamfer on chosen edges. The kernel does the geometry; this checks the inputs first
//! and the result after, so a bad request or a broken solid comes back as a sentence the user can
//! act on rather than as a kernel crash or a quietly corrupt body.

use glam::DVec3;

use crate::{Kernel, KernelError, Traced};

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
    let traced = k.blend(body, &edges, p.size, p.kind, p.angle, variable)?;
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
