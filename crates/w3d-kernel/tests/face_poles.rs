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

fn square(k: &Occt) -> opencascade::primitives::Shape {
    let c = [DVec3::new(0.0, 0.0, 0.0), DVec3::new(10.0, 0.0, 0.0), DVec3::new(10.0, 10.0, 0.0), DVec3::new(0.0, 10.0, 0.0)];
    k.patch(&[Path::Polyline { points: c.to_vec(), closed: true }], &[]).unwrap()
}

fn highest(t: &Tessellation) -> f64 { t.positions.iter().map(|p| p[2] as f64).fold(f64::MIN, f64::max) }

#[test]
fn moving_a_sheet_corner_lifts_it_with_its_edges() {
    let k = Occt;
    let s = square(&k);
    let rows = &k.face_poles(&s)[0];
    // The corner at (10, 10).
    let n = rows.iter().flatten().position(|p| (*p - DVec3::new(10.0, 10.0, 0.0)).length() < 1e-6).expect("no corner pole") as u32;
    let moved = k.move_face_poles(&s, &[(0, n, DVec3::new(0.0, 0.0, 5.0))]).unwrap();
    let t = k.tessellate(&moved, 0.01).unwrap();
    assert!((highest(&t) - 5.0).abs() < 1e-3, "{}", highest(&t));
    // The edges follow: one of them now climbs to the lifted corner.
    assert!(t.edges.iter().any(|e| e.iter().any(|p| (p[2] as f64 - 5.0).abs() < 1e-3)));
    // The net shows where the point went.
    let after = &k.face_poles(&moved)[0];
    assert!((after.iter().flatten().nth(n as usize).unwrap().z - 5.0).abs() < 1e-9);
}

#[test]
fn a_block_corner_moves_in_every_face_meeting_there() {
    let k = Occt;
    let b = k.box_from_corners(DVec3::ZERO, DVec3::new(10.0, 10.0, 10.0));
    let faces = k.face_poles(&b);
    let top = faces.iter().position(|rows| rows.iter().flatten().all(|p| (p.z - 10.0).abs() < 1e-9)).unwrap();
    let n = faces[top].iter().flatten().position(|p| (*p - DVec3::splat(10.0)).length() < 1e-9).unwrap() as u32;
    let moved = k.move_face_poles(&b, &[(top as u32, n, DVec3::new(0.0, 0.0, 5.0))]).unwrap();
    assert!(k.is_valid(&moved) && !k.is_sheet(&moved), "the block no longer closes");
    let t = k.tessellate(&moved, 0.001).unwrap();
    assert!((highest(&t) - 15.0).abs() < 1e-3, "{}", highest(&t));
    // The top is now the twisted face z = 10 + 5 (x/10)(y/10), and the two sides beside the corner twist with it.
    assert!((t.volume() - 1125.0).abs() < 0.5, "{}", t.volume());
}

#[test]
fn a_point_inside_a_rebuilt_block_face_moves() {
    let k = Occt;
    let b = k.box_from_corners(DVec3::ZERO, DVec3::new(10.0, 10.0, 10.0));
    // Rebuilt with three spans each way, the top face has points inside its edges that move freely.
    let t = k.tessellate(&b, 0.01).unwrap();
    let top = t.face_planes.iter().position(|p| p.as_ref().is_some_and(|p| p.origin[2] > 9.99 && p.normal[2] > 0.99)).unwrap() as u32;
    let (r, _) = k.rebuild_faces(&b, &[top], &FaceRebuild { explicit: true, degree: [3, 3], spans: [3, 3], ..FaceRebuild::default() }).unwrap();
    let rows = &k.face_poles(&r)[top as usize];
    let nv = rows[0].len();
    let inner = (nv + 1) as u32; // row 1, column 1
    let v0 = k.tessellate(&r, 0.001).unwrap().volume();
    let moved = k.move_face_poles(&r, &[(top, inner, DVec3::new(0.0, 0.0, 3.0))]).unwrap();
    assert!(k.is_valid(&moved) && !k.is_sheet(&moved), "the block no longer closes");
    let v = k.tessellate(&moved, 0.001).unwrap().volume();
    assert!(v > v0 + 1.0, "{v0} {v}");
}

#[test]
fn bad_points_are_refused() {
    let k = Occt;
    let s = square(&k);
    assert!(k.move_face_poles(&s, &[(0, 99, DVec3::X)]).is_err());
    assert!(k.move_face_poles(&s, &[(4, 0, DVec3::X)]).is_err());
}

#[test]
fn a_ball_bulges_where_a_point_inside_its_net_moves() {
    let k = Occt;
    let s = k.sphere(DVec3::ZERO, 10.0).unwrap();
    let rows = &k.face_poles(&s)[0];
    let (nu, nv) = (rows.len(), rows[0].len());
    // A point off the seam and the poles: the middle of the net.
    let n = ((nu / 2) * nv + nv / 2) as u32;
    let p = rows[nu / 2][nv / 2];
    let v0 = k.tessellate(&s, 0.001).unwrap().volume();
    let moved = k.move_face_poles(&s, &[(0, n, p.normalize() * 4.0)]).unwrap();
    assert!(k.is_valid(&moved) && !k.is_sheet(&moved), "the ball no longer closes");
    let v = k.tessellate(&moved, 0.001).unwrap().volume();
    assert!(v > v0 + 1.0, "{v0} {v}");
}

#[test]
fn subdividing_doubles_the_spans_and_keeps_the_shape() {
    let k = Occt;
    let b = k.box_from_corners(DVec3::ZERO, DVec3::new(10.0, 10.0, 10.0));
    let t = k.tessellate(&b, 0.01).unwrap();
    let top = t.face_planes.iter().position(|p| p.as_ref().is_some_and(|p| p.origin[2] > 9.99 && p.normal[2] > 0.99)).unwrap() as u32;
    // A flat face: 2 × 2 points (one span each way) becomes 3 × 3, then 5 × 5.
    let once = k.subdivide_faces(&b, &[top]).unwrap();
    let rows = &k.face_poles(&once)[top as usize];
    assert_eq!((rows.len(), rows[0].len()), (3, 3));
    let twice = k.subdivide_faces(&once, &[top]).unwrap();
    let rows = &k.face_poles(&twice)[top as usize];
    assert_eq!((rows.len(), rows[0].len()), (5, 5));
    assert!(k.is_valid(&twice) && !k.is_sheet(&twice));
    assert!((k.tessellate(&twice, 0.001).unwrap().volume() - 1000.0).abs() < 0.01);
    // A ball keeps its shape too.
    let s = k.sphere(DVec3::ZERO, 10.0).unwrap();
    let before = k.face_poles(&s)[0].len() * k.face_poles(&s)[0][0].len();
    let sub = k.subdivide_faces(&s, &[0]).unwrap();
    assert!(k.face_poles(&sub)[0].len() * k.face_poles(&sub)[0][0].len() > before);
    let v = k.tessellate(&sub, 0.001).unwrap().volume();
    assert!((v - 4.0 / 3.0 * std::f64::consts::PI * 1000.0).abs() < 2.0, "{v}");
    assert!(k.subdivide_faces(&b, &[9]).is_err());
}
