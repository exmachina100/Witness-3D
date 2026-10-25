//! Round 6: Box, Cylinder, Sphere, Shell, Mirror and arrays, checked against hand-computed volumes
//! (the same numbers as web/test/solids.test.js). Units are mm.

#![cfg(feature = "occt")]

use std::f64::consts::{PI, TAU};

use glam::DVec3;
use opencascade::primitives::Shape;
use w3d_kernel::document::{Document, ToolFace, ToolPlane, Tools};
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
fn curve_array_motions_pass_through_with_unit_axis_and_scale() {
    let m = Motion { offset: DVec3::X * 10.0, pivot: DVec3::ZERO, axis: DVec3::Y * 3.0, angle: 0.5, scale: 7.0 };
    let out = ArraySpec::Motions(vec![m]).motions().unwrap();
    assert_eq!(out.len(), 1);
    close(out[0].axis.length(), 1.0, 1e-12);
    close(out[0].scale, 1.0, 1e-12);
    close(out[0].angle, 0.5, 1e-12);
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
    // T keeps the cylinder too: the pocket and the cylinder as a body of its own, one step.
    let (cut, kept) = doc.commit_primitive_keeping(&pocket, seed, Operation::Difference).unwrap();
    assert_eq!(cut, seed);
    close(vol(&doc, seed), before - std::f64::consts::PI * 250.0, 0.5);
    close(vol(&doc, kept), std::f64::consts::PI * 250.0, 0.5);
    assert!(doc.undo());
    assert_eq!(doc.ids().len(), 1);
    assert!(doc.commit_primitive_keeping(&pocket, seed, Operation::NewBody).is_err());
    assert!(matches!(doc.preview_primitive(&Primitive::Sphere { center: DVec3::new(0.0, 500.0, 0.0), radius: 1.0 }, Some(seed), Operation::Difference), Err(KernelError::Invalid(_))));
}

#[test]
fn remove_face_takes_a_round_back_off() {
    let k = Occt;
    let c = cube(&k);
    let rounded = k.blend(&c, &[0], 2.0, Blend::Fillet, 0.0, &[]).unwrap();
    let round = rounded.history.generated_faces.first().expect("the round grew from edge 0").1;
    assert!(volume(&k, &rounded.solid) < 1000.0);
    let back = w3d_kernel::solids::remove_faces(&k, &rounded.solid, &[round]).unwrap();
    close(volume(&k, &back.solid), 1000.0, 1e-6);
    assert_eq!(k.face_count(&back.solid), 6);
    assert!(matches!(w3d_kernel::solids::remove_faces(&k, &c, &[]), Err(KernelError::Invalid(_))));
    assert!(matches!(w3d_kernel::solids::remove_faces(&k, &c, &[0, 1, 2, 3, 4, 5]), Err(KernelError::Invalid(_))));
}

#[test]
fn remove_fillets_finds_the_rounds_and_takes_them_off() {
    let k = Occt;
    let c = cube(&k);
    assert!(k.fillet_faces(&c, &[]).is_empty(), "a plain cube has no fillets");
    let all: Vec<u32> = (0..k.edge_count(&c) as u32).collect();
    let rounded = k.blend(&c, &all, 1.0, Blend::Fillet, 0.0, &[]).unwrap().solid;
    let found = k.fillet_faces(&rounded, &[]);
    assert_eq!(found.len(), k.face_count(&rounded) - 6, "every round and corner ball, no flat face");
    let back = w3d_kernel::solids::remove_faces(&k, &rounded, &found).unwrap();
    close(volume(&k, &back.solid), 1000.0, 1e-6);
    assert_eq!(k.face_count(&back.solid), 6);
    // One edge rounded: a seed on it gives just that round; a flat face is no seed.
    let one = k.blend(&c, &[0], 2.0, Blend::Fillet, 0.0, &[]).unwrap();
    let round = one.history.generated_faces.first().unwrap().1;
    assert_eq!(k.fillet_faces(&one.solid, &[round]), vec![round]);
    let flat = (0..k.face_count(&one.solid) as u32).find(|&f| f != round).unwrap();
    assert!(k.fillet_faces(&one.solid, &[flat]).is_empty());
    // A cylinder rounded at both rims: the two rims are fillets, the side between them is not.
    let cyl = primitive(&k, &w3d_kernel::solids::Primitive::Cylinder { frame: Frame::new(DVec3::ZERO, DVec3::X, DVec3::Z), radius: 5.0, height: 10.0 }).unwrap();
    assert!(k.fillet_faces(&cyl, &[]).is_empty());
    let rims: Vec<u32> = (0..k.edge_count(&cyl) as u32).collect();
    let soft = k.blend(&cyl, &rims, 1.0, Blend::Fillet, 0.0, &[]).unwrap().solid;
    assert_eq!(k.fillet_faces(&soft, &[]).len(), 2);
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
    let ids = doc.commit_cut(&[block], &[line], &Tools::default()).unwrap();
    assert_eq!(ids.len(), 2);
    assert_eq!(ids[0], block, "the bigger piece keeps the id");
    close(volume(&doc.kernel, doc.get(ids[0]).unwrap()), 50.0 * 30.0 * 50.0, 1e-6);
    close(volume(&doc.kernel, doc.get(ids[1]).unwrap()), 30.0 * 30.0 * 50.0, 1e-6);
    assert!(doc.undo());
    assert_eq!(doc.ids().len(), 1);
    let miss = doc.commit_curves(vec![Curve { origin: ground, x: [1.0, 0.0, 0.0], normal: [0.0, 1.0, 0.0], shape: CurveShape::Polyline { points: vec![[300.0, -100.0], [300.0, 100.0]], closed: false } }]).unwrap()[0];
    assert!(doc.commit_cut(&[block], &[miss], &Tools::default()).is_err());
}

#[test]
fn imprint_splits_faces_and_keeps_the_body_whole() {
    let mut doc = Document::new(Occt);
    let block = doc.add(doc.kernel.box_from_corners(DVec3::new(-40.0, 0.0, -25.0), DVec3::new(40.0, 30.0, 25.0)));
    doc.clear_history();
    let ground = [0.0, 0.0, 0.0];
    let line = doc.commit_curves(vec![Curve { origin: ground, x: [1.0, 0.0, 0.0], normal: [0.0, 1.0, 0.0], shape: CurveShape::Polyline { points: vec![[10.0, -100.0], [10.0, 100.0]], closed: false } }]).unwrap()[0];
    // Every face the line's sheet crosses: top, bottom, front and back.
    let id = doc.commit_imprint(block, &[], &[line], &Tools::default(), false).unwrap();
    assert_eq!(id, block);
    assert_eq!(doc.ids().len(), 1, "the body stays whole");
    assert_eq!(doc.kernel.face_count(doc.get(block).unwrap()), 10);
    close(volume(&doc.kernel, doc.get(block).unwrap()), 80.0 * 30.0 * 50.0, 1e-6);
    assert!(doc.undo());
    assert_eq!(doc.kernel.face_count(doc.get(block).unwrap()), 6);
    // One face only, and the knife's way: the curve is used up.
    let top = (0..6).find(|&f| doc.preview_imprint(block, &[f], &[line], &Tools::default()).is_ok()).unwrap();
    doc.commit_imprint(block, &[top], &[line], &Tools::default(), true).unwrap();
    assert_eq!(doc.kernel.face_count(doc.get(block).unwrap()), 7);
    assert!(doc.curve(line).is_none(), "the knife uses its curve up");
    let miss = doc.commit_curves(vec![Curve { origin: ground, x: [1.0, 0.0, 0.0], normal: [0.0, 1.0, 0.0], shape: CurveShape::Polyline { points: vec![[300.0, -100.0], [300.0, 100.0]], closed: false } }]).unwrap()[0];
    assert!(doc.commit_imprint(block, &[], &[miss], &Tools::default(), false).is_err());
    // A curve given inline (Offset Edge's), not kept in the document: a loop 5 mm inside the top.
    let top_y = 30.0;
    let ring = Curve { origin: [0.0, top_y, 0.0], x: [1.0, 0.0, 0.0], normal: [0.0, 1.0, 0.0], shape: CurveShape::Polyline { points: vec![[-35.0, -20.0], [35.0, -20.0], [35.0, 20.0], [-35.0, 20.0]], closed: true } };
    let before = doc.kernel.face_count(doc.get(block).unwrap());
    let curves = doc.curve_ids().len();
    doc.commit_imprint(block, &[top], &[], &Tools { shapes: vec![ring], ..Tools::default() }, false).unwrap();
    assert_eq!(doc.kernel.face_count(doc.get(block).unwrap()), before + 1);
    assert_eq!(doc.curve_ids().len(), curves, "no curve is added");
}

#[test]
fn delete_redundant_topology_merges_faces_an_imprint_split() {
    let mut doc = Document::new(Occt);
    let block = doc.add(doc.kernel.box_from_corners(DVec3::new(-40.0, 0.0, -25.0), DVec3::new(40.0, 30.0, 25.0)));
    doc.clear_history();
    let line = doc.commit_curves(vec![Curve { origin: [0.0, 0.0, 0.0], x: [1.0, 0.0, 0.0], normal: [0.0, 1.0, 0.0], shape: CurveShape::Polyline { points: vec![[10.0, -100.0], [10.0, 100.0]], closed: false } }]).unwrap()[0];
    doc.commit_imprint(block, &[], &[line], &Tools::default(), false).unwrap();
    assert_eq!(doc.kernel.face_count(doc.get(block).unwrap()), 10);
    let (faces, edges) = doc.commit_unify(&[block]).unwrap();
    assert_eq!(doc.kernel.face_count(doc.get(block).unwrap()), 6);
    // The 4 imprinted edges, and the 4 long edges they had split in two.
    assert_eq!((faces, edges), (4, 8));
    close(volume(&doc.kernel, doc.get(block).unwrap()), 80.0 * 30.0 * 50.0, 1e-6);
    assert!(doc.undo());
    assert_eq!(doc.kernel.face_count(doc.get(block).unwrap()), 10);
}

#[test]
fn cut_with_a_plane_or_a_face_and_imprint_one_body_on_another() {
    let mut doc = Document::new(Occt);
    let block = doc.add(doc.kernel.box_from_corners(DVec3::new(-40.0, 0.0, -25.0), DVec3::new(40.0, 30.0, 25.0)));
    // A post standing through the block's top: x and z −10..10, y 20..40.
    let post = doc.add(doc.kernel.box_from_corners(DVec3::new(-10.0, 20.0, -10.0), DVec3::new(10.0, 40.0, 10.0)));
    doc.clear_history();
    let vols = |doc: &Document<Occt>, ids: &[u32]| { let mut v: Vec<f64> = ids.iter().map(|&i| volume(&doc.kernel, doc.get(i).unwrap())).collect(); v.sort_by(|a, b| b.partial_cmp(a).unwrap()); v };

    // The plane x = 10.
    let plane = Tools { plane: Some(ToolPlane { origin: [10.0, 0.0, 0.0], normal: [1.0, 0.0, 0.0] }), ..Tools::default() };
    let ids = doc.commit_cut(&[block], &[], &plane).unwrap();
    let v = vols(&doc, &ids);
    close(v[0], 50.0 * 30.0 * 50.0, 1e-6);
    close(v[1], 30.0 * 30.0 * 50.0, 1e-6);
    assert!(doc.undo());

    // A side of the post, grown into a plane, cuts the block at x = −10 or 10 (or z): 30 and 50 wide.
    let side = (0..6).find(|&f| {
        let t = Tools { faces: vec![ToolFace { body: post, face: f }], ..Tools::default() };
        doc.preview_cut(&[block], &[], &t).map(|r| r[0].2.len() == 1).unwrap_or(false)
    }).expect("a side of the post cuts the block");
    let ids = doc.commit_cut(&[block], &[], &Tools { faces: vec![ToolFace { body: post, face: side }], ..Tools::default() }).unwrap();
    assert_eq!(ids.len(), 2);
    assert!(doc.undo());

    // The post imprints its outline on the block's top; the block stays one body.
    let faces = doc.kernel.face_count(doc.get(block).unwrap());
    doc.commit_imprint(block, &[], &[], &Tools { bodies: vec![post], ..Tools::default() }, false).unwrap();
    assert_eq!(doc.kernel.face_count(doc.get(block).unwrap()), faces + 1);
    close(volume(&doc.kernel, doc.get(block).unwrap()), 80.0 * 30.0 * 50.0, 1e-6);
    // Nothing to cut with is refused.
    assert!(doc.commit_cut(&[block], &[], &Tools::default()).is_err());
}

#[test]
fn draft_closes_the_sides_of_a_block_in_along_the_pull() {
    let mut doc = Document::new(Occt);
    let block = doc.add(doc.kernel.box_from_corners(DVec3::new(-10.0, 0.0, -10.0), DVec3::new(10.0, 20.0, 10.0)));
    doc.clear_history();
    // The four sides: the faces the pull (up) can draft; the top and bottom are refused one by one.
    let sides: Vec<u32> = (0..6).filter(|&f| doc.preview_draft(block, &[f], DVec3::Y, DVec3::ZERO, 0.05).is_ok()).collect();
    assert_eq!(sides.len(), 4);
    let angle = 5f64.to_radians();
    doc.commit_draft(block, &sides, DVec3::Y, DVec3::ZERO, angle).unwrap();
    // A frustum: 20 × 20 at the base, closing in by 20·tan 5° on each side over its 20 height.
    let t = 20.0 - 2.0 * 20.0 * angle.tan();
    close(volume(&doc.kernel, doc.get(block).unwrap()), 20.0 / 3.0 * (400.0 + t * t + 20.0 * t), 1e-6);
    assert!(doc.undo());
    assert!(doc.commit_draft(block, &sides, DVec3::Y, DVec3::ZERO, 0.0).is_err());
}

#[test]
fn isoparam_on_a_cylinder_side_rings_it_or_runs_its_height() {
    let k = Occt;
    let cyl = primitive(&k, &w3d_kernel::solids::Primitive::Cylinder { frame: ground(), radius: 5.0, height: 10.0 }).unwrap();
    let at = DVec3::new(5.0, 4.0, 0.0);
    let poles = |p: &Path| match p { Path::Nurbs { poles, .. } => poles.clone(), _ => panic!("a NURBS curve") };
    // The side is the face both directions work on and whose curves pass through the point.
    let mut found = 0;
    for face in 0..k.face_count(&cyl) as u32 {
        let (Ok(a), Ok(b)) = (k.isoparam(&cyl, face, at, true), k.isoparam(&cyl, face, at, false)) else { continue };
        let (a, b) = (poles(&a[0]), poles(&b[0]));
        let ring = if a.iter().all(|p| (p.y - 4.0).abs() < 1e-6) { &a } else { &b };
        let line = if std::ptr::eq(ring, &a) { &b } else { &a };
        if !ring.iter().all(|p| (p.y - 4.0).abs() < 1e-6) { continue }
        assert!(ring.iter().all(|p| p.x.hypot(p.z) > 5.0 - 1e-6));
        let ys: Vec<f64> = line.iter().map(|p| p.y).collect();
        close(ys.iter().copied().fold(f64::MAX, f64::min), 0.0, 1e-6);
        close(ys.iter().copied().fold(f64::MIN, f64::max), 10.0, 1e-6);
        found += 1;
    }
    assert_eq!(found, 1, "only the side gives a ring through the point");
    assert!(k.isoparam(&cyl, 99, at, true).is_err());
}

#[test]
fn a_fillet_is_made_again_at_a_new_radius() {
    let k = Occt;
    let c = cube(&k);
    // One edge of the 10 mm cube rounded at 2, then at 4: each takes away (r² − πr²/4) × 10.
    let taken = |r: f64| (r * r - PI * r * r / 4.0) * 10.0;
    let one = k.blend(&c, &[0], 2.0, Blend::Fillet, 0.0, &[]).unwrap();
    let round = one.history.generated_faces.first().unwrap().1;
    close(volume(&k, &one.solid), 1000.0 - taken(2.0), 0.1);
    let bigger = w3d_kernel::solids::refillet(&k, &one.solid, &[round], 4.0).unwrap();
    close(volume(&k, &bigger.solid), 1000.0 - taken(4.0), 0.1);
    assert_eq!(k.face_count(&bigger.solid), 7);
    // All edges rounded: one round resized among its neighbours' rounds.
    let all: Vec<u32> = (0..k.edge_count(&c) as u32).collect();
    let soft = k.blend(&c, &all, 1.0, Blend::Fillet, 0.0, &[]).unwrap().solid;
    let flat = (0..k.face_count(&soft) as u32).find(|&f| !k.fillet_faces(&soft, &[]).contains(&f)).unwrap();
    assert!(w3d_kernel::solids::refillet(&k, &soft, &[flat], 2.0).is_err(), "a flat face is no fillet");
    assert!(w3d_kernel::solids::refillet(&k, &one.solid, &[round], 0.0).is_err());
    assert!(w3d_kernel::solids::refillet(&k, &one.solid, &[round], 12.0).is_err(), "too big for the cube");
    // Its whole chain of rounds and corner balls made again at 2: a box rounded all over,
    // (a − 2r)³ + 6(a − 2r)²r + 3π(a − 2r)r² + 4πr³/3.
    let rounds = k.fillet_faces(&soft, &[]);
    let chain = k.fillet_faces(&soft, &rounds[..1]);
    let all_round = w3d_kernel::solids::refillet(&k, &soft, &chain, 2.0).unwrap();
    close(volume(&k, &all_round.solid), 216.0 + 6.0 * 36.0 * 2.0 + 3.0 * PI * 6.0 * 4.0 + 4.0 * PI * 8.0 / 3.0, 0.5);
}
