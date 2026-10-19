// Plasticity's Subdivide on curves (curveEdit.js subdivideCurve): twice the points, the same shape.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asNurbs, subdivideCurve } from '../src/curveEdit.js';
import { nurbsPoints } from '../src/curves.js';

const frame = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] };

test('a rectangle gains a corner in the middle of each side', () => {
    const { curve, added } = subdivideCurve({ ...frame, kind: 'polyline', points: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true });
    assert.equal(curve.points.length, 8);
    assert.deepEqual(added, [1, 3, 5, 7]);
    assert.deepEqual(curve.points[1], [5, 0]);
});

test('a control point curve doubles its spans and keeps its shape', () => {
    const c = { ...frame, kind: 'cv', points: [[0, 0], [5, 8], [10, -3], [15, 6], [20, 0]], closed: false };
    const before = asNurbs(c);
    const { curve, added } = subdivideCurve(c);
    assert.equal(curve.kind, 'nurbs');
    assert.ok(curve.poles.length > before.poles.length);
    assert.ok(added.length > 0 && added.every(i => i > 0 && i < curve.poles.length - 1));
    // Twice the spans at half the samples each: the same parameters, so the same points.
    const a = nurbsPoints(curve, 16), b = nurbsPoints(before, 32);
    assert.equal(a.length, b.length);
    assert.ok(Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1]))) < 1e-9);
});

test('a circle stays round', () => {
    const c = { ...frame, kind: 'circle', center: [0, 0], radius: 5 };
    const { curve } = subdivideCurve(c);
    for (const [x, y] of nurbsPoints(curve)) assert.ok(Math.abs(Math.hypot(x, y) - 5) < 1e-9);
    assert.ok(subdivideCurve(curve).curve.poles.length > curve.poles.length);
});
