//! Plasticity's Place: copies of the selected bodies moved, turned and scaled from a reference point
//! onto a destination, as new bodies or combined with the body there. Units are mm.

#![cfg(feature = "occt")]

use std::f64::consts::FRAC_PI_2;

use glam::DVec3;
use opencascade::primitives::Shape;
use w3d_kernel::document::{BodyId, Document};
use w3d_kernel::extrude::Operation;
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

fn volume(k: &Occt, s: &Shape) -> f64 { k.tessellate(s, 0.01).unwrap().volume() }

fn extent(k: &Occt, s: &Shape) -> (DVec3, DVec3) {
    let t = k.tessellate(s, 0.01).unwrap();
    let (mut lo, mut hi) = (DVec3::splat(f64::MAX), DVec3::splat(f64::MIN));
    for p in &t.positions { lo = lo.min(DVec3::from_array(*p)); hi = hi.max(DVec3::from_array(*p)); }
    (lo, hi)
}

fn close(a: DVec3, b: DVec3) { assert!((a - b).length() < 1e-6, "{a} != {b}") }

/// A 10 mm cube standing on the ground, and a 100 × 20 × 100 slab beside it.
fn scene() -> (Document<Occt>, BodyId, BodyId) {
    let mut doc = Document::new(Occt);
    let cube = doc.add(doc.kernel.box_from_corners(DVec3::ZERO, DVec3::splat(10.0)));
    let slab = doc.add(doc.kernel.box_from_corners(DVec3::new(100.0, 0.0, 0.0), DVec3::new(200.0, 20.0, 100.0)));
    (doc, cube, slab)
}

#[test]
fn a_copy_lands_turned_and_scaled() {
    let (mut doc, cube, _) = scene();
    // From the cube's base centre to (50, 0, 50), a quarter turn about y, twice the size.
    let pivot = DVec3::new(5.0, 0.0, 5.0);
    let m = Motion { pivot, offset: DVec3::new(50.0, 0.0, 50.0) - pivot, axis: DVec3::Y, angle: FRAC_PI_2, scale: 2.0 };
    let made = doc.commit_place(&[cube], &m, None, Operation::NewBody).unwrap();
    assert_eq!(made.len(), 1);
    let s = doc.get(made[0]).unwrap();
    assert!((volume(&doc.kernel, s) - 8000.0).abs() < 1e-6);
    let (lo, hi) = extent(&doc.kernel, s);
    close(lo, DVec3::new(40.0, 0.0, 40.0));
    close(hi, DVec3::new(60.0, 20.0, 60.0));
    assert!(doc.get(cube).is_some(), "the original stays");
    assert!(doc.undo());
    assert!(doc.get(made[0]).is_none(), "one undo step");
}

#[test]
fn a_copy_cuts_the_body_it_lands_on() {
    let (mut doc, cube, slab) = scene();
    let before = volume(&doc.kernel, doc.get(slab).unwrap());
    // Half sunk into the slab's top (y = 20).
    let m = Motion::translation(DVec3::new(140.0, 15.0, 40.0));
    let made = doc.commit_place(&[cube], &m, Some(slab), Operation::Difference).unwrap();
    assert_eq!(made, vec![slab]);
    assert!((before - volume(&doc.kernel, doc.get(slab).unwrap()) - 500.0).abs() < 1e-6);
    assert!(doc.get(cube).is_some(), "the original tool stays");
}

#[test]
fn a_slice_leaves_the_piece_inside() {
    let (mut doc, cube, slab) = scene();
    let m = Motion::translation(DVec3::new(140.0, 15.0, 40.0));
    let made = doc.commit_place(&[cube], &m, Some(slab), Operation::Slice).unwrap();
    assert_eq!(made.len(), 2);
    assert!((volume(&doc.kernel, doc.get(made[1]).unwrap()) - 500.0).abs() < 1e-6);
}

#[test]
fn bad_placements_are_refused() {
    let (mut doc, cube, slab) = scene();
    let m = Motion { scale: 0.0, ..Motion::translation(DVec3::X) };
    assert!(doc.commit_place(&[cube], &m, None, Operation::NewBody).is_err());
    assert!(doc.commit_place(&[slab], &Motion::translation(DVec3::X), Some(slab), Operation::Union).is_err());
    let missed = doc.commit_place(&[cube], &Motion::translation(DVec3::new(0.0, 500.0, 0.0)), Some(slab), Operation::Difference);
    assert!(missed.is_err(), "a cut that misses says so");
}
