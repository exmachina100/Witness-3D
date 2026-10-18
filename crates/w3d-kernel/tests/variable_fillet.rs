//! Plasticity's variable fillet (V in Fillet): points along a rounded edge with radii of their own.

#![cfg(feature = "occt")]

use std::f64::consts::PI;

use glam::DVec3;
use opencascade::primitives::Shape;
use w3d_kernel::blend::{blend, BlendParams, VariablePoint, EQUAL};
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

// OpenCascade's variable-radius fillet fails now and then when two run at once (about 1 in 25 here);
// the app runs the kernel on one thread, so these tests take turns as well.
static ONE_AT_A_TIME: std::sync::Mutex<()> = std::sync::Mutex::new(());
fn turn() -> std::sync::MutexGuard<'static, ()> { ONE_AT_A_TIME.lock().unwrap_or_else(|e| e.into_inner()) }

fn volume(k: &Occt, s: &Shape) -> f64 { k.tessellate(s, 0.005).unwrap().volume() }

/// A 40 × 30 × 20 block; its edge at x = 0, z = 0 runs up y from 0 to 30.
fn block(k: &Occt) -> (Shape, u32) {
    let b = k.box_from_corners(DVec3::ZERO, DVec3::new(40.0, 30.0, 20.0));
    let t = k.tessellate(&b, 0.01).unwrap();
    let e = t.edges.iter().position(|p| p.iter().all(|q| q[0].abs() < 1e-6 && q[2].abs() < 1e-6)).unwrap() as u32;
    (b, e)
}

fn params(edge: u32, variable: Vec<VariablePoint>) -> BlendParams {
    BlendParams { edges: vec![edge], size: 3.0, kind: Blend::Fillet, angle: EQUAL, variable }
}

/// What a body keeps of the block below (or above) y = 15.
fn half(k: &Occt, s: &Shape, lower: bool) -> f64 {
    let cut = if lower { k.box_from_corners(DVec3::new(-1.0, -1.0, -1.0), DVec3::new(41.0, 15.0, 21.0)) }
              else { k.box_from_corners(DVec3::new(-1.0, 15.0, -1.0), DVec3::new(41.0, 31.0, 21.0)) };
    volume(k, &k.boolean(s, &cut, BooleanOp::Intersection).unwrap().solid)
}

#[test]
fn a_point_in_the_middle_widens_the_round_there() {
    let _turn = turn();
    let k = Occt;
    let (b, e) = block(&k);
    let full = 40.0 * 30.0 * 20.0;
    let constant = full - volume(&k, &blend(&k, &b, &params(e, vec![])).unwrap().solid);
    // A round of radius r takes (1 − π/4) r² per unit length.
    assert!((constant - (1.0 - PI / 4.0) * 9.0 * 30.0).abs() < 0.5, "{constant}");
    let mid = VariablePoint { edge: e, point: DVec3::new(0.0, 15.0, 0.0), scale: 2.0 };
    let r = blend(&k, &b, &params(e, vec![mid])).unwrap().solid;
    assert!(k.is_valid(&r));
    let taken = full - volume(&k, &r);
    // Between all-3 mm and all-6 mm, and well clear of the constant one.
    assert!(taken > constant * 1.5 && taken < constant * 4.0, "{taken} vs {constant}");
    // Symmetric about the middle, as the law is.
    assert!((half(&k, &r, true) - half(&k, &r, false)).abs() < 1.0);
    // A point at scale 1 changes nothing.
    let same = blend(&k, &b, &params(e, vec![VariablePoint { scale: 1.0, ..mid }])).unwrap().solid;
    assert!((full - volume(&k, &same) - constant).abs() < 0.5);
}

#[test]
fn the_radius_grows_where_the_point_is_whichever_way_the_edge_runs() {
    let _turn = turn();
    let k = Occt;
    let (b, e) = block(&k);
    for (y, lower_loses_more) in [(4.0, true), (26.0, false)] {
        let p = VariablePoint { edge: e, point: DVec3::new(0.0, y, 0.0), scale: 2.5 };
        let r = blend(&k, &b, &params(e, vec![p])).unwrap().solid;
        let (lo, hi) = (half(&k, &r, true), half(&k, &r, false));
        assert_eq!(lo < hi, lower_loses_more, "point at y = {y}: kept {lo} below, {hi} above");
    }
    // A point at an end sets the radius there: the far end stays at 3 mm.
    let end = VariablePoint { edge: e, point: DVec3::new(0.0, 0.0, 0.0), scale: 2.0 };
    let r = blend(&k, &b, &params(e, vec![end])).unwrap().solid;
    assert!(half(&k, &r, true) < half(&k, &r, false));
}

#[test]
fn variable_points_are_checked() {
    let _turn = turn();
    let k = Occt;
    let (b, e) = block(&k);
    let other = (e + 1) % 12;
    let off = VariablePoint { edge: other, point: DVec3::ZERO, scale: 2.0 };
    assert!(blend(&k, &b, &params(e, vec![off])).is_err(), "a point on an edge not being rounded");
    let zero = VariablePoint { edge: e, point: DVec3::new(0.0, 15.0, 0.0), scale: 0.0 };
    assert!(blend(&k, &b, &params(e, vec![zero])).is_err());
    // A chamfer ignores them.
    let mut p = params(e, vec![VariablePoint { edge: e, point: DVec3::new(0.0, 15.0, 0.0), scale: 2.0 }]);
    p.kind = Blend::Chamfer;
    assert!(blend(&k, &b, &p).is_ok());
}
