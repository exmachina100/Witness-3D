//! The Blender bridge without a window, for testing the add-on: serves the real model on the port
//! given (default 8981) and takes lines on stdin. `fillet <mm>` rounds every edge of body 1 and
//! tells Live Link; `outline <json>` sets the document name and groups as the app does and tells
//! Live Link; `quit` stops. Run: cargo run --example bridge_demo -p w3d-desktop -- 8981

use std::io::BufRead;
use std::sync::Arc;

use w3d_desktop::{api, bridge::Bridge};

fn main() {
    let port = std::env::args()
        .nth(1)
        .and_then(|p| p.parse().ok())
        .unwrap_or(w3d_desktop::bridge::PORT);
    let model = Arc::new(api::start());
    let m = model.clone();
    let bridge = Bridge::start(port, Arc::new(move || api::scene(&m))).expect("port in use");
    println!("listening {}", bridge.addr);
    for line in std::io::stdin().lock().lines() {
        let line = line.unwrap();
        let mut words = line.split_whitespace();
        match words.next() {
            Some("fillet") => {
                let size: f64 = words.next().and_then(|s| s.parse().ok()).unwrap_or(4.0);
                let n = api::scene(&model).unwrap()[0].edges.len() as u32;
                let req = serde_json::from_value(serde_json::json!({ "body": 1, "edges": (0..n).collect::<Vec<_>>(), "size": size, "kind": "fillet" })).unwrap();
                match api::commit_blend(&model, req) {
                    Ok(_) => {
                        bridge.changed();
                        println!("ok")
                    }
                    Err(e) => println!("error {}", e.message),
                }
            }
            Some("outline") => {
                let json = line.trim_start().trim_start_matches("outline").trim();
                match serde_json::from_str(json) {
                    Ok(v) => {
                        bridge.set_outline(v);
                        bridge.changed();
                        println!("ok")
                    }
                    Err(e) => println!("error {e}"),
                }
            }
            Some("status") => println!("{:?}", bridge.status()),
            Some("quit") | None => break,
            _ => println!("error unknown"),
        }
    }
}
