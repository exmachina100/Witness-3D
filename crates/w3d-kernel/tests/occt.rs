#![cfg(feature = "occt")]

use glam::DVec3;
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

fn close(a: f64, b: f64, eps: f64) { assert!((a - b).abs() < eps, "{a} != {b}") }

// A 4×4×4 box with a 1×1 square sketched on its top face, as in the web demo's tests.
fn setup() -> (Occt, opencascade::primitives::Shape, ExtrudeParams) {
    let k = Occt;
    let body = k.box_from_corners(DVec3::splat(-2.0), DVec3::splat(2.0));
    let params = ExtrudeParams {
        profile: Profile::rectangle(1.0, 1.0),
        frame: Frame::new(DVec3::new(0.0, 0.0, 2.0), DVec3::X, DVec3::Z),
        distance: 1.0,
        back: 0.0,
        angle: 0.0,
        thickness: 0.0,
        operation: Operation::Auto,
        face: None,
        direction: None, more_faces: vec![], individual: false,
    };
    (k, body, params)
}

fn volume(k: &Occt, s: &opencascade::primitives::Shape) -> f64 { k.tessellate(s, 0.001).unwrap().volume() }

#[test]
fn pulling_out_joins_into_one_solid() {
    let (k, body, p) = setup();
    let ExtrudeResult::Replace { solid, op, .. } = extrude(&k, Some(&body), &p).unwrap() else { panic!("expected a join") };
    assert_eq!(op, BooleanOp::Union);
    assert_eq!(k.solid_count(&solid), 1);
    assert_eq!(k.face_count(&solid), 11, "top faces merged: 6 box faces + 5 boss faces");
    close(volume(&k, &solid), 65.0, 1e-6);
}

#[test]
fn pushing_in_cuts_a_pocket() {
    let (k, body, mut p) = setup();
    p.distance = -1.5;
    let ExtrudeResult::Replace { solid, op, .. } = extrude(&k, Some(&body), &p).unwrap() else { panic!("expected a cut") };
    assert_eq!(op, BooleanOp::Difference);
    close(volume(&k, &solid), 62.5, 1e-6);
}

#[test]
fn circle_cuts_a_true_cylinder() {
    let (k, body, mut p) = setup();
    p.profile = Profile::Circle { center: (0.0, 0.0), radius: 0.6 };
    p.distance = -1.0;
    let ExtrudeResult::Replace { solid, .. } = extrude(&k, Some(&body), &p).unwrap() else { panic!() };
    // 6 box faces + cylinder wall + pocket floor: a polygon would add one face per side.
    assert_eq!(k.face_count(&solid), 8);
    // The mesh is a polygon inside the true circle, so its volume runs slightly high.
    close(volume(&k, &solid), 64.0 - std::f64::consts::PI * 0.36, 5e-3);
}

#[test]
fn away_from_the_body_is_a_new_body() {
    let (k, body, mut p) = setup();
    p.frame.origin = DVec3::new(10.0, 0.0, 0.0);
    assert!(matches!(extrude(&k, Some(&body), &p).unwrap(), ExtrudeResult::New(_)));
}

#[test]
fn zero_distance_is_a_no_op() {
    let (k, body, mut p) = setup();
    p.distance = 0.0;
    assert!(matches!(extrude(&k, Some(&body), &p), Err(KernelError::NoOp)));
}

#[test]
fn edges_are_the_brep_edges() {
    let (k, body, _) = setup();
    assert_eq!(k.tessellate(&body, 0.01).unwrap().edges.len(), 12);
}

#[test]
fn faces_are_pickable_and_flat_ones_have_planes() {
    let (k, body, mut p) = setup();
    let t = k.tessellate(&body, 0.01).unwrap();
    assert_eq!(t.face_ids.len(), t.indices.len() / 3);
    assert_eq!(t.face_planes.len(), 6);
    let top = t.face_planes.iter().flatten().find(|pl| pl.normal.z > 0.5).expect("a top face");
    close(top.origin.z, 2.0, 1e-9);
    close(top.normal.z, 1.0, 1e-9);

    p.profile = Profile::Circle { center: (0.0, 0.0), radius: 0.6 };
    p.distance = 1.0;
    let ExtrudeResult::Replace { solid, .. } = extrude(&k, Some(&body), &p).unwrap() else { panic!() };
    let t = k.tessellate(&solid, 0.01).unwrap();
    assert_eq!(t.face_planes.iter().filter(|pl| pl.is_none()).count(), 1, "only the cylinder wall is curved");
}

#[test]
fn exports_step() {
    let (k, body, mut p) = setup();
    p.distance = -1.0;
    let ExtrudeResult::Replace { solid, .. } = extrude(&k, Some(&body), &p).unwrap() else { panic!() };
    let path = std::env::temp_dir().join("w3d-test.step");
    k.write_step(&solid, &path).unwrap();
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(text.starts_with("ISO-10303-21;"));
    assert!(text.contains("MANIFOLD_SOLID_BREP"));
}

#[test]
fn document_commits_and_undoes_extrudes() {
    use w3d_kernel::document::Document;
    let (k, body, mut p) = setup();
    let mut doc = Document::new(k);
    let id = doc.add(body);
    p.distance = -1.0;
    assert_eq!(doc.commit_extrude(Some(id), &p).unwrap(), id, "a cut replaces its target");
    close(volume(&Occt, doc.get(id).unwrap()), 63.0, 1e-6);
    p.frame.origin = DVec3::new(10.0, 0.0, 0.0);
    let other = doc.commit_extrude(Some(id), &p).unwrap();
    assert_ne!(other, id, "missing the body makes a new one");
    assert_eq!(doc.ids().len(), 2);
    assert!(doc.undo());
    assert_eq!(doc.ids().len(), 1);
    assert!(doc.undo());
    close(volume(&Occt, doc.get(id).unwrap()), 64.0, 1e-6);
    assert!(doc.redo());
    close(volume(&Occt, doc.get(id).unwrap()), 63.0, 1e-6);
}
