// Mirror on curves (manual common/mirror): the mirrored copy lies where the reflection puts it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mirrorCurve } from '../src/curveEdit.js';

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** A plane point (u, v[, w]) of `c` in model space, with v along normal × x. */
const world = (c, [u, v, w = 0]) => { const y = cross(c.normal, c.x); return c.origin.map((o, i) => o + u * c.x[i] + v * y[i] + w * c.normal[i]); };
const near = (a, b) => assert.ok(a.every((x, i) => Math.abs(x - b[i]) < 1e-9), `${a} != ${b}`);

test('a line mirrored across x = 0 lands on the other side, the same way round', () => {
    const c = { id: 7, origin: [5, 0, 0], x: [1, 0, 0], normal: [0, 0, 1], kind: 'polyline', points: [[0, 0], [2, 3]], closed: false };
    const m = mirrorCurve(c, [0, 0, 0], [1, 0, 0]);
    near(world(m, m.points[0]), [-5, 0, 0]);
    near(world(m, m.points[1]), [-7, 3, 0]);
    // Across a tilted plane through a point off the origin, too.
    const t = mirrorCurve(c, [0, 1, 0], [0, 1, 0]);
    near(world(t, t.points[1]), [7, -1, 0]);
});

test("a 3D curve's heights flip with it", () => {
    const c = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1], kind: 'nurbs', degree: 1, poles: [[0, 0, 0], [1, 1, 2]], weights: [1, 1], knots: [0, 0, 1, 1] };
    const m = mirrorCurve(c, [0, 0, 0], [1, 0, 0]);
    near(world(m, m.poles[1]), [-1, 1, 2]);
    const z = mirrorCurve(c, [0, 0, 1], [0, 0, 1]);
    near(world(z, z.poles[1]), [1, 1, 0]);
});
