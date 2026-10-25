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

/** A polyline as a function of its length fraction 0..1; with `values` (one per point), those interpolated instead. */
export function byLength(points, values = points) {
    const L = [0];
    for (let i = 1; i < points.length; i++) L.push(L[i - 1] + dist(points[i], points[i - 1]));
    const total = L[L.length - 1];
    if (!(total > 1e-9)) throw new Error('a side has no length');
    const at = s => {
        const x = Math.min(Math.max(s, 0), 1) * total;
        let lo = 0, hi = L.length - 1;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] <= x) lo = m; else hi = m; }
        const span = L[hi] - L[lo];
        return lerp(values[lo], values[hi], span > 0 ? (x - L[lo]) / span : 0);
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
    const left = sides.map(copy);
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
        loop.push(best.flip ? reversed(s) : s);
    }
    const closing = dist(loop.at(-1).at(-1), loop[0][0]);
    if (closing > gap) throw new Error(`the sides don't close: a gap of ${closing.toFixed(3)} mm`);
    return loop;
}

/** What a side may carry per point besides its position: the way out of its face, and for G2 the face's normal and its curvature that way (as [k, 0, 0]). */
const EXTRAS = ['out', 'normal', 'kappa'];
/** A side's copy, keeping its extras. */
function copy(side) {
    const c = side.map(p => [...p]);
    for (const k of EXTRAS) if (side[k]) c[k] = side[k].map(d => [...d]);
    return c;
}
/** A side the other way round. */
function reversed(side) {
    const c = [...side].reverse();
    for (const k of EXTRAS) if (side[k]) c[k] = [...side[k]].reverse();
    return c;
}
/** A side cut in two at half its length, its extras cut with it. */
function halves(side) {
    const at = byLength(side), half = at.total / 2;
    let run = 0, k = 1;
    for (; k < side.length - 1; k++) {
        const next = run + dist(side[k], side[k - 1]);
        if (next >= half) break;
        run = next;
    }
    // The cut lies on the piece from k - 1 to k, a fraction t along it.
    const piece = dist(side[k], side[k - 1]), t = piece > 0 ? (half - run) / piece : 0;
    const cut = values => lerp(values[k - 1], values[k], t);
    const a = [...side.slice(0, k).map(p => [...p]), cut(side)], b = [cut(side), ...side.slice(k).map(p => [...p])];
    for (const key of EXTRAS) if (side[key]) {
        const m = cut(side[key]);
        a[key] = [...side[key].slice(0, k).map(d => [...d]), m];
        b[key] = [m, ...side[key].slice(k).map(d => [...d])];
    }
    return [a, b];
}

/** For G2: the face's unit normal and normal curvature across the side at s, or null without them. */
const bendOf = side => {
    if (!side.out || !side.normal || !side.kappa) return null;
    const n = byLength(side, side.normal), k = byLength(side, side.kappa);
    return s => { const v = n(s), l = Math.hypot(...v); return { n: l > 0 ? mul(v, 1 / l) : v, k: k(s)[0] }; };
};
/** The way out of a side's face at its length fraction s, as a unit vector, or null for a curve. */
const outOf = side => {
    if (!side.out) return null;
    const f = byLength(side, side.out);
    return s => { const d = f(s), l = Math.hypot(...d); return l > 0 ? mul(d, 1 / l) : d; };
};

/** The surface the sides describe, as a function of (u, v) in 0..1. */
export function boundarySurface(sides, gap, tension = 1) {
    if (sides.length === 2) {
        // A loft: the second side runs the same way as the first.
        let [a, b] = sides;
        if (dist(a[0], b[0]) + dist(a.at(-1), b.at(-1)) > dist(a[0], b.at(-1)) + dist(a.at(-1), b[0])) b = reversed(b);
        const A = byLength(a), B = byLength(b), oa = outOf(a), ob = outOf(b);
        const sides2 = [A, null, B, null], outs = [oa, null, ob, null], bends = [bendOf(a), null, bendOf(b), null];
        if (!oa && !ob) return { at: (u, v) => lerp(A(u), B(u), v), sides: sides2, outs, bends };
        // Leaving each edge side along its face, as far out as the sides are apart (times tension).
        const at = (u, v) => {
            const pa = A(u), pb = B(u), chord = sub(pb, pa), reach = Math.hypot(...chord) * tension;
            return hermite(v, pa, pb, oa ? mul(oa(u), reach) : chord, ob ? mul(ob(u), -reach) : chord);
        };
        return { at, sides: sides2, outs, bends };
    }
    if (sides.length !== 4 && sides.length !== 3) throw new Error('select three or four sides meeting end to end, or two to loft between');
    // Three sides: the longest is split at its middle into two, making four with a straight corner there.
    let loop = orderLoop(sides, gap);
    if (loop.length === 3) {
        const longest = loop.reduce((best, side, i) => byLength(side).total > byLength(loop[best]).total ? i : best, 0);
        loop = loop.flatMap((side, i) => i === longest ? halves(side) : [side]);
    }
    const [s0, s1, s2, s3] = loop;
    // Bottom runs along u, right along v, top and left are the loop's last two sides turned round.
    const r2 = reversed(s2), r3 = reversed(s3);
    const bottom = byLength(s0), right = byLength(s1), top = byLength(r2), leftSide = byLength(r3);
    const outs = [outOf(s0), outOf(s1), outOf(r2), outOf(r3)], all = [bottom, right, top, leftSide];
    const bends = [bendOf(s0), bendOf(s1), bendOf(r2), bendOf(r3)];
    const P00 = bottom(0), P10 = bottom(1), P01 = top(0), P11 = top(1);
    if (!outs.some(Boolean)) {
        const at = (u, v) => {
            const ruledV = lerp(bottom(u), top(u), v), ruledU = lerp(leftSide(v), right(v), u);
            const corners = lerp(lerp(P00, P10, u), lerp(P01, P11, u), v);
            return sub(add(ruledV, ruledU), corners);
        };
        return { at, sides: all, outs, bends };
    }
    // With faces to carry on: a Hermite-blended Coons patch. Across each side the patch leaves along
    // the face's way out (or, for a curve side, as its neighbours do at its ends), as fast as the
    // neighbouring sides do at the corners, nudged at the corners to agree with those sides.
    const e = 1e-4, d = (f, x) => x < 0.5 ? mul(sub(f(x + e), f(x)), 1 / e) : mul(sub(f(x), f(x - e)), 1 / e);
    const dL0 = d(leftSide, 0), dL1 = d(leftSide, 1), dR0 = d(right, 0), dR1 = d(right, 1);
    const dB0 = d(bottom, 0), dB1 = d(bottom, 1), dT0 = d(top, 0), dT1 = d(top, 1);
    const len = v => Math.hypot(...v);
    // The cross derivative along a side: from its face (sign: +1 leaving into the sheet in the
    // parameter's direction, -1 against it), or straight between the corner derivatives.
    const across = (out, sign, c0, c1) => {
        if (!out) return t => lerp(c0, c1, t);
        const m0 = len(c0) * tension, m1 = len(c1) * tension;
        const fix0 = sub(c0, mul(out(0), sign * m0)), fix1 = sub(c1, mul(out(1), sign * m1));
        return t => add(mul(out(t), sign * ((1 - t) * m0 + t * m1)), lerp(fix0, fix1, t));
    };
    const Dv0 = across(outs[0], 1, dL0, dR0), Dv1 = across(outs[2], -1, dL1, dR1);
    const Du0 = across(outs[3], 1, dB0, dT0), Du1 = across(outs[1], -1, dB1, dT1);
    const RV = (u, v) => hermite(v, bottom(u), top(u), Dv0(u), Dv1(u));
    const RU = (u, v) => hermite(u, leftSide(v), right(v), Du0(v), Du1(v));
    const dRU = (u, v) => d(t => RU(u, t), v);
    const at = (u, v) => {
        const T = hermite(v, RU(u, 0), RU(u, 1), dRU(u, 0), dRU(u, 1));
        return sub(add(RV(u, v), RU(u, v)), T);
    };
    return { at, sides: all, outs, bends };
}

/** The cubic Hermite curve from `a` to `b` leaving with derivative `da` and arriving with `db`, at t. */
function hermite(t, a, b, da, db) {
    const t2 = t * t, t3 = t2 * t;
    return add(add(mul(a, 2 * t3 - 3 * t2 + 1), mul(b, 3 * t2 - 2 * t3)), add(mul(da, t3 - 2 * t2 + t), mul(db, t3 - t2)));
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
 * `tolerance` the side gap auto spans aim for and the gap the sides' ends may have. `continuity`
 * is 'FREE' (one span each way unless set: near the sides, not on them), 'G0', 'G1' or 'G2'.
 * `flatness` 0 to 1 pulls the inner control points (those the sides and continuity leave free)
 * toward the plane of the boundary, 1 onto it.
 */
export function square(sides, { degree = 3, spans = 0, tolerance = 0.01, continuity = 'G0', angle = 0.5, tension = 1, flatness = 0 } = {}) {
    if (!(degree >= 1 && degree <= 7)) throw new Error('the degree runs from 1 to 7');
    const curved = continuity === 'G2', tangent = continuity === 'G1' || curved;
    if (tangent && degree < 2) throw new Error(`${continuity} needs degree 2 or more`);
    if (curved && degree < 3) throw new Error('G2 needs degree 3 or more');
    // Control points each way that G1 (two rows from each side) or G2 (three) needs.
    const rows = curved ? 6 : tangent ? 4 : 2;
    const size = Math.max(...sides.flat().map(p => dist(p, sides[0][0])));
    const shape = boundarySurface(sides, Math.max(tolerance, 1e-3 * size), tension);
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
        // A loft's open ends (no side there) leave their end columns free to follow too.
        const open = shape.sides.map(x => !x);
        if (tangent) tangentRows(poles, uk, vk, degree, shape.outs, open);
        if (curved) curvatureRows(poles, uk, vk, degree, shape.bends, open);
        if (flatness > 0) flatten(poles, Math.min(1, flatness), rowsU / 2, rowsV / 2);
        const out = { degree: [degree, degree], uKnots: uk, vKnots: vk, poles, spans: [su, sv] };
        out.gap = sideGap(out, shape.sides);
        out.turn = tangent ? sideTurn(out, shape.outs) : 0;
        out.bend = curved ? sideBend(out, shape.bends) : 0;
        return out;
    };
    // Only a direction with held edge sides at its ends needs them: u for the right and left sides.
    const rowsU = shape.outs[1] || shape.outs[3] ? rows : 2, rowsV = shape.outs[0] || shape.outs[2] ? rows : 2;
    // Free: the sides only guide the sheet (corners held), one span each way unless set, for a
    // clean surface with few control points rather than one on the sides.
    if (continuity === 'Free' || continuity === 'FREE') spans = spans || 1;
    if (spans) {
        const [su, sv] = Array.isArray(spans) ? spans : [spans, spans];
        if (su + degree < rowsU || sv + degree < rowsV) throw new Error(`${continuity} needs more spans: at least ${rows} control points across the edge sides`);
        return make(su, sv);
    }
    let out;
    for (let s = Math.max(1, Math.max(rowsU, rowsV) - degree); s <= 64; s *= 2) {
        out = make(s, s);
        if (out.gap <= tolerance && out.turn <= angle && out.bend <= bendTolerance(shape.bends)) break;
    }
    return out;
}

/**
 * Flatness: the poles `ku` rows in from the u ends and `kv` in from the v ends and beyond move a
 * fraction `f` of the way to the boundary ring's mean plane (Newell's normal through its centre).
 */
function flatten(poles, f, ku, kv) {
    const nu = poles.length, nv = poles[0].length;
    const ring = [...poles.map(r => r[0]), ...poles[nu - 1].slice(1), ...poles.map(r => r[nv - 1]).reverse().slice(1), ...poles[0].slice(1, -1).reverse()];
    const c = [0, 1, 2].map(k => ring.reduce((a, p) => a + p[k], 0) / ring.length);
    const n = [0, 0, 0];
    ring.forEach((p, i) => {
        const q = ring[(i + 1) % ring.length];
        n[0] += (p[1] - q[1]) * (p[2] + q[2]); n[1] += (p[2] - q[2]) * (p[0] + q[0]); n[2] += (p[0] - q[0]) * (p[1] + q[1]);
    });
    const len = Math.hypot(...n);
    if (len < 1e-12) return;
    const u = n.map(x => x / len);
    for (let i = ku; i <= nu - 1 - ku; i++) {
        for (let j = kv; j <= nv - 1 - kv; j++) {
            const p = poles[i][j], h = (p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1] + (p[2] - c[2]) * u[2];
            poles[i][j] = p.map((x, k) => x - f * h * u[k]);
        }
    }
}

/** Greville abscissae of knots `t`, degree `p`. */
const greville = (t, p) => Array.from({ length: t.length - p - 1 }, (_, i) => t.slice(i + 1, i + p + 1).reduce((a, b) => a + b, 0) / p);

/**
 * G1 to the faces along edge sides: the second row of poles in from each such side is turned to
 * leave the side along the face's way out (the face's tangent plane, carried on past the edge),
 * keeping its reach. A pole that two sides both move (next to a corner) takes the average.
 */
function tangentRows(poles, uk, vk, p, outs, open = []) {
    const nu = poles.length, nv = poles[0].length, gu = greville(uk, p), gv = greville(vk, p);
    const moves = new Map();
    const propose = (i, j, from, d) => {
        const reach = dist(poles[i][j], from);
        const at = add(from, mul(d, reach));
        const k = `${i},${j}`, m = moves.get(k) ?? { i, j, sum: [0, 0, 0], n: 0 };
        m.sum = add(m.sum, at); m.n++;
        moves.set(k, m);
    };
    // Bottom (v = 0) and top (v = 1) run along u; right (u = 1) and left (u = 0) along v.
    const [i0, i1, j0, j1] = [open[3] ? 0 : 1, open[1] ? nu : nu - 1, open[0] ? 0 : 1, open[2] ? nv : nv - 1];
    if (outs[0]) for (let i = i0; i < i1; i++) propose(i, 1, poles[i][0], outs[0](gu[i]));
    if (outs[2]) for (let i = i0; i < i1; i++) propose(i, nv - 2, poles[i][nv - 1], outs[2](gu[i]));
    if (outs[1]) for (let j = j0; j < j1; j++) propose(nu - 2, j, poles[nu - 1][j], outs[1](gv[j]));
    if (outs[3]) for (let j = j0; j < j1; j++) propose(1, j, poles[0][j], outs[3](gv[j]));
    for (const { i, j, sum, n } of moves.values()) poles[i][j] = mul(sum, 1 / n);
}

/**
 * G2 to the faces along edge sides (after {@link tangentRows}): the third row of poles in from each
 * such side is moved square to the face, only, so the sheet bends across the side as the face does
 * (its normal curvature that way). At the side, the second derivative across is
 * p(p-1) / ((t[p+1] - t[2]) (t[p+2] - t[2])) · (P2 - P1) along the normal once P1 - P0 lies in the
 * tangent plane, and the curvature is that over the first derivative's length squared,
 * p (P1 - P0) / (t[p+1] - t[1]). Poles that two sides move take the average.
 */
function curvatureRows(poles, uk, vk, p, bends, open = []) {
    const nu = poles.length, nv = poles[0].length, gu = greville(uk, p), gv = greville(vk, p);
    const flipKnots = t => t.map(x => 1 - x).reverse();
    const moves = new Map();
    const propose = (P0, P1, P2, i, j, t, bend) => {
        const { n, k } = bend;
        const d1 = p / (t[p + 1] - t[1]), first = mul(sub(P1, P0), d1);
        const want = k * (first[0] ** 2 + first[1] ** 2 + first[2] ** 2) * (t[p + 1] - t[2]) * (t[p + 2] - t[2]) / (p * (p - 1));
        const off = sub(P2, P1), now = off[0] * n[0] + off[1] * n[1] + off[2] * n[2];
        const at = add(P2, mul(n, want - now));
        const key = `${i},${j}`, m = moves.get(key) ?? { i, j, sum: [0, 0, 0], n: 0 };
        m.sum = add(m.sum, at); m.n++;
        moves.set(key, m);
    };
    const rv = flipKnots(vk), ru = flipKnots(uk);
    const [i0, i1, j0, j1] = [open[3] ? 0 : 1, open[1] ? nu : nu - 1, open[0] ? 0 : 1, open[2] ? nv : nv - 1];
    if (bends[0]) for (let i = i0; i < i1; i++) propose(poles[i][0], poles[i][1], poles[i][2], i, 2, vk, bends[0](gu[i]));
    if (bends[2]) for (let i = i0; i < i1; i++) propose(poles[i][nv - 1], poles[i][nv - 2], poles[i][nv - 3], i, nv - 3, rv, bends[2](gu[i]));
    if (bends[1]) for (let j = j0; j < j1; j++) propose(poles[nu - 1][j], poles[nu - 2][j], poles[nu - 3][j], nu - 3, j, ru, bends[1](gv[j]));
    if (bends[3]) for (let j = j0; j < j1; j++) propose(poles[0][j], poles[1][j], poles[2][j], 2, j, uk, bends[3](gv[j]));
    for (const { i, j, sum, n } of moves.values()) poles[i][j] = mul(sum, 1 / n);
}

/** How far the sheet's curvature across a side may miss the face's: 1% of the largest, at least 1e-5 per mm. */
function bendTolerance(bends) {
    let most = 0;
    for (const b of bends) if (b) for (let i = 0; i <= 8; i++) most = Math.max(most, Math.abs(b(i / 8).k));
    return Math.max(1e-5, 0.01 * most);
}

/** The largest difference (per mm) between the sheet's normal curvature across an edge side and its face's. */
function sideBend(surface, bends, n = 32) {
    const e = 1e-4;
    const sides = [[s => [s, 0], [0, 1]], [s => [1, s], [-1, 0]], [s => [s, 1], [0, -1]], [s => [0, s], [1, 0]]];
    let most = 0;
    sides.forEach(([uv, inward], k) => {
        if (!bends[k]) return;
        for (let i = 1; i < n; i++) {
            const s = i / n, [u, v] = uv(s), { n: N, k: want } = bends[k](s);
            const [f0, f1, f2, f3] = [0, 1, 2, 3].map(h => surfaceAt(surface, u + h * e * inward[0], v + h * e * inward[1]));
            // Second-order one-sided differences into the sheet: first and second derivatives across.
            const d1 = [0, 1, 2].map(c => (-3 * f0[c] + 4 * f1[c] - f2[c]) / (2 * e));
            const d2 = [0, 1, 2].map(c => (2 * f0[c] - 5 * f1[c] + 4 * f2[c] - f3[c]) / (e * e));
            const l2 = d1[0] ** 2 + d1[1] ** 2 + d1[2] ** 2;
            if (l2 < 1e-18) continue;
            most = Math.max(most, Math.abs((d2[0] * N[0] + d2[1] * N[1] + d2[2] * N[2]) / l2 - want));
        }
    });
    return most;
}

/** The largest angle in degrees by which the sheet leaves an edge side out of the face's tangent plane. */
function sideTurn(surface, outs, n = 48) {
    const e = 1e-4;
    const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    // For each side: where along it, the parameters there, and which way is across into the sheet.
    const sides = [
        [s => [s, 0], [0, 1], [1, 0]], [s => [1, s], [-1, 0], [0, 1]],
        [s => [s, 1], [0, -1], [1, 0]], [s => [0, s], [1, 0], [0, 1]],
    ];
    let most = 0;
    sides.forEach(([uv, inward, along], k) => {
        if (!outs[k]) return;
        for (let i = 1; i < n; i++) {
            const s = i / n, [u, v] = uv(s), P = surfaceAt(surface, u, v);
            const A = surfaceAt(surface, u + e * along[0], v + e * along[1]);
            const I = surfaceAt(surface, u + e * inward[0], v + e * inward[1]);
            const T = sub(A, P), X = sub(I, P), d = outs[k](s);
            const N = cross3(T, d), ln = Math.hypot(...N), lx = Math.hypot(...X);
            if (ln < 1e-14 || lx < 1e-14) continue;
            most = Math.max(most, Math.asin(Math.min(1, Math.abs(N[0] * X[0] + N[1] * X[1] + N[2] * X[2]) / (ln * lx))) * 180 / Math.PI);
        }
    });
    return most;
}
