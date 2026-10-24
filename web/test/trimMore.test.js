// Trim of ellipses, control-point and NURBS curves (exact, by knot insertion), splines and joined curves.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { samples, trim, distanceTo } from '../src/curveEdit.js';
import { nurbsPoints } from '../src/curves.js';

const plane = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0] };
const line = (a, b) => ({ ...plane, kind: 'polyline', closed: false, points: [a, b] });
const ends = c => { const p = samples(c).points; return [p[0], p[p.length - 1]]; };
const near = (a, b, eps = 1e-6) => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < eps, `${a} != ${b}`);
/** Every point of `piece` lies on `whole`. */
function onCurve(piece, whole, eps = 1e-6) {
    const pts = piece.kind === 'nurbs' ? nurbsPoints(piece) : samples(piece).points;
    const ref = samples(whole, 20000).points;
    const off = p => Math.min(...ref.map(q => Math.hypot(p[0] - q[0], p[1] - q[1])));
    for (const p of pts) assert.ok(off(p) < eps, `${p} is ${off(p)} off`);
}

test('an ellipse cut across keeps the half away from the click, exactly', () => {
    const e = { ...plane, kind: 'ellipse', center: [0, 0], major: [6, 0], minor: 3 };
    const kept = trim(e, [line([-10, 0.5], [10, 0.5])], [0, -3]);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].kind, 'nurbs');
    const pts = nurbsPoints(kept[0]);
    // It lies on the ellipse, above the cut, from one crossing to the other.
    for (const [x, y] of pts) { assert.ok(Math.abs((x / 6) ** 2 + (y / 3) ** 2 - 1) < 1e-9, `${x},${y}`); assert.ok(y > 0.5 - 1e-9); }
    const xc = 6 * Math.sqrt(1 - (0.5 / 3) ** 2);
    const [a, b] = [pts[0], pts[pts.length - 1]];
    assert.ok(Math.abs(Math.abs(a[0]) - xc) < 1e-7 && Math.abs(a[1] - 0.5) < 1e-7, `${a}`);
    assert.ok(Math.abs(Math.abs(b[0]) - xc) < 1e-7 && Math.abs(a[0] + b[0]) < 1e-7, `${b}`);
});

test('a control-point curve is cut where a line crosses it and keeps its shape', () => {
    const cv = { ...plane, kind: 'cv', closed: false, points: [[0, 0], [3, 4], [6, -2], [10, 3], [14, 0]] };
    const kept = trim(cv, [line([5, -10], [5, 10])], [12, 1]);
    assert.equal(kept.length, 1);
    onCurve(kept[0], cv, 1e-3);
    const pts = nurbsPoints(kept[0]);
    near(pts[0], [0, 0]);
    assert.ok(Math.abs(pts[pts.length - 1][0] - 5) < 1e-7, `${pts[pts.length - 1]}`);
    // Two crossings: the middle goes.
    const two = trim(cv, [line([4, -10], [4, 10]), line([9, -10], [9, 10])], [6, -1]);
    assert.equal(two.length, 2);
    for (const k of two) onCurve(k, cv, 1e-3);
});

test('a closed control-point curve opens between the crossings around the click', () => {
    const cv = { ...plane, kind: 'cv', closed: true, points: [[0, 0], [8, -1], [10, 6], [2, 8], [-3, 4]] };
    const kept = trim(cv, [line([-10, 3], [20, 3])], [4, 7]);
    assert.equal(kept.length, 1);
    onCurve(kept[0], cv, 1e-3);
    for (const [, y] of nurbsPoints(kept[0])) assert.ok(y < 3 + 1e-7);
});

test('a spline is cut at the crossing, its ends on the cutter', () => {
    const sp = { ...plane, kind: 'spline', closed: false, points: [[0, 0], [4, 3], [8, 0], [12, 3]] };
    const kept = trim(sp, [line([6, -10], [6, 10])], [11, 2.5]);
    assert.equal(kept.length, 1);
    const [a, b] = ends(kept[0]);
    near(a, [0, 0]);
    assert.ok(Math.abs(b[0] - 6) < 1e-6);
    assert.ok(kept[0].points.some(p => p[0] === 4 && p[1] === 3), 'its own through-point stays');
});

test('a joined curve is trimmed across its pieces', () => {
    // A line then a half circle, open.
    const contour = { ...plane, kind: 'contour', pieces: [{ kind: 'polyline', points: [[-10, 0], [0, 0]], closed: false }, { kind: 'arc', start: [0, 0], mid: [5, 5], end: [10, 0] }] };
    const kept = trim(contour, [line([-5, -1], [-5, 1]), line([8, -10], [8, 10])], [2, 4]);
    assert.equal(kept.length, 2);
    const left = kept.find(k => k.kind === 'polyline'), right = kept.find(k => k.kind === 'arc');
    near(left.points[0], [-10, 0]); near(left.points[1], [-5, 0]);
    assert.ok(Math.abs(right.start[0] - 8) < 1e-6 && Math.abs(right.end[0] - 10) < 1e-9);
    // Keeping a stretch that spans the join gives a contour of two pieces.
    const span = trim(contour, [line([-5, -1], [-5, 1]), line([8, -10], [8, 10])], [-8, 0]);
    const joined = span.find(k => k.kind === 'contour');
    assert.equal(joined.pieces.length, 2);
    near(joined.pieces[0].points[0], [-5, 0]);
    assert.ok(Math.abs(joined.pieces[1].end[0] - 8) < 1e-6);
});
