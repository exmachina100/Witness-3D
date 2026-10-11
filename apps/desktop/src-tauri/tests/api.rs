//! The commands the viewport calls, run against real OpenCascade without opening a window.

use w3d_desktop::api::{self, ExtrudeRequest, Outcome, ProfileShape};

/// A 1×1 square on the seed box's top face (y = 2), pulled or pushed by `distance`.
fn on_top(target: Option<u32>, distance: f64) -> ExtrudeRequest {
    ExtrudeRequest {
        target,
        origin: [0.0, 2.0, 0.0],
        normal: [0.0, 1.0, 0.0],
        x_axis: [1.0, 0.0, 0.0],
        profile: ProfileShape::Rect { width: 1.0, height: 1.0 },
        distance,
        new_body: false,
    }
}

fn close(a: f64, b: f64) { assert!((a - b).abs() < 1e-6, "{a} != {b}") }

#[test]
fn seed_scene_is_one_box_with_pickable_faces() {
    let m = api::start();
    let scene = api::scene(&m).unwrap();
    assert_eq!(scene.len(), 1);
    let b = &scene[0];
    close(b.volume, 24.0);
    assert_eq!(b.face_planes.len(), 6);
    assert!(b.face_planes.iter().all(Option::is_some));
    assert_eq!(b.face_ids.len(), b.indices.len() / 3);
    assert_eq!(b.edges.len(), 12);
}

#[test]
fn preview_then_commit_then_undo() {
    let m = api::start();
    let id = api::scene(&m).unwrap()[0].id;

    let p = api::preview(&m, on_top(Some(id), -1.0)).expect("not superseded").unwrap();
    assert!(matches!(p.outcome, Outcome::Cut));
    close(p.result.as_ref().unwrap().volume, 23.0);
    close(p.tool.as_ref().unwrap().volume, 1.0);
    close(api::scene(&m).unwrap()[0].volume, 24.0); // a preview changes nothing

    let c = api::commit(&m, on_top(Some(id), 1.0)).unwrap();
    assert_eq!(c.id, id);
    close(c.scene[0].volume, 25.0);
    close(api::undo(&m).unwrap()[0].volume, 24.0);
    close(api::redo(&m).unwrap()[0].volume, 25.0);
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
