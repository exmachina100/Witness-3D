// Plasticity's Extend Curve shapes: Natural, Linear, Arc, Soft and Reflective.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXTEND_SHAPES, extendCurve, samples } from '../src/curveEdit.js';

const lengthOf = pts => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
const ptsOf = c => c.kind === 'contour' ? c.pieces.flatMap((p, i) => samples(p, 192).points.slice(i ? 1 : 0)) : samples(c, 192).points;
const near = (a, b, tol = 1e-6) => Math.hypot(a[0] - b[0], a[1] - b[1]) < tol;
// A quarter circle drawn as a spline (curvature 1/10), from (10, 0) round to (0, 10).
const quarter = { kind: 'spline', points: Array.from({ length: 129 }, (_, i) => [10 * Math.cos(i * Math.PI / 256), 10 * Math.sin(i * Math.PI / 256)]), closed: false };

test('every shape is offered', () => assert.deepEqual(EXTEND_SHAPES, ['natural', 'linear', 'arc', 'soft', 'reflective']));

test('Linear goes straight along the end; Arc goes round its circle', () => {
    const lin = extendCurve(quarter, 1, 5, 'linear'), end = lin.pieces.at(-1);
    assert.equal(end.kind, 'polyline');
    assert.ok(Math.abs(end.points[1][0] - end.points[0][0] + 5) < 0.05, 'heads along -x');
    const arc = extendCurve(quarter, 1, 5, 'arc').pieces.at(-1);
    assert.equal(arc.kind, 'arc');
    for (const p of [arc.start, arc.mid, arc.end]) assert.ok(Math.abs(Math.hypot(...p) - 10) < 0.05, `on the circle: ${p}`);
});

test('Natural carries the bend on; Soft eases out straighter', () => {
    const nat = extendCurve(quarter, 1, 5, 'natural').pieces.at(-1), soft = extendCurve(quarter, 1, 5, 'soft').pieces.at(-1);
    assert.equal(nat.kind, 'spline');
    // Natural stays near the circle (its curvature barely changes); Soft ends farther out.
    const rN = Math.hypot(...nat.points.at(-1)), rS = Math.hypot(...soft.points.at(-1));
    assert.ok(Math.abs(rN - 10) < 0.1, `natural ${rN}`);
    assert.ok(rS > rN + 0.1, `soft ${rS}`);
    assert.ok(Math.abs(lengthOf(soft.points) - 5) < 0.01);
    // Both leave along the end tangent.
    const d = soft.points[1].map((v, i) => v - soft.points[0][i]);
    assert.ok(d[0] < 0 && Math.abs(d[1]) < Math.abs(d[0]) * 0.1);
});

test('Reflective mirrors the end through the end point', () => {
    const ref = extendCurve(quarter, 1, 5, 'reflective').pieces.at(-1);
    const e = [0, 10];
    assert.ok(near(ref.points[0], e, 1e-6));
    // Each point is a point of the curve turned through the end: 2e - p lies on the circle.
    for (const p of ref.points) assert.ok(Math.abs(Math.hypot(2 * e[0] - p[0], 2 * e[1] - p[1]) - 10) < 0.05);
    assert.ok(Math.abs(lengthOf(ref.points) - 5) < 0.05);
    assert.throws(() => extendCurve(quarter, 1, 50, 'reflective'), /shorter/);
    // A bent line: the corner mirrors too.
    const l = { kind: 'polyline', points: [[0, 0], [10, 0], [10, 10]], closed: false };
    assert.deepEqual(extendCurve(l, 1, 15, 'reflective').points, [[0, 0], [10, 0], [10, 20], [15, 20]]);
    assert.deepEqual(extendCurve(l, 1, 4, 'reflective').points, [[0, 0], [10, 0], [10, 14]]);
});

test('the start extends too', () => {
    const out = extendCurve(quarter, 0, 3, 'soft');
    assert.ok(near(ptsOf(out).at(-1), quarter.points.at(-1)));
    assert.ok(Math.abs(lengthOf(ptsOf(out)) - (lengthOf(quarter.points) + 3)) < 0.2);
});
