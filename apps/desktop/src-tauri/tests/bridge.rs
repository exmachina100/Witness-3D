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
    let model = Arc::new(api::start());
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

    // The outliner: the document's name, each body's groups and whether it is hidden.
    bridge.set_outline(json!({ "document": "HOUSING", "objects": { "1": { "path": ["PARTS", "LID"], "hidden": true } } }));
    bridge.changed();
    let named = read(&mut ws);
    assert_eq!(named["document"], "HOUSING");
    assert_eq!(named["objects"][0]["path"], json!(["PARTS", "LID"]));
    assert_eq!(named["objects"][0]["hidden"], true);
    // A disabled body is left out of the outline, so out of the bridge.
    bridge.set_outline(json!({ "document": "HOUSING", "objects": { "2": { "path": [], "hidden": false } } }));
    bridge.changed();
    assert_eq!(read(&mut ws)["objects"].as_array().unwrap().len(), 0);
}
