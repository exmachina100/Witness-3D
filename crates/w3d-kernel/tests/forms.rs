//! Revolve, Loft, Sweep and Offset Face, checked against hand-computed volumes. Units are mm.

#![cfg(feature = "occt")]

use std::f64::consts::PI;

use glam::DVec3;
use opencascade::primitives::Shape;
use w3d_kernel::document::{Document, FormRequest};
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

fn faces_facing(k: &Occt, s: &Shape, point: DVec3, normal: DVec3) -> Vec<u32> {
    let t = k.tessellate(s, 0.01).unwrap();
    t.face_planes
        .iter()
        .enumerate()
        .filter(|(_, p)| {
            p.as_ref().is_some_and(|p| {
                p.normal.dot(normal) > 1.0 - 1e-9 && (p.origin - point).dot(normal).abs() < 1e-6
            })
        })
        .map(|(i, _)| i as u32)
        .collect()
}

fn square(side: f64) -> Profile {
    Profile::rectangle(side, side)
}

/// A frame at height `y` facing up, like a sketch on the ground plane.
fn ground(y: f64) -> Frame {
    Frame::new(DVec3::new(0.0, y, 0.0), DVec3::X, DVec3::Y)
}

#[test]
fn offset_face_moves_the_top_and_keeps_its_refs() {
    let mut doc = Document::new(Occt);
    let a = doc.add(enclosure(&doc.kernel));
    let top = faces_facing(
        &doc.kernel,
        doc.get(a).unwrap(),
        DVec3::new(0.0, 30.0, 0.0),
        DVec3::Y,
    );
    let top_ref = doc.refs(a).unwrap().faces[top[0] as usize];
    close(
        volume(&doc.kernel, &doc.preview_offset(a, &top, -5.0, 0.0, Grow::Moving).unwrap()),
        80.0 * 25.0 * 50.0,
        1e-3,
    );
    doc.commit_offset(a, &top, 5.0, 0.0, Grow::Moving).unwrap();
    let s = doc.get(a).unwrap();
    close(volume(&doc.kernel, s), 80.0 * 35.0 * 50.0, 1e-3);
    assert_eq!(doc.kernel.face_count(s), 6);
    let moved = faces_facing(&doc.kernel, s, DVec3::new(0.0, 35.0, 0.0), DVec3::Y);
    assert_eq!(
        doc.refs(a).unwrap().faces[moved[0] as usize],
        top_ref,
        "the moved face keeps its ref"
    );
    assert!(doc.undo());
    close(volume(&doc.kernel, doc.get(a).unwrap()), 120_000.0, 1e-3);
}

#[test]
fn offset_face_stretches_slanted_neighbours() {
    // A 10 mm chamfer along the top front edge; raising the top by 4 extends the chamfer face
    // rather than adding a vertical step, as Plasticity's Offset Face does.
    let k = Occt;
    let body = enclosure(&k);
    let edge = {
        let t = k.tessellate(&body, 0.01).unwrap();
        t.edges
            .iter()
            .position(|e| {
                e.iter()
                    .all(|p| (p[1] - 30.0).abs() < 1e-6 && (p[2] - 25.0).abs() < 1e-6)
            })
            .unwrap() as u32
    };
    let bevel = blend(
        &k,
        &body,
        &BlendParams {
            edges: vec![edge],
            size: 10.0,
            kind: Blend::Chamfer,
            angle: blend::EQUAL,
            variable: vec![],
            shape: w3d_kernel::blend::FilletShape::Round,
            tension: 0.5,
            limits: vec![],
        },
    )
    .unwrap()
    .solid;
    let top = faces_facing(&k, &bevel, DVec3::new(0.0, 30.0, 0.0), DVec3::Y);
    let raised = offset_faces(&k, &bevel, &top, 4.0, 0.0).unwrap().solid;
    assert_eq!(k.face_count(&raised), 7, "no new faces");
    // The 40 deep top rises 4 while the 45° chamfer below its front edge climbs with it, taking a
    // 4 × 4 triangle off the new slab.
    close(
        volume(&k, &raised),
        volume(&k, &bevel) + 80.0 * (40.0 * 4.0 - 4.0 * 4.0 / 2.0),
        0.5,
    );
}

#[test]
fn offset_face_widens_a_hole() {
    let k = Occt;
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
    let body = k
        .boolean(&enclosure(&k), &hole, BooleanOp::Difference)
        .unwrap()
        .solid;
    let wall = k
        .tessellate(&body, 0.01)
        .unwrap()
        .face_planes
        .iter()
        .position(|p| p.is_none())
        .unwrap() as u32;
    // The wall faces into the hole, so a positive offset closes it up to radius 4.
    let smaller = offset_faces(&k, &body, &[wall], 1.0, 0.0).unwrap().solid;
    close(
        volume(&k, &smaller),
        volume(&k, &body) + PI * (25.0 - 16.0) * 30.0,
        0.5,
    );
}

#[test]
fn offset_face_refuses_nothing_and_strangers() {
    let k = Occt;
    let body = enclosure(&k);
    assert!(matches!(
        offset_faces(&k, &body, &[], 1.0, 0.0),
        Err(KernelError::Invalid(_))
    ));
    assert!(matches!(
        offset_faces(&k, &body, &[0], 0.0, 0.0),
        Err(KernelError::NoOp)
    ));
    assert!(matches!(
        offset_faces(&k, &body, &[99], 1.0, 0.0),
        Err(KernelError::Invalid(_))
    ));
    assert!(offset_faces(&k, &body, &[0], f64::NAN, 0.0).is_err());
}

fn ring_profile() -> (Profile, Frame) {
    // The rectangle x 10..20, z -5..5 drawn on the ground (y = 0).
    (
        Profile::Polygon(vec![(10.0, -5.0), (20.0, -5.0), (20.0, 5.0), (10.0, 5.0)]),
        ground(0.0),
    )
}

#[test]
fn revolve_turns_a_rectangle_into_a_ring() {
    let k = Occt;
    let (profile, frame) = ring_profile();
    // About the z axis through the origin: the rectangle sweeps a ring 10 tall in z.
    let full = form::tool(
        &k,
        &FormParams {
            profile: profile.clone(),
            frame,
            kind: FormKind::Revolve {
                axis_point: DVec3::ZERO,
                axis_dir: DVec3::Z,
                angle: 2.0 * PI,
                thickness: 0.0,
            },
            operation: Operation::NewBody,
        },
    )
    .unwrap();
    close(volume(&k, &full), PI * (400.0 - 100.0) * 10.0, 1.0);
    assert!(k.is_valid(&full));
    let quarter = form::tool(
        &k,
        &FormParams {
            profile,
            frame,
            kind: FormKind::Revolve {
                axis_point: DVec3::ZERO,
                axis_dir: DVec3::Z,
                angle: PI / 2.0,
                thickness: 0.0,
            },
            operation: Operation::NewBody,
        },
    )
    .unwrap();
    close(volume(&k, &quarter), PI * 300.0 * 10.0 / 4.0, 0.5);
}

#[test]
fn revolve_through_its_own_profile_is_refused() {
    let k = Occt;
    let (profile, frame) = ring_profile();
    // An axis across the middle of the rectangle would make the solid pass through itself.
    let p = FormParams {
        profile,
        frame,
        kind: FormKind::Revolve {
            axis_point: DVec3::new(15.0, 0.0, 0.0),
            axis_dir: DVec3::Z,
            angle: 2.0 * PI,
            thickness: 0.0,
        },
        operation: Operation::NewBody,
    };
    assert!(form(&k, None, &p).is_err());
}

#[test]
fn loft_makes_a_frustum_between_two_squares_and_two_circles() {
    let k = Occt;
    let sq = form::tool(
        &k,
        &FormParams {
            profile: square(20.0),
            frame: ground(0.0),
            kind: FormKind::Loft {
                more: vec![(square(10.0), ground(30.0))],
                guides: vec![],
            },
            operation: Operation::NewBody,
        },
    )
    .unwrap();
    close(volume(&k, &sq), 30.0 / 3.0 * (400.0 + 100.0 + 200.0), 0.5);
    let circle = |r| Profile::Circle {
        center: (0.0, 0.0),
        radius: r,
    };
    let cone = form::tool(
        &k,
        &FormParams {
            profile: circle(10.0),
            frame: ground(0.0),
            kind: FormKind::Loft {
                more: vec![(circle(5.0), ground(20.0))],
                guides: vec![],
            },
            operation: Operation::NewBody,
        },
    )
    .unwrap();
    close(
        volume(&k, &cone),
        PI * 20.0 / 3.0 * (100.0 + 25.0 + 50.0),
        1.0,
    );
    let one = FormParams {
        profile: square(20.0),
        frame: ground(0.0),
        kind: FormKind::Loft { more: vec![], guides: vec![] },
        operation: Operation::NewBody,
    };
    assert!(form::tool(&k, &one).is_err());
}

/// A circle of radius 2 drawn facing +x at the origin, the start of a sweep along x.
fn rod() -> (Profile, Frame) {
    (
        Profile::Circle {
            center: (0.0, 0.0),
            radius: 2.0,
        },
        Frame::new(DVec3::ZERO, DVec3::Y, DVec3::X),
    )
}

fn sweep(
    profile: Profile,
    frame: Frame,
    points: Vec<DVec3>,
    twist: f64,
    scale: f64,
) -> Result<Shape, KernelError> {
    form::tool(
        &Occt,
        &FormParams {
            profile,
            frame,
            kind: FormKind::Sweep {
                path: Path::Polyline {
                    points,
                    closed: false,
                },
                twist,
                scale,
                guides: vec![],
                method: Default::default(),
                align: Default::default(),
                round: false,
            },
            operation: Operation::NewBody,
        },
    )
}

#[test]
fn sweep_runs_a_profile_along_straight_and_bent_paths() {
    let k = Occt;
    let (p, f) = rod();
    let straight = sweep(
        p.clone(),
        f,
        vec![DVec3::ZERO, DVec3::new(50.0, 0.0, 0.0)],
        0.0,
        1.0,
    )
    .unwrap();
    close(volume(&k, &straight), PI * 4.0 * 50.0, 0.5);
    // A mitred corner keeps the volume at area × centre-line length.
    let bent = sweep(
        p,
        f,
        vec![
            DVec3::ZERO,
            DVec3::new(50.0, 0.0, 0.0),
            DVec3::new(50.0, 0.0, 50.0),
        ],
        0.0,
        1.0,
    )
    .unwrap();
    assert!(k.is_valid(&bent));
    close(volume(&k, &bent), PI * 4.0 * 100.0, 1.0);
}

#[test]
fn sweep_twists_and_scales_its_far_end() {
    let k = Occt;
    let f = Frame::new(DVec3::ZERO, DVec3::Y, DVec3::X);
    let path = vec![DVec3::ZERO, DVec3::new(50.0, 0.0, 0.0)];
    // A twisted prism keeps area × length.
    let twisted = sweep(square(10.0), f, path.clone(), PI / 4.0, 1.0).unwrap();
    close(volume(&k, &twisted), 100.0 * 50.0, 5.0);
    let t = k.tessellate(&twisted, 0.01).unwrap();
    assert!(
        t.face_planes.iter().filter(|p| p.is_none()).count() >= 4,
        "the sides are curved by the twist"
    );
    // Scaling the end to half makes a frustum.
    let tapered = sweep(square(10.0), f, path, 0.0, 0.5).unwrap();
    close(
        volume(&k, &tapered),
        50.0 / 3.0 * (100.0 + 25.0 + 50.0),
        5.0,
    );
}

#[test]
fn forms_from_drawn_regions_join_or_cut_the_body_they_sit_on() {
    let mut doc = Document::new(Occt);
    let a = doc.add(enclosure(&doc.kernel));
    // A 10 × 10 square on the top face, and a line from its centre straight up as a path.
    let square_on_top = Curve {
        origin: [0.0, 30.0, 0.0],
        x: [1.0, 0.0, 0.0],
        normal: [0.0, 1.0, 0.0],
        shape: CurveShape::Polyline {
            points: vec![[-5.0, -5.0], [5.0, -5.0], [5.0, 5.0], [-5.0, 5.0]],
            closed: true,
        },
    };
    let up = Curve {
        origin: [0.0, 30.0, 0.0],
        x: [1.0, 0.0, 0.0],
        normal: [0.0, 0.0, 1.0],
        shape: CurveShape::Polyline {
            points: vec![[0.0, 0.0], [0.0, 20.0]],
            closed: false,
        },
    };
    let ids = doc.commit_curves(vec![square_on_top, up]).unwrap();
    // Sweep it up 20 mm and join: a boss.
    let p = doc
        .form_params(
            &ids[..1],
            FormRequest::Sweep {
                path: ids[1],
                twist: 0.0,
                scale: 1.0,
            },
            Operation::Union,
        )
        .unwrap();
    assert_eq!(doc.commit_form(Some(a), &p).unwrap(), a);
    close(
        volume(&doc.kernel, doc.get(a).unwrap()),
        120_000.0 + 2_000.0,
        1.0,
    );
    // Revolve it half a turn down about its own edge (x = 5, along z), cutting: a half drum.
    let r = doc
        .form_params(
            &ids[..1],
            FormRequest::Revolve {
                axis_point: DVec3::new(5.0, 30.0, 0.0),
                axis_dir: DVec3::Z,
                angle: PI,
                thickness: 0.0,
            },
            Operation::Difference,
        )
        .unwrap();
    let ExtrudeResult::Replace { solid, .. } = doc.preview_form(Some(a), &r).unwrap() else {
        panic!("expected a cut")
    };
    close(
        volume(&doc.kernel, &solid),
        122_000.0 - PI * 100.0 * 10.0 / 2.0,
        2.0,
    );
    // New body by default when nothing is asked for.
    let n = doc
        .form_params(
            &ids[..1],
            FormRequest::Sweep {
                path: ids[1],
                twist: 0.0,
                scale: 1.0,
            },
            Operation::NewBody,
        )
        .unwrap();
    let b = doc.commit_form(Some(a), &n).unwrap();
    assert_ne!(a, b);
    assert!(doc
        .form_params(
            &ids[..1],
            FormRequest::Sweep {
                path: ids[0],
                twist: 0.0,
                scale: 1.0
            },
            Operation::NewBody
        )
        .is_err());
    assert!(
        doc.form_params(&ids[1..], FormRequest::Loft, Operation::NewBody)
            .is_err(),
        "an open line has no region"
    );
    assert!(doc.undo());
    assert!(doc.undo());
    close(volume(&doc.kernel, doc.get(a).unwrap()), 120_000.0, 1e-3);
}

/// A step: a 10 wide, 20 tall block with a 20 long, 5 tall ledge beyond it (all 20 deep). The
/// block's inner wall over the ledge, at x = 10, is the concave face the grow modes are about.
fn step(k: &Occt) -> Shape {
    let tall = k.box_from_corners(DVec3::ZERO, DVec3::new(10.0, 20.0, 20.0));
    let ledge = k.box_from_corners(DVec3::new(10.0, 0.0, 0.0), DVec3::new(30.0, 20.0, 5.0));
    k.boolean(&tall, &ledge, BooleanOp::Union).unwrap().solid
}

#[test]
fn offset_face_grow_modes_past_the_outer_wall() {
    let k = Occt;
    let body = step(&k);
    let wall = faces_facing(&k, &body, DVec3::new(10.0, 0.0, 0.0), DVec3::X);
    assert_eq!(wall.len(), 1);
    let start = volume(&k, &body);
    close(start, 10.0 * 20.0 * 20.0 + 20.0 * 20.0 * 5.0, 0.5);
    let grown = |d: f64, g: Grow| volume(&k, &offset_faces_grow(&k, &body, &wall, d, 0.0, g).unwrap().solid);
    // Short of the outer wall (20 away) the modes agree: the block widens over the ledge.
    for g in [Grow::Moving, Grow::Fixed, Grow::None] {
        close(grown(8.0, g), start + 8.0 * 20.0 * 15.0, 0.5);
    }
    // 25 out: Fixed stops at the wall, so the block fills the ledge to x = 30.
    close(grown(25.0, Grow::Fixed), 30.0 * 20.0 * 20.0, 0.5);
    // None carries on by itself: the block overhangs to x = 35, the ledge still ends at x = 30.
    close(grown(25.0, Grow::None), 30.0 * 20.0 * 20.0 + 5.0 * 20.0 * 15.0, 0.5);
    // Moving takes the wall along: everything ends at x = 35.
    close(grown(25.0, Grow::Moving), 35.0 * 20.0 * 20.0, 0.5);
    let moved = offset_faces_grow(&k, &body, &wall, 25.0, 0.0, Grow::Moving).unwrap().solid;
    assert!(k.is_valid(&moved));
    assert_eq!(k.face_count(&moved), 6, "a plain block");
}
