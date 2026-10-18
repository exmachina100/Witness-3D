//! Offset Face's adjacent angle and the Spiral, checked against hand-computed volumes. Units are mm.

#![cfg(feature = "occt")]

use std::f64::consts::PI;

use glam::DVec3;
use opencascade::primitives::Shape;
use w3d_kernel::document::Document;
use w3d_kernel::form::{self, FormKind, FormParams};
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

fn close(a: f64, b: f64, eps: f64) {
    assert!((a - b).abs() < eps, "{a} != {b} (±{eps})")
}

fn volume(k: &Occt, s: &Shape) -> f64 {
    k.tessellate(s, 0.002).unwrap().volume()
}

fn enclosure(k: &Occt) -> Shape {
    k.box_from_corners(DVec3::new(-40.0, 0.0, -25.0), DVec3::new(40.0, 30.0, 25.0))
}

fn top_faces(k: &Occt, s: &Shape, y: f64) -> Vec<u32> {
    let t = k.tessellate(s, 0.01).unwrap();
    t.face_planes
        .iter()
        .enumerate()
        .filter(|(_, p)| p.as_ref().is_some_and(|p| p.normal.dot(DVec3::Y) > 1.0 - 1e-9 && (p.origin.y - y).abs() < 1e-6))
        .map(|(i, _)| i as u32)
        .collect()
}

/// A box frustum's volume: base `a × b`, each side moving in `d` over height `h`.
fn frustum(a: f64, b: f64, d: f64, h: f64) -> f64 {
    let (ta, tb, ma, mb) = (a - 2.0 * d, b - 2.0 * d, a - d, b - d);
    h / 6.0 * (a * b + ta * tb + 4.0 * ma * mb)
}

#[test]
fn offset_face_angle_leans_the_sides_about_the_far_edges() {
    let mut doc = Document::new(Occt);
    let a = doc.add(enclosure(&doc.kernel));
    let top = top_faces(&doc.kernel, doc.get(a).unwrap(), 30.0);
    let top_ref = doc.refs(a).unwrap().faces[top[0] as usize];
    let before = doc.refs(a).unwrap().faces.clone();
    let lean = (5.0f64 / 30.0).atan();
    // A alone: the base stays, the top shrinks to 70 × 40.
    close(volume(&doc.kernel, &doc.preview_offset(a, &top, 0.0, lean, Grow::Moving).unwrap()), frustum(80.0, 50.0, 5.0, 30.0), 0.5);
    // Negative leans out.
    close(volume(&doc.kernel, &doc.preview_offset(a, &top, 0.0, -lean, Grow::Moving).unwrap()), frustum(80.0, 50.0, -5.0, 30.0), 0.5);
    // With a distance the face moves first, then the sides lean over the new height.
    doc.commit_offset(a, &top, 5.0, lean, Grow::Moving).unwrap();
    let s = doc.get(a).unwrap();
    close(volume(&doc.kernel, s), frustum(80.0, 50.0, 35.0 * 5.0 / 30.0, 35.0), 0.5);
    assert_eq!(doc.kernel.face_count(s), 6);
    let moved = top_faces(&doc.kernel, s, 35.0);
    assert_eq!(doc.refs(a).unwrap().faces[moved[0] as usize], top_ref, "the face keeps its ref");
    for r in &before {
        assert!(doc.refs(a).unwrap().faces.contains(r), "the leaning faces keep their refs too");
    }
    assert!(doc.undo());
    close(volume(&doc.kernel, doc.get(a).unwrap()), 120_000.0, 1e-3);
    assert!(matches!(doc.preview_offset(a, &top, 0.0, 0.0, Grow::Moving), Err(KernelError::NoOp)));
    assert!(doc.preview_offset(a, &top, 0.0, PI / 2.0, Grow::Moving).is_err());
}

/// A helix of radius 10 up y from the origin, starting along x: 2 turns over 20.
fn spring(left: bool) -> Path {
    Path::Spiral { origin: DVec3::ZERO, axis: DVec3::Y, x: DVec3::X, radius: 10.0, length: 20.0, turns: 2.0, left }
}

/// A circle of radius 1 at the helix's start, square to it.
fn coil(left: bool) -> Result<Shape, KernelError> {
    let pitch = 20.0 / 2.0;
    // The helix runs anticlockwise about +y: from +x towards -z (or +z when left handed).
    let tangent = DVec3::new(0.0, pitch / (2.0 * PI), if left { 10.0 } else { -10.0 }).normalize();
    form::tool(
        &Occt,
        &FormParams {
            profile: Profile::Circle { center: (0.0, 0.0), radius: 1.0 },
            frame: Frame::new(DVec3::new(10.0, 0.0, 0.0), DVec3::X, tangent),
            kind: FormKind::Sweep { path: spring(left), twist: 0.0, scale: 1.0, guide: None, method: Default::default(), align: Default::default() },
            operation: Operation::NewBody,
        },
    )
}

#[test]
fn a_circle_swept_along_a_spiral_makes_a_spring() {
    let length = 2.0 * ((2.0 * PI * 10.0).powi(2) + 10.0f64.powi(2)).sqrt();
    for left in [false, true] {
        let s = coil(left).unwrap();
        close(volume(&Occt, &s), PI * length, PI * length * 0.01);
        let b = Occt.tessellate(&s, 0.01).unwrap();
        let top = b.positions.iter().map(|p| p[1]).fold(f64::MIN, f64::max);
        close(top, 21.0, 0.2);
    }
}

#[test]
fn a_spiral_curve_is_checked_and_becomes_its_path() {
    let mut doc = Document::new(Occt);
    let spiral = |radius, length, turns| Curve {
        origin: [0.0, 0.0, 0.0],
        x: [1.0, 0.0, 0.0],
        normal: [0.0, 1.0, 0.0],
        shape: CurveShape::Spiral { radius, length, turns, left: false },
    };
    let ids = doc.commit_curves(vec![spiral(10.0, 20.0, 2.0)]).unwrap();
    let c = doc.curve(ids[0]).unwrap();
    assert!(c.profile().is_none(), "a spiral bounds no region");
    assert_eq!(c.path(), spring(false));
    for bad in [spiral(0.0, 20.0, 2.0), spiral(10.0, 0.0, 2.0), spiral(10.0, 20.0, 0.0), spiral(f64::NAN, 20.0, 2.0)] {
        assert!(doc.commit_curves(vec![bad]).is_err());
    }
}
