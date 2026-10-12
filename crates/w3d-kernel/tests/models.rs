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

fn fillet(edges: Vec<u32>, size: f64) -> BlendParams { BlendParams { edges, size, kind: Blend::Fillet, angle: w3d_kernel::blend::EQUAL } }

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
    let corners = blend(&k, &body, &fillet(vertical(&k, &body), 4.0)).unwrap().solid;
    // Each corner loses a 4×4 square less a quarter disc, over the 30 mm height.
    let corner_loss = (16.0 - PI * 4.0) * 30.0;
    close(volume(&k, &corners), 80.0 * 30.0 * 50.0 - 4.0 * corner_loss, 2.0);
    assert_eq!(k.face_count(&corners), 10);
    assert!(k.is_valid(&corners));

    // The top outline is now one tangent chain of 8 edges; round all of it by 2 mm.
    let top = edges_where(&k, &corners, |p| (p.y - 30.0).abs() < 1e-6);
    assert_eq!(top.len(), 8);
    let rounded = blend(&k, &corners, &fillet(top, 2.0)).unwrap().solid;
    assert!(k.is_valid(&rounded));
    assert!(volume(&k, &rounded) < volume(&k, &corners));
}

#[test]
fn chamfer_cuts_a_triangular_prism() {
    let k = Occt;
    let body = enclosure(&k);
    let edge = edges_where(&k, &body, |p| (p.y - 30.0).abs() < 1e-6 && (p.z - 25.0).abs() < 1e-6);
    assert_eq!(edge.len(), 1);
    let cut = blend(&k, &body, &BlendParams { edges: edge, size: 3.0, kind: Blend::Chamfer, angle: w3d_kernel::blend::EQUAL }).unwrap().solid;
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
        face: None,
    };
    let ExtrudeResult::Replace { solid, .. } = extrude(&k, Some(&body), &boss).unwrap() else { panic!("expected a join") };
    // The circle where the boss meets the top, and the boss's top rim.
    let base = edges_where(&k, &solid, |p| (p.y - 30.0).abs() < 1e-6 && (p.x * p.x + p.z * p.z - 64.0).abs() < 1e-3);
    let rim = edges_where(&k, &solid, |p| (p.y - 40.0).abs() < 1e-6);
    assert!(!base.is_empty() && !rim.is_empty());
    let rounded = blend(&k, &solid, &fillet([base, rim].concat(), 1.5)).unwrap().solid;
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
    let rounded = blend(&k, &body, &fillet(vertical(&k, &body), 4.0)).unwrap().solid;
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

/// Numbers of the flat faces facing `normal` whose plane passes through `point`.
fn faces_facing(k: &Occt, s: &Shape, point: DVec3, normal: DVec3) -> Vec<u32> {
    let t = k.tessellate(s, 0.01).unwrap();
    t.face_planes.iter().enumerate()
        .filter(|(_, p)| p.as_ref().is_some_and(|p| p.normal.dot(normal) > 1.0 - 1e-9 && (p.origin - point).dot(normal).abs() < 1e-6))
        .map(|(i, _)| i as u32)
        .collect()
}

fn top_front(k: &Occt, s: &Shape) -> Vec<u32> {
    edges_where(k, s, |p| (p.y - 30.0).abs() < 1e-6 && (p.z - 25.0).abs() < 1e-6)
}

#[test]
fn refs_follow_faces_and_edges_through_a_join() {
    let mut doc = Document::new(Occt);
    let id = doc.add(enclosure(&doc.kernel));
    let edge = top_front(&doc.kernel, doc.get(id).unwrap());
    assert_eq!(edge.len(), 1);
    let edge_ref = doc.refs(id).unwrap().edges[edge[0] as usize];
    let top = faces_facing(&doc.kernel, doc.get(id).unwrap(), DVec3::new(0.0, 30.0, 0.0), DVec3::Y);
    let top_ref = doc.refs(id).unwrap().faces[top[0] as usize];
    let before = doc.revision();

    // A boss on the top renumbers the body's faces and edges.
    doc.commit_extrude(Some(id), &ExtrudeParams {
        profile: Profile::Circle { center: (0.0, 0.0), radius: 8.0 },
        frame: Frame::new(DVec3::new(0.0, 30.0, 0.0), DVec3::X, DVec3::Y),
        distance: 10.0,
        operation: Operation::Auto,
        face: None,
    }).unwrap();
    assert!(doc.revision() > before);
    let (solid, refs) = (doc.get(id).unwrap(), doc.refs(id).unwrap());
    assert_eq!(refs.edges.len(), doc.kernel.edge_count(solid));
    assert_eq!(refs.faces.len(), doc.kernel.face_count(solid));
    assert_eq!(refs.edges_with(&[edge_ref]), top_front(&doc.kernel, solid));
    assert_eq!(refs.faces_with(&[top_ref]), faces_facing(&doc.kernel, solid, DVec3::new(0.0, 30.0, 0.0), DVec3::Y));
    // The boss's own faces are new.
    let boss_top = faces_facing(&doc.kernel, solid, DVec3::new(0.0, 40.0, 0.0), DVec3::Y);
    assert_eq!(boss_top.len(), 1);
    assert_ne!(refs.faces[boss_top[0] as usize], top_ref);
}

#[test]
fn a_fillet_keeps_the_refs_of_trimmed_edges_and_gives_its_rounds_new_ones() {
    let mut doc = Document::new(Occt);
    let id = doc.add(enclosure(&doc.kernel));
    let old = doc.refs(id).unwrap().clone();
    let edge_ref = old.edges[top_front(&doc.kernel, doc.get(id).unwrap())[0] as usize];
    doc.commit_blend(id, &fillet(vertical(&doc.kernel, doc.get(id).unwrap()), 4.0)).unwrap();
    let (solid, refs) = (doc.get(id).unwrap(), doc.refs(id).unwrap());
    // The top front edge got shorter at both ends but is the same edge.
    assert_eq!(refs.edges_with(&[edge_ref]), top_front(&doc.kernel, solid));
    // Six original faces plus four rounds; only the rounds are new.
    assert_eq!(refs.faces.len(), 10);
    assert_eq!(refs.faces.iter().filter(|r| !old.faces.contains(r)).count(), 4);
    // Undo brings back the old numbering with the old refs.
    assert!(doc.undo());
    assert_eq!(doc.refs(id).unwrap(), &old);
}

#[test]
fn moving_a_body_keeps_its_refs_and_moves_its_geometry() {
    let mut doc = Document::new(Occt);
    let id = doc.add(enclosure(&doc.kernel));
    let old = doc.refs(id).unwrap().clone();
    let m = Motion { offset: DVec3::new(10.0, 0.0, 0.0), pivot: DVec3::ZERO, axis: DVec3::Y, angle: PI / 2.0, scale: 1.0 };
    assert!(matches!(doc.commit_motion(&[id], &Motion::translation(DVec3::ZERO)), Err(KernelError::NoOp)));
    doc.commit_motion(&[id], &m).unwrap();
    assert_eq!(doc.refs(id).unwrap(), &old);
    // A quarter turn about y swaps the footprint: 50 wide in x, 80 deep in z, then 10 along x.
    let t = doc.kernel.tessellate(doc.get(id).unwrap(), 0.01).unwrap();
    let xs = t.positions.iter().map(|p| p[0]);
    let (lo, hi) = xs.fold((f64::MAX, f64::MIN), |(a, b), x| (a.min(x), b.max(x)));
    close(lo, -15.0, 1e-6);
    close(hi, 35.0, 1e-6);
    // The same edge, renumbered or not, is still where the motion took it.
    let edge_ref = old.edges[top_front(&doc.kernel, &enclosure(&doc.kernel))[0] as usize];
    let moved = doc.refs(id).unwrap().edges_with(&[edge_ref]);
    let want = m.apply(DVec3::new(0.0, 30.0, 25.0));
    let mid = edges_where(&doc.kernel, doc.get(id).unwrap(), |p| (p.y - 30.0).abs() < 1e-6 && (p.x - want.x).abs() < 1e-6);
    assert_eq!(moved, mid);
}

#[test]
fn refs_survive_save_and_reopen() {
    let mut doc = Document::new(Occt);
    let id = doc.add(enclosure(&doc.kernel));
    doc.commit_blend(id, &fillet(vertical(&doc.kernel, doc.get(id).unwrap()), 4.0)).unwrap();
    let text = file::write(&doc).unwrap();
    let mut back = Document::new(Occt);
    file::read(&mut back, &text).unwrap();
    assert_eq!(back.refs(id), doc.refs(id));
    assert_eq!(back.next_ref(), doc.next_ref());
    // A version 1 file without refs still opens, with fresh ones.
    let old: serde_json::Value = serde_json::from_str(&text).unwrap();
    let mut old = old;
    old.as_object_mut().unwrap().remove("next_ref");
    for b in old["bodies"].as_array_mut().unwrap() {
        b.as_object_mut().unwrap().remove("face_refs");
        b.as_object_mut().unwrap().remove("edge_refs");
    }
    let mut legacy = Document::new(Occt);
    file::read(&mut legacy, &old.to_string()).unwrap();
    assert_eq!(legacy.refs(id).unwrap().faces.len(), 10);
}

#[test]
fn faces_merged_after_a_boolean_inherit_from_the_faces_merged_into_them() {
    let k = Occt;
    let a = enclosure(&k);
    let b = k.box_from_corners(DVec3::new(30.0, 0.0, -25.0), DVec3::new(50.0, 30.0, 25.0));
    let Traced { solid, history } = k.boolean(&a, &b, BooleanOp::Union).unwrap();
    // One longer box. The faces where they overlap are gone; the other five of `a` each land on one
    // face of the result, and four of them were merged with a face of `b`.
    assert_eq!(k.face_count(&solid), 6);
    let from_a: std::collections::HashMap<u32, u32> = history.faces[0].iter().copied().collect();
    assert_eq!(from_a.len(), 5);
    let targets: std::collections::HashSet<u32> = from_a.values().copied().collect();
    assert_eq!(targets.len(), 5);
    assert_eq!(history.faces[1].iter().filter(|(_, j)| targets.contains(j)).count(), 4);
}

#[test]
fn a_chamfer_at_an_angle_cuts_a_right_triangle_of_that_shape() {
    let k = Occt;
    let body = enclosure(&k);
    let edge = top_front(&k, &body);
    // 3 mm along the first face, at 30° from it: the other leg is 3·tan 30°.
    let p = BlendParams { edges: edge, size: 3.0, kind: Blend::Chamfer, angle: PI / 6.0 };
    let cut = blend(&k, &body, &p).unwrap().solid;
    close(volume(&k, &cut), 120_000.0 - 0.5 * 3.0 * 3.0 * (PI / 6.0).tan() * 80.0, 1e-3);
    let bad = BlendParams { angle: PI / 2.0, ..p };
    assert!(matches!(blend(&k, &body, &bad), Err(KernelError::Invalid(_))));
}

#[test]
fn bodies_scale_duplicate_and_delete_as_single_steps() {
    let mut doc = Document::new(Occt);
    let a = doc.add(enclosure(&doc.kernel));
    let refs = doc.refs(a).unwrap().clone();
    doc.commit_motion(&[a], &Motion::scaling(DVec3::new(0.0, 15.0, 0.0), 0.5)).unwrap();
    close(volume(&doc.kernel, doc.get(a).unwrap()), 120_000.0 / 8.0, 1e-3);
    assert_eq!(doc.refs(a).unwrap(), &refs);
    let copies = doc.commit_duplicate(&[a]).unwrap();
    assert_eq!(doc.ids(), vec![a, copies[0]]);
    assert_ne!(doc.refs(copies[0]).unwrap(), &refs);
    doc.commit_delete(&[a, copies[0]]).unwrap();
    assert!(doc.ids().is_empty());
    assert!(doc.undo());
    assert_eq!(doc.ids().len(), 2);
}

/// A rectangle drawn on the enclosure's top face, as Plasticity's Corner Rectangle makes it.
fn top_rect(w: f64, d: f64) -> Curve {
    let (w, d) = (w / 2.0, d / 2.0);
    Curve {
        origin: [0.0, 30.0, 0.0], x: [1.0, 0.0, 0.0], normal: [0.0, 1.0, 0.0],
        shape: CurveShape::Polyline { points: vec![[-w, -d], [w, -d], [w, d], [-w, d]], closed: true },
    }
}

#[test]
fn a_drawn_region_extrudes_into_a_boss_or_a_pocket_and_undoes_with_its_curve() {
    let mut doc = Document::new(Occt);
    let a = doc.add(enclosure(&doc.kernel));
    let ids = doc.commit_curves(vec![top_rect(20.0, 10.0)]).unwrap();
    assert_eq!(doc.curve_ids(), ids);
    // Out of the face joins (Auto), as Plasticity's extrude does.
    let p = doc.region_params(ids[0], 5.0, Operation::Auto).unwrap();
    assert_eq!(doc.commit_extrude(Some(a), &p).unwrap(), a);
    close(volume(&doc.kernel, doc.get(a).unwrap()), 120_000.0 + 20.0 * 10.0 * 5.0, 1e-3);
    // W forces a difference even pulling out: here it cuts the boss back off.
    let w = doc.region_params(ids[0], 5.0, Operation::Difference).unwrap();
    let ExtrudeResult::Replace { solid, op: BooleanOp::Difference, .. } = doc.preview_extrude(Some(a), &w).unwrap() else { panic!("expected a cut") };
    close(volume(&doc.kernel, &solid), 120_000.0, 1e-3);
    // A forced cut that reaches nothing says so instead of making a new body.
    let far = doc.commit_curves(vec![Curve { origin: [0.0, 100.0, 0.0], ..top_rect(5.0, 5.0) }]).unwrap()[0];
    assert!(doc.preview_extrude(Some(a), &doc.region_params(far, 5.0, Operation::Difference).unwrap()).is_err());
    assert!(doc.undo());
    // An open line has no region.
    let open = Curve { shape: CurveShape::Polyline { points: vec![[0.0, 0.0], [5.0, 0.0]], closed: false }, ..top_rect(1.0, 1.0) };
    let line = doc.commit_curves(vec![open]).unwrap()[0];
    assert!(doc.region_params(line, 5.0, Operation::Auto).is_err());
    assert!(doc.commit_curves(vec![Curve { shape: CurveShape::Circle { center: [0.0, 0.0], radius: 0.0 }, ..top_rect(1.0, 1.0) }]).is_err());
    // Undo takes the line, then the boss; the rectangle stays until its own step goes.
    assert!(doc.undo());
    assert_eq!(doc.curve_ids(), ids);
    assert!(doc.undo());
    close(volume(&doc.kernel, doc.get(a).unwrap()), 120_000.0, 1e-3);
    assert!(doc.undo());
    assert!(doc.curve_ids().is_empty());
}

#[test]
fn a_face_extrudes_along_its_normal() {
    let mut doc = Document::new(Occt);
    let a = doc.add(enclosure(&doc.kernel));
    let t = doc.kernel.tessellate(doc.get(a).unwrap(), 0.01).unwrap();
    let top = t.face_planes.iter().position(|p| p.is_some_and(|p| p.normal.y > 0.99)).unwrap() as u32;
    let p = ExtrudeParams { profile: Profile::rectangle(1.0, 1.0), frame: Frame::new(DVec3::ZERO, DVec3::X, DVec3::Y), distance: 10.0, operation: Operation::Auto, face: Some(top) };
    doc.commit_extrude(Some(a), &p).unwrap();
    close(volume(&doc.kernel, doc.get(a).unwrap()), 80.0 * 40.0 * 50.0, 1e-3);
    let p = ExtrudeParams { distance: -10.0, ..p };
    let top = doc.kernel.tessellate(doc.get(a).unwrap(), 0.01).unwrap().face_planes.iter().position(|p| p.is_some_and(|p| p.normal.y > 0.99 && p.origin.y > 39.0)).unwrap() as u32;
    doc.commit_extrude(Some(a), &ExtrudeParams { face: Some(top), ..p }).unwrap();
    close(volume(&doc.kernel, doc.get(a).unwrap()), 120_000.0, 1e-3);
}

#[test]
fn boolean_changes_the_target_removes_the_tools_and_keeps_refs() {
    let mut doc = Document::new(Occt);
    let a = doc.add(enclosure(&doc.kernel));
    let b = doc.add(doc.kernel.box_from_corners(DVec3::new(30.0, 20.0, -5.0), DVec3::new(50.0, 40.0, 5.0)));
    let c = doc.add(doc.kernel.box_from_corners(DVec3::new(-50.0, 20.0, -5.0), DVec3::new(-30.0, 40.0, 5.0)));
    let bottom = doc.refs(a).unwrap().faces.clone();
    doc.commit_boolean(a, &[b, c], BooleanOp::Difference, false).unwrap();
    close(volume(&doc.kernel, doc.get(a).unwrap()), 120_000.0 - 2.0 * 10.0 * 10.0 * 10.0, 1e-3);
    assert_eq!(doc.ids(), vec![a]);
    // Faces of the target that survive keep their refs through both cuts.
    let now = &doc.refs(a).unwrap().faces;
    assert!(bottom.iter().filter(|r| now.contains(r)).count() >= 4, "{bottom:?} vs {now:?}");
    assert!(doc.undo());
    doc.commit_boolean(a, &[b], BooleanOp::Intersection, true).unwrap();
    close(volume(&doc.kernel, doc.get(a).unwrap()), 1_000.0, 1e-3);
    assert_eq!(doc.ids().len(), 3);
    assert!(doc.commit_boolean(a, &[a], BooleanOp::Union, false).is_err());
}

#[test]
fn curves_survive_save_and_reopen() {
    let mut doc = Document::new(Occt);
    doc.add(enclosure(&doc.kernel));
    let circle = Curve { shape: CurveShape::Circle { center: [3.0, 4.0], radius: 5.0 }, ..top_rect(1.0, 1.0) };
    let ids = doc.commit_curves(vec![top_rect(20.0, 10.0), circle.clone()]).unwrap();
    let text = file::write(&doc).unwrap();
    let mut back = Document::new(Occt);
    file::read(&mut back, &text).unwrap();
    assert_eq!(back.curve_ids(), ids);
    assert_eq!(back.curve(ids[1]), Some(&circle));
    assert_eq!(back.commit_curves(vec![circle]).unwrap(), vec![ids[1] + 1]);
}
