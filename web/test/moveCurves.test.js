import assert from 'node:assert/strict';
import { test } from 'node:test';
import { curveVertices, moveVerticesTo, rebuildCurve, transformCurve } from '../src/curveEdit.js';
import { nurbsLoop } from '../src/curves.js';

const plane = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0] };
const near = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${a} vs ${b}`));
// The model point of plane coordinates (u, v): y = normal × x.
const world = (c, [u, v]) => { const n = c.normal, x = c.x, y = [n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]]; return c.origin.map((o, i) => o + x[i] * u + y[i] * v); };

test('moving, turning and scaling a curve moves its plane and scales its shape', () => {
    const sq = { ...plane, origin: [10, 0, 0], kind: 'polyline', points: [[0, 0], [4, 0], [4, 4]], closed: false };
    const moved = transformCurve(sq, { pivot: [0, 0, 0], offset: [1, 2, 3] });
    near(moved.origin, [11, 2, 3]);
    assert.deepEqual(moved.points, sq.points);
    // A quarter turn about model y and twice the size, about the origin.
    const turn = v => [v[2], v[1], -v[0]];
    const t = transformCurve(sq, { pivot: [0, 0, 0], rotate: turn, scale: 2 });
    near(t.origin, [0, 0, -20]);
    near(t.x, [0, 0, -1]);
    assert.deepEqual(t.points, [[0, 0], [8, 0], [8, 8]]);
    near(world(t, t.points[1]), turn(world(sq, sq.points[1]).map(v => 2 * v)));
    const circle = transformCurve({ ...plane, kind: 'circle', center: [1, 1], radius: 3 }, { pivot: [0, 0, 0], scale: 0.5 });
    assert.equal(circle.radius, 1.5);
    assert.deepEqual(circle.center, [0.5, 0.5]);
});

test('vertices move within the curve plane, dropping any move across it', () => {
    const line = { ...plane, kind: 'polyline', points: [[0, 0], [10, 0]], closed: false };
    const y = world(line, [0, 1]); // the plane's own y direction in the model
    const target = [10 + 5 * y[0], 7 + 5 * y[1], 5 * y[2]]; // 7 along the normal is dropped
    const m = moveVerticesTo(line, new Map([[1, target]]));
    near(m.points[1], [10, 5]);
});

test("a NURBS curve's control points are its vertices, and a closed one stays closed", () => {
    const { curve } = rebuildCurve({ ...plane, kind: 'circle', center: [0, 0], radius: 10 }, 8, 3);
    const vs = curveVertices(curve);
    assert.equal(vs.length, curve.poles.length - 1);
    const moved = moveVerticesTo(curve, new Map([[0, world(curve, [vs[0][0] + 3, vs[0][1]])]]));
    assert.ok(nurbsLoop(moved));
    near(moved.poles[0], [vs[0][0] + 3, vs[0][1], 0]);
    near(moved.poles.at(-1), moved.poles[0]);
});
