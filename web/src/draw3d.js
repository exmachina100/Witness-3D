// Drawing in 3D (Plasticity's point-picked curves: Line, Spline, Control Point Curve). Points are
// [x, y, h] in the drawing plane's coordinates, h up its normal. Curves whose points leave the plane
// become NURBS curves with their poles' heights (the shape kind 'nurbs' both builds read).
import { asNurbs } from './curveEdit.js';

/** True when every point lies in the plane (heights within 1e-9). */
export const isFlat = pts => pts.every(p => Math.abs(p[2] ?? 0) < 1e-9);

const at3 = q => [q[0], q[1], q[2] ?? 0];
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], (a[2] ?? 0) - (b[2] ?? 0));

/** Chord-length parameters in [0, 1] of the points. */
function chordParams(P) {
    const d = [0];
    for (let i = 1; i < P.length; i++) d.push(d[i - 1] + dist3(P[i], P[i - 1]));
    const total = d.at(-1);
    if (!(total > 1e-12)) throw new Error('that curve has no length');
    return d.map(v => v / total);
}

/** Straight lines through the points (closed: back to the first), as a degree 1 NURBS curve. */
export function polyline3d(points, closed = false) {
    const P = (closed ? [...points, points[0]] : points).map(at3), t = chordParams(P);
    return { kind: 'nurbs', degree: 1, poles: P, weights: P.map(() => 1), knots: [0, ...t, 1] };
}

/** The control-point curve with these control points: the same B-spline as the flat 'cv' kind, with heights. */
export function cv3d(points, closed = false) {
    // Its poles are a linear map of the control points, so the heights go through the same map.
    const xy = asNurbs({ kind: 'cv', points: points.map(q => [q[0], q[1]]), closed });
    const h = asNurbs({ kind: 'cv', points: points.map(q => [q[2] ?? 0, 0]), closed });
    return { kind: 'nurbs', degree: xy.degree, poles: xy.poles.map((q, i) => [q[0], q[1], h.poles[i][0]]), weights: xy.weights, knots: xy.knots };
}

/** The B-spline basis functions of degree p at t (knots clamped), as a row of `count`. */
function basisRow(knots, p, count, t) {
    let k = p;
    while (k < count - 1 && t >= knots[k + 1]) k++;
    const N = new Array(p + 1).fill(0), L = [], R = [];
    N[0] = 1;
    for (let j = 1; j <= p; j++) {
        L[j] = t - knots[k + 1 - j]; R[j] = knots[k + j] - t;
        let saved = 0;
        for (let r = 0; r < j; r++) {
            const den = R[r + 1] + L[j - r], tmp = den ? N[r] / den : 0;
            N[r] = saved + R[r + 1] * tmp;
            saved = L[j - r] * tmp;
        }
        N[j] = saved;
    }
    const out = new Array(count).fill(0);
    for (let j = 0; j <= p; j++) out[k - p + j] = N[j];
    return out;
}

/** Solve A x = B (B with three columns) by Gaussian elimination with partial pivoting. */
function solve(A, B) {
    const n = A.length, M = A.map((r, i) => [...r, ...B[i]]);
    for (let c = 0; c < n; c++) {
        let piv = c;
        for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
        if (Math.abs(M[piv][c]) < 1e-14) throw new Error('those points make no curve: two of them are the same');
        [M[c], M[piv]] = [M[piv], M[c]];
        for (let r = 0; r < n; r++) {
            if (r === c) continue;
            const f = M[r][c] / M[c][c];
            if (f) for (let k = c; k < n + 3; k++) M[r][k] -= f * M[c][k];
        }
    }
    return M.map((r, i) => r.slice(n).map(v => v / r[i]));
}

/**
 * A spline through the points (Plasticity's Spline): a cubic B-spline interpolating them at their
 * chord-length parameters. Open, its knots average the parameters; closed, it comes back to the first
 * point leaving it the way it arrived (both end tangents along the chord through the first point's
 * neighbours), so the seam is smooth.
 */
export function spline3d(points, closed = false) {
    const Q = (closed ? [...points, points[0]] : points).map(at3), n = Q.length - 1;
    if (n < 1) throw new Error('a spline needs two points');
    const u = chordParams(Q);
    if (!closed) {
        const p = Math.min(3, n), knots = new Array(p + 1).fill(0);
        for (let j = 1; j <= n - p; j++) {
            let s = 0;
            for (let i = j; i < j + p; i++) s += u[i];
            knots.push(s / p);
        }
        knots.push(...new Array(p + 1).fill(1));
        const A = u.map(t => basisRow(knots, p, n + 1, Math.min(t, 1 - 1e-12)));
        A[n] = new Array(n + 1).fill(0); A[n][n] = 1;
        return { kind: 'nurbs', degree: p, poles: solve(A, Q), weights: Q.map(() => 1), knots };
    }
    // Closed: n + 3 poles, the two extra rows fixing the end derivatives (Piegl & Tiller 9.2.2).
    const p = 3, count = n + 3, knots = [0, 0, 0, 0, ...u.slice(1, n), 1, 1, 1, 1];
    const span = u[1] + (1 - u[n - 1]), D = Q[1].map((v, k) => (v - Q[n - 1][k]) / span);
    const A = [], B = [];
    u.forEach((t, k) => {
        const row = basisRow(knots, p, count, Math.min(t, 1 - 1e-12));
        if (k === n) { row.fill(0); row[count - 1] = 1; }
        A.push(row); B.push(Q[k]);
    });
    const r0 = new Array(count).fill(0), r1 = new Array(count).fill(0);
    r0[0] = -1; r0[1] = 1;
    r1[count - 2] = -1; r1[count - 1] = 1;
    A.splice(1, 0, r0); B.splice(1, 0, D.map(v => v * knots[4] / 3));
    A.push(r1); B.push(D.map(v => v * (1 - knots[count - 1]) / 3));
    return { kind: 'nurbs', degree: p, poles: solve(A, B), weights: new Array(count).fill(1), knots };
}

/** The drawn curve for these points: flat shapes as before, otherwise the NURBS curve with heights. */
export function drawnCurve3d(kind, points, closed = false) {
    if (isFlat(points)) {
        const flat = points.map(q => [q[0], q[1]]);
        return { kind: kind === 'line' ? 'polyline' : kind, points: flat, closed };
    }
    return kind === 'spline' ? spline3d(points, closed) : kind === 'cv' ? cv3d(points, closed) : polyline3d(points, closed);
}
