//! Offset Edge on curved faces and across several faces: the picked edges moved a distance across
//! the faces on one side and imprinted there. Units are mm.

#![cfg(feature = "occt")]

use glam::DVec3;
use opencascade::primitives::Shape;
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

const SHEET: f64 = 1e5;

fn offset(k: &Occt, s: &Shape, edges: &[u32], d: f64, side: u32) -> Shape {
    let (faces, tube) = k.offset_edge_tools(s, edges, d, side).unwrap();
    k.imprint(s, &faces, &[], &[&tube], SHEET).unwrap().solid
}

/// The side (0 or 1) whose faces are exactly those for which `want` holds.
fn side_of(k: &Occt, s: &Shape, edges: &[u32], want: impl Fn(&Shape, u32) -> bool) -> u32 {
    (0..2).find(|&side| k.offset_edge_tools(s, edges, 1.0, side).unwrap().0.iter().all(|&f| want(s, f))).unwrap()
}

fn edges_where(k: &Occt, s: &Shape, f: impl Fn(DVec3) -> bool) -> usize {
    k.tessellate(s, 0.01).unwrap().edges.iter().filter(|e| e.iter().all(|p| f(DVec3::from_array(*p)))).count()
}

#[test]
fn the_rim_of_a_dimple_runs_down_the_ball() {
    let k = Occt;
    let b = k.box_from_corners(DVec3::ZERO, DVec3::new(100.0, 100.0, 50.0));
    let ball = k.sphere(DVec3::new(50.0, 50.0, 50.0), 20.0).unwrap();
    let s = k.boolean(&b, &ball, BooleanOp::Difference).unwrap().solid;
    let t = k.tessellate(&s, 0.01).unwrap();
    let centre = DVec3::new(50.0, 50.0, 50.0);
    let rim = t.edges.iter().position(|e| e.iter().all(|p| (p[2] - 50.0).abs() < 1e-6 && ((DVec3::from_array(*p) - centre).length() - 20.0).abs() < 1e-3)).unwrap() as u32;
    let curved = side_of(&k, &s, &[rim], |s, f| k.tessellate(s, 0.01).unwrap().face_planes[f as usize].is_none());
    let out = offset(&k, &s, &[rim], 5.0, curved);
    assert!(k.is_valid(&out));
    assert_eq!(k.face_count(&out), k.face_count(&s) + 1);
    // 5 mm from the rim in space, on the ball: a circle below it.
    let on = edges_where(&k, &out, |p| {
        let flat = DVec3::new(p.x - 50.0, p.y - 50.0, 0.0).length();
        let to_rim = (DVec3::new(flat - 20.0, 0.0, p.z - 50.0)).length();
        ((p - centre).length() - 20.0).abs() < 1e-3 && (to_rim - 5.0).abs() < 1e-3 && p.z < 50.0
    });
    assert_eq!(on, 1, "the offset circle on the ball");
    // The flat side: a ring 5 mm out on the top.
    let flat = 1 - curved;
    let out = offset(&k, &s, &[rim], 5.0, flat);
    assert_eq!(k.face_count(&out), k.face_count(&s) + 1);
    assert_eq!(edges_where(&k, &out, |p| (p.z - 50.0).abs() < 1e-6 && (DVec3::new(p.x - 50.0, p.y - 50.0, 0.0).length() - 25.0).abs() < 1e-3), 1);
}

#[test]
fn a_chain_round_a_corner_offsets_on_three_faces() {
    let k = Occt;
    let s = k.box_from_corners(DVec3::ZERO, DVec3::new(100.0, 80.0, 50.0));
    let t = k.tessellate(&s, 0.01).unwrap();
    let find = |f: &dyn Fn(DVec3) -> bool| t.edges.iter().position(|e| e.iter().all(|p| f(DVec3::from_array(*p)))).unwrap() as u32;
    let front = find(&|p| p.y.abs() < 1e-9 && (p.z - 50.0).abs() < 1e-9);
    let right = find(&|p| (p.x - 100.0).abs() < 1e-9 && (p.z - 50.0).abs() < 1e-9);
    let top = side_of(&k, &s, &[front, right], |s, f| k.tessellate(s, 0.01).unwrap().face_planes[f as usize].as_ref().is_some_and(|p| p.normal.z > 0.99));
    let out = offset(&k, &s, &[front, right], 10.0, top);
    assert!(k.is_valid(&out));
    assert_eq!(k.face_count(&out), 7, "the top split in two");
    assert_eq!(edges_where(&k, &out, |p| (p.y - 10.0).abs() < 1e-6 && (p.z - 50.0).abs() < 1e-6 && p.x <= 90.0 + 1e-6), 1);
    assert_eq!(edges_where(&k, &out, |p| (p.x - 90.0).abs() < 1e-6 && (p.z - 50.0).abs() < 1e-6 && p.y >= 10.0 - 1e-6), 1);
    // Down the sides instead: the front and the right each split.
    let out = offset(&k, &s, &[front, right], 10.0, 1 - top);
    assert!(k.is_valid(&out));
    assert_eq!(k.face_count(&out), 8);
    assert_eq!(edges_where(&k, &out, |p| (p.z - 40.0).abs() < 1e-6), 2);
    // Both sides at once.
    assert_eq!(k.face_count(&offset(&k, &s, &[front, right], 10.0, 2)), 9);
}

#[test]
fn edges_round_a_corner_on_three_sides_are_refused() {
    let k = Occt;
    let s = k.box_from_corners(DVec3::ZERO, DVec3::new(100.0, 80.0, 50.0));
    let t = k.tessellate(&s, 0.01).unwrap();
    let find = |f: &dyn Fn(DVec3) -> bool| t.edges.iter().position(|e| e.iter().all(|p| f(DVec3::from_array(*p)))).unwrap() as u32;
    let a = find(&|p| p.y.abs() < 1e-9 && (p.z - 50.0).abs() < 1e-9);
    let b = find(&|p| (p.x - 100.0).abs() < 1e-9 && (p.z - 50.0).abs() < 1e-9);
    let c = find(&|p| (p.x - 100.0).abs() < 1e-9 && p.y.abs() < 1e-9);
    // Top, front and right each have a picked edge with both others: no one side to offset on.
    assert!(k.offset_edge_tools(&s, &[a, b, c], 5.0, 0).is_err());
}
