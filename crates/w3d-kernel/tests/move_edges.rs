//! Move Edge: edges of a solid moved and turned with G and R, the flat faces beside them tilting.
#![cfg(feature = "occt")]

use glam::DVec3;
use w3d_kernel::document::Document;
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

fn volume(k: &Occt, s: &<Occt as Kernel>::Solid) -> f64 { k.tessellate(s, 0.001).unwrap().volume() }

/// The edge of `s` all of whose points `test` holds for.
fn edge_where(k: &Occt, s: &<Occt as Kernel>::Solid, test: impl Fn(DVec3) -> bool) -> u32 {
    let t = k.tessellate(s, 0.1).unwrap();
    t.edges.iter().position(|e| !e.is_empty() && e.iter().all(|p| test(DVec3::from(*p)))).unwrap() as u32
}

fn near(a: f64, b: f64) -> bool { (a - b).abs() < 1e-6 }

#[test]
fn a_top_edge_moved_up_tilts_the_top_and_the_front() {
    let mut doc = Document::new(Occt);
    let b = doc.add(doc.kernel.box_from_corners(DVec3::ZERO, DVec3::splat(20.0)));
    let e = edge_where(&doc.kernel, doc.get(b).unwrap(), |p| near(p.y, 20.0) && near(p.z, 20.0));
    doc.commit_move_edges(b, &[e], &Motion::translation(DVec3::new(0.0, 10.0, 0.0))).unwrap();
    let s = doc.get(b).unwrap();
    // A 20 × 20 square with a 20 × 10 triangle on top, 20 deep.
    assert!((volume(&doc.kernel, s) - 500.0 * 20.0).abs() < 1e-6, "{}", volume(&doc.kernel, s));
    assert_eq!(doc.kernel.face_count(s), 6);
    // The edge keeps its number: moved back down, the block is square again.
    doc.commit_move_edges(b, &[e], &Motion::translation(DVec3::new(0.0, -10.0, 0.0))).unwrap();
    assert!((volume(&doc.kernel, doc.get(b).unwrap()) - 8000.0).abs() < 1e-6);
}

#[test]
fn a_top_edge_moved_out_keeps_the_top_flat_and_leans_the_front() {
    let mut doc = Document::new(Occt);
    let b = doc.add(doc.kernel.box_from_corners(DVec3::ZERO, DVec3::splat(20.0)));
    let e = edge_where(&doc.kernel, doc.get(b).unwrap(), |p| near(p.y, 20.0) && near(p.z, 20.0));
    doc.commit_move_edges(b, &[e], &Motion::translation(DVec3::new(0.0, 0.0, 5.0))).unwrap();
    let s = doc.get(b).unwrap();
    assert!((volume(&doc.kernel, s) - 450.0 * 20.0).abs() < 1e-6, "{}", volume(&doc.kernel, s));
}

#[test]
fn an_edge_turned_about_the_middle_twists_nothing_it_cannot() {
    let mut doc = Document::new(Occt);
    let b = doc.add(doc.kernel.box_from_corners(DVec3::ZERO, DVec3::splat(20.0)));
    let e = edge_where(&doc.kernel, doc.get(b).unwrap(), |p| near(p.y, 20.0) && near(p.z, 20.0));
    // Turned about the edge's own line it stays put.
    let along = Motion::rotation(DVec3::new(10.0, 20.0, 20.0), DVec3::X, 0.3);
    let s = doc.preview_move_edges(b, &[e], &along).unwrap().solid;
    assert!((volume(&doc.kernel, &s) - 8000.0).abs() < 1e-6);
    // Turned about the vertical through its middle, its ends leave the sides' planes, which can't bend.
    let err = doc.preview_move_edges(b, &[e], &Motion::rotation(DVec3::new(10.0, 20.0, 20.0), DVec3::Y, 0.3)).err().unwrap();
    assert!(format!("{err:?}").contains("bend"), "{err:?}");
    // Along itself its ends leave the sides too.
    assert!(doc.preview_move_edges(b, &[e], &Motion::translation(DVec3::new(5.0, 0.0, 0.0))).is_err());
    assert!(doc.preview_move_edges(b, &[e], &Motion::scaling(DVec3::ZERO, 2.0)).is_err());
}

#[test]
fn two_top_edges_moved_up_make_a_ridge() {
    let mut doc = Document::new(Occt);
    let b = doc.add(doc.kernel.box_from_corners(DVec3::ZERO, DVec3::splat(20.0)));
    let s = doc.get(b).unwrap();
    let front = edge_where(&doc.kernel, s, |p| near(p.y, 20.0) && near(p.z, 20.0));
    let back = edge_where(&doc.kernel, s, |p| near(p.y, 20.0) && near(p.z, 0.0));
    // Both top edges up: the whole top rises.
    doc.commit_move_edges(b, &[front, back], &Motion::translation(DVec3::new(0.0, 6.0, 0.0))).unwrap();
    assert!((volume(&doc.kernel, doc.get(b).unwrap()) - 20.0 * 20.0 * 26.0).abs() < 1e-6);
}

#[test]
fn a_cylinder_top_rim_moved_up_makes_it_taller() {
    let k = Occt;
    let post = solids::primitive(&k, &solids::Primitive::Cylinder { frame: Frame::new(DVec3::ZERO, DVec3::X, DVec3::Y), radius: 5.0, height: 10.0 }).unwrap();
    let mut doc = Document::new(Occt);
    let b = doc.add(post);
    // Its axis is y: the top rim is the closed edge at y = 10.
    let rim = edge_where(&doc.kernel, doc.get(b).unwrap(), |p| near(p.y, 10.0));
    doc.commit_move_edges(b, &[rim], &Motion::translation(DVec3::new(0.0, 5.0, 0.0))).unwrap();
    let v = volume(&doc.kernel, doc.get(b).unwrap());
    let tall = solids::primitive(&k, &solids::Primitive::Cylinder { frame: Frame::new(DVec3::ZERO, DVec3::X, DVec3::Y), radius: 5.0, height: 15.0 }).unwrap();
    assert!((v - volume(&k, &tall)).abs() < 1e-3, "{v}");
}
