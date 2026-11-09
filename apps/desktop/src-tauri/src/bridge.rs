//! The Blender and Cinema 4D bridge: a WebSocket server on this machine that Witness 3D's Blender
//! add-on (tools/blender/witness3d_bridge.py) and Cinema 4D plugin (tools/cinema4d) connect to. It follows how Plasticity's bridge behaves from
//! Blender's side: the add-on connects, Refresh pulls every body as a mesh, and Live Link pushes
//! the bodies again whenever the model changes. It is one-way: Blender only ever receives meshes,
//! so its materials, cameras and lights are its own and are never sent back or overwritten.
//!
//! Protocol, JSON text frames:
//!   server → client  { type: "hello", app, version, units: "mm" } on connect
//!   client → server  { type: "refresh" }                  reply: one "meshes" message
//!   client → server  { type: "live", on: bool }            Live Link on or off
//!   server → client  { type: "meshes", document, objects: [{ id, name, revision, positions, indices,
//!                    faceIds, path, hidden, normals? }] }
//!                    every body there is; z is up, millimetres. Bodies missing from it are gone.
//!                    A body's `revision` changes only when its mesh does, so an edit to one body
//!                    leaves the others' revisions (and the add-on's copies of them) alone.
//!                    `document` is the file's name, `path` the outliner groups a body is in (from
//!                    the top) and `hidden` whether it is hidden; disabled bodies are not sent.
//!                    `normals` (x, y, z per position, z up) are the true surface normals, so
//!                    curved faces shade smoothly; left out when not known (refaceted meshes).
//!   client → server  { type: "refacet", ids, tolerance, angle, ngon, min_width,
//!                    edge_chord_tolerance, edge_angle_tolerance, face_plane_tolerance,
//!                    face_angle_tolerance }
//!                    reply: a "meshes" message with `partial: true` holding just those bodies,
//!                    faceted at those settings (Plasticity's Refacet; the rest stay as they are)
//!   server → client  { type: "error", message }
//! Only 127.0.0.1 is listened on.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
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

/// Preferences › Network: whether the bridge runs and on which port, kept as JSON in the app's
/// config folder and read when the app starts.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, serde::Deserialize)]
pub struct Settings {
    pub bridge: bool,
    pub port: u16,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { bridge: true, port: PORT }
    }
}

impl Settings {
    /// The stored settings, or the defaults for a missing or unreadable file. Ports below 1024
    /// need privileges, so they read as the default.
    pub fn read(text: Option<&str>) -> Settings {
        let mut s: Settings = text.and_then(|t| serde_json::from_str(t).ok()).unwrap_or_default();
        if s.port < 1024 { s.port = PORT }
        s
    }
}

type Scene = Arc<dyn Fn() -> Result<Vec<Body>, String> + Send + Sync>;
/// Facets the bodies named at Refacet settings (the request's JSON, as api::Refacet reads it).
pub type RefacetFn = Arc<dyn Fn(Vec<u32>, &Value) -> Result<Vec<Body>, String> + Send + Sync>;

struct Client {
    live: bool,
    out: Sender<Arc<String>>,
}

/// The running server. Dropping it does not stop it; it lives as long as the app.
#[derive(Clone)]
pub struct Bridge {
    clients: Arc<Mutex<Vec<Arc<Mutex<Client>>>>>,
    scene: Scene,
    outline: Arc<Mutex<Value>>,
    refacet: Arc<Mutex<Option<RefacetFn>>>,
    /// Per body, its mesh's fingerprint and the revision it was first sent at: a body an edit left
    /// alone keeps its revision, so the add-on leaves its mesh (and Blender's undo) alone.
    sent: Arc<Mutex<HashMap<u32, (u64, u64)>>>,
    pub addr: SocketAddr,
}

/// What a body's mesh looks like, in one number.
fn fingerprint(b: &Body) -> u64 {
    let mut h = DefaultHasher::new();
    for v in b.positions.iter().chain(&b.normals) { v.to_bits().hash(&mut h) }
    b.indices.hash(&mut h);
    b.face_ids.hash(&mut h);
    h.finish()
}

/// Give each body the revision its mesh last changed at, remembered in `sent`.
fn settle_revisions(bodies: &mut [Body], sent: &Mutex<HashMap<u32, (u64, u64)>>) {
    let mut sent = sent.lock().unwrap();
    for b in bodies {
        let f = fingerprint(b);
        match sent.get(&b.id) {
            Some(&(seen, rev)) if seen == f => b.revision = rev,
            _ => { sent.insert(b.id, (f, b.revision)); }
        }
    }
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
    path: Vec<String>,
    hidden: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    normals: Vec<f32>,
}

/// The bodies as a "meshes" message, turned from the viewport's y-up to z-up. `outline` is what
/// the app last said about the document ({ document, objects: { id: { path, hidden } } }); a body
/// it names is sent with its groups, and once it has said anything, bodies it leaves out (disabled) go.
pub fn meshes(bodies: &[Body], outline: &Value) -> String {
    meshes_message(bodies, outline, false)
}

/// The "meshes" message; `partial` says it holds only some bodies (a Refacet reply), so the
/// add-on must not take the others as gone.
pub fn meshes_message(bodies: &[Body], outline: &Value, partial: bool) -> String {
    let known = outline["objects"].as_object();
    let objects: Vec<_> = bodies
        .iter()
        .filter_map(|b| {
            let o = &outline["objects"][b.id.to_string()];
            if known.is_some() && o.is_null() {
                return None;
            }
            Some((b, o))
        })
        .map(|(b, o)| MeshOut {
            id: b.id,
            name: o["name"].as_str().map(String::from).unwrap_or_else(|| format!("Witness Body {:02}", b.id)),
            revision: b.revision,
            positions: b
                .positions
                .chunks(3)
                .flat_map(|p| [p[0], -p[2], p[1]])
                .collect(),
            indices: &b.indices,
            face_ids: &b.face_ids,
            path: o["path"]
                .as_array()
                .map(|p| p.iter().filter_map(|g| g.as_str().map(String::from)).collect())
                .unwrap_or_default(),
            hidden: o["hidden"].as_bool().unwrap_or(false),
            normals: b.normals.chunks(3).flat_map(|n| [n[0], -n[2], n[1]]).collect(),
        })
        .collect();
    let document = outline["document"].as_str().unwrap_or("Witness 3D");
    let mut msg = json!({ "type": "meshes", "document": document, "objects": objects });
    if partial { msg["partial"] = json!(true) }
    msg.to_string()
}

impl Bridge {
    /// Listen on 127.0.0.1:`port` (0 picks a free one) and serve `scene` to whoever connects.
    pub fn start(port: u16, scene: Scene) -> std::io::Result<Bridge> {
        let listener = TcpListener::bind(("127.0.0.1", port))?;
        let bridge = Bridge {
            clients: Arc::default(),
            scene,
            outline: Arc::new(Mutex::new(Value::Null)),
            refacet: Arc::default(),
            sent: Arc::default(),
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

    /// The app's document name and outliner groups, sent with the meshes from now on.
    pub fn set_outline(&self, outline: Value) {
        *self.outline.lock().unwrap() = outline;
    }

    /// What answers Refacet requests; without one they get an error.
    pub fn on_refacet(&self, f: RefacetFn) {
        *self.refacet.lock().unwrap() = Some(f);
    }

    fn refaceted(&self, req: &Value) -> String {
        let ids: Vec<u32> = req["ids"].as_array().map(|a| a.iter().filter_map(|v| v.as_u64()).map(|v| v as u32).collect()).unwrap_or_default();
        let f = self.refacet.lock().unwrap().clone();
        match f.map(|f| f(ids, req)) {
            Some(Ok(bodies)) => meshes_message(&bodies, &self.outline.lock().unwrap(), true),
            Some(Err(e)) => json!({ "type": "error", "message": e }).to_string(),
            None => json!({ "type": "error", "message": "this app can't refacet" }).to_string(),
        }
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
            Ok(mut bodies) => {
                settle_revisions(&mut bodies, &self.sent);
                meshes(&bodies, &self.outline.lock().unwrap())
            }
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
                        Some("refacet") => ws.send(Message::text(self.refaceted(&v)))?,
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
