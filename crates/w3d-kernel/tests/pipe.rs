//! Pipe (Plasticity's): a tube along a curve, round or many-sided, solid or hollow. Units are mm.

#![cfg(feature = "occt")]

use std::f64::consts::PI;

use glam::DVec3;
use w3d_kernel::form::pipe;
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

fn line(a: DVec3, b: DVec3) -> Path { Path::Polyline { points: vec![a, b], closed: false } }

#[test]
fn a_straight_pipe_is_a_cylinder_solid_or_hollow() {
    let k = Occt;
    let path = line(DVec3::ZERO, DVec3::new(0.0, 0.0, 20.0));
    let rod = pipe(&k, &path, 2.0, 0.0, 0).unwrap();
    assert!(k.is_valid(&rod) && !k.is_sheet(&rod));
    let v = k.tessellate(&rod, 0.0001).unwrap().volume();
    assert!((v - PI * 4.0 * 20.0).abs() / (PI * 80.0) < 1e-3, "volume {v}");
    let tube = pipe(&k, &path, 2.0, 0.5, 0).unwrap();
    let v = k.tessellate(&tube, 0.0001).unwrap().volume();
    let exact = PI * (4.0 - 2.25) * 20.0;
    assert!((v - exact).abs() / exact < 1e-3, "volume {v} vs {exact}");
    assert_eq!(k.face_count(&tube), 4, "outside, inside and two ring ends");
}

#[test]
fn a_square_section_has_corners_on_the_radius() {
    let k = Occt;
    let path = line(DVec3::ZERO, DVec3::new(10.0, 0.0, 0.0));
    let bar = pipe(&k, &path, 2.0, 0.0, 4).unwrap();
    assert_eq!(k.face_count(&bar), 6);
    // A square with corners 2 from the middle has sides of 2√2: area 8.
    let v = k.tessellate(&bar, 0.001).unwrap().volume();
    assert!((v - 80.0).abs() < 1e-6, "volume {v}");
}

#[test]
fn a_pipe_round_a_circle_is_a_torus() {
    let k = Occt;
    let ring = Path::Circle { center: DVec3::ZERO, normal: DVec3::Z, radius: 10.0 };
    let torus = pipe(&k, &ring, 1.0, 0.0, 0).unwrap();
    assert!(k.is_valid(&torus));
    let v = k.tessellate(&torus, 0.0001).unwrap().volume();
    let exact = 2.0 * PI * PI * 10.0 * 1.0;
    assert!((v - exact).abs() / exact < 2e-3, "volume {v} vs {exact}");
}

#[test]
fn bad_sizes_are_refused() {
    let k = Occt;
    let path = line(DVec3::ZERO, DVec3::new(0.0, 0.0, 20.0));
    assert!(pipe(&k, &path, 0.0, 0.0, 0).is_err());
    assert!(pipe(&k, &path, 2.0, 2.0, 0).err().unwrap().to_string().contains("as thick"));
    assert!(pipe(&k, &path, 2.0, -1.0, 0).is_err());
    assert!(pipe(&k, &path, 2.0, 0.0, 2).is_err());
}

#[test]
fn the_document_runs_a_pipe_along_each_curve_in_one_undo_step() {
    use w3d_kernel::document::{Curve, CurveShape, Document};
    let mut doc = Document::new(Occt);
    let a = Curve { origin: [0.0, 0.0, 0.0], x: [1.0, 0.0, 0.0], normal: [0.0, 0.0, 1.0], shape: CurveShape::Polyline { points: vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0]], closed: false } };
    let b = Curve { origin: [0.0, 0.0, 0.0], x: [1.0, 0.0, 0.0], normal: [0.0, 0.0, 1.0], shape: CurveShape::Circle { center: [30.0, 0.0], radius: 5.0 } };
    let ids = doc.commit_curves(vec![a, b]).unwrap();
    doc.clear_history();
    let tubes = doc.commit_pipe(&ids, 1.0, 0.0, 0).unwrap();
    assert_eq!(tubes.len(), 2);
    assert_eq!(doc.curve_ids(), ids, "the curves stay");
    for t in &tubes { assert!(doc.kernel.is_valid(doc.get(*t).unwrap())) }
    assert!(doc.undo());
    assert!(tubes.iter().all(|t| doc.get(*t).is_none()));
}

#[test]
fn angle_turns_the_section_and_scale_tapers_it() {
    use w3d_kernel::form::pipe_with;
    let k = Occt;
    let path = line(DVec3::ZERO, DVec3::new(10.0, 0.0, 0.0));
    // A square turned 45°: still area 8.
    let bar = pipe_with(&k, &path, 2.0, 0.0, 4, PI / 4.0, 1.0).unwrap();
    let m = k.tessellate(&bar, 0.001).unwrap();
    assert!((m.volume() - 80.0).abs() < 1e-6);
    let ys: Vec<f64> = m.positions.iter().map(|p| p[1]).collect();
    let span = ys.iter().cloned().fold(f64::MIN, f64::max) - ys.iter().cloned().fold(f64::MAX, f64::min);
    // Turned 45° from corners-on-the-axes, its sides face the axes: √8 across instead of 4.
    assert!((span - 8f64.sqrt()).abs() < 1e-3, "span {span}");
    // Round, halving its radius by the end: a frustum of radii 2 and 1.
    let cone = pipe_with(&k, &path, 2.0, 0.0, 0, 0.0, 0.5).unwrap();
    let v = k.tessellate(&cone, 0.0001).unwrap().volume();
    let exact = PI * 10.0 / 3.0 * (4.0 + 2.0 + 1.0);
    assert!((v - exact).abs() / exact < 2e-3, "volume {v} vs {exact}");
    assert!(pipe_with(&k, &path, 2.0, 0.0, 0, 0.0, 0.0).is_err());
}

#[test]
fn a_pipe_cuts_or_joins_a_target_in_one_undo_step() {
    use w3d_kernel::document::{Curve, CurveShape, Document};
    let mut doc = Document::new(Occt);
    let block = doc.add(Occt.box_from_corners(DVec3::new(-5.0, -5.0, -5.0), DVec3::new(5.0, 5.0, 5.0)));
    let c = Curve { origin: [0.0, 0.0, 0.0], x: [1.0, 0.0, 0.0], normal: [0.0, 0.0, 1.0], shape: CurveShape::Polyline { points: vec![[-10.0, 0.0], [10.0, 0.0]], closed: false } };
    let ids = doc.commit_curves(vec![c]).unwrap();
    doc.clear_history();
    let out = doc.commit_pipe_with(&ids, 1.0, 0.0, 0, 0.0, 1.0, Some((block, BooleanOp::Difference)), false).unwrap();
    assert_eq!(out, vec![block]);
    let v = doc.kernel.tessellate(doc.get(block).unwrap(), 0.0001).unwrap().volume();
    let exact = 1000.0 - PI * 10.0;
    assert!((v - exact).abs() / exact < 1e-3, "volume {v} vs {exact}");
    assert!(doc.undo());
    let out = doc.commit_pipe_with(&ids, 1.0, 0.0, 0, 0.0, 1.0, Some((block, BooleanOp::Union)), true).unwrap();
    assert_eq!(out.len(), 2, "the target and the kept tube");
    let v = doc.kernel.tessellate(doc.get(block).unwrap(), 0.0001).unwrap().volume();
    let exact = 1000.0 + PI * 10.0;
    assert!((v - exact).abs() / exact < 1e-3, "volume {v} vs {exact}");
}
