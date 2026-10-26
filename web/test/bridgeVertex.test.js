import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bridgeContinuous, bridgeEnd } from '../src/curveEdit.js';

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

test('G3 also matches how the curvature changes: none off an arc', () => {
    const b = bridgeContinuous(arc, 1, line, 0, { continuity: ['G3', 'G1'] });
    assert.equal(b.degree, 7); assert.equal(b.poles.length, 8); assert.equal(b.knots.length, 16);
    // Curvature along the Bézier by de Casteljau derivatives.
    const P = b.poles, n = 7;
    const at = (Q, u) => { let R = Q.map(q => [...q]); while (R.length > 1) R = R.slice(1).map((q, i) => q.map((v, j) => (1 - u) * R[i][j] + u * v)); return R[0]; };
    const D1 = P.slice(1).map((q, i) => q.map((v, j) => n * (v - P[i][j])));
    const D2 = D1.slice(1).map((q, i) => q.map((v, j) => (n - 1) * (v - D1[i][j])));
    const kappa = u => { const a = at(D1, u), c = at(D2, u); return (a[0] * c[1] - a[1] * c[0]) / Math.hypot(a[0], a[1]) ** 3; };
    const h = 1e-4, ds = Math.hypot(...at(D1, 0).slice(0, 2)) * h;
    close(kappa(0), 0.1, 1e-9);
    close((kappa(h) - kappa(0)) / ds, 0, 1e-4);
    // G2 alone leaves the curvature changing there.
    const g2 = bridgeContinuous(arc, 1, line, 0, { continuity: ['G2', 'G1'] }).poles;
    const E1 = g2.slice(1).map((q, i) => q.map((v, j) => 5 * (v - g2[i][j]))), E2 = E1.slice(1).map((q, i) => q.map((v, j) => 4 * (v - E1[i][j])));
    const k5 = u => { const a = at(E1, u), c = at(E2, u); return (a[0] * c[1] - a[1] * c[0]) / Math.hypot(a[0], a[1]) ** 3; };
    assert.ok(Math.abs((k5(h) - k5(0)) / (Math.hypot(...at(E1, 0).slice(0, 2)) * h)) > 1e-3);
});

test('per-end G1, G2 and G3 tensions move their own poles and keep each end\'s continuity', () => {
    const base = bridgeContinuous(arc, 1, line, 0, { continuity: ['G3', 'G3'] }).poles;
    const at = (Q, u) => { let R = Q.map(q => [...q]); while (R.length > 1) R = R.slice(1).map((q, i) => q.map((v, j) => (1 - u) * R[i][j] + u * v)); return R[0]; };
    const kappaAt = (P, u) => {
        const n = P.length - 1, D1 = P.slice(1).map((q, i) => q.map((v, j) => n * (v - P[i][j]))), D2 = D1.slice(1).map((q, i) => q.map((v, j) => (n - 1) * (v - D1[i][j])));
        const a = at(D1, u), c = at(D2, u);
        return { k: (a[0] * c[1] - a[1] * c[0]) / Math.hypot(a[0], a[1]) ** 3, speed: Math.hypot(a[0], a[1]) };
    };
    const rate = P => { const h = 1e-4, a = kappaAt(P, 0), b = kappaAt(P, h); return (b.k - a.k) / (a.speed * h); };
    const same = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-9;
    // G1 tension at the start only: the start's first poles move out, the end's stay.
    const t1 = bridgeContinuous(arc, 1, line, 0, { continuity: ['G3', 'G3'], tension: [1.6, 1] }).poles;
    assert.ok(!same(t1[1], base[1]) && same(t1[6], base[6]) && same(t1[5], base[5]));
    close(kappaAt(t1, 0).k, 0.1, 1e-9);
    close(rate(t1), 0, 2e-4);
    // G2 tension: the first pole stays, the second and third move, curvature and its change kept.
    const t2 = bridgeContinuous(arc, 1, line, 0, { continuity: ['G3', 'G3'], tension2: [2, 1] }).poles;
    assert.ok(same(t2[1], base[1]) && !same(t2[2], base[2]) && !same(t2[3], base[3]));
    close(kappaAt(t2, 0).k, 0.1, 1e-9);
    close(rate(t2), 0, 2e-4);
    // G3 tension: only the third pole moves.
    const t3 = bridgeContinuous(arc, 1, line, 0, { continuity: ['G3', 'G3'], tension3: [0.4, 1] }).poles;
    assert.ok(same(t3[1], base[1]) && same(t3[2], base[2]) && !same(t3[3], base[3]));
    close(rate(t3), 0, 2e-4);
    assert.throws(() => bridgeContinuous(arc, 1, line, 0, { tension2: [1, 0] }), /tension/);
});

test('a parameter moves the bridge point along each curve, and trim keeps the curve up to it', () => {
    // Halfway round the arc (at 45°) and a quarter of the way along the line from its start.
    const { kept, beyond } = bridgeEnd(arc, 1, 0.5);
    close(kept.end[0], 10 * Math.SQRT1_2, 1e-9); close(kept.end[1], 10 * Math.SQRT1_2, 1e-9);
    close(kept.start[0], 10); close(kept.start[1], 0); close(beyond.end[0], 0); close(beyond.end[1], 10);
    const P = bridgeContinuous(arc, 1, line, 0, { continuity: ['G2', 'G1'], at: [0.5, 0.25] }).poles;
    close(P[0][0], 10 * Math.SQRT1_2); close(P[0][1], 10 * Math.SQRT1_2);
    close(P[5][0], -22.5); close(P[5][1], 0);
    // It leaves the arc along its tangent there (up and to the left), with the arc's curvature.
    close((P[1][1] - P[0][1]) / (P[1][0] - P[0][0]), -1);
    assert.ok(P[1][0] < P[0][0]);
    close(startCurvature(P), 0.1, 1e-3);
    // From the line's start side the part kept runs from its far end back to the point.
    const l = bridgeEnd(line, 0, 0.25);
    assert.deepEqual(l.kept.points, [[-22.5, 0], [-30, 0]]); assert.deepEqual(l.beyond.points, [[-20, 0], [-22.5, 0]]);
    // At its own end nothing is trimmed; the far end and outside 0 to 1 are refused.
    assert.equal(bridgeEnd(arc, 1, 1).beyond, null);
    assert.throws(() => bridgeEnd(arc, 1, 0), /other end/);
    assert.throws(() => bridgeEnd(arc, 1, 1.5), /0 to 1/);
});

test("X, Y or Z constrains the bridge's ends to that axis, in the curve's plane", () => {
    // The curves lie in the model's xz plane, so model x runs along the plane's own x.
    const b = bridgeContinuous(arc, 1, line, 0, { continuity: ['G1', 'G1'], axis: [1, 0, 0] });
    const P = b.poles;
    close(P[1][1], 10); close(P[4][1], 0);
    assert.ok(P[1][0] < 0 && P[4][0] > -20, `${P[1]} ${P[4]}`);
    // Model y is square to that plane, so no bridge can leave along it.
    assert.throws(() => bridgeContinuous(arc, 1, line, 0, { axis: [0, 1, 0] }), /square to the curve's plane/);
});
