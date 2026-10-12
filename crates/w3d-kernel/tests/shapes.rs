//! Spline and arc curves, and Extrude's angle, thickness, both-sides and slice options, checked
//! against hand-computed volumes. Units are mm.

#![cfg(feature = "occt")]

use std::f64::consts::PI;

use glam::DVec3;
use opencascade::primitives::Shape;
use w3d_kernel::document::Document;
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

fn close(a: f64, b: f64, eps: f64) {
    assert!((a - b).abs() < eps, "{a} != {b} (±{eps})")
}

fn volume(k: &Occt, s: &Shape) -> f64 {
    k.tessellate(s, 0.002).unwrap().volume()
}

fn enclosure(k: &Occt) -> Shape {
    k.box_from_corners(DVec3::new(-40.0, 0.0, -25.0), DVec3::new(40.0, 30.0, 25.0))
}

/// A frame at height `y` facing up.
fn ground(y: f64) -> Frame {
    Frame::new(DVec3::new(0.0, y, 0.0), DVec3::X, DVec3::Y)
}

fn extent(distance: f64, back: f64, angle: f64, thickness: f64) -> Extent {
    Extent {
        distance,
        back,
        angle,
        thickness,
    }
}

/// The frustum between two similar areas `a` and `b`, `h` apart.
fn frustum(a: f64, b: f64, h: f64) -> f64 {
    h / 3.0 * (a + b + (a * b).sqrt())
}

#[test]
fn an_angle_tapers_the_sides_by_the_same_amount_all_round() {
    let k = Occt;
    // 5 mm up with the sides leaning in 1 mm: a 10 × 10 base, an 8 × 8 top.
    let lean = (1.0f64 / 5.0).atan();
    let s = k
        .extrude(
            &Profile::rectangle(10.0, 10.0),
            &ground(0.0),
            &extent(5.0, 0.0, lean, 0.0),
        )
        .unwrap();
    assert!(k.is_valid(&s));
    close(volume(&k, &s), frustum(100.0, 64.0, 5.0), 0.01);
    // An L keeps its shape: its area at depth d is 64 - 40 d + 4 d² (five outer corners, one inner).
    let l = Profile::Polygon(vec![
        (0.0, 0.0),
        (10.0, 0.0),
        (10.0, 4.0),
        (4.0, 4.0),
        (4.0, 10.0),
        (0.0, 10.0),
    ]);
    let s = k
        .extrude(&l, &ground(0.0), &extent(5.0, 0.0, lean, 0.0))
        .unwrap();
    close(volume(&k, &s), 5.0 / 6.0 * (64.0 + 4.0 * 45.0 + 28.0), 0.01);
    // A circle becomes a cone frustum, and a negative angle leans out.
    let c = Profile::Circle {
        center: (0.0, 0.0),
        radius: 5.0,
    };
    let s = k
        .extrude(&c, &ground(0.0), &extent(5.0, 0.0, lean, 0.0))
        .unwrap();
    close(volume(&k, &s), PI * 5.0 / 3.0 * (25.0 + 20.0 + 16.0), 0.3);
    let s = k
        .extrude(&c, &ground(0.0), &extent(5.0, 0.0, -lean, 0.0))
        .unwrap();
    close(volume(&k, &s), PI * 5.0 / 3.0 * (25.0 + 30.0 + 36.0), 0.3);
}

#[test]
fn thickness_leaves_walls_inside_the_outline() {
    let k = Occt;
    let s = k
        .extrude(
            &Profile::rectangle(10.0, 10.0),
            &ground(0.0),
            &extent(5.0, 0.0, 0.0, 1.0),
        )
        .unwrap();
    assert!(k.is_valid(&s));
    close(volume(&k, &s), (100.0 - 64.0) * 5.0, 0.01);
    // With an angle the walls lean too and stay 1 mm across.
    let lean = (1.0f64 / 5.0).atan();
    let s = k
        .extrude(
            &Profile::rectangle(10.0, 10.0),
            &ground(0.0),
            &extent(5.0, 0.0, lean, 1.0),
        )
        .unwrap();
    close(
        volume(&k, &s),
        frustum(100.0, 64.0, 5.0) - frustum(64.0, 36.0, 5.0),
        0.01,
    );
    // Walls thicker than half the profile leave nothing.
    let e = k
        .extrude(
            &Profile::rectangle(10.0, 10.0),
            &ground(0.0),
            &extent(5.0, 0.0, 0.0, 6.0),
        )
        .err()
        .expect("an error");
    assert!(e.to_string().contains("shrunk"), "{e}");
}

#[test]
fn back_extrudes_the_other_way_too() {
    let k = Occt;
    let s = k
        .extrude(
            &Profile::rectangle(10.0, 10.0),
            &ground(0.0),
            &extent(5.0, 5.0, 0.0, 0.0),
        )
        .unwrap();
    close(volume(&k, &s), 1000.0, 0.01);
    let b = k.tessellate(&s, 0.01).unwrap();
    let ys: Vec<f64> = b.positions.iter().map(|p| p[1]).collect();
    close(ys.iter().cloned().fold(f64::MAX, f64::min), -5.0, 1e-9);
    close(ys.iter().cloned().fold(f64::MIN, f64::max), 5.0, 1e-9);
    // Going down 5 and 2 back up.
    let s = k
        .extrude(
            &Profile::rectangle(10.0, 10.0),
            &ground(0.0),
            &extent(-5.0, 2.0, 0.0, 0.0),
        )
        .unwrap();
    close(volume(&k, &s), 700.0, 0.01);
    // Both sides lean in away from the profile.
    let lean = (1.0f64 / 5.0).atan();
    let s = k
        .extrude(
            &Profile::rectangle(10.0, 10.0),
            &ground(0.0),
            &extent(5.0, 5.0, lean, 0.0),
        )
        .unwrap();
    close(volume(&k, &s), 2.0 * frustum(100.0, 64.0, 5.0), 0.01);
}

#[test]
fn a_face_extrudes_with_an_angle() {
    let k = Occt;
    let body = enclosure(&k);
    let t = k.tessellate(&body, 0.01).unwrap();
    let top = t
        .face_planes
        .iter()
        .position(|p| p.is_some_and(|p| p.normal.y > 0.99))
        .unwrap() as u32;
    let lean = (1.0f64 / 10.0).atan();
    let s = k
        .extrude_face(&body, top, &extent(10.0, 0.0, lean, 0.0))
        .unwrap();
    // Not similar rectangles, so the prismatoid rule: ends and four times the middle section.
    close(
        volume(&k, &s),
        10.0 / 6.0 * (4000.0 + 4.0 * 79.0 * 49.0 + 78.0 * 48.0),
        0.05,
    );
}

#[test]
fn a_closed_spline_is_a_region() {
    let k = Occt;
    let blob = Profile::Spline(vec![(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)]);
    let s = k.extrude(&blob, &ground(0.0), &Extent::to(5.0)).unwrap();
    assert!(k.is_valid(&s));
    // The same periodic spline in the browser's OpenCascade encloses 160.003 mm²; the display mesh
    // that measures it here cuts a little off the curve.
    close(volume(&k, &s), 800.015, 0.3);
    let s = k
        .extrude(&blob, &ground(0.0), &extent(5.0, 0.0, 0.1, 1.0))
        .unwrap();
    assert!(k.is_valid(&s) && volume(&k, &s) > 100.0);
}

#[test]
fn sweeps_follow_arcs_and_splines() {
    let k = Occt;
    let rod = Profile::Circle {
        center: (0.0, 0.0),
        radius: 2.0,
    };
    // Half a circle of radius 20 in the xz plane from the origin; the profile faces along it there.
    let frame = Frame::new(DVec3::ZERO, DVec3::Y, DVec3::X);
    let arc = Path::Arc {
        start: DVec3::ZERO,
        mid: DVec3::new(20.0, 0.0, 20.0),
        end: DVec3::new(0.0, 0.0, 40.0),
    };
    let s = k.sweep(&rod, &frame, &arc, 0.0, 1.0).unwrap();
    // Pappus: the area times the length of the centre's path.
    close(volume(&k, &s), PI * 4.0 * PI * 20.0, 1.0);
    let wave = Path::Spline {
        points: vec![
            DVec3::ZERO,
            DVec3::new(10.0, 0.0, 0.0),
            DVec3::new(20.0, 0.0, 0.0),
            DVec3::new(30.0, 0.0, 6.0),
        ],
        closed: false,
    };
    let s = k.sweep(&rod, &frame, &wave, 0.0, 1.0).unwrap();
    assert!(k.is_valid(&s) && volume(&k, &s) > PI * 4.0 * 30.0);
}

#[test]
fn bad_shapes_are_refused_in_words() {
    let k = Occt;
    let sq = Profile::rectangle(10.0, 10.0);
    let e = extrude(
        &k,
        None,
        &ExtrudeParams {
            profile: sq.clone(),
            frame: ground(0.0),
            distance: 5.0,
            back: 0.0,
            angle: PI / 2.0,
            thickness: 0.0,
            operation: Operation::Auto,
            face: None,
        },
    )
    .err()
    .expect("an error");
    assert!(e.to_string().contains("90 degrees"), "{e}");
    let e = extrude(
        &k,
        None,
        &ExtrudeParams {
            profile: sq,
            frame: ground(0.0),
            distance: 5.0,
            back: -1.0,
            angle: 0.0,
            thickness: 0.0,
            operation: Operation::Auto,
            face: None,
        },
    )
    .err()
    .expect("an error");
    assert!(e.to_string().contains("negative"), "{e}");
    let arc = Path::Arc {
        start: DVec3::ZERO,
        mid: DVec3::X,
        end: DVec3::X * 2.0,
    };
    let e = k
        .sweep(
            &Profile::Circle {
                center: (0.0, 0.0),
                radius: 0.2,
            },
            &Frame::new(DVec3::ZERO, DVec3::Y, DVec3::X),
            &arc,
            0.0,
            1.0,
        )
        .err()
        .expect("an error");
    assert!(e.to_string().contains("on a line"), "{e}");
    // A face with a hole can't take an angle yet.
    let body = enclosure(&k);
    let hole = k
        .extrude(
            &Profile::Circle {
                center: (0.0, 0.0),
                radius: 5.0,
            },
            &ground(-1.0),
            &Extent::to(32.0),
        )
        .unwrap();
    let holed = k
        .boolean(&body, &hole, BooleanOp::Difference)
        .unwrap()
        .solid;
    let t = k.tessellate(&holed, 0.01).unwrap();
    let top = t
        .face_planes
        .iter()
        .position(|p| p.is_some_and(|p| p.normal.y > 0.99))
        .unwrap() as u32;
    let e = k
        .extrude_face(&holed, top, &extent(5.0, 0.0, 0.1, 0.0))
        .err()
        .expect("an error");
    assert!(e.to_string().contains("without holes"), "{e}");
}

fn curve(origin: [f64; 3], normal: [f64; 3], shape: CurveShape) -> Curve {
    Curve {
        origin,
        x: [1.0, 0.0, 0.0],
        normal,
        shape,
    }
}

#[test]
fn slice_cuts_the_body_in_two_as_one_step() {
    let mut doc = Document::new(Occt);
    let a = doc.add(enclosure(&doc.kernel));
    let rect = curve(
        [0.0, 30.0, 0.0],
        [0.0, 1.0, 0.0],
        CurveShape::Polyline {
            points: vec![[-10.0, -5.0], [10.0, -5.0], [10.0, 5.0], [-10.0, 5.0]],
            closed: true,
        },
    );
    let ids = doc.commit_curves(vec![rect]).unwrap();
    let mut p = doc.region_params(ids[0], -30.0, Operation::Slice).unwrap();
    assert_eq!(doc.commit_extrude(Some(a), &p).unwrap(), a);
    let bodies = doc.ids();
    assert_eq!(bodies.len(), 2);
    close(
        volume(&doc.kernel, doc.get(a).unwrap()),
        120_000.0 - 6_000.0,
        1.0,
    );
    close(
        volume(&doc.kernel, doc.get(bodies[1]).unwrap()),
        6_000.0,
        1.0,
    );
    assert!(doc.undo());
    assert_eq!(doc.ids(), vec![a]);
    // A slice that misses the body is refused.
    p.distance = 10.0;
    let e = doc.commit_extrude(Some(a), &p).err().expect("an error");
    assert!(e.to_string().contains("does not cut"), "{e}");
}

#[test]
fn drawn_splines_and_arcs_are_checked_and_used() {
    let mut doc = Document::new(Occt);
    let blob = curve(
        [0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        CurveShape::Spline {
            points: vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]],
            closed: true,
        },
    );
    let open = curve(
        [0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        CurveShape::Spline {
            points: vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0]],
            closed: false,
        },
    );
    let arc = curve(
        [0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        CurveShape::Arc {
            start: [0.0, 0.0],
            mid: [5.0, 5.0],
            end: [10.0, 0.0],
        },
    );
    let ids = doc.commit_curves(vec![blob, open, arc]).unwrap();
    assert!(doc.curve(ids[0]).unwrap().profile().is_some());
    assert!(doc.curve(ids[1]).unwrap().profile().is_none());
    assert!(doc.curve(ids[2]).unwrap().profile().is_none());
    // The viewport draws a spline from the kernel's samples; an open one runs end to end.
    let pts = doc
        .kernel
        .sample(&doc.curve(ids[1]).unwrap().path(), 32)
        .unwrap();
    assert_eq!(pts.len(), 33);
    assert!(
        pts[0].distance(DVec3::ZERO) < 1e-9
            && pts[32].distance(DVec3::new(10.0, 0.0, -10.0)) < 1e-9
    );
    let p = doc.region_params(ids[0], 5.0, Operation::Auto).unwrap();
    let b = doc.commit_extrude(None, &p).unwrap();
    close(volume(&doc.kernel, doc.get(b).unwrap()), 800.015, 0.3);
    for bad in [
        CurveShape::Arc {
            start: [0.0, 0.0],
            mid: [1.0, 0.0],
            end: [2.0, 0.0],
        },
        CurveShape::Spline {
            points: vec![[0.0, 0.0]],
            closed: false,
        },
        CurveShape::Spline {
            points: vec![[0.0, 0.0], [0.0, 0.0], [1.0, 1.0]],
            closed: true,
        },
    ] {
        assert!(doc
            .commit_curves(vec![curve([0.0; 3], [0.0, 1.0, 0.0], bad)])
            .is_err());
    }
}
