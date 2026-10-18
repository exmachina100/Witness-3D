import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asNurbs, insertKnotAt, raiseDegree, samples } from '../src/curveEdit.js';
import { nurbsLoop, nurbsPoints } from '../src/curves.js';

const plane = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0] };
/** How far `q` lies from the polyline `pts`. */
const off = (pts, q) => Math.min(...pts.slice(1).map((b, i) => {
    const a = pts[i], d = [b[0] - a[0], b[1] - a[1]], l2 = d[0] ** 2 + d[1] ** 2;
    const s = l2 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * d[0] + (q[1] - a[1]) * d[1]) / l2)) : 0;
    return Math.hypot(a[0] + d[0] * s - q[0], a[1] + d[1] * s - q[1]);
}));
/** The furthest any point of `b` lies from the densely sampled curve `a`. */
const apart = (a, b) => { const A = nurbsPoints(asNurbs(a), 2000); return Math.max(...nurbsPoints(b, 24).map(q => off(A, q))); };

test('lines, arcs, circles and control-point curves convert to NURBS without changing shape', () => {
    const circle = asNurbs({ ...plane, kind: 'circle', center: [1, 2], radius: 5 });
    assert.ok(nurbsLoop(circle));
    for (const q of nurbsPoints(circle, 16)) assert.ok(Math.abs(Math.hypot(q[0] - 1, q[1] - 2) - 5) < 1e-9);
    const arc = asNurbs({ ...plane, kind: 'arc', start: [10, 0], mid: [0, 10], end: [-10, 0] });
    for (const q of nurbsPoints(arc, 16)) assert.ok(Math.abs(Math.hypot(q[0], q[1]) - 10) < 1e-9);
    const cv = { ...plane, kind: 'cv', points: [[0, 0], [5, 8], [12, -3], [20, 4], [25, 0]], closed: false };
    const b = nurbsPoints(asNurbs(cv), 2000);
    for (const q of samples(cv, 64).points) assert.ok(off(b, q) < 1e-5);
    const ring = asNurbs({ ...cv, closed: true });
    assert.ok(nurbsLoop(ring));
    assert.throws(() => asNurbs({ ...plane, kind: 'ellipse', center: [0, 0], major: [5, 0], minor: 2 }), /Rebuild Curve/);
});

test('insert knot adds one control point where clicked and keeps the curve', () => {
    const arc = { ...plane, kind: 'arc', start: [10, 0], mid: [0, 10], end: [-10, 0] };
    const before = asNurbs(arc), after = insertKnotAt(arc, [7, 7]);
    assert.equal(after.poles.length, before.poles.length + 1);
    assert.ok(apart(arc, after) < 1e-6);
    // The new knot sits at 45 degrees, where (7, 7) is nearest.
    const added = after.knots.find(k => !before.knots.includes(k));
    assert.ok(added > 0 && added < 1);
    assert.throws(() => insertKnotAt(arc, [10, 0]), /end/);
});

test('raise degree keeps the curve and adds control points', () => {
    const line = { ...plane, kind: 'polyline', points: [[0, 0], [10, 0], [10, 10]], closed: false };
    const l2 = raiseDegree(line);
    assert.equal(l2.degree, 2);
    assert.ok(apart(line, l2) < 1e-6);
    const circle = { ...plane, kind: 'circle', center: [0, 0], radius: 5 };
    const c3 = raiseDegree(circle);
    assert.equal(c3.degree, 3);
    assert.ok(nurbsLoop(c3));
    for (const q of nurbsPoints(c3, 16)) assert.ok(Math.abs(Math.hypot(q[0], q[1]) - 5) < 1e-6);
    const cv = { ...plane, kind: 'cv', points: [[0, 0], [5, 8], [12, -3], [20, 4], [25, 0]], closed: false };
    const c4 = raiseDegree(cv);
    assert.equal(c4.degree, 4);
    assert.equal(c4.poles.length, 7);
    assert.ok(apart(cv, c4) < 1e-5);
});
