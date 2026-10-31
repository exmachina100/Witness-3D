// The desktop app's page: the shared Witness 3D UI (web/src/app) driving the Rust engine.
// Geometry lives in crates/w3d-kernel (OpenCascade); every call below crosses into Rust.
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/700.css';
import '@fontsource/space-grotesk/700.css';
import '../../../web/src/app/app.css';
import { mount } from '../../../web/src/app/App.js';

const tauri = window.__TAURI__;

const W3D = [{ name: 'Witness 3D', extensions: ['w3d'] }];
// STEP, and IGES on the desktop (the browser's OpenCascade build has no IGES).
const STEP = [{ name: 'STEP', extensions: ['step', 'stp'] }, { name: 'IGES', extensions: ['igs', 'iges'] }];
// File › Import also reads DXF drawings, as curves (web/src/dxf.js), and PNG and JPEG reference images.
const IMPORT = [{ name: 'STEP, IGES, DXF, images', extensions: ['step', 'stp', 'igs', 'iges', 'dxf', 'png', 'jpg', 'jpeg'] }, ...STEP, { name: 'DXF', extensions: ['dxf'] }, { name: 'Reference images', extensions: ['png', 'jpg', 'jpeg'] }];
const baseName = p => p.split(/[\\/]/).pop();
let filePath = null; // where Save writes without asking

const rust = {
  info: { kernel: 'OPENCASCADE 7.8 · RUST', units: 'mm' },
  scene: () => tauri.core.invoke('scene'),
  preview: req => tauri.core.invoke('preview_extrude', { req }),
  commit: req => tauri.core.invoke('commit_extrude', { req }),
  previewBlend: req => tauri.core.invoke('preview_blend', { req }),
  commitBlend: req => tauri.core.invoke('commit_blend', { req }),
  commitMotion: req => tauri.core.invoke('commit_motion', { req }),
  deleteBodies: ids => tauri.core.invoke('delete_bodies', { ids }),
  duplicateBodies: ids => tauri.core.invoke('duplicate_bodies', { ids }),
  curves: () => tauri.core.invoke('curves'),
  addCurves: curves => tauri.core.invoke('add_curves', { curves }),
  joinCurves: ids => tauri.core.invoke('join_curves', { ids }),
  deleteItems: (bodies, curves) => tauri.core.invoke('delete_items', { bodies, curves }),
  previewBoolean: req => tauri.core.invoke('preview_boolean', { req }),
  commitBoolean: req => tauri.core.invoke('commit_boolean', { req }),
  previewForm: req => tauri.core.invoke('preview_form', { req }),
  commitForm: req => tauri.core.invoke('commit_form', { req }),
  previewOffset: req => tauri.core.invoke('preview_offset', { req }),
  commitOffset: req => tauri.core.invoke('commit_offset', { req }),
  previewRemoveFaces: req => tauri.core.invoke('preview_remove_faces', { req }),
  commitRemoveFaces: req => tauri.core.invoke('commit_remove_faces', { req }),
  previewRefillet: req => tauri.core.invoke('preview_refillet', { req }),
  commitRefillet: req => tauri.core.invoke('commit_refillet', { req }),
  commitUnify: req => tauri.core.invoke('commit_unify', { req }),
  commitReverseSheets: req => tauri.core.invoke('commit_reverse_sheets', { req }),
  boundaryEdges: req => tauri.core.invoke('boundary_edges', { req }),
  filletFaces: req => tauri.core.invoke('fillet_faces', { req }),
  // The desktop meshes at the chord tolerance; OpenCascade's mesher here takes no separate angle.
  hiddenLines: req => tauri.core.invoke('hidden_lines', { req }),
  meshBodies: (ids, { tolerance = 0.05 } = {}) => tauri.core.invoke('mesh_bodies', { ids, tolerance }),
  async saveExport(name, data) {
    const ext = name.split('.').pop();
    const path = await tauri.dialog.save({ defaultPath: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return null;
    await tauri.core.invoke('write_export', { path, data: Array.from(typeof data === 'string' ? new TextEncoder().encode(data) : data) });
    return `SAVED ${path}`;
  },
  previewCut: req => tauri.core.invoke('preview_cut', { req }),
  commitCut: req => tauri.core.invoke('commit_cut', { req }),
  previewImprint: req => tauri.core.invoke('preview_imprint', { req }),
  commitImprint: req => tauri.core.invoke('commit_imprint', { req }),
  previewOffsetEdges: req => tauri.core.invoke('preview_offset_edges', { req }),
  previewIsoparamSplit: req => tauri.core.invoke('preview_isoparam_split', { req }),
  commitIsoparamSplit: req => tauri.core.invoke('commit_isoparam_split', { req }),
  commitOffsetEdges: req => tauri.core.invoke('commit_offset_edges', { req }),
  previewPatch: req => tauri.core.invoke('preview_patch', { req }),
  commitPatch: req => tauri.core.invoke('commit_patch', { req }),
  previewJoinSheets: req => tauri.core.invoke('preview_join_sheets', { req }),
  commitJoinSheets: req => tauri.core.invoke('commit_join_sheets', { req }),
  commitUnjoin: req => tauri.core.invoke('commit_unjoin', { req }),
  previewExtendSheet: req => tauri.core.invoke('preview_extend_sheet', { req }),
  commitExtendSheet: req => tauri.core.invoke('commit_extend_sheet', { req }),
  previewThicken: req => tauri.core.invoke('preview_thicken', { req }),
  commitThicken: req => tauri.core.invoke('commit_thicken', { req }),
  edgeCurvature: req => tauri.core.invoke('edge_curvature', { req }),
  previewSplineSheet: req => tauri.core.invoke('preview_spline_sheet', { req }),
  commitSplineSheet: req => tauri.core.invoke('commit_spline_sheet', { req }),
  previewUntrim: req => tauri.core.invoke('preview_untrim', { req }),
  commitUntrim: req => tauri.core.invoke('commit_untrim', { req }),
  previewUnwrap: req => tauri.core.invoke('preview_unwrap', { req }),
  commitUnwrap: req => tauri.core.invoke('commit_unwrap', { req }),
  previewPipe: req => tauri.core.invoke('preview_pipe', { req }),
  commitPipe: req => tauri.core.invoke('commit_pipe', { req }),
  previewBridgeSurface: req => tauri.core.invoke('preview_bridge_surface', { req }),
  commitBridgeSurface: req => tauri.core.invoke('commit_bridge_surface', { req }),
  previewSheetBridge: req => tauri.core.invoke('preview_sheet_bridge', { req }),
  commitSheetBridge: req => tauri.core.invoke('commit_sheet_bridge', { req }),
  previewProject: req => tauri.core.invoke('preview_project', { req }),
  previewMatchFaces: req => tauri.core.invoke('preview_match_faces', { req }),
  commitMatchFaces: req => tauri.core.invoke('commit_match_faces', { req }),
  commitRaiseFaces: req => tauri.core.invoke('commit_raise_faces', { req }),
  commitSubdivideFaces: req => tauri.core.invoke('commit_subdivide_faces', { req }),
  previewMoveFaces: req => tauri.core.invoke('preview_move_faces', { req }),
  commitMoveFaces: req => tauri.core.invoke('commit_move_faces', { req }),
  previewMoveFacePoles: req => tauri.core.invoke('preview_move_face_poles', { req }),
  commitMoveFacePoles: req => tauri.core.invoke('commit_move_face_poles', { req }),
  previewRebuildFaces: req => tauri.core.invoke('preview_rebuild_faces', { req }),
  commitRebuildFaces: req => tauri.core.invoke('commit_rebuild_faces', { req }),
  previewDraft: req => tauri.core.invoke('preview_draft', { req }),
  commitDraft: req => tauri.core.invoke('commit_draft', { req }),
  replaceCurves: (ids, curves) => tauri.core.invoke('replace_curves', { req: { ids, curves } }),
  previewPrimitive: req => tauri.core.invoke('preview_primitive', { req }),
  commitPrimitive: req => tauri.core.invoke('commit_primitive', { req }),
  previewShell: req => tauri.core.invoke('preview_shell', { req }),
  commitShell: req => tauri.core.invoke('commit_shell', { req }),
  previewMirror: req => tauri.core.invoke('preview_mirror', { req }),
  commitMirror: req => tauri.core.invoke('commit_mirror', { req }),
  previewArray: req => tauri.core.invoke('preview_array', { req }),
  commitArray: req => tauri.core.invoke('commit_array', { req }),
  faceSurfaces: req => tauri.core.invoke('face_surfaces', { req }),
  facePoles: req => tauri.core.invoke('face_poles', { req }),
  faceUvn: req => tauri.core.invoke('face_uvn', { req }),
  edgeFaces: req => tauri.core.invoke('edge_faces', { req }),
  previewDeform: req => tauri.core.invoke('preview_deform', { req }),
  commitDeform: req => tauri.core.invoke('commit_deform', { req }),
  previewPlace: req => tauri.core.invoke('preview_place', { req }),
  commitPlace: req => tauri.core.invoke('commit_place', { req }),
  copyBodies: bodies => tauri.core.invoke('copy_bodies', { bodies }),
  setMeshQuality: quality => tauri.core.invoke('set_mesh_quality', { quality }),
  // The Anthropic key for AI commands lives in the app's config folder (or ANTHROPIC_API_KEY).
  aiKey: () => tauri.core.invoke('ai_key'),
  setAiKey: key => tauri.core.invoke('set_ai_key', { key }),
  // The Blender bridge: tell Live Link the model changed; both answer [connected, live].
  sceneChanged: outline => tauri.core.invoke('bridge_changed', { outline: outline ?? null }),
  bridgeStatus: () => tauri.core.invoke('bridge_status'),
  networkPrefs: () => tauri.core.invoke('network_prefs'),
  setNetworkPrefs: prefs => tauri.core.invoke('set_network_prefs', { prefs }),
  undo: () => tauri.core.invoke('undo'),
  redo: () => tauri.core.invoke('redo'),
  newDocument() { filePath = null; return tauri.core.invoke('new_document'); },
  async save() {
    const path = filePath ?? await tauri.dialog.save({ defaultPath: 'untitled.w3d', filters: W3D });
    if (!path) return null;
    await tauri.core.invoke('save', { path });
    filePath = path;
    return baseName(path);
  },
  async saveAs() {
    const path = await tauri.dialog.save({ defaultPath: filePath ? baseName(filePath) : 'untitled.w3d', filters: W3D });
    if (!path) return null;
    await tauri.core.invoke('save', { path });
    filePath = path;
    return baseName(path);
  },
  // Plasticity's Quick save version: a copy next to the file, named with the time; the document stays where it was.
  async saveVersion() {
    if (!filePath) return rust.save();
    const t = new Date(), pad = n => String(n).padStart(2, '0');
    const stamp = `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}-${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}`;
    const path = filePath.replace(/(\.w3d)?$/i, `-${stamp}.w3d`);
    await tauri.core.invoke('save', { path });
    return baseName(path);
  },
  async open(path) {
    path ??= await tauri.dialog.open({ multiple: false, directory: false, filters: W3D });
    if (!path) return null;
    const scene = await tauri.core.invoke('open', { path });
    filePath = path;
    return { name: baseName(path), scene };
  },
  get filePath() { return filePath; },
  // File › Save As Startup Scene: the scene New File and launch start from, in the app's config folder.
  saveStartupScene: () => tauri.core.invoke('save_startup_scene'),
  resetStartupScene: () => tauri.core.invoke('reset_startup_scene'),
  // P-Menu › New Window: another copy of the app, with a document of its own.
  newWindow: () => tauri.core.invoke('new_window'),
  // The Text command's SYSTEM FONT list: the installed TrueType fonts, each read when picked.
  async systemFonts() {
    const fonts = await tauri.core.invoke('system_fonts');
    return fonts.map(({ name, path }) => ({ name, read: () => tauri.core.invoke('read_font', { path }) }));
  },
  // A .w3d the app was opened with (a double-click in the file manager), once; and, on macOS, files
  // handed to the running app.
  startupFile: () => tauri.core.invoke('startup_file'),
  onOpenFile: fn => tauri.event.listen('open-file', () => fn()),
  appState: () => tauri.core.invoke('app_state'),
  setAppState: state => tauri.core.invoke('set_app_state', { state }),
  version: () => tauri.app.getVersion(),
  quit: () => tauri.window.getCurrentWindow().close(),
  async importStep() {
    const path = await tauri.dialog.open({ multiple: false, directory: false, filters: IMPORT });
    if (!path) return null;
    if (/\.dxf$/i.test(path)) return { dxf: await tauri.core.invoke('read_dxf', { path }), name: baseName(path) };
    if (/\.(png|jpe?g)$/i.test(path)) {
      const bytes = await tauri.core.invoke('read_image', { path });
      return { image: new Blob([bytes], { type: /\.png$/i.test(path) ? 'image/png' : 'image/jpeg' }), name: baseName(path) };
    }
    return tauri.core.invoke('import_step', { path });
  },
  async exportStep(id, { motion = null, mirror = null, name = `body-${id}` } = {}) {
    const path = await tauri.dialog.save({ defaultPath: `witness3d-${name}.step`, filters: STEP });
    if (!path) return null;
    await tauri.core.invoke('export_step', { id, path, motion, mirror });
    return `SAVED ${path}`;
  },
};

const root = document.getElementById('app');
if (!tauri) {
  root.innerHTML = '<p style="padding:24px;font-family:monospace">Run this page inside the Witness 3D app: npm run tauri dev</p>';
} else {
  const app = await mount(root, rust);
  window.__w3d = app;
}
