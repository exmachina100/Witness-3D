//! The commands the viewport calls, run against real OpenCascade without opening a window.

use w3d_desktop::api::{self, BlendKind, BlendRequest, BooleanRequest, ExtrudeRequest, MotionRequest, Outcome, ProfileShape};

/// A 10×10 mm square on the seed enclosure's top face (y = 30), pulled or pushed by `distance`.
fn on_top(target: Option<u32>, distance: f64) -> ExtrudeRequest {
    serde_json::from_value(serde_json::json!({
        "target": target, "origin": [0.0, 30.0, 0.0], "normal": [0.0, 1.0, 0.0], "xAxis": [1.0, 0.0, 0.0],
        "profile": { "kind": "rect", "width": 10.0, "height": 10.0 }, "distance": distance,
    })).unwrap()
}

/// A plain fillet of `edges` of `body`.
fn fillet(body: u32, edges: Vec<u32>, size: f64) -> BlendRequest {
    serde_json::from_value(serde_json::json!({ "body": body, "edges": edges, "size": size, "kind": "fillet" })).unwrap()
}

fn close(a: f64, b: f64) { assert!((a - b).abs() < 1e-3, "{a} != {b}") }

#[test]
fn seed_scene_is_one_box_with_pickable_faces() {
    let m = api::start_enclosure();
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
    let m = api::start_enclosure();
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
    let m = api::start_enclosure();
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
    let m = api::start_enclosure();
    let path = std::env::temp_dir().join("w3d-desktop-test.step");
    api::export_step(&m, 1, path.clone(), None, None).unwrap();
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
    let m = api::start_enclosure();
    let b = &api::scene(&m).unwrap()[0];
    let edges = vertical_edges(b);
    assert_eq!(edges.len(), 4);
    let req = fillet(b.id, edges, 4.0);

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
    let m = api::start_enclosure();
    let b = &api::scene(&m).unwrap()[0];
    let req = fillet(b.id, vertical_edges(b), 30.0);
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
    let m = api::start_enclosure();
    let dir = std::env::temp_dir().join(format!("w3d-desktop-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    api::commit(&m, on_top(Some(1), 10.0)).unwrap();
    api::save(&m, dir.join("a.w3d")).unwrap();
    api::export_step(&m, 1, dir.join("a.step"), None, None).unwrap();

    api::new_document(&m, None).unwrap();
    close(api::scene(&m).unwrap()[0].volume, 125_000.0);
    // A startup scene is what new documents start from; one that is missing or unreadable is not.
    api::new_document(&m, Some(dir.join("a.w3d"))).unwrap();
    close(api::scene(&m).unwrap()[0].volume, 121_000.0);
    close(api::scene(&api::start_with(Some(dir.join("a.w3d")))).unwrap()[0].volume, 121_000.0);
    std::fs::write(dir.join("bad.w3d"), "not a model").unwrap();
    api::new_document(&m, Some(dir.join("bad.w3d"))).unwrap();
    close(api::scene(&m).unwrap()[0].volume, 125_000.0);
    api::new_document(&m, Some(dir.join("none.w3d"))).unwrap();
    close(api::scene(&m).unwrap()[0].volume, 125_000.0);
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
    let m = api::start_enclosure();
    let before = api::scene(&m).unwrap().remove(0);
    assert_eq!(before.edge_refs.len(), before.edges.len());
    assert_eq!(before.face_refs.len(), before.face_planes.len());
    let r = before.edge_refs[top_front(&before)[0] as usize];
    let done = api::commit_blend(&m, fillet(before.id, vertical_edges(&before), 4.0)).unwrap();
    let after = &done.scene[0];
    assert!(after.revision > before.revision);
    let found: Vec<u32> = (0..after.edge_refs.len() as u32).filter(|&i| after.edge_refs[i as usize] == r).collect();
    assert_eq!(found, top_front(after));
}

#[test]
fn a_body_moves_and_turns_as_one_undoable_step() {
    let m = api::start_enclosure();
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
    let m = api::start_enclosure();
    let d = api::duplicate_bodies(&m, vec![1]).unwrap();
    assert_eq!(d.ids, vec![2]);
    assert_eq!(d.scene.len(), 2);
    assert!(api::delete_bodies(&m, vec![1, 2]).unwrap().is_empty());
    assert_eq!(api::undo(&m).unwrap().len(), 2);
}

#[test]
fn a_drawn_rectangle_extrudes_as_a_region_with_a_chosen_operation() {
    let m = api::start_enclosure();
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
    let m = api::start_enclosure();
    let d = api::duplicate_bodies(&m, vec![1]).unwrap();
    let moved = api::commit_motion(&m, MotionRequest { bodies: d.ids.clone(), offset: [40.0, 0.0, 0.0], pivot: [0.0; 3], axis: [0.0, 1.0, 0.0], angle: 0.0, scale: 1.0 }).unwrap();
    assert_eq!(moved.scene.len(), 2);
    let req: BooleanRequest = serde_json::from_str(r#"{"target":1,"tools":[2],"op":"difference"}"#).unwrap();
    close(api::preview_boolean(&m, req.clone()).unwrap().unwrap().body.volume, 60_000.0);
    let c = api::commit_boolean(&m, req).unwrap();
    assert_eq!(c.scene.len(), 1);
    close(c.scene[0].volume, 60_000.0);
    let bad: BooleanRequest = serde_json::from_str(r#"{"target":1,"tools":[1],"op":"union"}"#).unwrap();
    assert!(api::commit_boolean(&m, bad).is_err());
}

#[test]
fn splines_come_with_samples_and_extrudes_take_their_options_from_json() {
    let m = api::start_enclosure();
    let curves: Vec<w3d_kernel::Curve> = serde_json::from_str(r#"[
        {"origin":[0,30,0],"x":[1,0,0],"normal":[0,1,0],"kind":"polyline","points":[[-10,-5],[10,-5],[10,5],[-10,5]],"closed":true},
        {"origin":[0,30,0],"x":[1,0,0],"normal":[0,1,0],"kind":"spline","points":[[20,0],[30,0],[30,10]],"closed":false},
        {"origin":[0,30,0],"x":[1,0,0],"normal":[0,1,0],"kind":"arc","start":[0,0],"mid":[5,5],"end":[10,0]}]"#).unwrap();
    let ids = api::add_curves(&m, curves).unwrap().ids;
    let out = api::curves(&m);
    let json = serde_json::to_value(&out).unwrap();
    assert!(json[0].get("samples").is_none() && json[2].get("samples").is_none());
    let samples = json[1]["samples"].as_array().unwrap();
    assert_eq!(samples.len(), 65);
    close(samples[64][0].as_f64().unwrap(), 30.0);
    close(samples[64][1].as_f64().unwrap(), 10.0);
    // Angle (radians), thickness and both sides, as the viewport sends them.
    let req: ExtrudeRequest = serde_json::from_str(&format!(r#"{{"target":1,"region":{},"distance":5,"back":5,"thickness":1,"op":"new"}}"#, ids[0])).unwrap();
    let p = api::preview(&m, req).unwrap().unwrap();
    close(p.tool.unwrap().volume, (200.0 - 18.0 * 8.0) * 10.0);
    // Shift+Q: the body cut in two, the piece shown before it is made.
    let req: ExtrudeRequest = serde_json::from_str(&format!(r#"{{"target":1,"region":{},"distance":-30,"op":"slice"}}"#, ids[0])).unwrap();
    let p = api::preview(&m, req.clone()).unwrap().unwrap();
    assert!(matches!(p.outcome, Outcome::Slice));
    close(p.piece.unwrap().volume, 6_000.0);
    let c = api::commit(&m, req).unwrap();
    assert_eq!(c.scene.len(), 2);
    close(c.scene[0].volume, 114_000.0);
}

#[test]
fn boolean_slices_join_takes_curve_ids_and_contours_come_with_samples() {
    let m = api::start_enclosure();
    let d = api::duplicate_bodies(&m, vec![1]).unwrap();
    api::commit_motion(&m, MotionRequest { bodies: d.ids.clone(), offset: [60.0, 0.0, 0.0], pivot: [0.0; 3], axis: [0.0, 1.0, 0.0], angle: 0.0, scale: 1.0 }).unwrap();
    // Shift+Q: the target loses the 20 mm the copy overlaps, which becomes a body of its own.
    let req: BooleanRequest = serde_json::from_str(r#"{"target":1,"tools":[2],"op":"slice"}"#).unwrap();
    let p = api::preview_boolean(&m, req.clone()).unwrap().unwrap();
    close(p.body.volume, 90_000.0);
    assert_eq!(p.pieces.len(), 1);
    close(p.pieces[0].volume, 30_000.0);
    let c = api::commit_boolean(&m, req).unwrap();
    assert_eq!(c.scene.len(), 2);
    close(c.scene.iter().map(|b| b.volume).sum(), 120_000.0);

    let curves: Vec<w3d_kernel::Curve> = serde_json::from_str(r#"[
        {"origin":[0,30,0],"x":[1,0,0],"normal":[0,1,0],"kind":"polyline","points":[[0,-5],[0,5]],"closed":false},
        {"origin":[0,30,0],"x":[1,0,0],"normal":[0,1,0],"kind":"arc","start":[0,5],"mid":[5,0],"end":[0,-5]},
        {"origin":[0,30,0],"x":[1,0,0],"normal":[0,1,0],"kind":"ellipse","center":[20,0],"major":[6,0],"minor":3}]"#).unwrap();
    let ids = api::add_curves(&m, curves).unwrap().ids;
    let joined = api::join_curves(&m, ids[..2].to_vec()).unwrap().ids;
    assert_eq!(joined.len(), 1);
    let json = serde_json::to_value(api::curves(&m)).unwrap();
    let contour = json.as_array().unwrap().iter().find(|c| c["id"] == joined[0]).unwrap();
    assert_eq!(contour["kind"], "contour");
    assert_eq!(contour["pieces"].as_array().unwrap().len(), 2);
    assert_eq!(contour["samples"].as_array().unwrap().len(), 2 + 32);
    let ellipse = json.as_array().unwrap().iter().find(|c| c["kind"] == "ellipse").unwrap();
    assert!(ellipse.get("samples").is_none());
    let x: ExtrudeRequest = serde_json::from_str(&format!(r#"{{"region":{},"distance":2,"op":"new"}}"#, joined[0])).unwrap();
    // Curved volumes come from the display mesh, which runs a little small.
    let v = api::preview(&m, x).unwrap().unwrap().tool.unwrap().volume;
    assert!((v - 12.5 * std::f64::consts::PI * 2.0).abs() < 1.0, "{v}");
}

#[test]
fn offset_face_takes_an_adjacent_angle_and_spirals_round_trip_as_json() {
    let m = api::start_enclosure();
    let b = &api::scene(&m).unwrap()[0];
    let top = b.face_planes.iter().position(|p| p.as_ref().is_some_and(|p| p.normal[1] > 0.99)).unwrap() as u32;
    // A: the sides lean 5 in over the 30 height, about the bottom edges.
    let req: api::OffsetRequest = serde_json::from_str(&format!(r#"{{"body":1,"faces":[{top}],"distance":0,"angle":{}}}"#, (5.0f64 / 30.0).atan())).unwrap();
    let v = api::preview_offset(&m, req.clone()).unwrap().unwrap().volume;
    assert!((v - 101_500.0).abs() < 0.5, "{v}");
    api::commit_offset(&m, req).unwrap();
    // Older requests without an angle still parse.
    let plain: api::OffsetRequest = serde_json::from_str(&format!(r#"{{"body":1,"faces":[{top}],"distance":1}}"#)).unwrap();
    assert_eq!(plain.angle, 0.0);

    let curves: Vec<w3d_kernel::Curve> = serde_json::from_str(r#"[{"origin":[0,30,0],"x":[1,0,0],"normal":[0,1,0],"kind":"spiral","radius":10,"length":20,"turns":2}]"#).unwrap();
    let ids = api::add_curves(&m, curves).unwrap().ids;
    let json = serde_json::to_value(api::curves(&m)).unwrap();
    let s = json.as_array().unwrap().iter().find(|c| c["id"] == ids[0]).unwrap();
    assert_eq!((s["kind"].as_str(), s["turns"].as_f64(), s["left"].as_bool()), (Some("spiral"), Some(2.0), Some(false)));
}

#[test]
fn extrude_keep_tools_leaves_the_shape_as_a_body_in_the_same_step() {
    let m = api::start_enclosure();
    let id = api::scene(&m).unwrap()[0].id;
    let mut req = on_top(Some(id), -10.0);
    req.keep = true;
    let c = api::commit(&m, req).unwrap();
    assert_eq!(c.id, id);
    assert_eq!(c.scene.len(), 2);
    close(c.scene.iter().find(|b| b.id == id).unwrap().volume, 119_000.0);
    close(c.scene.iter().find(|b| b.id != id).unwrap().volume, 1_000.0);
    assert_eq!(api::undo(&m).unwrap().len(), 1);
    // A new body has no tool to keep.
    let mut alone = on_top(None, 10.0);
    alone.keep = true;
    assert_eq!(api::commit(&m, alone).unwrap().scene.len(), 2);
}

#[test]
fn sweep_distance_follows_the_shortened_path_given_whole() {
    let m = api::start_enclosure();
    let curve = |v: serde_json::Value| serde_json::from_value(v).unwrap();
    let square = serde_json::json!({ "origin": [0.0, 30.0, 0.0], "x": [1.0, 0.0, 0.0], "normal": [0.0, 1.0, 0.0], "kind": "polyline", "points": [[-5.0, -5.0], [5.0, -5.0], [5.0, 5.0], [-5.0, 5.0]], "closed": true });
    let up = |len: f64| serde_json::json!({ "origin": [0.0, 30.0, 0.0], "x": [1.0, 0.0, 0.0], "normal": [0.0, 0.0, 1.0], "kind": "polyline", "points": [[0.0, 0.0], [0.0, len]], "closed": false });
    let ids = api::add_curves(&m, vec![curve(square), curve(up(20.0))]).unwrap().ids;
    let req = serde_json::from_value(serde_json::json!({ "regions": [ids[0]], "kind": "sweep", "path": ids[1], "op": "new", "pathCurve": up(10.0) })).unwrap();
    let c = api::commit_form(&m, req).unwrap();
    close(c.scene.iter().find(|b| b.id == c.id).unwrap().volume, 1000.0);
}

#[test]
fn mesh_export_takes_the_angle_and_inflect() {
    let m = api::start_enclosure();
    let id = api::scene(&m).unwrap()[0].id;
    api::commit_blend(&m, fillet(id, vec![0], 8.0)).unwrap();
    let tris = |angle: f64, inflect: bool| api::mesh_bodies(&m, vec![id], 0.5, angle, inflect).unwrap()[0].indices.len() / 3;
    // A finer angle between normals puts more facets round the fillet.
    assert!(tris(0.05, false) > tris(0.5, false));
    // A fillet's curvature never reverses, so Inflect leaves it alone.
    assert_eq!(tris(0.5, true), tris(0.5, false));
    assert!(api::mesh_bodies(&m, vec![id], 0.5, 0.0, false).is_err());
}

#[test]
fn a_face_curved_by_its_control_points_takes_part_in_booleans() {
    let m = api::start_enclosure();
    let tool = api::duplicate_bodies(&m, vec![1]).unwrap().ids[0];
    let start = api::scene(&m).unwrap().remove(0);
    let top = start.face_planes.iter().position(|p| p.as_ref().is_some_and(|p| p.normal[1] > 0.9)).unwrap() as u32;
    // Rebuild the top as a 7x7 B-spline and lift its middle 3x3 points by 15: a dome.
    let rebuild: api::RebuildFacesRequest = serde_json::from_value(serde_json::json!({
        "body": 1, "faces": [top], "explicit": true, "degree": [3, 3], "spans": [4, 4], "tolerance": 0.01, "extend": [0, 0], "shrink": true,
    })).unwrap();
    api::commit_rebuild_faces(&m, rebuild).unwrap();
    let nets = api::face_poles(&m, serde_json::from_str(r#"{"body":1}"#).unwrap()).unwrap();
    let net = &nets[top as usize];
    assert_eq!((net.len(), net[0].len()), (7, 7));
    let moves: Vec<(u32, u32, [f64; 3])> = [16, 17, 18, 23, 24, 25, 30, 31, 32].iter().map(|&n| (top, n, [0.0, 15.0, 0.0])).collect();
    let domed = api::commit_move_face_poles(&m, serde_json::from_value(serde_json::json!({ "body": 1, "moves": moves })).unwrap()).unwrap();
    let a = domed.scene.iter().find(|b| b.id == 1).unwrap().volume;
    assert!(a > 120_000.0 + 1000.0, "the dome adds volume: {a}");
    // A block across half the dome: difference, then (undone) union, agree on the overlap.
    api::commit_motion(&m, MotionRequest { bodies: vec![tool], offset: [40.0, 15.0, 0.0], pivot: [0.0; 3], axis: [0.0, 1.0, 0.0], angle: 0.0, scale: 1.0 }).unwrap();
    let diff = api::commit_boolean(&m, serde_json::from_str(&format!(r#"{{"target":1,"tools":[{tool}],"op":"difference"}}"#)).unwrap()).unwrap();
    assert_eq!(diff.scene.len(), 1);
    let d = diff.scene[0].volume;
    assert!(d > 0.0 && d < a);
    api::undo(&m).unwrap();
    let uni = api::commit_boolean(&m, serde_json::from_str(&format!(r#"{{"target":1,"tools":[{tool}],"op":"union"}}"#)).unwrap()).unwrap();
    assert_eq!(uni.scene.len(), 1);
    let overlap = a - d;
    assert!((uni.scene[0].volume - (a + 120_000.0 - overlap)).abs() < 1.0, "union {} vs {}", uni.scene[0].volume, a + 120_000.0 - overlap);
    println!("domed {a:.1} difference {d:.1} union {:.1}", uni.scene[0].volume);
}

#[test]
fn shared_edge_points_move_between_faces_of_different_degrees() {
    // A box's top rebuilt at degree 3 (7x7 points) beside a side at another degree: a point on
    // their shared edge moves, the side follows, and the body still takes part in a Boolean.
    for side_how in [None, Some((1, 1)), Some((2, 2)), Some((3, 4)), Some((5, 1))] {
        let m = api::start();
        let b = api::scene(&m).unwrap().remove(0);
        let top = b.face_planes.iter().position(|p| p.as_ref().is_some_and(|p| p.normal[1] > 0.9)).unwrap() as u32;
        let side = b.face_planes.iter().position(|p| p.as_ref().is_some_and(|p| p.normal[0] > 0.9)).unwrap() as u32;
        let rebuild = |f: u32, d: u32, s: u32| {
            let r: api::RebuildFacesRequest = serde_json::from_value(serde_json::json!({
                "body": 1, "faces": [f], "explicit": true, "degree": [d, d], "spans": [s, s], "tolerance": 0.01, "extend": [0, 0], "shrink": true,
            })).unwrap();
            api::commit_rebuild_faces(&m, r).unwrap();
        };
        rebuild(top, 3, 4);
        if let Some((d, s)) = side_how { rebuild(side, d, s); }
        let nets = api::face_poles(&m, serde_json::from_str(r#"{"body":1}"#).unwrap()).unwrap();
        let flat: Vec<[f64; 3]> = nets[top as usize].iter().flatten().cloned().collect();
        let edge: Vec<usize> = (0..flat.len()).filter(|&i| (flat[i][0] - 25.0).abs() < 1e-6).collect();
        let mid = edge[edge.len() / 2] as u32;
        let moved = api::commit_move_face_poles(&m, serde_json::from_value(serde_json::json!({ "body": 1, "moves": [[top, mid, [0.0, 10.0, 0.0]]] })).unwrap())
            .unwrap_or_else(|e| panic!("side {side_how:?}: {}", e.message));
        let v = moved.scene[0].volume;
        assert!(v > 125_000.0 + 100.0, "side {side_how:?}: the lifted edge adds volume ({v})");
        let tool = api::duplicate_bodies(&m, vec![1]).unwrap().ids[0];
        api::commit_motion(&m, MotionRequest { bodies: vec![tool], offset: [25.0, 20.0, -25.0], pivot: [0.0; 3], axis: [0.0, 1.0, 0.0], angle: 0.0, scale: 1.0 }).unwrap();
        let u = api::commit_boolean(&m, serde_json::from_str(&format!(r#"{{"target":1,"tools":[{tool}],"op":"union"}}"#)).unwrap()).unwrap();
        assert_eq!(u.scene.len(), 1, "side {side_how:?}");
        assert!(u.scene[0].volume > v, "side {side_how:?}");
    }
}
