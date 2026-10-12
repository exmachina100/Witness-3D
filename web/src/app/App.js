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
//   previewBlend(req)            -> Body (the body as it would be), or null when stale; a failure
//                                   throws an error whose `edges` lists the edges the kernel blamed
//   commitBlend(req)             -> { id, scene: Body[] }
//   commitMotion(req)            -> { id, scene: Body[] }; the viewport previews a rigid motion itself
//   undo(), redo()               -> Body[]
//   exportStep(id)               -> string to show, or null if the user backed out
// Optional, shown only when present (the desktop has them, the web page does not yet):
//   newDocument()                -> Body[]
//   save()                       -> file name, or null if the user backed out
//   open()                       -> { name, scene: Body[] }, or null
//   importStep()                 -> { id, scene: Body[] }, or null
// Body:    { id, positions, indices, faceIds, facePlanes: ({ origin, normal } | null)[], edges: number[][], volume,
//            faceRefs: number[], edgeRefs: number[], revision }
//          `edges` holds one polyline (x, y, z, x, y, z, ...) per B-rep edge; its index is the edge's
//          number, the same on both backends, and is what a BlendRequest names. Numbers change when
//          an edit rebuilds a body; refs (`faceRefs[n]`, `edgeRefs[n]`) follow a face or edge
//          through edits, so the selection is kept as refs. `revision` changes with every edit.
// BlendRequest: { body, edges: number[], size, kind: 'fillet' | 'chamfer' }
// MotionRequest: { body, offset, pivot, axis, angle }: turn by `angle` radians about `axis` through
//          `pivot`, then move by `offset`, in the viewport's coordinates (y up)
// Units are millimetres throughout.
// Preview: { outcome: 'join' | 'cut' | 'new' | 'none', tool: Body | null, result: Body | null }
// Request: { target, origin, normal, xAxis, profile: { kind: 'rect', width, height } | { kind: 'circle', radius }, distance, newBody }

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { ExtrudeGizmo } from '../ExtrudeGizmo.js';
import { TOOLS, check, tool as toolInfo, toolForKey, withDefaults } from './tools.js';

const SHELL = `
<div class="w3d">
  <header class="bar">
    <div class="brand">WITNESS 3D</div>
    <nav class="tools" aria-label="Tools">
      ${TOOLS.map(t => `<button class="tool" data-tool="${t.id}" aria-pressed="${t.id === 'pushpull'}" title="${t.summary}"><kbd>${t.key.toUpperCase()}</kbd>${t.label}</button>`).join('\n      ')}
    </nav>
    <span class="spacer"></span>
    <button class="export" data-id="file-new" hidden>NEW</button>
    <button class="export" data-id="file-open" hidden>OPEN</button>
    <button class="export" data-id="file-save" hidden>SAVE</button>
    <button class="export" data-id="import" hidden title="Import a STEP file">⇩ STEP</button>
    <button class="export" data-id="export" disabled title="Export STEP">⇪ STEP</button>
    <span class="file" data-id="file-name">UNTITLED.W3D</span>
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
      <button disabled title="Not built yet">1 PT</button><button data-mode="edge" aria-pressed="false">2 EDGE</button><button data-mode="face" aria-pressed="true">3 FACE</button><button data-mode="solid" aria-pressed="false">4 SOLID</button>
    </div>
    <div class="keys" data-keys="pushpull">
      <kbd>DRAG</kbd><span>SET Δ</span>
      <kbd>Q</kbd><span>JOIN</span>
      <kbd>W</kbd><span>CUT</span>
      <kbd>B</kbd><span>NEW BODY</span>
      <kbd>⏎</kbd><span>OK</span>
    </div>
    <div class="keys" data-keys="fillet" hidden>
      <kbd>CLICK</kbd><span>PICK EDGE</span>
      <kbd>⇧ CLICK</kbd><span>ADD / REMOVE</span>
      <kbd>DRAG</kbd><span>SET RADIUS</span>
      <kbd>⏎</kbd><span>OK</span>
    </div>
    <div class="keys" data-keys="move" hidden>
      <kbd>DRAG</kbd><span>MOVE</span>
      <kbd>CTRL</kbd><span>GRID</span>
      <kbd>⏎</kbd><span>OK</span>
    </div>
    <div class="keys" data-keys="rotate" hidden>
      <kbd>DRAG</kbd><span>TURN</span>
      <kbd>X Y Z</kbd><span>AXIS</span>
      <kbd>⏎</kbd><span>OK</span>
    </div>
    <span class="snap-tag" data-id="snap-tag" hidden></span>
    <div class="toast" data-id="toast" hidden></div>
    <div class="loading" data-id="loading">STARTING THE KERNEL…</div>
  </main>

  <aside class="right" aria-label="Inspector">
    <header><span data-id="tool-name">PUSH·PULL</span><span data-id="target">—</span></header>
    <div class="sec" data-panel="fillet" hidden>
      <span class="hint" data-id="blend-hint">SELECT EDGES TO ROUND</span>
      <div class="field"><label for="w3d-blend-size" data-id="blend-size-label">RADIUS</label><input id="w3d-blend-size" data-id="blend-size" type="number" step="0.5" min="0.05" value="2"></div>
      <div class="field"><label>EDGES</label><output data-id="blend-count">0</output></div>
      <span class="label">TYPE</span>
      <div class="seg" role="group" aria-label="Blend type">
        <button data-blend="fillet" aria-pressed="true">ROUND</button>
        <button data-blend="chamfer" aria-pressed="false">CHAMFER</button>
      </div>
    </div>
    <div class="sec" data-panel="move" hidden>
      <span class="hint">DRAG AN ARROW OR TYPE A DISTANCE</span>
      <div class="field"><label for="w3d-dx">ΔX</label><input id="w3d-dx" data-move="0" type="number" step="2.5" value="0"></div>
      <div class="field"><label for="w3d-dy">ΔY</label><input id="w3d-dy" data-move="1" type="number" step="2.5" value="0"></div>
      <div class="field"><label for="w3d-dz">ΔZ</label><input id="w3d-dz" data-move="2" type="number" step="2.5" value="0"></div>
    </div>
    <div class="sec" data-panel="rotate" hidden>
      <span class="hint">DRAG THE RING OR TYPE AN ANGLE</span>
      <span class="label">AXIS</span>
      <div class="seg" role="group" aria-label="Axis">
        <button data-axis="x" aria-pressed="false">X</button>
        <button data-axis="y" aria-pressed="false">Y</button>
        <button data-axis="z" aria-pressed="true">Z</button>
      </div>
      <div class="field"><label for="w3d-angle">ANGLE °</label><input id="w3d-angle" data-id="angle" type="number" step="15" value="0"></div>
    </div>
    <div class="sec" data-panel="pushpull">
      <div class="field"><label for="w3d-distance">Δ DISTANCE</label><input id="w3d-distance" data-id="distance" type="number" step="2.5" value="0" disabled></div>
      <div class="field"><label for="w3d-size">SIZE</label><input id="w3d-size" data-id="size" type="number" step="2.5" min="0.5" value="10"></div>
    </div>
    <div class="sec" data-panel="pushpull">
      <span class="label">PROFILE</span>
      <div class="seg" role="group" aria-label="Profile">
        <button data-profile="rect" aria-pressed="true"><kbd>R</kbd>RECT</button>
        <button data-profile="circle" aria-pressed="false"><kbd>C</kbd>CIRCLE</button>
      </div>
    </div>
    <div class="sec" data-panel="pushpull">
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
      <div class="stepper"><span>GRID</span><button data-id="grid-dec" aria-label="Smaller grid step">−</button><output data-id="grid">2.5</output><button data-id="grid-inc" aria-label="Larger grid step">+</button></div>
    </div>
    <div class="sec">
      <span class="label">WORK PLANE <output data-id="plane">GROUND</output></span>
      <div class="seg" role="group" aria-label="Work plane">
        <button data-id="plane-face" title="Sketch on the plane of a face you pick, even off the body"><kbd>K</kbd>FROM FACE</button>
        <button data-id="plane-ground" title="Sketch on the ground again">GROUND</button>
      </div>
      <div class="field"><label for="w3d-plane-offset">OFFSET</label><input id="w3d-plane-offset" data-id="plane-offset" type="number" step="2.5" value="0"></div>
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
    <span>SYS.1 / <span data-id="status-tool">PUSH·PULL</span> / <span data-id="status-target">VOID</span></span>
    <span data-id="kernel"></span>
    <span>UNITS MM</span>
    <span>PLANE <span data-id="status-plane">GROUND</span></span>
    <span>PREVIEW <output data-id="ms">—</output> MS · COALESCED <output data-id="coalesced">0→0</output></span>
    <span class="spacer"></span>
    <output data-id="cursor">X 0.00 Y 0.00 Z 0.00</output>
  </footer>
</div>`;

const COLORS = { ground: 0x0f0f11, ink: 0xefebe0, accent: 0xff4d00, face: 0x1c1c20, grid: 0x19191c, gridMajor: 0x232327 };
const DANGER = 0xef4444;
// Millimetres. The grid steps are what Ctrl-drag snaps to.
const GRID_STEPS = [0.5, 1, 2.5, 5, 10];
const label = id => `B-${String(id).padStart(2, '0')}`;
const mm = n => `${n.toFixed(2)} MM`;
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
  const camera = new THREE.PerspectiveCamera(36, 1, 1, 4000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x202024, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(5, 10, 7);
  scene.add(key);
  const grid = new THREE.GridHelper(400, 40, COLORS.gridMajor, COLORS.grid);
  scene.add(grid);

  const VIEWS = { top: [0, 190, 0.01], front: [0, 15, 190], right: [190, 15, 0], iso: [125, 105, 140] };
  function setView(name) {
    camera.position.set(...VIEWS[name]);
    controls.target.set(0, 15, 0);
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
    const pts = [], segEdge = [];
    body.edges.forEach((e, n) => {
      for (let i = 3; i < e.length; i += 3) { pts.push(e[i - 3], e[i - 2], e[i - 1], e[i], e[i + 1], e[i + 2]); segEdge.push(n); }
    });
    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), edges);
    lines.userData.bodyEdges = edges === edgeMat || edges === selEdgeMat;
    lines.userData.segEdge = segEdge; // segment index → edge number, for picking edges
    lines.visible = !lines.userData.bodyEdges || view.edges;
    mesh.add(lines);
    mesh.userData = { id: body.id, faceIds: body.faceIds, facePlanes: body.facePlanes, volume: body.volume, edges: body.edges };
    return mesh;
  }
  const dispose = obj => { obj.traverse(o => o.geometry?.dispose()); obj.removeFromParent(); };

  const bodies = new THREE.Group();
  scene.add(bodies);
  let current = [], selected = null;
  const hidden = new Set();

  function showScene(list) {
    // The selection is kept as refs across the change and turned back into the new numbers.
    const keep = selection.body !== null && refsOf(selection.body, [...selection.edges]);
    current = list;
    if (keep) {
      const b = list.find(x => x.id === selection.body);
      const now = b ? (b.edgeRefs ?? []).flatMap((r, n) => keep.includes(r) ? [n] : []) : [];
      selection.edges = new Set(now);
      if (!now.length) selection.body = null;
      failedEdges = [];
      $('blend-count').textContent = selection.edges.size;
    }
    if (selected !== null && !list.some(b => b.id === selected)) selected = null;
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
    // Edge numbers belong to the bodies just replaced.
    hoverEdge = null;
    drawOverlays();
  }

  /** The area-weighted centre of a face, from its display triangles. */
  function faceCentre(body, face) {
    const { positions: p, indices: ix, faceIds } = body;
    const c = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
    let area = 0;
    for (let t = 0; t < faceIds.length; t++) {
      if (faceIds[t] !== face) continue;
      a.fromArray(p, ix[3 * t] * 3); b.fromArray(p, ix[3 * t + 1] * 3); d.fromArray(p, ix[3 * t + 2] * 3);
      const w = b.clone().sub(a).cross(d.clone().sub(a)).length() / 2;
      c.addScaledVector(a.add(b).add(d), w / 3);
      area += w;
    }
    return area > 0 ? c.divideScalar(area) : null;
  }

  /** Refs of the numbered edges of a body as currently shown; null if it has none (an old backend). */
  function refsOf(body, numbers) {
    const refs = current.find(b => b.id === body)?.edgeRefs;
    return refs?.length ? numbers.map(n => refs[n]).filter(r => r !== undefined) : null;
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
  let profileKind = 'rect', size = 10;
  let profile = { kind: 'rect', width: 10, height: 10 };
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
    outline.geometry.setFromPoints(outlinePoints().map(p => origin.clone().addScaledVector(x, p.x).addScaledVector(y, p.y).addScaledVector(normal, 0.02)));
    outline.visible = true;
  }

  // --- picking ------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const gridStep = () => +$('grid').value;
  const snapValue = (v, e) => (view.snap || e?.ctrlKey || e?.metaKey) ? Math.round(v / gridStep()) * gridStep() : v;
  function ray(event) {
    const r = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((event.clientX - r.left) / r.width) * 2 - 1, -((event.clientY - r.top) / r.height) * 2 + 1), camera);
  }

  // The work plane: where a sketch goes when the click lands on no body. The ground unless set
  // from a face, and shifted along its normal by an offset.
  const UP = new THREE.Vector3(0, 1, 0);
  const work = { origin: new THREE.Vector3(), normal: UP.clone(), offset: 0, name: 'GROUND' };
  const workPoint = () => work.origin.clone().addScaledVector(work.normal, work.offset);
  const workPlane = () => new THREE.Plane().setFromNormalAndCoplanarPoint(work.normal, workPoint());
  const workGrid = new THREE.GridHelper(160, 32, COLORS.accent, COLORS.accent);
  for (const m of [workGrid.material].flat()) Object.assign(m, { transparent: true, opacity: 0.22, depthWrite: false });
  workGrid.visible = false;
  scene.add(workGrid);
  function placeWorkPlane() {
    const ground = work.name === 'GROUND';
    workGrid.visible = !ground || work.offset !== 0;
    workGrid.position.copy(workPoint());
    workGrid.quaternion.setFromUnitVectors(UP, work.normal);
    const name = work.offset ? `${work.name} ${fmt(work.offset)}` : work.name;
    $('plane').textContent = name;
    $('status-plane').textContent = name;
    if (document.activeElement !== $('plane-offset')) $('plane-offset').value = work.offset;
  }
  /** Put the work plane on a picked flat face, or back on the ground with no face. */
  function setWorkPlane(hit) {
    if (hit?.target != null && !hit.curved) {
      work.origin.copy(hit.origin);
      work.normal.copy(hit.normal);
      work.name = `FACE · ${label(hit.target)}`;
    } else {
      work.origin.set(0, 0, 0);
      work.normal.copy(UP);
      work.name = 'GROUND';
    }
    work.offset = 0;
    placeWorkPlane();
  }

  // Point snapping: a sketch starts on a vertex, an edge's midpoint or a face's centre when the
  // pointer is within a few pixels of one on the same plane. Alt turns it off for a click.
  const SNAP_PX = 10;
  const snapMarker = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)),
    new THREE.PointsMaterial({ color: COLORS.accent, size: 9, sizeAttenuation: false, depthTest: false }));
  snapMarker.renderOrder = 13;
  snapMarker.visible = false;
  scene.add(snapMarker);
  function snapCandidates(m) {
    if (m.userData.snaps) return m.userData.snaps;
    const out = [];
    const at = (e, i) => new THREE.Vector3(e[i], e[i + 1], e[i + 2]);
    for (const e of m.userData.edges) {
      const n = e.length / 3;
      out.push({ point: at(e, 0), kind: 'VERTEX' }, { point: at(e, (n - 1) * 3), kind: 'VERTEX' });
      // Lines come as two points; curves as even samples, so the middle sample is the midpoint.
      const mid = n === 2 ? at(e, 0).lerp(at(e, 3), 0.5) : n % 2 ? at(e, (n - 1) / 2 * 3) : at(e, (n / 2 - 1) * 3).lerp(at(e, n / 2 * 3), 0.5);
      out.push({ point: mid, kind: 'MIDPOINT' });
    }
    const body = current.find(b => b.id === m.userData.id);
    m.userData.facePlanes.forEach((p, f) => { const c = p && body && faceCentre(body, f); if (c) out.push({ point: c, kind: 'CENTRE' }); });
    return m.userData.snaps = out;
  }
  function snapPoint(event, plane, meshes) {
    if (event.altKey) return null;
    const r = canvas.getBoundingClientRect();
    let best = null, bestD = SNAP_PX;
    for (const m of meshes) for (const c of snapCandidates(m)) {
      if (Math.abs(plane.distanceToPoint(c.point)) > 1e-3) continue;
      const s = c.point.clone().project(camera);
      if (s.z > 1) continue;
      const d = Math.hypot((s.x + 1) / 2 * r.width + r.left - event.clientX, (1 - s.y) / 2 * r.height + r.top - event.clientY);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best && { point: best.point.clone(), kind: best.kind };
  }
  function showSnap(hit) {
    snapMarker.visible = !!hit?.snap;
    if (hit?.snap) snapMarker.position.copy(hit.origin);
    const tag = $('snap-tag');
    tag.hidden = !hit?.snap;
    if (hit?.snap) tag.textContent = hit.snap;
  }

  function pick(event) {
    ray(event);
    const onPlane = (v, plane) => v.addScaledVector(plane.normal, -plane.distanceToPoint(v));
    const gridSnap = v => v.set(...v.toArray().map(c => snapValue(c, event)));
    const visible = bodies.children.filter(m => m.visible);
    const hit = raycaster.intersectObjects(visible, false)[0];
    if (hit) {
      const { faceIds, facePlanes, id } = hit.object.userData;
      const face = faceIds[hit.faceIndex];
      const plane = facePlanes[face];
      if (!plane) return { curved: true };
      const normal = new THREE.Vector3(...plane.normal);
      const p = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(...plane.origin));
      const s = snapPoint(event, p, [hit.object]);
      // Keep the sketch exactly on the face's plane, wherever the ray landed.
      const origin = onPlane(s ? s.point : gridSnap(hit.point.clone()), p);
      return { origin, normal, target: id, face, snap: s?.kind };
    }
    const plane = workPlane();
    const at = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!at) return;
    const s = snapPoint(event, plane, visible);
    return { origin: onPlane(s ? s.point : gridSnap(at), plane), normal: work.normal.clone(), target: null, snap: s?.kind };
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
    $('distance').disabled = !active;
    $('commit').disabled = $('cancel').disabled = !active && !blend && !motion;
    if (motion) {
      $('target').textContent = label(motion.body);
      $('status-target').textContent = label(motion.body);
      return;
    }
    if (blend) {
      const t = selection.body !== null ? label(selection.body) : '—';
      $('target').textContent = t;
      $('status-target').textContent = t;
      return;
    }
    $('distance').classList.toggle('hot', !!active);
    const t = active ? (active.target ? label(active.target) : 'GROUND') : '—';
    $('target').textContent = t;
    $('status-target').textContent = active ? t : 'VOID';
    if (!active) { setOp(null); setHud(null); }
    renderOutliner();
  }

  function begin({ origin, normal, target }) {
    if (blend) endBlend('cancelled');
    if (motion) endMotion('cancelled');
    setTool('pushpull');
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

  async function commitPushPull() {
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
  // --- the command lifecycle ------------------------------------------------
  // One command runs at a time: choose a tool (button, key or `run`), adjust against a live preview,
  // then commit (Enter, OK) or cancel (Escape). Push/pull is what runs when no other tool is chosen.
  const running = () => motion ? 'motion' : blend ? 'fillet' : active ? 'pushpull' : null;
  const commit = () => ({ motion: commitMotion, fillet: commitBlend, pushpull: commitPushPull })[running()]?.();
  const cancel = () => ({ motion: () => endMotion('cancelled'), fillet: () => endBlend('cancelled'), pushpull: () => end('cancelled') })[running()]?.();

  /** Start a tool from the registry, as its button or key would. */
  function startTool(id) {
    if (id === 'pushpull') return cancel();
    if (id === 'fillet') return blend || beginBlend();
    if (id === 'move' || id === 'rotate') return motion?.kind === id || beginMotion(id);
  }

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


  // --- edge selection -----------------------------------------------------
  // Edges are picked by number (the index into a body's `edges`). The numbers belong to one version
  // of a body, so any change to the scene clears the selection.
  const selection = { body: null, edges: new Set() };
  let mode = 'face', hoverEdge = null;
  const overlays = new THREE.Group();
  scene.add(overlays);
  const overlayMat = {
    hover: new THREE.LineBasicMaterial({ color: COLORS.ink, depthTest: false, transparent: true, opacity: 0.9 }),
    selected: new THREE.LineBasicMaterial({ color: COLORS.accent, depthTest: false }),
    failed: new THREE.LineBasicMaterial({ color: DANGER, depthTest: false }),
  };
  let failedEdges = [];

  const bodyMesh = id => bodies.children.find(m => m.userData.id === id);
  function edgeLines(id, numbers, material) {
    const m = bodyMesh(id);
    if (!m) return null;
    const pts = [];
    for (const n of numbers) {
      const e = m.userData.edges[n];
      if (e) for (let i = 3; i < e.length; i += 3) pts.push(e[i - 3], e[i - 2], e[i - 1], e[i], e[i + 1], e[i + 2]);
    }
    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), material);
    lines.renderOrder = 12;
    return lines;
  }
  function drawOverlays() {
    for (const o of [...overlays.children]) dispose(o);
    if (hoverEdge && !(hoverEdge.body === selection.body && selection.edges.has(hoverEdge.edge))) {
      const l = edgeLines(hoverEdge.body, [hoverEdge.edge], overlayMat.hover);
      if (l) overlays.add(l);
    }
    if (selection.body !== null) {
      const l = edgeLines(selection.body, [...selection.edges].filter(e => !failedEdges.includes(e)), overlayMat.selected);
      if (l) overlays.add(l);
      const bad = failedEdges.length && edgeLines(selection.body, failedEdges, overlayMat.failed);
    if (bad) overlays.add(bad);
    }
  }

  /** The edge under the pointer, if it is not hidden behind a face. */
  function pickEdge(event) {
    ray(event);
    // Pick on the committed bodies even while a preview stands in for one: edge numbers refer to them.
    const visible = bodies.children.filter(m => !hidden.has(m.userData.id));
    raycaster.params.Line.threshold = camera.position.distanceTo(controls.target) * 0.008;
    const hits = raycaster.intersectObjects(visible.map(m => m.children[0]), false);
    if (!hits.length) return null;
    const face = raycaster.intersectObjects(visible, false)[0]; // a face in front hides the edge
    const hit = hits.find(h => !face || h.distance <= face.distance + face.distance * 0.01);
    if (!hit) return null;
    const segment = hit.index / 2;
    return { body: hit.object.parent.userData.id, edge: hit.object.userData.segEdge[segment] };
  }

  function selectEdge(hit, add) {
    failedEdges = [];
    if (!hit) { if (!add) clearSelection(); return; }
    if (selection.body !== hit.body) { selection.body = hit.body; selection.edges.clear(); }
    else if (!add) {
      const only = selection.edges.size === 1 && selection.edges.has(hit.edge);
      selection.edges.clear();
      if (only) { selection.body = null; return selectionChanged(); }
    }
    if (add && selection.edges.has(hit.edge)) selection.edges.delete(hit.edge);
    else selection.edges.add(hit.edge);
    if (!selection.edges.size) selection.body = null;
    selectionChanged();
  }
  function clearSelection() {
    selection.body = null;
    selection.edges.clear();
    failedEdges = [];
    selectionChanged();
  }
  function selectionChanged() {
    drawOverlays();
    $('blend-count').textContent = selection.edges.size;
    if (blend) { refreshPanel(); previewBlend(); }
  }

  /** Select a whole body (solid mode, or the outliner); null clears. */
  function selectBody(id) {
    selected = id;
    showScene(current);
  }

  function setMode(m) {
    mode = m;
    for (const b of $$('[data-mode]')) b.setAttribute('aria-pressed', b.dataset.mode === m);
    if (m !== 'face') { outline.visible = false; showSnap(null); }
    hoverEdge = null;
    drawOverlays();
    setHud(null);
  }

  // --- the fillet command -------------------------------------------------
  // Select edges, then F (or the reverse: F, then pick edges). The preview follows every change of
  // selection, radius or type; the handle on the first edge drags the radius. Enter commits, Escape
  // leaves the tool and keeps the selection. A failure keeps the tool open, names the reason and
  // marks the edges the kernel blamed in red.
  let blend = null, blendGizmo = null, blendSent = 0, blendShown = 0;
  const lastSize = { fillet: 2, chamfer: 1 };

  function blendRequest() {
    return { body: selection.body, edges: [...selection.edges].sort((a, b) => a - b), size: blend.size, kind: blend.kind };
  }

  /** Where the radius handle sits: the first edge's midpoint, pointing into the body. */
  function placeBlendGizmo() {
    blendGizmo?.dispose();
    blendGizmo = null;
    const m = bodyMesh(selection.body);
    const first = [...selection.edges][0];
    const e = m?.userData.edges[first];
    if (!e) return;
    const n = e.length / 3, mid = Math.floor((n - 1) / 2);
    const a = new THREE.Vector3(e[mid * 3], e[mid * 3 + 1], e[mid * 3 + 2]);
    const b = new THREE.Vector3(e[(mid + 1) * 3], e[(mid + 1) * 3 + 1], e[(mid + 1) * 3 + 2]);
    const at = a.clone().lerp(b, 0.5), tangent = b.clone().sub(a).normalize();
    m.geometry.computeBoundingBox();
    const inward = m.geometry.boundingBox.getCenter(new THREE.Vector3()).sub(at);
    inward.addScaledVector(tangent, -inward.dot(tangent)).normalize();
    if (inward.lengthSq() < 0.5) return;
    blendGizmo = new ExtrudeGizmo(camera, canvas, { step: gridStep() });
    blendGizmo.position.copy(at);
    blendGizmo.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), inward);
    blendGizmo.onDragStart = () => controls.enabled = false;
    blendGizmo.onDragEnd = () => controls.enabled = true;
    blendGizmo.onChange = d => setBlendSize(Math.max(0.05, view.snap ? snapValue(d) : d), true);
    blendGizmo.render(blend.size);
    scene.add(blendGizmo);
  }

  function setBlendSize(v, fromGizmo = false) {
    if (!blend || !(v > 0)) return;
    blend.size = lastSize[blend.kind] = v;
    if (document.activeElement !== $('blend-size')) $('blend-size').value = v.toFixed(2);
    if (!fromGizmo) blendGizmo?.render(v);
    previewBlend();
  }

  function setBlendKind(kind) {
    for (const b of $$('[data-blend]')) b.setAttribute('aria-pressed', b.dataset.blend === kind);
    $('blend-size-label').textContent = kind === 'chamfer' ? 'DISTANCE' : 'RADIUS';
    if (!blend) return;
    blend.kind = kind;
    setBlendSize(lastSize[kind]);
    refreshPanel();
  }

  function clearBlendPreview() {
    for (const m of [...previewGroup.children]) dispose(m);
    for (const m of bodies.children) m.visible = !hidden.has(m.userData.id);
  }

  async function previewBlend() {
    if (!blend) return;
    const n = ++blendSent;
    clearBlendPreview();
    if (selection.body === null || !selection.edges.size) {
      blendGizmo?.dispose(); blendGizmo = null;
      setState('none');
      setHud(blend.kind === 'chamfer' ? 'SELECT EDGES TO CHAMFER' : 'SELECT EDGES TO ROUND');
      $('blend-hint').textContent = 'CLICK AN EDGE · ⇧ CLICK ADDS';
      return;
    }
    if (!blendGizmo) placeBlendGizmo();
    $('blend-hint').textContent = `${selection.edges.size} EDGE${selection.edges.size > 1 ? 'S' : ''} ON ${label(selection.body)}`;
    setState('updating');
    const t0 = performance.now();
    let body;
    try { body = await backend.previewBlend(blendRequest()); }
    catch (e) {
      if (!blend || n !== blendSent) return;
      // When the kernel can't say which edges failed, mark the whole selection.
      failedEdges = e.edges?.length ? e.edges : [...selection.edges];
      drawOverlays();
      setState('failed');
      setHud(`${blend.kind === 'chamfer' ? 'CHAMFER' : 'ROUND'} FAILED`);
      $('blend-hint').textContent = String(e.message ?? e).toUpperCase();
      toast(String(e.message ?? e).toUpperCase());
      return;
    }
    if (!body || !blend || n < blendShown) return;
    blendShown = n;
    if (failedEdges.length) { failedEdges = []; drawOverlays(); }
    $('ms').textContent = Math.round(performance.now() - t0);
    clearBlendPreview();
    for (const m of bodies.children) if (m.userData.id === body.id) m.visible = false;
    previewGroup.add(meshOf(body, faceMat, edgeMat));
    setHud(`${blend.kind === 'chamfer' ? 'CHAMFER' : 'R'} ${mm(blend.size)}`);
    if (n === blendSent) setState('updated');
  }

  function beginBlend(kind = 'fillet') {
    if (active) end('cancelled');
    if (motion) endMotion('cancelled');
    blend = { kind, size: lastSize[kind] };
    blendSent = blendShown = 0;
    setTool('fillet');
    setMode('edge');
    setBlendKind(kind);
    $('blend-size').value = blend.size.toFixed(2);
    setState('none');
    refreshPanel();
  }

  function endBlend(state) {
    blendGizmo?.dispose();
    blendGizmo = blend = null;
    clearBlendPreview();
    failedEdges = [];
    drawOverlays();
    setState(state);
    setTool('pushpull');
    refreshPanel();
  }

  async function commitBlend() {
    if (!blend) return;
    if (selection.body === null || !selection.edges.size) return toast('SELECT AT LEAST ONE EDGE');
    const req = blendRequest();
    const text = `${req.kind === 'chamfer' ? 'CHAMFER' : 'ROUND'} ${req.size.toFixed(2)} ×${req.edges.length}`;
    try {
      const { id, scene: list } = await backend.commitBlend(req);
      endBlend('committed');
      history.splice(history.length - undone, undone, { text, id });
      undone = 0;
      renderHistory();
      clearSelection();
      showScene(list);
    } catch (e) {
      failedEdges = e.edges ?? [];
      drawOverlays();
      setState('failed');
      toast(String(e.message ?? e).toUpperCase());
    }
  }

  function setTool(t) {
    for (const b of $$('[data-tool]')) b.setAttribute('aria-pressed', b.dataset.tool === t);
    for (const el of $$('[data-panel]')) el.hidden = el.dataset.panel !== t;
    for (const el of $$('[data-keys]')) el.hidden = el.dataset.keys !== t;
    const name = toolInfo(t).label;
    $('tool-name').textContent = name;
    $('status-tool').textContent = name;
  }

  // --- move and rotate ----------------------------------------------------
  // Select a body (4 SOLID, or the outliner), then G or R. The handles move a stand-in for the body;
  // the body's mesh follows it as the preview, since a rigid motion needs no kernel work. Enter
  // sends the motion to the kernel as one undo step; the body keeps its face and edge refs.
  // The panel shows the user's coordinates (z up); the viewport's own y is up.
  const toWorld = ([x, y, z]) => [x, z, -y];
  const toUser = ([x, y, z]) => [x, -z, y];
  const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  const DEG = Math.PI / 180;
  let motion = null;

  function beginMotion(kind) {
    if (selected === null && current.length === 1) selectBody(current[0].id);
    if (selected === null) {
      setMode('solid');
      return toast('SELECT A BODY TO ' + (kind === 'move' ? 'MOVE' : 'ROTATE'));
    }
    if (active) end('cancelled');
    if (blend) endBlend('cancelled');
    if (motion) endMotion('cancelled');
    const mesh = bodyMesh(selected);
    mesh.geometry.computeBoundingBox();
    const pivot = mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
    const handle = new THREE.Object3D();
    handle.position.copy(pivot);
    scene.add(handle);
    const tc = new TransformControls(camera, canvas);
    tc.setMode(kind === 'move' ? 'translate' : 'rotate');
    tc.setSpace('world');
    tc.attach(handle);
    tc.addEventListener('dragging-changed', e => { controls.enabled = !e.value; });
    tc.addEventListener('objectChange', () => motionChanged(true));
    scene.add(tc.getHelper());
    motion = { kind, body: selected, pivot, handle, tc, axis: 'z' };
    setTool(kind);
    setMotionAxis('z');
    setMotionSnap();
    setState('none');
    motionChanged(false);
    refreshPanel();
  }

  /** The handle's offset (user coordinates) and turn about the chosen axis (degrees). */
  function motionValues() {
    const offset = toUser(motion.handle.position.clone().sub(motion.pivot).toArray());
    const a = new THREE.Vector3(...toWorld(AXES[motion.axis])), q = motion.handle.quaternion;
    const angle = 2 * Math.atan2(new THREE.Vector3(q.x, q.y, q.z).dot(a), q.w) / DEG;
    return { offset, angle: Math.round(angle * 1e6) / 1e6 };
  }

  /** Follow the handle with the body's mesh, and the panel with the handle. */
  function motionChanged(fromHandle) {
    const m = bodyMesh(motion.body), h = motion.handle;
    m.quaternion.copy(h.quaternion);
    m.position.copy(h.position).sub(motion.pivot.clone().applyQuaternion(h.quaternion));
    for (const o of overlays.children) { o.quaternion.copy(m.quaternion); o.position.copy(m.position); }
    const { offset, angle } = motionValues();
    for (const input of $$('[data-move]')) if (document.activeElement !== input) input.value = +offset[input.dataset.move].toFixed(3);
    if (document.activeElement !== $('angle')) $('angle').value = +angle.toFixed(3);
    const moved = offset.some(v => Math.abs(v) > 1e-9) || Math.abs(angle) > 1e-9;
    setHud(motion.kind === 'move'
      ? `Δ ${offset.map(v => fmt(v)).join(' ')}`
      : `${motion.axis.toUpperCase()} ${fmt(angle)}°`);
    if (fromHandle || moved) setState(moved ? 'updated' : 'none');
  }

  function setMotionOffset(offset) {
    if (!motion) return;
    motion.handle.position.copy(motion.pivot).add(new THREE.Vector3(...toWorld(offset)));
    motionChanged(false);
  }
  function setMotionAngle(deg) {
    if (!motion) return;
    motion.handle.quaternion.setFromAxisAngle(new THREE.Vector3(...toWorld(AXES[motion.axis])), deg * DEG);
    motionChanged(false);
  }
  function setMotionAxis(axis) {
    for (const b of $$('[data-axis]')) b.setAttribute('aria-pressed', b.dataset.axis === axis);
    if (!motion) return;
    const angle = motion.kind === 'rotate' ? motionValues().angle : 0;
    motion.axis = axis;
    if (motion.kind === 'rotate') {
      // Show only the ring that turns about this axis, in the viewport's axes.
      const w = toWorld(AXES[axis]).map(Math.abs);
      Object.assign(motion.tc, { showX: !!w[0], showY: !!w[1], showZ: !!w[2] });
      setMotionAngle(angle);
    }
  }
  function setMotionSnap() {
    if (!motion) return;
    motion.tc.setTranslationSnap(view.snap ? gridStep() : null);
    motion.tc.setRotationSnap(view.snap ? 15 * DEG : null);
  }

  function endMotion(state) {
    if (!motion) return;
    const m = bodyMesh(motion.body);
    if (m) { m.position.set(0, 0, 0); m.quaternion.identity(); }
    for (const o of overlays.children) { o.position.set(0, 0, 0); o.quaternion.identity(); }
    motion.tc.detach();
    motion.tc.getHelper().removeFromParent();
    motion.tc.dispose();
    motion.handle.removeFromParent();
    motion = null;
    controls.enabled = true;
    setState(state);
    setTool('pushpull');
    setHud(null);
    refreshPanel();
  }

  async function commitMotion() {
    if (!motion) return;
    const { offset, angle } = motionValues();
    if (offset.every(v => Math.abs(v) < 1e-9) && Math.abs(angle) < 1e-9) return endMotion('cancelled');
    const req = motion.kind === 'move'
      ? { body: motion.body, offset: toWorld(offset), pivot: [0, 0, 0], axis: [0, 1, 0], angle: 0 }
      : { body: motion.body, offset: [0, 0, 0], pivot: motion.pivot.toArray(), axis: toWorld(AXES[motion.axis]), angle: angle * DEG };
    const text = motion.kind === 'move'
      ? `MOVE ${offset.map(v => fmt(v)).join(' ')}`
      : `ROTATE ${motion.axis.toUpperCase()} ${fmt(angle)}°`;
    try {
      const { id, scene: list } = await backend.commitMotion(req);
      endMotion('committed');
      history.splice(history.length - undone, undone, { text, id });
      undone = 0;
      renderHistory();
      showScene(list);
    } catch (e) {
      setState('failed');
      toast(String(e.message ?? e).toUpperCase());
    }
  }

  // --- files --------------------------------------------------------------
  function newScene(list, name) {
    cancel();
    clearSelection();
    history.length = 0;
    undone = 0;
    renderHistory();
    showScene(list);
    $('file-name').textContent = name;
  }
  async function fileAction(fn) {
    try { await fn(); } catch (e) { toast(String(e.message ?? e).toUpperCase()); }
  }
  for (const [id, method] of [['file-new', 'newDocument'], ['file-open', 'open'], ['file-save', 'save'], ['import', 'importStep']]) {
    $(id).hidden = typeof backend[method] !== 'function';
  }
  $('file-new').onclick = () => fileAction(async () => newScene(await backend.newDocument(), 'UNTITLED.W3D'));
  $('file-open').onclick = () => fileAction(async () => {
    const r = await backend.open();
    if (r) newScene(r.scene, r.name.toUpperCase());
  });
  $('file-save').onclick = () => fileAction(async () => {
    const name = await backend.save();
    if (name) { $('file-name').textContent = name.toUpperCase(); toast(`SAVED ${name.toUpperCase()}`); }
  });
  $('import').onclick = () => fileAction(async () => {
    const r = await backend.importStep();
    if (!r) return;
    cancel();
    clearSelection();
    history.splice(history.length - undone, undone, { text: 'IMPORT STEP', id: r.id });
    undone = 0;
    renderHistory();
    showScene(r.scene);
  });

  // --- input --------------------------------------------------------------
  let downAt;
  canvas.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
  let pickingPlane = false;
  canvas.addEventListener('pointerup', async e => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4 || gizmo?.dragging || blendGizmo?.dragging) return;
    if (motion) return;
    if (pickingPlane) {
      pickingPlane = false;
      const hit = pick(e);
      if (hit?.target == null || hit.curved) return toast('PICK A FLAT FACE FOR THE WORK PLANE');
      setWorkPlane(hit);
      return setHud(null);
    }
    if (blend || mode === 'edge') return selectEdge(pickEdge(e), e.shiftKey);
    if (mode === 'solid') {
      ray(e);
      const hit = raycaster.intersectObjects(bodies.children.filter(m => m.visible), false)[0];
      return selectBody(hit ? (hit.object.userData.id === selected && !e.shiftKey ? null : hit.object.userData.id) : null);
    }
    const hit = pick(e);
    if (active) await commit();
    if (hit?.curved) toast('PICK A FLAT FACE TO SKETCH ON');
    else if (hit) begin(hit);
  });
  canvas.addEventListener('pointermove', e => {
    ray(e);
    const p = raycaster.ray.intersectPlane(new THREE.Plane(UP, 0), new THREE.Vector3());
    if (p) $('cursor').textContent = `X ${p.x.toFixed(2)} Y ${(-p.z).toFixed(2)} Z ${p.y.toFixed(2)}`;
    if (active || motion || e.buttons) return;
    if (blend || mode === 'edge') {
      const h = pickEdge(e);
      if (h?.body !== hoverEdge?.body || h?.edge !== hoverEdge?.edge) { hoverEdge = h; drawOverlays(); }
      return;
    }
    if (mode === 'solid') return;
    const hit = pick(e);
    lastHover = hit;
    showSnap(hit);
    if (hit && !hit.curved && !pickingPlane) placeOutline(hit.origin, hit.normal); else outline.visible = false;
  });
  let lastHover = null;

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
    setMotionSnap();
  };
  for (const input of $$('[data-move]')) input.addEventListener('input', () => {
    const v = $$('[data-move]').map(i => parseFloat(i.value) || 0);
    setMotionOffset(v);
  });
  $('angle').addEventListener('input', e => { const v = parseFloat(e.target.value); if (!isNaN(v)) setMotionAngle(v); });
  for (const b of $$('[data-axis]')) b.onclick = () => setMotionAxis(b.dataset.axis);
  function pickWorkPlane() {
    // Over a flat face, take it at once; otherwise wait for the next click on one.
    if (lastHover?.target != null && !lastHover.curved && mode === 'face' && !active) return setWorkPlane(lastHover);
    pickingPlane = true;
    setMode('face');
    setHud('CLICK A FLAT FACE FOR THE WORK PLANE');
  }
  $('plane-face').onclick = () => { lastHover = null; pickWorkPlane(); };
  $('plane-ground').onclick = () => setWorkPlane(null);
  $('plane-offset').addEventListener('input', e => { const v = parseFloat(e.target.value); if (!isNaN(v)) { work.offset = v; placeWorkPlane(); } });
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
  $('blend-size').addEventListener('input', e => setBlendSize(parseFloat(e.target.value)));
  for (const b of $$('[data-blend]')) b.onclick = () => blend ? setBlendKind(b.dataset.blend) : beginBlend(b.dataset.blend);
  for (const b of $$('[data-mode]')) b.onclick = () => setMode(b.dataset.mode);
  for (const b of $$('[data-tool]')) b.onclick = () => startTool(b.dataset.tool);
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
    else if (e.key === 'Escape') {
      if (pickingPlane) { pickingPlane = false; setHud(null); }
      else if (running()) cancel();
      else { clearSelection(); selectBody(null); }
    }
    else if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); step(e.shiftKey ? 'redo' : 'undo'); }
    else if (e.key === 'Control' && motion) { view.snap = !view.snap; setMotionSnap(); view.snap = !view.snap; }
    else if (e.ctrlKey || e.metaKey || e.altKey) return;
    else if (motion?.kind === 'rotate' && 'xyz'.includes(k)) setMotionAxis(k);
    // While a push/pull runs, its own keys come first.
    else if (active && k === 'q') setOperation('join');
    else if (active && k === 'w') setOperation('cut');
    else if (active && k === 'b') setOperation('new');
    else if (active && k === 'r') setProfile('rect');
    else if (active && k === 'c') setProfile('circle');
    else if (toolForKey(k)) startTool(toolForKey(k).id);
    else if (k === 'k') pickWorkPlane();
    else if (k === '2') setMode('edge');
    else if (k === '3') { if (!blend) setMode('face'); }
    else if (k === '4') { if (!blend) setMode('solid'); }
  });
  addEventListener('keyup', e => { if (e.key === 'Control') setMotionSnap(); });

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
    if (blendGizmo) { blendGizmo.scale.setScalar(camera.position.distanceTo(blendGizmo.position) / 14); blendGizmo.render(blendGizmo.value); }
    renderer.render(scene, camera);
  });

  return {
    begin: (origin, normal, target) => begin({ origin: new THREE.Vector3(...origin), normal: new THREE.Vector3(...normal), target }),
    setDistance: d => active && setDistance(d),
    commit, cancel, step,
    /** Select edges by number on one body, as a click would. */
    selectEdges(body, edges) { clearSelection(); for (const edge of edges) selectEdge({ body, edge }, true); },
    beginBlend, setBlendSize, setMode, selectBody, startTool, setMotionOffset, setMotionAngle, setMotionAxis,
    /** Put the work plane on a body's face (by number), or back on the ground with no arguments. */
    setWorkPlane(body, face, offset = 0) {
      const b = current.find(x => x.id === body), p = b?.facePlanes[face];
      setWorkPlane(p ? { target: body, origin: faceCentre(b, face), normal: new THREE.Vector3(...p.normal) } : null);
      work.offset = offset;
      placeWorkPlane();
    },
    /** What a command would act on now, by ref: the context an AI request is checked against. */
    context() {
      const b = current.find(x => x.id === selection.body);
      return {
        revision: current[0]?.revision ?? 0,
        tool: running(),
        edges: selection.body === null ? null : { body: selection.body, refs: refsOf(selection.body, [...selection.edges]) ?? [], numbers: [...selection.edges], count: b?.edges.length },
        body: selected,
        workPlane: { name: work.name, origin: workPoint().toArray(), normal: work.normal.toArray() },
      };
    },
    /**
     * Start a registered tool with checked arguments and leave its preview for the user to adjust
     * and confirm, as the AI command box will. Throws with the reasons when the arguments are wrong.
     * The selection is named by ref: `edges` (fillet) or `body` (move, rotate).
     */
    async run(id, args = {}) {
      const { edges, body, face, ...rest } = args;
      const errors = check(id, rest);
      if (errors.length) throw new Error(errors.join('; '));
      const p = withDefaults(id, rest);
      if (id === 'fillet') {
        const owner = current.find(b => edges?.length && edges.every(r => b.edgeRefs?.includes(r)));
        if (!owner) throw new Error('those edges are not all on one body any more');
        clearSelection();
        selection.body = owner.id;
        selection.edges = new Set(owner.edgeRefs.flatMap((r, n) => edges.includes(r) ? [n] : []));
        selectionChanged();
        if (!blend) beginBlend(p.kind); else setBlendKind(p.kind);
        setBlendSize(p.size);
      } else if (id === 'move' || id === 'rotate') {
        if (!current.some(b => b.id === body)) throw new Error('that body no longer exists');
        selectBody(body);
        beginMotion(id);
        if (id === 'move') setMotionOffset(p.offset);
        else { setMotionAxis(p.axis); setMotionAngle(p.angle); }
      } else if (id === 'pushpull') {
        const b = face !== undefined && current.find(x => x.faceRefs?.includes(face));
        const n = b ? b.faceRefs.indexOf(face) : -1, plane = b?.facePlanes[n];
        if (face !== undefined && !plane) throw new Error('that face is gone or not flat');
        const at = plane ? { origin: faceCentre(b, n), normal: new THREE.Vector3(...plane.normal), target: b.id }
          : { origin: workPoint(), normal: work.normal.clone(), target: null };
        setProfile(p.profile);
        size = p.size; makeProfile(); $('size').value = size;
        newBody = p.newBody;
        begin(at);
        if (p.distance) setDistance(p.distance);
      }
    },
    /** Where a point (viewport coordinates) is on the page, in CSS pixels. */
    project(p) {
      const r = canvas.getBoundingClientRect(), s = new THREE.Vector3(...p).project(camera);
      return [(s.x + 1) / 2 * r.width + r.left, (1 - s.y) / 2 * r.height + r.top];
    },
    get selection() { return { body: selection.body, edges: [...selection.edges] } },
    get selectedBody() { return selected },
    get blend() { return blend && { ...blend } },
    get motion() { return motion && { kind: motion.kind, body: motion.body, axis: motion.axis, ...motionValues() } },
    get workPlane() { return { name: work.name, offset: work.offset, origin: workPoint().toArray(), normal: work.normal.toArray() } },
    get active() { return active },
    get bodies() { return current },
  };
}
