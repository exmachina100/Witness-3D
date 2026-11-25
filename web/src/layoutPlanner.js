// Patch Layout (LABS): a proposed layout of Class-A patches over a face that one patch can't
// cover, for the user to judge and edit. Deterministic; the agent can explain or re-run it with
// other settings. Shared by both builds: the kernel only gives points on the face (face_uvn) and
// makes the sheets.
//
// How: a grid of points on the face. Every cell of the layout is fitted with one Bézier patch of
// the set degree (classAFit.js, closest fit). While the worst cell misses the tolerance, it is cut
// in two, across the way its bend changes most, where that change peaks: so cuts fall along the
// face's feature lines (where a character line or a crown runs), not halfway. Cuts run the whole
// face (a grid layout). The patches are then fitted together as one B-spline with knots at the
// cuts (C1 there), faired, and split into Bézier patches: they meet exactly, tangent (G1).

import { chordParams, fitPatch, inflections, patchDeviation, patchSheetData, reproject } from './classAFit.js';
import { basisDers, solve } from './seamSolver.js';

const sub = (a, b) => a.map((v, i) => v - b[i]);
const len = a => Math.hypot(...a);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Grid points per side for planning. */
export const PLAN_GRID = 97;

/** Bend (1/mm) at each grid point, going along s and along t: second differences against the normal. */
export function gridBends(Q) {
    const m = Q.length, n = Q[0].length;
    const at = (a, b) => Q[Math.min(m - 1, Math.max(0, a))][Math.min(n - 1, Math.max(0, b))];
    const bendS = [], bendT = [];
    for (let a = 0; a < m; a++) {
        bendS.push([]); bendT.push([]);
        for (let b = 0; b < n; b++) {
            const nrm = cross(sub(at(a + 1, b), at(a - 1, b)), sub(at(a, b + 1), at(a, b - 1))), l = len(nrm);
            const k = (p0, p1, p2) => {
                const h = (len(sub(p1, p0)) + len(sub(p2, p1))) / 2;
                return l > 1e-15 && h > 1e-12 ? dot([p0[0] + p2[0] - 2 * p1[0], p0[1] + p2[1] - 2 * p1[1], p0[2] + p2[2] - 2 * p1[2]], nrm) / l / (h * h) : 0;
            };
            bendS[a].push(a > 0 && a < m - 1 ? k(at(a - 1, b), at(a, b), at(a + 1, b)) : 0);
            bendT[a].push(b > 0 && b < n - 1 ? k(at(a, b - 1), at(a, b), at(a, b + 1)) : 0);
        }
    }
    // The fastest change of bend anywhere, to judge cuts against.
    let biggest = 0;
    for (let a = 1; a < m - 1; a++) for (let b = 1; b < n - 1; b++) {
        biggest = Math.max(biggest, Math.abs(bendS[a + 1][b] - bendS[a - 1][b]), Math.abs(bendT[a][b + 1] - bendT[a][b - 1]));
    }
    return { bendS, bendT, biggest };
}

/** The cell's fit: rows a0..a1 and columns b0..b1 of Q (inclusive), degree d, fairing λ. */
function fitCell(Q, [a0, a1, b0, b1], d, lambda = 0) {
    const G = Q.slice(a0, a1 + 1).map(row => row.slice(b0, b1 + 1));
    let params = chordParams(G), P = fitPatch(G, d, lambda, params);
    for (let it = 0; it < 4; it++) { params = reproject(G, P, d, params); P = fitPatch(G, d, lambda, params); }
    params = reproject(G, P, d, params);
    return { G, P, params, deviation: patchDeviation(G, P, d, params).worst };
}

/** The best place to cut a cell, and which way: where the bend changes fastest, summed across it. */
function bestCut(bends, [a0, a1, b0, b1], minCell) {
    let best = null;
    // A cut at row a (a line of constant s) separates bends along s that change across it.
    const tryWay = (alongS, lo, hi, otherLo, otherHi) => {
        for (let i = lo + minCell; i <= hi - minCell; i++) {
            let jump = 0;
            for (let j = otherLo; j <= otherHi; j++) {
                const k = alongS ? bends.bendS : bends.bendT;
                const get = x => alongS ? k[x][j] : k[j][x];
                jump += Math.abs(get(i + 1) - get(i - 1));
            }
            jump /= otherHi - otherLo + 1;
            // A slight pull toward the middle, so flat-changing regions still halve sensibly.
            const mid = 1 - 0.1 * Math.abs((i - lo) / (hi - lo) - 0.5);
            if (!best || jump * mid > best.score) best = { alongS, at: i, score: jump * mid };
        }
    };
    tryWay(true, a0, a1, b0, b1);
    tryWay(false, b0, b1, a0, a1);
    // A cut where the bend hardly changes buys nothing: then the layout stops and says so.
    return best && best.score > 0.01 * bends.biggest ? best : null;
}

/**
 * Plan a layout over grid `Q`. Returns { cutsS, cutsT (grid indices, ends included), cells: [{
 * range, deviation }], ok } where ok says every cell fits within `tolerance`.
 */
export function planLayout(Q, { tolerance = 0.05, degree = 5, maxCuts = 6, minCell = degree + 3 } = {}) {
    const m = Q.length, n = Q[0].length, bends = gridBends(Q);
    const cutsS = [0, m - 1], cutsT = [0, n - 1];
    const cells = () => {
        const out = [];
        for (let i = 0; i < cutsS.length - 1; i++) for (let j = 0; j < cutsT.length - 1; j++) out.push([cutsS[i], cutsS[i + 1], cutsT[j], cutsT[j + 1]]);
        return out;
    };
    for (;;) {
        const fits = cells().map(range => ({ range, deviation: fitCell(Q, range, degree).deviation }));
        const worst = fits.reduce((w, f) => f.deviation > w.deviation ? f : w);
        if (worst.deviation <= tolerance) return { cutsS: [...cutsS], cutsT: [...cutsT], cells: fits, ok: true };
        const cut = cutsS.length + cutsT.length - 4 < maxCuts ? bestCut(bends, worst.range, minCell) : null;
        if (!cut) return { cutsS: [...cutsS], cutsT: [...cutsT], cells: fits, ok: false };
        const list = cut.alongS ? cutsS : cutsT;
        list.push(cut.at);
        list.sort((x, y) => x - y);
    }
}

/** A B-spline surface's point and derivatives at (s, t): poles P (rows along s), degree d, flat knots ks, kt. */
export function splineFrame(P, d, ks, kt, s, t) {
    const A = basisDers(ks, d, s, 2), C = basisDers(kt, d, t, 2);
    const sum = (X, Y) => {
        const out = [0, 0, 0];
        for (let i = 0; i < X.length; i++) {
            if (!X[i]) continue;
            for (let j = 0; j < Y.length; j++) {
                const w = X[i] * Y[j];
                if (w) for (let k = 0; k < 3; k++) out[k] += w * P[i][j][k];
            }
        }
        return out;
    };
    return { at: sum(A[0], C[0]), su: sum(A[1], C[0]), sv: sum(A[0], C[1]), suu: sum(A[2], C[0]), suv: sum(A[1], C[1]), svv: sum(A[0], C[2]) };
}

/** Least squares B-spline over grid Q at `params`, plus λ × bending energy (Gauss points per span). */
function fitSpline(Q, d, ks, kt, lambda, params) {
    const nu = ks.length - d - 1, nv = kt.length - d - 1, k = nu * nv;
    const M = Array.from({ length: k }, () => new Float64Array(k)), rhs = Array.from({ length: k }, () => [0, 0, 0]);
    const add = (A, C, wq, R) => {
        const idx = [], val = [];
        for (let i = 0; i < nu; i++) if (A[i]) for (let j = 0; j < nv; j++) if (C[j]) { idx.push(i * nv + j); val.push(A[i] * C[j]); }
        for (let x = 0; x < idx.length; x++) {
            const row = M[idx[x]];
            for (let y = 0; y < idx.length; y++) row[idx[y]] += wq * val[x] * val[y];
            if (R) for (let c = 0; c < 3; c++) rhs[idx[x]][c] += wq * val[x] * R[c];
        }
    };
    Q.forEach((row, a) => row.forEach((q, b) => add(basisDers(ks, d, params[a][b][0], 0)[0], basisDers(kt, d, params[a][b][1], 0)[0], 1, q)));
    if (lambda > 0) {
        const spans = kn => { const out = []; for (let i = 0; i + 1 < kn.length; i++) if (kn[i + 1] > kn[i]) out.push([kn[i], kn[i + 1]]); return out; };
        const G = [0.0694318442029737, 0.3300094782075719, 0.6699905217924281, 0.9305681557970263], W = [0.1739274225687269, 0.3260725774312731, 0.3260725774312731, 0.1739274225687269];
        for (const [s0, s1] of spans(ks)) for (const [t0, t1] of spans(kt)) for (let ga = 0; ga < 4; ga++) for (let gb = 0; gb < 4; gb++) {
            const sa = s0 + (s1 - s0) * G[ga], tb = t0 + (t1 - t0) * G[gb], wq = lambda * W[ga] * W[gb] * (s1 - s0) * (t1 - t0);
            const A = basisDers(ks, d, sa, 2), C = basisDers(kt, d, tb, 2);
            add(A[2], C[0], wq); add(A[0], C[2], wq);
            add(A[1], C[1], 2 * wq);
        }
    }
    const flat = solve(M.map(r => Array.from(r)), rhs);
    return Array.from({ length: nu }, (_, i) => Array.from({ length: nv }, (_, j) => flat[i * nv + j]));
}

/** Nearest point on the spline from (s, t), as classAFit's project. */
function projectSpline(P, d, ks, kt, q, s, t) {
    for (let it = 0; it < 8; it++) {
        const f = splineFrame(P, d, ks, kt, s, t), r = sub(f.at, q);
        const g = [dot(r, f.su), dot(r, f.sv)];
        const h00 = dot(f.su, f.su) + dot(r, f.suu), h01 = dot(f.su, f.sv) + dot(r, f.suv), h11 = dot(f.sv, f.sv) + dot(r, f.svv);
        const det = h00 * h11 - h01 * h01;
        if (!(Math.abs(det) > 1e-30)) break;
        const ds = (h11 * g[0] - h01 * g[1]) / det, dt = (h00 * g[1] - h01 * g[0]) / det;
        s = Math.min(1, Math.max(0, s - ds)); t = Math.min(1, Math.max(0, t - dt));
        if (Math.abs(ds) + Math.abs(dt) < 1e-12) break;
    }
    return [s, t];
}

/** Boehm knot insertion of `u` into rows of poles along the first index (each row a list of points). */
function insertKnot(P, d, knots, u) {
    let k = d;
    while (k < knots.length - d - 2 && u >= knots[k + 1]) k++;
    const out = [];
    for (let i = 0; i <= P.length; i++) {
        if (i <= k - d) out.push(P[i]);
        else if (i > k) out.push(P[i - 1]);
        else {
            const a = (u - knots[i]) / (knots[i + d] - knots[i]);
            out.push(P[i].map((p, j) => p.map((v, c) => (1 - a) * P[i - 1][j][c] + a * v)));
        }
    }
    const kn = [...knots.slice(0, k + 1), u, ...knots.slice(k + 1)];
    return { P: out, knots: kn };
}

/** The Bézier patches of a B-spline surface whose inner knots get full multiplicity: rows of patches. */
export function bezierPatches(P, d, ks, kt) {
    const fill = (P0, kn, transpose) => {
        let Pc = transpose ? P0[0].map((_, j) => P0.map(row => row[j])) : P0, k = [...kn];
        const inner = [...new Set(kn.filter(v => v > 0 && v < 1))];
        for (const u of inner) {
            while (k.filter(v => v === u).length < d) ({ P: Pc, knots: k } = insertKnot(Pc, d, k, u));
        }
        return transpose ? Pc[0].map((_, j) => Pc.map(row => row[j])) : Pc;
    };
    const full = fill(fill(P, ks, false), kt, true);
    const nS = (full.length - 1) / d, nT = (full[0].length - 1) / d;
    const out = [];
    for (let i = 0; i < nS; i++) for (let j = 0; j < nT; j++) {
        out.push(Array.from({ length: d + 1 }, (_, r) => Array.from({ length: d + 1 }, (_, c) => full[i * d + r][j * d + c])));
    }
    return { patches: out, rows: nS, cols: nT };
}

/**
 * The patches of a layout, fitted together: one B-spline over the whole face whose knots sit at the
 * cuts with multiplicity d − 1, so the patches meet in C1 (tangent, G1) by construction; parameters
 * corrected, faired as far as `tolerance` allows, then split into Bézier patches. Returns { patches:
 * [{ range, poles, deviation, inflections }], data, deviation }.
 */
export function layoutPatches(Q, plan, { tolerance = 0.05, degree: d = 5, fair = true } = {}) {
    const start = chordParams(Q);
    const sAt = plan.cutsS.map(a => start[a][0][0]), tAt = plan.cutsT.map(b => start[0][b][1]);
    const knots = at => [...Array(d + 1).fill(0), ...at.slice(1, -1).flatMap(v => Array(d - 1).fill(v)), ...Array(d + 1).fill(1)];
    const ks = knots(sAt), kt = knots(tAt);
    const devOf = (P, params) => {
        let worst = 0;
        Q.forEach((row, a) => row.forEach((q, b) => { worst = Math.max(worst, len(sub(splineFrame(P, d, ks, kt, ...params[a][b]).at, q))); }));
        return worst;
    };
    const correct = (P, params) => Q.map((row, a) => row.map((q, b) => projectSpline(P, d, ks, kt, q, ...params[a][b])));
    let params = start, P = fitSpline(Q, d, ks, kt, 0, params);
    for (let it = 0; it < 3; it++) { params = correct(P, params); P = fitSpline(Q, d, ks, kt, 0, params); }
    params = correct(P, params);
    let deviation = devOf(P, params);
    if (fair && deviation <= tolerance) {
        let lo = -10, hi = 6;
        for (let it = 0; it < 16; it++) {
            const mid = (lo + hi) / 2, F = fitSpline(Q, d, ks, kt, 10 ** mid, params), e = devOf(F, correct(F, params));
            if (e <= tolerance * 0.95) { P = F; deviation = e; lo = mid; } else hi = mid;
        }
    }
    const { patches: list, cols } = bezierPatches(P, d, ks, kt);
    // Each patch's own furthest point: the grid points whose corrected parameters fall in it.
    const finalParams = correct(P, params);
    const patches = list.map((poles, k) => {
        const i = Math.floor(k / cols), j = k % cols, range = [plan.cutsS[i], plan.cutsS[i + 1], plan.cutsT[j], plan.cutsT[j + 1]];
        let worst = 0;
        for (let a = range[0]; a <= range[1]; a++) for (let b = range[2]; b <= range[3]; b++) {
            worst = Math.max(worst, len(sub(splineFrame(P, d, ks, kt, ...finalParams[a][b]).at, Q[a][b])));
        }
        return { range, poles, deviation: worst, inflections: inflections(poles, d) };
    });
    return { patches, data: patches.map(p => patchSheetData(p.poles, d)), deviation };
}

/** Plan and build a layout over face `face` of `body`. */
export async function planFaceLayout(backend, { body, face }, options = {}) {
    const count = options.count ?? PLAN_GRID, pts = [];
    for (let a = 0; a < count; a++) for (let b = 0; b < count; b++) pts.push([a / (count - 1), b / (count - 1), 0]);
    const { points } = await backend.faceUvn({ body, face, map: true, points: pts });
    const Q = Array.from({ length: count }, (_, a) => points.slice(a * count, (a + 1) * count));
    // The user's own cuts (fractions 0..1 along s and t), else the planner's.
    const snap = list => [...new Set([0, ...list.map(f => Math.round(Math.min(1, Math.max(0, f)) * (count - 1))), count - 1])].sort((x, y) => x - y);
    const plan = options.cuts ? { cutsS: snap(options.cuts[0]), cutsT: snap(options.cuts[1]), ok: null } : planLayout(Q, options);
    const minCell = (options.degree ?? 5) + 1;
    for (const list of [plan.cutsS, plan.cutsT]) for (let i = 1; i < list.length; i++) {
        if (list[i] - list[i - 1] < minCell) throw new Error('two cuts are too close together for a patch between them');
    }
    const built = layoutPatches(Q, plan, options);
    plan.ok = built.patches.every(p => p.deviation <= (options.tolerance ?? 0.05));
    return { plan, ...built, count, fractions: [plan.cutsS, plan.cutsT].map(l => l.slice(1, -1).map(i => i / (count - 1))) };
}
