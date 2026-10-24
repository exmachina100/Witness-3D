//! Plasticity's fillet Shape Full: the round tangent to a face and both faces beside it, picked
//! by two edges of that face. Units are mm.

#![cfg(feature = "occt")]

use std::f64::consts::PI;

use glam::DVec3;
use opencascade::primitives::Shape;
use w3d_kernel::blend::{blend, BlendParams, FilletShape, EQUAL};
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

fn params(edges: Vec<u32>) -> BlendParams {
    BlendParams { edges, size: 1.0, kind: Blend::Fillet, angle: EQUAL, variable: vec![], shape: FilletShape::Full, tension: 0.5, limits: vec![] }
}

/// The edge along y at (x, z).
fn edge(k: &Occt, s: &Shape, x: f64, z: f64) -> u32 {
    let t = k.tessellate(s, 0.01).unwrap();
    t.edges.iter().position(|p| p.iter().all(|q| (q[0] - x).abs() < 1e-6 && (q[2] - z).abs() < 1e-6)).unwrap() as u32
}

#[test]
fn rounds_a_rib_top_tangent_to_all_three_faces() {
    let k = Occt;
    let rib = k.box_from_corners(DVec3::ZERO, DVec3::new(10.0, 40.0, 20.0));
    let out = blend(&k, &rib, &params(vec![edge(&k, &rib, 0.0, 20.0), edge(&k, &rib, 10.0, 20.0)])).unwrap().solid;
    // A half-disc of radius 5 in place of the 10 × 5 top.
    let want = 10.0 * 40.0 * 20.0 - (10.0 * 5.0 - PI * 25.0 / 2.0) * 40.0;
    assert!((out.exact_volume().unwrap() - want).abs() < 1e-3, "{} vs {want}", out.exact_volume().unwrap());
    // The round meets both sides with no crease, in one face; the top face is gone.
    let angles: Vec<f64> = k.edge_angles(&out).into_iter().filter(|&a| a >= 0.0).collect();
    assert_eq!(angles.iter().filter(|&&a| a < 0.01).count(), 2, "{angles:?}");
    let t = k.tessellate(&out, 0.01).unwrap();
    assert_eq!(t.face_planes.iter().filter(|p| p.is_none()).count(), 1);
    assert!(t.face_planes.iter().flatten().all(|p| p.normal.z < 0.5));
}

#[test]
fn rounds_a_rib_standing_on_a_plate() {
    let k = Occt;
    let plate = k.box_from_corners(DVec3::new(-20.0, 0.0, -5.0), DVec3::new(30.0, 40.0, 0.0));
    let rib = k.box_from_corners(DVec3::new(0.0, 0.0, 0.0), DVec3::new(6.0, 40.0, 15.0));
    let body = k.unify(&k.boolean(&plate, &rib, BooleanOp::Union).unwrap().solid).unwrap().solid;
    let before = body.exact_volume().unwrap();
    let out = blend(&k, &body, &params(vec![edge(&k, &body, 0.0, 15.0), edge(&k, &body, 6.0, 15.0)])).unwrap().solid;
    let want = before - (6.0 * 3.0 - PI * 9.0 / 2.0) * 40.0;
    assert!((out.exact_volume().unwrap() - want).abs() < 1e-3);
    assert!(k.is_valid(&out));
}

#[test]
fn refuses_edges_not_across_one_face() {
    let k = Occt;
    let b = k.box_from_corners(DVec3::ZERO, DVec3::new(10.0, 40.0, 20.0));
    // Two parallel edges diagonally across the block share no face.
    let err = blend(&k, &b, &params(vec![edge(&k, &b, 0.0, 0.0), edge(&k, &b, 10.0, 20.0)])).err().unwrap();
    assert!(err.to_string().contains("one flat face"), "{err}");
    assert!(blend(&k, &b, &params(vec![edge(&k, &b, 0.0, 0.0)])).is_err());
}

#[test]
fn rounds_a_tapered_rib_tangent_to_its_leaning_sides() {
    let k = Occt;
    let frame = Frame::new(DVec3::ZERO, DVec3::X, -DVec3::Y);
    let rib = k.extrude(&Profile::Polygon(vec![(0.0, 0.0), (10.0, 0.0), (8.0, 20.0), (2.0, 20.0)]), &frame, &Extent::to(40.0)).unwrap();
    let out = blend(&k, &rib, &params(vec![edge(&k, &rib, 2.0, 20.0), edge(&k, &rib, 8.0, 20.0)])).unwrap().solid;
    assert!(k.is_valid(&out));
    let angles: Vec<f64> = k.edge_angles(&out).into_iter().filter(|&a| a >= 0.0).collect();
    assert_eq!(angles.iter().filter(|&&a| a < 0.01).count(), 2, "{angles:?}");
    assert!(out.exact_volume().unwrap() < rib.exact_volume().unwrap());
}
