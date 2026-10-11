// The desktop viewport. Geometry lives in Rust (crates/w3d-kernel, OpenCascade); this file only
// draws what the model sends back and turns pointer input into requests.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ExtrudeGizmo } from '../../../web/src/ExtrudeGizmo.js';

const invoke = window.__TAURI__?.core.invoke;
const dialog = window.__TAURI__?.dialog;
const $ = id => document.getElementById(id);
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.hidden = true, 2600);
}
if (!invoke) {
  $('loading').textContent = 'Run this page inside the Witness 3D app (npm run tauri dev).';
  throw new Error('Tauri runtime not found');
}

// --- viewport -------------------------------------------------------------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
camera.position.set(8, 7, 9);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x404048, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(5, 10, 7);
scene.add(sun);
const grid = new THREE.GridHelper(20, 40);
scene.add(grid);
function applyTheme() {
  scene.background = new THREE.Color(css('--scene'));
  grid.material.color = new THREE.Color(css('--grid'));
  grid.material.vertexColors = false;
}
applyTheme();
matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);

// --- drawing what the model sends -----------------------------------------
const bodyMat = new THREE.MeshStandardMaterial({ color: 0xb8b4aa, roughness: 0.55, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
const edgeMat = new THREE.LineBasicMaterial({ color: 0x17160f });
const phantomMat = kind => new THREE.MeshBasicMaterial({
  color: css(kind === 'cut' ? '--cut' : '--add'), transparent: true, opacity: 0.35, depthWrite: false,
  polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
});

function meshOf(body, material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(body.positions, 3));
  g.setIndex(body.indices);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, material);
  const pts = [];
  for (const e of body.edges) for (let i = 3; i < e.length; i += 3) pts.push(e[i - 3], e[i - 2], e[i - 1], e[i], e[i + 1], e[i + 2]);
  const lines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), edgeMat);
  mesh.add(lines);
  mesh.userData = { id: body.id, faceIds: body.faceIds, facePlanes: body.facePlanes, volume: body.volume };
  return mesh;
}
function dispose(obj) { obj.traverse(o => o.geometry?.dispose()); obj.removeFromParent(); }

const bodies = new THREE.Group();
scene.add(bodies);
function showScene(list) {
  for (const m of [...bodies.children]) dispose(m);
  for (const b of list) bodies.add(meshOf(b, bodyMat));
  $('n-bodies').textContent = list.length;
  $('volume').textContent = list.reduce((v, b) => v + b.volume, 0).toFixed(3);
  $('export').disabled = list.length === 0;
}

// --- profile --------------------------------------------------------------
let tool = 'rect', size = 1;
const profile = () => tool === 'circle' ? { kind: 'circle', radius: size / 2 } : { kind: 'rect', width: size, height: size };
function frameFor(normal) {
  const ref = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  return new THREE.Vector3().crossVectors(ref, normal).normalize();
}
function outlinePoints() {
  if (tool === 'circle') return new THREE.Path().absarc(0, 0, size / 2, 0, Math.PI * 2).getPoints(48);
  const h = size / 2;
  return [[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, y]) => new THREE.Vector2(x, y));
}
const outline = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: css('--accent'), depthTest: false }));
outline.renderOrder = 11;
outline.visible = false;
scene.add(outline);
function placeOutline(origin, normal) {
  const x = frameFor(normal), y = new THREE.Vector3().crossVectors(normal, x);
  outline.geometry.setFromPoints(outlinePoints().map(p => origin.clone().addScaledVector(x, p.x).addScaledVector(y, p.y).addScaledVector(normal, 0.002)));
  outline.visible = true;
}

// --- picking: the model says which face a triangle came from and whether it is flat ---
const raycaster = new THREE.Raycaster();
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function pick(event) {
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((event.clientX - r.left) / r.width) * 2 - 1, -((event.clientY - r.top) / r.height) * 2 + 1), camera);
  const snap = v => event.ctrlKey || event.metaKey ? v.set(...v.toArray().map(c => Math.round(c * 4) / 4)) : v;
  const hit = raycaster.intersectObjects(bodies.children, false)[0];
  if (hit) {
    const { faceIds, facePlanes, id } = hit.object.userData;
    const plane = facePlanes[faceIds[hit.faceIndex]];
    if (!plane) return { curved: true };
    const normal = new THREE.Vector3(...plane.normal);
    // Keep the sketch exactly on the face's plane, wherever the ray landed.
    const origin = snap(hit.point.clone());
    origin.addScaledVector(normal, new THREE.Vector3(...plane.origin).sub(origin).dot(normal));
    return { origin, normal, target: id };
  }
  const p = raycaster.ray.intersectPlane(ground, new THREE.Vector3());
  if (p) return { origin: snap(p), normal: new THREE.Vector3(0, 1, 0), target: null };
}

// --- extrude command ------------------------------------------------------
// Every drag is sent. The engine runs only the newest of any that queue up and answers the rest
// with null, so the preview keeps up with the cursor however slow the boolean is.
let active, gizmo, sent = 0, computed = 0, skipped = 0, shown = 0;
const previewGroup = new THREE.Group();
scene.add(previewGroup);

function request() {
  const { origin, normal, target } = active;
  return {
    target, origin: origin.toArray(), normal: normal.toArray(), xAxis: frameFor(normal).toArray(),
    profile: profile(), distance: active.distance, newBody: $('newbody').checked,
  };
}

function setOutcome(outcome) {
  const kind = { join: 'union', cut: 'difference', new: 'new' }[outcome] ?? 'idle';
  $('op').dataset.op = kind;
  $('op').textContent = { union: 'Join', difference: 'Cut', new: 'New body', idle: 'Idle' }[kind];
}

function clearPreview() {
  for (const m of [...previewGroup.children]) dispose(m);
  for (const m of bodies.children) m.visible = true;
}

async function update() {
  const n = ++sent;
  $('n-req').textContent = sent;
  let p;
  try { p = await invoke('preview_extrude', { req: request() }); }
  catch (e) { toast(String(e)); return; }
  if (p === null) { $('n-skip').textContent = ++skipped; return; }
  $('n-calc').textContent = ++computed;
  if (!active || n < shown) return; // the command ended, or a newer answer is already on screen
  shown = n;
  clearPreview();
  if (p.result) {
    for (const m of bodies.children) if (m.userData.id === p.result.id) m.visible = false;
    previewGroup.add(meshOf(p.result, bodyMat));
  }
  if (p.tool) previewGroup.add(meshOf(p.tool, phantomMat(p.outcome === 'cut' ? 'cut' : 'add')));
  setOutcome(p.outcome);
}

function setDistance(d) {
  active.distance = d;
  gizmo.render(d);
  if (document.activeElement !== $('distance')) $('distance').value = d.toFixed(2);
  update();
}

function refreshPanel() {
  $('commit').disabled = $('cancel').disabled = $('distance').disabled = !active;
  if (!active) setOutcome(null);
}

function begin({ origin, normal, target }) {
  active = { origin, normal, target, distance: 0 };
  sent = computed = skipped = shown = 0;
  for (const k of ['n-req', 'n-calc', 'n-skip']) $(k).textContent = 0;
  gizmo = new ExtrudeGizmo(camera, canvas);
  gizmo.position.copy(origin);
  gizmo.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
  gizmo.onDragStart = () => controls.enabled = false;
  gizmo.onDragEnd = () => controls.enabled = true;
  gizmo.onChange = setDistance;
  scene.add(gizmo);
  placeOutline(origin, normal);
  refreshPanel();
}

function end() {
  gizmo?.dispose();
  gizmo?.removeFromParent();
  gizmo = active = undefined;
  outline.visible = false;
  clearPreview();
  $('distance').value = '0';
  refreshPanel();
}

async function commit() {
  if (!active) return;
  const req = request();
  end();
  if (req.distance === 0) return;
  try { showScene((await invoke('commit_extrude', { req })).scene); }
  catch (e) { toast(String(e)); }
}
function cancel() { if (active) end(); }

async function history(cmd) {
  cancel();
  showScene(await invoke(cmd));
}

async function exportStep() {
  const ids = bodies.children.map(m => m.userData.id);
  for (const id of ids) {
    const path = await dialog.save({ defaultPath: `witness3d-body-${id}.step`, filters: [{ name: 'STEP', extensions: ['step', 'stp'] }] });
    if (!path) return;
    try { await invoke('export_step', { id, path }); toast(`Saved ${path}`); }
    catch (e) { toast(String(e)); }
  }
}

// --- input ----------------------------------------------------------------
let downAt;
canvas.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', async e => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4 || gizmo?.dragging) return;
  const hit = pick(e);
  if (active) await commit();
  if (hit?.curved) toast('Pick a flat face to sketch on');
  else if (hit) begin(hit);
});
canvas.addEventListener('pointermove', e => {
  if (active || e.buttons) return;
  const hit = pick(e);
  if (hit && !hit.curved) placeOutline(hit.origin, hit.normal); else outline.visible = false;
});

function setTool(t) {
  tool = t;
  $('tool-rect').setAttribute('aria-pressed', t === 'rect');
  $('tool-circle').setAttribute('aria-pressed', t === 'circle');
  if (active) { placeOutline(active.origin, active.normal); if (active.distance) update(); }
}
$('tool-rect').onclick = () => setTool('rect');
$('tool-circle').onclick = () => setTool('circle');
$('size').oninput = e => {
  size = +e.target.value; $('size-val').textContent = size.toFixed(2);
  if (active) { placeOutline(active.origin, active.normal); if (active.distance) update(); }
};
$('newbody').onchange = () => { if (active?.distance) update(); };
$('distance').addEventListener('input', e => { const v = parseFloat(e.target.value); if (active && !isNaN(v)) setDistance(v); });
$('commit').onclick = commit;
$('cancel').onclick = cancel;
$('undo').onclick = () => history('undo');
$('redo').onclick = () => history('redo');
$('export').onclick = exportStep;

addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' && e.key !== 'Enter' && e.key !== 'Escape') return;
  if (e.key === 'Enter') { e.preventDefault(); commit(); }
  else if (e.key === 'Escape') cancel();
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); history(e.shiftKey ? 'redo' : 'undo'); }
  else if (e.key === 'r') setTool('rect');
  else if (e.key === 'c') setTool('circle');
});

// --- start ----------------------------------------------------------------
showScene(await invoke('scene'));
$('loading').hidden = true;
// Open with a profile already on the top face, pushed in, so the first frame shows a live cut.
const top = bodies.children[0];
if (top) { begin({ origin: new THREE.Vector3(0.6, 2, 0.2), normal: new THREE.Vector3(0, 1, 0), target: top.userData.id }); setDistance(-0.75); }

function resize() {
  const { clientWidth: w, clientHeight: h } = canvas;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}
renderer.setAnimationLoop(() => {
  resize();
  controls.update();
  if (gizmo) { gizmo.scale.setScalar(camera.position.distanceTo(gizmo.position) / 9); gizmo.render(gizmo.value); }
  renderer.render(scene, camera);
});
window.__w3d = { get active() { return active }, setDistance, commit, history };
