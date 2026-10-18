import assert from 'node:assert/strict';
import { test } from 'node:test';
import { insertKnot, rebuildCurve, samples } from '../src/curveEdit.js';
import { nurbsLoop, nurbsPoints } from '../src/curves.js';

const plane = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0] };
const close = (a, b, tol = 1e-6) => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < tol, `${a} vs ${b}`);

test('rebuild an arc keeps its ends and stays within a hair of it', () => {
    const arc = { ...plane, kind: 'arc', start: [10, 0], mid: [0, 10], end: [-10, 0] };
    const { curve, deviation } = rebuildCurve(arc, 8, 3);
    assert.equal(curve.kind, 'nurbs');
    assert.equal(curve.poles.length, 8);
    assert.equal(curve.knots.length, 8 + 3 + 1);
    close(curve.poles[0], [10, 0]);
    close(curve.poles.at(-1), [-10, 0]);
    assert.ok(deviation < 0.01, `deviation ${deviation}`);
    assert.deepEqual(curve.origin, [0, 0, 0]);
});

test('fewer control points means a looser fit, and a line rebuilds exactly', () => {
    const wave = { ...plane, kind: 'spline', points: [[0, 0], [10, 6], [20, -6], [30, 6], [40, 0]], closed: false };
    const loose = rebuildCurve(wave, 4, 3).deviation, tight = rebuildCurve(wave, 16, 3).deviation;
    assert.ok(tight < loose, `${tight} < ${loose}`);
    const line = { ...plane, kind: 'polyline', points: [[0, 0], [30, 10]], closed: false };
    assert.ok(rebuildCurve(line, 5, 2).deviation < 1e-9);
    assert.throws(() => rebuildCurve(line, 3, 3), /at least 4/);
});

test('a closed curve rebuilds closed and smooth through its seam', () => {
    const circle = { ...plane, kind: 'circle', center: [0, 0], radius: 10 };
    const { curve, deviation } = rebuildCurve(circle, 8, 3);
    assert.ok(nurbsLoop(curve), 'closed');
    assert.ok(deviation < 0.05, `deviation ${deviation}`);
    const pts = nurbsPoints(curve, 32);
    // Every point sits on the circle, seam included, and the seam has no kink.
    for (const q of pts) assert.ok(Math.abs(Math.hypot(q[0], q[1]) - 10) < 0.05);
    const d0 = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]], d1 = [pts.at(-1)[0] - pts.at(-2)[0], pts.at(-1)[1] - pts.at(-2)[1]];
    const ang = Math.acos((d0[0] * d1[0] + d0[1] * d1[1]) / Math.hypot(...d0) / Math.hypot(...d1)) * 180 / Math.PI;
    assert.ok(ang < 3, `seam angle ${ang}`);
    const sq = { ...plane, kind: 'polyline', points: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true };
    assert.ok(samples(rebuildCurve(sq, 12, 3).curve).closed);
});

test('inserting a knot adds a control point and keeps the curve', () => {
    const c = { ...plane, kind: 'nurbs', degree: 3, poles: [[0, 0, 0], [5, 8, 0], [12, -3, 0], [20, 4, 0], [25, 0, 0]], weights: [1, 2, 1, 1, 1], knots: [0, 0, 0, 0, 0.3, 1, 1, 1, 1] };
    const d = insertKnot(c, 0.6);
    assert.equal(d.poles.length, 6);
    assert.deepEqual(d.knots, [0, 0, 0, 0, 0.3, 0.6, 1, 1, 1, 1]);
    const a = nurbsPoints(c, 2000), b = nurbsPoints(d, 20);
    for (const q of b) assert.ok(Math.min(...a.map(r => Math.hypot(r[0] - q[0], r[1] - q[1]))) < 0.005);
});

test('a NURBS curve rebuilt with its own count and degree comes back unchanged', () => {
    const c = { ...plane, kind: 'nurbs', degree: 3, poles: [[0, 0, 0], [5, 8, 0], [12, -3, 0], [20, 4, 0]], weights: [1, 1, 1, 1], knots: [0, 0, 0, 0, 1, 1, 1, 1] };
    const { curve, deviation } = rebuildCurve(c, 4, 3);
    assert.ok(deviation < 1e-6, `deviation ${deviation}`);
    curve.poles.forEach((q, i) => close(q, c.poles[i]));
});
