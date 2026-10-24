// Plasticity's Constrained Surface: a smooth sheet through clicked points.
//
// The points are laid on their best-fit plane (the smallest spread by principal components), and
// the surface is a bicubic B-spline height field over the points' rectangle on that plane: its
// poles sit at the Greville abscissae, so the surface's parameters run straight along the plane and
// only the heights are fitted. The fit is least squares with a bending penalty on the control net
// (second differences across and along, and the twist); the penalty is eased until every point is
// within Tolerance, but never so far that the surface's normal turns more than Angular tolerance between
// neighbouring samples (a 24 × 24 lattice), which is what keeps it from rippling to catch a stray point. Optimize trades
// span count for speed: Performance uses about one span per point along each side, Smoothness twice
// that, with the penalty doing the smoothing.

export const OPTIMIZE = ['performance', 'smoothness'];
const DEGREE = 3;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => { const l = len(a); return [a[0] / l, a[1] / l, a[2] / l]; };

/** Eigenvectors of a symmetric 3×3 matrix by Jacobi rotations, sorted by eigenvalue, largest first. */
function eigen3(m) {
    const a = m.map(r => [...r]), v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let sweep = 0; sweep < 50; sweep++) {
        const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
        if (off < 1e-15) break;
        for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
            if (Math.abs(a[p][q]) < 1e-300) continue;
            const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
            const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
            const c = 1 / Math.sqrt(t * t + 1), s = t * c;
            for (let k = 0; k < 3; k++) {
                const akp = a[k][p], akq = a[k][q];
                a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
            }
            for (let k = 0; k < 3; k++) {
                const apk = a[p][k], aqk = a[q][k];
                a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
            }
            for (let k = 0; k < 3; k++) {
                const vkp = v[k][p], vkq = v[k][q];
                v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq;
            }
        }
    }
    return [0, 1, 2].map(i => ({ value: a[i][i], vector: [v[0][i], v[1][i], v[2][i]] })).sort((x, y) => y.value - x.value);
}

/** The best-fit plane of `points`: its centre, in-plane axes X and Y, and normal N. */
export function fitPlane(points) {
    const n = points.length, c = [0, 0, 0];
    for (const p of points) for (let k = 0; k < 3; k++) c[k] += p[k] / n;
    const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const p of points) {
        const d = sub(p, c);
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i][j] += d[i] * d[j];
    }
    const [e0, e1] = eigen3(m);
    const X = unit(e0.vector);
    // Y from the second axis made square to X, so the frame stays right-handed.
    let Y = sub(e1.vector, X.map(x => x * dot(e1.vector, X)));
    Y = unit(Y);
    const N = cross(X, Y);
    return { centre: c, X, Y, N, spread: [e0.value, e1.value] };
}

/** A clamped uniform knot vector of `spans` spans for degree `p`, over 0..spans. */
export function clampedKnots(spans, p = DEGREE) {
    return [...Array(p + 1).fill(0), ...Array.from({ length: spans - 1 }, (_, i) => i + 1), ...Array(p + 1).fill(spans)];
}

/** The degree-`p` basis functions of knots `t` at `x` that are not zero: { first, values }. */
function basisAt(t, p, x) {
    const n = t.length - p - 1;
    x = Math.min(Math.max(x, t[p]), t[n]);
    let s = p;
    while (s < n - 1 && x >= t[s + 1]) s++;
    const N = [1], left = [], right = [];
    for (let j = 1; j <= p; j++) {
        left[j] = x - t[s + 1 - j];
        right[j] = t[s + j] - x;
        let saved = 0;
        for (let r = 0; r < j; r++) {
            const tmp = N[r] / (right[r + 1] + left[j - r]);
            N[r] = saved + right[r + 1] * tmp;
            saved = left[j - r] * tmp;
        }
        N[j] = saved;
    }
    return { first: s - p, values: N };
}

/** Greville abscissae of knots `t` for degree `p`: where each pole sits along the parameter. */
const greville = (t, p) => Array.from({ length: t.length - p - 1 }, (_, i) => t.slice(i + 1, i + p + 1).reduce((a, b) => a + b, 0) / p);

/** Solve the symmetric positive definite `A` x = `b` by Cholesky. */
function cholesky(A, b) {
    const n = A.length, L = A.map(() => new Float64Array(n));
    for (let i = 0; i < n; i++) {
        for (let j = 0; j <= i; j++) {
            let s = A[i][j];
            for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
            if (i === j) {
                if (s <= 0) throw new Error('the points could not be fitted: spread them out more');
                L[i][i] = Math.sqrt(s);
            } else L[i][j] = s / L[j][j];
        }
    }
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i][k] * y[k]; y[i] = s / L[i][i]; }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; }
    return x;
}

/**
 * How sharply a height field bends: the largest angle in degrees between the normals of
 * neighbouring samples on a `grid` × `grid` lattice over its whole rectangle. `height(x, y)` takes
 * fractions 0..1 across; `w` and `d` are the rectangle's width and depth.
 */
export function fieldFold(height, w, d, grid = 24) {
    const e = 1e-4;
    const normal = (x, y) => {
        const hx = (height(Math.min(1, x + e), y) - height(Math.max(0, x - e), y)) / ((Math.min(1, x + e) - Math.max(0, x - e)) * w);
        const hy = (height(x, Math.min(1, y + e)) - height(x, Math.max(0, y - e))) / ((Math.min(1, y + e) - Math.max(0, y - e)) * d);
        return unit([-hx, -hy, 1]);
    };
    const N = Array.from({ length: grid + 1 }, (_, i) => Array.from({ length: grid + 1 }, (_, j) => normal(i / grid, j / grid)));
    const turn = (a, b) => Math.acos(Math.min(1, Math.max(-1, dot(a, b)))) * 180 / Math.PI;
    let most = 0;
    for (let i = 0; i <= grid; i++) for (let j = 0; j <= grid; j++) {
        if (i < grid) most = Math.max(most, turn(N[i][j], N[i + 1][j]));
        if (j < grid) most = Math.max(most, turn(N[i][j], N[i][j + 1]));
    }
    return most;
}

/**
 * The constrained surface through `points` ([x, y, z] each, at least three): { degree, uKnots,
 * vKnots (flat, with repeats), poles (rows along u), error (largest miss, mm), fold (degrees), met }.
 * `tolerance` is how close it must come to every point, `angular` (degrees) how far the normal may
 * turn between neighbouring samples, higher being more relaxed; `optimize` is 'performance' or 'smoothness'.
 */
export function constrainedSurface(points, { tolerance = 0.01, angular = 15, optimize = 'performance' } = {}) {
    if (points.length < 3) throw new Error('click at least three points');
    const plane = fitPlane(points);
    const size = Math.sqrt(plane.spread[0] / points.length);
    if (!(size > 1e-9)) throw new Error('the points are all in one place');
    if (Math.sqrt(plane.spread[1] / points.length) < 1e-6 * size) throw new Error('the points lie on a line: click some off it');
    const local = points.map(p => { const d = sub(p, plane.centre); return [dot(d, plane.X), dot(d, plane.Y), dot(d, plane.N)]; });
    let [s0, s1, t0, t1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const [s, t] of local) { s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
    // A sliver of room so points on the rectangle's edge are inside it.
    const pad = 1e-6 * Math.max(s1 - s0, t1 - t0);
    s0 -= pad; s1 += pad; t0 -= pad; t1 += pad;

    // Spans along each side, more along the longer one; doubled while the points are missed, up to a cap.
    const smooth = optimize === 'smoothness';
    const base = Math.max(1, Math.round(Math.sqrt(points.length)) - 1) * (smooth ? 2 : 1);
    const aspect = (s1 - s0) / (t1 - t0), cap = smooth ? 16 : 8;
    const spansFor = f => [Math.sqrt(aspect), 1 / Math.sqrt(aspect)].map(r => Math.min(cap, Math.max(1, Math.round(base * f * r))));
    let fit = null;
    for (let f = 1; ; f *= 2) {
        const [ku, kv] = spansFor(f);
        const next = fitSpans(ku, kv);
        // A finer net that misses by more (the angle stopping it sooner) does not replace a coarser one.
        if (!fit || next.met || next.error < fit.error) fit = next;
        if (fit.met || (ku === cap || kv === cap) && spansFor(f * 2).every((k, i) => k === [ku, kv][i])) break;
    }
    const { ku, kv } = fit;
    return {
        degree: [DEGREE, DEGREE], uKnots: fit.uKnots, vKnots: fit.vKnots, poles: fit.poles,
        error: fit.error, fold: fit.fold, met: fit.met, spans: [ku, kv], plane,
        /** The surface's parameters (u, v) under point `p`. */
        uv: p => { const d = sub(p, plane.centre); return [(dot(d, plane.X) - s0) / (s1 - s0) * ku, (dot(d, plane.Y) - t0) / (t1 - t0) * kv]; },
    };

    function fitSpans(ku, kv) {
        const uKnots = clampedKnots(ku), vKnots = clampedKnots(kv);
        const nu = ku + DEGREE, nv = kv + DEGREE, n = nu * nv;
        const at = (i, j) => i * nv + j;
        const toU = s => (s - s0) / (s1 - s0) * ku, toV = t => (t - t0) / (t1 - t0) * kv;
        // The points' rows of the least-squares system: BᵀB and Bᵀz.
        const BtB = Array.from({ length: n }, () => new Float64Array(n)), Btz = new Float64Array(n);
        const rows = local.map(([s, t, z]) => {
            const bu = basisAt(uKnots, DEGREE, toU(s)), bv = basisAt(vKnots, DEGREE, toV(t));
            const row = [];
            bu.values.forEach((a, i) => bv.values.forEach((b, j) => row.push([at(bu.first + i, bv.first + j), a * b])));
            for (const [p, w] of row) { Btz[p] += w * z; for (const [q, x] of row) BtB[p][q] += w * x; }
            return row;
        });
        // The bending penalty RᵀR: second differences along u and v and the twist, in the net's own
        // spacing so the weight means the same whatever the size and span count.
        const hu = (s1 - s0) / ku, hv = (t1 - t0) / kv, RtR = Array.from({ length: n }, () => new Float64Array(n));
        const addRow = (terms, w) => { for (const [p, a] of terms) for (const [q, b] of terms) RtR[p][q] += w * a * b; };
        for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
            if (i > 0 && i < nu - 1) addRow([[at(i - 1, j), 1], [at(i, j), -2], [at(i + 1, j), 1]], 1 / hu ** 4);
            if (j > 0 && j < nv - 1) addRow([[at(i, j - 1), 1], [at(i, j), -2], [at(i, j + 1), 1]], 1 / hv ** 4);
            if (i < nu - 1 && j < nv - 1) addRow([[at(i, j), 1], [at(i + 1, j), -1], [at(i, j + 1), -1], [at(i + 1, j + 1), 1]], 2 / (hu * hv) ** 2);
        }
        // λ in units that balance the points' misses against the net's bending.
        const unitLambda = points.length / n * (hu * hv) ** 2;
        const gu = greville(uKnots, DEGREE), gv = greville(vKnots, DEGREE);
        const netOf = h => gu.map((u, i) => gv.map((v, j) => {
            const s = s0 + u / ku * (s1 - s0), t = t0 + v / kv * (t1 - t0), z = h[at(i, j)];
            return [0, 1, 2].map(k => plane.centre[k] + s * plane.X[k] + t * plane.Y[k] + z * plane.N[k]);
        }));
        const solveAt = lambda => {
            const A = BtB.map((r, p) => r.map((x, q) => x + lambda * RtR[p][q] + (p === q ? 1e-12 * (1 + BtB[p][p]) : 0)));
            const h = cholesky(A, Btz);
            const error = rows.reduce((most, row, k) => Math.max(most, Math.abs(row.reduce((s, [p, w]) => s + w * h[p], 0) - local[k][2])), 0);
            const height = (x, y) => {
                const bu = basisAt(uKnots, DEGREE, x * ku), bv = basisAt(vKnots, DEGREE, y * kv);
                let z = 0;
                bu.values.forEach((a, i) => bv.values.forEach((b, j) => { z += a * b * h[at(bu.first + i, bv.first + j)]; }));
                return z;
            };
            return { error, poles: netOf(h), fold: fieldFold(height, s1 - s0, t1 - t0) };
        };
        // Ease the penalty a decade at a time: the stiffest fit within Tolerance, while the surface
        // bends no more than Angular tolerance; failing that, the closest fit that still keeps to the angle.
        let closest = null;
        for (let k = 0; k <= 14; k++) {
            const fit = solveAt(unitLambda * 10 ** (2 - k));
            if (fit.fold > angular + 1e-9) { closest ??= fit; break; }
            closest = fit;
            if (fit.error <= tolerance) return { ...fit, met: true, ku, kv, uKnots, vKnots };
        }
        return { ...closest, met: false, ku, kv, uKnots, vKnots };
    }
}

/** A surface as the flat numbers the kernels' spline sheet reads: degrees, counts, knots, poles. */
export function splineSheetData({ degree, uKnots, vKnots, poles }) {
    return [degree[0], degree[1], poles.length, poles[0].length, uKnots.length, vKnots.length, ...uKnots, ...vKnots, ...poles.flat(2)];
}

/** A point of the surface at parameters (u, v), for checks. */
export function surfaceAt({ degree, uKnots, vKnots, poles }, u, v) {
    const bu = basisAt(uKnots, degree[0], u), bv = basisAt(vKnots, degree[1], v), out = [0, 0, 0];
    bu.values.forEach((a, i) => bv.values.forEach((b, j) => { const P = poles[bu.first + i][bv.first + j]; for (let k = 0; k < 3; k++) out[k] += a * b * P[k]; }));
    return out;
}
