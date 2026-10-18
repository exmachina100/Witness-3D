// Alternative Duplicate (altDuplicate.js): curves and edges copied flat onto a plane.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { edgeCurve, flattenCurve } from '../src/altDuplicate.js';

const ground = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0] };
const round = a => JSON.parse(JSON.stringify(a, (k, v) => typeof v === 'number' ? +v.toFixed(9) + 0 : v));

test('a curve in a parallel plane keeps its shape, moved down onto the plane', () => {
    const up = { origin: [5, 20, 0], x: [1, 0, 0], normal: [0, 1, 0] };
    const c = flattenCurve({ ...up, kind: 'circle', center: [1, 2], radius: 3 }, ground);
    assert.equal(c.kind, 'circle');
    assert.equal(c.radius, 3);
    // v runs along normal × x = (0,1,0) × (1,0,0) = −z in both planes, so plane coordinates carry over plus the x shift.
    assert.deepEqual(round(c.center), [6, 2]);
    const r = flattenCurve({ ...up, kind: 'polyline', points: [[0, 0], [10, 0], [10, 5]], closed: false }, ground);
    assert.deepEqual(round(r.points), [[5, 0], [15, 0], [15, 5]]);
});

test('edges become lines, circles, arcs or splines', () => {
    // A straight edge rising out of the plane flattens to a line.
    const line = edgeCurve([[0, 0, 0], [5, 5, 0], [10, 10, 0]], ground);
    assert.deepEqual(round(line), { ...ground, kind: 'polyline', points: [[0, 0], [10, 0]], closed: false });
    // A round edge 30 up stays a circle of the same size.
    const ring = Array.from({ length: 33 }, (_, i) => { const t = i / 32 * 2 * Math.PI; return [4 * Math.cos(t), 30, 4 * Math.sin(t)]; });
    const circle = edgeCurve(ring, ground);
    assert.equal(circle.kind, 'circle');
    assert.ok(Math.abs(circle.radius - 4) < 1e-9);
    const half = ring.slice(0, 17);
    assert.equal(edgeCurve(half, ground).kind, 'arc');
    // A wavy edge is a spline through its points.
    const wave = Array.from({ length: 50 }, (_, i) => [i, 0, Math.sin(i / 5)]);
    const s = edgeCurve(wave, ground);
    assert.equal(s.kind, 'spline');
    assert.ok(s.points.length <= 34 && s.points.length >= 17);
    assert.deepEqual(round(s.points.at(-1)), round([49, -Math.sin(49 / 5)]));
});

test('a curve standing up flattens through its points', () => {
    const wall = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] };
    const pts = [[0, 0, 0], [10, 10, 0]];
    const c = flattenCurve({ ...wall, kind: 'polyline', points: [[0, 0], [10, 10]], closed: false }, ground, pts);
    assert.deepEqual(round(c.points), [[0, 0], [10, 0]]);
});
