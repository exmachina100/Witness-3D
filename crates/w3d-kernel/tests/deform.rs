//! Plasticity's Deform Solid and Sheet: bodies wrapped from a reference face onto a target face.
//! Units are mm.

#![cfg(feature = "occt")]

use glam::DVec3;
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

/// The face of `s` whose middle is nearest `p`.
fn face_near(k: &Occt, s: &opencascade::primitives::Shape, p: DVec3) -> u32 {
    (0..k.face_count(s) as u32)
        .min_by(|&a, &b| {
            let d = |f| k.face_uvn(s, f, true, &[DVec3::new(0.5, 0.5, 0.0)]).map(|(_, q)| (q[0] - p).length()).unwrap_or(f64::MAX);
            d(a).total_cmp(&d(b))
        })
        .unwrap()
}

#[test]
fn a_block_on_a_plate_wraps_onto_a_ball() {
    let k = Occt;
    // A plate 100 × 100 with its top at z = 0, and a small block standing on it.
    let plate = k.box_from_corners(DVec3::new(-50.0, -50.0, -5.0), DVec3::new(50.0, 50.0, 0.0));
    let block = k.box_from_corners(DVec3::new(-5.0, -5.0, 0.0), DVec3::new(5.0, 5.0, 4.0));
    let ball = k.sphere(DVec3::ZERO, 20.0).unwrap();
    let top = face_near(&k, &plate, DVec3::new(0.0, 0.0, 0.0));
    let out = k.deform(&[&block], &plate, top, &ball, 0, &DeformOptions::default()).unwrap();
    assert_eq!(out.len(), 1);
    let b = &out[0];
    let t = k.tessellate(b, 0.01).unwrap();
    assert!(t.volume() > 0.0, "{}", t.volume());
    // Every point of the block lands on or up to 4 mm out from the ball, within the 0.01 mm the
    // warped control points stay within.
    for p in &t.positions {
        let p = DVec3::from_array(*p);
        let r = p.length();
        assert!(r > 20.0 - 1e-2 && r < 24.0 + 1e-2, "{p} at {r}");
    }
}

#[test]
fn mirrored_bodies_stay_right_way_out() {
    let k = Occt;
    let plate = k.box_from_corners(DVec3::new(-50.0, -50.0, -5.0), DVec3::new(50.0, 50.0, 0.0));
    let block = k.box_from_corners(DVec3::new(-5.0, -5.0, 0.0), DVec3::new(5.0, 5.0, 4.0));
    let top = face_near(&k, &plate, DVec3::ZERO);
    let o = DeformOptions { mirror: true, ..Default::default() };
    let out = k.deform(&[&block], &plate, top, &plate, top, &o).unwrap();
    let v = k.tessellate(&out[0], 0.01).unwrap().volume();
    assert!((v - 400.0).abs() < 1e-3, "{v}");
}

#[test]
fn reblend_makes_stretched_fillets_round_again() {
    let k = Occt;
    let vol = |s: &opencascade::primitives::Shape| k.tessellate(s, 0.005).unwrap().volume();
    let plate = k.box_from_corners(DVec3::new(-50.0, -50.0, -5.0), DVec3::new(50.0, 50.0, 0.0));
    let top = face_near(&k, &plate, DVec3::ZERO);
    let round = |a: DVec3, b: DVec3| {
        let s = k.box_from_corners(a, b);
        let all: Vec<u32> = (0..k.edge_count(&s) as u32).collect();
        k.blend(&s, &all, 1.0, Blend::Fillet, 0.0, &[]).unwrap().solid
    };
    // A 10 × 10 × 4 block, every edge rounded at 1 mm, stretched to twice its length along U.
    let block = round(DVec3::new(-5.0, -5.0, 0.0), DVec3::new(5.0, 5.0, 4.0));
    let o = DeformOptions { scale: [2.0, 1.0, 1.0], ..Default::default() };
    let plain = k.deform(&[&block], &plate, top, &plate, top, &o).unwrap();
    let again = k.deform(&[&block], &plate, top, &plate, top, &DeformOptions { reblend: true, ..o }).unwrap();
    // Reblended, it is the 20 × 10 × 4 block rounded at 1 mm; stretched, its rounds are wider.
    let want = vol(&round(DVec3::new(-10.0, -5.0, 0.0), DVec3::new(10.0, 5.0, 4.0)));
    assert!((vol(&again[0]) - want).abs() < 0.05, "{} {want}", vol(&again[0]));
    assert!(vol(&plain[0]) < want - 0.5, "{} {want}", vol(&plain[0]));
    assert_eq!(k.face_count(&again[0]), k.face_count(&block));
    // A body with no fillets deforms as before.
    let bare = k.box_from_corners(DVec3::new(-5.0, -5.0, 0.0), DVec3::new(5.0, 5.0, 4.0));
    let v = vol(&k.deform(&[&bare], &plate, top, &plate, top, &DeformOptions { reblend: true, ..o }).unwrap()[0]);
    assert!((v - 800.0).abs() < 1e-3, "{v}");
}
