//! Join Curves, ellipses, Boolean's slice, Revolve's thickness and Extrude's angle and thickness on
//! faces with holes, checked against hand-computed volumes. Units are mm.

#![cfg(feature = "occt")]

use std::f64::consts::PI;

use glam::DVec3;
use opencascade::primitives::Shape;
use w3d_kernel::document::Document;
use w3d_kernel::form::{self, FormKind, FormParams};
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

fn close(a: f64, b: f64, eps: f64) {
    assert!((a - b).abs() < eps, "{a} != {b} (±{eps})")
}

fn volume(k: &Occt, s: &Shape) -> f64 {
    k.tessellate(s, 0.002).unwrap().volume()
}

fn ground(y: f64) -> Frame {
    Frame::new(DVec3::new(0.0, y, 0.0), DVec3::X, DVec3::Y)
}

fn extent(distance: f64, angle: f64, thickness: f64) -> Extent {
    Extent { distance, back: 0.0, angle, thickness }
}

fn on_ground(shape: CurveShape) -> Curve {
    Curve { origin: [0.0, 0.0, 0.0], x: [1.0, 0.0, 0.0], normal: [0.0, 1.0, 0.0], shape }
}

fn line(a: [f64; 2], b: [f64; 2]) -> Curve {
    on_ground(CurveShape::Polyline { points: vec![a, b], closed: false })
}

#[test]
fn an_ellipse_extrudes_to_pi_r_r_h_whichever_radius_is_longer() {
    let k = Occt;
    let wide = Profile::Ellipse { center: (0.0, 0.0), major: (10.0, 0.0), minor: 4.0 };
    close(volume(&k, &k.extrude(&wide, &ground(0.0), &Extent::to(5.0)).unwrap()), PI * 10.0 * 4.0 * 5.0, 0.5);
    let tall = Profile::Ellipse { center: (1.0, 2.0), major: (0.0, 3.0), minor: 6.0 };
    close(volume(&k, &k.extrude(&tall, &ground(0.0), &Extent::to(5.0)).unwrap()), PI * 18.0 * 5.0, 0.5);
    let bad = Profile::Ellipse { center: (0.0, 0.0), major: (0.0, 0.0), minor: 6.0 };
    assert!(k.extrude(&bad, &ground(0.0), &Extent::to(5.0)).is_err());
}

#[test]
fn join_turns_a_line_and_an_arc_into_a_region() {
    let mut doc = Document::new(Occt);
    // A half disc of radius 5: the arc runs the other way from the line, so one is turned round.
    let arc = on_ground(CurveShape::Arc { start: [0.0, -5.0], mid: [5.0, 0.0], end: [0.0, 5.0] });
    let ids = doc.commit_curves(vec![line([0.0, -5.0], [0.0, 5.0]), arc]).unwrap();
    assert!(doc.region_params(ids[0], 2.0, Operation::NewBody).is_err());
    let joined = doc.commit_join(&ids).unwrap();
    assert_eq!(joined.len(), 1);
    assert_eq!(doc.curve_ids(), joined);
    assert!(matches!(doc.curve(joined[0]).unwrap().shape, CurveShape::Contour { .. }));
    let p = doc.region_params(joined[0], 2.0, Operation::NewBody).unwrap();
    let id = doc.commit_extrude(None, &p).unwrap();
    close(volume(&doc.kernel, doc.get(id).unwrap()), 12.5 * PI * 2.0, 0.1);
    // A joined contour sweeps and samples like any curve.
    assert!(doc.kernel.sample(&doc.curve(joined[0]).unwrap().path(), 32).is_ok());
    // Undo takes back the extrude, then the join.
    assert!(doc.undo());
    assert!(doc.undo());
    assert_eq!(doc.curve_ids(), ids);
}

#[test]
fn join_makes_one_closed_line_from_lines_in_any_order_and_keeps_separate_runs_apart() {
    let square = vec![
        line([10.0, 0.0], [10.0, 10.0]),
        line([0.0, 0.0], [10.0, 0.0]),
        line([0.0, 10.0], [0.0, 0.0]),
        line([0.0, 10.0], [10.0, 10.0]),
    ];
    let joined = join::join(&square).unwrap();
    assert_eq!(joined.len(), 1);
    let CurveShape::Polyline { points, closed } = &joined[0].shape else { panic!("expected one line") };
    assert!(*closed);
    assert_eq!(points.len(), 4);
    // Ends within a tenth of a micron meet; further apart they stay two curves.
    let near = join::join(&[line([0.0, 0.0], [5.0, 0.0]), line([5.00000005, 0.0], [5.0, 5.0])]).unwrap();
    assert_eq!(near.len(), 1);
    let apart = join::join(&[line([0.0, 0.0], [5.0, 0.0]), line([6.0, 0.0], [6.0, 5.0])]).unwrap();
    assert_eq!(apart.len(), 2);
    // Only open curves in one plane join.
    let circle = on_ground(CurveShape::Circle { center: [0.0, 0.0], radius: 1.0 });
    assert!(join::join(&[circle, line([0.0, 0.0], [1.0, 0.0])]).is_err());
    let mut lifted = line([5.0, 0.0], [5.0, 5.0]);
    lifted.origin = [0.0, 1.0, 0.0];
    assert!(join::join(&[line([0.0, 0.0], [5.0, 0.0]), lifted]).is_err());
    assert!(join::join(&[line([0.0, 0.0], [5.0, 0.0])]).is_err());
}

#[test]
fn a_face_with_a_hole_takes_an_angle_and_a_thickness() {
    let k = Occt;
    // The enclosure with a ⌀10 hole straight through it, top to bottom.
    let block = k.box_from_corners(DVec3::new(-40.0, 0.0, -25.0), DVec3::new(40.0, 30.0, 25.0));
    let rod = k.extrude(&Profile::Circle { center: (0.0, 0.0), radius: 5.0 }, &ground(-1.0), &Extent::to(40.0)).unwrap();
    let holed = k.boolean(&block, &rod, BooleanOp::Difference).unwrap().solid;
    let t = k.tessellate(&holed, 0.01).unwrap();
    let top = t.face_planes.iter().position(|p| p.is_some_and(|p| p.normal.y > 0.99 && (p.origin.y - 30.0).abs() < 1e-6)).unwrap() as u32;
    // Walls 1 thick around the outside and around the hole.
    let walls = k.extrude_face(&holed, top, &extent(10.0, 0.0, 1.0)).unwrap();
    close(volume(&k, &walls), (4000.0 - 78.0 * 48.0 + PI * (36.0 - 25.0)) * 10.0, 0.5);
    // Leaning in 1 mm over 10: the outline shrinks and the hole grows to match.
    let lean = (0.1f64).atan();
    let tapered = k.extrude_face(&holed, top, &extent(10.0, lean, 0.0)).unwrap();
    let outer = 10.0 / 6.0 * (4000.0 + 4.0 * 79.0 * 49.0 + 78.0 * 48.0);
    let hole = PI * 10.0 / 3.0 * (25.0 + 30.0 + 36.0);
    close(volume(&k, &tapered), outer - hole, 0.5);
    assert!(k.is_valid(&tapered) && k.is_valid(&walls));
}

#[test]
fn revolve_with_a_thickness_leaves_walls() {
    let k = Occt;
    // The rectangle x 10..20, 10 tall, turned about the axis at x = 0: walls 1 thick inside it.
    let p = FormParams {
        profile: Profile::Polygon(vec![(10.0, -5.0), (20.0, -5.0), (20.0, 5.0), (10.0, 5.0)]),
        frame: ground(0.0),
        kind: FormKind::Revolve { axis_point: DVec3::ZERO, axis_dir: DVec3::Z, angle: 2.0 * PI, thickness: 1.0 },
        operation: Operation::NewBody,
    };
    let s = form::tool(&Occt, &p).unwrap();
    close(volume(&k, &s), PI * (400.0 - 100.0) * 10.0 - PI * (361.0 - 121.0) * 8.0, 2.0);
    let too_thick = FormParams { kind: FormKind::Revolve { axis_point: DVec3::ZERO, axis_dir: DVec3::Z, angle: 2.0 * PI, thickness: 6.0 }, ..p.clone() };
    assert!(form::tool(&Occt, &too_thick).is_err());
    let negative = FormParams { kind: FormKind::Revolve { axis_point: DVec3::ZERO, axis_dir: DVec3::Z, angle: 2.0 * PI, thickness: -1.0 }, ..p };
    assert!(form::tool(&Occt, &negative).is_err());
}

#[test]
fn boolean_slice_splits_the_target_by_each_tool_as_one_step() {
    let mut doc = Document::new(Occt);
    let a = doc.add(doc.kernel.box_from_corners(DVec3::new(-40.0, 0.0, -25.0), DVec3::new(40.0, 30.0, 25.0)));
    let b = doc.add(doc.kernel.box_from_corners(DVec3::new(30.0, -10.0, -10.0), DVec3::new(50.0, 40.0, 10.0)));
    let pieces = doc.commit_boolean_slice(a, &[b], false).unwrap();
    assert_eq!(pieces.len(), 1);
    assert_eq!(doc.ids(), vec![a, pieces[0]]);
    close(volume(&doc.kernel, doc.get(a).unwrap()), 120_000.0 - 6_000.0, 1.0);
    close(volume(&doc.kernel, doc.get(pieces[0]).unwrap()), 6_000.0, 1.0);
    assert!(doc.undo());
    assert_eq!(doc.ids(), vec![a, b]);
    // A tool that misses the body is refused.
    let far = doc.add(doc.kernel.box_from_corners(DVec3::new(100.0, 0.0, 0.0), DVec3::new(110.0, 10.0, 10.0)));
    assert!(doc.commit_boolean_slice(a, &[far], true).is_err());
}

#[test]
fn drawn_ellipses_and_contours_are_checked() {
    let mut doc = Document::new(Occt);
    let ok = on_ground(CurveShape::Ellipse { center: [0.0, 0.0], major: [5.0, 1.0], minor: 2.0 });
    let flat = on_ground(CurveShape::Ellipse { center: [0.0, 0.0], major: [5.0, 0.0], minor: 0.0 });
    let gap = on_ground(CurveShape::Contour {
        pieces: vec![
            CurveShape::Polyline { points: vec![[0.0, 0.0], [5.0, 0.0]], closed: false },
            CurveShape::Polyline { points: vec![[6.0, 0.0], [6.0, 5.0]], closed: false },
        ],
    });
    let ring = on_ground(CurveShape::Contour { pieces: vec![CurveShape::Circle { center: [0.0, 0.0], radius: 1.0 }] });
    let ids = doc.commit_curves(vec![ok]).unwrap();
    assert!(doc.region_params(ids[0], 1.0, Operation::NewBody).is_ok());
    for bad in [flat, gap, ring] {
        assert!(doc.commit_curves(vec![bad]).is_err());
    }
}
