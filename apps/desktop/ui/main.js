// The desktop app's page: the shared Witness 3D UI (web/src/app) driving the Rust engine.
// Geometry lives in crates/w3d-kernel (OpenCascade); every call below crosses into Rust.
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/700.css';
import '@fontsource/space-grotesk/700.css';
import '../../../web/src/app/app.css';
import { mount } from '../../../web/src/app/App.js';

const tauri = window.__TAURI__;

const W3D = [{ name: 'Witness 3D', extensions: ['w3d'] }];
const STEP = [{ name: 'STEP', extensions: ['step', 'stp'] }];
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
  // Open with a profile already on the top face, pushed in, so the first frame shows a live cut.
  if (app.bodies[0]) { app.begin([6, 30, 2], [0, 1, 0], app.bodies[0].id); app.setDistance(-7.5); }
  window.__w3d = app;
}
