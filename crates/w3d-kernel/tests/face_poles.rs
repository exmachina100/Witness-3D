//! Toggle Points: each face's control points (its surface, trimmed to the face, as a B-spline).
//! Units are mm.

#![cfg(feature = "occt")]

use glam::DVec3;
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

#[test]
fn a_block_face_has_its_four_corners() {
    let k = Occt;
    let b = k.box_from_corners(DVec3::new(0.0, 0.0, 0.0), DVec3::new(10.0, 20.0, 30.0));
    let faces = k.face_poles(&b);
    assert_eq!(faces.len(), 6);
    for rows in &faces {
        assert_eq!((rows.len(), rows[0].len()), (2, 2), "{rows:?}");
        for p in rows.iter().flatten() {
            for (v, top) in [(p.x, 10.0), (p.y, 20.0), (p.z, 30.0)] {
                assert!(v.abs() < 1e-9 || (v - top).abs() < 1e-9, "{p} is not a corner");
            }
        }
    }
}

#[test]
fn a_ball_has_a_grid_of_poles_round_it() {
    let k = Occt;
    let s = k.sphere(DVec3::new(5.0, 0.0, 0.0), 10.0).unwrap();
    let faces = k.face_poles(&s);
    assert_eq!(faces.len(), 1);
    let rows = &faces[0];
    assert!(rows.len() >= 3 && rows[0].len() >= 3, "{} × {}", rows.len(), rows[0].len());
    // Rational poles sit on or outside the ball, never inside it.
    for p in rows.iter().flatten() { assert!((*p - DVec3::new(5.0, 0.0, 0.0)).length() > 10.0 - 1e-6, "{p}"); }
}
