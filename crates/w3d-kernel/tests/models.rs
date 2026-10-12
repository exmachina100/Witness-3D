//! Representative models, built the way a designer would, checked against hand-computed volumes.
//! They double as regression models for the kernel and the native file. Units are millimetres.

#![cfg(feature = "occt")]

use std::f64::consts::PI;

use glam::DVec3;
use opencascade::primitives::Shape;
use w3d_kernel::document::Document;
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

fn close(a: f64, b: f64, eps: f64) { assert!((a - b).abs() < eps, "{a} != {b} (±{eps})") }

fn volume(k: &Occt, s: &Shape) -> f64 { k.tessellate(s, 0.005).unwrap().volume() }

/// The product-enclosure blank: 80 wide (x), 30 tall (y), 50 deep (z), standing on the ground.
fn enclosure(k: &Occt) -> Shape { k.box_from_corners(DVec3::new(-40.0, 0.0, -25.0), DVec3::new(40.0, 30.0, 25.0)) }

/// Numbers of the edges whose every point passes `keep`.
fn edges_where(k: &Occt, s: &Shape, keep: impl Fn(DVec3) -> bool) -> Vec<u32> {
    let t = k.tessellate(s, 0.01).unwrap();
    t.edges.iter().enumerate()
        .filter(|(_, pts)| pts.iter().all(|p| keep(DVec3::from_array(*p))))
        .map(|(i, _)| i as u32)
        .collect()
}

fn vertical(k: &Occt, s: &Shape) -> Vec<u32> {
    // A vertical edge keeps one x and one z along its whole length.
    let t = k.tessellate(s, 0.01).unwrap();
    t.edges.iter().enumerate()
        .filter(|(_, pts)| pts.iter().all(|p| (p[0] - pts[0][0]).abs() < 1e-6 && (p[2] - pts[0][2]).abs() < 1e-6))
        .map(|(i, _)| i as u32)
        .collect()
}

fn fillet(edges: Vec<u32>, size: f64) -> BlendParams { BlendParams { edges, size, kind: Blend::Fillet } }

#[test]
fn edges_are_numbered_once_each() {
    let k = Occt;
    let s = enclosure(&k);
    assert_eq!(k.edge_count(&s), 12);
    assert_eq!(k.tessellate(&s, 0.01).unwrap().edges.len(), 12);
    assert_eq!(vertical(&k, &s).len(), 4);
}

#[test]
fn enclosure_rounds_its_corners_then_its_top() {
    let k = Occt;
    let body = enclosure(&k);
    let corners = blend(&k, &body, &fillet(vertical(&k, &body), 4.0)).unwrap();
    // Each corner loses a 4×4 square less a quarter disc, over the 30 mm height.
    let corner_loss = (16.0 - PI * 4.0) * 30.0;
    close(volume(&k, &corners), 80.0 * 30.0 * 50.0 - 4.0 * corner_loss, 2.0);
    assert_eq!(k.face_count(&corners), 10);
    assert!(k.is_valid(&corners));

    // The top outline is now one tangent chain of 8 edges; round all of it by 2 mm.
    let top = edges_where(&k, &corners, |p| (p.y - 30.0).abs() < 1e-6);
    assert_eq!(top.len(), 8);
    let rounded = blend(&k, &corners, &fillet(top, 2.0)).unwrap();
    assert!(k.is_valid(&rounded));
    assert!(volume(&k, &rounded) < volume(&k, &corners));
}

#[test]
fn chamfer_cuts_a_triangular_prism() {
    let k = Occt;
    let body = enclosure(&k);
    let edge = edges_where(&k, &body, |p| (p.y - 30.0).abs() < 1e-6 && (p.z - 25.0).abs() < 1e-6);
    assert_eq!(edge.len(), 1);
    let cut = blend(&k, &body, &BlendParams { edges: edge, size: 3.0, kind: Blend::Chamfer }).unwrap();
    close(volume(&k, &cut), 120_000.0 - 0.5 * 3.0 * 3.0 * 80.0, 1e-3);
    assert_eq!(k.face_count(&cut), 7);
}

#[test]
fn a_round_too_big_for_its_faces_fails_with_a_reason() {
    let k = Occt;
    let body = enclosure(&k);
    // Two rounds on the 50 mm side can't both be 30 mm.
    match blend(&k, &body, &fillet(vertical(&k, &body), 30.0)) {
        Err(KernelError::Blend { reason, .. }) => assert!(!reason.is_empty()),
        other => panic!("expected a blend failure, got {:?}", other.map(|_| ())),
    }
}

#[test]
fn bad_requests_are_refused_before_the_kernel_runs() {
    let k = Occt;
    let body = enclosure(&k);
    assert!(matches!(blend(&k, &body, &fillet(vec![], 1.0)), Err(KernelError::Invalid(_))));
    assert!(matches!(blend(&k, &body, &fillet(vec![0], 0.0)), Err(KernelError::Invalid(_))));
    assert!(matches!(blend(&k, &body, &fillet(vec![0], -2.0)), Err(KernelError::Invalid(_))));
    assert!(matches!(blend(&k, &body, &fillet(vec![99], 1.0)), Err(KernelError::Invalid(_))));
}

#[test]
fn a_boss_joined_by_push_pull_can_be_rounded_where_it_meets_the_body() {
    let k = Occt;
    let body = enclosure(&k);
    let boss = ExtrudeParams {
        profile: Profile::Circle { center: (0.0, 0.0), radius: 8.0 },
        frame: Frame::new(DVec3::new(0.0, 30.0, 0.0), DVec3::X, DVec3::Y),
        distance: 10.0,
        operation: Operation::Auto,
    };
    let ExtrudeResult::Replace { solid, .. } = extrude(&k, Some(&body), &boss).unwrap() else { panic!("expected a join") };
    // The circle where the boss meets the top, and the boss's top rim.
    let base = edges_where(&k, &solid, |p| (p.y - 30.0).abs() < 1e-6 && (p.x * p.x + p.z * p.z - 64.0).abs() < 1e-3);
    let rim = edges_where(&k, &solid, |p| (p.y - 40.0).abs() < 1e-6);
    assert!(!base.is_empty() && !rim.is_empty());
    let rounded = blend(&k, &solid, &fillet([base, rim].concat(), 1.5)).unwrap();
    assert!(k.is_valid(&rounded));
    assert_eq!(k.solid_count(&rounded), 1);
}

#[test]
fn a_document_saves_and_reopens_exactly() {
    let mut doc = Document::new(Occt);
    let a = doc.add(enclosure(&doc.kernel));
    let corners = vertical(&doc.kernel, doc.get(a).unwrap());
    doc.commit_blend(a, &fillet(corners, 4.0)).unwrap();
    let b = doc.add(doc.kernel.box_from_corners(DVec3::new(60.0, 0.0, 0.0), DVec3::new(70.0, 10.0, 10.0)));

    let dir = std::env::temp_dir().join(format!("w3d-save-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("enclosure.w3d");
    file::save(&doc, &path).unwrap();

    let mut reopened = Document::new(Occt);
    file::open(&mut reopened, &path).unwrap();
    assert_eq!(reopened.ids(), vec![a, b]);
    for id in [a, b] {
        let (x, y) = (doc.get(id).unwrap(), reopened.get(id).unwrap());
        close(volume(&doc.kernel, x), volume(&reopened.kernel, y), 1e-9);
        assert_eq!(doc.kernel.face_count(x), reopened.kernel.face_count(y));
    }
    // New bodies keep getting fresh ids, and the reopened document has no history to undo into.
    assert!(!reopened.undo());
    assert_eq!(reopened.add(reopened.kernel.box_from_corners(DVec3::ZERO, DVec3::ONE)), b + 1);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn step_export_reimports_the_same_solid() {
    let k = Occt;
    let body = enclosure(&k);
    let rounded = blend(&k, &body, &fillet(vertical(&k, &body), 4.0)).unwrap();
    let path = std::env::temp_dir().join(format!("w3d-step-{}.step", std::process::id()));
    k.write_step(&rounded, &path).unwrap();
    let back = k.read_step(&path).unwrap();
    close(volume(&k, &back), volume(&k, &rounded), 1e-3);
    assert_eq!(k.face_count(&back), k.face_count(&rounded));
    std::fs::remove_file(path).unwrap();
}

#[test]
fn a_damaged_file_leaves_the_document_alone() {
    let mut doc = Document::new(Occt);
    let id = doc.add(enclosure(&doc.kernel));
    assert!(file::read(&mut doc, "not json").is_err());
    assert!(file::read(&mut doc, r#"{"format":"witness3d","version":99}"#).unwrap_err().to_string().contains("newer"));
    let bad = r#"{"format":"witness3d","version":1,"units":"mm","tolerance":1e-7,"next_id":2,"bodies":[{"id":1,"encoding":"occt-brep","shape":"garbage"}]}"#;
    assert!(file::read(&mut doc, bad).is_err());
    assert_eq!(doc.ids(), vec![id]);
}
