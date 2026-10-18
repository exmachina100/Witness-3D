import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bridgeContinuous } from '../src/curveEdit.js';

const plane = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0] };
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
// Curvature at the start of a degree 5 Bézier from its first three poles.
const startCurvature = P => {
    const d1 = [P[1][0] - P[0][0], P[1][1] - P[0][1]], d2 = [P[2][0] - P[1][0], P[2][1] - P[1][1]];
    return 4 / 5 * (d1[0] * d2[1] - d1[1] * d2[0]) / Math.hypot(...d1) ** 3;
};

// A quarter circle of radius 10 about the origin, counter-clockwise from (10, 0) to (0, 10), and a line further on.
const arc = { ...plane, kind: 'arc', start: [10, 0], mid: [10 * Math.SQRT1_2, 10 * Math.SQRT1_2], end: [0, 10] };
const line = { ...plane, kind: 'polyline', points: [[-20, 0], [-30, 0]], closed: false };

test('bridge vertex meets each end in position, direction and, with G2, curvature', () => {
    const g2 = bridgeContinuous(arc, 1, line, 0, { continuity: ['G2', 'G2'] });
    assert.equal(g2.kind, 'nurbs'); assert.equal(g2.degree, 5);
    const P = g2.poles;
    assert.deepEqual(P[0].slice(0, 2).map(v => +v.toFixed(9)), [0, 10]);
    assert.deepEqual(P[5].slice(0, 2), [-20, 0]);
    // Leaving the arc's end along its tangent (straight left, -x) with its curvature 1/10.
    close(P[1][1], 10); assert.ok(P[1][0] < 0);
    close(startCurvature(P), 0.1, 1e-3);
    // At the line the bridge arrives straight, along the line (the y of poles 3 and 4 is 0).
    close(P[4][1], 0); close(P[3][1], 0);
    // G1 drops the curvature; G0 just heads for the other end.
    close(startCurvature(bridgeContinuous(arc, 1, line, 0, { continuity: ['G1', 'G1'] }).poles), 0);
    const g0 = bridgeContinuous(arc, 1, line, 0, { continuity: ['G0', 'G0'] }).poles;
    close((g0[1][1] - 10) / (g0[1][0] - 0), (0 - 10) / (-20 - 0));
    assert.throws(() => bridgeContinuous(arc, 1, line, 0, { continuity: ['G4', 'G1'] }), /continuity is/);
});

test('a bridge to a spline matches its curvature with G2', () => {
    // Points on a circle of radius 20 about (0, 30), drawn as a spline through them.
    const pts = Array.from({ length: 7 }, (_, i) => { const t = -Math.PI / 2 + i * 0.1; return [20 * Math.cos(t), 30 + 20 * Math.sin(t)]; });
    const spline = { ...plane, kind: 'spline', points: pts, samples: Array.from({ length: 241 }, (_, i) => { const t = -Math.PI / 2 + i * 0.6 / 240; return [20 * Math.cos(t), 30 + 20 * Math.sin(t)]; }), closed: false };
    const line = { ...plane, kind: 'polyline', points: [[-40, 0], [-20, 0]], closed: false };
    // From the line's end (-20, 0) heading +x, to the spline's start (0, 10) where it heads +x too, curving left at 1/20.
    const r = bridgeContinuous(line, 1, spline, 0, { continuity: ['G2', 'G2'] }).poles;
    const rev = [...r].reverse();
    close(startCurvature(r), 0, 1e-9);
    // Seen from the spline's end, travelling back into the bridge, it turns right at 1/20.
    close(startCurvature(rev), -1 / 20, 2e-3);
});

test('an imported NURBS curve can be bridged', () => {
    // A straight degree 3 NURBS along x, from (0, 0) to (30, 0), and the arc ending at (0, 10).
    const nurbs = { ...plane, kind: 'nurbs', degree: 3, poles: [[0, -5, 0], [10, -5, 0], [20, -5, 0], [30, -5, 0]], weights: [1, 1, 1, 1], knots: [0, 0, 0, 0, 1, 1, 1, 1] };
    const b = bridgeContinuous(arc, 1, nurbs, 0, { continuity: ['G2', 'G2'] });
    assert.deepEqual(b.poles[5].slice(0, 2).map(v => +v.toFixed(6)), [0, -5]);
    close(b.poles[4][1], -5, 1e-6);
});
