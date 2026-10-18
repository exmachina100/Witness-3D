import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convertVertices, curveVertices } from '../src/curveEdit.js';
import { nurbsLoop, nurbsPoints } from '../src/curves.js';

const plane = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0] };
const has = (pts, q, tol = 1e-9) => pts.some(r => Math.hypot(r[0] - q[0], r[1] - q[1]) < tol);

test('a converted corner becomes a control point the curve rounds past', () => {
    const z = { ...plane, kind: 'polyline', points: [[0, 0], [10, 0], [10, 10], [20, 10]], closed: false };
    const c = convertVertices(z, [1]);
    assert.equal(c.kind, 'nurbs');
    const pts = nurbsPoints(c, 32);
    // It still passes through the corners kept and the ends, but not the converted one.
    for (const q of [[0, 0], [10, 10], [20, 10]]) assert.ok(has(pts, q), `through ${q}`);
    assert.ok(!has(pts, [10, 0], 0.5));
    // The last segment is still straight: its points stay on y = 10.
    assert.ok(pts.filter(q => q[0] > 10 + 1e-6).every(q => Math.abs(q[1] - 10) < 1e-9));
    // The converted corner is now a control point of the curve.
    assert.ok(has(curveVertices(c), [10, 0]));
});

test('converting every inner corner gives a control-point curve; closed outlines stay closed', () => {
    const z = { ...plane, kind: 'polyline', points: [[0, 0], [10, 0], [10, 10], [20, 10]], closed: false };
    const all = convertVertices(z, [1, 2]);
    assert.equal(all.kind, 'cv');
    assert.deepEqual(all.points, z.points);
    const sq = { ...plane, kind: 'polyline', points: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true };
    const one = convertVertices(sq, [0, 2]);
    assert.ok(nurbsLoop(one));
    const pts = nurbsPoints(one, 32);
    assert.ok(has(pts, [10, 0]) && has(pts, [0, 10]));
    assert.ok(!has(pts, [0, 0], 0.5) && !has(pts, [10, 10], 0.5));
    const ring = convertVertices(sq, [0, 1, 2, 3]);
    assert.equal(ring.kind, 'cv');
    assert.equal(ring.closed, true);
    assert.throws(() => convertVertices(z, [0]), /ends stay put/);
});

test('three converted corners in a row make one smooth cubic span', () => {
    const w = { ...plane, kind: 'polyline', points: [[0, 0], [5, 8], [10, 0], [15, 8], [20, 0], [30, 0]], closed: false };
    const c = convertVertices(w, [1, 2, 3]);
    assert.equal(c.degree, 3);
    const pts = nurbsPoints(c, 32);
    assert.ok(has(pts, [20, 0]) && has(pts, [30, 0]) && has(pts, [0, 0]));
});
