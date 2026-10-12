//! The Blender bridge: a WebSocket server on this machine that Witness 3D's Blender add-on
//! (tools/blender/witness3d_bridge.py) connects to. It follows how Plasticity's bridge behaves from
//! Blender's side: the add-on connects, Refresh pulls every body as a mesh, and Live Link pushes
//! the bodies again whenever the model changes. It is one-way: Blender only ever receives meshes,
//! so its materials, cameras and lights are its own and are never sent back or overwritten.
//!
//! Protocol, JSON text frames:
//!   server → client  { type: "hello", app, version, units: "mm" } on connect
//!   client → server  { type: "refresh" }                  reply: one "meshes" message
//!   client → server  { type: "live", on: bool }            Live Link on or off
//!   server → client  { type: "meshes", objects: [{ id, name, revision, positions, indices, faceIds }] }
//!                    every body there is; z is up, millimetres. Bodies missing from it are gone.
//!   server → client  { type: "error", message }
//! Only 127.0.0.1 is listened on.

use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tungstenite::{Message, WebSocket};

use crate::api::Body;

/// Witness 3D's bridge port. Plasticity's own bridge uses a different one, so both apps can run.
pub const PORT: u16 = 8981;

type Scene = Arc<dyn Fn() -> Result<Vec<Body>, String> + Send + Sync>;

struct Client {
    live: bool,
    out: Sender<Arc<String>>,
}

/// The running server. Dropping it does not stop it; it lives as long as the app.
#[derive(Clone)]
pub struct Bridge {
    clients: Arc<Mutex<Vec<Arc<Mutex<Client>>>>>,
    scene: Scene,
    pub addr: SocketAddr,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MeshOut<'a> {
    id: u32,
    name: String,
    revision: u64,
    positions: Vec<f32>,
    indices: &'a [u32],
    face_ids: &'a [u32],
}

/// The bodies as a "meshes" message, turned from the viewport's y-up to z-up.
pub fn meshes(bodies: &[Body]) -> String {
    let objects: Vec<_> = bodies
        .iter()
        .map(|b| MeshOut {
            id: b.id,
            name: format!("Witness Body {:02}", b.id),
            revision: b.revision,
            positions: b
                .positions
                .chunks(3)
                .flat_map(|p| [p[0], -p[2], p[1]])
                .collect(),
            indices: &b.indices,
            face_ids: &b.face_ids,
        })
        .collect();
    json!({ "type": "meshes", "objects": objects }).to_string()
}

impl Bridge {
    /// Listen on 127.0.0.1:`port` (0 picks a free one) and serve `scene` to whoever connects.
    pub fn start(port: u16, scene: Scene) -> std::io::Result<Bridge> {
        let listener = TcpListener::bind(("127.0.0.1", port))?;
        let bridge = Bridge {
            clients: Arc::default(),
            scene,
            addr: listener.local_addr()?,
        };
        let b = bridge.clone();
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let b = b.clone();
                thread::spawn(move || {
                    let _ = b.serve(stream);
                });
            }
        });
        Ok(bridge)
    }

    /// How many add-ons are connected, and how many have Live Link on.
    pub fn status(&self) -> (usize, usize) {
        let c = self.clients.lock().unwrap();
        (c.len(), c.iter().filter(|c| c.lock().unwrap().live).count())
    }

    /// The model changed: send the bodies to every add-on with Live Link on.
    pub fn changed(&self) {
        let live: Vec<_> = self
            .clients
            .lock()
            .unwrap()
            .iter()
            .filter(|c| c.lock().unwrap().live)
            .cloned()
            .collect();
        if live.is_empty() {
            return;
        }
        let msg = Arc::new(self.message());
        for c in live {
            let _ = c.lock().unwrap().out.send(msg.clone());
        }
    }

    fn message(&self) -> String {
        match (self.scene)() {
            Ok(bodies) => meshes(&bodies),
            Err(e) => json!({ "type": "error", "message": e }).to_string(),
        }
    }

    fn serve(&self, stream: TcpStream) -> tungstenite::Result<()> {
        stream.set_read_timeout(Some(Duration::from_millis(50)))?;
        let mut ws = tungstenite::accept(stream).map_err(|e| match e {
            tungstenite::HandshakeError::Failure(e) => e,
            tungstenite::HandshakeError::Interrupted(_) => tungstenite::Error::ConnectionClosed,
        })?;
        let (tx, rx) = channel();
        let me = Arc::new(Mutex::new(Client {
            live: false,
            out: tx,
        }));
        self.clients.lock().unwrap().push(me.clone());
        let result = self.run(&mut ws, &me, rx);
        self.clients
            .lock()
            .unwrap()
            .retain(|c| !Arc::ptr_eq(c, &me));
        result
    }

    fn run(
        &self,
        ws: &mut WebSocket<TcpStream>,
        me: &Arc<Mutex<Client>>,
        rx: Receiver<Arc<String>>,
    ) -> tungstenite::Result<()> {
        ws.send(Message::text(
            json!({ "type": "hello", "app": "Witness 3D", "version": 1, "units": "mm", "up": "z" })
                .to_string(),
        ))?;
        loop {
            while let Ok(msg) = rx.try_recv() {
                ws.send(Message::text(msg.as_str()))?;
            }
            match ws.read() {
                Ok(Message::Text(t)) => {
                    let v: Value = serde_json::from_str(t.as_str()).unwrap_or(Value::Null);
                    match v["type"].as_str() {
                        Some("refresh") => ws.send(Message::text(self.message()))?,
                        Some("live") => {
                            let on = v["on"].as_bool().unwrap_or(false);
                            me.lock().unwrap().live = on;
                            if on {
                                ws.send(Message::text(self.message()))?;
                            }
                        }
                        _ => ws.send(Message::text(
                            json!({ "type": "error", "message": "unknown request" }).to_string(),
                        ))?,
                    }
                }
                Ok(Message::Close(_)) => return Ok(()),
                Ok(_) => {}
                Err(tungstenite::Error::Io(e))
                    if matches!(
                        e.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) => {}
                Err(e) => return Err(e),
            }
        }
    }
}
