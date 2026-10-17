//! Thicken Face (Plasticity's): faces of a body copied out and made a solid of their own, front
//! along their normals (out of the body) and back behind them; the body stays. Units are mm.

#![cfg(feature = "occt")]

use glam::DVec3;
use w3d_kernel::document::Document;
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

/// The face of `s` whose outward normal is `n`.
fn face_facing(k: &Occt, s: &<Occt as Kernel>::Solid, n: DVec3) -> u32 {
    let t = k.tessellate(s, 0.01).unwrap();
    t.face_planes.iter().position(|p| p.map_or(false, |p| p.normal.dot(n) > 0.999)).unwrap() as u32
}

fn range(t: &Tessellation, axis: usize) -> (f64, f64) {
    t.positions.iter().fold((f64::MAX, f64::MIN), |(lo, hi), p| (lo.min(p[axis]), hi.max(p[axis])))
}

#[test]
fn a_box_top_becomes_a_slab_on_it_and_the_box_stays() {
    let mut doc = Document::new(Occt);
    let block = doc.add(doc.kernel.box_from_corners(DVec3::ZERO, DVec3::new(10.0, 20.0, 30.0)));
    let top = face_facing(&doc.kernel, doc.get(block).unwrap(), DVec3::Z);
    doc.clear_history();
    let slab = doc.commit_thicken_faces(block, &[top], 2.0, 0.5).unwrap();
    assert_ne!(slab, block, "a new body");
    let t = doc.kernel.tessellate(doc.get(slab).unwrap(), 0.001).unwrap();
    assert!((t.volume() - 10.0 * 20.0 * 2.5).abs() < 1e-6, "volume {}", t.volume());
    let (lo, hi) = range(&t, 2);
    assert!((lo - 29.5).abs() < 1e-6 && (hi - 32.0).abs() < 1e-6, "z {lo}..{hi}");
    let v = doc.kernel.tessellate(doc.get(block).unwrap(), 0.001).unwrap().volume();
    assert!((v - 6000.0).abs() < 1e-6, "the box is unchanged");
    assert!(doc.undo());
    assert!(doc.get(slab).is_none());
}

#[test]
fn two_faces_meeting_at_an_edge_thicken_into_one_bent_plate() {
    let k = Occt;
    let mut doc = Document::new(Occt);
    let block = doc.add(k.box_from_corners(DVec3::ZERO, DVec3::splat(10.0)));
    let s = doc.get(block).unwrap();
    let (top, side) = (face_facing(&k, s, DVec3::Z), face_facing(&k, s, DVec3::X));
    let plate = doc.preview_thicken_faces(block, &[top, side], 1.0, 0.0).unwrap();
    assert!(k.is_valid(&plate) && !k.is_sheet(&plate));
    // Two 10 × 10 × 1 plates and the 1 × 1 × 10 corner where they meet outside the box.
    let t = k.tessellate(&plate, 0.001).unwrap();
    let v = t.volume();
    assert!((v - 210.0).abs() < 1e-6, "volume {v}");
}

#[test]
fn a_round_face_thickens_evenly_and_bad_picks_are_refused() {
    let k = Occt;
    let mut doc = Document::new(Occt);
    let rod = doc.add(solids::primitive(&k, &Primitive::Cylinder { frame: Frame::new(DVec3::ZERO, DVec3::X, DVec3::Z), radius: 5.0, height: 10.0 }).unwrap());
    let s = doc.get(rod).unwrap();
    let t = k.tessellate(s, 0.01).unwrap();
    let wall = t.face_planes.iter().position(|p| p.is_none()).unwrap() as u32;
    let tube = doc.preview_thicken_faces(rod, &[wall], 1.0, 0.0).unwrap();
    let v = k.tessellate(&tube, 0.0001).unwrap().volume();
    let exact = std::f64::consts::PI * (36.0 - 25.0) * 10.0;
    assert!((v - exact).abs() / exact < 1e-3, "volume {v} vs {exact}");
    assert!(doc.preview_thicken_faces(rod, &[], 1.0, 0.0).is_err());
    assert!(doc.preview_thicken_faces(rod, &[99], 1.0, 0.0).is_err());
    assert!(doc.preview_thicken_faces(rod, &[wall, wall], 1.0, 0.0).is_err());
}

#[test]
fn a_face_of_a_sheet_thickens_on_its_own() {
    let k = Occt;
    let cube = k.box_from_corners(DVec3::ZERO, DVec3::splat(10.0));
    let (top, side) = (face_facing(&k, &cube, DVec3::Z), face_facing(&k, &cube, DVec3::X));
    let pieces = k.unjoin(&cube, true).unwrap();
    let sheet = k.join_sheets(&[&pieces[top as usize], &pieces[side as usize]]).unwrap();
    assert!(k.is_sheet(&sheet));
    let mut doc = Document::new(Occt);
    let id = doc.add(sheet);
    let flat = face_facing(&doc.kernel, doc.get(id).unwrap(), DVec3::Z);
    let slab = doc.commit_thicken_faces(id, &[flat], 1.0, 0.0).unwrap();
    let v = k.tessellate(doc.get(slab).unwrap(), 0.001).unwrap().volume();
    assert!((v - 100.0).abs() < 1e-6, "volume {v}");
    assert!(doc.kernel.is_sheet(doc.get(id).unwrap()), "the sheet stays");
}
