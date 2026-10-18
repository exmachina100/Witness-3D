//! Dimension's sizes: what each face lies on (plane, cylinder, sphere) with its radius, and whether
//! a round face is a boss or a hole. Units are mm.

#![cfg(feature = "occt")]

use glam::DVec3;
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

#[test]
fn faces_report_their_surfaces() {
    let k = Occt;
    let block = k.box_from_corners(DVec3::ZERO, DVec3::new(100.0, 40.0, 100.0));
    let ball = k.sphere(DVec3::new(50.0, 40.0, 50.0), 15.0).unwrap();
    let dimpled = k.boolean(&block, &ball, BooleanOp::Difference).unwrap().solid;
    let all = k.face_surfaces(&dimpled);
    assert_eq!(all.len(), k.face_count(&dimpled));
    let planes = all.iter().filter(|f| matches!(f, FaceSurface::Plane { .. })).count();
    assert_eq!(planes, 6);
    let dimple = all.iter().find_map(|f| match f { FaceSurface::Sphere { centre, radius, outward } => Some((*centre, *radius, *outward)), _ => None }).unwrap();
    assert!((dimple.0 - DVec3::new(50.0, 40.0, 50.0)).length() < 1e-9 && (dimple.1 - 15.0).abs() < 1e-9);
    assert!(!dimple.2, "a dimple is a hole");
    let top = all.iter().find_map(|f| match f { FaceSurface::Plane { origin, normal } if normal.y > 0.99 => Some(*origin), _ => None }).unwrap();
    assert!((top.y - 40.0).abs() < 1e-9, "the top's normal points out");
    let ball_faces = k.face_surfaces(&ball);
    assert!(matches!(ball_faces[0], FaceSurface::Sphere { outward: true, .. }));
}

#[test]
fn a_boss_and_a_hole_are_told_apart() {
    let k = Occt;
    let frame = |o: DVec3| Frame::new(o, DVec3::X, DVec3::Y);
    let post = solids::primitive(&k, &solids::Primitive::Cylinder { frame: frame(DVec3::ZERO), radius: 10.0, height: 30.0 }).unwrap();
    let block = k.box_from_corners(DVec3::new(-30.0, 0.0, -30.0), DVec3::new(30.0, 20.0, 30.0));
    let holed = k.boolean(&block, &post, BooleanOp::Difference).unwrap().solid;
    let round = |s| k.face_surfaces(s).into_iter().find_map(|f| match f { FaceSurface::Cylinder { radius, outward, axis, .. } => Some((radius, outward, axis)), _ => None }).unwrap();
    let (r, out, axis) = round(&post);
    assert!((r - 10.0).abs() < 1e-9 && out && axis.cross(DVec3::Y).length() < 1e-9);
    let (r, out, _) = round(&holed);
    assert!((r - 10.0).abs() < 1e-9 && !out, "the hole's wall faces its axis");
}
