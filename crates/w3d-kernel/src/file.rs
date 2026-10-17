//! The native `.w3d` file: exact geometry in the kernel's own format plus the document's units,
//! tolerance and body ids, as versioned JSON. STEP is for exchange; this is what reopens exactly.
//!
//! Saves are atomic: the file is written beside the target and renamed over it, so a crash
//! mid-save leaves the previous file intact.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::document::{BodyId, Curve, CurveId, Document, Ref, Refs, TOLERANCE, UNITS};
use crate::{Kernel, KernelError};

pub const FORMAT: &str = "witness3d";
/// Bump when the layout changes, and teach [`read`] to migrate the older ones.
pub const VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
struct File {
    format: String,
    version: u32,
    units: String,
    tolerance: f64,
    next_id: BodyId,
    /// Added after version 1 shipped; older files get fresh refs.
    #[serde(default)]
    next_ref: Ref,
    bodies: Vec<FileBody>,
    /// Drawn curves; added after version 1 shipped, so older files have none.
    #[serde(default)]
    curves: Vec<FileCurve>,
    #[serde(default)]
    next_curve: CurveId,
    /// The app's own state for the document (see [`Document::app_state`]); added after version 1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    app: Option<serde_json::Value>,
}

#[derive(Serialize, Deserialize)]
struct FileCurve {
    id: CurveId,
    #[serde(flatten)]
    curve: Curve,
}

#[derive(Serialize, Deserialize)]
struct FileBody {
    id: BodyId,
    /// What wrote `shape`, e.g. "occt-brep".
    encoding: String,
    shape: String,
    /// Face and edge refs by number (see [`Refs`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    face_refs: Option<Vec<Ref>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    edge_refs: Option<Vec<Ref>>,
}

fn err(e: impl std::fmt::Display) -> KernelError { KernelError::File(e.to_string()) }

/// The document as file contents.
pub fn write<K: Kernel>(doc: &Document<K>) -> Result<String, KernelError> {
    let bodies = doc.ids().into_iter().map(|id| Ok(FileBody {
        id,
        encoding: doc.kernel.native_format().into(),
        shape: doc.kernel.to_native(doc.get(id).unwrap())?,
        face_refs: doc.refs(id).map(|r| r.faces.clone()),
        edge_refs: doc.refs(id).map(|r| r.edges.clone()),
    })).collect::<Result<_, KernelError>>()?;
    let curves = doc.curve_ids().into_iter().map(|id| FileCurve { id, curve: doc.curve(id).unwrap().clone() }).collect();
    let file = File { format: FORMAT.into(), version: VERSION, units: UNITS.into(), tolerance: TOLERANCE, next_id: doc.next_id(), next_ref: doc.next_ref(), bodies, curves, next_curve: doc.next_curve(), app: doc.app_state.clone() };
    serde_json::to_string(&file).map_err(err)
}

/// Replace the document with the file's contents. Nothing changes if the file can't be read.
pub fn read<K: Kernel>(doc: &mut Document<K>, text: &str) -> Result<(), KernelError> {
    #[derive(Deserialize)]
    struct Header { format: String, version: u32 }
    let header: Header = serde_json::from_str(text).map_err(|_| err("this is not a Witness 3D file"))?;
    if header.format != FORMAT { return Err(err("this is not a Witness 3D file")) }
    if header.version > VERSION {
        return Err(err(format!("this file was saved by a newer Witness 3D (format {}); update to open it", header.version)));
    }
    let file: File = serde_json::from_str(text).map_err(|e| err(format!("the file is damaged: {e}")))?;
    if file.units != UNITS { return Err(err(format!("the file is in {}, and only {UNITS} is supported yet", file.units))) }
    let mut bodies = Vec::with_capacity(file.bodies.len());
    for b in file.bodies {
        if b.encoding != doc.kernel.native_format() {
            return Err(err(format!("body {} was saved as {}, which this kernel can't read", b.id, b.encoding)));
        }
        let solid = doc.kernel.from_native(&b.shape).map_err(|e| err(format!("body {} could not be read: {e}", b.id)))?;
        let refs = match (b.face_refs, b.edge_refs) {
            (Some(faces), Some(edges)) => Some(Refs { faces, edges }),
            _ => None,
        };
        bodies.push((b.id, solid, refs));
    }
    doc.replace_all(bodies, file.next_id, file.next_ref);
    doc.replace_curves(file.curves.into_iter().map(|c| (c.id, c.curve)), file.next_curve);
    doc.app_state = file.app;
    Ok(())
}

pub fn save<K: Kernel>(doc: &Document<K>, path: &Path) -> Result<(), KernelError> {
    let text = write(doc)?;
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".saving");
    std::fs::write(&tmp, text).map_err(err)?;
    std::fs::rename(&tmp, path).map_err(|e| { let _ = std::fs::remove_file(&tmp); err(e) })
}

pub fn open<K: Kernel>(doc: &mut Document<K>, path: &Path) -> Result<(), KernelError> {
    read(doc, &std::fs::read_to_string(path).map_err(err)?)
}
