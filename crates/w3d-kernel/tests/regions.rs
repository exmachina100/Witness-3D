//! Plasticity's regions from every coplanar curve together (manual: "An area enclosed by Curves is
//! called a Region"): crossings, overlaps, nested loops and lines meeting end to end. Units are mm.

#![cfg(feature = "occt")]

use std::f64::consts::PI;

use w3d_kernel::document::Document;
use w3d_kernel::extrude::{ExtrudeParams, Operation};
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

fn on_ground(shape: CurveShape) -> Curve { Curve { origin: [0.0, 0.0, 0.0], x: [1.0, 0.0, 0.0], normal: [0.0, 0.0, 1.0], shape } }
fn poly(points: &[[f64; 2]], closed: bool) -> Curve { on_ground(CurveShape::Polyline { points: points.to_vec(), closed }) }
fn area(t: &Tessellation) -> f64 {
    let p = |i: u32| glam::DVec3::from_array(t.positions[i as usize]);
    t.indices.chunks(3).map(|c| (p(c[1]) - p(c[0])).cross(p(c[2]) - p(c[0])).length() / 2.0).sum()
}
fn areas(doc: &Document<Occt>, curves: &[u32]) -> Vec<f64> {
    let mut a: Vec<f64> = doc.curve_regions(curves).unwrap().iter().map(|s| area(&doc.kernel.tessellate(s, 0.001).unwrap())).collect();
    a.sort_by(|x, y| x.partial_cmp(y).unwrap());
    a
}
fn close(a: &[f64], b: &[f64], eps: f64) { assert_eq!(a.len(), b.len(), "{a:?} vs {b:?}"); for (x, y) in a.iter().zip(b) { assert!((x - y).abs() < eps, "{a:?} vs {b:?}") } }

#[test]
fn a_line_across_a_rectangle_makes_two_regions() {
    let mut doc = Document::new(Occt);
    let ids = doc.commit_curves(vec![poly(&[[0.0, 0.0], [20.0, 0.0], [20.0, 10.0], [0.0, 10.0]], true), poly(&[[5.0, -5.0], [5.0, 15.0]], false)]).unwrap();
    close(&areas(&doc, &ids), &[50.0, 150.0], 1e-6);
}

#[test]
fn overlapping_circles_make_three_regions() {
    let mut doc = Document::new(Occt);
    let ids = doc.commit_curves(vec![on_ground(CurveShape::Circle { center: [0.0, 0.0], radius: 10.0 }), on_ground(CurveShape::Circle { center: [10.0, 0.0], radius: 10.0 })]).unwrap();
    // The lens of two radius-10 circles 10 apart: 2r²(π/3 − √3/4) each side from the chord.
    let lens = 2.0 * 100.0 * (PI / 3.0 - 3f64.sqrt() / 4.0);
    let a = areas(&doc, &ids);
    close(&a, &[lens, 100.0 * PI - lens, 100.0 * PI - lens], 0.05);
}

#[test]
fn an_inner_loop_makes_the_outer_region_a_ring() {
    let mut doc = Document::new(Occt);
    let ids = doc.commit_curves(vec![poly(&[[0.0, 0.0], [20.0, 0.0], [20.0, 20.0], [0.0, 20.0]], true), poly(&[[5.0, 5.0], [15.0, 5.0], [15.0, 15.0], [5.0, 15.0]], true)]).unwrap();
    close(&areas(&doc, &ids), &[100.0, 300.0], 1e-6);
}

#[test]
fn lines_meeting_end_to_end_close_a_region_that_extrudes() {
    let mut doc = Document::new(Occt);
    let ids = doc.commit_curves(vec![poly(&[[0.0, 0.0], [10.0, 0.0]], false), poly(&[[10.0, 0.0], [10.0, 10.0]], false), poly(&[[10.0, 10.0], [0.0, 10.0], [0.0, 0.0]], false), poly(&[[20.0, 0.0], [30.0, 0.0]], false)]).unwrap();
    close(&areas(&doc, &ids), &[100.0], 1e-6);
    let p = ExtrudeParams { profile: Profile::rectangle(1.0, 1.0), frame: Frame::new(glam::DVec3::ZERO, glam::DVec3::X, glam::DVec3::Z), distance: 5.0, back: 0.0, angle: 0.0, thickness: 0.0, operation: Operation::Auto, face: None, direction: None, more_faces: vec![], individual: false, more_regions: vec![] };
    let id = doc.commit_extrude_pieces(None, &[], &p, &ids, &[0]).unwrap();
    assert!((doc.kernel.tessellate(doc.get(id).unwrap(), 0.001).unwrap().volume() - 500.0).abs() < 1e-6);
}
