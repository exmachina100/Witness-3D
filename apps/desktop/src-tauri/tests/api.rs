//! The commands the viewport calls, run against real OpenCascade without opening a window.

use w3d_desktop::api::{self, BlendKind, BlendRequest, ExtrudeRequest, Outcome, ProfileShape};

/// A 10×10 mm square on the seed enclosure's top face (y = 30), pulled or pushed by `distance`.
fn on_top(target: Option<u32>, distance: f64) -> ExtrudeRequest {
    ExtrudeRequest {
        target,
        origin: [0.0, 30.0, 0.0],
        normal: [0.0, 1.0, 0.0],
        x_axis: [1.0, 0.0, 0.0],
        profile: ProfileShape::Rect { width: 10.0, height: 10.0 },
        distance,
        new_body: false,
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
    assert!(matches!(req.profile, ProfileShape::Circle { radius } if radius == 0.5));
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
    let req = BlendRequest { body: b.id, edges, size: 4.0, kind: BlendKind::Fillet };

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
    let req = BlendRequest { body: b.id, edges: vertical_edges(b), size: 30.0, kind: BlendKind::Fillet };
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
