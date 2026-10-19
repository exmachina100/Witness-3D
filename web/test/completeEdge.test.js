// Plasticity's Complete Edge (curveEdit.js completeCurve): open ends carried on to the next curve.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { completeCurve, samples } from '../src/curveEdit.js';

const frame = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] };
const line = (a, b) => ({ ...frame, kind: 'polyline', points: [a, b], closed: false });
const ends = c => { const p = samples(c).points; return [p[0], p[p.length - 1]]; };
const near = (a, b, e = 1e-6) => Math.hypot(a[0] - b[0], a[1] - b[1]) < e;

test('a line grows both ways to the walls either side', () => {
    const walls = [line([-10, -5], [-10, 5]), line([20, -5], [20, 5])];
    const { curve, grown } = completeCurve(line([0, 0], [5, 0]), walls, 100);
    assert.equal(grown, 2);
    const [a, b] = ends(curve);
    assert.ok(near(a, [-10, 0]) && near(b, [20, 0]), JSON.stringify([a, b]));
});

test('the nearest wall stops it, and an end already touching stays', () => {
    const walls = [line([8, -5], [8, 5]), line([12, -5], [12, 5]), line([0, -5], [0, 5])];
    const { curve, grown } = completeCurve(line([0, 0], [5, 0]), walls, 100);
    assert.equal(grown, 1);
    const [a, b] = ends(curve);
    assert.ok(near(a, [0, 0]) && near(b, [8, 0]), JSON.stringify([a, b]));
});

test('an arc carries on round its circle to a line', () => {
    // A quarter of the circle r = 10 from (10, 0) to (0, 10); a wall along y = -2 on the right.
    const arc = { ...frame, kind: 'arc', start: [10, 0], mid: [Math.SQRT1_2 * 10, Math.SQRT1_2 * 10], end: [0, 10] };
    const { curve, grown } = completeCurve(arc, [line([0, -2], [20, -2])], 100);
    assert.equal(grown, 1);
    const [a] = ends(curve);
    assert.ok(Math.abs(a[1] + 2) < 1e-6 && Math.abs(Math.hypot(...a) - 10) < 1e-6, JSON.stringify(a));
});

test('nothing in reach leaves the curve as it was', () => {
    const c = line([0, 0], [5, 0]);
    assert.equal(completeCurve(c, [line([0, 5], [5, 5])], 100).grown, 0);
    assert.equal(completeCurve(c, [], 100).grown, 0);
});
