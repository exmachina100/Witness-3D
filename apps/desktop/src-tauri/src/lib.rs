//! Witness 3D desktop: Tauri commands over the modeling engine. Geometry never runs on the UI
//! thread; each command hands its work to the engine's thread and awaits the answer.

pub mod api;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::State;

struct Model(Arc<api::Model>);

/// Run blocking model work off the async runtime's threads.
async fn on_model<R: Send + 'static>(model: &State<'_, Model>, f: impl FnOnce(&api::Model) -> R + Send + 'static) -> Result<R, String> {
    let m = model.0.clone();
    tauri::async_runtime::spawn_blocking(move || f(&m)).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn scene(model: State<'_, Model>) -> Result<Vec<api::Body>, String> {
    on_model(&model, api::scene).await?
}

#[tauri::command]
async fn preview_extrude(model: State<'_, Model>, req: api::ExtrudeRequest) -> Result<Option<api::Preview>, String> {
    on_model(&model, move |m| api::preview(m, req)).await?.transpose()
}

#[tauri::command]
async fn commit_extrude(model: State<'_, Model>, req: api::ExtrudeRequest) -> Result<api::Committed, String> {
    on_model(&model, move |m| api::commit(m, req)).await?
}

#[tauri::command]
async fn undo(model: State<'_, Model>) -> Result<Vec<api::Body>, String> {
    on_model(&model, api::undo).await?
}

#[tauri::command]
async fn redo(model: State<'_, Model>) -> Result<Vec<api::Body>, String> {
    on_model(&model, api::redo).await?
}

#[tauri::command]
async fn preview_blend(model: State<'_, Model>, req: api::BlendRequest) -> Result<Option<api::Body>, api::ApiError> {
    on_model(&model, move |m| api::preview_blend(m, req)).await?.transpose()
}

#[tauri::command]
async fn commit_blend(model: State<'_, Model>, req: api::BlendRequest) -> Result<api::Committed, api::ApiError> {
    on_model(&model, move |m| api::commit_blend(m, req)).await?
}

#[tauri::command]
async fn new_document(model: State<'_, Model>) -> Result<Vec<api::Body>, String> {
    on_model(&model, api::new_document).await?
}

#[tauri::command]
async fn save(model: State<'_, Model>, path: PathBuf) -> Result<(), String> {
    on_model(&model, move |m| api::save(m, path)).await?
}

#[tauri::command]
async fn open(model: State<'_, Model>, path: PathBuf) -> Result<Vec<api::Body>, String> {
    on_model(&model, move |m| api::open(m, path)).await?
}

#[tauri::command]
async fn import_step(model: State<'_, Model>, path: PathBuf) -> Result<api::Committed, String> {
    on_model(&model, move |m| api::import_step(m, path)).await?
}

#[tauri::command]
async fn export_step(model: State<'_, Model>, id: u32, path: PathBuf) -> Result<(), String> {
    on_model(&model, move |m| api::export_step(m, id, path)).await?
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Model(Arc::new(api::start())))
        .invoke_handler(tauri::generate_handler![
            scene, preview_extrude, commit_extrude, preview_blend, commit_blend,
            undo, redo, new_document, save, open, import_step, export_step,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Witness 3D");
}
