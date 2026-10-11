//! OpenCascade backend, through the opencascade-rs bindings (LGPL-2.1 OCCT underneath).

use std::collections::{HashMap, HashSet};
use std::path::Path;

use glam::DVec3;
use opencascade::primitives::{Edge, Face, Shape, ShapeType, Wire};

use crate::{BooleanOp, Frame, Kernel, KernelError, Plane, Profile, Tessellation};

pub struct Occt;

fn failed(e: impl std::fmt::Debug) -> KernelError { KernelError::Failed(format!("{e:?}")) }

/// The edge's sample points, plus a key that is the same whichever face it was reached through.
/// opencascade-rs hides the TopoDS handle, so geometry stands in for identity.
fn edge_points(edge: &Edge) -> (Vec<[f64; 3]>, String) {
    let pts: Vec<[f64; 3]> = edge.approximation_segments().map(|p| p.to_array()).collect();
    let mut key: Vec<String> = pts.iter().map(|p| format!("{:.5},{:.5},{:.5}", p[0], p[1], p[2])).collect();
    key.sort();
    (pts, key.join("|"))
}

/// The face's plane if every triangle faces the same way. Triangle winding already accounts for
/// the face's orientation in the solid, so the normal points out of the body.
fn plane_of(mesh: &opencascade::mesh::Mesh) -> Option<Plane> {
    let normals: Vec<DVec3> = mesh.indices.chunks_exact(3).filter_map(|t| {
        let [a, b, c] = [t[0], t[1], t[2]].map(|i| mesh.vertices[i]);
        (b - a).cross(c - a).try_normalize()
    }).collect();
    let normal = *normals.first()?;
    if normals.iter().any(|n| n.dot(normal) < 1.0 - 1e-9) { return None }
    let origin = mesh.vertices.iter().copied().sum::<DVec3>() / mesh.vertices.len() as f64;
    Some(Plane { origin, normal })
}

fn root(parent: &mut [usize], mut i: usize) -> usize {
    while parent[i] != i { parent[i] = parent[parent[i]]; i = parent[i] }
    i
}

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
        // opencascade-rs has no solid iterator, and a boolean returns a Compound even when it holds
        // one solid. Faces of one closed solid are connected through shared edges, so count the
        // connected groups of faces.
        if s.shape_type() == ShapeType::Solid { return 1 }
        let faces: Vec<_> = s.faces().collect();
        let mut parent: Vec<usize> = (0..faces.len()).collect();
        let mut owner: HashMap<String, usize> = HashMap::new();
        for (i, face) in faces.iter().enumerate() {
            for edge in face.edges() {
                let j = *owner.entry(edge_points(&edge).1).or_insert(i);
                let (a, b) = (root(&mut parent, i), root(&mut parent, j));
                parent[a] = b;
            }
        }
        (0..faces.len()).filter(|&i| root(&mut parent, i) == i).count()
    }

    fn face_count(&self, s: &Shape) -> usize { s.faces().count() }

    fn tessellate(&self, s: &Shape, tolerance: f64) -> Result<Tessellation, KernelError> {
        // Mesh the whole solid once so neighbouring faces share edge points, then read it back
        // face by face to learn which triangles belong to which face.
        s.mesh_with_tolerance(tolerance).map_err(failed)?;
        let mut t = Tessellation::default();
        for (face_id, face) in s.faces().enumerate() {
            let mesh = Shape::from(&face).mesh_with_tolerance(tolerance).map_err(failed)?;
            let offset = t.positions.len() as u32;
            t.positions.extend(mesh.vertices.iter().map(|v| v.to_array()));
            t.indices.extend(mesh.indices.iter().map(|&i| offset + i as u32));
            t.face_ids.extend(std::iter::repeat(face_id as u32).take(mesh.indices.len() / 3));
            t.face_planes.push(plane_of(&mesh));
        }

        // The explorer meets each edge once per adjacent face; keep the first.
        let mut seen = HashSet::new();
        for edge in s.edges() {
            let (pts, key) = edge_points(&edge);
            if seen.insert(key) { t.edges.push(pts) }
        }
        Ok(t)
    }

    fn write_step(&self, s: &Shape, path: &Path) -> Result<(), KernelError> {
        s.write_step(path).map_err(failed)
    }
}
