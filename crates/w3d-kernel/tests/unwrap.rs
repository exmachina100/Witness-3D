//! Plasticity's Unwrap Face: a face laid flat on the ground as a new sheet (the user's XY plane; the
//! model is y-up, so that is the model's y = 0). Planes, cylinders and
//! cones keep their lengths; other faces are flattened conformally, keeping their area. Units are mm.

#![cfg(feature = "occt")]

use std::f64::consts::PI;

use glam::DVec3;
use opencascade::primitives::Shape;
use w3d_kernel::blend::{blend, BlendParams, FilletShape, EQUAL};
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

fn area(k: &Occt, s: &Shape) -> f64 {
    let t = k.tessellate(s, 0.001).unwrap();
    t.indices.chunks_exact(3).map(|i| {
        let [a, b, c] = [i[0], i[1], i[2]].map(|i| DVec3::from_array(t.positions[i as usize]));
        (b - a).cross(c - a).length() / 2.0
    }).sum()
}

/// The sheet's points: all on the ground (y = 0), and the extent across it in x and z.
fn flat_extent(k: &Occt, s: &Shape) -> (f64, f64) {
    let t = k.tessellate(s, 0.01).unwrap();
    assert!(t.positions.iter().all(|p| p[1].abs() < 1e-9), "lies on the ground");
    let (mut lo, mut hi) = (DVec3::splat(f64::MAX), DVec3::splat(f64::MIN));
    for p in &t.positions { lo = lo.min(DVec3::from_array(*p)); hi = hi.max(DVec3::from_array(*p)); }
    ((hi - lo).x, (hi - lo).z)
}

fn dimpled(k: &Occt) -> Shape {
    let b = k.box_from_corners(DVec3::ZERO, DVec3::new(100.0, 100.0, 50.0));
    let ball = k.sphere(DVec3::new(50.0, 50.0, 50.0), 20.0).unwrap();
    k.boolean(&b, &ball, BooleanOp::Difference).unwrap().solid
}

#[test]
fn a_round_unrolls_to_its_true_width() {
    let k = Occt;
    let b = k.box_from_corners(DVec3::ZERO, DVec3::new(40.0, 30.0, 20.0));
    let t = k.tessellate(&b, 0.01).unwrap();
    let e = t.edges.iter().position(|p| p.iter().all(|q| q[0].abs() < 1e-6 && q[2].abs() < 1e-6)).unwrap() as u32;
    let p = BlendParams { edges: vec![e], size: 5.0, kind: Blend::Fillet, angle: EQUAL, variable: vec![], shape: FilletShape::Round, tension: 0.5, limits: vec![] };
    let r = blend(&k, &b, &p).unwrap();
    let round = r.history.generated_faces[0].1;
    let flat = k.unwrap_face(&r.solid, round).unwrap();
    assert!(k.is_valid(&flat) && k.is_sheet(&flat));
    let (w, h) = flat_extent(&k, &flat);
    // A quarter of a 5 mm circle across, 30 mm along, lying along the edge as seen from above (the
    // edge runs along y, which is up, so it lies along z, the user's y).
    assert!((w - 5.0 * PI / 2.0).abs() < 1e-6 && (h - 30.0).abs() < 1e-6, "{w} x {h}");
    assert!((area(&k, &flat) - 75.0 * PI).abs() < 1e-6);
    let up = k.tessellate(&flat, 0.01).unwrap().face_planes[0].clone().unwrap();
    assert!(up.normal.y > 0.999, "outward side up: {:?}", up.normal);
}

#[test]
fn a_flat_face_keeps_its_hole() {
    let k = Occt;
    let s = dimpled(&k);
    let t = k.tessellate(&s, 0.01).unwrap();
    let top = t.face_planes.iter().position(|p| p.as_ref().is_some_and(|p| (p.origin.z - 50.0).abs() < 1e-9 && p.normal.z > 0.99)).unwrap() as u32;
    let flat = k.unwrap_face(&s, top).unwrap();
    assert!(k.is_valid(&flat));
    assert_eq!(flat_extent(&k, &flat), (100.0, 100.0));
    // Its outward side faces up.
    let up = k.tessellate(&flat, 0.01).unwrap().face_planes[0].clone().unwrap();
    assert!(up.normal.y > 0.999, "{:?}", up.normal);
    assert!((area(&k, &flat) - (10_000.0 - 400.0 * PI)).abs() < 0.05, "area {}", area(&k, &flat));
}

#[test]
fn a_ball_flattens_keeping_its_area() {
    let k = Occt;
    let s = dimpled(&k);
    let t = k.tessellate(&s, 0.01).unwrap();
    let bowl = t.face_planes.iter().position(|p| p.is_none()).unwrap() as u32;
    let before = area(&k, &k.untrim_face(&s, bowl, false).unwrap()) / 2.0;
    let flat = k.unwrap_face(&s, bowl).unwrap();
    assert!(k.is_valid(&flat) && k.is_sheet(&flat));
    let (w, h) = flat_extent(&k, &flat);
    // A half ball (area 2πr² = 2513 mm²) can't lie flat without stretching; its area is kept.
    assert!((area(&k, &flat) - before).abs() / before < 0.01, "area {} against {before}", area(&k, &flat));
    // Conformal, so not squashed; cut open along its seam it is not quite round either.
    assert!(w.max(h) / w.min(h) < 1.25, "{w} x {h}");
}

#[test]
fn a_round_lies_along_its_edge() {
    let k = Occt;
    let b = k.box_from_corners(DVec3::ZERO, DVec3::new(40.0, 30.0, 20.0));
    let t = k.tessellate(&b, 0.01).unwrap();
    // The top edge at the front, running along x.
    let e = t.edges.iter().position(|p| p.iter().all(|q| (q[1] - 30.0).abs() < 1e-6 && q[2].abs() < 1e-6)).unwrap() as u32;
    let p = BlendParams { edges: vec![e], size: 5.0, kind: Blend::Fillet, angle: EQUAL, variable: vec![], shape: FilletShape::Round, tension: 0.5, limits: vec![] };
    let r = blend(&k, &b, &p).unwrap();
    let flat = k.unwrap_face(&r.solid, r.history.generated_faces[0].1).unwrap();
    let (w, h) = flat_extent(&k, &flat);
    assert!((w - 40.0).abs() < 1e-6 && (h - 5.0 * PI / 2.0).abs() < 1e-6, "{w} x {h}");
}
