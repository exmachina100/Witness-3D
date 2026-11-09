//! The Blender and Cinema 4D bridge, spoken to as the add-ons do.

use std::sync::Arc;

use serde_json::{json, Value};
use tungstenite::Message;
use w3d_desktop::{api, bridge::Bridge};

fn read(
    ws: &mut tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<std::net::TcpStream>>,
) -> Value {
    loop {
        if let Message::Text(t) = ws.read().unwrap() {
            return serde_json::from_str(t.as_str()).unwrap();
        }
    }
}

#[test]
fn refresh_and_live_link_send_z_up_meshes() {
    let model = Arc::new(api::start_enclosure());
    let m = model.clone();
    let bridge = Bridge::start(0, Arc::new(move || api::scene(&m))).unwrap();
    let (mut ws, _) = tungstenite::connect(format!("ws://{}", bridge.addr)).unwrap();
    assert_eq!(read(&mut ws)["type"], "hello");

    ws.send(Message::text(json!({ "type": "refresh" }).to_string()))
        .unwrap();
    let msg = read(&mut ws);
    let objs = msg["objects"].as_array().unwrap();
    assert_eq!(objs.len(), 1);
    assert_eq!(objs[0]["name"], "Witness Body 01");
    // The seed box spans 0..30 mm in the viewport's y, which is z in Blender.
    let p: Vec<f64> = objs[0]["positions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_f64().unwrap())
        .collect();
    let zs: Vec<f64> = p.chunks(3).map(|c| c[2]).collect();
    assert_eq!(zs.iter().cloned().fold(f64::MAX, f64::min), 0.0);
    assert_eq!(zs.iter().cloned().fold(f64::MIN, f64::max), 30.0);
    // The true surface normals come along, z-up too: straight up on the top face.
    let n: Vec<f64> = objs[0]["normals"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
    assert_eq!(n.len(), p.len());
    // Each face has its own points, so one at the top is on the top face (up) or a side (level).
    for (q, n) in p.chunks(3).zip(n.chunks(3)) {
        if q[2] == 30.0 { assert!((n[2] - 1.0).abs() < 1e-6 || n[2].abs() < 1e-6, "{n:?}") }
    }
    assert!(p.chunks(3).zip(n.chunks(3)).any(|(q, n)| q[2] == 30.0 && (n[2] - 1.0).abs() < 1e-6));

    // Live Link: on sends the scene at once, then again after each change.
    ws.send(Message::text(
        json!({ "type": "live", "on": true }).to_string(),
    ))
    .unwrap();
    assert_eq!(read(&mut ws)["type"], "meshes");
    std::thread::sleep(std::time::Duration::from_millis(100));
    assert_eq!(bridge.status(), (1, 1));
    let scene = api::scene(&model).unwrap();
    let edges = (0..scene[0].edges.len() as u32).collect::<Vec<_>>();
    let req: api::BlendRequest =
        serde_json::from_value(json!({ "body": 1, "edges": edges, "size": 4.0, "kind": "fillet" }))
            .unwrap();
    api::commit_blend(&model, req).unwrap();
    bridge.changed();
    let after = read(&mut ws);
    assert_eq!(after["objects"][0]["id"], 1);
    assert!(after["objects"][0]["revision"].as_u64() > objs[0]["revision"].as_u64());
    assert!(
        after["objects"][0]["indices"].as_array().unwrap().len()
            > objs[0]["indices"].as_array().unwrap().len(),
        "the rounded body has more triangles"
    );
    // A change that leaves the mesh as it is (the outliner, another body) keeps its revision, so
    // Blender doesn't rebuild it.
    bridge.changed();
    let again = read(&mut ws);
    assert_eq!(again["objects"][0]["revision"], after["objects"][0]["revision"]);

    // The outliner: the document's name, each body's groups and whether it is hidden.
    bridge.set_outline(json!({ "document": "HOUSING", "objects": { "1": { "path": ["PARTS", "LID"], "hidden": true, "name": "LID" } } }));
    bridge.changed();
    let named = read(&mut ws);
    assert_eq!(named["objects"][0]["name"], "LID", "the outliner's name for the body");
    assert_eq!(named["document"], "HOUSING");
    assert_eq!(named["objects"][0]["path"], json!(["PARTS", "LID"]));
    assert_eq!(named["objects"][0]["hidden"], true);
    // A disabled body is left out of the outline, so out of the bridge.
    bridge.set_outline(json!({ "document": "HOUSING", "objects": { "2": { "path": [], "hidden": false } } }));
    bridge.changed();
    assert_eq!(read(&mut ws)["objects"].as_array().unwrap().len(), 0);
}

#[test]
fn network_settings_read_safely() {
    use w3d_desktop::bridge::{Settings, PORT};
    assert_eq!(Settings::read(None), Settings { bridge: true, port: PORT });
    assert_eq!(Settings::read(Some("not json")), Settings::default());
    assert_eq!(Settings::read(Some(r#"{"bridge":false,"port":5000}"#)), Settings { bridge: false, port: 5000 });
    assert_eq!(Settings::read(Some(r#"{"bridge":true,"port":80}"#)).port, PORT);
}

#[test]
fn refacet_sends_just_the_bodies_asked_for_at_their_settings() {
    let model = Arc::new(api::start_enclosure());
    let scene = api::scene(&model).unwrap();
    let edges = (0..scene[0].edges.len() as u32).collect::<Vec<_>>();
    let req: api::BlendRequest =
        serde_json::from_value(json!({ "body": 1, "edges": edges, "size": 4.0, "kind": "fillet" })).unwrap();
    api::commit_blend(&model, req).unwrap();
    let display = api::scene(&model).unwrap()[0].indices.len();

    let m = model.clone();
    let bridge = Bridge::start(0, Arc::new(move || api::scene(&m))).unwrap();
    bridge.on_refacet(api::bridge_refacet(model.clone()));
    let (mut ws, _) = tungstenite::connect(format!("ws://{}", bridge.addr)).unwrap();
    assert_eq!(read(&mut ws)["type"], "hello");
    let mut tris = |r: Value| {
        ws.send(Message::text(r.to_string())).unwrap();
        let msg = read(&mut ws);
        assert_eq!(msg["type"], "meshes", "{msg}");
        assert_eq!(msg["partial"], true);
        let o = msg["objects"].as_array().unwrap();
        assert_eq!(o.len(), 1);
        o[0]["indices"].as_array().unwrap().len() / 3
    };
    let fine = tris(json!({ "type": "refacet", "ids": [1, 99], "tolerance": 0.005, "angle": 0.1 }));
    let coarse = tris(json!({ "type": "refacet", "ids": [1], "tolerance": 0.1, "angle": 1.0 }));
    assert!(fine > 2 * coarse, "fine {fine} vs coarse {coarse}");
    // The viewport's facets are not touched by a refacet.
    assert_eq!(api::scene(&model).unwrap()[0].indices.len(), display);
    // Advanced settings: a coarse edge angle wins over the fine Angle.
    let advanced = tris(json!({ "type": "refacet", "ids": [1], "tolerance": 0.1, "angle": 0.1, "edge_angle_tolerance": 1.0, "face_angle_tolerance": 1.0 }));
    assert!(advanced < fine);
    // Max Width: no facet side longer than it (the 80 mm block's flat sides are split up).
    ws.send(Message::text(json!({ "type": "refacet", "ids": [1], "tolerance": 0.1, "angle": 1.0, "max_width": 5.0 }).to_string())).unwrap();
    let msg = read(&mut ws);
    let o = &msg["objects"][0];
    let p: Vec<f64> = o["positions"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
    let ix: Vec<usize> = o["indices"].as_array().unwrap().iter().map(|v| v.as_u64().unwrap() as usize).collect();
    let side = |a: usize, b: usize| ((p[3 * a] - p[3 * b]).powi(2) + (p[3 * a + 1] - p[3 * b + 1]).powi(2) + (p[3 * a + 2] - p[3 * b + 2]).powi(2)).sqrt();
    let longest = ix.chunks_exact(3).map(|t| side(t[0], t[1]).max(side(t[1], t[2])).max(side(t[2], t[0]))).fold(0.0, f64::max);
    assert!(longest <= 5.0 + 1e-3, "longest side {longest}");
    assert!(ix.len() / 3 > coarse, "{} vs {coarse}", ix.len() / 3);
    assert_eq!(o["faceIds"].as_array().map(|f| f.len()).unwrap_or(ix.len() / 3), ix.len() / 3);
    ws.send(Message::text(json!({ "type": "refacet", "ids": [1], "tolerance": "x" }).to_string())).unwrap();
    assert_eq!(read(&mut ws)["type"], "error");
}
