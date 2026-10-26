//! Move Face: faces moved and turned with G and R, the faces round them following.
#![cfg(feature = "occt")]

use glam::DVec3;
use w3d_kernel::document::Document;
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

fn volume(k: &Occt, s: &<Occt as Kernel>::Solid) -> f64 { k.tessellate(s, 0.001).unwrap().volume() }

/// The flat face of `s` facing `n`.
fn facing(k: &Occt, s: &<Occt as Kernel>::Solid, n: DVec3) -> u32 {
    let t = k.tessellate(s, 0.1).unwrap();
    t.face_planes.iter().position(|p| p.map_or(false, |p| p.normal.dot(n) > 1.0 - 1e-9)).unwrap() as u32
}

fn reach(k: &Occt, s: &<Occt as Kernel>::Solid, d: DVec3) -> f64 {
    k.tessellate(s, 0.01).unwrap().positions.iter().map(|p| DVec3::from(*p).dot(d)).fold(f64::MIN, f64::max)
}

#[test]
fn a_top_moved_up_and_along_itself_makes_the_block_taller() {
    let mut doc = Document::new(Occt);
    let b = doc.add(doc.kernel.box_from_corners(DVec3::ZERO, DVec3::splat(20.0)));
    let top = facing(&doc.kernel, doc.get(b).unwrap(), DVec3::Y);
    // Along itself the top looks the same; only the 10 up counts.
    doc.commit_move_faces(b, &[top], &Motion::translation(DVec3::new(5.0, 10.0, -3.0))).unwrap();
    let s = doc.get(b).unwrap();
    assert!((volume(&doc.kernel, s) - 20.0 * 20.0 * 30.0).abs() < 1e-6, "{}", volume(&doc.kernel, s));
    assert_eq!(doc.kernel.face_count(s), 6);
    assert!((reach(&doc.kernel, s, DVec3::X) - 20.0).abs() < 1e-9, "the sides stay where they were");
    // The face keeps its number: moved again, down below where it started.
    doc.commit_move_faces(b, &[top], &Motion::translation(DVec3::new(0.0, -15.0, 0.0))).unwrap();
    assert!((volume(&doc.kernel, doc.get(b).unwrap()) - 20.0 * 20.0 * 15.0).abs() < 1e-6);
}

#[test]
fn a_top_turned_about_an_edge_leans_and_its_sides_follow() {
    let mut doc = Document::new(Occt);
    let b = doc.add(doc.kernel.box_from_corners(DVec3::ZERO, DVec3::splat(20.0)));
    let top = facing(&doc.kernel, doc.get(b).unwrap(), DVec3::Y);
    let a = 10f64.to_radians();
    doc.commit_move_faces(b, &[top], &Motion::rotation(DVec3::new(0.0, 20.0, 0.0), DVec3::Z, a)).unwrap();
    let s = doc.get(b).unwrap();
    let want = 8000.0 + 0.5 * 20.0 * 20.0 * a.tan() * 20.0;
    assert!((volume(&doc.kernel, s) - want).abs() < 1e-3, "{} vs {want}", volume(&doc.kernel, s));
    assert!((reach(&doc.kernel, s, DVec3::Y) - (20.0 + 20.0 * a.tan())).abs() < 1e-6);
}

#[test]
fn a_boss_side_moved_across_the_block_takes_the_boss_along() {
    let k = Occt;
    let post = solids::primitive(&k, &solids::Primitive::Cylinder { frame: Frame::new(DVec3::new(0.0, 20.0, 0.0), DVec3::X, DVec3::Y), radius: 5.0, height: 10.0 }).unwrap();
    let block = k.box_from_corners(DVec3::new(-30.0, 0.0, -30.0), DVec3::new(30.0, 20.0, 30.0));
    let mut doc = Document::new(Occt);
    let b = doc.add(k.boolean(&block, &post, BooleanOp::Union).unwrap().solid);
    let before = volume(&doc.kernel, doc.get(b).unwrap());
    let side = doc.kernel.face_surfaces(doc.get(b).unwrap()).iter().position(|f| matches!(f, FaceSurface::Cylinder { .. })).unwrap() as u32;
    doc.commit_move_faces(b, &[side], &Motion::translation(DVec3::new(12.0, 0.0, 0.0))).unwrap();
    let s = doc.get(b).unwrap();
    assert!((volume(&doc.kernel, s) - before).abs() < 0.05, "{} vs {before}", volume(&doc.kernel, s));
    // The boss now stands round x = 12: its top reaches x = 17 above the block.
    let top: Vec<f64> = doc.kernel.tessellate(s, 0.01).unwrap().positions.iter().filter(|p| p[1] > 25.0).map(|p| p[0]).collect();
    let (lo, hi) = top.iter().fold((f64::MAX, f64::MIN), |(a, b), &x| (a.min(x), b.max(x)));
    assert!((lo - 7.0).abs() < 0.01 && (hi - 17.0).abs() < 0.01, "{lo} {hi}");
    // Moved up its own axis it slides along itself: no change.
    let s2 = doc.preview_move_faces(b, &[side], &Motion::translation(DVec3::new(0.0, 3.0, 0.0))).unwrap().solid;
    assert!((volume(&doc.kernel, &s2) - before).abs() < 0.05);
}

#[test]
fn a_moved_body_and_refused_moves() {
    let mut doc = Document::new(Occt);
    let b = doc.add(doc.kernel.box_from_corners(DVec3::ZERO, DVec3::splat(20.0)));
    doc.commit_motion(&[b], &Motion::translation(DVec3::new(100.0, 0.0, 0.0))).unwrap();
    let top = facing(&doc.kernel, doc.get(b).unwrap(), DVec3::Y);
    doc.commit_move_faces(b, &[top], &Motion::translation(DVec3::new(0.0, 5.0, 0.0))).unwrap();
    assert!((volume(&doc.kernel, doc.get(b).unwrap()) - 20.0 * 20.0 * 25.0).abs() < 1e-6);
    // Through the bottom turns the block inside out; scaling a face is not a move.
    assert!(doc.preview_move_faces(b, &[top], &Motion::translation(DVec3::new(0.0, -30.0, 0.0))).is_err());
    assert!(doc.preview_move_faces(b, &[top], &Motion::scaling(DVec3::ZERO, 2.0)).is_err());
}

#[test]
fn a_hole_wall_moved_moves_the_hole() {
    let k = Occt;
    let drill = solids::primitive(&k, &solids::Primitive::Cylinder { frame: Frame::new(DVec3::new(0.0, -1.0, 0.0), DVec3::X, DVec3::Y), radius: 4.0, height: 30.0 }).unwrap();
    let block = k.box_from_corners(DVec3::new(-20.0, 0.0, -20.0), DVec3::new(20.0, 10.0, 20.0));
    let mut doc = Document::new(Occt);
    let b = doc.add(k.boolean(&block, &drill, BooleanOp::Difference).unwrap().solid);
    let before = volume(&doc.kernel, doc.get(b).unwrap());
    let wall = doc.kernel.face_surfaces(doc.get(b).unwrap()).iter().position(|f| matches!(f, FaceSurface::Cylinder { .. })).unwrap() as u32;
    doc.commit_move_faces(b, &[wall], &Motion::translation(DVec3::new(0.0, 0.0, 9.0))).unwrap();
    let s = doc.get(b).unwrap();
    assert!((volume(&doc.kernel, s) - before).abs() < 0.05);
    // The hole's wall now runs round z = 9.
    let FaceSurface::Cylinder { origin, .. } = doc.kernel.face_surfaces(s)[wall as usize] else { panic!("the wall is still round") };
    assert!((origin.z - 9.0).abs() < 1e-9 && origin.x.abs() < 1e-9);
}

#[test]
fn a_side_turned_about_its_bottom_edge_leans_out() {
    // The +x side turned 20° about the bottom edge it stands on: the top and bottom stretch to it.
    let mut doc = Document::new(Occt);
    let b = doc.add(doc.kernel.box_from_corners(DVec3::ZERO, DVec3::new(20.0, 10.0, 10.0)));
    let side = facing(&doc.kernel, doc.get(b).unwrap(), DVec3::X);
    let a = 20f64.to_radians();
    doc.commit_move_faces(b, &[side], &Motion::rotation(DVec3::new(20.0, 0.0, 0.0), DVec3::Z, -a)).unwrap();
    let s = doc.get(b).unwrap();
    let want = 2000.0 + 0.5 * 10.0 * 10.0 * a.tan() * 10.0;
    assert!((volume(&doc.kernel, s) - want).abs() < 1e-3, "{} vs {want}", volume(&doc.kernel, s));
}

#[test]
fn a_face_with_a_round_beside_it_is_refused_with_a_reason() {
    let k = Occt;
    let block = k.box_from_corners(DVec3::ZERO, DVec3::splat(20.0));
    let t = k.tessellate(&block, 0.1).unwrap();
    // Round one edge of the top.
    let edge = (0..t.edges.len() as u32).find(|&e| t.edges[e as usize].iter().all(|p| (p[1] - 20.0).abs() < 1e-9 && p[0].abs() < 1e-9)).unwrap();
    let rounded = k.blend(&block, &[edge], 3.0, Blend::Fillet, 0.0, &[]).unwrap().solid;
    let top = facing(&k, &rounded, DVec3::Y);
    let mut doc = Document::new(Occt);
    let b = doc.add(rounded);
    let err = doc.preview_move_faces(b, &[top], &Motion::translation(DVec3::new(0.0, 4.0, 0.0))).err().unwrap();
    assert!(format!("{err:?}").contains("fillet") || format!("{err:?}").contains("smoothly"), "{err:?}");
}

/// Draft Face's Curve taper turns a face about a line on it with Move Face; about a line square to
/// the pull it must match the neutral-plane draft through that line. The axis is the line turned so
/// that (line × face normal) · pull > 0, as web/src/app/App.js draftHinge does.
#[test]
fn a_face_turned_about_a_line_on_it_matches_the_draft_through_that_line() {
    let mut doc = Document::new(Occt);
    let b = doc.add(doc.kernel.box_from_corners(DVec3::ZERO, DVec3::splat(20.0)));
    let side = facing(&doc.kernel, doc.get(b).unwrap(), DVec3::X);
    let a = 5f64.to_radians();
    let p = DVec3::new(20.0, 5.0, 0.0);
    let drafted = doc.preview_draft(b, &[side], DVec3::Y, p, a, Grow::None).unwrap().solid;
    let (d, n) = (DVec3::Z, DVec3::X);
    let axis = if d.cross(n).dot(DVec3::Y) > 0.0 { d } else { -d };
    let turned = doc.preview_move_faces(b, &[side], &Motion::rotation(p, axis, a)).unwrap().solid;
    let (vd, vt) = (volume(&doc.kernel, &drafted), volume(&doc.kernel, &turned));
    assert!((vd - vt).abs() < 1e-6, "draft {vd} turn {vt}");
    assert!((vd - 8000.0).abs() > 1.0);
}
