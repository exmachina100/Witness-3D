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

test('a block corner is refused but a point inside a rebuilt face moves', () => {
    const b = box({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 });
    assert.throws(() => moveFacePoles(b, [[0, 0, [0, 0, 1]]]), /shared with another face/);
    const faces = facePoles(b);
    const topFace = faces.findIndex(rows => rows.flat().every(p => Math.abs(p[2] - 10) < 1e-9));
    const { shape } = rebuildFaces(b, [topFace], { explicit: true, degree: [3, 3], spans: [3, 3] });
    const rows = facePoles(shape)[topFace];
    const nv = rows[0].length;
    const moved = moveFacePoles(shape, [[topFace, nv + 1, [0, 0, 3]]]);
    assert.ok(top(facePoles(moved)[topFace]) > 12.9);
    assert.ok(volume(moved) > volume(shape) + 1, `${volume(shape)} ${volume(moved)}`);
});

test('bad points are refused', () => {
    const b = primitive({ kind: 'sphere', center: [0, 0, 0], radius: 10 });
    assert.throws(() => moveFacePoles(b, [[0, 9999, [1, 0, 0]]]), /no longer exists/);
    assert.throws(() => moveFacePoles(b, [[3, 0, [1, 0, 0]]]), /no longer exists/);
});
