//! Round 6: Box, Cylinder, Sphere, Shell, Mirror and arrays, checked against hand-computed volumes
//! (the same numbers as web/test/solids.test.js). Units are mm.

#![cfg(feature = "occt")]

use std::f64::consts::{PI, TAU};

use glam::DVec3;
use opencascade::primitives::Shape;
use w3d_kernel::document::Document;
use w3d_kernel::occt::Occt;
use w3d_kernel::solids::{mirror, primitive, shell};
use w3d_kernel::*;

fn close(a: f64, b: f64, eps: f64) {
    assert!((a - b).abs() < eps, "{a} != {b} (±{eps})")
}

fn volume(k: &Occt, s: &Shape) -> f64 {
    k.tessellate(s, 0.002).unwrap().volume()
}

fn ground() -> Frame { Frame::new(DVec3::ZERO, DVec3::X, DVec3::Y) }
fn cube(k: &Occt) -> Shape { k.box_from_corners(DVec3::ZERO, DVec3::splat(10.0)) }

#[test]
fn primitives_have_exact_volumes_whichever_way_they_are_dragged() {
    let k = Occt;
    for (w, d, h) in [(10.0, 20.0, 30.0), (-10.0, 20.0, -30.0), (10.0, -20.0, 30.0)] {
        let s = primitive(&k, &Primitive::Box { frame: ground(), width: w, depth: d, height: h }).unwrap();
        close(volume(&k, &s), 6000.0, 1e-6);
        assert_eq!(k.face_count(&s), 6);
    }
    let tilted = Frame::new(DVec3::splat(5.0), DVec3::new(1.0, 1.0, 0.0), DVec3::Z);
    close(volume(&k, &primitive(&k, &Primitive::Box { frame: tilted, width: 4.0, depth: 5.0, height: 6.0 }).unwrap()), 120.0, 1e-6);
    // Meshes sit inside curved surfaces, so curved volumes run slightly low.
    close(volume(&k, &primitive(&k, &Primitive::Cylinder { frame: ground(), radius: 5.0, height: -10.0 }).unwrap()), PI * 250.0, 0.5);
    close(volume(&k, &primitive(&k, &Primitive::Sphere { center: DVec3::new(1.0, 2.0, 3.0), radius: 3.0 }).unwrap()), 4.0 / 3.0 * PI * 27.0, 0.5);
}

#[test]
fn primitives_refuse_sizes_that_make_nothing() {
    let k = Occt;
    let bad = [
        Primitive::Box { frame: ground(), width: 0.0, depth: 1.0, height: 1.0 },
        Primitive::Box { frame: ground(), width: f64::NAN, depth: 1.0, height: 1.0 },
        Primitive::Cylinder { frame: ground(), radius: -1.0, height: 1.0 },
        Primitive::Cylinder { frame: ground(), radius: 1.0, height: 0.0 },
        Primitive::Sphere { center: DVec3::ZERO, radius: 0.0 },
    ];
    for p in bad { assert!(matches!(primitive(&k, &p), Err(KernelError::Invalid(_))), "{p:?}") }
}

#[test]
fn shell_hollows_a_cube_and_traces_the_outer_faces() {
    let k = Occt;
    let t = shell(&k, &cube(&k), &[0], 1.0).unwrap();
    close(volume(&k, &t.solid), 1000.0 - 8.0 * 8.0 * 9.0, 1e-6);
    assert_eq!(k.face_count(&t.solid), 11);
    assert!(k.is_valid(&t.solid));
    assert!(t.history.faces[0].len() >= 5, "the closed outer faces keep where they came from");
}

#[test]
fn shell_refuses_impossible_requests() {
    let k = Occt;
    let c = cube(&k);
    assert!(matches!(shell(&k, &c, &[], 1.0), Err(KernelError::Invalid(_))));
    assert!(matches!(shell(&k, &c, &[0], 0.0), Err(KernelError::Invalid(_))));
    assert!(matches!(shell(&k, &c, &[9], 1.0), Err(KernelError::Invalid(_))));
    assert!(matches!(shell(&k, &c, &[0, 1, 2, 3, 4, 5], 1.0), Err(KernelError::Invalid(_))));
    assert!(shell(&k, &c, &[0], 6.0).is_err(), "walls thicker than half the cube");
}

#[test]
fn mirror_reflects_without_changing_size() {
    let k = Occt;
    let m = mirror(&k, &cube(&k), DVec3::new(20.0, 0.0, 0.0), DVec3::X).unwrap();
    close(volume(&k, &m), 1000.0, 1e-6);
    assert!(k.is_valid(&m));
    let xs: Vec<f64> = k.tessellate(&m, 0.01).unwrap().positions.iter().map(|p| p[0]).collect();
    close(xs.iter().cloned().fold(f64::MAX, f64::min), 30.0, 1e-9);
    close(xs.iter().cloned().fold(f64::MIN, f64::max), 40.0, 1e-9);
    assert!(mirror(&k, &cube(&k), DVec3::ZERO, DVec3::ZERO).is_err());
}

#[test]
fn array_motions_count_copies_and_spread_a_full_turn() {
    let rect = ArraySpec::Rectangular { steps: [DVec3::X * 15.0, DVec3::Z * 15.0, DVec3::ZERO], counts: [2, 3, 1] };
    assert_eq!(rect.motions().unwrap().len(), 5);
    let full = ArraySpec::Radial { pivot: DVec3::ZERO, axis: DVec3::Y, angle: TAU, count: 4 };
    let angles: Vec<f64> = full.motions().unwrap().iter().map(|m| m.angle).collect();
    for (a, b) in angles.iter().zip([PI / 2.0, PI, 1.5 * PI]) { close(*a, b, 1e-12) }
    let half = ArraySpec::Radial { pivot: DVec3::ZERO, axis: DVec3::Y, angle: PI, count: 3 };
    close(half.motions().unwrap()[1].angle, PI, 1e-12);
    assert!(matches!(ArraySpec::Rectangular { steps: [DVec3::ZERO; 3], counts: [3, 1, 1] }.motions(), Err(KernelError::Invalid(_))));
    assert!(matches!(ArraySpec::Rectangular { steps: [DVec3::X; 3], counts: [20, 20, 20] }.motions(), Err(KernelError::Invalid(_))));
    assert!(matches!(ArraySpec::Radial { pivot: DVec3::ZERO, axis: DVec3::Y, angle: 1.0, count: 1 }.motions(), Err(KernelError::NoOp)));
}

#[test]
fn document_runs_each_as_one_undo_step() {
    let mut doc = Document::new(Occt);
    let seed = doc.add(doc.kernel.box_from_corners(DVec3::new(-40.0, 0.0, -25.0), DVec3::new(40.0, 30.0, 25.0)));
    doc.clear_history();
    let vol = |doc: &Document<Occt>, id| volume(&doc.kernel, doc.get(id).unwrap());

    let s = doc.commit_primitive(&Primitive::Sphere { center: DVec3::new(0.0, 100.0, 0.0), radius: 5.0 }, None, Operation::NewBody).unwrap();
    assert_eq!(doc.ids().len(), 2);
    assert!(doc.undo());
    assert!(doc.get(s).is_none());

    let before = vol(&doc, seed);
    let shelled = doc.preview_shell(seed, &[0], 2.0).unwrap();
    assert!(volume(&doc.kernel, &shelled) < before);
    close(vol(&doc, seed), before, 1e-6);
    doc.commit_shell(seed, &[0], 2.0).unwrap();
    assert!(vol(&doc, seed) < before);
    assert!(doc.undo());
    close(vol(&doc, seed), before, 1e-6);

    let copies = doc.commit_mirror(&[seed], DVec3::new(60.0, 0.0, 0.0), DVec3::X, false).unwrap();
    assert_eq!((copies.len(), doc.ids().len()), (1, 2));
    assert!(doc.undo());
    let joined = doc.commit_mirror(&[seed], DVec3::new(40.0, 0.0, 0.0), DVec3::X, true).unwrap();
    assert_eq!(joined, vec![seed]);
    close(vol(&doc, seed), 2.0 * before, 1e-3);
    assert!(doc.undo());

    let spec = ArraySpec::Rectangular { steps: [DVec3::X * 100.0, DVec3::ZERO, DVec3::ZERO], counts: [3, 1, 1] };
    assert_eq!(doc.commit_array(&[seed], &spec, false).unwrap().len(), 2);
    assert_eq!(doc.ids().len(), 3);
    assert!(doc.undo());
    assert_eq!(doc.ids().len(), 1);
    assert!(!doc.undo(), "every step above undid in one");

    // A cylinder drawn on the top face cuts a pocket with W, as one step.
    let top = Frame::new(DVec3::new(0.0, 30.0, 0.0), DVec3::X, DVec3::Y);
    let pocket = Primitive::Cylinder { frame: top, radius: 5.0, height: -10.0 };
    doc.commit_primitive(&pocket, Some(seed), Operation::Difference).unwrap();
    close(vol(&doc, seed), before - std::f64::consts::PI * 250.0, 0.5);
    assert_eq!(doc.ids().len(), 1);
    assert!(doc.undo());
    assert!(matches!(doc.preview_primitive(&Primitive::Sphere { center: DVec3::new(0.0, 500.0, 0.0), radius: 1.0 }, Some(seed), Operation::Difference), Err(KernelError::Invalid(_))));
}

#[test]
fn remove_face_takes_a_round_back_off() {
    let k = Occt;
    let c = cube(&k);
    let rounded = k.blend(&c, &[0], 2.0, Blend::Fillet, 0.0).unwrap();
    let round = rounded.history.generated_faces.first().expect("the round grew from edge 0").1;
    assert!(volume(&k, &rounded.solid) < 1000.0);
    let back = w3d_kernel::solids::remove_faces(&k, &rounded.solid, &[round]).unwrap();
    close(volume(&k, &back.solid), 1000.0, 1e-6);
    assert_eq!(k.face_count(&back.solid), 6);
    assert!(matches!(w3d_kernel::solids::remove_faces(&k, &c, &[]), Err(KernelError::Invalid(_))));
    assert!(matches!(w3d_kernel::solids::remove_faces(&k, &c, &[0, 1, 2, 3, 4, 5]), Err(KernelError::Invalid(_))));
}

#[test]
fn a_closed_control_point_curve_extrudes() {
    let k = Occt;
    let square = vec![(0.0, 0.0), (20.0, 0.0), (20.0, 20.0), (0.0, 20.0)];
    let s = k.extrude(&Profile::Cv(square), &ground(), &Extent::to(5.0)).unwrap();
    let v = volume(&k, &s);
    // Inside the 20 × 20 control square, outside the circle inscribed in the inner square.
    assert!(v > 5.0 * PI * 25.0 && v < 5.0 * 400.0, "volume {v}");
    assert!(k.is_valid(&s));
}

#[test]
fn iges_round_trip_keeps_the_solid() {
    let k = Occt;
    let path = std::env::temp_dir().join("w3d-round-trip.igs");
    let original = k.extrude(&Profile::Circle { center: (0.0, 0.0), radius: 5.0 }, &ground(), &Extent::to(10.0)).unwrap();
    k.write_iges(&original, &path).unwrap();
    assert!(std::fs::read_to_string(&path).unwrap().lines().next().unwrap().len() >= 72, "IGES is fixed-width 80-column text");
    let back = k.read_iges(&path).unwrap();
    // IGES carries surfaces; after repair the cylinder's faces come back.
    assert!(k.face_count(&back) >= 3);
    assert!(k.read_iges(&std::env::temp_dir().join("w3d-missing.igs")).is_err());
}

#[test]
fn cut_splits_a_block_along_a_drawn_line() {
    let mut doc = Document::new(Occt);
    let block = doc.add(doc.kernel.box_from_corners(DVec3::new(-40.0, 0.0, -25.0), DVec3::new(40.0, 30.0, 25.0)));
    doc.clear_history();
    let ground = [0.0, 0.0, 0.0];
    let line = doc.commit_curves(vec![Curve { origin: ground, x: [1.0, 0.0, 0.0], normal: [0.0, 1.0, 0.0], shape: CurveShape::Polyline { points: vec![[10.0, -100.0], [10.0, 100.0]], closed: false } }]).unwrap()[0];
    let ids = doc.commit_cut(&[block], &[line]).unwrap();
    assert_eq!(ids.len(), 2);
    assert_eq!(ids[0], block, "the bigger piece keeps the id");
    close(volume(&doc.kernel, doc.get(ids[0]).unwrap()), 50.0 * 30.0 * 50.0, 1e-6);
    close(volume(&doc.kernel, doc.get(ids[1]).unwrap()), 30.0 * 30.0 * 50.0, 1e-6);
    assert!(doc.undo());
    assert_eq!(doc.ids().len(), 1);
    let miss = doc.commit_curves(vec![Curve { origin: ground, x: [1.0, 0.0, 0.0], normal: [0.0, 1.0, 0.0], shape: CurveShape::Polyline { points: vec![[300.0, -100.0], [300.0, 100.0]], closed: false } }]).unwrap()[0];
    assert!(doc.commit_cut(&[block], &[miss]).is_err());
}

#[test]
fn imprint_splits_faces_and_keeps_the_body_whole() {
    let mut doc = Document::new(Occt);
    let block = doc.add(doc.kernel.box_from_corners(DVec3::new(-40.0, 0.0, -25.0), DVec3::new(40.0, 30.0, 25.0)));
    doc.clear_history();
    let ground = [0.0, 0.0, 0.0];
    let line = doc.commit_curves(vec![Curve { origin: ground, x: [1.0, 0.0, 0.0], normal: [0.0, 1.0, 0.0], shape: CurveShape::Polyline { points: vec![[10.0, -100.0], [10.0, 100.0]], closed: false } }]).unwrap()[0];
    // Every face the line's sheet crosses: top, bottom, front and back.
    let id = doc.commit_imprint(block, &[], &[line], false).unwrap();
    assert_eq!(id, block);
    assert_eq!(doc.ids().len(), 1, "the body stays whole");
    assert_eq!(doc.kernel.face_count(doc.get(block).unwrap()), 10);
    close(volume(&doc.kernel, doc.get(block).unwrap()), 80.0 * 30.0 * 50.0, 1e-6);
    assert!(doc.undo());
    assert_eq!(doc.kernel.face_count(doc.get(block).unwrap()), 6);
    // One face only, and the knife's way: the curve is used up.
    let top = (0..6).find(|&f| doc.preview_imprint(block, &[f], &[line]).is_ok()).unwrap();
    doc.commit_imprint(block, &[top], &[line], true).unwrap();
    assert_eq!(doc.kernel.face_count(doc.get(block).unwrap()), 7);
    assert!(doc.curve(line).is_none(), "the knife uses its curve up");
    let miss = doc.commit_curves(vec![Curve { origin: ground, x: [1.0, 0.0, 0.0], normal: [0.0, 1.0, 0.0], shape: CurveShape::Polyline { points: vec![[300.0, -100.0], [300.0, 100.0]], closed: false } }]).unwrap()[0];
    assert!(doc.commit_imprint(block, &[], &[miss], false).is_err());
}
