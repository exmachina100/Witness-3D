//! The commands the viewport calls, run against real OpenCascade without opening a window.

use w3d_desktop::api::{self, BlendKind, BlendRequest, BooleanRequest, ExtrudeRequest, MotionRequest, OpChoice, Outcome, ProfileShape};

/// A 10×10 mm square on the seed enclosure's top face (y = 30), pulled or pushed by `distance`.
fn on_top(target: Option<u32>, distance: f64) -> ExtrudeRequest {
    ExtrudeRequest {
        target,
        origin: [0.0, 30.0, 0.0],
        normal: [0.0, 1.0, 0.0],
        x_axis: [1.0, 0.0, 0.0],
        profile: Some(ProfileShape::Rect { width: 10.0, height: 10.0 }),
        region: None,
        face: None,
        distance,
        new_body: false,
        op: OpChoice::Auto,
    }
}

fn close(a: f64, b: f64) { assert!((a - b).abs() < 1e-3, "{a} != {b}") }

#[test]
fn seed_scene_is_one_box_with_pickable_faces() {
    let m = api::start();
    let scene = api::scene(&m).unwrap();
    assert_eq!(scene.len(), 1);
    let b = &scene[0];
    close(b.volume, 80.0 * 30.0 * 50.0);
    assert_eq!(b.face_planes.len(), 6);
    assert!(b.face_planes.iter().all(Option::is_some));
    assert_eq!(b.face_ids.len(), b.indices.len() / 3);
    assert_eq!(b.edges.len(), 12);
}

#[test]
fn preview_then_commit_then_undo() {
    let m = api::start();
    let id = api::scene(&m).unwrap()[0].id;

    let p = api::preview(&m, on_top(Some(id), -10.0)).expect("not superseded").unwrap();
    assert!(matches!(p.outcome, Outcome::Cut));
    close(p.result.as_ref().unwrap().volume, 119_000.0);
    close(p.tool.as_ref().unwrap().volume, 1_000.0);
    close(api::scene(&m).unwrap()[0].volume, 120_000.0); // a preview changes nothing

    let c = api::commit(&m, on_top(Some(id), 10.0)).unwrap();
    assert_eq!(c.id, id);
    close(c.scene[0].volume, 121_000.0);
    close(api::undo(&m).unwrap()[0].volume, 120_000.0);
    close(api::redo(&m).unwrap()[0].volume, 121_000.0);
}

#[test]
fn zero_distance_previews_nothing() {
    let m = api::start();
    let p = api::preview(&m, on_top(Some(1), 0.0)).unwrap().unwrap();
    assert!(matches!(p.outcome, Outcome::None));
    assert!(p.tool.is_none());
}

#[test]
fn requests_parse_from_the_viewport_json() {
    let req: ExtrudeRequest = serde_json::from_str(r#"{"target":1,"origin":[0,2,0],"normal":[0,1,0],"xAxis":[1,0,0],
        "profile":{"kind":"circle","radius":0.5},"distance":-0.5}"#).unwrap();
    assert!(matches!(req.profile, Some(ProfileShape::Circle { radius }) if radius == 0.5));
    assert!(!req.new_body);
}

#[test]
fn exports_step() {
    let m = api::start();
    let path = std::env::temp_dir().join("w3d-desktop-test.step");
    api::export_step(&m, 1, path.clone()).unwrap();
    assert!(std::fs::read_to_string(path).unwrap().starts_with("ISO-10303-21;"));
}

/// The seed enclosure's four vertical edges, found the way the viewport would: by their points.
fn vertical_edges(b: &api::Body) -> Vec<u32> {
    b.edges.iter().enumerate()
        .filter(|(_, e)| e.chunks(3).all(|p| p[0] == e[0] && p[2] == e[2]))
        .map(|(i, _)| i as u32)
        .collect()
}

#[test]
fn fillet_previews_commits_and_undoes() {
    let m = api::start();
    let b = &api::scene(&m).unwrap()[0];
    let edges = vertical_edges(b);
    assert_eq!(edges.len(), 4);
    let req = BlendRequest { body: b.id, edges, size: 4.0, kind: BlendKind::Fillet, angle: std::f64::consts::FRAC_PI_4 };

    let preview = api::preview_blend(&m, req.clone()).expect("not superseded").unwrap();
    let rounded = 120_000.0 - 4.0 * (16.0 - std::f64::consts::PI * 4.0) * 30.0;
    // Volume comes from the display mesh (0.05 mm chords), which cuts inside the true rounds.
    assert!((preview.volume - rounded).abs() < 15.0, "{}", preview.volume);
    close(api::scene(&m).unwrap()[0].volume, 120_000.0);

    let c = api::commit_blend(&m, req).unwrap();
    assert_eq!(c.scene[0].face_planes.len(), 10);
    close(api::undo(&m).unwrap()[0].volume, 120_000.0);
}

#[test]
fn a_failed_fillet_says_why_and_changes_nothing() {
    let m = api::start();
    let b = &api::scene(&m).unwrap()[0];
    let req = BlendRequest { body: b.id, edges: vertical_edges(b), size: 30.0, kind: BlendKind::Fillet, angle: std::f64::consts::FRAC_PI_4 };
    let err = api::commit_blend(&m, req).unwrap_err();
    assert!(!err.message.is_empty());
    close(api::scene(&m).unwrap()[0].volume, 120_000.0);
    assert!(!api::undo(&m).unwrap().is_empty());
}

#[test]
fn blend_requests_parse_from_the_viewport_json() {
    let req: BlendRequest = serde_json::from_str(r#"{"body":1,"edges":[0,3],"size":4,"kind":"chamfer"}"#).unwrap();
    assert_eq!(req.kind, BlendKind::Chamfer);
    assert_eq!(req.edges, vec![0, 3]);
}

#[test]
fn saves_reopens_and_imports_step() {
    let m = api::start();
    let dir = std::env::temp_dir().join(format!("w3d-desktop-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    api::commit(&m, on_top(Some(1), 10.0)).unwrap();
    api::save(&m, dir.join("a.w3d")).unwrap();
    api::export_step(&m, 1, dir.join("a.step")).unwrap();

    api::new_document(&m).unwrap();
    close(api::scene(&m).unwrap()[0].volume, 120_000.0);
    let reopened = api::open(&m, dir.join("a.w3d")).unwrap();
    close(reopened[0].volume, 121_000.0);

    let imported = api::import_step(&m, dir.join("a.step")).unwrap();
    assert_eq!(imported.scene.len(), 2);
    close(imported.scene[1].volume, 121_000.0);
    assert!(api::open(&m, dir.join("missing.w3d")).is_err());
    std::fs::remove_dir_all(dir).unwrap();
}

/// The edge running along the top front of the seed enclosure (y = 30, z = 25).
fn top_front(b: &api::Body) -> Vec<u32> {
    (0..b.edges.len() as u32).filter(|&i| {
        b.edges[i as usize].chunks(3).all(|p| (p[1] - 30.0).abs() < 1e-3 && (p[2] - 25.0).abs() < 1e-3)
    }).collect()
}

#[test]
fn bodies_carry_refs_that_survive_a_fillet() {
    let m = api::start();
    let before = api::scene(&m).unwrap().remove(0);
    assert_eq!(before.edge_refs.len(), before.edges.len());
    assert_eq!(before.face_refs.len(), before.face_planes.len());
    let r = before.edge_refs[top_front(&before)[0] as usize];
    let done = api::commit_blend(&m, BlendRequest { body: before.id, edges: vertical_edges(&before), size: 4.0, kind: BlendKind::Fillet, angle: std::f64::consts::FRAC_PI_4 }).unwrap();
    let after = &done.scene[0];
    assert!(after.revision > before.revision);
    let found: Vec<u32> = (0..after.edge_refs.len() as u32).filter(|&i| after.edge_refs[i as usize] == r).collect();
    assert_eq!(found, top_front(after));
}

#[test]
fn a_body_moves_and_turns_as_one_undoable_step() {
    let m = api::start();
    let before = api::scene(&m).unwrap().remove(0);
    let req: MotionRequest = serde_json::from_str(r#"{"bodies":[1],"offset":[10,0,0],"pivot":[0,0,0],"axis":[0,1,0],"angle":1.5707963267948966}"#).unwrap();
    let after = api::commit_motion(&m, req).unwrap().scene.remove(0);
    assert_eq!(after.edge_refs, before.edge_refs);
    close(after.volume, before.volume);
    let xs = after.positions.chunks(3).map(|p| p[0] as f64);
    let (lo, hi) = xs.fold((f64::MAX, f64::MIN), |(a, b), x| (a.min(x), b.max(x)));
    close(lo, -15.0);
    close(hi, 35.0);
    // Nothing to do, and nonsense, are refused without a step.
    assert!(api::commit_motion(&m, serde_json::from_str(r#"{"bodies":[1]}"#).unwrap()).is_err());
    assert!(api::commit_motion(&m, MotionRequest { bodies: vec![1], offset: [f64::NAN, 0.0, 0.0], pivot: [0.0; 3], axis: [0.0, 1.0, 0.0], angle: 0.0, scale: 1.0 }).is_err());
    let undone = api::undo(&m).unwrap().remove(0);
    close(undone.positions.chunks(3).map(|p| p[0] as f64).fold(f64::MAX, f64::min), -40.0);
}

#[test]
fn bodies_duplicate_and_delete_as_one_step_each() {
    let m = api::start();
    let d = api::duplicate_bodies(&m, vec![1]).unwrap();
    assert_eq!(d.ids, vec![2]);
    assert_eq!(d.scene.len(), 2);
    assert!(api::delete_bodies(&m, vec![1, 2]).unwrap().is_empty());
    assert_eq!(api::undo(&m).unwrap().len(), 2);
}

#[test]
fn a_drawn_rectangle_extrudes_as_a_region_with_a_chosen_operation() {
    let m = api::start();
    let curves: Vec<w3d_kernel::Curve> = serde_json::from_str(r#"[{"origin":[0,30,0],"x":[1,0,0],"normal":[0,1,0],
        "kind":"polyline","points":[[-5,-5],[5,-5],[5,5],[-5,5]],"closed":true}]"#).unwrap();
    let ids = api::add_curves(&m, curves).unwrap().ids;
    assert_eq!(api::curves(&m).len(), 1);
    let req: ExtrudeRequest = serde_json::from_str(&format!(r#"{{"target":1,"region":{},"distance":-4,"op":"difference"}}"#, ids[0])).unwrap();
    let p = api::preview(&m, req.clone()).unwrap().unwrap();
    assert!(matches!(p.outcome, Outcome::Cut));
    let c = api::commit(&m, req).unwrap();
    close(c.scene[0].volume, 120_000.0 - 400.0);
    let x: ExtrudeRequest = serde_json::from_str(&format!(r#"{{"target":1,"region":{},"distance":-10,"op":"intersect"}}"#, ids[0])).unwrap();
    assert!(matches!(api::preview(&m, x).unwrap().unwrap().outcome, Outcome::Intersect));
    // Deleting the curve and undoing brings it back.
    api::delete_items(&m, vec![], ids.clone()).unwrap();
    assert!(api::curves(&m).is_empty());
    api::undo(&m).unwrap();
    assert_eq!(api::curves(&m).len(), 1);
}

#[test]
fn boolean_cuts_the_target_with_a_duplicate_and_removes_it() {
    let m = api::start();
    let d = api::duplicate_bodies(&m, vec![1]).unwrap();
    let moved = api::commit_motion(&m, MotionRequest { bodies: d.ids.clone(), offset: [40.0, 0.0, 0.0], pivot: [0.0; 3], axis: [0.0, 1.0, 0.0], angle: 0.0, scale: 1.0 }).unwrap();
    assert_eq!(moved.scene.len(), 2);
    let req: BooleanRequest = serde_json::from_str(r#"{"target":1,"tools":[2],"op":"difference"}"#).unwrap();
    close(api::preview_boolean(&m, req.clone()).unwrap().unwrap().volume, 60_000.0);
    let c = api::commit_boolean(&m, req).unwrap();
    assert_eq!(c.scene.len(), 1);
    close(c.scene[0].volume, 60_000.0);
    let bad: BooleanRequest = serde_json::from_str(r#"{"target":1,"tools":[1],"op":"union"}"#).unwrap();
    assert!(api::commit_boolean(&m, bad).is_err());
}
