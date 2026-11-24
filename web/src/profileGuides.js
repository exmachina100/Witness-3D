// XNURBS profile guides: open curves inside the loop that the filled sheet is made to pass
// through. The sheet is fitted to its sides first (square.js); then its inner control points,
// those the sides and the continuity leave free, are moved the least (with a smoothness term) so
// that sampled guide points lie on it. Each guide point is matched to its nearest point of the
// sheet, which is found again after each solve, a few rounds in all.

import { basisRow, surfaceAt } from './square.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** `n` points spaced evenly along the polyline `pts`, ends included. */
export function resample(pts, n) {
    const len = [0];
    for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + dist(pts[i], pts[i - 1]));
    const total = len[len.length - 1];
    if (!(total > 0)) return [pts[0]];
    const out = [];
    for (let k = 0, i = 1; k < n; k++) {
        const s = total * k / (n - 1);
        while (i < pts.length - 1 && len[i] < s) i++;
        const t = (s - len[i - 1]) / ((len[i] - len[i - 1]) || 1);
        out.push(pts[i - 1].map((x, m) => x + (pts[i][m] - x) * t));
    }
    return out;
}

/** The (u, v) in 0..1 of the sheet's point nearest `p`: a coarse grid, then shrinking steps. */
export function nearestUv(surface, p, grid = 24) {
    let best = [0.5, 0.5], d = Infinity;
    for (let i = 0; i <= grid; i++) for (let j = 0; j <= grid; j++) {
        const e = dist(surfaceAt(surface, i / grid, j / grid), p);
        if (e < d) { d = e; best = [i / grid, j / grid]; }
    }
    for (let h = 1 / grid; h > 1e-6; h /= 2) {
        let moved = true;
        while (moved) {
            moved = false;
            for (const [du, dv] of [[h, 0], [-h, 0], [0, h], [0, -h]]) {
                const uv = [Math.min(1, Math.max(0, best[0] + du)), Math.min(1, Math.max(0, best[1] + dv))];
                const e = dist(surfaceAt(surface, ...uv), p);
                if (e < d - 1e-12) { d = e; best = uv; moved = true; }
            }
        }
    }
    return { uv: best, d };
}

/**
 * `surface` ({ degree, uKnots, vKnots, poles }) bent to pass through `guides` (polylines). `held`
 * is how many rows of control points along each side stay where they are (1 for G0, 2 for G1, 3
 * for G2). Returns { surface, miss } with `miss` the largest distance left between the guides'
 * sample points and the sheet (mm). Throws when the sheet has no free control points to move.
 */
export function throughGuides(surface, guides, { held = 1, samples = 24, rounds = 4, smooth = 1e-5 } = {}) {
    const poles = surface.poles.map(r => r.map(P => [...P]));
    const nu = poles.length, nv = poles[0].length;
    const free = [];
    for (let i = held; i < nu - held; i++) for (let j = held; j < nv - held; j++) free.push([i, j]);
    if (!free.length) throw new Error('the sheet has no inner control points to bend through the guides: add spans or lower the continuity');
    const index = new Map(free.map(([i, j], k) => [i * nv + j, k]));
    const pts = guides.flatMap(g => resample(g, samples));
    const out = { ...surface, poles };
    // Neighbouring free control points (along u and v), whose moves the smoothness term keeps alike.
    const pairs = [];
    for (const [i, j] of free) {
        const a = index.get(i * nv + j);
        if (index.has((i + 1) * nv + j)) pairs.push([a, index.get((i + 1) * nv + j)]);
        if (index.has(i * nv + j + 1)) pairs.push([a, index.get(i * nv + j + 1)]);
    }
    for (let round = 0; round < rounds; round++) {
        // Each guide point's row of basis weights over the free control points, and its miss.
        const rows = [];
        for (const p of pts) {
            const { uv } = nearestUv(out, p);
            const bu = basisRow(out.uKnots, out.degree[0], uv[0]), bv = basisRow(out.vKnots, out.degree[1], uv[1]);
            const w = [];
            bu.forEach((a, i) => { if (a) bv.forEach((b, j) => { const k = index.get(i * nv + j); if (b && k !== undefined) w.push([k, a * b]); }); });
            if (w.length) rows.push({ w, d: sub(p, surfaceAt(out, ...uv)) });
        }
        if (!rows.length) break;
        // Least squares: Σ |B·Δ − d|² + smooth·scale Σ |Δa − Δb|² + tiny·|Δ|², by conjugate gradient
        // (matrix-free), one solve per coordinate.
        const n = free.length, lam = smooth * rows.length, tiny = 1e-9 * rows.length;
        const apply = x => {
            const y = new Float64Array(n);
            for (const { w } of rows) { let s = 0; for (const [k, b] of w) s += b * x[k]; for (const [k, b] of w) y[k] += b * s; }
            for (const [a, b] of pairs) { const t = lam * (x[a] - x[b]); y[a] += t; y[b] -= t; }
            for (let k = 0; k < n; k++) y[k] += tiny * x[k];
            return y;
        };
        for (let m = 0; m < 3; m++) {
            const rhs = new Float64Array(n);
            for (const { w, d } of rows) for (const [k, b] of w) rhs[k] += b * d[m];
            const x = new Float64Array(n), r = Float64Array.from(rhs), q = Float64Array.from(r);
            let rr = r.reduce((t, v) => t + v * v, 0);
            const stop = 1e-20 * Math.max(1, rr);
            for (let it = 0; it < 4 * n && rr > stop; it++) {
                const Aq = apply(q);
                const a = rr / q.reduce((t, v, k) => t + v * Aq[k], 0);
                for (let k = 0; k < n; k++) { x[k] += a * q[k]; r[k] -= a * Aq[k]; }
                const next = r.reduce((t, v) => t + v * v, 0);
                for (let k = 0; k < n; k++) q[k] = r[k] + next / rr * q[k];
                rr = next;
            }
            free.forEach(([i, j], k) => { poles[i][j][m] += x[k]; });
        }
    }
    let miss = 0;
    for (const p of pts) miss = Math.max(miss, nearestUv(out, p).d);
    return { surface: out, miss };
}

/**
 * The fewest spans that let a sheet through its guides: `make(spans)` fits the sheet on its sides
 * with `spans` ([u, v]) or 0 for auto; with `spans` 0 the auto fit is tried first, then 2, 4, 8 and
 * 16 spans each way until the guides are met within `tolerance`. Returns the best fit, with
 * `guideMiss` set.
 */
export function fitThroughGuides(make, guides, { spans = 0, tolerance = 0.01, held = 1 } = {}) {
    const tries = spans ? [spans] : [0, [2, 2], [4, 4], [8, 8], [16, 16]];
    let best = null, error = null;
    for (const s of tries) {
        const fit = make(s);
        if (best && Math.min(...fit.spans) <= Math.min(...best.spans)) continue;
        let r;
        try { r = throughGuides(fit, guides, { held }); } catch (e) { error = e; continue; }
        const out = Object.assign(fit, { poles: r.surface.poles, guideMiss: r.miss });
        if (!best || out.guideMiss < best.guideMiss) best = out;
        if (best.guideMiss <= tolerance) break;
    }
    if (!best) throw error;
    return best;
}
