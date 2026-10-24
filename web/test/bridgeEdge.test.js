import test from 'node:test';
import assert from 'node:assert/strict';
import { edgePoint, bridgePoles, bridgeCurve } from '../src/bridgeEdge.js';

// A comb as Toggle Surface Curvature gives it, for a curve p(t) on t in [0, 1].
function comb(p, n = 1000) {
    return Array.from({ length: n + 1 }, (_, i) => {
        const t = i / n, h = 1e-5;
        const d1 = p(t + h).map((v, j) => (v - p(t - h)[j]) / (2 * h));
        const d2 = p(t + h).map((v, j) => (v - 2 * p(t)[j] + p(t - h)[j]) / (h * h));
        const b = [d1[1] * d2[2] - d1[2] * d2[1], d1[2] * d2[0] - d1[0] * d2[2], d1[0] * d2[1] - d1[1] * d2[0]];
        const s = Math.hypot(...d1), bm = Math.hypot(...b);
        if (bm < 1e-9 * s ** 3) return { at: p(t), dir: [0, 0, 0], k: 0 };
        const away = [d1[1] * b[2] - d1[2] * b[1], d1[2] * b[0] - d1[0] * b[2], d1[0] * b[1] - d1[1] * b[0]], m = Math.hypot(...away);
        return { at: p(t), dir: away.map(v => v / m), k: bm / s ** 3 };
    });
}
const bez = (P, t) => {
    // de Casteljau, plus first and second derivatives at t.
    const n = P.length - 1;
    const at = (Q, u) => { let R = Q.map(q => [...q]); while (R.length > 1) R = R.slice(1).map((q, i) => q.map((v, j) => (1 - u) * R[i][j] + u * v)); return R[0]; };
    const D1 = P.slice(1).map((q, i) => q.map((v, j) => n * (v - P[i][j])));
    const D2 = D1.slice(1).map((q, i) => q.map((v, j) => (n - 1) * (v - D1[i][j])));
    return { p: at(P, t), d1: at(D1, t), d2: at(D2, t) };
};
const curvature = ({ d1, d2 }) => {
    const b = [d1[1] * d2[2] - d1[2] * d2[1], d1[2] * d2[0] - d1[0] * d2[2], d1[0] * d2[1] - d1[1] * d2[0]];
    return Math.hypot(...b) / Math.hypot(...d1) ** 3;
};
const angle = (a, b) => Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / Math.hypot(...a) / Math.hypot(...b))) * 180 / Math.PI;

const arc = (c, r, a0, a1, z = 0) => t => { const a = a0 + (a1 - a0) * t; return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a), z]; };

test('an edge point knows where it is, its direction and its bend', () => {
    const e = edgePoint(comb(arc([0, 0], 10, 0, Math.PI / 2)), 0.5);
    assert.ok(Math.hypot(e.at[0] - 10 * Math.SQRT1_2, e.at[1] - 10 * Math.SQRT1_2) < 1e-9);
    assert.ok(angle(e.along, [-1, 1, 0]) < 0.01);
    assert.ok(Math.abs(e.k - 0.1) < 1e-4);
    assert.ok(Math.hypot(e.centre[0] + Math.SQRT1_2, e.centre[1] + Math.SQRT1_2) < 1e-6);
    assert.equal(e.end, null);
    assert.equal(edgePoint(comb(arc([0, 0], 10, 0, 1)), 1).end, 1);
});

test('G1 off two straight edges carries each on, within 0.01 degrees', () => {
    const A = edgePoint(comb(t => [t * 10, 0, 0]), 1), B = edgePoint(comb(t => [30, 5 + t * 10, 8]), 0);
    const P = bridgePoles(A, B, { continuity: ['G1', 'G1'] });
    assert.deepEqual(P[0], [10, 0, 0]);
    assert.ok(Math.hypot(...P[5].map((v, i) => v - [30, 5, 8][i])) < 1e-9);
    assert.ok(angle(bez(P, 0).d1, [1, 0, 0]) < 0.01);
    assert.ok(angle(bez(P, 1).d1, [0, 1, 0]) < 0.01);
    // It leaves the first along +x and arrives travelling +y (against the second edge's start).
    assert.ok(bez(P, 0).d1[0] > 0 && bez(P, 1).d1[1] > 0);
});

test('G2 off two arcs matches their curvature at both ends', () => {
    const A = edgePoint(comb(arc([0, 0], 10, 0, Math.PI / 2)), 1);
    const B = edgePoint(comb(arc([40, 0], 5, Math.PI, Math.PI / 2, 3)), 1);
    const P = bridgePoles(A, B, { continuity: ['G2', 'G2'], tension: 1.3 });
    const s = bez(P, 0), e = bez(P, 1);
    assert.ok(Math.abs(curvature(s) - 0.1) < 1e-3, `${curvature(s)}`);
    assert.ok(Math.abs(curvature(e) - 0.2) < 2e-3, `${curvature(e)}`);
    assert.ok(angle(s.d1, [-1, 0, 0]) < 0.01 && angle(e.d1, [1, 0, 0]) < 0.01);
    // G1 leaves the bend off: no curvature at the ends.
    const G1 = bridgePoles(A, B, { continuity: ['G1', 'G0'] });
    assert.ok(curvature(bez(G1, 0)) < 1e-9);
});

test('from inside an edge the bridge heads for the other point', () => {
    const A = edgePoint(comb(t => [t * 10, 0, 0]), 0.5), B = edgePoint(comb(t => [-20, 5, t * 4]), 0.5);
    const P = bridgePoles(A, B);
    assert.ok(P[1][0] < P[0][0]);
});

test('the bridge curve is exact and flat when the bridge is', () => {
    const A = edgePoint(comb(t => [t * 10, 0, 0]), 1), B = edgePoint(comb(t => [30, 5 + t * 10, 0]), 0);
    const P = bridgePoles(A, B), c = bridgeCurve(P);
    assert.ok(c.poles.every(p => p[2] === 0));
    const back = c.poles.map(([u, v, w]) => {
        const N = c.normal, X = c.x, Y = [N[1] * X[2] - N[2] * X[1], N[2] * X[0] - N[0] * X[2], N[0] * X[1] - N[1] * X[0]];
        return [0, 1, 2].map(i => c.origin[i] + X[i] * u + Y[i] * v + N[i] * w);
    });
    back.forEach((p, i) => assert.ok(Math.hypot(...p.map((v, j) => v - P[i][j])) < 1e-9));
    const B3 = edgePoint(comb(t => [30, 5 + t * 10, 8]), 0);
    assert.ok(bridgeCurve(bridgePoles(A, B3)).poles.some(p => p[2] !== 0));
});

test('bad requests are refused', () => {
    const A = edgePoint(comb(t => [t * 10, 0, 0]), 1);
    assert.throws(() => bridgePoles(A, A), /already meet/);
    assert.throws(() => bridgePoles(A, edgePoint(comb(t => [t, 9, 0]), 0), { tension: 0 }), /tension/);
    assert.throws(() => edgePoint(comb(t => [t, 0, 0]), 2), /0 to 1/);
});
