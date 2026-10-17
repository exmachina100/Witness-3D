//! Project Outline (Plasticity's): the outline of a body seen along the construction plane's normal,
//! drawn on the plane. Units are mm.

#![cfg(feature = "occt")]

use glam::DVec3;
use w3d_kernel::document::{CurveShape, Document};
use w3d_kernel::occt::Occt;
use w3d_kernel::solids::primitive;
use w3d_kernel::*;

/// A curve's length from dense samples: corners cut between samples cost well under 1e-3.
fn length(k: &Occt, p: &Path) -> f64 { k.sample(p, 20000).unwrap().windows(2).map(|w| (w[1] - w[0]).length()).sum() }

#[test]
fn a_block_outlines_as_its_footprint() {
    let k = Occt;
    let b = k.box_from_corners(DVec3::new(0.0, 0.0, 5.0), DVec3::new(10.0, 20.0, 8.0));
    let out = k.project_outline(&b, DVec3::ZERO, DVec3::Z, DVec3::X).unwrap();
    assert_eq!(out.len(), 1, "{out:?}");
    on_rectangle(&k, &out[0], (0.0, 10.0), (0.0, 20.0));
}

/// Every point of `p` on the outline of the rectangle `x` × `y` in the plane z = 0, all four corners reached.
fn on_rectangle(k: &Occt, p: &Path, x: (f64, f64), y: (f64, f64)) {
    let pts = k.sample(p, 2000).unwrap();
    for q in &pts {
        close(q.z, 0.0, 1e-9);
        let rim = [(q.x - x.0).abs(), (q.x - x.1).abs(), (q.y - y.0).abs(), (q.y - y.1).abs()].into_iter().fold(f64::MAX, f64::min);
        assert!(rim < 1e-6 && q.x > x.0 - 1e-6 && q.x < x.1 + 1e-6 && q.y > y.0 - 1e-6 && q.y < y.1 + 1e-6, "{q:?} off the rectangle");
    }
    for c in [(x.0, y.0), (x.1, y.0), (x.1, y.1), (x.0, y.1)] {
        let gap = pts.iter().map(|q| (q.x - c.0).hypot(q.y - c.1)).fold(f64::MAX, f64::min);
        assert!(gap < 0.02, "corner {c:?} not reached ({gap})");
    }
}

fn close(a: f64, b: f64, eps: f64) { assert!((a - b).abs() < eps, "{a} != {b} (±{eps})") }

#[test]
fn round_bodies_outline_by_their_silhouettes() {
    let k = Occt;
    let ball = primitive(&k, &Primitive::Sphere { center: DVec3::new(0.0, 0.0, 10.0), radius: 4.0 }).unwrap();
    let out = k.project_outline(&ball, DVec3::ZERO, DVec3::Z, DVec3::X).unwrap();
    assert_eq!(out.len(), 1);
    for p in k.sample(&out[0], 100).unwrap() { close(p.truncate().length(), 4.0, 1e-3); close(p.z, 0.0, 1e-9) }
    // A cylinder lying along y seen from above: a 6 × 20 rectangle.
    let rod = primitive(&k, &Primitive::Cylinder { frame: Frame::new(DVec3::new(0.0, 0.0, 5.0), DVec3::X, DVec3::Y), radius: 3.0, height: 20.0 }).unwrap();
    let out = k.project_outline(&rod, DVec3::ZERO, DVec3::Z, DVec3::X).unwrap();
    assert_eq!(out.len(), 1);
    on_rectangle(&k, &out[0], (-3.0, 3.0), (0.0, 20.0));
}

#[test]
fn a_hole_through_shows_in_the_outline() {
    let k = Occt;
    let plate = k.box_from_corners(DVec3::new(-10.0, -10.0, 0.0), DVec3::new(10.0, 10.0, 2.0));
    let pin = primitive(&k, &Primitive::Cylinder { frame: Frame::new(DVec3::new(0.0, 0.0, -1.0), DVec3::X, DVec3::Z), radius: 3.0, height: 4.0 }).unwrap();
    let holed = k.boolean(&plate, &pin, BooleanOp::Difference).unwrap().solid;
    let out = k.project_outline(&holed, DVec3::new(0.0, 0.0, 10.0), DVec3::Z, DVec3::X).unwrap();
    assert_eq!(out.len(), 2, "the rim and the hole");
    let mut lens: Vec<f64> = out.iter().map(|p| length(&k, p)).collect();
    lens.sort_by(f64::total_cmp);
    close(lens[0], 2.0 * std::f64::consts::PI * 3.0, 1e-3);
    close(lens[1], 80.0, 0.01);
}

#[test]
fn the_document_draws_the_outline_as_regions_on_the_plane() {
    let mut doc = Document::new(Occt);
    let b = doc.add(doc.kernel.box_from_corners(DVec3::new(0.0, 0.0, 5.0), DVec3::new(10.0, 20.0, 8.0)));
    let out = doc.preview_outline(b, DVec3::ZERO, DVec3::Z, DVec3::X).unwrap();
    assert_eq!(out.len(), 1);
    assert!(matches!(out[0].shape, CurveShape::Nurbs { .. }));
    close(out[0].normal[2].abs(), 1.0, 1e-9);
    assert!(out[0].profile().is_some(), "a closed flat outline is a region");
}

#[test]
fn a_cube_seen_corner_on_outlines_as_a_hexagon() {
    let k = Occt;
    let cube = k.box_from_corners(DVec3::ZERO, DVec3::splat(10.0));
    let n = DVec3::ONE.normalize();
    let out = k.project_outline(&cube, DVec3::new(0.0, 0.0, -20.0), n, DVec3::X).unwrap();
    assert_eq!(out.len(), 1);
    let pts = k.sample(&out[0], 3000).unwrap();
    for p in &pts { close((*p - DVec3::new(0.0, 0.0, -20.0)).dot(n), 0.0, 1e-6) }
    // A regular hexagon whose corners lie 10·√(2/3) from its centre.
    let c = DVec3::splat(5.0) - n * (DVec3::splat(5.0) - DVec3::new(0.0, 0.0, -20.0)).dot(n);
    let far = pts.iter().map(|p| (*p - c).length()).fold(0.0, f64::max);
    close(far, 10.0 * (2.0f64 / 3.0).sqrt(), 1e-3);
}
