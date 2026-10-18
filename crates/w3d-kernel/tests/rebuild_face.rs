//! Rebuild Face (Plasticity's Rebuild on faces): each face given a new polynomial B-spline surface,
//! by explicit degree and spans or by tolerance, its edges and trims kept. Units are mm.

#![cfg(feature = "occt")]

use std::f64::consts::PI;

use glam::DVec3;
use opencascade::primitives::Shape;
use w3d_kernel::occt::Occt;
use w3d_kernel::solids::primitive;
use w3d_kernel::*;

fn square(k: &Occt, x0: f64, z: f64) -> Shape {
    let c = [DVec3::new(x0, 0.0, z), DVec3::new(x0 + 10.0, 0.0, z), DVec3::new(x0 + 10.0, 10.0, z), DVec3::new(x0, 10.0, z)];
    k.patch(&[Path::Polyline { points: c.to_vec(), closed: true }], &[]).unwrap()
}

fn edge_where(k: &Occt, s: &Shape, on: impl Fn(&[f64; 3]) -> bool) -> u32 {
    let t = k.tessellate(s, 0.01).unwrap();
    t.edges.iter().position(|e| e.iter().all(&on)).expect("no such edge") as u32
}

fn area(t: &Tessellation) -> f64 {
    t.indices.chunks_exact(3).map(|i| {
        let [a, b, c] = [0, 1, 2].map(|k| DVec3::from(t.positions[i[k] as usize]));
        (b - a).cross(c - a).length() / 2.0
    }).sum()
}

/// A sheet bridging two squares: one curved B-spline face.
fn bridge(k: &Occt) -> Shape {
    let (a, b) = (square(k, 0.0, 0.0), square(k, 20.0, 5.0));
    let ea = edge_where(k, &a, |p| (p[0] - 10.0).abs() < 1e-9);
    let eb = edge_where(k, &b, |p| (p[0] - 20.0).abs() < 1e-9);
    k.bridge_surface((&a, ea), (&b, eb), false, 1.0).unwrap()
}

fn curved_faces(k: &Occt, s: &Shape) -> Vec<u32> {
    let t = k.tessellate(s, 0.01).unwrap();
    (0..t.face_planes.len() as u32).filter(|&f| t.face_planes[f as usize].is_none()).collect()
}

fn explicit(degree: [u32; 2], spans: [u32; 2]) -> FaceRebuild {
    FaceRebuild { explicit: true, degree, spans, ..FaceRebuild::default() }
}

#[test]
fn explicit_control_sets_the_degree_and_spans() {
    let k = Occt;
    let s = bridge(&k);
    let before = area(&k.tessellate(&s, 0.001).unwrap());
    let (r, info) = k.rebuild_faces(&s, &[0], &explicit([3, 2], [4, 3])).unwrap();
    assert!(k.is_valid(&r) && k.is_sheet(&r));
    assert_eq!((k.face_count(&r), k.edge_count(&r)), (k.face_count(&s), k.edge_count(&s)));
    assert_eq!(info.len(), 1);
    assert_eq!(info[0].degree, [3, 2]);
    assert_eq!(info[0].poles, [7, 5], "spans + degree poles each way");
    assert!(info[0].deviation < 0.05, "deviation {}", info[0].deviation);
    let after = area(&k.tessellate(&r, 0.001).unwrap());
    assert!((after - before).abs() < 0.001 * before, "area {before} -> {after}");
    // Degree 1, one span: the bilinear sheet through the four corners.
    let (flat, info) = k.rebuild_faces(&s, &[0], &explicit([1, 1], [1, 1])).unwrap();
    assert!(k.is_valid(&flat));
    assert_eq!(info[0].poles, [2, 2]);
    assert!(info[0].deviation > 0.1, "a bilinear sheet can't follow the S-bend: {}", info[0].deviation);
}

#[test]
fn tolerance_adds_spans_until_the_face_is_within_it() {
    let k = Occt;
    let s = bridge(&k);
    let tol = |t| FaceRebuild { tolerance: t, ..FaceRebuild::default() };
    let (_, coarse) = k.rebuild_faces(&s, &[0], &tol(0.1)).unwrap();
    let (r, fine) = k.rebuild_faces(&s, &[0], &tol(1e-5)).unwrap();
    assert!(k.is_valid(&r));
    assert!(coarse[0].deviation <= 0.1 && fine[0].deviation <= 1e-5, "{coarse:?} {fine:?}");
    assert!(fine[0].poles[0] >= coarse[0].poles[0], "a tighter tolerance needs as many CVs or more: {coarse:?} {fine:?}");
    assert_eq!(fine[0].degree, [3, 3]);
}

#[test]
fn a_cylinder_wall_rebuilds_across_its_seam_and_the_solid_stays_closed() {
    let k = Occt;
    let ground = Frame::new(DVec3::ZERO, DVec3::X, DVec3::Y);
    let c = primitive(&k, &w3d_kernel::solids::Primitive::Cylinder { frame: ground, radius: 5.0, height: 10.0 }).unwrap();
    let wall = curved_faces(&k, &c);
    assert_eq!(wall.len(), 1);
    let (r, info) = k.rebuild_faces(&c, &wall, &FaceRebuild { tolerance: 0.001, ..FaceRebuild::default() }).unwrap();
    assert!(k.is_valid(&r) && !k.is_sheet(&r), "still a closed solid");
    assert!(info[0].deviation <= 0.001, "{info:?}");
    let v = k.tessellate(&r, 0.001).unwrap().volume();
    assert!((v - PI * 250.0).abs() < 0.5, "volume {v}");
}

#[test]
fn a_sphere_rebuilds_through_its_poles() {
    let k = Occt;
    let s = k.sphere(DVec3::ZERO, 5.0).unwrap();
    let (r, info) = k.rebuild_faces(&s, &[0], &FaceRebuild { tolerance: 0.005, ..FaceRebuild::default() }).unwrap();
    assert!(k.is_valid(&r), "{info:?}");
    assert!(info[0].deviation <= 0.005, "{info:?}");
    let v = k.tessellate(&r, 0.001).unwrap().volume();
    assert!((v - 4.0 / 3.0 * PI * 125.0).abs() < 1.0, "volume {v}");
}

#[test]
fn extend_grows_the_surface_but_not_the_face() {
    let k = Occt;
    let s = bridge(&k);
    let before = area(&k.tessellate(&s, 0.001).unwrap());
    let how = FaceRebuild { explicit: true, degree: [3, 3], spans: [4, 2], extend: [2.0, 1.0], ..FaceRebuild::default() };
    let (r, info) = k.rebuild_faces(&s, &[0], &how).unwrap();
    assert!(k.is_valid(&r));
    let after = area(&k.tessellate(&r, 0.001).unwrap());
    assert!((after - before).abs() < 0.05, "the trim holds: area {before} -> {after}");
    assert!(info[0].deviation < 0.05, "extending keeps the face where it was: {info:?}");
    assert!(info[0].poles[0] > 7 || info[0].poles[1] > 5, "extension adds CVs: {info:?}");
}

#[test]
fn a_trimmed_face_rebuilds_over_its_own_extent_with_shrink() {
    let k = Occt;
    // A filleted box: the round is a trimmed face of a cylinder or B-spline.
    let b = k.box_from_corners(DVec3::ZERO, DVec3::splat(10.0));
    let e = edge_where(&k, &b, |p| p[0].abs() < 1e-9 && p[1].abs() < 1e-9);
    let f = k.blend(&b, &[e], 2.0, Blend::Fillet, 0.0, &[]).unwrap().solid;
    let round = curved_faces(&k, &f);
    assert_eq!(round.len(), 1);
    for shrink in [true, false] {
        let (r, info) = k.rebuild_faces(&f, &round, &FaceRebuild { tolerance: 0.001, shrink, ..FaceRebuild::default() }).unwrap();
        assert!(k.is_valid(&r) && !k.is_sheet(&r), "shrink {shrink}: {info:?}");
        assert!(info[0].deviation <= 0.001, "shrink {shrink}: {info:?}");
        let v = k.tessellate(&r, 0.001).unwrap().volume();
        let want = 1000.0 - (4.0 - PI) * 10.0;
        assert!((v - want).abs() < 0.05, "shrink {shrink}: volume {v} vs {want}");
    }
}

#[test]
fn a_face_with_a_hole_keeps_its_hole() {
    let k = Occt;
    let b = k.box_from_corners(DVec3::ZERO, DVec3::splat(10.0));
    let frame = Frame::new(DVec3::splat(5.0), DVec3::X, DVec3::Y);
    let hole = primitive(&k, &w3d_kernel::solids::Primitive::Cylinder { frame, radius: 2.0, height: 10.0 }).unwrap();
    let s = k.boolean(&b, &hole, BooleanOp::Difference).unwrap().solid;
    let t = k.tessellate(&s, 0.01).unwrap();
    let top = t.face_planes.iter().position(|p| p.as_ref().is_some_and(|p| (p.origin.z - 10.0).abs() < 1e-9 && p.normal.z.abs() > 0.99)).unwrap() as u32;
    let (r, info) = k.rebuild_faces(&s, &[top], &FaceRebuild { tolerance: 0.001, ..FaceRebuild::default() }).unwrap();
    assert!(k.is_valid(&r) && !k.is_sheet(&r));
    assert!(info[0].deviation <= 0.001, "{info:?}");
    assert_eq!(k.face_count(&r), k.face_count(&s));
    let (a, b) = (k.tessellate(&r, 0.001).unwrap().volume(), k.tessellate(&s, 0.001).unwrap().volume());
    assert!((a - b).abs() < 0.01, "volume {b} -> {a}");
}

#[test]
fn bad_settings_are_refused_and_leave_the_body_alone() {
    let k = Occt;
    let s = bridge(&k);
    assert!(k.rebuild_faces(&s, &[0], &explicit([0, 3], [4, 4])).is_err());
    assert!(k.rebuild_faces(&s, &[0], &explicit([3, 3], [0, 4])).is_err());
    assert!(k.rebuild_faces(&s, &[0], &FaceRebuild { tolerance: 0.0, ..FaceRebuild::default() }).is_err());
    assert!(k.rebuild_faces(&s, &[5], &FaceRebuild::default()).is_err());
    assert!(k.is_valid(&s));
}

#[test]
fn raise_degree_adds_a_row_and_column_without_moving_the_face() {
    let k = Occt;
    let s = bridge(&k);
    let (_, before) = k.rebuild_faces(&s, &[0], &explicit([3, 3], [2, 2])).unwrap();
    let (r, info) = k.raise_faces(&k.rebuild_faces(&s, &[0], &explicit([3, 3], [2, 2])).unwrap().0, &[0]).unwrap();
    assert!(k.is_valid(&r));
    assert_eq!(info[0].degree, [4, 4]);
    assert!(info[0].poles[0] > before[0].poles[0] && info[0].poles[1] > before[0].poles[1], "more CVs each way: {before:?} -> {info:?}");
    assert!(info[0].deviation < 1e-9, "raising is exact: {info:?}");
}

#[test]
fn raise_degree_on_a_solid_fits_its_flat_and_round_faces_first() {
    let k = Occt;
    let ground = Frame::new(DVec3::ZERO, DVec3::X, DVec3::Y);
    let c = primitive(&k, &w3d_kernel::solids::Primitive::Cylinder { frame: ground, radius: 5.0, height: 10.0 }).unwrap();
    let all: Vec<u32> = (0..k.face_count(&c) as u32).collect();
    let (r, info) = k.raise_faces(&c, &all).unwrap();
    assert!(k.is_valid(&r) && !k.is_sheet(&r));
    assert_eq!(k.face_count(&r), k.face_count(&c));
    assert!(info.iter().all(|f| f.degree == [4, 4] && f.deviation <= 1e-3), "{info:?}");
    let v = k.tessellate(&r, 0.001).unwrap().volume();
    assert!((v - PI * 250.0).abs() < 0.5, "volume {v}");
}
