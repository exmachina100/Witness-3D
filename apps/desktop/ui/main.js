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
  // The desktop meshes at the chord tolerance; OpenCascade's mesher here takes no separate angle.
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
  replaceCurves: (ids, curves) => tauri.core.invoke('replace_curves', { req: { ids, curves } }),
  previewPrimitive: req => tauri.core.invoke('preview_primitive', { req }),
  commitPrimitive: req => tauri.core.invoke('commit_primitive', { req }),
  previewShell: req => tauri.core.invoke('preview_shell', { req }),
  commitShell: req => tauri.core.invoke('commit_shell', { req }),
  previewMirror: req => tauri.core.invoke('preview_mirror', { req }),
  commitMirror: req => tauri.core.invoke('commit_mirror', { req }),
  previewArray: req => tauri.core.invoke('preview_array', { req }),
  commitArray: req => tauri.core.invoke('commit_array', { req }),
  // The Anthropic key for AI commands lives in the app's config folder (or ANTHROPIC_API_KEY).
  aiKey: () => tauri.core.invoke('ai_key'),
  setAiKey: key => tauri.core.invoke('set_ai_key', { key }),
  // The Blender bridge: tell Live Link the model changed; both answer [connected, live].
  sceneChanged: () => tauri.core.invoke('bridge_changed'),
  bridgeStatus: () => tauri.core.invoke('bridge_status'),
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
  async open() {
    const path = await tauri.dialog.open({ multiple: false, directory: false, filters: W3D });
    if (!path) return null;
    const scene = await tauri.core.invoke('open', { path });
    filePath = path;
    return { name: baseName(path), scene };
  },
  async importStep() {
    const path = await tauri.dialog.open({ multiple: false, directory: false, filters: STEP });
    return path ? tauri.core.invoke('import_step', { path }) : null;
  },
  async exportStep(id) {
    const path = await tauri.dialog.save({ defaultPath: `witness3d-body-${id}.step`, filters: STEP });
    if (!path) return null;
    await tauri.core.invoke('export_step', { id, path });
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
