// The Witness 3D app shell: one UI shared by the web page and the desktop app. It draws what a
// backend sends and turns input into requests; all geometry lives behind the backend, which is
// OpenCascade compiled to WebAssembly on the web (LocalBackend.js) and the Rust engine on the
// desktop (apps/desktop/ui/main.js).
//
// A backend implements:
//   info                         { kernel: string }
//   scene()                      -> Body[]
//   preview(req)                 -> Preview, or null when a newer request made this one stale
//   commit(req)                  -> { id, scene: Body[] }
//   undo(), redo()               -> Body[]
//   exportStep(id)               -> string to show, or null if the user backed out
// Body:    { id, positions, indices, faceIds, facePlanes: ({ origin, normal } | null)[], edges: number[][], volume }
// Preview: { outcome: 'join' | 'cut' | 'new' | 'none', tool: Body | null, result: Body | null }
// Request: { target, origin, normal, xAxis, profile: { kind: 'rect', width, height } | { kind: 'circle', radius }, distance, newBody }

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ExtrudeGizmo } from '../ExtrudeGizmo.js';

const SHELL = `
<div class="w3d">
  <header class="bar">
    <div class="brand">WITNESS 3D</div>
    <nav class="tools" aria-label="Tools">
      <button class="tool" aria-pressed="true"><kbd>—</kbd>PUSH·PULL</button>
      <button class="tool" disabled title="Not built yet"><kbd>E</kbd>EXTRUDE</button>
      <button class="tool" disabled title="Not built yet"><kbd>Q</kbd>BOOLEAN</button>
      <button class="tool" disabled title="Not built yet"><kbd>O</kbd>OFFSET FACE</button>
      <button class="tool" disabled title="Not built yet"><kbd>B</kbd>FILLET</button>
    </nav>
    <span class="spacer"></span>
    <button class="export" data-id="export" disabled>⇪ EXPORT STEP</button>
    <span class="file">UNTITLED.W3D</span>
  </header>

  <aside class="left" aria-label="Document">
    <div class="tabs" role="tablist">
      <button role="tab" data-id="tab-outliner" aria-selected="true">OUTLINER</button>
      <button role="tab" data-id="tab-history" aria-selected="false">HISTORY <span data-id="history-count">00</span></button>
    </div>
    <div class="list" data-id="outliner"></div>
    <div class="list" data-id="history" hidden></div>
    <dl class="stats">
      <dt>VOLUME</dt><dd data-id="volume">—</dd>
      <dt>FACES</dt><dd data-id="faces">—</dd>
    </dl>
    <div class="pair">
      <button data-id="undo">⌘Z UNDO</button>
      <button data-id="redo">⇧⌘Z REDO</button>
    </div>
  </aside>

  <main class="view">
    <canvas aria-label="3D modeling viewport"></canvas>
    <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
    <span class="hud" data-id="hud" data-idle>CLICK A FLAT FACE</span>
    <div class="views" role="group" aria-label="View">
      <button data-view="top">TOP</button><button data-view="front">FRONT</button><button data-view="right">RIGHT</button><button data-view="iso" aria-pressed="true">ISO</button>
    </div>
    <div class="modes" role="group" aria-label="Selection mode">
      <button disabled title="Not built yet">1 PT</button><button disabled title="Not built yet">2 EDGE</button><button aria-pressed="true">3 FACE</button><button disabled title="Not built yet">4 SOLID</button>
    </div>
    <div class="keys">
      <kbd>DRAG</kbd><span>SET Δ</span>
      <kbd>Q</kbd><span>JOIN</span>
      <kbd>W</kbd><span>CUT</span>
      <kbd>B</kbd><span>NEW BODY</span>
      <kbd>⏎</kbd><span>OK</span>
    </div>
    <div class="toast" data-id="toast" hidden></div>
    <div class="loading" data-id="loading">STARTING THE KERNEL…</div>
  </main>

  <aside class="right" aria-label="Inspector">
    <header><span>PUSH·PULL</span><span data-id="target">—</span></header>
    <div class="sec">
      <div class="field"><label for="w3d-distance">Δ DISTANCE</label><input id="w3d-distance" data-id="distance" type="number" step="0.25" value="0" disabled></div>
      <div class="field"><label for="w3d-size">SIZE</label><input id="w3d-size" data-id="size" type="number" step="0.25" min="0.05" value="1"></div>
    </div>
    <div class="sec">
      <span class="label">PROFILE</span>
      <div class="seg" role="group" aria-label="Profile">
        <button data-profile="rect" aria-pressed="true"><kbd>R</kbd>RECT</button>
        <button data-profile="circle" aria-pressed="false"><kbd>C</kbd>CIRCLE</button>
      </div>
    </div>
    <div class="sec">
      <span class="label">OPERATION</span>
      <div class="seg" role="group" aria-label="Operation">
        <button data-op="join" aria-pressed="false"><kbd>Q</kbd>JOIN</button>
        <button data-op="cut" aria-pressed="false"><kbd>W</kbd>CUT</button>
        <button data-op="new" aria-pressed="false"><kbd>B</kbd>NEW</button>
      </div>
    </div>
    <div class="sec">
      <span class="label">VIEW</span>
      <div class="chips">
        <button data-toggle="edges" aria-pressed="true">EDGES</button>
        <button data-toggle="faces" aria-pressed="true">FACES</button>
        <button data-toggle="xray" aria-pressed="false">X-RAY</button>
        <button data-toggle="snap" aria-pressed="false" title="Snap the drag to the grid step (or hold Ctrl)">GRID SNAP</button>
      </div>
      <div class="stepper"><span>GRID</span><button data-id="grid-dec" aria-label="Smaller grid step">−</button><output data-id="grid">0.25</output><button data-id="grid-inc" aria-label="Larger grid step">+</button></div>
    </div>
    <div class="states">
      <span class="label">STATE</span>
      <ol data-id="states">
        <li data-s="none">NONE</li><li data-s="updating">UPDATING</li><li data-s="updated">UPDATED</li>
        <li data-s="committed">COMMITTED</li><li data-s="failed">FAILED</li><li data-s="cancelled">CANCELLED</li>
      </ol>
    </div>
    <span class="fill"></span>
    <div class="pair">
      <button data-id="cancel" disabled>ESC CANCEL</button>
      <button data-id="commit" disabled>⏎ OK</button>
    </div>
  </aside>

  <footer class="status">
    <span>SYS.1 / PUSH·PULL / <span data-id="status-target">VOID</span></span>
    <span data-id="kernel"></span>
    <span>PREVIEW <output data-id="ms">—</output> MS · COALESCED <output data-id="coalesced">0→0</output></span>
    <span class="spacer"></span>
    <output data-id="cursor">X 0.00 Y 0.00 Z 0.00</output>
  </footer>
</div>`;

const COLORS = { ground: 0x0f0f11, ink: 0xefebe0, accent: 0xff4d00, face: 0x1c1c20, grid: 0x19191c, gridMajor: 0x232327 };
const GRID_STEPS = [0.05, 0.1, 0.25, 0.5, 1];
const label = id => `B-${String(id).padStart(2, '0')}`;
const fmt = n => (n < 0 ? '−' : '+') + Math.abs(n).toFixed(2);

export async function mount(root, backend) {
  root.innerHTML = SHELL;
  const $ = id => root.querySelector(`[data-id="${id}"]`);
  const $$ = sel => [...root.querySelectorAll(sel)];

  const toast = msg => {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => t.hidden = true, 2600);
  };
  $('kernel').textContent = `KERNEL: ${backend.info.kernel}`;

  // --- viewport -----------------------------------------------------------
  const canvas = root.querySelector('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.ground);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 400);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x202024, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(5, 10, 7);
  scene.add(key);
  const grid = new THREE.GridHelper(40, 40, COLORS.gridMajor, COLORS.grid);
  scene.add(grid);

  const VIEWS = { top: [0, 14, 0.001], front: [0, 1, 14], right: [14, 1, 0], iso: [9.5, 8, 10.5] };
  function setView(name) {
    camera.position.set(...VIEWS[name]);
    controls.target.set(0, 1, 0);
    for (const b of $$('[data-view]')) b.setAttribute('aria-pressed', b.dataset.view === name);
  }
  setView('iso');
  for (const b of $$('[data-view]')) b.onclick = () => setView(b.dataset.view);

  // --- drawing what the backend sends ---------------------------------------
  const view = { edges: true, faces: true, xray: false, snap: false };
  const faceMat = new THREE.MeshStandardMaterial({ color: COLORS.face, roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const edgeMat = new THREE.LineBasicMaterial({ color: COLORS.ink, transparent: true, opacity: 0.8 });
  const selEdgeMat = new THREE.LineBasicMaterial({ color: COLORS.accent });
  const phantom = {
    add: { face: new THREE.MeshBasicMaterial({ color: COLORS.ink, transparent: true, opacity: 0.1, depthWrite: false }), edge: new THREE.LineBasicMaterial({ color: COLORS.ink }) },
    cut: { face: new THREE.MeshBasicMaterial({ color: COLORS.accent, transparent: true, opacity: 0.16, depthWrite: false }), edge: new THREE.LineBasicMaterial({ color: COLORS.accent }) },
  };
  function applyView() {
    faceMat.transparent = view.xray;
    faceMat.opacity = view.xray ? 0.25 : 1;
    faceMat.depthWrite = !view.xray;
    faceMat.colorWrite = view.faces;
    faceMat.needsUpdate = true;
    scene.traverse(o => { if (o.isLineSegments && o.userData.bodyEdges) o.visible = view.edges; });
  }

  function meshOf(body, faces = faceMat, edges = edgeMat) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(body.positions, 3));
    g.setIndex(body.indices);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, faces);
    const pts = [];
    for (const e of body.edges) for (let i = 3; i < e.length; i += 3) pts.push(e[i - 3], e[i - 2], e[i - 1], e[i], e[i + 1], e[i + 2]);
    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), edges);
    lines.userData.bodyEdges = edges === edgeMat || edges === selEdgeMat;
    lines.visible = !lines.userData.bodyEdges || view.edges;
    mesh.add(lines);
    mesh.userData = { id: body.id, faceIds: body.faceIds, facePlanes: body.facePlanes, volume: body.volume };
    return mesh;
  }
  const dispose = obj => { obj.traverse(o => o.geometry?.dispose()); obj.removeFromParent(); };

  const bodies = new THREE.Group();
  scene.add(bodies);
  let current = [], selected = null;
  const hidden = new Set();

  function showScene(list) {
    current = list;
    for (const m of [...bodies.children]) dispose(m);
    for (const b of list) {
      const m = meshOf(b, faceMat, b.id === selected ? selEdgeMat : edgeMat);
      m.visible = !hidden.has(b.id);
      bodies.add(m);
    }
    $('volume').textContent = list.reduce((v, b) => v + b.volume, 0).toFixed(3);
    $('faces').textContent = list.reduce((n, b) => n + b.facePlanes.length, 0);
    $('export').disabled = list.length === 0;
    renderOutliner();
  }

  // --- outliner and history -----------------------------------------------
  const history = [];   // committed steps, oldest first; `undone` counts how many from the end were undone
  let undone = 0;
  function renderOutliner() {
    const out = $('outliner');
    out.innerHTML = '<div class="group-title">▾ SOLIDS</div>';
    if (!current.length) out.insertAdjacentHTML('beforeend', '<div class="empty">NO SOLIDS</div>');
    for (const b of current) {
      const row = document.createElement('div');
      row.className = 'row-item';
      row.setAttribute('aria-current', b.id === selected);
      row.innerHTML = `<span class="sq"></span><span class="name">BODY ${b.id}</span><span class="tag">${label(b.id)}</span><button class="eye" aria-pressed="${!hidden.has(b.id)}" aria-label="Show or hide">◉</button>`;
      row.onclick = e => {
        if (e.target.classList.contains('eye')) {
          hidden.has(b.id) ? hidden.delete(b.id) : hidden.add(b.id);
        } else selected = selected === b.id ? null : b.id;
        showScene(current);
      };
      out.append(row);
    }
    out.insertAdjacentHTML('beforeend', '<div class="group-title">▾ CURVES</div>');
    out.insertAdjacentHTML('beforeend', active
      ? `<div class="row-item curve"><span class="ln"></span><span>${profile.kind === 'circle' ? 'CIRCLE' : 'RECT'}.001</span></div>`
      : '<div class="empty">NO CURVES</div>');
  }
  function renderHistory() {
    const live = history.length - undone;
    $('history-count').textContent = String(live).padStart(2, '0');
    $('history').innerHTML = history.length ? '' : '<div class="empty">NOTHING YET</div>';
    history.forEach((h, i) => {
      const row = document.createElement('div');
      row.className = 'row-item hist' + (i >= live ? ' undone' : '');
      row.innerHTML = `<span class="n">${String(i + 1).padStart(2, '0')}</span><span class="name">${h.text}</span><span class="tag">${label(h.id)}</span>`;
      $('history').append(row);
    });
    $('undo').disabled = live === 0;
    $('redo').disabled = undone === 0;
  }
  function tab(name) {
    $('tab-outliner').setAttribute('aria-selected', name === 'outliner');
    $('tab-history').setAttribute('aria-selected', name === 'history');
    $('outliner').hidden = name !== 'outliner';
    $('history').hidden = name !== 'history';
  }
  $('tab-outliner').onclick = () => tab('outliner');
  $('tab-history').onclick = () => tab('history');

  // --- sketch profile -----------------------------------------------------
  let profileKind = 'rect', size = 1;
  let profile = { kind: 'rect', width: 1, height: 1 };
  const makeProfile = () => profile = profileKind === 'circle' ? { kind: 'circle', radius: size / 2 } : { kind: 'rect', width: size, height: size };
  function frameFor(normal) {
    const ref = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    return new THREE.Vector3().crossVectors(ref, normal).normalize();
  }
  function outlinePoints() {
    if (profileKind === 'circle') return new THREE.Path().absarc(0, 0, size / 2, 0, Math.PI * 2).getPoints(64);
    const h = size / 2;
    return [[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, y]) => new THREE.Vector2(x, y));
  }
  const outline = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: COLORS.accent, depthTest: false }));
  outline.renderOrder = 11;
  outline.visible = false;
  scene.add(outline);
  function placeOutline(origin, normal) {
    const x = frameFor(normal), y = new THREE.Vector3().crossVectors(normal, x);
    outline.geometry.setFromPoints(outlinePoints().map(p => origin.clone().addScaledVector(x, p.x).addScaledVector(y, p.y).addScaledVector(normal, 0.002)));
    outline.visible = true;
  }

  // --- picking ------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const gridStep = () => +$('grid').value;
  const snapValue = (v, e) => (view.snap || e?.ctrlKey || e?.metaKey) ? Math.round(v / gridStep()) * gridStep() : v;
  function ray(event) {
    const r = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((event.clientX - r.left) / r.width) * 2 - 1, -((event.clientY - r.top) / r.height) * 2 + 1), camera);
  }
  function pick(event) {
    ray(event);
    const snapV = v => v.set(...v.toArray().map(c => snapValue(c, event)));
    const hit = raycaster.intersectObjects(bodies.children.filter(m => m.visible), false)[0];
    if (hit) {
      const { faceIds, facePlanes, id } = hit.object.userData;
      const plane = facePlanes[faceIds[hit.faceIndex]];
      if (!plane) return { curved: true };
      const normal = new THREE.Vector3(...plane.normal);
      const origin = snapV(hit.point.clone());
      // Keep the sketch exactly on the face's plane, wherever the ray landed.
      origin.addScaledVector(normal, new THREE.Vector3(...plane.origin).sub(origin).dot(normal));
      return { origin, normal, target: id };
    }
    const p = raycaster.ray.intersectPlane(ground, new THREE.Vector3());
    if (p) return { origin: snapV(p), normal: new THREE.Vector3(0, 1, 0), target: null };
  }

  // --- the push/pull command ----------------------------------------------
  // Every drag goes to the backend. Both backends compute only the newest of the requests that
  // queue up and answer the rest with null, so the preview keeps pace with the cursor.
  let active, gizmo, sent = 0, computed = 0, shown = 0, newBody = false;
  const previewGroup = new THREE.Group();
  scene.add(previewGroup);

  function setState(s) {
    for (const li of $('states').children) li.setAttribute('aria-current', li.dataset.s === s);
  }
  function setHud(text) {
    const h = $('hud');
    if (text) { h.textContent = text; delete h.dataset.idle; }
    else { h.textContent = 'CLICK A FLAT FACE'; h.dataset.idle = ''; }
  }
  function setOp(outcome) {
    for (const b of $$('[data-op]')) b.setAttribute('aria-pressed', !!active && b.dataset.op === outcome);
  }

  function request() {
    const { origin, normal, target, distance } = active;
    return { target, origin: origin.toArray(), normal: normal.toArray(), xAxis: frameFor(normal).toArray(), profile, distance, newBody };
  }

  function clearPreview() {
    for (const m of [...previewGroup.children]) dispose(m);
    for (const m of bodies.children) m.visible = !hidden.has(m.userData.id);
  }

  async function update() {
    const n = ++sent;
    setState('updating');
    const t0 = performance.now();
    let p;
    try { p = await backend.preview(request()); }
    catch (e) { if (active) setState('failed'); toast(String(e.message ?? e)); return; }
    $('coalesced').textContent = `${sent}→${computed + (p ? 1 : 0)}`;
    if (!p) return;
    computed++;
    $('ms').textContent = Math.round(performance.now() - t0);
    if (!active || n < shown) return; // the command ended, or a newer answer is already on screen
    shown = n;
    clearPreview();
    if (p.result) {
      for (const m of bodies.children) if (m.userData.id === p.result.id) m.visible = false;
      previewGroup.add(meshOf(p.result, faceMat, edgeMat));
    }
    if (p.tool) {
      const look = phantom[p.outcome === 'cut' ? 'cut' : 'add'];
      const m = meshOf(p.tool, look.face, look.edge);
      m.renderOrder = 5;
      previewGroup.add(m);
    }
    setOp(p.outcome);
    setHud(p.outcome === 'none' ? `${fmt(active.distance)}` : `${fmt(active.distance)} ${p.outcome.toUpperCase()}`);
    if (n === sent) setState('updated');
  }

  function setDistance(d) {
    active.distance = d;
    gizmo.render(d);
    if (document.activeElement !== $('distance')) $('distance').value = d.toFixed(2);
    update();
  }

  function refreshPanel() {
    $('commit').disabled = $('cancel').disabled = $('distance').disabled = !active;
    $('distance').classList.toggle('hot', !!active);
    const t = active ? (active.target ? label(active.target) : 'GROUND') : '—';
    $('target').textContent = t;
    $('status-target').textContent = active ? t : 'VOID';
    if (!active) { setOp(null); setHud(null); }
    renderOutliner();
  }

  function begin({ origin, normal, target }) {
    active = { origin, normal, target, distance: 0 };
    sent = computed = shown = 0;
    $('coalesced').textContent = '0→0';
    gizmo = new ExtrudeGizmo(camera, canvas, { step: gridStep() });
    gizmo.position.copy(origin);
    gizmo.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    gizmo.onDragStart = () => controls.enabled = false;
    gizmo.onDragEnd = () => controls.enabled = true;
    gizmo.onChange = d => setDistance(view.snap ? snapValue(d) : d);
    scene.add(gizmo);
    placeOutline(origin, normal);
    setState('none');
    setHud('+0.00');
    refreshPanel();
  }

  function end(state) {
    gizmo?.dispose();
    gizmo?.removeFromParent();
    gizmo = active = undefined;
    outline.visible = false;
    clearPreview();
    $('distance').value = '0';
    setState(state);
    refreshPanel();
  }

  async function commit() {
    if (!active) return;
    const req = request();
    if (req.distance === 0) return end('cancelled');
    const text = `${fmt(req.distance)} ${newBody ? 'NEW' : req.distance > 0 ? 'JOIN' : 'CUT'}`;
    end('committed');
    try {
      const { id, scene: list } = await backend.commit(req);
      history.splice(history.length - undone, undone, { text, id });
      undone = 0;
      renderHistory();
      showScene(list);
    } catch (e) { setState('failed'); toast(String(e.message ?? e)); }
  }
  const cancel = () => { if (active) end('cancelled'); };

  async function step(dir) {
    cancel();
    if (dir === 'undo' && undone >= history.length) return;
    if (dir === 'redo' && undone === 0) return;
    showScene(await backend[dir]());
    undone += dir === 'undo' ? 1 : -1;
    renderHistory();
  }

  function setOperation(op) {
    if (!active) return;
    if (op === 'new') { newBody = !newBody; }
    else {
      newBody = false;
      const d = Math.abs(active.distance) || gridStep();
      return setDistance(op === 'join' ? d : -d);
    }
    if (active.distance) update();
  }

  // --- input --------------------------------------------------------------
  let downAt;
  canvas.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', async e => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4 || gizmo?.dragging) return;
    const hit = pick(e);
    if (active) await commit();
    if (hit?.curved) toast('PICK A FLAT FACE TO SKETCH ON');
    else if (hit) begin(hit);
  });
  canvas.addEventListener('pointermove', e => {
    ray(e);
    const p = raycaster.ray.intersectPlane(ground, new THREE.Vector3());
    if (p) $('cursor').textContent = `X ${p.x.toFixed(2)} Y ${(-p.z).toFixed(2)} Z ${p.y.toFixed(2)}`;
    if (active || e.buttons) return;
    const hit = pick(e);
    if (hit && !hit.curved) placeOutline(hit.origin, hit.normal); else outline.visible = false;
  });

  function setProfile(kind) {
    profileKind = kind;
    makeProfile();
    for (const b of $$('[data-profile]')) b.setAttribute('aria-pressed', b.dataset.profile === kind);
    if (active) { placeOutline(active.origin, active.normal); renderOutliner(); if (active.distance) update(); }
  }
  for (const b of $$('[data-profile]')) b.onclick = () => setProfile(b.dataset.profile);
  for (const b of $$('[data-op]')) b.onclick = () => setOperation(b.dataset.op);
  for (const b of $$('[data-toggle]')) b.onclick = () => {
    const k = b.dataset.toggle;
    view[k] = !view[k];
    b.setAttribute('aria-pressed', view[k]);
    applyView();
  };
  function setGrid(dir) {
    const i = Math.max(0, Math.min(GRID_STEPS.length - 1, GRID_STEPS.indexOf(gridStep()) + dir));
    $('grid').value = GRID_STEPS[i];
    $('distance').step = GRID_STEPS[i];
    if (gizmo) gizmo.step = GRID_STEPS[i];
  }
  $('grid-dec').onclick = () => setGrid(-1);
  $('grid-inc').onclick = () => setGrid(1);
  $('size').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (!(v > 0)) return;
    size = v; makeProfile();
    if (active) { placeOutline(active.origin, active.normal); if (active.distance) update(); }
  });
  $('distance').addEventListener('input', e => { const v = parseFloat(e.target.value); if (active && !isNaN(v)) setDistance(v); });
  $('commit').onclick = commit;
  $('cancel').onclick = cancel;
  $('undo').onclick = () => step('undo');
  $('redo').onclick = () => step('redo');
  $('export').onclick = async () => {
    const ids = selected !== null ? [selected] : current.map(b => b.id);
    for (const id of ids) {
      try { const msg = await backend.exportStep(id); if (!msg) return; toast(msg); }
      catch (e) { toast(String(e.message ?? e)); }
    }
  };

  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' && e.key !== 'Enter' && e.key !== 'Escape') return;
    const k = e.key.toLowerCase();
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') cancel();
    else if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); step(e.shiftKey ? 'redo' : 'undo'); }
    else if (e.ctrlKey || e.metaKey || e.altKey) return;
    else if (k === 'q') setOperation('join');
    else if (k === 'w') setOperation('cut');
    else if (k === 'b') setOperation('new');
    else if (k === 'r') setProfile('rect');
    else if (k === 'c') setProfile('circle');
  });

  // --- start --------------------------------------------------------------
  renderHistory();
  showScene(await backend.scene());
  $('loading').hidden = true;

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

  return {
    begin: (origin, normal, target) => begin({ origin: new THREE.Vector3(...origin), normal: new THREE.Vector3(...normal), target }),
    setDistance: d => active && setDistance(d),
    commit, cancel, step,
    get active() { return active },
    get bodies() { return current },
  };
}
