//! Project (Plasticity's Project Curve Body, Body Body and Curve Curve), measured against the
//! kernel-strategy bar: every projected curve lies on the faces it was projected onto, to well
//! under 0.01 mm. Units are mm.

#![cfg(feature = "occt")]

use glam::DVec3;
use opencascade::primitives::Shape;
use w3d_kernel::document::{Curve, CurveShape, Document};
use w3d_kernel::occt::Occt;
use w3d_kernel::solids::primitive;
use w3d_kernel::*;

const FAR: f64 = 1e5;
/// How close a projected curve must lie to its surface: a hundredth of the bar.
const ON: f64 = 1e-4;

fn close(a: f64, b: f64, eps: f64) {
    assert!((a - b).abs() < eps, "{a} != {b} (±{eps})")
}

fn cube(k: &Occt) -> Shape { k.box_from_corners(DVec3::ZERO, DVec3::splat(10.0)) }

fn union(k: &Occt, parts: Vec<Shape>) -> Shape {
    let mut it = parts.into_iter();
    let first = it.next().unwrap();
    it.fold(first, |a, b| k.boolean(&a, &b, BooleanOp::Union).unwrap().solid)
}

/// A line along x at height `y` and depth `z`, from x = -5 to 15.
fn line(y: f64, z: f64) -> Path { Path::Polyline { points: vec![DVec3::new(-5.0, y, z), DVec3::new(15.0, y, z)], closed: false } }

fn points(k: &Occt, p: &Path) -> Vec<DVec3> { k.sample(p, 200).unwrap() }

/// The curves' points, all of them.
fn all_points(k: &Occt, ps: &[Path]) -> Vec<DVec3> { ps.iter().flat_map(|p| points(k, p)).collect() }

fn length(k: &Occt, p: &Path) -> f64 { points(k, p).windows(2).map(|w| (w[1] - w[0]).length()).sum() }

#[test]
fn a_line_lands_on_the_top_and_the_bottom_unless_the_bottom_is_hidden() {
    let k = Occt;
    let c = cube(&k);
    let down = -DVec3::Y;
    // Without hiding, the line's whole section through the cube: one loop over the top, down the
    // sides and back under the bottom.
    let all = k.project(&c, &[], &[(line(20.0, 5.0), down)], FAR, false, false).unwrap();
    assert_eq!(all.len(), 1);
    let pts = points(&k, &all[0]);
    assert!((pts[0] - *pts.last().unwrap()).length() < ON, "a closed loop");
    assert!(pts.iter().any(|p| p.y.abs() < ON) && pts.iter().any(|p| (p.y - 10.0).abs() < ON));
    close(length(&k, &all[0]), 40.0, 1e-3);

    let seen = k.project(&c, &[], &[(line(20.0, 5.0), down)], FAR, false, true).unwrap();
    assert_eq!(seen.len(), 1, "only the top is seen from above");
    for p in points(&k, &seen[0]) {
        close(p.y, 10.0, ON);
        close(p.z, 5.0, ON);
        assert!(p.x > -ON && p.x < 10.0 + ON);
    }
    close(length(&k, &seen[0]), 10.0, ON);
}

#[test]
fn forwards_only_unless_bidirectional() {
    let k = Occt;
    let c = cube(&k);
    let up = DVec3::Y;
    assert!(matches!(k.project(&c, &[], &[(line(20.0, 5.0), up)], FAR, false, false), Err(KernelError::Refused(m)) if m.contains("miss")));
    assert_eq!(k.project(&c, &[], &[(line(20.0, 5.0), up)], FAR, true, false).unwrap().len(), 1);
    // From inside the body, both ways with hide sees the top and the bottom; the sides lie
    // edge-on along the way, so they can't be seen and are left out.
    let seen = k.project(&c, &[], &[(line(5.0, 5.0), up)], FAR, true, true).unwrap();
    assert_eq!(seen.len(), 2, "{seen:?}");
    for s in &seen { close(length(&k, s), 10.0, 1e-3); }
}

#[test]
fn a_face_half_hidden_keeps_only_the_part_seen() {
    // A C shape open towards +x: the upper flange (x 0..6) hides part of the lower one's top.
    let k = Occt;
    let c = union(&k, vec![
        k.box_from_corners(DVec3::ZERO, DVec3::new(10.0, 2.0, 10.0)),
        k.box_from_corners(DVec3::ZERO, DVec3::new(2.0, 12.0, 10.0)),
        k.box_from_corners(DVec3::new(0.0, 10.0, 0.0), DVec3::new(6.0, 12.0, 10.0)),
    ]);
    let seen = k.project(&c, &[], &[(line(20.0, 5.0), -DVec3::Y)], FAR, false, true).unwrap();
    let pts = all_points(&k, &seen);
    let lower: Vec<DVec3> = pts.iter().copied().filter(|p| (p.y - 2.0).abs() < ON).collect();
    assert!(!lower.is_empty(), "the lower flange shows past the upper one");
    let from = lower.iter().map(|p| p.x).fold(f64::INFINITY, f64::min);
    close(from, 6.0, 1e-5);
    let under: Vec<&DVec3> = pts.iter().filter(|p| !((p.y - 12.0).abs() < ON || (p.y - 2.0).abs() < ON || (p.x - 6.0).abs() < ON)).collect();
    assert!(under.is_empty(), "nothing under the flange: {under:?}");
}

#[test]
fn a_circle_wraps_onto_a_sphere_and_a_cylinder() {
    let k = Occt;
    let ball = primitive(&k, &Primitive::Sphere { center: DVec3::ZERO, radius: 10.0 }).unwrap();
    let ring = Path::Circle { center: DVec3::new(0.0, 30.0, 0.0), normal: DVec3::Y, radius: 6.0 };
    let on = k.project(&ball, &[], &[(ring.clone(), -DVec3::Y)], FAR, false, true).unwrap();
    assert_eq!(on.len(), 1, "one loop on the near side");
    let worst = points(&k, &on[0]).iter().map(|p| (p.length() - 10.0).abs()).fold(0.0, f64::max);
    assert!(worst < ON, "off the sphere by {worst}");
    for p in points(&k, &on[0]) { close(p.y, 8.0, ON); close(p.x.hypot(p.z), 6.0, ON); }

    // A cylinder lying along x, radius 5: the ring lands on its top as a saddle-shaped loop.
    let frame = Frame::new(DVec3::new(-10.0, 0.0, 0.0), DVec3::Y, DVec3::X);
    let rod = primitive(&k, &Primitive::Cylinder { frame, radius: 5.0, height: 20.0 }).unwrap();
    let ring = Path::Circle { center: DVec3::new(0.0, 30.0, 0.0), normal: DVec3::Y, radius: 3.0 };
    let on = k.project(&rod, &[], &[(ring, -DVec3::Y)], FAR, false, true).unwrap();
    assert_eq!(on.len(), 1);
    let worst = points(&k, &on[0]).iter().map(|p| (p.y.hypot(p.z) - 5.0).abs()).fold(0.0, f64::max);
    assert!(worst < ON, "off the cylinder by {worst}");
}

#[test]
fn only_the_chosen_faces_take_the_curve() {
    let k = Occt;
    let c = cube(&k);
    let t = k.tessellate(&c, 0.01).unwrap();
    let bottom = t.face_planes.iter().position(|p| p.map_or(false, |p| p.normal.y < -0.999)).unwrap() as u32;
    let on = k.project(&c, &[bottom], &[(line(20.0, 5.0), -DVec3::Y)], FAR, false, false).unwrap();
    assert_eq!(on.len(), 1);
    close(points(&k, &on[0])[0].y, 0.0, ON);
}

#[test]
fn two_bodies_meet_in_curves() {
    let k = Occt;
    let c = cube(&k);
    // A cylinder up through the middle of the cube: a circle on its top and one on its bottom.
    let frame = Frame::new(DVec3::new(5.0, -5.0, 5.0), DVec3::X, DVec3::Y);
    let rod = primitive(&k, &Primitive::Cylinder { frame, radius: 2.0, height: 20.0 }).unwrap();
    let meet = k.meet(&c, &rod).unwrap();
    assert_eq!(meet.len(), 2);
    for p in all_points(&k, &meet) {
        assert!(p.y.abs() < ON || (p.y - 10.0).abs() < ON);
        close((p.x - 5.0).hypot(p.z - 5.0), 2.0, ON);
    }
    let away = k.box_from_corners(DVec3::splat(50.0), DVec3::splat(60.0));
    assert!(matches!(k.meet(&c, &away), Err(KernelError::Refused(m)) if m.contains("do not meet")));
}

#[test]
fn two_curves_meet_where_their_sheets_cross() {
    // A circle on the ground (its sheet a tube up y) and a line at height 3 in the plane z = 0 (its
    // sheet the plane y = 3): they meet in a circle at height 3.
    let k = Occt;
    let ring = (Path::Circle { center: DVec3::ZERO, normal: DVec3::Y, radius: 5.0 }, DVec3::Y);
    let ledge = (Path::Polyline { points: vec![DVec3::new(-20.0, 3.0, 0.0), DVec3::new(20.0, 3.0, 0.0)], closed: false }, DVec3::Z);
    let out = k.project_curve_curve(&ring, &ledge, FAR).unwrap();
    assert_eq!(out.len(), 1);
    for p in points(&k, &out[0]) { close(p.y, 3.0, ON); close(p.x.hypot(p.z), 5.0, ON); }
}

#[test]
fn the_document_keeps_projected_curves_as_one_undo_step() {
    let mut doc = Document::new(Occt);
    let body = doc.add(cube(&doc.kernel));
    let ring = Curve {
        origin: [5.0, 20.0, 5.0], x: [1.0, 0.0, 0.0], normal: [0.0, 1.0, 0.0],
        shape: CurveShape::Circle { center: [0.0, 0.0], radius: 3.0 },
    };
    let id = doc.commit_curves(vec![ring]).unwrap()[0];
    doc.clear_history();
    let out = doc.preview_project(body, &[], &[id], -DVec3::Y, false, true).unwrap();
    assert_eq!(out.len(), 1);
    // Projected onto the flat top, the loop lies in that face's plane and bounds a region.
    let c = &out[0];
    close(c.normal[1], 1.0, 1e-9);
    close(c.origin[1], 10.0, ON);
    assert!(matches!(c.shape, CurveShape::Nurbs { .. }));
    assert!(c.profile().is_some(), "a flat closed projection is a region");
    let made = doc.commit_project(out).unwrap();
    assert_eq!(doc.curve_ids().len(), 2, "the original curve stays");
    // Saved and read back, it is the same curve.
    let text = serde_json::to_string(doc.curve(made[0]).unwrap()).unwrap();
    assert!(text.contains("\"kind\":\"nurbs\""));
    assert_eq!(&serde_json::from_str::<Curve>(&text).unwrap(), doc.curve(made[0]).unwrap());
    // It can be extruded from the top as a region.
    let region = doc.curve(made[0]).unwrap();
    let s = doc.kernel.extrude(&region.profile().unwrap(), &region.frame(), &Extent::to(4.0)).unwrap();
    close(doc.kernel.tessellate(&s, 0.001).unwrap().volume(), std::f64::consts::PI * 9.0 * 4.0, 0.05);
    assert!(doc.undo());
    assert_eq!(doc.curve_ids(), vec![id]);
}

