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
