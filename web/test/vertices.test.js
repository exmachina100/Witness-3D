import assert from 'node:assert/strict';
import { test } from 'node:test';
import { curveVertices, offsetVertex, samples } from '../src/curveEdit.js';

const plane = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0] };
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const closeP = (p, q) => { close(p[0], q[0]); close(p[1], q[1]); };

const square = { ...plane, kind: 'polyline', points: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true };
const vee = { ...plane, kind: 'polyline', points: [[0, 0], [10, 0], [10, 10]], closed: false };
// A slot end: a line out, a half circle round, a line back.
const slot = { ...plane, kind: 'contour', pieces: [
    { kind: 'polyline', points: [[0, 0], [10, 0]], closed: false },
    { kind: 'arc', start: [10, 0], mid: [15, 5], end: [10, 10] },
    { kind: 'polyline', points: [[10, 10], [0, 10]], closed: false }] };

test('vertices are the corners, joints and drawn points of a curve', () => {
    assert.deepEqual(curveVertices(square), [[0, 0], [10, 0], [10, 10], [0, 10]]);
    assert.deepEqual(curveVertices(vee), [[0, 0], [10, 0], [10, 10]]);
    assert.deepEqual(curveVertices(slot), [[0, 0], [10, 0], [10, 10], [0, 10]]);
    assert.deepEqual(curveVertices({ ...plane, kind: 'circle', center: [0, 0], radius: 1 }), []);
});

test('offset vertex adds a vertex either side and keeps the shape', () => {
    const v = offsetVertex(vee, 1, 2);
    assert.deepEqual(v.points, [[0, 0], [8, 0], [10, 0], [10, 2], [10, 10]]);
    // At an open end only one side has curve.
    assert.deepEqual(offsetVertex(vee, 0, 3).points, [[0, 0], [3, 0], [10, 0], [10, 10]]);
    // A closed polyline's first corner works too and the loop stays closed.
    const sq = offsetVertex(square, 0, 1);
    assert.equal(sq.closed, true);
    assert.equal(sq.points.length, 6);
    for (const q of [[0, 1], [0, 0], [1, 0]]) assert.ok(sq.points.some(p => p[0] === q[0] && p[1] === q[1]), `missing ${q}`);
    assert.throws(() => offsetVertex(vee, 1, 10), /runs past the next vertex/);
    assert.throws(() => offsetVertex({ ...plane, kind: 'circle', center: [0, 0], radius: 1 }, 0, 1), /lines, arcs/);
});

test('offset vertex cuts an arc where it meets a line, the arc staying an arc', () => {
    const r = offsetVertex(slot, 1, 2);
    assert.equal(r.kind, 'contour');
    const arcs = r.pieces.filter(p => p.kind === 'arc');
    assert.equal(arcs.length, 2);
    // 2 along the r = 5 half circle from (10, 0): an angle of 2 / 5 from straight down.
    const t = -Math.PI / 2 + 2 / 5;
    closeP(arcs[0].end, [10 + 5 * Math.cos(t), 5 + 5 * Math.sin(t)]);
    closeP(r.pieces[0].points.at(-1), [8, 0]);
    // The outline is the same.
    const before = samples(slot).points, after = samples(r).points;
    closeP(before.at(-1), after.at(-1));
    assert.equal(curveVertices(r).length, 6);
});

test('fillet vertex rounds or chamfers only the picked corners', async () => {
    const { filletCurve } = await import('../src/curveEdit.js');
    const r = filletCurve(square, 2, [1]);
    assert.equal(r.pieces.filter(p => p.kind === 'arc').length, 1);
    const ch = filletCurve(square, 2, [1, 3], true);
    assert.equal(ch.kind, 'polyline');
    assert.equal(ch.closed, true);
    assert.deepEqual(ch.points.length, 6);
    for (const q of [[8, 0], [10, 2], [2, 10], [0, 8]]) assert.ok(ch.points.some(p => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-9), `missing ${q}`);
    assert.throws(() => filletCurve(square, 6, [0, 1], true), /chamfer is too large/);
});
