//! Cut by a free-form face (Plasticity's Cut with a face): a face that is neither flat nor a
//! cylinder cuts by its surface carried on past its sides. Units are mm.

#![cfg(feature = "occt")]

use glam::DVec3;
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

#[test]
fn a_ball_face_cuts_by_its_extension() {
    let k = Occt;
    // A dimple of radius 20 sunk into a block's top at z = 50: its face reaches only z = 30..50.
    let b = k.box_from_corners(DVec3::ZERO, DVec3::new(100.0, 100.0, 50.0));
    let ball = k.sphere(DVec3::new(50.0, 50.0, 50.0), 20.0).unwrap();
    let dimpled = k.boolean(&b, &ball, BooleanOp::Difference).unwrap().solid;
    let t = k.tessellate(&dimpled, 0.01).unwrap();
    let dimple = t.face_planes.iter().position(|p| p.is_none()).unwrap() as u32;
    // A slab across z = 45..80 that the dimple's band alone only scores.
    let slab = k.box_from_corners(DVec3::new(20.0, 20.0, 45.0), DVec3::new(80.0, 80.0, 80.0));
    let sheet = k.face_sheet(&dimpled, dimple, 200.0).unwrap();
    let (_, pieces) = k.cut(&slab, &[], &[&sheet], 200.0).unwrap();
    // Carried straight up from the equator, the face is a tube r = 20 through the whole slab.
    assert_eq!(pieces.len(), 1, "the slab comes apart in two");
    let vol = |s| k.tessellate(s, 0.01).unwrap().volume();
    let whole = 60.0 * 60.0 * 35.0;
    let (first, _) = k.cut(&slab, &[], &[&sheet], 200.0).unwrap();
    let inner = vol(&first.solid).min(vol(&pieces[0]));
    // The part inside the tube: r = 20 from z = 50 up, and the ball below it down to z = 45.
    let cap = std::f64::consts::PI * (20.0f64.powi(2) * 5.0 - 5.0f64.powi(3) / 3.0);
    let tube = std::f64::consts::PI * 400.0 * 30.0 + cap;
    assert!((inner - tube).abs() < tube * 1e-3, "inside the tube: {inner} vs {tube}");
    let total = vol(&first.solid) + vol(&pieces[0]);
    assert!((total - whole).abs() < 1.0, "volumes add up: {total} vs {whole}");
}
