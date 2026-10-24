//! Witness 3D desktop: Tauri commands over the modeling engine. Geometry never runs on the UI
//! thread; each command hands its work to the engine's thread and awaits the answer.

pub mod api;
pub mod bridge;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tauri::{Manager, State};

struct Model(Arc<api::Model>);

/// Run blocking model work off the async runtime's threads.
async fn on_model<R: Send + 'static>(
    model: &State<'_, Model>,
    f: impl FnOnce(&api::Model) -> R + Send + 'static,
) -> Result<R, String> {
    let m = model.0.clone();
    tauri::async_runtime::spawn_blocking(move || f(&m))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn scene(model: State<'_, Model>) -> Result<Vec<api::Body>, String> {
    on_model(&model, api::scene).await?
}

#[tauri::command]
async fn preview_extrude(
    model: State<'_, Model>,
    req: api::ExtrudeRequest,
) -> Result<Option<api::Preview>, String> {
    on_model(&model, move |m| api::preview(m, req))
        .await?
        .transpose()
}

#[tauri::command]
async fn commit_extrude(
    model: State<'_, Model>,
    req: api::ExtrudeRequest,
) -> Result<api::Committed, String> {
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
async fn preview_blend(
    model: State<'_, Model>,
    req: api::BlendRequest,
) -> Result<Option<api::Body>, api::ApiError> {
    on_model(&model, move |m| api::preview_blend(m, req))
        .await?
        .transpose()
}

#[tauri::command]
async fn commit_blend(
    model: State<'_, Model>,
    req: api::BlendRequest,
) -> Result<api::Committed, api::ApiError> {
    on_model(&model, move |m| api::commit_blend(m, req)).await?
}

#[tauri::command]
async fn preview_form(
    model: State<'_, Model>,
    req: api::FormRequest,
) -> Result<Option<api::Preview>, api::ApiError> {
    on_model(&model, move |m| api::preview_form(m, req))
        .await?
        .transpose()
}

#[tauri::command]
async fn commit_form(
    model: State<'_, Model>,
    req: api::FormRequest,
) -> Result<api::Committed, api::ApiError> {
    on_model(&model, move |m| api::commit_form(m, req)).await?
}

#[tauri::command]
async fn preview_primitive(
    model: State<'_, Model>,
    req: api::PrimitiveRequest,
) -> Result<Option<api::Preview>, api::ApiError> {
    on_model(&model, move |m| api::preview_primitive(m, req))
        .await?
        .transpose()
}

#[tauri::command]
async fn commit_primitive(
    model: State<'_, Model>,
    req: api::PrimitiveRequest,
) -> Result<api::Committed, api::ApiError> {
    on_model(&model, move |m| api::commit_primitive(m, req)).await?
}

#[tauri::command]
async fn preview_shell(
    model: State<'_, Model>,
    req: api::ShellRequest,
) -> Result<Option<api::Body>, api::ApiError> {
    on_model(&model, move |m| api::preview_shell(m, req))
        .await?
        .transpose()
}

#[tauri::command]
async fn commit_shell(
    model: State<'_, Model>,
    req: api::ShellRequest,
) -> Result<api::Committed, api::ApiError> {
    on_model(&model, move |m| api::commit_shell(m, req)).await?
}

#[tauri::command]
async fn preview_mirror(
    model: State<'_, Model>,
    req: api::MirrorRequest,
) -> Result<Option<Vec<api::Body>>, api::ApiError> {
    on_model(&model, move |m| api::preview_mirror(m, req))
        .await?
        .transpose()
}

#[tauri::command]
async fn commit_mirror(
    model: State<'_, Model>,
    req: api::MirrorRequest,
) -> Result<api::Duplicated, api::ApiError> {
    on_model(&model, move |m| api::commit_mirror(m, req)).await?
}

#[tauri::command]
async fn preview_deform(
    model: State<'_, Model>,
    req: api::DeformRequest,
) -> Result<Option<Vec<api::Body>>, api::ApiError> {
    on_model(&model, move |m| api::preview_deform(m, req))
        .await?
        .transpose()
}

#[tauri::command]
async fn commit_deform(
    model: State<'_, Model>,
    req: api::DeformRequest,
) -> Result<api::Duplicated, api::ApiError> {
    on_model(&model, move |m| api::commit_deform(m, req)).await?
}

#[tauri::command]
async fn face_uvn(
    model: State<'_, Model>,
    req: api::FaceUvnRequest,
) -> Result<api::FaceUvn, api::ApiError> {
    on_model(&model, move |m| api::face_uvn(m, req)).await?
}

#[tauri::command]
async fn face_poles(
    model: State<'_, Model>,
    req: api::FaceSurfacesRequest,
) -> Result<Vec<Vec<Vec<[f64; 3]>>>, api::ApiError> {
    on_model(&model, move |m| api::face_poles(m, req)).await?
}

#[tauri::command]
async fn face_surfaces(
    model: State<'_, Model>,
    req: api::FaceSurfacesRequest,
) -> Result<Vec<api::FaceSurfaceOut>, api::ApiError> {
    on_model(&model, move |m| api::face_surfaces(m, req)).await?
}

#[tauri::command]
async fn preview_place(
    model: State<'_, Model>,
    req: api::PlaceRequest,
) -> Result<Option<api::PlacePreview>, api::ApiError> {
    on_model(&model, move |m| api::preview_place(m, req))
        .await?
        .transpose()
}

#[tauri::command]
async fn commit_place(
    model: State<'_, Model>,
    req: api::PlaceRequest,
) -> Result<api::Duplicated, api::ApiError> {
    on_model(&model, move |m| api::commit_place(m, req)).await?
}

#[tauri::command]
async fn preview_array(
    model: State<'_, Model>,
    req: api::ArrayRequest,
) -> Result<Option<Vec<api::Body>>, api::ApiError> {
    on_model(&model, move |m| api::preview_array(m, req))
        .await?
        .transpose()
}

#[tauri::command]
async fn commit_array(
    model: State<'_, Model>,
    req: api::ArrayRequest,
) -> Result<api::Duplicated, api::ApiError> {
    on_model(&model, move |m| api::commit_array(m, req)).await?
}

#[tauri::command]
async fn preview_refillet(
    model: State<'_, Model>,
    req: api::RefilletRequest,
) -> Result<Option<api::Body>, api::ApiError> {
    on_model(&model, move |m| api::preview_refillet(m, req))
        .await?
        .transpose()
}

#[tauri::command]
async fn commit_refillet(
    model: State<'_, Model>,
    req: api::RefilletRequest,
) -> Result<api::Committed, api::ApiError> {
    on_model(&model, move |m| api::commit_refillet(m, req)).await?
}

#[tauri::command]
async fn preview_remove_faces(
    model: State<'_, Model>,
    req: api::RemoveFacesRequest,
) -> Result<Option<api::Body>, api::ApiError> {
    on_model(&model, move |m| api::preview_remove_faces(m, req))
        .await?
        .transpose()
}

#[tauri::command]
async fn commit_remove_faces(
    model: State<'_, Model>,
    req: api::RemoveFacesRequest,
) -> Result<api::Committed, api::ApiError> {
    on_model(&model, move |m| api::commit_remove_faces(m, req)).await?
}

#[tauri::command]
async fn mesh_bodies(
    model: State<'_, Model>,
    ids: Vec<u32>,
    tolerance: f64,
) -> Result<Vec<api::MeshOut>, api::ApiError> {
    on_model(&model, move |m| api::mesh_bodies(m, ids, tolerance)).await?
}

#[tauri::command]
async fn hidden_lines(
    model: State<'_, Model>,
    req: api::DrawingRequest,
) -> Result<Vec<api::DrawnLineOut>, api::ApiError> {
    on_model(&model, move |m| api::hidden_lines(m, req)).await?
}

#[tauri::command]
async fn write_export(path: std::path::PathBuf, data: Vec<u8>) -> Result<(), api::ApiError> {
    api::write_export(path, data)
}

#[tauri::command]
async fn preview_cut(
    model: State<'_, Model>,
    req: api::CutRequest,
) -> Result<Option<Vec<api::Body>>, api::ApiError> {
    on_model(&model, move |m| api::preview_cut(m, req))
        .await?
        .transpose()
}

#[tauri::command]
async fn commit_cut(
    model: State<'_, Model>,
    req: api::CutRequest,
) -> Result<api::Duplicated, api::ApiError> {
    on_model(&model, move |m| api::commit_cut(m, req)).await?
}

#[tauri::command]
async fn commit_reverse_sheets(
    model: State<'_, Model>,
    req: api::UnifyRequest,
) -> Result<Vec<api::Body>, api::ApiError> {
    on_model(&model, move |m| api::commit_reverse_sheets(m, req)).await?
}

#[tauri::command]
async fn boundary_edges(
    model: State<'_, Model>,
    req: api::UnifyRequest,
) -> Result<Vec<api::BoundaryEdges>, api::ApiError> {
    on_model(&model, move |m| api::boundary_edges(m, req)).await?
}

#[tauri::command]
async fn fillet_faces(
    model: State<'_, Model>,
    req: api::RemoveFacesRequest,
) -> Result<Vec<u32>, api::ApiError> {
    on_model(&model, move |m| api::fillet_faces(m, req)).await?
}

#[tauri::command]
async fn commit_unify(
    model: State<'_, Model>,
    req: api::UnifyRequest,
) -> Result<api::Unified, api::ApiError> {
    on_model(&model, move |m| api::commit_unify(m, req)).await?
}

#[tauri::command]
async fn preview_imprint(
    model: State<'_, Model>,
    req: api::ImprintRequest,
) -> Result<Option<api::Body>, api::ApiError> {
    on_model(&model, move |m| api::preview_imprint(m, req))
        .await?
        .transpose()
}

#[tauri::command]
async fn commit_imprint(
    model: State<'_, Model>,
    req: api::ImprintRequest,
) -> Result<api::Committed, api::ApiError> {
    on_model(&model, move |m| api::commit_imprint(m, req)).await?
}

#[tauri::command]
async fn preview_offset_edges(
    model: State<'_, Model>,
    req: api::OffsetEdgesRequest,
) -> Result<Option<api::Body>, api::ApiError> {
    on_model(&model, move |m| api::preview_offset_edges(m, req))
        .await?
        .transpose()
}

#[tauri::command]
async fn commit_offset_edges(
    model: State<'_, Model>,
    req: api::OffsetEdgesRequest,
) -> Result<api::Committed, api::ApiError> {
    on_model(&model, move |m| api::commit_offset_edges(m, req)).await?
}

#[tauri::command]
async fn preview_join_sheets(
    model: State<'_, Model>,
    req: api::JoinSheetsRequest,
) -> Result<Option<api::Body>, api::ApiError> {
    on_model(&model, move |m| api::preview_join_sheets(m, req))
        .await?
        .transpose()
}

#[tauri::command]
async fn commit_join_sheets(
    model: State<'_, Model>,
    req: api::JoinSheetsRequest,
) -> Result<api::Committed, api::ApiError> {
    on_model(&model, move |m| api::commit_join_sheets(m, req)).await?
}

#[tauri::command]
async fn commit_unjoin(
    model: State<'_, Model>,
    req: api::UnjoinRequest,
) -> Result<api::Duplicated, api::ApiError> {
    on_model(&model, move |m| api::commit_unjoin(m, req)).await?
}

#[tauri::command]
async fn preview_match_faces(
    model: State<'_, Model>,
    req: api::MatchFacesRequest,
) -> Result<Option<api::Body>, api::ApiError> {
    on_model(&model, move |m| api::preview_match_faces(m, req))
        .await?
        .transpose()
}

#[tauri::command]
async fn commit_match_faces(
    model: State<'_, Model>,
    req: api::MatchFacesRequest,
) -> Result<api::Committed, api::ApiError> {
    on_model(&model, move |m| api::commit_match_faces(m, req)).await?
}

#[tauri::command]
async fn commit_raise_faces(
    model: State<'_, Model>,
    req: api::RaiseFacesRequest,
) -> Result<api::RebuildCommitted, api::ApiError> {
    on_model(&model, move |m| api::commit_raise_faces(m, req)).await?
}

#[tauri::command]
async fn commit_subdivide_faces(
    model: State<'_, Model>,
    req: api::SubdivideFacesRequest,
) -> Result<api::Committed, api::ApiError> {
    on_model(&model, move |m| api::commit_subdivide_faces(m, req)).await?
}

#[tauri::command]
async fn preview_move_face_poles(
    model: State<'_, Model>,
    req: api::MoveFacePolesRequest,
) -> Result<Option<api::Body>, api::ApiError> {
    on_model(&model, move |m| api::preview_move_face_poles(m, req))
        .await?
        .transpose()
}

#[tauri::command]
async fn commit_move_face_poles(
    model: State<'_, Model>,
    req: api::MoveFacePolesRequest,
) -> Result<api::Committed, api::ApiError> {
    on_model(&model, move |m| api::commit_move_face_poles(m, req)).await?
}

#[tauri::command]
async fn preview_rebuild_faces(
    model: State<'_, Model>,
    req: api::RebuildFacesRequest,
) -> Result<Option<api::RebuildPreview>, api::ApiError> {
    on_model(&model, move |m| api::preview_rebuild_faces(m, req))
        .await?
        .transpose()
}

#[tauri::command]
async fn commit_rebuild_faces(
    model: State<'_, Model>,
    req: api::RebuildFacesRequest,
) -> Result<api::RebuildCommitted, api::ApiError> {
    on_model(&model, move |m| api::commit_rebuild_faces(m, req)).await?
}

#[tauri::command]
async fn preview_extend_sheet(
    model: State<'_, Model>,
    req: api::ExtendSheetRequest,
) -> Result<Option<api::Body>, api::ApiError> {
    on_model(&model, move |m| api::preview_extend_sheet(m, req))
        .await?
        .transpose()
}

#[tauri::command]
async fn commit_extend_sheet(
    model: State<'_, Model>,
    req: api::ExtendSheetRequest,
) -> Result<api::Committed, api::ApiError> {
    on_model(&model, move |m| api::commit_extend_sheet(m, req)).await?
}

#[tauri::command]
async fn preview_thicken(
    model: State<'_, Model>,
    req: api::ThickenRequest,
) -> Result<Option<api::Body>, api::ApiError> {
    on_model(&model, move |m| api::preview_thicken(m, req))
        .await?
        .transpose()
}

#[tauri::command]
async fn preview_pipe(
    model: State<'_, Model>,
    req: api::PipeRequest,
) -> Result<Option<api::Body>, api::ApiError> {
    on_model(&model, move |m| api::preview_pipe(m, req))
        .await?
        .transpose()
}

#[tauri::command]
async fn commit_pipe(
    model: State<'_, Model>,
    req: api::PipeRequest,
) -> Result<api::Duplicated, api::ApiError> {
    on_model(&model, move |m| api::commit_pipe(m, req)).await?
}

#[tauri::command]
async fn edge_curvature(
    model: State<'_, Model>,
    req: api::EdgeCurvatureRequest,
) -> Result<Vec<w3d_kernel::CombTooth>, api::ApiError> {
    on_model(&model, move |m| api::edge_curvature(m, req)).await?
}

#[tauri::command]
async fn preview_untrim(
    model: State<'_, Model>,
    req: api::UntrimRequest,
) -> Result<Option<api::Body>, api::ApiError> {
    on_model(&model, move |m| api::preview_untrim(m, req))
        .await?
        .transpose()
}

#[tauri::command]
async fn commit_untrim(
    model: State<'_, Model>,
    req: api::UntrimRequest,
) -> Result<api::Duplicated, api::ApiError> {
    on_model(&model, move |m| api::commit_untrim(m, req)).await?
}

#[tauri::command]
async fn preview_unwrap(
    model: State<'_, Model>,
    req: api::UnwrapRequest,
) -> Result<Option<api::Body>, api::ApiError> {
    on_model(&model, move |m| api::preview_unwrap(m, req))
        .await?
        .transpose()
}

#[tauri::command]
async fn commit_unwrap(
    model: State<'_, Model>,
    req: api::UnwrapRequest,
) -> Result<api::Duplicated, api::ApiError> {
    on_model(&model, move |m| api::commit_unwrap(m, req)).await?
}

#[tauri::command]
async fn commit_thicken(
    model: State<'_, Model>,
    req: api::ThickenRequest,
) -> Result<api::Committed, api::ApiError> {
    on_model(&model, move |m| api::commit_thicken(m, req)).await?
}

#[tauri::command]
async fn preview_bridge_surface(
    model: State<'_, Model>,
    req: api::BridgeSurfaceRequest,
) -> Result<Option<api::Body>, api::ApiError> {
    on_model(&model, move |m| api::preview_bridge_surface(m, req))
        .await?
        .transpose()
}

#[tauri::command]
async fn commit_bridge_surface(
    model: State<'_, Model>,
    req: api::BridgeSurfaceRequest,
) -> Result<api::Committed, api::ApiError> {
    on_model(&model, move |m| api::commit_bridge_surface(m, req)).await?
}

#[tauri::command]
async fn preview_patch(
    model: State<'_, Model>,
    req: api::PatchRequest,
) -> Result<Option<api::Body>, api::ApiError> {
    on_model(&model, move |m| api::preview_patch(m, req))
        .await?
        .transpose()
}

#[tauri::command]
async fn commit_patch(
    model: State<'_, Model>,
    req: api::PatchRequest,
) -> Result<api::Committed, api::ApiError> {
    on_model(&model, move |m| api::commit_patch(m, req)).await?
}

#[tauri::command]
async fn preview_project(
    model: State<'_, Model>,
    req: api::ProjectRequest,
) -> Result<Option<Vec<w3d_kernel::Curve>>, api::ApiError> {
    on_model(&model, move |m| api::preview_project(m, req))
        .await?
        .transpose()
}

#[tauri::command]
async fn preview_draft(
    model: State<'_, Model>,
    req: api::DraftRequest,
) -> Result<Option<api::Body>, api::ApiError> {
    on_model(&model, move |m| api::preview_draft(m, req))
        .await?
        .transpose()
}

#[tauri::command]
async fn commit_draft(
    model: State<'_, Model>,
    req: api::DraftRequest,
) -> Result<api::Committed, api::ApiError> {
    on_model(&model, move |m| api::commit_draft(m, req)).await?
}

#[tauri::command]
async fn replace_curves(
    model: State<'_, Model>,
    req: api::ReplaceCurvesRequest,
) -> Result<api::AddedCurves, api::ApiError> {
    on_model(&model, move |m| api::replace_curves(m, req)).await?
}

#[tauri::command]
async fn preview_offset(
    model: State<'_, Model>,
    req: api::OffsetRequest,
) -> Result<Option<api::Body>, api::ApiError> {
    on_model(&model, move |m| api::preview_offset(m, req))
        .await?
        .transpose()
}

#[tauri::command]
async fn commit_offset(
    model: State<'_, Model>,
    req: api::OffsetRequest,
) -> Result<api::Committed, api::ApiError> {
    on_model(&model, move |m| api::commit_offset(m, req)).await?
}

#[tauri::command]
async fn commit_motion(
    model: State<'_, Model>,
    req: api::MotionRequest,
) -> Result<api::Committed, api::ApiError> {
    on_model(&model, move |m| api::commit_motion(m, req)).await?
}

#[tauri::command]
async fn delete_bodies(
    model: State<'_, Model>,
    ids: Vec<u32>,
) -> Result<Vec<api::Body>, api::ApiError> {
    on_model(&model, move |m| api::delete_bodies(m, ids)).await?
}

#[tauri::command]
async fn curves(model: State<'_, Model>) -> Result<Vec<api::CurveOut>, String> {
    on_model(&model, api::curves).await
}

#[tauri::command]
async fn add_curves(
    model: State<'_, Model>,
    curves: Vec<w3d_kernel::Curve>,
) -> Result<api::AddedCurves, api::ApiError> {
    on_model(&model, move |m| api::add_curves(m, curves)).await?
}

#[tauri::command]
async fn join_curves(
    model: State<'_, Model>,
    ids: Vec<u32>,
) -> Result<api::AddedCurves, api::ApiError> {
    on_model(&model, move |m| api::join_curves(m, ids)).await?
}

#[tauri::command]
async fn delete_items(
    model: State<'_, Model>,
    bodies: Vec<u32>,
    curves: Vec<u32>,
) -> Result<Vec<api::Body>, api::ApiError> {
    on_model(&model, move |m| api::delete_items(m, bodies, curves)).await?
}

#[tauri::command]
async fn preview_boolean(
    model: State<'_, Model>,
    req: api::BooleanRequest,
) -> Result<Option<api::BooleanPreview>, api::ApiError> {
    on_model(&model, move |m| api::preview_boolean(m, req))
        .await?
        .transpose()
}

#[tauri::command]
async fn commit_boolean(
    model: State<'_, Model>,
    req: api::BooleanRequest,
) -> Result<api::Committed, api::ApiError> {
    on_model(&model, move |m| api::commit_boolean(m, req)).await?
}

#[tauri::command]
async fn duplicate_bodies(
    model: State<'_, Model>,
    ids: Vec<u32>,
) -> Result<api::Duplicated, api::ApiError> {
    on_model(&model, move |m| api::duplicate_bodies(m, ids)).await?
}

#[tauri::command]
async fn new_document(model: State<'_, Model>) -> Result<Vec<api::Body>, String> {
    on_model(&model, api::new_document).await?
}

#[tauri::command]
async fn app_state(model: State<'_, Model>) -> Result<Option<serde_json::Value>, String> {
    on_model(&model, api::app_state).await?
}

#[tauri::command]
async fn set_app_state(model: State<'_, Model>, state: Option<serde_json::Value>) -> Result<(), String> {
    on_model(&model, move |m| api::set_app_state(m, state)).await?
}

#[tauri::command]
async fn save(model: State<'_, Model>, path: PathBuf) -> Result<(), String> {
    on_model(&model, move |m| api::save(m, path)).await?
}

#[tauri::command]
async fn open(model: State<'_, Model>, path: PathBuf) -> Result<Vec<api::Body>, String> {
    on_model(&model, move |m| api::open(m, path)).await?
}

/// A .w3d the app was started with (double-clicked in the file manager, or `witness-3d model.w3d`),
/// handed to the UI once, which opens it as File › Open would.
struct StartupFile(Mutex<Option<PathBuf>>);

/// The first argument that names a .w3d file.
fn w3d_arg(args: impl IntoIterator<Item = String>) -> Option<PathBuf> {
    args.into_iter()
        .skip(1)
        .map(PathBuf::from)
        .find(|p| p.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("w3d")))
}

#[tauri::command]
fn startup_file(file: State<'_, StartupFile>) -> Option<PathBuf> {
    file.0.lock().ok()?.take()
}

#[tauri::command]
async fn import_step(model: State<'_, Model>, path: PathBuf) -> Result<api::Committed, String> {
    on_model(&model, move |m| api::import_step(m, path)).await?
}

/// A PNG or JPEG for File › Import, which places it as a reference image in the UI.
#[tauri::command]
async fn read_image(path: PathBuf) -> Result<tauri::ipc::Response, String> {
    let ext = path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase());
    if !matches!(ext.as_deref(), Some("png" | "jpg" | "jpeg")) { return Err("reference images are .png or .jpg files".into()) }
    let size = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if size > 64 << 20 { return Err("that image is over 64 MB".into()) }
    Ok(tauri::ipc::Response::new(std::fs::read(&path).map_err(|e| e.to_string())?))
}

/// A DXF drawing's text for File › Import, which turns it into curves in the UI (web/src/dxf.js).
#[tauri::command]
async fn read_dxf(path: PathBuf) -> Result<String, String> {
    let dxf = path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("dxf"));
    if !dxf { return Err("only .dxf drawings are read this way".into()) }
    let size = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if size > 256 << 20 { return Err("that drawing is over 256 MB".into()) }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    // Older DXFs are in the drawing's code page; anything not UTF-8 only matters inside text entities.
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[tauri::command]
async fn export_step(model: State<'_, Model>, id: u32, path: PathBuf) -> Result<(), String> {
    on_model(&model, move |m| api::export_step(m, id, path)).await?
}

/// The model changed; send it to Blender add-ons with Live Link on. Returns (connected, live).
#[tauri::command]
async fn bridge_changed(
    bridge: State<'_, Option<bridge::Bridge>>,
) -> Result<(usize, usize), String> {
    let Some(b) = bridge.inner().clone() else {
        return Ok((0, 0));
    };
    tauri::async_runtime::spawn_blocking(move || {
        b.changed();
        b.status()
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn bridge_status(bridge: State<'_, Option<bridge::Bridge>>) -> (usize, usize) {
    bridge.as_ref().map_or((0, 0), |b| b.status())
}

/// Where the user's Anthropic API key is kept: the app's config folder, never the repo or a document.
fn key_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("anthropic-api-key"))
}

/// The key for AI commands: ANTHROPIC_API_KEY if set, else the one saved with `set_ai_key`.
#[tauri::command]
fn ai_key(app: tauri::AppHandle) -> Result<Option<String>, String> {
    if let Ok(k) = std::env::var("ANTHROPIC_API_KEY") {
        if !k.is_empty() {
            return Ok(Some(k));
        }
    }
    Ok(std::fs::read_to_string(key_file(&app)?)
        .ok()
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty()))
}

/// Save the key (readable by this user only), or forget it when empty.
#[tauri::command]
fn set_ai_key(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let path = key_file(&app)?;
    if key.trim().is_empty() {
        let _ = std::fs::remove_file(&path);
        return Ok(());
    }
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    use std::io::Write;
    opts.open(&path)
        .and_then(|mut f| f.write_all(key.trim().as_bytes()))
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::w3d_arg;
    use std::path::PathBuf;

    #[test]
    fn finds_the_model_argument() {
        let args = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(w3d_arg(args(&["witness-3d", "--flag", "C:\\models\\Part.W3D"])), Some(PathBuf::from("C:\\models\\Part.W3D")));
        assert_eq!(w3d_arg(args(&["witness-3d", "notes.txt"])), None);
        assert_eq!(w3d_arg(args(&["part.w3d"])), None);
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let model = Arc::new(api::start());
            let m = model.clone();
            // Without the port (another copy running, say) the app still works, minus the bridge.
            let bridge = bridge::Bridge::start(bridge::PORT, Arc::new(move || api::scene(&m)))
                .map_err(|e| eprintln!("Blender bridge off: {e}"))
                .ok();
            app.manage(Model(model));
            app.manage(bridge);
            app.manage(StartupFile(Mutex::new(w3d_arg(std::env::args()))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scene,
            preview_extrude,
            commit_extrude,
            preview_blend,
            commit_blend,
            preview_form,
            commit_form,
            read_dxf,
            read_image,
            preview_offset,
            commit_offset,
            replace_curves,
            preview_cut,
            commit_cut,
            preview_imprint,
            commit_imprint,
            preview_offset_edges,
            commit_offset_edges,
            preview_patch,
            commit_patch,
            preview_join_sheets,
            commit_join_sheets,
            commit_unjoin,
            preview_match_faces,
            commit_match_faces,
            commit_raise_faces,
            commit_subdivide_faces,
            preview_move_face_poles,
            commit_move_face_poles,
            preview_rebuild_faces,
            commit_rebuild_faces,
            preview_extend_sheet,
            commit_extend_sheet,
            preview_thicken,
            commit_thicken,
            edge_curvature,
            preview_untrim,
            commit_untrim,
            preview_unwrap,
            commit_unwrap,
            preview_pipe,
            commit_pipe,
            preview_bridge_surface,
            commit_bridge_surface,
            preview_project,
            preview_draft,
            commit_draft,
            mesh_bodies,
            write_export,
            hidden_lines,
            preview_remove_faces,
            commit_remove_faces,
            preview_refillet,
            commit_refillet,
            commit_unify,
            boundary_edges,
            fillet_faces,
            commit_reverse_sheets,
            preview_primitive,
            commit_primitive,
            preview_shell,
            commit_shell,
            preview_mirror,
            commit_mirror,
            preview_array,
            commit_array,
            face_surfaces,
            face_poles,
            face_uvn,
            preview_deform,
            commit_deform,
            preview_place,
            commit_place,
            commit_motion,
            delete_bodies,
            duplicate_bodies,
            curves,
            add_curves,
            join_curves,
            delete_items,
            preview_boolean,
            commit_boolean,
            undo,
            redo,
            new_document,
            save,
            app_state,
            set_app_state,
            open,
            startup_file,
            import_step,
            export_step,
            bridge_changed,
            bridge_status,
            ai_key,
            set_ai_key,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Witness 3D")
        .run(|_app, _event| {
            // macOS hands double-clicked files over as an event rather than as arguments: keep the
            // first for start-up, and tell a running window to open it.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                use tauri::Emitter;
                let path = urls.iter().filter_map(|u| u.to_file_path().ok()).find(|p| w3d_arg(["".into(), p.to_string_lossy().into()]).is_some());
                if let Some(path) = path {
                    if let Some(file) = _app.try_state::<StartupFile>() { if let Ok(mut f) = file.0.lock() { *f = Some(path.clone()) } }
                    let _ = _app.emit("open-file", path);
                }
            }
        });
}
