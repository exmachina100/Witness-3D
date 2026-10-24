// Plasticity's Square: a four-sided B-spline surface on boundary curves and edges, with its Degree
// and Spans chosen. Four sides meeting end to end fill as a Coons patch (each side exact in the
// blend, the corners counted once); two sides that don't touch loft straight between them. The
// patch is then fitted to a clamped B-spline of the chosen degree and spans by least squares over a
// grid, with the boundary rows fitted first and held, so the sheet's sides follow the sides given;
// with Spans at 0 (auto) the spans double until every side is within the gap allowed.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const lerp = (a, b, t) => add(mul(a, 1 - t), mul(b, t));

/** A polyline as a function of its length fraction 0..1. */
export function byLength(points) {
    const L = [0];
    for (let i = 1; i < points.length; i++) L.push(L[i - 1] + dist(points[i], points[i - 1]));
    const total = L[L.length - 1];
    if (!(total > 1e-9)) throw new Error('a side has no length');
    const at = s => {
        const x = Math.min(Math.max(s, 0), 1) * total;
        let lo = 0, hi = L.length - 1;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] <= x) lo = m; else hi = m; }
        const span = L[hi] - L[lo];
        return lerp(points[lo], points[hi], span > 0 ? (x - L[lo]) / span : 0);
    };
    at.total = total;
    return at;
}

/**
 * The sides (polylines) put in order round the loop, each running on from the one before: the
 * first as given, then whichever side starts or ends where the last one stopped. `gap` is how far
 * apart ends may be and still meet.
 */
export function orderLoop(sides, gap) {
    const left = sides.map(s => s.map(p => [...p]));
    const loop = [left.shift()];
    while (left.length) {
        const end = loop[loop.length - 1].at(-1);
        let best = null;
        left.forEach((s, i) => {
            for (const flip of [false, true]) {
                const d = dist(flip ? s.at(-1) : s[0], end);
                if (!best || d < best.d) best = { d, i, flip };
            }
        });
        if (best.d > gap) throw new Error(`the sides don't meet end to end: a gap of ${best.d.toFixed(3)} mm`);
        const [s] = left.splice(best.i, 1);
        loop.push(best.flip ? s.reverse() : s);
    }
    const closing = dist(loop.at(-1).at(-1), loop[0][0]);
    if (closing > gap) throw new Error(`the sides don't close: a gap of ${closing.toFixed(3)} mm`);
    return loop;
}

/** The surface the sides describe, as a function of (u, v) in 0..1. */
export function boundarySurface(sides, gap) {
    if (sides.length === 2) {
        // A loft: the second side runs the same way as the first.
        let [a, b] = sides;
        if (dist(a[0], b[0]) + dist(a.at(-1), b.at(-1)) > dist(a[0], b.at(-1)) + dist(a.at(-1), b[0])) b = [...b].reverse();
        const A = byLength(a), B = byLength(b);
        return { at: (u, v) => lerp(A(u), B(u), v), sides: [A, null, B, null] };
    }
    if (sides.length !== 4) throw new Error('select four sides meeting end to end, or two to loft between');
    const [s0, s1, s2, s3] = orderLoop(sides, gap);
    // Bottom runs along u, right along v, top and left are the loop's last two sides turned round.
    const bottom = byLength(s0), right = byLength(s1), top = byLength([...s2].reverse()), leftSide = byLength([...s3].reverse());
    const P00 = bottom(0), P10 = bottom(1), P01 = top(0), P11 = top(1);
    const at = (u, v) => {
        const ruledV = lerp(bottom(u), top(u), v), ruledU = lerp(leftSide(v), right(v), u);
        const corners = lerp(lerp(P00, P10, u), lerp(P01, P11, u), v);
        return sub(add(ruledV, ruledU), corners);
    };
    return { at, sides: [bottom, right, top, leftSide] };
}

/** A clamped uniform knot vector of `spans` spans for degree `p`, over 0..1. */
const knots = (spans, p) => [...Array(p + 1).fill(0), ...Array.from({ length: spans - 1 }, (_, i) => (i + 1) / spans), ...Array(p + 1).fill(1)];

/** The degree-`p` basis functions of `t` at `x`, all of them (zeros included). */
function basisRow(t, p, x) {
    const n = t.length - p - 1;
    x = Math.min(Math.max(x, 0), 1);
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
    const row = new Array(n).fill(0);
    for (let j = 0; j <= p; j++) row[s - p + j] = N[j];
    return row;
}

/** Least squares for the poles of rows `B` (samples × poles) against values `Q` (samples × k), poles in `fixed` (index → value) held. */
function fit(B, Q, fixed = new Map()) {
    const n = B[0].length, free = [...Array(n).keys()].filter(i => !fixed.has(i)), at = new Map(free.map((i, j) => [i, j]));
    const k = Q[0].length, A = free.map(() => new Array(free.length).fill(0)), R = free.map(() => new Array(k).fill(0));
    B.forEach((row, s) => {
        const q = [...Q[s]];
        for (const [i, val] of fixed) if (row[i]) for (let c = 0; c < k; c++) q[c] -= row[i] * val[c];
        for (const i of free) {
            if (!row[i]) continue;
            const a = at.get(i);
            for (const j of free) if (row[j]) A[a][at.get(j)] += row[i] * row[j];
            for (let c = 0; c < k; c++) R[a][c] += row[i] * q[c];
        }
    });
    // Gaussian elimination with partial pivoting.
    const m = free.length, M = A.map((r, i) => [...r, ...R[i]]);
    for (let c = 0; c < m; c++) {
        let piv = c;
        for (let r = c + 1; r < m; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
        if (Math.abs(M[piv][c]) < 1e-14) throw new Error('too many spans for the sides: try fewer');
        [M[c], M[piv]] = [M[piv], M[c]];
        for (let r = 0; r < m; r++) {
            if (r === c || !M[r][c]) continue;
            const f = M[r][c] / M[c][c];
            for (let x = c; x < m + k; x++) M[r][x] -= f * M[c][x];
        }
    }
    const out = new Array(n);
    for (const [i, val] of fixed) out[i] = val;
    free.forEach((i, j) => { out[i] = M[j].slice(m).map(v => v / M[j][j]); });
    return out;
}

/** The largest distance between the sheet's sides and the sides given, sampled. */
function sideGap(surface, sides, n = 64) {
    const edges = [[u => [u, 0]], [v => [1, v]], [u => [u, 1]], [v => [0, v]]];
    let most = 0;
    sides.forEach((side, k) => {
        if (!side) return;
        for (let i = 0; i <= n; i++) {
            const [u, v] = edges[k][0](i / n);
            most = Math.max(most, dist(surfaceAt(surface, u, v), side(i / n)));
        }
    });
    return most;
}

/** A point of the fitted surface at (u, v) in 0..1. */
export function surfaceAt({ degree, uKnots, vKnots, poles }, u, v) {
    const bu = basisRow(uKnots, degree[0], u), bv = basisRow(vKnots, degree[1], v), out = [0, 0, 0];
    bu.forEach((a, i) => { if (a) bv.forEach((b, j) => { if (b) { const P = poles[i][j]; out[0] += a * b * P[0]; out[1] += a * b * P[1]; out[2] += a * b * P[2]; } }); });
    return out;
}

/**
 * Plasticity's Square on `sides` (polylines, [x, y, z] points): { degree, uKnots, vKnots, poles,
 * spans, gap (largest miss along the sides, mm) }. `degree` 1 to 7; `spans` [u, v], or 0 for auto;
 * `tolerance` the side gap auto spans aim for and the gap the sides' ends may have.
 */
export function square(sides, { degree = 3, spans = 0, tolerance = 0.01 } = {}) {
    if (!(degree >= 1 && degree <= 7)) throw new Error('the degree runs from 1 to 7');
    const size = Math.max(...sides.flat().map(p => dist(p, sides[0][0])));
    const shape = boundarySurface(sides, Math.max(tolerance, 1e-3 * size));
    const make = (su, sv) => {
        const uk = knots(su, degree), vk = knots(sv, degree), nu = su + degree, nv = sv + degree;
        const mu = 4 * su + degree + 1, mv = 4 * sv + degree + 1;
        const us = Array.from({ length: mu }, (_, i) => i / (mu - 1)), vs = Array.from({ length: mv }, (_, j) => j / (mv - 1));
        const Bu = us.map(u => basisRow(uk, degree, u)), Bv = vs.map(v => basisRow(vk, degree, v));
        const G = us.map(u => vs.map(v => shape.at(u, v)));
        // The four boundary rows first, from the sides alone, corners held by the first two.
        const ends = (row, B) => new Map([[0, row[0]], [B[0].length - 1, row[row.length - 1]]]);
        const rowV0 = fit(Bu, G.map(r => r[0]), ends(G.map(r => r[0]), Bu)), rowV1 = fit(Bu, G.map(r => r[mv - 1]), ends(G.map(r => r[mv - 1]), Bu));
        const colU0 = fit(Bv, G[0], new Map([[0, rowV0[0]], [nv - 1, rowV1[0]]])), colU1 = fit(Bv, G[mu - 1], new Map([[0, rowV0[nu - 1]], [nv - 1, rowV1[nu - 1]]]));
        // Then each grid row along v, its ends held to the boundary columns, then along u.
        const C = G.map(row => fit(Bv, row, new Map([[0, row[0]], [nv - 1, row[mv - 1]]])));
        const poles = Array.from({ length: nu }, () => new Array(nv));
        for (let j = 0; j < nv; j++) {
            const held = new Map([[0, colU0[j]], [nu - 1, colU1[j]]]);
            if (j === 0) rowV0.forEach((P, i) => held.set(i, P));
            if (j === nv - 1) rowV1.forEach((P, i) => held.set(i, P));
            const column = fit(Bu, C.map(r => r[j]), held);
            for (let i = 0; i < nu; i++) poles[i][j] = column[i];
        }
        const out = { degree: [degree, degree], uKnots: uk, vKnots: vk, poles, spans: [su, sv] };
        out.gap = sideGap(out, shape.sides);
        return out;
    };
    if (spans) return make(...(Array.isArray(spans) ? spans : [spans, spans]));
    let out;
    for (let s = 1; s <= 64; s *= 2) {
        out = make(s, s);
        if (out.gap <= tolerance) break;
    }
    return out;
}
