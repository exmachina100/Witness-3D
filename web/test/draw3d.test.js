// Drawing in 3D: Line, Spline and Control Point Curve points off the drawing plane make NURBS
// curves with heights; flat ones stay the flat kinds.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cv3d, drawnCurve3d, isFlat, polyline3d, spline3d } from '../src/draw3d.js';
import { cvPoints, nurbsPoints } from '../src/curves.js';

const near = (a, b, tol = 1e-9) => Math.hypot(...a.map((v, i) => v - (b[i] ?? 0))) < tol;
/** Distance from q to the curve's samples. */
const gap = (c, q) => Math.min(...nurbsPoints(c, 2000).map(p => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])));

test('flat points keep the flat kinds', () => {
    assert.ok(isFlat([[0, 0], [1, 2, 0]]));
    assert.deepEqual(drawnCurve3d('line', [[0, 0, 0], [5, 0, 0]]), { kind: 'polyline', points: [[0, 0], [5, 0]], closed: false });
    assert.equal(drawnCurve3d('spline', [[0, 0, 0], [5, 0, 0], [5, 5, 0]]).kind, 'spline');
});

test('a line off the plane goes through its corners', () => {
    const pts = [[0, 0, 0], [10, 0, 0], [10, 0, 7]];
    const c = drawnCurve3d('line', pts);
    assert.equal(c.kind, 'nurbs');
    assert.equal(c.degree, 1);
    assert.deepEqual(c.poles, pts);
    for (const q of pts) assert.ok(gap(c, q) < 1e-9);
    const closed = polyline3d(pts, true);
    assert.deepEqual(closed.poles.at(-1), pts[0]);
    assert.equal(closed.knots.length, closed.poles.length + 2);
});

test('a spline off the plane passes through every point', () => {
    const pts = [[0, 0, 0], [10, 0, 2], [10, 10, 5], [0, 10, 3], [-4, 4, 8]];
    const c = spline3d(pts);
    assert.equal(c.degree, 3);
    assert.equal(c.knots.length, c.poles.length + 4);
    assert.ok(near(c.poles[0], pts[0]) && near(c.poles.at(-1), pts.at(-1)));
    for (const q of pts) assert.ok(gap(c, q) < 0.01, `misses ${q}`);
    // Two and three points: a line and a quadratic through them.
    assert.equal(spline3d([[0, 0, 0], [1, 1, 1]]).degree, 1);
    for (const q of [[0, 0, 0], [4, 0, 3], [4, 4, 0]]) assert.ok(gap(spline3d([[0, 0, 0], [4, 0, 3], [4, 4, 0]]), q) < 0.01);
});

test('a closed spline comes back smoothly', () => {
    const pts = [[0, 0, 0], [10, 0, 4], [10, 10, 0], [0, 10, 4]];
    const c = spline3d(pts, true);
    for (const q of pts) assert.ok(gap(c, q) < 0.01);
    assert.ok(near(c.poles[0], c.poles.at(-1)));
    // The tangents leaving and arriving at the seam point the same way.
    const P = c.poles, a = P[1].map((v, i) => v - P[0][i]), b = P.at(-1).map((v, i) => v - P.at(-2)[i]);
    const cos = a.reduce((s, v, i) => s + v * b[i], 0) / Math.hypot(...a) / Math.hypot(...b);
    assert.ok(cos > 1 - 1e-9);
});

test('a control-point curve with heights is the flat one lifted', () => {
    const pts = [[0, 0, 0], [10, 0, 6], [10, 10, -2], [0, 10, 1], [-5, 5, 3]];
    for (const closed of [false, true]) {
        const c = cv3d(pts, closed), flat = cvPoints(pts.map(q => [q[0], q[1]]), closed, 200);
        const lifted = nurbsPoints(c, 100);
        // Every flat point lies under the lifted curve.
        for (const q of flat.filter((_, i) => i % 20 === 0)) assert.ok(Math.min(...lifted.map(p => Math.hypot(p[0] - q[0], p[1] - q[1]))) < 0.02, `${closed} ${q}`);
        assert.ok(lifted.some(p => Math.abs(p[2]) > 1));
    }
    // Open: the curve starts and ends on the end control points, heights included.
    const open = cv3d(pts);
    assert.ok(near(nurbsPoints(open).at(0), pts[0]) && near(nurbsPoints(open).at(-1), pts.at(-1), 1e-6));
});
