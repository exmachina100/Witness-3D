//! Plasticity's Scale along X, Y or Z: a body stretched more one way than another.

#![cfg(feature = "occt")]

use glam::{DMat3, DVec3};
use w3d_kernel::document::Document;
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

#[test]
fn a_block_stretched_along_x_grows_only_that_way() {
    let k = Occt;
    let b = k.box_from_corners(DVec3::ZERO, DVec3::new(10.0, 20.0, 30.0));
    let s = k.stretch(&b, DVec3::ZERO, DMat3::from_diagonal(DVec3::new(2.0, 1.0, 1.0))).unwrap();
    assert!(k.is_valid(&s));
    let v = k.tessellate(&s, 0.01).unwrap().volume();
    assert!((v - 12000.0).abs() < 1e-6, "volume {v}");
    assert_eq!(k.face_count(&s), 6);
}

#[test]
fn a_ball_stretched_along_x_becomes_an_ellipsoid() {
    let k = Occt;
    let c = k.sphere(DVec3::ZERO, 5.0).unwrap();
    let s = k.stretch(&c, DVec3::ZERO, DMat3::from_diagonal(DVec3::new(2.0, 1.0, 1.0))).unwrap();
    assert!(k.is_valid(&s));
    let v = k.tessellate(&s, 0.01).unwrap().volume();
    let want = 4.0 / 3.0 * std::f64::consts::PI * 10.0 * 5.0 * 5.0;
    assert!((v - want).abs() / want < 3e-3, "volume {v} want {want}");
}

#[test]
fn the_document_stretches_about_a_pivot_and_refuses_flattening() {
    let mut d = Document::new(Occt);
    let id = d.add(d.kernel.box_from_corners(DVec3::ZERO, DVec3::splat(10.0)));
    assert!(d.commit_stretch(&[id], DVec3::splat(5.0), DMat3::from_diagonal(DVec3::new(1.0, 0.0, 1.0)), DVec3::ZERO).is_err());
    d.commit_stretch(&[id], DVec3::splat(5.0), DMat3::from_diagonal(DVec3::new(1.0, 3.0, 1.0)), DVec3::X).unwrap();
    let v = d.kernel.tessellate(d.get(id).unwrap(), 0.01).unwrap().volume();
    assert!((v - 3000.0).abs() < 1e-6, "volume {v}");
    d.undo();
    let v = d.kernel.tessellate(d.get(id).unwrap(), 0.01).unwrap().volume();
    assert!((v - 1000.0).abs() < 1e-6);
}
