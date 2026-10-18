//! OpenCascade backend, through the opencascade-rs bindings (LGPL-2.1 OCCT underneath).

use std::collections::HashMap;
use std::path::Path as FilePath;

use glam::DVec3;
use opencascade::primitives::{BooleanKind, Edge, Face, Shape, ShapeHistory, ShapeType, Wire};

use crate::{Blend, BooleanOp, DrawnLine, Extent, Frame, History, Kernel, KernelError, Motion, Path, Plane, Profile, Segment, Tessellation, Traced};

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

/// A profile as the numbers the shim reads (vendor/opencascade-sys/include/w3d.hxx).
fn section(profile: &Profile, frame: &Frame) -> Result<Vec<f64>, KernelError> {
    Ok(match profile {
        Profile::Circle { center, radius } => {
            if *radius <= 0.0 { return Err(KernelError::Invalid("radius must be positive")) }
            let c = frame.point(*center);
            vec![1.0, c.x, c.y, c.z, frame.normal.x, frame.normal.y, frame.normal.z, *radius]
        }
        Profile::Polygon(pts) => {
            if pts.len() < 3 { return Err(KernelError::Invalid("a polygon needs three corners")) }
            let mut v = vec![0.0, pts.len() as f64];
            for p in pts { v.extend(frame.point(*p).to_array()) }
            v
        }
        Profile::Spline(pts) => {
            if pts.len() < 3 { return Err(KernelError::Invalid("a closed curve needs three points")) }
            let mut v = vec![3.0, pts.len() as f64, 1.0];
            for p in pts { v.extend(frame.point(*p).to_array()) }
            v
        }
        Profile::Cv(pts) => {
            if pts.len() < 3 { return Err(KernelError::Invalid("a closed curve needs three control points")) }
            let mut v = vec![8.0, pts.len() as f64, 1.0];
            for p in pts { v.extend(frame.point(*p).to_array()) }
            v
        }
        Profile::Nurbs { degree, poles, weights, knots } => path_numbers(&Path::Nurbs {
            degree: *degree, poles: poles.iter().map(|p| frame.point(*p)).collect(), weights: weights.clone(), knots: knots.clone(),
        })?,
        Profile::Ellipse { center, major, minor } => {
            let (c, m) = (frame.point(*center), frame.point(*major) - frame.origin);
            ellipse_numbers(c, frame.normal, m, *minor)?
        }
        Profile::Contour(segments) => {
            let path = |pts: &Vec<(f64, f64)>| pts.iter().map(|p| frame.point(*p)).collect::<Vec<_>>();
            path_numbers(&Path::Contour(segments.iter().map(|s| match s {
                Segment::Line(pts) => Path::Polyline { points: path(pts), closed: false },
                Segment::Spline(pts) => Path::Spline { points: path(pts), closed: false },
                Segment::Arc(a, b, c) => Path::Arc { start: frame.point(*a), mid: frame.point(*b), end: frame.point(*c) },
            }).collect()))?
        }
    })
}

/// An ellipse as the shim reads it, with the longer radius first as OpenCascade needs.
fn ellipse_numbers(c: DVec3, n: DVec3, major: DVec3, minor: f64) -> Result<Vec<f64>, KernelError> {
    let r = major.length();
    if !(r > 0.0) || !(minor > 0.0) || !r.is_finite() || !minor.is_finite() { return Err(KernelError::Invalid("an ellipse needs two radii greater than zero")) }
    let (axis, big, small) = if r >= minor { (major / r, r, minor) } else { (n.normalize().cross(major / r), minor, r) };
    let mut v = vec![5.0];
    for p in [c, n, axis] { v.extend(p.to_array()) }
    v.extend([big, small]);
    Ok(v)
}

fn path_numbers(path: &Path) -> Result<Vec<f64>, KernelError> {
    Ok(match path {
        Path::Circle { center, normal, radius } => {
            if *radius <= 0.0 { return Err(KernelError::Invalid("radius must be positive")) }
            vec![1.0, center.x, center.y, center.z, normal.x, normal.y, normal.z, *radius]
        }
        Path::Polyline { points, closed } => {
            if points.len() < 2 { return Err(KernelError::Invalid("a path needs two points")) }
            let mut v = vec![if *closed { 0.0 } else { 2.0 }, points.len() as f64];
            for p in points { v.extend(p.to_array()) }
            v
        }
        Path::Spline { points, closed } => {
            if points.len() < 2 { return Err(KernelError::Invalid("a path needs two points")) }
            let mut v = vec![3.0, points.len() as f64, if *closed { 1.0 } else { 0.0 }];
            for p in points { v.extend(p.to_array()) }
            v
        }
        Path::Cv { points, closed } => {
            if points.len() < 2 { return Err(KernelError::Invalid("a path needs two control points")) }
            let mut v = vec![8.0, points.len() as f64, if *closed { 1.0 } else { 0.0 }];
            for p in points { v.extend(p.to_array()) }
            v
        }
        Path::Nurbs { degree, poles, weights, knots } => {
            let (d, n) = (*degree, poles.len());
            if d < 1 || n < d + 1 || weights.len() != n || knots.len() != n + d + 1 { return Err(KernelError::Invalid("a NURBS curve's knots and weights do not match its poles")) }
            let mut v = vec![9.0, d as f64, n as f64, knots.len() as f64];
            for p in poles { v.extend(p.to_array()) }
            v.extend(weights);
            v.extend(knots);
            v
        }
        Path::Arc { start, mid, end } => [4.0].into_iter().chain([start, mid, end].into_iter().flat_map(|p| p.to_array())).collect(),
        Path::Ellipse { center, normal, major, minor } => ellipse_numbers(*center, *normal, *major, *minor)?,
        Path::Contour(pieces) => {
            if pieces.is_empty() { return Err(KernelError::Invalid("a contour needs a piece")) }
            let mut v = vec![6.0, pieces.len() as f64];
            for p in pieces { v.extend(path_numbers(p)?) }
            v
        }
        Path::Spiral { origin, axis, x, radius, length, turns, left } => {
            let n = axis.normalize();
            let x = (*x - n * x.dot(n)).normalize();
            if !(*radius > 0.0 && *length > 0.0 && *turns > 0.0) || !x.is_finite() { return Err(KernelError::Invalid("a spiral needs a radius, a length and turns greater than zero")) }
            let mut v = vec![7.0];
            for a in [*origin, n, x] { v.extend(a.to_array()) }
            v.extend([*radius, *length, *turns, if *left { 1.0 } else { 0.0 }]);
            v
        }
    })
}

/// Our own sentences from the shim go to the user as they are; OpenCascade's are kernel failures.
fn shim(e: String) -> KernelError {
    if e.starts_with("kernel:") { KernelError::Failed(e) } else { KernelError::Refused(e) }
}

fn history(h: ShapeHistory) -> History {
    let pairs = |v: Vec<(usize, usize)>| v.into_iter().map(|(a, b)| (a as u32, b as u32)).collect::<Vec<_>>();
    let [f0, f1] = h.faces;
    let [e0, e1] = h.edges;
    History { faces: [pairs(f0), pairs(f1)], edges: [pairs(e0), pairs(e1)], generated_faces: pairs(h.generated_faces) }
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

    fn extrude(&self, profile: &Profile, frame: &Frame, e: &Extent) -> Result<Shape, KernelError> {
        if let (true, Profile::Circle { .. } | Profile::Polygon(_)) = (e.is_plain(), profile) {
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
                _ => unreachable!(),
            };
            return Ok(Shape::from(Face::from_wire(&wire).extrude(frame.normal * e.distance)));
        }
        let n = frame.normal.normalize().to_array();
        Shape::extrude_section(&section(profile, frame)?, n, e.distance, e.back, e.angle, e.thickness).map_err(shim)
    }

    fn sample(&self, path: &Path, n: usize) -> Result<Vec<DVec3>, KernelError> {
        Shape::sample_section(&path_numbers(path)?, n).map_err(shim)
    }

    fn extrude_face(&self, s: &Shape, face: u32, e: &Extent) -> Result<Shape, KernelError> {
        let f = s.face_at(face as usize).ok_or(KernelError::Invalid("that face no longer exists"))?;
        let normal = f.normal_at_center();
        if !normal.is_finite() || normal.length() < 0.5 { return Err(KernelError::Invalid("that face has no direction to extrude in")) }
        if e.is_plain() { return Ok(Shape::from(f.extrude(normal.normalize() * e.distance))) }
        s.extrude_face_shaped(face as usize, normal.normalize().to_array(), e.distance, e.back, e.angle, e.thickness).map_err(shim)
    }

    fn extrude_along(&self, profile: &Profile, frame: &Frame, dir: DVec3, e: &Extent) -> Result<Shape, KernelError> {
        Shape::extrude_section(&section(profile, frame)?, dir.normalize().to_array(), e.distance, e.back, e.angle, e.thickness).map_err(shim)
    }

    fn extrude_face_along(&self, s: &Shape, face: u32, dir: DVec3, e: &Extent) -> Result<Shape, KernelError> {
        s.face_at(face as usize).ok_or(KernelError::Invalid("that face no longer exists"))?;
        s.extrude_face_shaped(face as usize, dir.normalize().to_array(), e.distance, e.back, e.angle, e.thickness).map_err(shim)
    }

    fn face_normal(&self, s: &Shape, face: u32) -> Option<DVec3> {
        let n = s.face_at(face as usize)?.normal_at_center();
        (n.is_finite() && n.length() > 0.5).then(|| n.normalize())
    }

    fn boolean(&self, a: &Shape, b: &Shape, op: BooleanOp) -> Result<Traced<Shape>, KernelError> {
        let kind = match op {
            BooleanOp::Union => BooleanKind::Union,
            BooleanOp::Difference => BooleanKind::Difference,
            BooleanOp::Intersection => BooleanKind::Intersection,
        };
        let (solid, h) = a.boolean_with_history(b, kind).map_err(KernelError::Failed)?;
        Ok(Traced { solid, history: history(h) })
    }

    fn is_sheet(&self, s: &Shape) -> bool { s.is_sheet() }

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

    fn edge_count(&self, s: &Shape) -> usize { s.edge_count() }

    fn blend(&self, s: &Shape, edges: &[u32], size: f64, kind: Blend, angle: f64, variable: &[crate::blend::VariablePoint]) -> Result<Traced<Shape>, KernelError> {
        let edges: Vec<usize> = edges.iter().map(|&e| e as usize).collect();
        let points: Vec<f64> = variable.iter().flat_map(|v| [v.edge as f64, v.point.x, v.point.y, v.point.z, v.scale]).collect();
        let (solid, h) = s.blend_edges_with_history(&edges, size, kind == Blend::Chamfer, angle, &points).map_err(|e| KernelError::Blend {
            edges: e.edges.iter().map(|&i| i as u32).collect(),
            reason: e.reason,
        })?;
        Ok(Traced { solid, history: history(h) })
    }

    fn transform(&self, s: &Shape, m: &Motion) -> Shape {
        // opencascade-rs shapes are not Clone; every step below copies.
        let at_origin = s.translated(-m.pivot);
        let scaled = if m.scale == 1.0 { at_origin } else { at_origin.scaled(DVec3::ZERO, m.scale) };
        let turned = if m.angle == 0.0 { scaled } else { scaled.rotated(m.axis.normalize(), m.angle) };
        turned.translated(m.pivot + m.offset)
    }

    fn revolve(&self, profile: &Profile, frame: &Frame, axis_point: DVec3, axis_dir: DVec3, angle: f64, thickness: f64) -> Result<Shape, KernelError> {
        let axis = [axis_point.x, axis_point.y, axis_point.z, axis_dir.x, axis_dir.y, axis_dir.z];
        Shape::revolve_section(&section(profile, frame)?, axis, angle, thickness).map_err(shim)
    }

    fn loft(&self, sections: &[(Profile, Frame)]) -> Result<Shape, KernelError> {
        let mut all = Vec::new();
        for (p, f) in sections { all.extend(section(p, f)?) }
        Shape::loft_sections(&all).map_err(shim)
    }

    fn sweep(&self, profile: &Profile, frame: &Frame, path: &Path, twist: f64, scale: f64) -> Result<Shape, KernelError> {
        Shape::sweep_section(&section(profile, frame)?, &path_numbers(path)?, twist, scale).map_err(shim)
    }

    fn sweep_guided(&self, profile: &Profile, frame: &Frame, path: &Path, guide: Option<&Path>, method: u8, parallel: bool) -> Result<Shape, KernelError> {
        let guide = match guide { Some(g) => path_numbers(g)?, None => Vec::new() };
        Shape::sweep_guided(&section(profile, frame)?, &path_numbers(path)?, &guide, method as i32, parallel).map_err(shim)
    }

    fn loft_guided(&self, sections: &[(Profile, Frame)], guides: &[Path]) -> Result<Shape, KernelError> {
        let mut all = Vec::new();
        for (p, f) in sections { all.extend(section(p, f)?) }
        let mut rails = Vec::new();
        for g in guides { rails.extend(path_numbers(g)?) }
        Shape::loft_guided(&all, &rails).map_err(shim)
    }

    fn offset_faces(&self, s: &Shape, faces: &[u32], distance: f64, angle: f64) -> Result<Traced<Shape>, KernelError> {
        let faces: Vec<usize> = faces.iter().map(|&f| f as usize).collect();
        let (solid, h) = s.offset_faces_with_history(&faces, distance, angle).map_err(shim)?;
        Ok(Traced { solid, history: history(h) })
    }

    fn shell(&self, s: &Shape, faces: &[u32], thickness: f64) -> Result<Traced<Shape>, KernelError> {
        let faces: Vec<usize> = faces.iter().map(|&f| f as usize).collect();
        let (solid, h) = s.shell_with_history(&faces, thickness).map_err(shim)?;
        Ok(Traced { solid, history: history(h) })
    }

    fn cut(&self, s: &Shape, cutters: &[(Path, DVec3)], extra: &[&Shape], length: f64) -> Result<(Traced<Shape>, Vec<Shape>), KernelError> {
        let (solid, h, rest) = s.cut_with_history(&cutter_numbers(cutters)?, length, extra).map_err(shim)?;
        Ok((Traced { solid, history: history(h) }, rest))
    }

    fn imprint(&self, s: &Shape, faces: &[u32], cutters: &[(Path, DVec3)], extra: &[&Shape], length: f64) -> Result<Traced<Shape>, KernelError> {
        let faces: Vec<usize> = faces.iter().map(|&f| f as usize).collect();
        let (solid, h) = s.imprint_with_history(&faces, &cutter_numbers(cutters)?, length, extra).map_err(shim)?;
        Ok(Traced { solid, history: history(h) })
    }

    fn project(&self, s: &Shape, faces: &[u32], curves: &[(Path, DVec3)], length: f64, both: bool, hide: bool) -> Result<Vec<Path>, KernelError> {
        if curves.is_empty() { return Err(KernelError::Invalid("select the curves to project")) }
        let faces: Vec<usize> = faces.iter().map(|&f| f as usize).collect();
        nurbs_paths(&s.project_curves(&faces, &cutter_numbers(curves)?, length, both, hide).map_err(shim)?)
    }

    fn meet(&self, a: &Shape, b: &Shape) -> Result<Vec<Path>, KernelError> {
        nurbs_paths(&a.meet_curves(b).map_err(shim)?)
    }

    fn project_curve_curve(&self, a: &(Path, DVec3), b: &(Path, DVec3), length: f64) -> Result<Vec<Path>, KernelError> {
        nurbs_paths(&Shape::project_curve_curve(&cutter_numbers(&[a.clone(), b.clone()])?, length).map_err(shim)?)
    }

    fn draft_faces(&self, s: &Shape, faces: &[u32], pull: DVec3, origin: DVec3, angle: f64) -> Result<Traced<Shape>, KernelError> {
        let faces: Vec<usize> = faces.iter().map(|&f| f as usize).collect();
        let (solid, h) = s.draft_faces_with_history(&faces, pull, origin, angle).map_err(shim)?;
        Ok(Traced { solid, history: history(h) })
    }

    fn hidden_lines(&self, solids: &[&Shape], origin: DVec3, toward: DVec3, x: DVec3, deflection: f64) -> Result<Vec<DrawnLine>, KernelError> {
        let flat = Shape::hidden_lines(solids, origin, toward, x, deflection).map_err(shim)?;
        let mut lines = Vec::new();
        let mut i = 0;
        while i + 2 <= flat.len() {
            let (hidden, n) = (flat[i] != 0.0, flat[i + 1] as usize);
            let end = i + 2 + 2 * n;
            if end > flat.len() { return Err(KernelError::Invalid("the drawing came back cut short")) }
            lines.push(DrawnLine { hidden, points: flat[i + 2..end].chunks(2).map(|p| [p[0], p[1]]).collect() });
            i = end;
        }
        Ok(lines)
    }

    fn project_outline(&self, s: &Shape, origin: DVec3, normal: DVec3, x: DVec3) -> Result<Vec<Path>, KernelError> {
        nurbs_paths(&s.project_outline(origin, normal, x).map_err(shim)?)
    }

    fn bridge_surface(&self, a: (&Shape, u32), b: (&Shape, u32), same: bool, tension: f64) -> Result<Shape, KernelError> {
        Shape::bridge_surface(a.0, a.1 as usize, b.0, b.1 as usize, same, tension).map_err(shim)
    }

    fn patch(&self, curves: &[Path], edges: &[(&Shape, Vec<(u32, bool)>)]) -> Result<Shape, KernelError> {
        let curves: Vec<(Path, DVec3)> = curves.iter().map(|c| (c.clone(), DVec3::Z)).collect();
        let edges: Vec<(&Shape, Vec<(usize, bool)>)> = edges.iter().map(|(s, e)| (*s, e.iter().map(|&(i, t)| (i as usize, t)).collect())).collect();
        Shape::patch(&cutter_numbers(&curves)?, &edges, PATCH_TOLERANCE).map_err(shim)
    }

    fn thicken(&self, s: &Shape, front: f64, back: f64) -> Result<Shape, KernelError> {
        s.thicken(front, back).map_err(shim)
    }

    fn thicken_faces(&self, s: &Shape, faces: &[u32], front: f64, back: f64) -> Result<Shape, KernelError> {
        s.thicken_faces(&faces.iter().map(|&f| f as usize).collect::<Vec<_>>(), front, back).map_err(shim)
    }

    fn extend_sheet(&self, s: &Shape, edge: u32, distance: f64, natural: bool) -> Result<Shape, KernelError> {
        if !s.is_sheet() { return Err(KernelError::Invalid("extend edges of sheets; that body is solid")) }
        s.extend_sheet(edge as usize, distance, natural).map_err(shim)
    }

    fn join_sheets(&self, sheets: &[&Shape]) -> Result<Shape, KernelError> {
        Shape::join_sheets(sheets, JOIN_TOLERANCE).map_err(shim)
    }

    fn unjoin(&self, s: &Shape, faces: bool) -> Result<Vec<Shape>, KernelError> {
        s.unjoin(faces).map_err(shim)
    }

    fn face_sheet(&self, s: &Shape, face: u32, size: f64) -> Result<Shape, KernelError> {
        s.face_sheet(face as usize, size).map_err(shim)
    }

    fn plane_sheet(&self, origin: DVec3, normal: DVec3, size: f64) -> Result<Shape, KernelError> {
        Shape::plane_sheet(origin, normal, size).map_err(shim)
    }

    fn unify(&self, s: &Shape) -> Result<Traced<Shape>, KernelError> {
        let (solid, h) = s.unify_with_history().map_err(shim)?;
        Ok(Traced { solid, history: history(h) })
    }

    fn boundary_edges(&self, s: &Shape) -> Vec<u32> {
        s.boundary_edges().into_iter().map(|i| i as u32).collect()
    }

    fn remove_faces(&self, s: &Shape, faces: &[u32]) -> Result<Traced<Shape>, KernelError> {
        let faces: Vec<usize> = faces.iter().map(|&f| f as usize).collect();
        let (solid, h) = s.remove_faces_with_history(&faces).map_err(shim)?;
        Ok(Traced { solid, history: history(h) })
    }

    fn mirror(&self, s: &Shape, origin: DVec3, normal: DVec3) -> Result<Shape, KernelError> {
        s.mirrored_in_plane(origin, normal).map_err(shim)
    }

    fn sphere(&self, center: DVec3, radius: f64) -> Result<Shape, KernelError> {
        Ok(Shape::sphere(radius).at(center).build())
    }

    fn is_valid(&self, s: &Shape) -> bool { s.is_valid() }

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

        // Each edge once, in the kernel's numbering, so an index here is an edge a tool can name.
        t.edges = s.numbered_edges().iter().map(|e| edge_points(e).0).collect();
        Ok(t)
    }

    fn write_step(&self, s: &Shape, path: &FilePath) -> Result<(), KernelError> {
        s.write_step(path).map_err(failed)
    }

    fn write_iges(&self, s: &Shape, path: &FilePath) -> Result<(), KernelError> {
        s.write_iges(path).map_err(failed)
    }

    fn read_iges(&self, path: &FilePath) -> Result<Shape, KernelError> {
        let shape = Shape::read_iges(path).map_err(|_| KernelError::File("the IGES file could not be read".into()))?;
        // IGES often arrives as loose faces with gaps; repair as STEP is repaired.
        let shape = shape.healed().map_err(|e| KernelError::File(format!("the IGES geometry could not be repaired: {e}")))?;
        if shape.faces().next().is_none() {
            return Err(KernelError::File("the IGES file has no surfaces".into()));
        }
        Ok(shape)
    }

    fn read_step(&self, path: &FilePath) -> Result<Shape, KernelError> {
        let shape = Shape::read_step(path).map_err(|_| KernelError::File("the STEP file could not be read".into()))?;
        // Exported files often carry small gaps and loose tolerances; repair them on the way in,
        // as Plasticity 26 does with its repair library (see the teardown), so later fillets and
        // booleans get clean input.
        let shape = shape.healed().map_err(|e| KernelError::File(format!("the STEP geometry could not be repaired: {e}")))?;
        if shape.faces().next().is_none() {
            return Err(KernelError::File("the STEP file holds no surfaces or solids".into()));
        }
        Ok(shape)
    }

    fn native_format(&self) -> &'static str { "occt-brep" }

    fn to_native(&self, s: &Shape) -> Result<String, KernelError> { s.to_brep_text().map_err(failed) }

    fn from_native(&self, text: &str) -> Result<Shape, KernelError> { Shape::from_brep_text(text).map_err(failed) }
}

/// Cutting curves for the shim: [count, then per curve its plane normal and path numbers].
/// The curves the shim writes for Project: a count, then each as NURBS numbers (kind 9).
fn nurbs_paths(v: &[f64]) -> Result<Vec<Path>, KernelError> {
    let bad = || KernelError::Failed("the kernel's curves are cut short".into());
    let mut out = Vec::new();
    let count = *v.first().ok_or_else(bad)? as usize;
    let mut i = 1;
    for _ in 0..count {
        let head = v.get(i..i + 4).ok_or_else(bad)?;
        if head[0] != 9.0 { return Err(bad()) }
        let (degree, n, k) = (head[1] as usize, head[2] as usize, head[3] as usize);
        i += 4;
        let body = v.get(i..i + 4 * n + k).ok_or_else(bad)?;
        i += 4 * n + k;
        out.push(Path::Nurbs {
            degree,
            poles: body[..3 * n].chunks_exact(3).map(|p| DVec3::new(p[0], p[1], p[2])).collect(),
            weights: body[3 * n..4 * n].to_vec(),
            knots: body[4 * n..].to_vec(),
        });
    }
    Ok(out)
}

/// How far apart a patch's boundary pieces may be and still join, and a tenth of how far the patch may stray from them: within the 0.01 mm bar.
const PATCH_TOLERANCE: f64 = 1e-3;
/// How far apart sheet edges may be and still be joined: the 0.01 mm gap bar.
const JOIN_TOLERANCE: f64 = 1e-2;

fn cutter_numbers(cutters: &[(Path, DVec3)]) -> Result<Vec<f64>, KernelError> {
    let mut data = vec![cutters.len() as f64];
    for (path, n) in cutters {
        data.extend(n.to_array());
        data.extend(path_numbers(path)?);
    }
    Ok(data)
}
