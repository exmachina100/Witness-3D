//! Extrude's Freestyle (F) and Individual (I) options (Plasticity manual, solid/extrude). Units are mm.

#![cfg(feature = "occt")]

use glam::DVec3;
use w3d_kernel::extrude::{extrude, tool, ExtrudeParams, ExtrudeResult, Operation};
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

fn volume(k: &Occt, s: &<Occt as Kernel>::Solid) -> f64 { k.tessellate(s, 0.001).unwrap().volume() }
fn bounds(k: &Occt, s: &<Occt as Kernel>::Solid) -> (DVec3, DVec3) {
    let t = k.tessellate(s, 0.001).unwrap();
    t.positions.iter().map(|p| DVec3::from_array(*p)).fold((DVec3::splat(f64::MAX), DVec3::splat(f64::MIN)), |(lo, hi), p| (lo.min(p), hi.max(p)))
}
/// A 10 × 10 square on the ground, extruded `distance`, optionally along `direction`.
fn square(distance: f64, direction: Option<DVec3>) -> ExtrudeParams {
    ExtrudeParams {
        profile: Profile::rectangle(10.0, 10.0),
        frame: Frame::new(DVec3::ZERO, DVec3::X, DVec3::Z),
        distance, back: 0.0, angle: 0.0, thickness: 0.0,
        operation: Operation::NewBody, face: None, direction, more_faces: vec![], individual: false,
    }
}
/// The numbered faces of a 20 mm cube from the origin whose normals are `n`.
fn face(k: &Occt, s: &<Occt as Kernel>::Solid, n: DVec3) -> u32 {
    (0..k.face_count(s) as u32).find(|&f| k.face_normal(s, f).is_some_and(|m| m.dot(n) > 0.99)).unwrap()
}

#[test]
fn freestyle_leans_the_extrude_along_its_direction() {
    let k = Occt;
    // 10 along (1, 0, 1)/√2: a slanted prism, its volume base × height.
    let s = tool(&k, None, &square(10.0, Some(DVec3::new(1.0, 0.0, 1.0)))).unwrap();
    assert!(k.is_valid(&s));
    let h = 10.0 / 2f64.sqrt();
    assert!((volume(&k, &s) - 100.0 * h).abs() < 1e-6, "volume {}", volume(&k, &s));
    let (lo, hi) = bounds(&k, &s);
    assert!((hi.z - h).abs() < 1e-6 && (hi.x - (5.0 + h)).abs() < 1e-6 && (lo.x + 5.0).abs() < 1e-6);
    assert!(tool(&k, None, &square(10.0, Some(DVec3::ZERO))).is_err());
}

#[test]
fn freestyle_into_the_body_cuts() {
    let k = Occt;
    let cube = k.box_from_corners(DVec3::ZERO, DVec3::splat(20.0));
    let top = face(&k, &cube, DVec3::Z);
    // Down and sideways from the top face: inward, so Auto cuts.
    let p = ExtrudeParams { operation: Operation::Auto, face: Some(top), direction: Some(DVec3::new(0.5, 0.0, -1.0)), ..square(5.0, None) };
    let ExtrudeResult::Replace { solid, op, .. } = extrude(&k, Some(&cube), &p).unwrap() else { panic!("expected a cut") };
    assert_eq!(op, BooleanOp::Difference);
    assert!(volume(&k, &solid) < 8000.0 - 1.0);
}

#[test]
fn individual_takes_each_face_along_its_own_normal() {
    let k = Occt;
    let cube = k.box_from_corners(DVec3::ZERO, DVec3::splat(20.0));
    let (top, side) = (face(&k, &cube, DVec3::Z), face(&k, &cube, DVec3::X));
    let both = |individual| ExtrudeParams { operation: Operation::Auto, face: Some(top), more_faces: vec![side], individual, ..square(5.0, None) };
    // Individual: a slab on top and one on the +X side.
    let ExtrudeResult::Replace { solid, .. } = extrude(&k, Some(&cube), &both(true)).unwrap() else { panic!("expected a join") };
    assert!((volume(&k, &solid) - (8000.0 + 2.0 * 400.0 * 5.0)).abs() < 1e-3, "volume {}", volume(&k, &solid));
    let (_, hi) = bounds(&k, &solid);
    assert!((hi.z - 25.0).abs() < 1e-6 && (hi.x - 25.0).abs() < 1e-6);
    // Direct: both along the top face's normal, which the side face lies along, so it is refused.
    let e = extrude(&k, Some(&cube), &both(false)).err().unwrap().to_string();
    assert!(e.contains("Individual"), "{e}");
}
