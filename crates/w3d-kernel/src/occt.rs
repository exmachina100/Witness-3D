//! OpenCascade backend, through the opencascade-rs bindings (LGPL-2.1 OCCT underneath).

use std::collections::HashSet;
use std::path::Path;

use glam::DVec3;
use opencascade::primitives::{Edge, Face, Shape, ShapeType, Wire};

use crate::{BooleanOp, Frame, Kernel, KernelError, Profile, Tessellation};

pub struct Occt;

fn failed(e: impl std::fmt::Debug) -> KernelError { KernelError::Failed(format!("{e:?}")) }

impl Kernel for Occt {
    type Solid = Shape;

    fn box_from_corners(&self, a: DVec3, b: DVec3) -> Shape {
        Shape::box_from_corners(a, b)
    }

    fn extrude(&self, profile: &Profile, frame: &Frame, distance: f64) -> Result<Shape, KernelError> {
        let wire = match profile {
            Profile::Circle { center, radius } => {
                if *radius <= 0.0 { return Err(KernelError::Invalid("radius must be positive")) }
                Wire::from_edges([&Edge::circle(frame.point(*center), frame.normal, *radius)])
            }
            Profile::Polygon(pts) => {
                if pts.len() < 3 { return Err(KernelError::Invalid("a polygon needs three corners")) }
                let corners: Vec<DVec3> = pts.iter().map(|p| frame.point(*p)).collect();
                let edges: Vec<Edge> = (0..corners.len())
                    .map(|i| Edge::segment(corners[i], corners[(i + 1) % corners.len()]))
                    .collect();
                Wire::from_edges(&edges)
            }
        };
        let solid = Face::from_wire(&wire).extrude(frame.normal * distance);
        Ok(Shape::from(solid))
    }

    fn boolean(&self, a: &Shape, b: &Shape, op: BooleanOp) -> Result<Shape, KernelError> {
        let result = match op {
            BooleanOp::Union => a.union(b).shape,
            BooleanOp::Difference => a.subtract(b).shape,
            BooleanOp::Intersection => a.intersect(b).shape,
        };
        Ok(result.clean())
    }

    fn solid_count(&self, s: &Shape) -> usize {
        // opencascade-rs exposes no solid iterator; a fused result is either one Solid or a Compound.
        match s.shape_type() {
            ShapeType::Solid => 1,
            ShapeType::Compound | ShapeType::CompoundSolid => if s.faces().next().is_some() { 2 } else { 0 },
            _ => 0,
        }
    }

    fn face_count(&self, s: &Shape) -> usize { s.faces().count() }

    fn tessellate(&self, s: &Shape, tolerance: f64) -> Result<Tessellation, KernelError> {
        let mesh = s.mesh_with_tolerance(tolerance).map_err(failed)?;
        let positions = mesh.vertices.iter().map(|v| v.to_array()).collect();
        let indices = mesh.indices.iter().map(|&i| i as u32).collect();

        // The explorer meets each edge once per adjacent face; keep the first.
        let mut seen = HashSet::new();
        let mut edges = Vec::new();
        for edge in s.edges() {
            let pts: Vec<[f64; 3]> = edge.approximation_segments().map(|p| p.to_array()).collect();
            let mut key: Vec<String> = pts.iter().map(|p| format!("{:.5},{:.5},{:.5}", p[0], p[1], p[2])).collect();
            key.sort();
            if seen.insert(key.join("|")) { edges.push(pts) }
        }
        Ok(Tessellation { positions, indices, edges })
    }

    fn write_step(&self, s: &Shape, path: &Path) -> Result<(), KernelError> {
        s.write_step(path).map_err(failed)
    }
}
