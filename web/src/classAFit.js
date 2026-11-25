// Class-A Fit (LABS): a face rebuilt as one clean patch, a single span of degree 5 to 7 each way (a
// Bézier patch, as Class-A surfacing wants: few control points, no inner knots), fitted to the face
// within a tolerance and then faired as far as that tolerance allows. Shared by both builds: the
// kernel only gives points on the face (face_uvn) and makes the sheet (spline_sheet); the fit,
// fairing and checks are worked out here.
//
// The fit: least squares over a grid of points on the face (at its own parameters, scaled 0..1),
// plus λ times the patch's bending energy (∫ Suu² + 2 Suv² + Svv²). λ = 0 is the closest fit; the
// fairing raises λ as far as the furthest point stays within the tolerance (bisection), which irons
// out ripples and inflections the face had. The lowest degree that fits is used.
//
// Each point's parameters are corrected to its nearest point on the patch (a few rounds), so the
// deviation is the distance from each face point to the patch, not to a point at the same parameter.

import { solve } from './seamSolver.js';

const sub = (a, b) => a.map((v, i) => v - b[i]);
const len = a => Math.hypot(...a);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The user's fit target (mm). */
export const FIT_TOLERANCE = 0.05;
/** Degrees tried, lowest first. */
export const FIT_DEGREES = [5, 6, 7];

const binom = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; };

/** Bernstein basis of degree `d` at `t` and its first two derivatives: [[B], [B'], [B'']]. */
export function bernstein(d, t) {
    const B = k => (k < 0 || k > d) ? 0 : binom(d, k) * t ** k * (1 - t) ** (d - k);
    const lower = (n, k) => (k < 0 || k > n) ? 0 : binom(n, k) * t ** k * (1 - t) ** (n - k);
    const b0 = [], b1 = [], b2 = [];
    for (let k = 0; k <= d; k++) {
        b0.push(B(k));
        b1.push(d * (lower(d - 1, k - 1) - lower(d - 1, k)));
        b2.push(d >= 2 ? d * (d - 1) * (lower(d - 2, k - 2) - 2 * lower(d - 2, k - 1) + lower(d - 2, k)) : 0);
    }
    return [b0, b1, b2];
}

/** Gauss-Legendre points and weights on 0..1 (8 of them: exact for the energy up to degree 7). */
const GAUSS = (() => {
    const x = [0.1834346424956498, 0.5255324099163290, 0.7966664774136267, 0.9602898564975363];
    const w = [0.3626837833783620, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763];
    const pts = [], wts = [];
    for (let i = 3; i >= 0; i--) { pts.push((1 - x[i]) / 2); wts.push(w[i] / 2); }
    for (let i = 0; i < 4; i++) { pts.push((1 + x[i]) / 2); wts.push(w[i] / 2); }
    return { pts, wts };
})();

/** A patch's point and derivatives at (s, t): P (rows along s) of degree d. */
export function patchFrame(P, d, s, t) {
    const [a0, a1, a2] = bernstein(d, s), [c0, c1, c2] = bernstein(d, t);
    const sum = (A, C) => {
        const out = [0, 0, 0];
        for (let i = 0; i <= d; i++) for (let j = 0; j <= d; j++) {
            const w = A[i] * C[j];
            if (w) for (let k = 0; k < 3; k++) out[k] += w * P[i][j][k];
        }
        return out;
    };
    return { at: sum(a0, c0), su: sum(a1, c0), sv: sum(a0, c1), suu: sum(a2, c0), suv: sum(a1, c1), svv: sum(a0, c2) };
}

/**
 * Fit a degree-`d` patch to grid `Q` (rows along s, Q[a][b] at s = a/(m-1), t = b/(n-1)) with
 * fairing weight `lambda`. Returns
 * the poles as rows.
 */
export function fitPatch(Q, d, lambda = 0, params = null) {
    const m = Q.length, n = Q[0].length, k = (d + 1) ** 2;
    const idx = (i, j) => i * (d + 1) + j;
    const M = Array.from({ length: k }, () => Array(k).fill(0)), rhs = Array.from({ length: k }, () => [0, 0, 0]);
    // Least squares: Σ (Σ B_i(s) B_j(t) P_ij - Q)².
    const st = params ?? gridParams(m, n);
    const scale = 1 / (m * n);
    for (let a = 0; a < m; a++) for (let b = 0; b < n; b++) {
        const Bs = bernstein(d, st[a][b][0])[0], Bt = bernstein(d, st[a][b][1])[0];
        const w = [];
        for (let i = 0; i <= d; i++) for (let j = 0; j <= d; j++) w.push(Bs[i] * Bt[j]);
        for (let r = 0; r < k; r++) {
            if (!w[r]) continue;
            for (let c = 0; c < k; c++) M[r][c] += scale * w[r] * w[c];
            for (let x = 0; x < 3; x++) rhs[r][x] += scale * w[r] * Q[a][b][x];
        }
    }
    if (lambda > 0) {
        // Bending energy over the unit square, by Gauss quadrature.
        for (let ga = 0; ga < 8; ga++) for (let gb = 0; gb < 8; gb++) {
            const [s0, s1, s2] = bernstein(d, GAUSS.pts[ga]), [t0, t1, t2] = bernstein(d, GAUSS.pts[gb]);
            const wq = lambda * GAUSS.wts[ga] * GAUSS.wts[gb];
            const uu = [], uv = [], vv = [];
            for (let i = 0; i <= d; i++) for (let j = 0; j <= d; j++) { uu.push(s2[i] * t0[j]); uv.push(s1[i] * t1[j]); vv.push(s0[i] * t2[j]); }
            for (let r = 0; r < k; r++) for (let c = 0; c < k; c++) M[r][c] += wq * (uu[r] * uu[c] + 2 * uv[r] * uv[c] + vv[r] * vv[c]);
        }
    }
    const flat = solve(M, rhs);
    return Array.from({ length: d + 1 }, (_, i) => Array.from({ length: d + 1 }, (_, j) => flat[idx(i, j)]));
}

/** Even parameters for an m x n grid. */
export const gridParams = (m, n) => Array.from({ length: m }, (_, a) => Array.from({ length: n }, (_, b) => [a / (m - 1), b / (n - 1)]));

/**
 * Chord-length parameters for grid `Q`: s from the distances between rows (averaged over the
 * columns), t from those between columns, so uneven spacing on the face (a clamped B-spline's ends
 * run slower) doesn't start the fit off on the wrong foot.
 */
export function chordParams(Q) {
    const m = Q.length, n = Q[0].length;
    const run = (count, gap) => {
        const c = [0];
        for (let i = 1; i < count; i++) c.push(c[i - 1] + gap(i));
        const total = c[count - 1] || 1;
        return c.map(v => v / total);
    };
    const s = run(m, a => Q[a].reduce((t, q, b) => t + len(sub(q, Q[a - 1][b])), 0) / n);
    const t = run(n, b => Q.reduce((u, row) => u + len(sub(row[b], row[b - 1])), 0) / m);
    return Q.map((_, a) => Q[0].map((_, b) => [s[a], t[b]]));
}

/** The patch's nearest point to `q` from (s, t) (Newton on the squared distance, kept in 0..1): [s, t]. */
export function project(P, d, q, s, t) {
    for (let it = 0; it < 8; it++) {
        const f = patchFrame(P, d, s, t), r = sub(f.at, q);
        const g = [dot(r, f.su), dot(r, f.sv)];
        const H = [[dot(f.su, f.su) + dot(r, f.suu), dot(f.su, f.sv) + dot(r, f.suv)], [0, dot(f.sv, f.sv) + dot(r, f.svv)]];
        H[1][0] = H[0][1];
        const det = H[0][0] * H[1][1] - H[0][1] * H[1][0];
        if (!(Math.abs(det) > 1e-30)) break;
        const ds = (H[1][1] * g[0] - H[0][1] * g[1]) / det, dt = (H[0][0] * g[1] - H[1][0] * g[0]) / det;
        s = Math.min(1, Math.max(0, s - ds));
        t = Math.min(1, Math.max(0, t - dt));
        if (Math.abs(ds) + Math.abs(dt) < 1e-12) break;
    }
    return [s, t];
}

/** Every grid point's parameters moved to its nearest point on the patch (parameter correction). */
export function reproject(Q, P, d, params) {
    return Q.map((row, a) => row.map((q, b) => project(P, d, q, ...params[a][b])));
}

/** The furthest grid point from the patch at `params` (mm; even by default), and where. */
export function patchDeviation(Q, P, d, params = null) {
    const m = Q.length, n = Q[0].length, st = params ?? gridParams(m, n);
    let worst = 0, at = null;
    for (let a = 0; a < m; a++) for (let b = 0; b < n; b++) {
        const e = len(sub(patchFrame(P, d, ...st[a][b]).at, Q[a][b]));
        if (e > worst) { worst = e; at = Q[a][b]; }
    }
    return { worst, at };
}

/**
 * Inflections: along each of `lines` isoparams each way, how often the normal curvature in that
 * direction changes sign (ignoring curvatures flatter than `flat`, 1/mm). A Class-A patch has none.
 */
export function inflections(P, d, { lines = 9, steps = 48, flat = 1e-5 } = {}) {
    let count = 0;
    for (const alongS of [true, false]) {
        for (let l = 0; l < lines; l++) {
            const c = (l + 0.5) / lines;
            let last = 0;
            for (let i = 0; i <= steps; i++) {
                const x = i / steps, f = alongS ? patchFrame(P, d, x, c) : patchFrame(P, d, c, x);
                const nrm = cross(f.su, f.sv), nl = len(nrm);
                if (!(nl > 1e-15)) continue;
                const du = alongS ? f.su : f.sv, dd = alongS ? f.suu : f.svv;
                const k = dot(dd, nrm) / nl / dot(du, du);
                const sign = Math.abs(k) < flat ? 0 : Math.sign(k);
                if (sign && last && sign !== last) count++;
                if (sign) last = sign;
            }
        }
    }
    return count;
}

/**
 * Inflections in the face itself, from its grid: along each row and column, how often the bend
 * (second difference against the local normal, per mm²) changes sign, ignoring bends flatter than
 * `flat` (1/mm). Ripples show up here; the fitted patch's count says whether they are gone.
 */
export function gridInflections(Q, { flat = 1e-5 } = {}) {
    const m = Q.length, n = Q[0].length;
    const normal = (a, b) => {
        const du = sub(Q[Math.min(a + 1, m - 1)][b], Q[Math.max(a - 1, 0)][b]), dv = sub(Q[a][Math.min(b + 1, n - 1)], Q[a][Math.max(b - 1, 0)]);
        const c = cross(du, dv), l = len(c);
        return l > 1e-15 ? c.map(v => v / l) : null;
    };
    const line = pts => {
        let count = 0, last = 0;
        for (let i = 1; i < pts.length - 1; i++) {
            const [p0, p1, p2, nrm] = [pts[i - 1][0], pts[i][0], pts[i + 1][0], pts[i][1]];
            if (!nrm) continue;
            const h = (len(sub(p1, p0)) + len(sub(p2, p1))) / 2;
            const k = dot(sub(add3(p0, p2), p1.map(v => 2 * v)), nrm) / (h * h);
            const sign = Math.abs(k) < flat ? 0 : Math.sign(k);
            if (sign && last && sign !== last) count++;
            if (sign) last = sign;
        }
        return count;
    };
    const add3 = (a, b) => a.map((v, i) => v + b[i]);
    let count = 0;
    for (let a = 1; a < m - 1; a++) count += line(Q[a].map((q, b) => [q, normal(a, b)]));
    for (let b = 1; b < n - 1; b++) count += line(Q.map((row, a) => [row[b], normal(a, b)]));
    return count;
}

/**
 * Fit and fair grid `Q` with the lowest degree in `degrees` that fits within `tolerance`. Returns {
 * poles, degree, deviation, lambda, inflections, fits } or throws when no degree fits; `fits` lists
 * each degree's closest fit, so the user sees why.
 */
export function classAFit(Q, { tolerance = FIT_TOLERANCE, degrees = FIT_DEGREES, fair = true, params: start = null } = {}) {
    if (!(tolerance > 0)) throw new Error('the tolerance must be above zero');
    if (start ? Q.length * Q[0].length < 64 : Q.length < 8 || Q[0].length < 8) throw new Error('too few points to fit');
    const fits = [];
    for (const d of degrees) {
        // Closest fit, with the points' parameters corrected a few times so the face's own
        // parametrisation (uneven speed near clamped ends) isn't counted as deviation.
        let params = start ?? chordParams(Q), close = fitPatch(Q, d, 0, params);
        for (let it = 0; it < 8; it++) { params = reproject(Q, close, d, params); close = fitPatch(Q, d, 0, params); }
        params = reproject(Q, close, d, params);
        const dev = patchDeviation(Q, close, d, params).worst;
        fits.push({ degree: d, deviation: dev });
        if (dev > tolerance) continue;
        let best = { poles: close, deviation: dev, lambda: 0 };
        if (fair) {
            // λ on a log scale: wide enough for faces from a few mm to a few metres.
            let lo = -14, hi = 0;
            for (let it = 0; it < 24; it++) {
                const mid = (lo + hi) / 2, lambda = 10 ** mid;
                const P = fitPatch(Q, d, lambda, params), e = patchDeviation(Q, P, d, reproject(Q, P, d, params)).worst;
                if (e <= tolerance * 0.95) { best = { poles: P, deviation: e, lambda }; lo = mid; } else hi = mid;
            }
        }
        return { ...best, degree: d, inflections: inflections(best.poles, d), before: start ? null : gridInflections(Q), fits };
    }
    const near = fits.reduce((a, b) => a.deviation < b.deviation ? a : b);
    throw new Error(`no single patch fits within ${tolerance} mm: the closest is degree ${near.degree} at ${near.deviation.toFixed(3)} mm; split the face or raise the tolerance`);
}

/**
 * Starting parameters for scattered points (a scan): each point's place on the plane that best fits
 * them (its two widest directions, by power iteration on the covariance), scaled to 0..1.
 */
export function planeParams(points) {
    if (points.length < 64) throw new Error('too few points to fit');
    const c = [0, 1, 2].map(k => points.reduce((s, p) => s + p[k], 0) / points.length);
    const C = [0, 1, 2].map(i => [0, 1, 2].map(j => points.reduce((s, p) => s + (p[i] - c[i]) * (p[j] - c[j]), 0)));
    const times = v => C.map(row => dot(row, v));
    const widest = (away = null) => {
        let v = away ? cross(away, [0.3, 0.5, 0.8]) : [1, 0.7, 0.3];
        for (let it = 0; it < 200; it++) {
            let w = times(v);
            if (away) w = sub(w, away.map(x => x * dot(w, away)));
            const l = len(w);
            if (!(l > 1e-30)) break;
            v = w.map(x => x / l);
        }
        return v;
    };
    const e1 = widest(), e2 = widest(e1);
    const raw = points.map(p => { const d = sub(p, c); return [dot(d, e1), dot(d, e2)]; });
    const lo = [0, 1].map(k => Math.min(...raw.map(r => r[k]))), hi = [0, 1].map(k => Math.max(...raw.map(r => r[k])));
    if (!(hi[0] - lo[0] > 1e-9) || !(hi[1] - lo[1] > 1e-9)) throw new Error('the points lie on a line');
    return raw.map(r => [(r[0] - lo[0]) / (hi[0] - lo[0]), (r[1] - lo[1]) / (hi[1] - lo[1])]);
}

/**
 * Class-A Fit of scattered points (a mesh or scan's vertices, at most `limit` of them, spread
 * evenly through the list): one faired patch over them, as classAFit. Returns its sheet numbers too.
 */
export function classAFitPoints(points, options = {}) {
    const limit = options.limit ?? 1500;
    const step = Math.max(1, points.length / limit), pick = [];
    for (let i = 0; i < points.length && pick.length < limit; i += step) pick.push(points[Math.floor(i)]);
    const r = classAFit([pick], { ...options, params: [planeParams(pick)] });
    return { ...r, points: pick.length, data: patchSheetData(r.poles, r.degree) };
}

/** Grid points (s, t, 0) for face_uvn, `count` each way, rows along s. */
export function fitGrid(count = 25) {
    const pts = [];
    for (let a = 0; a < count; a++) for (let b = 0; b < count; b++) pts.push([a / (count - 1), b / (count - 1), 0]);
    return pts;
}

/** A patch's numbers for spline_sheet (splineSheet.js layout). */
export function patchSheetData(P, d) {
    const k = [...Array(d + 1).fill(0), ...Array(d + 1).fill(1)];
    return [d, d, d + 1, d + 1, k.length, k.length, ...k, ...k, ...P.flat(2)];
}

/** Class-A Fit of face `face` of `body`: the grid from the kernel, the patch, and its sheet's numbers. */
export async function classAFitFace(backend, { body, face }, options = {}) {
    const count = options.count ?? 25;
    const { points } = await backend.faceUvn({ body, face, map: true, points: fitGrid(count) });
    const Q = Array.from({ length: count }, (_, a) => points.slice(a * count, (a + 1) * count));
    const r = classAFit(Q, options);
    return { ...r, data: patchSheetData(r.poles, r.degree) };
}
