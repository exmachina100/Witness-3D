// Extend Sheet (Plasticity's Extend on a sheet's edge) in the browser build. The desktop's tests
// are crates/w3d-kernel/tests/extend_sheet.rs.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as THREE from 'three';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { box, count, loadKernel, numbered, numberedEdges, oc, primitive, tessellate } from '../src/Kernel.js';
import { bridgeSurface } from '../src/BridgeSurface.js';
import { extendSheet, extendSheetTo } from '../src/ExtendSheet.js';
import { patch } from '../src/Patch.js';

before(async () => { await loadKernel() });

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const polyline = pts => ({ origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1], kind: 'polyline', points: pts, closed: true });

/** The square sheet x0..x0+10 by y 0..10 at height z, as Patch makes it. */
function square(x0, z) {
    const c = { origin: [0, 0, z], x: [1, 0, 0], normal: [0, 0, 1], kind: 'polyline', points: [[x0, 0], [x0 + 10, 0], [x0 + 10, 10], [x0, 10]], closed: true };
    return patch([c], []);
}
/** Every vertex of a shape's mesh. */
function points(shape) {
    const a = tessellate(shape, { deflection: 0.0005 }).mesh.getAttribute('position');
    return Array.from({ length: a.count }, (_, i) => new THREE.Vector3(a.getX(i), a.getY(i), a.getZ(i)));
}
const range = (pts, k) => [Math.min(...pts.map(p => p[k])), Math.max(...pts.map(p => p[k]))];
/** The number of the edge of `shape` whose ends both satisfy `on`. */
function edgeWhere(shape, on) {
    const o = oc();
    return numberedEdges(shape).findIndex(e => {
        const { returnValue: g, First, Last } = o.BRep_Tool.Curve(e, 0, 0);
        return [First, (First + Last) / 2, Last].every(t => { const p = g.Value(t); return on(new THREE.Vector3(p.X(), p.Y(), p.Z())); });
    });
}

test('a flat sheet grows past its edge in its plane, as one face', () => {
    const a = square(0, 0);
    const s = extendSheet(a, edgeWhere(a, p => Math.abs(p.x - 10) < 1e-9), 5);
    assert.equal(count(s, 'TopAbs_FACE'), 1);
    const pts = points(s);
    const [lo, hi] = range(pts, 'x');
    close(lo, 0); close(hi, 15);
});

test('a curved sheet carries straight on, level past the edge it left level', () => {
    const a = square(0, 0), b = square(20, 5);
    const s = bridgeSurface({ shape: a, n: edgeWhere(a, p => Math.abs(p.x - 10) < 1e-9) }, { shape: b, n: edgeWhere(b, p => Math.abs(p.x - 20) < 1e-9) }, 1);
    const low = edgeWhere(s, p => Math.abs(p.x - 10) < 1e-6 && Math.abs(p.z) < 1e-6);
    const grown = extendSheet(s, low, 3);
    assert.equal(count(grown, 'TopAbs_FACE'), 1);
    const pts = points(grown);
    const [lo, hi] = range(pts, 'x');
    close(lo, 7, 0.01); close(hi, 20, 1e-6);
    for (const p of pts.filter(p => p.x < 10)) assert.ok(Math.abs(p.z) < 1e-3, `${p.toArray()} is not level`);
    const side = extendSheet(s, edgeWhere(s, p => Math.abs(p.y) < 1e-6), 2);
    const [ylo] = range(points(side), 'y');
    close(ylo, -2, 0.01);
});

function bridgeLow() {
    const a = square(0, 0), b = square(20, 5);
    const s = bridgeSurface({ shape: a, n: edgeWhere(a, p => Math.abs(p.x - 10) < 1e-9) }, { shape: b, n: edgeWhere(b, p => Math.abs(p.x - 20) < 1e-9) }, 1);
    return [s, edgeWhere(s, p => Math.abs(p.x - 10) < 1e-6 && Math.abs(p.z) < 1e-6)];
}

test('soft leaves tangent with its curvature fading out, as a face of its own', () => {
    const [s, low] = bridgeLow();
    const grown = extendSheet(s, low, 3, 'soft');
    assert.equal(numbered(grown, 'TopAbs_FACE').length, 2);
    const past = points(grown).filter(p => p.x < 10 - 1e-6);
    close(Math.min(...past.map(p => p.x)), 7, 0.05);
    const soft = Math.max(...past.map(p => p.z));
    const inside = Math.max(...points(s).filter(p => p.x < 13).map(p => p.z));
    assert.ok(soft > 0.5 * inside && soft < 0.85 * inside, `soft rises ${soft}, the bridge ${inside}`);
});

test('reflective turns the sheet through its edge', () => {
    const [s, low] = bridgeLow();
    const grown = extendSheet(s, low, 3, 'reflective');
    assert.equal(numbered(grown, 'TopAbs_FACE').length, 2);
    const past = points(grown).filter(p => p.x < 10 - 1e-6);
    const lo = Math.min(...past.map(p => p.x)), fall = Math.min(...past.map(p => p.z));
    assert.ok(lo > 7 && lo < 7.3, `3 mm along the sheet: x down to ${lo}`);
    const inside = Math.max(...points(s).filter(p => p.x < 20 - lo + 1e-6).map(p => p.z));
    assert.ok(fall < -0.01 && Math.abs(fall + inside) < 0.01, `falls ${fall}, the bridge rises ${inside}`);
    assert.throws(() => extendSheet(s, low, 50, 'reflective'), /extend less/);
});

test('natural bends on with the sheet where linear goes straight', () => {
    const a = square(0, 0), b = square(20, 5);
    const s = bridgeSurface({ shape: a, n: edgeWhere(a, p => Math.abs(p.x - 10) < 1e-9) }, { shape: b, n: edgeWhere(b, p => Math.abs(p.x - 20) < 1e-9) }, 1);
    const low = edgeWhere(s, p => Math.abs(p.x - 10) < 1e-6 && Math.abs(p.z) < 1e-6);
    const rise = natural => Math.max(0, ...points(extendSheet(s, low, 3, natural)).filter(p => p.x < 10 - 1e-6).map(p => p.z));
    assert.ok(rise(false) < 1e-3, `linear stays level: ${rise(false)}`);
    assert.ok(rise(true) > 0.01, `natural follows the curvature: ${rise(true)}`);
    // The far side too, where the run is reversed: it carries on past x = 20 and dips back down.
    const high = edgeWhere(s, p => Math.abs(p.x - 20) < 1e-6 && Math.abs(p.z - 5) < 1e-6);
    const pts = points(extendSheet(s, high, 3, true));
    const [, hi] = range(pts, 'x');
    assert.ok(hi > 22, `reaches past the edge: ${hi}`);
    assert.ok(Math.min(...pts.filter(p => p.x > 20 + 1e-6).map(p => p.z)) < 5 - 0.01, 'bends back down');
});

test('trimmed edges and solids are refused; the backend keeps the body in one undo step', async () => {
    const be = new LocalBackend();
    const seed = be.scene()[0];
    await assert.rejects(be.previewExtendSheet({ body: seed.id, edge: 0, distance: 1 }), /solid/);
    const { ids: [ring] } = await be.addCurves([{ origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1], kind: 'circle', center: [0, 0], radius: 4 }]);
    const { id: disc } = await be.commitPatch({ curves: [ring], edges: [] });
    await assert.rejects(be.previewExtendSheet({ body: disc, edge: 0, distance: 1 }), /trimmed/);
    const { ids: [rect] } = await be.addCurves([polyline([[0, 0], [10, 0], [10, 10], [0, 10]])]);
    const { id: sheet } = await be.commitPatch({ curves: [rect], edges: [] });
    const e = edgeWhere(be.shapes.get(sheet), p => Math.abs(p.y - 10) < 1e-9);
    const { id, scene } = await be.commitExtendSheet({ body: sheet, edge: e, distance: 4 });
    assert.equal(id, sheet);
    close(range(points(be.shapes.get(sheet)), 'y')[1], 14);
    assert.ok(scene.find(b => b.id === id).sheet);
    await be.undo();
    close(range(points(be.shapes.get(sheet)), 'y')[1], 10);
});

/** The area of a shape's mesh. */
function meshArea(shape) {
    const g = tessellate(shape, { deflection: 0.001 }).mesh, a = g.getAttribute('position'), ix = g.index.array;
    const v = i => new THREE.Vector3(a.getX(i), a.getY(i), a.getZ(i));
    let s = 0;
    for (let i = 0; i < ix.length; i += 3) s += v(ix[i + 1]).sub(v(ix[i])).cross(v(ix[i + 2]).sub(v(ix[i]))).length() / 2;
    return s;
}

test('limit carries the sheet on until it meets the body', async () => {
    const a = square(0, 0);
    const e = edgeWhere(a, p => Math.abs(p.x - 10) < 1e-9);
    // A wall square across the path at x = 20, then a round post lying across it (axis along y at x = 30, r 8).
    const wall = box(new THREE.Vector3(20, -5, -5), new THREE.Vector3(30, 15, 5));
    close(meshArea(extendSheetTo(a, e, wall, 'linear')), 200, 1e-6);
    const post = primitive({ kind: 'cylinder', frame: { origin: [30, -5, 0], x: [1, 0, 0], normal: [0, 1, 0] }, radius: 8, height: 20 });
    const s = extendSheetTo(a, e, post, 'linear');
    const [lo, hi] = range(points(s), 'x');
    close(lo, 0, 1e-9);
    close(hi, 22, 1e-6);
    close(meshArea(s), 220, 1e-6);
    for (const k of ['natural', 'soft']) close(range(points(extendSheetTo(a, e, wall, k)), 'x')[1], 20, 1e-6);
    assert.throws(() => extendSheetTo(a, e, wall, 'reflective'), /reflective/);
    assert.throws(() => extendSheetTo(a, e, box(new THREE.Vector3(20, -5, 10), new THREE.Vector3(30, 15, 20)), 'linear'), /never meets/);
    // Through the backend, by body.
    const be = new LocalBackend();
    const { ids } = await be.addCurves([{ origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1], kind: 'polyline', points: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true }]);
    const { id: sheet } = await be.commitPatch({ curves: ids, edges: [] });
    const { id: block } = await be.commitPrimitive({ kind: 'box', frame: { origin: [20, -5, 5], x: [1, 0, 0], normal: [0, 0, -1] }, width: 10, depth: -20, height: 10, op: 'new' });
    const n = edgeWhere(be.shapes.get(sheet), p => Math.abs(p.x - 10) < 1e-9);
    await be.commitExtendSheet({ body: sheet, edge: n, distance: 1, shape: 'linear', limit: block });
    close(range(points(be.shapes.get(sheet)), 'x')[1], 20, 1e-6);
    await assert.rejects(be.previewExtendSheet({ body: sheet, edge: n, distance: 1, limit: sheet }), /not itself/);
});

test('outside carries the sheet on through the body, and a sheet already crossing it keeps all of itself', () => {
    const a = square(0, 0);
    const e = edgeWhere(a, p => Math.abs(p.x - 10) < 1e-9);
    const post = primitive({ kind: 'cylinder', frame: { origin: [30, -5, 0], x: [1, 0, 0], normal: [0, 1, 0] }, radius: 8, height: 20 });
    const s = extendSheetTo(a, e, post, 'linear', true);
    const [lo, hi] = range(points(s), 'x');
    close(lo, 0, 1e-9);
    close(hi, 38, 1e-6);
    close(meshArea(s), 380, 1e-6);
    const block = box(new THREE.Vector3(5, -5, -5), new THREE.Vector3(15, 15, 5));
    const m = extendSheetTo(a, e, block, 'linear');
    close(range(points(m), 'x')[1], 15, 1e-6);
    close(meshArea(m), 150, 1e-6);
});
