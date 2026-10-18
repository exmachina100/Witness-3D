//! Match Face (Plasticity's Match Face): faces of a solid replaced by another face's surface, the
//! body grown out to it or cut back to it. Units are mm.

#![cfg(feature = "occt")]

use glam::DVec3;
use opencascade::primitives::Shape;
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

fn square(k: &Occt, x0: f64, y0: f64, size: f64, z: f64) -> Shape {
    let c = [DVec3::new(x0, y0, z), DVec3::new(x0 + size, y0, z), DVec3::new(x0 + size, y0 + size, z), DVec3::new(x0, y0 + size, z)];
    k.patch(&[Path::Polyline { points: c.to_vec(), closed: true }], &[]).unwrap()
}

fn edge_where(k: &Occt, s: &Shape, on: impl Fn(&[f64; 3]) -> bool) -> u32 {
    let t = k.tessellate(s, 0.01).unwrap();
    t.edges.iter().position(|e| e.iter().all(&on)).expect("no such edge") as u32
}

/// The flat face of `s` whose plane is at height `z` facing up or down.
fn face_at(k: &Occt, s: &Shape, z: f64) -> u32 {
    let t = k.tessellate(s, 0.01).unwrap();
    t.face_planes.iter().position(|p| p.as_ref().is_some_and(|p| (p.origin.z - z).abs() < 1e-9 && p.normal.z.abs() > 0.99)).expect("no such face") as u32
}

fn volume(k: &Occt, s: &Shape) -> f64 { k.tessellate(s, 0.001).unwrap().volume() }

#[test]
fn a_top_face_grows_up_to_a_sheet_above_it() {
    let k = Occt;
    let b = k.box_from_corners(DVec3::ZERO, DVec3::splat(10.0));
    // A sheet smaller than the face: it is carried on past its edges.
    let sheet = square(&k, 3.0, 3.0, 4.0, 15.0);
    let r = k.match_faces(&b, &[face_at(&k, &b, 10.0)], &sheet, 0, &[]).unwrap();
    assert!(k.is_valid(&r));
    assert!((volume(&k, &r) - 1500.0).abs() < 1e-6, "volume {}", volume(&k, &r));
    assert_eq!(k.face_count(&r), 6, "still a box");
}

#[test]
fn a_top_face_is_cut_back_to_a_sheet_inside_the_body() {
    let k = Occt;
    let b = k.box_from_corners(DVec3::ZERO, DVec3::splat(10.0));
    let sheet = square(&k, -5.0, -5.0, 20.0, 7.0);
    let r = k.match_faces(&b, &[face_at(&k, &b, 10.0)], &sheet, 0, &[]).unwrap();
    assert!((volume(&k, &r) - 700.0).abs() < 1e-6, "volume {}", volume(&k, &r));
    // The bottom face matched to the same sheet keeps what lies above it.
    let r = k.match_faces(&b, &[face_at(&k, &b, 0.0)], &sheet, 0, &[]).unwrap();
    assert!((volume(&k, &r) - 300.0).abs() < 1e-6, "volume {}", volume(&k, &r));
}

#[test]
fn a_face_takes_the_shape_of_a_curved_sheet() {
    let k = Occt;
    // The S-bend from z = 0 at x = 10 to z = 5 at x = 20; a block under it, x 10..20, y 0..10, z -10..-2.
    let (a, c) = (square(&k, 0.0, 0.0, 10.0, 0.0), square(&k, 20.0, 0.0, 10.0, 5.0));
    let ea = edge_where(&k, &a, |p| (p[0] - 10.0).abs() < 1e-9);
    let ec = edge_where(&k, &c, |p| (p[0] - 20.0).abs() < 1e-9);
    let bend = k.bridge_surface((&a, ea), (&c, ec), false, 1.0).unwrap();
    let b = k.box_from_corners(DVec3::new(10.0, 0.0, -10.0), DVec3::new(20.0, 10.0, -2.0));
    let r = k.match_faces(&b, &[face_at(&k, &b, -2.0)], &bend, 0, &[]).unwrap();
    assert!(k.is_valid(&r));
    // The bend is point-symmetric about its middle (z 2.5), so the block averages 12.5 tall.
    let v = volume(&k, &r);
    assert!((v - 1250.0).abs() < 0.5, "volume {v}");
}

#[test]
fn a_surface_along_the_face_or_missing_it_is_refused() {
    let k = Occt;
    let b = k.box_from_corners(DVec3::ZERO, DVec3::splat(10.0));
    let top = face_at(&k, &b, 10.0);
    // The box's own side face stands square to the top: it runs along the top's normal.
    let side = (0..6).find(|&f| f != top && k.tessellate(&b, 0.01).unwrap().face_planes[f as usize].as_ref().is_some_and(|p| p.normal.x.abs() > 0.99)).unwrap();
    assert!(k.match_faces(&b, &[top], &b, side, &[]).is_err());
    let sheet = square(&k, 0.0, 0.0, 10.0, 15.0);
    assert!(k.match_faces(&sheet, &[0], &b, top, &[]).is_err(), "a sheet has no inside to grow");
}

/// A 20 × 20 × 10 block with a 10 × 10 pocket 6 deep in its top: the pocket's floor is at z = 4.
fn pocketed(k: &Occt) -> Shape {
    let b = k.box_from_corners(DVec3::ZERO, DVec3::new(20.0, 20.0, 10.0));
    let pocket = k.box_from_corners(DVec3::new(5.0, 5.0, 4.0), DVec3::new(15.0, 15.0, 11.0));
    k.boolean(&b, &pocket, BooleanOp::Difference).unwrap().solid
}

#[test]
fn grow_decides_what_a_pocket_floor_does_past_the_top() {
    let k = Occt;
    let s = pocketed(&k);
    let floor = face_at(&k, &s, 4.0);
    let above = square(&k, -10.0, -10.0, 40.0, 13.0);
    let run = |grow| volume(&k, &match_faces_grow(&k, &s, &[floor], &above, 0, grow, None).unwrap());
    // None: the floor rises through the pocket and on past the top, a 10 × 10 × 3 boss.
    assert!((run(Grow::None) - 4300.0).abs() < 1e-6, "none {}", run(Grow::None));
    // Fixed: it stops at the top, filling the pocket.
    assert!((run(Grow::Fixed) - 4000.0).abs() < 1e-6, "fixed {}", run(Grow::Fixed));
    // Moving: the top goes up with it.
    assert!((run(Grow::Moving) - 5200.0).abs() < 1e-6, "moving {}", run(Grow::Moving));
    // Short of the top all three are the same.
    let inside = square(&k, -10.0, -10.0, 40.0, 8.0);
    for grow in [Grow::None, Grow::Fixed, Grow::Moving] {
        let v = volume(&k, &match_faces_grow(&k, &s, &[floor], &inside, 0, grow, None).unwrap());
        assert!((v - 3800.0).abs() < 1e-6, "{grow:?} {v}");
    }
}
