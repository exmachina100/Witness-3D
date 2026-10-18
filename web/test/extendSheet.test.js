// Extend Sheet (Plasticity's Extend on a sheet's edge) in the browser build. The desktop's tests
// are crates/w3d-kernel/tests/extend_sheet.rs.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as THREE from 'three';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { count, loadKernel, numberedEdges, oc, tessellate } from '../src/Kernel.js';
import { bridgeSurface } from '../src/BridgeSurface.js';
import { extendSheet } from '../src/ExtendSheet.js';
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
