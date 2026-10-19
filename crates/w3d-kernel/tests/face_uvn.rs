//! Deform Curve's face coordinates: points on a face to (s, t, n) and back. Units are mm.

#![cfg(feature = "occt")]

use glam::DVec3;
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

#[test]
fn a_block_face_maps_points_to_its_unit_square_and_back() {
    let k = Occt;
    let b = k.box_from_corners(DVec3::new(0.0, 0.0, 0.0), DVec3::new(10.0, 20.0, 30.0));
    let pts = [DVec3::new(5.0, 20.0, 15.0), DVec3::new(2.0, 23.0, 3.0)];
    // The top face (y = 20): its points are 0 to 1 across it, heights along the outward normal.
    let top = (0..6).find(|&f| k.face_uvn(&b, f, false, &pts[..1]).map(|(_, p)| p[0].z.abs() < 1e-9).unwrap_or(false)
        && k.face_uvn(&b, f, false, &pts[1..]).map(|(_, p)| (p[0].z - 3.0).abs() < 1e-9).unwrap_or(false)).expect("the top face");
    let (size, uvn) = k.face_uvn(&b, top, false, &pts).unwrap();
    let mut sides = size;
    sides.sort_by(f64::total_cmp);
    assert!((sides[0] - 10.0).abs() < 1e-6 && (sides[1] - 30.0).abs() < 1e-6, "{size:?}");
    for p in &uvn { assert!(p.x > -1e-9 && p.x < 1.0 + 1e-9 && p.y > -1e-9 && p.y < 1.0 + 1e-9, "{p}"); }
    let (_, back) = k.face_uvn(&b, top, true, &uvn).unwrap();
    for (a, b) in back.iter().zip(pts) { assert!((*a - b).length() < 1e-7, "{a} vs {b}"); }
}

#[test]
fn a_ball_maps_heights_along_its_outward_normal() {
    let k = Occt;
    let s = k.sphere(DVec3::ZERO, 10.0).unwrap();
    let (_, uvn) = k.face_uvn(&s, 0, false, &[DVec3::new(12.0, 0.0, 0.0)]).unwrap();
    assert!((uvn[0].z - 2.0).abs() < 1e-6, "{}", uvn[0]);
    let (_, p) = k.face_uvn(&s, 0, true, &[DVec3::new(0.3, 0.6, 1.0)]).unwrap();
    assert!((p[0].length() - 11.0).abs() < 1e-6, "{}", p[0]);
    assert!(k.face_uvn(&s, 7, false, &[DVec3::ZERO]).is_err());
}
