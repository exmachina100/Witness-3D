//! Fillet and chamfer on chosen edges. The kernel does the geometry; this checks the inputs first
//! and the result after, so a bad request or a broken solid comes back as a sentence the user can
//! act on rather than as a kernel crash or a quietly corrupt body.

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
}

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

    let traced = k.blend(body, &edges, p.size, p.kind)?;
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
