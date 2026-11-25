// Seam Solver (LABS, idea 3): a B-spline sheet's side moved to meet another face in G0 to G3. G0 to
// G2 are Align Surface's (alignSurface.js: the first three rows of control points fitted at the
// side's Greville points); G3 then sets the fourth row so the curvature also changes across the
// seam at the reference's rate.
//
// G3 is measured and corrected: row 3's control points move along the reference's normal until
// the sheet's curvature changes going away from the seam at the rate the reference's changes going
// into it, both measured as Seam Check measures them (seamCheck.js). The sheet is evaluated here
// from its control points (sideFrame); the reference through the kernel. Rows 0 to 2 are not
// touched, so the G0 to G2 fit stays.

import { alignRequest, normalCurvature, readEdgeFaces } from './alignSurface.js';

const sub = (a, b) => a.map((v, i) => v - b[i]);
const add = (a, b) => a.map((v, i) => v + b[i]);
const mul = (a, s) => a.map(v => v * s);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(...a);
const unit = a => { const l = len(a); return l > 1e-15 ? mul(a, 1 / l) : [0, 0, 0]; };

/** Continuities the solver reaches, in the order Tab cycles them. */
export const SOLVER_CONTINUITY = ['G0', 'G1', 'G2', 'G3'];

/** `A` x = `b` for a small dense square system, b a list of 3-vectors. */
export function solve(A, b) {
    const n = A.length, M = A.map((r, i) => [...r, ...b[i]]);
    for (let c = 0; c < n; c++) {
        let piv = c;
        for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
        if (Math.abs(M[piv][c]) < 1e-14) throw new Error('the side could not be fitted for G3');
        [M[c], M[piv]] = [M[piv], M[c]];
        for (let r = 0; r < n; r++) {
            if (r === c) continue;
            const f = M[r][c] / M[c][c];
            if (f) for (let k = c; k < n + 3; k++) M[r][k] -= f * M[c][k];
        }
    }
    return M.map((r, i) => [r[n] / r[i], r[n + 1] / r[i], r[n + 2] / r[i]]);
}

/** Basis functions of degree `p` on knots `t` at `x` and their derivatives up to `nd` (Piegl & Tiller A2.3), for all n of them. */
export function basisDers(t, p, x, nd) {
    const n = t.length - p - 1, lo = t[p], hi = t[n];
    x = Math.min(Math.max(x, lo), hi);
    let s = p;
    while (s < n - 1 && x >= t[s + 1]) s++;
    const ndu = Array.from({ length: p + 1 }, () => Array(p + 1).fill(0)), left = [], right = [];
    ndu[0][0] = 1;
    for (let j = 1; j <= p; j++) {
        left[j] = x - t[s + 1 - j];
        right[j] = t[s + j] - x;
        let saved = 0;
        for (let r = 0; r < j; r++) {
            ndu[j][r] = right[r + 1] + left[j - r];
            const temp = ndu[r][j - 1] / ndu[j][r];
            ndu[r][j] = saved + right[r + 1] * temp;
            saved = left[j - r] * temp;
        }
        ndu[j][j] = saved;
    }
    const ders = Array.from({ length: nd + 1 }, () => Array(p + 1).fill(0));
    for (let j = 0; j <= p; j++) ders[0][j] = ndu[j][p];
    for (let r = 0; r <= p; r++) {
        let s1 = 0, s2 = 1;
        const a = [Array(p + 1).fill(0), Array(p + 1).fill(0)];
        a[0][0] = 1;
        for (let k = 1; k <= nd; k++) {
            let d = 0;
            const rk = r - k, pk = p - k;
            if (r >= k) { a[s2][0] = a[s1][0] / ndu[pk + 1][rk]; d = a[s2][0] * ndu[rk][pk]; }
            const j1 = rk >= -1 ? 1 : -rk, j2 = r - 1 <= pk ? k - 1 : p - r;
            for (let j = j1; j <= j2; j++) { a[s2][j] = (a[s1][j] - a[s1][j - 1]) / ndu[pk + 1][rk + j]; d += a[s2][j] * ndu[rk + j][pk]; }
            if (r <= pk) { a[s2][k] = -a[s1][k - 1] / ndu[pk + 1][r]; d += a[s2][k] * ndu[r][pk]; }
            ders[k][r] = d;
            [s1, s2] = [s2, s1];
        }
    }
    let r = p;
    for (let k = 1; k <= nd; k++) { for (let j = 0; j <= p; j++) ders[k][j] *= r; r *= p - k; }
    // Spread over all n functions.
    return ders.map(row => { const all = Array(n).fill(0); row.forEach((v, j) => { if (s - p + j >= 0 && s - p + j < n) all[s - p + j] = v; }); return all; });
}

/**
 * A frame of the side's sheet (rows R across with knots A, degree p; along with knots `along`,
 * degree q) at (t across, x along): the point, the derivatives across (su) and along (sv), and the
 * second derivatives, as readEdgeFaces gives frames.
 */
export function sideFrame(R, A, p, along, q, t, x) {
    const U = basisDers(A, p, t, 2), V = basisDers(along, q, x, 2);
    const S = (a, b) => {
        let out = [0, 0, 0];
        for (let i = 0; i < R.length; i++) {
            if (!U[a][i]) continue;
            for (let j = 0; j < R[i].length; j++) if (V[b][j]) out = add(out, mul(R[i][j], U[a][i] * V[b][j]));
        }
        return out;
    };
    return { at: S(0, 0), su: S(1, 0), sv: S(0, 1), suu: S(2, 0), suv: S(1, 1), svv: S(0, 2), sign: 1 };
}

/** The normal curvature of frame f going `e` (projected into its tangent plane), its normal turned to agree with `up`. */
function bend(f, e, up) {
    let n = unit(cross(f.su, f.sv));
    if (dot(n, up) < 0) n = mul(n, -1);
    return normalCurvature(f, n, unit(sub(e, mul(n, dot(e, n)))));
}

/** The point of the side's sheet nearest `goal`, starting from (t, x): a few Gauss–Newton steps. */
function nearestOnSide(R, A, p, along, q, goal, t, x) {
    const [t0, t1] = [A[p], A.at(-1 - p)], [x0, x1] = [along[q], along.at(-1 - q)];
    let f = sideFrame(R, A, p, along, q, t, x);
    for (let k = 0; k < 8; k++) {
        const r = sub(goal, f.at);
        const a = dot(f.su, f.su), b = dot(f.su, f.sv), c = dot(f.sv, f.sv), det = a * c - b * b;
        if (!(Math.abs(det) > 1e-24)) break;
        const g1 = dot(r, f.su), g2 = dot(r, f.sv);
        t = Math.min(t1, Math.max(t0, t + (c * g1 - b * g2) / det));
        x = Math.min(x1, Math.max(x0, x + (a * g2 - b * g1) / det));
        f = sideFrame(R, A, p, along, q, t, x);
    }
    return { f, t, x };
}

/**
 * G3 moves for a side already aligned in G2 (`check` is alignRequest's { side, moves, reference,
 * face }): row 3's control points moved along the reference's normal, measured and corrected a few
 * times, until the curvature on the sheet's side changes going away from the seam at the rate the
 * reference's does going into it, as Seam Check measures it (normal curvature across, a one-sided
 * second-order difference over `h` mm). Rows 0 to 2 stay, so G0 to G2 stay as the G2 solve left
 * them. Returns [[pole, by]] for row 3, and the rates before and after.
 */
export async function g3Moves(backend, check, { reach = null, rounds = 4 } = {}) {
    const { side, moves } = check, { rows, ids, along, q, across: A, p } = side;
    if (rows.length < 4 || p < 3) throw new Error('G3 needs degree 3 or more and four rows of control points across the side; raise the degree first');
    const by = new Map(moves.map(([pole, d]) => [pole, d]));
    const R = rows.map((r, i) => r.map((v, j) => by.has(ids[i][j]) ? add(v, by.get(ids[i][j])) : v));
    const m = R[0].length;
    const greville = Array.from({ length: m }, (_, j) => along.slice(j + 1, j + q + 1).reduce((s, k) => s + k, 0) / q || along[j]);
    // Sample along the seam: the Greville points, kept off the very ends.
    const xs = greville.map((x, j) => (j === 0 || j === m - 1) ? along[q] + (along.at(-1 - q) - along[q]) * (j === 0 ? 0.02 : 0.98) : x);
    const seam = xs.map(x => sideFrame(R, A, p, along, q, A[p], x));
    let size = 0;
    for (let j = 1; j < m; j++) size += len(sub(seam[j].at, seam[j - 1].at));
    const h = reach ?? Math.max(size * 0.0005, 1e-3);
    // The reference: its normal and its rate at each point, measured the way Seam Check does.
    const P = seam.map(f => f.at);
    const rf = async pts => { const fs = readEdgeFaces(await backend.edgeFaces({ body: check.reference.body, edge: check.reference.edge, points: pts }), pts.length); return (fs.find(f => f.face === check.face) ?? fs[0]).frames; };
    const base = await rf(P);
    const ns = base.map(f => unit(cross(f.su, f.sv)));
    // Into the reference: away from the sheet, square to the seam, in the reference's tangent plane.
    const into = seam.map((f, j) => { const d = mul(f.su, -1); return unit(sub(d, mul(ns[j], dot(d, ns[j])))); });
    const steps = await rf(P.flatMap((pt, j) => [add(pt, mul(into[j], h)), add(pt, mul(into[j], 2 * h))]));
    const refRate = P.map((_, j) => {
        const k0 = bend(base[j], into[j], ns[j]), k1 = bend(steps[2 * j], into[j], ns[j]), k2 = bend(steps[2 * j + 1], into[j], ns[j]);
        return (-3 * k0 + 4 * k1 - k2) / (2 * h);
    });
    // The sheet's rate going away from the seam (into it), for rows `Rs`.
    const rates = Rs => xs.map((x, j) => {
        const away = mul(into[j], -1), f0 = sideFrame(Rs, A, p, along, q, A[p], x);
        const speed = len(f0.su) || 1;
        const k = [0, 1, 2].map(s => {
            if (!s) return bend(f0, away, ns[j]);
            const g = nearestOnSide(Rs, A, p, along, q, add(f0.at, mul(away, s * h)), A[p] + s * h / speed, x);
            return bend(g.f, away, ns[j]);
        });
        return (-3 * k[0] + 4 * k[1] - k[2]) / (2 * h);
    });
    // Crossing from the reference into the sheet, the sheet's rate going away is the reference's, turned round.
    const want = refRate.map(r => -r);
    const normals = R[3].map((_, k) => ns[Math.min(m - 1, Math.max(0, k))]);
    const shifted = (w) => R.map((row, i) => i === 3 ? row.map((v, k) => add(v, mul(normals[k], w[k]))) : row);
    let w = Array(m).fill(0), now = rates(shifted(w));
    const before = now.slice();
    const delta = Math.max(size * 1e-4, 1e-4);
    for (let round = 0; round < rounds; round++) {
        const r = now.map((v, j) => want[j] - v);
        const scale = Math.max(...want.map(Math.abs), 1e-12);
        if (Math.max(...r.map(Math.abs)) < scale * 1e-3) break;
        // The response of each sample to each pole, by a small push.
        const J = r.map(() => Array(m).fill(0));
        for (let k = 0; k < m; k++) {
            const w2 = w.slice(); w2[k] += delta;
            rates(shifted(w2)).forEach((v, j) => { J[j][k] = (v - now[j]) / delta; });
        }
        // Damped least squares: (JᵀJ + λI) dw = Jᵀ r.
        const JT = J[0].map((_, k) => J.map(row => row[k]));
        const M = JT.map(row => JT.map(col => row.reduce((s, v, i) => s + v * col[i], 0)));
        const lam = 1e-9 * Math.max(...M.map((row, i) => Math.abs(row[i])), 1e-30);
        M.forEach((row, i) => { row[i] += lam; });
        const rhs = JT.map(row => [row.reduce((s, v, i) => s + v * r[i], 0), 0, 0]);
        const dw = solve(M, rhs).map(v => v[0]);
        w = w.map((v, k) => v + dw[k]);
        now = rates(shifted(w));
    }
    const out = [];
    for (let k = 0; k < m; k++) {
        const d = add(sub(R[3][k], rows[3][k]), mul(normals[k], w[k]));
        if (len(d) > 1e-12) out.push([ids[3][k], d]);
    }
    return { moves: out, want, before, after: now };
}

/**
 * The solver's request: `target` (an edge along a side of a B-spline sheet, which moves) and
 * `reference` (an edge of the face it meets), continuity G0 to G3. Returns alignRequest's shape
 * ({ body, moves: [[face, pole, by]], check }) with row 3 added for G3.
 */
export async function seamSolveRequest(backend, { target, reference, continuity = 'G2', ...opts }) {
    const order = SOLVER_CONTINUITY.indexOf(continuity);
    if (order < 0) throw new Error('the continuity is G0, G1, G2 or G3');
    const req = await alignRequest(backend, { target, reference, continuity: order >= 2 ? 'G2' : continuity, ...opts });
    if (order < 3) return req;
    const { moves: extra, want, before, after } = await g3Moves(backend, req.check, opts);
    const face = req.check.target;
    const merged = new Map(req.check.moves.map(([pole, d]) => [pole, d]));
    // Row 3's moves already hold whatever the G2 solve did to it.
    for (const [pole, d] of extra) merged.set(pole, d);
    const moves = [...merged].map(([pole, d]) => [pole, d]);
    return { ...req, moves: moves.map(([pole, d]) => [face, pole, d]), check: { ...req.check, moves }, g3: { want, before, after } };
}
