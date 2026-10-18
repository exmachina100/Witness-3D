//! Toggle Surface Curvature (Plasticity's curvature comb on surface edges). Units are mm.

#![cfg(feature = "occt")]

use glam::DVec3;
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

#[test]
fn a_round_edge_has_even_teeth_pointing_out_and_a_straight_one_none() {
    let k = Occt;
    let b = k.box_from_corners(DVec3::ZERO, DVec3::new(100.0, 100.0, 50.0));
    let ball = k.sphere(DVec3::new(50.0, 50.0, 50.0), 20.0).unwrap();
    let s = k.boolean(&b, &ball, BooleanOp::Difference).unwrap().solid;
    let t = k.tessellate(&s, 0.01).unwrap();
    // The rim of the dimple: a circle of radius 20 round (50, 50) at z = 50.
    let rim = t.edges.iter().position(|e| e.iter().all(|p| (p[2] - 50.0).abs() < 1e-6 && ((DVec3::from_array(*p) - DVec3::new(50.0, 50.0, 50.0)).length() - 20.0).abs() < 1e-3)).unwrap() as u32;
    let teeth = k.edge_curvature(&s, rim, 32).unwrap();
    assert_eq!(teeth.len(), 33);
    for tooth in &teeth {
        assert!((tooth.k - 0.05).abs() < 1e-9, "k {}", tooth.k);
        let out = (DVec3::from_array(tooth.at) - DVec3::new(50.0, 50.0, 50.0)).normalize();
        assert!(DVec3::from_array(tooth.dir).dot(out) > 1.0 - 1e-9, "the tooth points out of the bend");
    }
    // A straight edge of the block.
    let line = t.edges.iter().position(|e| e.iter().all(|p| p[0].abs() < 1e-9 && p[1].abs() < 1e-9)).unwrap() as u32;
    assert!(k.edge_curvature(&s, line, 8).unwrap().iter().all(|t| t.k == 0.0 && t.dir == [0.0; 3]));
    assert!(k.edge_curvature(&s, 999, 8).is_err());
}
