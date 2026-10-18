//! Plasticity's fillet Shape: Chordal (the distance is the width across the round), Conic (rho
//! the tension) and G2, on a block's edge. Units are mm.

#![cfg(feature = "occt")]

use std::f64::consts::PI;

use glam::{DVec2, DVec3};
use opencascade::primitives::Shape;
use w3d_kernel::blend::{blend, BlendParams, FilletShape, EQUAL};
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

const FULL: f64 = 40.0 * 30.0 * 20.0;

fn volume(_k: &Occt, s: &Shape) -> f64 { s.exact_volume().unwrap() }

/// A 40 × 30 × 20 block and the numbers of its edges along y at z = 0 (x = 0 and x = 40).
fn block(k: &Occt) -> (Shape, u32, u32) {
    let b = k.box_from_corners(DVec3::ZERO, DVec3::new(40.0, 30.0, 20.0));
    let t = k.tessellate(&b, 0.01).unwrap();
    let at = |x: f64| t.edges.iter().position(|p| p.iter().all(|q| (q[0] - x).abs() < 1e-6 && q[2].abs() < 1e-6)).unwrap() as u32;
    (b, at(0.0), at(40.0))
}

fn params(edges: Vec<u32>, size: f64, shape: FilletShape, tension: f64) -> BlendParams {
    BlendParams { edges, size, kind: Blend::Fillet, angle: EQUAL, variable: vec![], shape, tension, limits: vec![] }
}

/// The area a section cuts off a right-angled corner whose spring points are `r` from it.
fn corner_area(r: f64, section: impl Fn(DVec2, DVec2, DVec2, f64) -> DVec2) -> f64 {
    let (p0, c, p1) = (DVec2::new(r, 0.0), DVec2::ZERO, DVec2::new(0.0, r));
    let n = 4000;
    let pts: Vec<DVec2> = (0..=n).map(|i| section(p0, c, p1, i as f64 / n as f64)).collect();
    // Shoelace over the corner, p0, along the section to p1.
    let mut ring = vec![c];
    ring.extend(pts);
    (0..ring.len()).map(|i| ring[i].perp_dot(ring[(i + 1) % ring.len()])).sum::<f64>().abs() / 2.0
}

fn conic(p0: DVec2, c: DVec2, p1: DVec2, rho: f64, s: f64) -> DVec2 {
    let w = rho / (1.0 - rho);
    let (b0, b1, b2) = ((1.0 - s) * (1.0 - s), 2.0 * s * (1.0 - s) * w, s * s);
    (p0 * b0 + c * b1 + p1 * b2) / (b0 + b1 + b2)
}

fn g2(p0: DVec2, c: DVec2, p1: DVec2, t: f64, s: f64) -> DVec2 {
    let mut q = [p0, p0 + (c - p0) * t / 2.0, p0 + (c - p0) * t, p1 + (c - p1) * t, p1 + (c - p1) * t / 2.0, p1];
    for n in (1..6).rev() { for i in 0..n { q[i] = q[i] * (1.0 - s) + q[i + 1] * s; } }
    q[0]
}

/// The largest angle (degrees) at the edges where the round meets the block's faces: 0 when tangent.
fn springs(k: &Occt, s: &Shape) -> Vec<f64> {
    let mut a: Vec<f64> = k.edge_angles(s).into_iter().filter(|&a| a >= 0.0).collect();
    a.sort_by(|x, y| x.partial_cmp(y).unwrap());
    a
}

#[test]
fn chordal_spans_the_distance_across_the_round() {
    let k = Occt;
    let (b, e, _) = block(&k);
    let out = blend(&k, &b, &params(vec![e], 6.0, FilletShape::Chordal, 0.5)).unwrap().solid;
    // A right angle: the chord 6 is the radius times √2.
    let r = 6.0 / 2f64.sqrt();
    let want = FULL - 30.0 * r * r * (1.0 - PI / 4.0);
    assert!((volume(&k, &out) - want).abs() < 0.01, "volume {} against {want}", volume(&k, &out));
}

#[test]
fn conic_keeps_the_spring_lines_and_follows_rho() {
    let k = Occt;
    let (b, e, _) = block(&k);
    let round = blend(&k, &b, &params(vec![e], 5.0, FilletShape::Round, 0.5)).unwrap().solid;
    for rho in [0.3, 0.5, 0.7] {
        let out = blend(&k, &b, &params(vec![e], 5.0, FilletShape::Conic, rho)).unwrap().solid;
        assert!(k.is_valid(&out));
        assert_eq!(k.face_count(&out), k.face_count(&round));
        let want = FULL - 30.0 * corner_area(5.0, |a, c, b, s| conic(a, c, b, rho, s));
        assert!((volume(&k, &out) - want).abs() < 0.01, "rho {rho}: volume {} against {want}", volume(&k, &out));
        let a = springs(&k, &out);
        assert!(a[0] < 0.05 && a[1] < 0.05, "rho {rho}: the round leaves its faces tangent ({:?})", &a[..2]);
    }
}

#[test]
fn g2_leaves_the_faces_with_no_curvature() {
    let k = Occt;
    let (b, e, f) = block(&k);
    let out = blend(&k, &b, &params(vec![e, f], 5.0, FilletShape::G2, 0.5)).unwrap().solid;
    assert!(k.is_valid(&out));
    let want = FULL - 2.0 * 30.0 * corner_area(5.0, |a, c, b, s| g2(a, c, b, 0.5, s));
    assert!((volume(&k, &out) - want).abs() < 0.01, "volume {} against {want}", volume(&k, &out));
    let a = springs(&k, &out);
    assert!(a[..4].iter().all(|&x| x < 0.05), "tangent at all four spring lines ({:?})", &a[..4]);
}

#[test]
fn rounds_meeting_at_a_corner_are_refused_for_now() {
    let k = Occt;
    let b = k.box_from_corners(DVec3::ZERO, DVec3::new(40.0, 30.0, 20.0));
    let t = k.tessellate(&b, 0.01).unwrap();
    let top: Vec<u32> = t.edges.iter().enumerate().filter(|(_, p)| p.iter().all(|q| (q[2] - 20.0).abs() < 1e-6)).map(|(i, _)| i as u32).collect();
    assert_eq!(top.len(), 4);
    match blend(&k, &b, &params(top, 3.0, FilletShape::Conic, 0.5)) {
        Err(e) => assert!(e.to_string().contains("corner"), "{e}"),
        Ok(t) => assert!(k.is_valid(&t.solid), "if it goes round, it must be valid"),
    }
    assert!(blend(&k, &b, &params(vec![0], 3.0, FilletShape::Conic, 0.99)).is_err(), "tension out of range");
}

#[test]
fn a_round_rim_and_a_tangent_chain_take_the_shapes() {
    let k = Occt;
    // A block with a bowl cut into its top: the rim joins a flat face to a ball.
    let slab = k.box_from_corners(DVec3::ZERO, DVec3::new(100.0, 100.0, 50.0));
    let ball = k.sphere(DVec3::new(50.0, 50.0, 80.0), 40.0).unwrap();
    let s = k.boolean(&slab, &ball, BooleanOp::Difference).unwrap().solid;
    let t = k.tessellate(&s, 0.01).unwrap();
    let rim = t.edges.iter().position(|e| e.len() > 10 && e.iter().all(|p| (p[2] - 50.0).abs() < 1e-6)).unwrap() as u32;
    let round = volume(&k, &blend(&k, &s, &params(vec![rim], 4.0, FilletShape::Round, 0.5)).unwrap().solid);
    for shape in [FilletShape::Conic, FilletShape::G2] {
        let out = blend(&k, &s, &params(vec![rim], 4.0, shape, 0.5)).unwrap().solid;
        assert!(k.is_valid(&out), "{shape:?}");
        // The same spring lines, a different section: within a few mm³ of the round on a 488000 mm³ body.
        assert!((volume(&k, &out) - round).abs() < 20.0, "{shape:?}: {} against {round}", volume(&k, &out));
        assert!(springs(&k, &out)[..2].iter().all(|&a| a < 0.05), "{shape:?}: tangent ({:?})", &springs(&k, &out)[..2]);
    }
    // A block's top edges running round a rounded corner: three rounds in a tangent chain.
    let (b, _, _) = block(&k);
    let t = k.tessellate(&b, 0.01).unwrap();
    let post = t.edges.iter().position(|p| p.iter().all(|q| (q[0] - 40.0).abs() < 1e-6 && (q[1] - 30.0).abs() < 1e-6)).unwrap() as u32;
    let r = blend(&k, &b, &params(vec![post], 8.0, FilletShape::Round, 0.5)).unwrap().solid;
    let t = k.tessellate(&r, 0.01).unwrap();
    let chain: Vec<u32> = t.edges.iter().enumerate()
        .filter(|(_, l)| l.iter().all(|q| (q[2] - 20.0).abs() < 1e-6) && !l.iter().all(|q| q[0].abs() < 1e-6) && !l.iter().all(|q| q[1].abs() < 1e-6))
        .map(|(i, _)| i as u32).collect();
    assert_eq!(chain.len(), 3);
    for shape in [FilletShape::Conic, FilletShape::G2] {
        let out = blend(&k, &r, &params(chain.clone(), 3.0, shape, 0.6)).unwrap().solid;
        assert!(k.is_valid(&out), "{shape:?}");
        // Two spring lines on each of the three rounds, and the two joins between them.
        assert!(springs(&k, &out)[..8].iter().all(|&a| a < 0.05), "{shape:?}: {:?}", &springs(&k, &out)[..8]);
    }
}

#[test]
fn limit_points_keep_the_round_between_them() {
    let k = Occt;
    let (b, e, _) = block(&k);
    // The edge runs up y from 0 to 30 at x = 0, z = 0; round it only from y = 10 to y = 25.
    let mut p = params(vec![e], 4.0, FilletShape::Round, 0.5);
    p.limits = vec![DVec3::new(0.0, 25.0, 0.0), DVec3::new(0.0, 10.0, 0.0)];
    let out = blend(&k, &b, &p).unwrap().solid;
    assert!(k.is_valid(&out));
    let want = FULL - 15.0 * 16.0 * (1.0 - PI / 4.0);
    assert!((volume(&k, &out) - want).abs() < 0.01, "volume {} against {want}", volume(&k, &out));
    // Two flat ends where the round stops, on top of the block's six faces and the round.
    assert_eq!(k.face_count(&out), 9);
    p.limits.pop();
    assert!(blend(&k, &b, &p).is_err(), "one limit point is not enough");
    p.limits = vec![DVec3::new(5.0, 5.0, 5.0), DVec3::new(0.0, 10.0, 0.0)];
    assert!(blend(&k, &b, &p).is_err(), "off the edge");
}
