// Moving a face's control points in the browser build (movePoles.js).
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { box, loadKernel, primitive, volume } from '../src/Kernel.js';
import { facePoles } from '../src/facePoles.js';
import { moveFacePoles } from '../src/movePoles.js';
import { rebuildFaces } from '../src/rebuildFace.js';
import { LocalBackend } from '../src/app/LocalBackend.js';

before(async () => { await loadKernel() });

const top = rows => Math.max(...rows.flat().map(p => p[2]));

test('a flat sheet corner lifts, its edges with it', async () => {
    const be = new LocalBackend();
    const { ids } = await be.addCurves([{ kind: 'polyline', origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1], points: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true }]);
    const { id } = await be.commitPatch({ curves: ids });
    const shape = be.shapes.get(id);
    const rows = facePoles(shape)[0];
    const n = rows.flat().findIndex(p => Math.hypot(p[0] - 10, p[1] - 10, p[2]) < 1e-6);
    assert.ok(n >= 0, JSON.stringify(rows));
    const moved = moveFacePoles(shape, [[0, n, [0, 0, 5]]]);
    assert.ok(Math.abs(top(facePoles(moved)[0]) - 5) < 1e-9);
});

test('a block corner moves in every face meeting there', () => {
    const b = box({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 });
    const faces = facePoles(b);
    const n = faces.findIndex(rows => rows.flat().every(p => Math.abs(p[2] - 10) < 1e-9));
    const k = faces[n].flat().findIndex(p => p[0] === 10 && p[1] === 10);
    const moved = moveFacePoles(b, [[n, k, [0, 0, 5]]]);
    assert.ok(Math.abs(Math.max(...facePoles(moved).map(top)) - 15) < 1e-6);
    // The top and two sides become twisted (bilinear) faces: the top is z = 10 + 5 (x/10)(y/10).
    assert.ok(Math.abs(volume(moved) - 1125) < 1e-6, `${volume(moved)}`);
});

test('a point inside a rebuilt face moves', () => {
    const b = box({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 });
    const faces = facePoles(b);
    const topFace = faces.findIndex(rows => rows.flat().every(p => Math.abs(p[2] - 10) < 1e-9));
    const { shape } = rebuildFaces(b, [topFace], { explicit: true, degree: [3, 3], spans: [3, 3] });
    const rows = facePoles(shape)[topFace];
    const nv = rows[0].length;
    const moved = moveFacePoles(shape, [[topFace, nv + 1, [0, 0, 3]]]);
    // Sewing the face back may renumber the faces.
    assert.ok(Math.max(...facePoles(moved).map(top)) > 12.9);
    assert.ok(volume(moved) > volume(shape) + 1, `${volume(shape)} ${volume(moved)}`);
});

test("a point on a cylinder's rim moves, its flat end following", () => {
    const c = primitive({ kind: 'cylinder', frame: { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] }, radius: 10, height: 20 });
    const side = facePoles(c).findIndex(rows => rows.length > 2);
    const k = facePoles(c)[side].flat().findIndex(p => Math.abs(p[2] - 20) < 1e-6);
    const moved = moveFacePoles(c, [[side, k, [0, 0, 5]]]);
    assert.ok(Math.max(...facePoles(moved).map(top)) > 24.9);
    // Lifting the rim at one point adds a bump to the end: more volume, not much more.
    const v = volume(moved);
    assert.ok(v > volume(c) + 20 && v < volume(c) + 500, `${volume(c)} ${v}`);
});

test("a point in the middle of a rebuilt face's edge moves, the side beside it following", () => {
    const b = box({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 });
    const topFace = facePoles(b).findIndex(rows => rows.flat().every(p => Math.abs(p[2] - 10) < 1e-9));
    const { shape } = rebuildFaces(b, [topFace], { explicit: true, degree: [3, 3], spans: [3, 3] });
    const net = facePoles(shape)[topFace].flat();
    // A pole on the top's y = 0 edge, away from the corners.
    const k = net.findIndex(p => Math.abs(p[1]) < 1e-9 && p[0] > 2 && p[0] < 8);
    assert.ok(k >= 0);
    const moved = moveFacePoles(shape, [[topFace, k, [0, 0, 3]]]);
    assert.ok(Math.max(...facePoles(moved).map(top)) > 12.9);
    assert.ok(volume(moved) > volume(shape) + 1, `${volume(shape)} ${volume(moved)}`);
});

test('bad points are refused', () => {
    const b = primitive({ kind: 'sphere', center: [0, 0, 0], radius: 10 });
    assert.throws(() => moveFacePoles(b, [[0, 9999, [1, 0, 0]]]), /no longer exists/);
    assert.throws(() => moveFacePoles(b, [[3, 0, [1, 0, 0]]]), /no longer exists/);
});

test('subdividing a face doubles its spans and keeps the block', async () => {
    const { subdivideFaces } = await import('../src/movePoles.js');
    const b = box({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 });
    // Sewing the face back may renumber the faces: find it by its net.
    const sizes = s => facePoles(s).map(r => `${r.length}x${r[0].length}`);
    const once = subdivideFaces(b, [0]);
    assert.deepEqual(sizes(once).sort(), ['2x2', '2x2', '2x2', '2x2', '2x2', '3x3']);
    const twice = subdivideFaces(once, [sizes(once).indexOf('3x3')]);
    assert.ok(sizes(twice).includes('5x5'), sizes(twice).join(' '));
    assert.ok(Math.abs(volume(twice) - 1000) < 0.01, `${volume(twice)}`);
});
