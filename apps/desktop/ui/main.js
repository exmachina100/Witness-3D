// The desktop app's page: the shared Witness 3D UI (web/src/app) driving the Rust engine.
// Geometry lives in crates/w3d-kernel (OpenCascade); every call below crosses into Rust.
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/700.css';
import '@fontsource/space-grotesk/700.css';
import '../../../web/src/app/app.css';
import { mount } from '../../../web/src/app/App.js';

const tauri = window.__TAURI__;

const rust = {
  info: { kernel: 'OPENCASCADE 7.8 · RUST' },
  scene: () => tauri.core.invoke('scene'),
  preview: req => tauri.core.invoke('preview_extrude', { req }),
  commit: req => tauri.core.invoke('commit_extrude', { req }),
  undo: () => tauri.core.invoke('undo'),
  redo: () => tauri.core.invoke('redo'),
  async exportStep(id) {
    const path = await tauri.dialog.save({ defaultPath: `witness3d-body-${id}.step`, filters: [{ name: 'STEP', extensions: ['step', 'stp'] }] });
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
  if (app.bodies[0]) { app.begin([0.6, 2, 0.2], [0, 1, 0], app.bodies[0].id); app.setDistance(-0.75); }
  window.__w3d = app;
}
