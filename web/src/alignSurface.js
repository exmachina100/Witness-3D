// Plasticity's Align Surface: the side of a B-spline sheet along one edge (the target) moved to meet
// another edge (the reference) in position (G0), tangent (G1) or curvature (G2), by moving the first
// one, two or three rows of control points across that side. Shared by both builds: each kernel
// reports the faces along an edge (edge_faces, read by readEdgeFaces) and moves the poles.
//
// Along the side the new rows are fitted through the reference at the side's Greville abscissae
// (one point per control point, so the fit is exact there), matched by length along each edge. G1
// keeps how fast the sheet leaves its side but lays that direction into the reference's tangent
// plane (times the tension); G2 also gives the sheet the reference's normal curvature that way.

import { BOUNDARY, nearlyFlat } from './square.js';

const sub = (a, b) => a.map((v, i) => v - b[i]);
const add = (a, b) => a.map((v, i) => v + b[i]);
const mul = (a, s) => a.map(v => v * s);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(...a);
const dist = (a, b) => len(sub(a, b));
const unit = a => mul(a, 1 / len(a));

/** Continuity names in the order Tab cycles them. */
export const ALIGN_CONTINUITY = ['G0', 'G1', 'G2'];

/** Numbers per point in a face's frames: the point, Su, Sv, Suu, Suv, Svv (3 each) and the normal's sign. */
export const FRAME = 19;

/**
 * The faces along an edge, as the kernels report them (w3d_edge_faces on the desktop, edgeFaces in
 * the browser): [count, then per face: its number, a point in its middle (3), then 1 and its
 * B-spline (du, dv, nu, nv, the counts of u and v knots, the knots spelled out (flat), 1 if
 * rational, the poles u slowest) or 0, then FRAME numbers per point asked about, the point
 * projected onto the face's surface]. Returns [{ face, middle, spline, frames }].
 */
export function readEdgeFaces(raw, count) {
    let k = 0;
    const take = n => {
        if (k + n > raw.length) throw new Error('the edge gave too little geometry');
        const out = raw.slice(k, k + n);
        k += n;
        return out;
    };
    const [faces] = take(1);
    return Array.from({ length: faces }, () => {
        const [face] = take(1), middle = take(3), [has] = take(1);
        let spline = null;
        if (has) {
            const [du, dv, nu, nv, nku, nkv] = take(6);
            const uk = take(nku), vk = take(nkv), [rational] = take(1);
            const flat = take(nu * nv * 3);
            const poles = Array.from({ length: nu }, (_, a) => Array.from({ length: nv }, (_, c) => flat.slice(3 * (a * nv + c), 3 * (a * nv + c) + 3)));
            spline = { du, dv, uk, vk, rational: !!rational, poles };
        }
        const frames = Array.from({ length: count }, () => {
            const f = take(FRAME);
            return { at: f.slice(0, 3), su: f.slice(3, 6), sv: f.slice(6, 9), suu: f.slice(9, 12), suv: f.slice(12, 15), svv: f.slice(15, 18), sign: f[18] };
        });
        return { face, middle, spline, frames };
    });
}

/** All `n` B-spline basis functions of degree `p` on the flat knots `t` at `x`, and their first derivatives. */
export function basis(t, p, x) {
    const n = t.length - p - 1;
    const lo = t[p], hi = t[n];
    x = Math.min(Math.max(x, lo), hi);
    // The span: t[s] <= x < t[s + 1], the last one closed.
    let s = p;
    while (s < n - 1 && x >= t[s + 1]) s++;
    const N = [], dN = [];
    // Degree 0 up to p - 1, then p, keeping the p - 1 level for the derivative.
    let row = Array(t.length - 1).fill(0);
    row[s] = 1;
    let prev = row;
    for (let d = 1; d <= p; d++) {
        prev = row;
        row = Array(t.length - 1 - d).fill(0);
        for (let i = 0; i < row.length; i++) {
            const a = t[i + d] - t[i], b = t[i + d + 1] - t[i + 1];
            row[i] = (a > 0 ? (x - t[i]) / a * prev[i] : 0) + (b > 0 ? (t[i + d + 1] - x) / b * prev[i + 1] : 0);
        }
    }
    for (let i = 0; i < n; i++) {
        N.push(row[i]);
        if (p === 0) { dN.push(0); continue; }
        const a = t[i + p] - t[i], b = t[i + p + 1] - t[i + 1];
        dN.push((a > 0 ? p / a * prev[i] : 0) - (b > 0 ? p / b * prev[i + 1] : 0));
    }
    return { N, dN };
}

/** `A` x = `b` for a small dense square system, b a list of 3-vectors. Gaussian elimination with pivoting. */
function solve(A, b) {
    const n = A.length, M = A.map((r, i) => [...r, ...b[i]]);
    for (let c = 0; c < n; c++) {
        let piv = c;
        for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
        if (Math.abs(M[piv][c]) < 1e-14) throw new Error('the side could not be fitted to the reference');
        [M[c], M[piv]] = [M[piv], M[c]];
        for (let r = 0; r < n; r++) {
            if (r === c) continue;
            const f = M[r][c] / M[c][c];
            if (f) for (let k = c; k < n + 3; k++) M[r][k] -= f * M[c][k];
        }
    }
    return M.map((r, i) => [r[n] / r[i], r[n + 1] / r[i], r[n + 2] / r[i]]);
}

/** A point of a clamped B-spline curve (`poles`, flat knots `t`, degree `p`) at `x`. */
export const curveAt = (poles, t, p, x) => basis(t, p, x).N.reduce((s, w, i) => w ? add(s, mul(poles[i], w)) : s, [0, 0, 0]);

/** Cumulative lengths of a polyline, ending in the total. */
function lengths(pts) {
    const out = [0];
    for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + dist(pts[i], pts[i - 1]));
    return out;
}
/** The point at length fraction `f` along a polyline with cumulative lengths `L`. */
function pointAt(pts, L, f) {
    const s = Math.min(Math.max(f, 0), 1) * L.at(-1);
    let k = 1;
    while (k < pts.length - 1 && L[k] < s) k++;
    const span = L[k] - L[k - 1] || 1, a = (s - L[k - 1]) / span;
    return add(pts[k - 1], mul(sub(pts[k], pts[k - 1]), a));
}

/**
 * The side of `spline` that the edge through `along` (points along the target edge) runs on, laid
 * out to align: rows[i][j] i across from the side (0 on it), j along; the knots and degree each
 * way; and where each pole sits in the face's own numbering.
 */
export function sideOf(spline, along) {
    const { du, dv, uk, vk, poles } = spline;
    if (spline.rational) throw new Error('Align works on non-rational B-spline sheets; rebuild the face first');
    const nu = poles.length, nv = poles[0].length;
    const sides = [0, 1, 2, 3].map(side => {
        const inU = side < 2, last = side % 2 === 1;
        // Rows across the side (i), each a list along it (j), and the pole numbers.
        const rows = [], ids = [];
        const n = inU ? nu : nv, m = inU ? nv : nu;
        for (let i = 0; i < n; i++) {
            const a = last ? n - 1 - i : i;
            rows.push(Array.from({ length: m }, (_, j) => inU ? poles[a][j] : poles[j][a]));
            ids.push(Array.from({ length: m }, (_, j) => inU ? a * nv + j : j * nv + a));
        }
        const acrossK = inU ? uk : vk, alongK = inU ? vk : uk;
        const lo = acrossK[0], hi = acrossK.at(-1);
        return { side, rows, ids, p: inU ? du : dv, q: inU ? dv : du, across: last ? [...acrossK].reverse().map(k => lo + hi - k) : [...acrossK], along: [...alongK] };
    });
    // The side whose edge curve passes nearest the edge's points.
    const scored = sides.map(s => {
        const edge = s.rows[0];
        let worst = 0;
        for (const p of along) {
            let best = Infinity;
            for (let k = 0; k <= 64; k++) {
                const x = s.along[s.q] + (s.along.at(-1 - s.q) - s.along[s.q]) * k / 64;
                best = Math.min(best, dist(curveAt(edge, s.along, s.q, x), p));
            }
            worst = Math.max(worst, best);
        }
        return { s, worst };
    }).sort((a, b) => a.worst - b.worst);
    const size = Math.max(...poles.flat().map(p => len(sub(p, poles[0][0])))) || 1;
    if (scored[0].worst > size * 0.02 + 1e-3) throw new Error('pick an edge along a side of the B-spline sheet to align');
    return scored[0].s;
}

/**
 * Where the reference meets the target side: per pole along the side, its Greville abscissa on the
 * side and the reference point at the same fraction of length (the edges matched end to end the
 * way they lie). `refAlong` is points along the reference edge in order.
 */
export function alignPoints(side, refAlong) {
    const { rows, along, q } = side, m = rows[0].length;
    const greville = Array.from({ length: m }, (_, j) => along.slice(j + 1, j + q + 1).reduce((s, k) => s + k, 0) / q || along[j]);
    const x0 = along[q], x1 = along.at(-1 - q);
    const tPts = Array.from({ length: 257 }, (_, k) => curveAt(rows[0], along, q, x0 + (x1 - x0) * k / 256));
    const tL = lengths(tPts);
    let ref = refAlong;
    if (dist(tPts[0], ref.at(-1)) + dist(tPts.at(-1), ref[0]) < dist(tPts[0], ref[0]) + dist(tPts.at(-1), ref.at(-1))) ref = [...ref].reverse();
    const rL = lengths(ref);
    if (!(rL.at(-1) > 1e-9) || !(tL.at(-1) > 1e-9)) throw new Error('an edge has no length');
    // The fraction of length at each abscissa, from a fine table of the side.
    const fraction = x => {
        const a = (x - x0) / (x1 - x0) * 256, k = Math.min(255, Math.max(0, Math.floor(a)));
        return (tL[k] + (tL[k + 1] - tL[k]) * (a - k)) / tL.at(-1);
    };
    return { greville, points: greville.map(x => pointAt(ref, rL, fraction(x))) };
}

/** The normal curvature of a surface (frame f, unit normal n) in tangent direction e. */
export function normalCurvature(f, n, e) {
    const E = dot(f.su, f.su), F = dot(f.su, f.sv), G = dot(f.sv, f.sv);
    const det = E * G - F * F;
    if (!(Math.abs(det) > 1e-18)) return 0;
    // e = a Su + b Sv (e lies in the tangent plane).
    const eu = dot(e, f.su), ev = dot(e, f.sv);
    const a = (G * eu - F * ev) / det, b = (E * ev - F * eu) / det;
    const II = a * a * dot(f.suu, n) + 2 * a * b * dot(f.suv, n) + b * b * dot(f.svv, n);
    const I = a * a * E + 2 * a * b * F + b * b * G;
    return I > 1e-18 ? II / I : 0;
}

/**
 * The pole moves that align `side` (from sideOf) to the reference: `points` and `greville` from
 * alignPoints, `frames` the reference face's frames at those points. Returns [[pole, [dx, dy, dz]]]
 * with poles in the face's own numbering.
 */
export function alignMoves(side, { greville, points }, frames, { continuity = 'G1', tension = 1, blend = 0, influence = 0, partial = [0, 1], boundary = 'natural' } = {}) {
    // Perpendicular (Project Align): the sheet leaves its side square to the reference, as fast as now.
    const perpendicular = continuity === 'PERP';
    const order = perpendicular ? 1 : ALIGN_CONTINUITY.indexOf(continuity);
    if (order < 0) throw new Error('the continuity is G0, G1 or G2');
    if (!(tension > 0) || !Number.isFinite(tension)) throw new Error('the tension must be greater than zero');
    if (!Number.isInteger(blend) || blend < 0) throw new Error('the blend rows are a whole number, 0 or more');
    if (!(influence >= 0 && influence <= 1)) throw new Error('the input shape influence runs from 0 to 1');
    const [p0, p1] = partial;
    if (!(p0 >= 0 && p1 <= 1 && p0 < p1)) throw new Error('the partial start and end run from 0 to 1, start before end');
    if (!BOUNDARY.includes(boundary)) throw new Error('the boundary is Natural, Normal, Next or Adjacent');
    const { rows, ids, along, q, across: A, p } = side;
    if (rows.length < order + 1) throw new Error(`${continuity} needs ${order + 1} rows of control points across the side; raise the degree or rebuild the face first`);
    if (order === 2 && p < 2) throw new Error('G2 needs a surface of degree 2 or more across the side; raise the degree first');
    const B = greville.map(x => basis(along, q, x).N);
    const at = (row, j) => B[j].reduce((s, w, k) => w ? add(s, mul(row[k], w)) : s, [0, 0, 0]);
    const out = rows.map(r => r.map(v => [...v]));
    // G0: the side through the reference.
    out[0] = solve(B, points);
    if (order >= 1) {
        const a = p / (A[p + 1] - A[1]);
        const want = greville.map((_, j) => {
            const f = frames[j], n = unit(cross(f.su, f.sv));
            const c = mul(sub(at(rows[1], j), at(rows[0], j)), a);
            if (perpendicular) return { n, d: mul(n, (dot(c, n) < 0 ? -1 : 1) * len(c) * tension) };
            let d = sub(c, mul(n, dot(c, n)));
            if (len(d) < 1e-9 * (len(c) + 1)) throw new Error('the sheet leaves its side square to the reference there; G1 cannot lay it flat');
            d = mul(unit(d), len(c) * tension);
            return { n, d };
        });
        const D = solve(B, want.map(w => mul(w.d, 1 / a)));
        out[1] = out[0].map((v, k) => add(v, D[k]));
        if (order >= 2) {
            // The second derivative across the clamped side from the first three rows (per column).
            const c1 = (A[p + 1] - A[2]) / (p - 1), c2 = (A[p + 2] - A[2]) / p;
            const second = R => R[0].map((_, k) => {
                const Q0 = mul(sub(R[1][k], R[0][k]), a), Q1 = mul(sub(R[2][k], R[1][k]), 1 / c2);
                return mul(sub(Q1, Q0), 1 / c1);
            });
            const now = second(rows);
            const S = greville.map((_, j) => {
                const { n, d } = want[j], s = B[j].reduce((t, w, k) => w ? add(t, mul(now[k], w)) : t, [0, 0, 0]);
                const kappa = normalCurvature(frames[j], n, unit(d));
                return add(sub(s, mul(n, dot(s, n))), mul(n, kappa * dot(d, d)));
            });
            const X = solve(B, S);
            out[2] = out[1].map((v, k) => add(v, mul(add(mul(sub(v, out[0][k]), a), mul(X[k], c1)), c2)));
        }
    }
    // Boundary: how the sheet leaves the aligned side at its two ends, where the neighbouring sides
    // run off it. Natural keeps the fit's direction; Normal turns it square to the side; Next does
    // so only where the neighbouring side is nearly flat; Adjacent turns it along the sheet's own
    // neighbouring side, as it ran before. Each keeps its reach, and its tangent plane for G1 and G2.
    if (order >= 1 && boundary !== 'natural') for (const e of [0, out[0].length - 1]) {
        if (boundary === 'next' && !nearlyFlat(rows.map(r => r[e]))) continue;
        const D = sub(out[1][e], out[0][e]), reach = len(D);
        if (reach < 1e-12) continue;
        const t = e === 0 ? sub(out[0][1], out[0][0]) : sub(out[0][e], out[0][e - 1]);
        let dir;
        if (boundary === 'adjacent') {
            dir = sub(rows[1][e], rows[0][e]);
            const f = frames[e];
            if (f && !perpendicular) { const n = unit(cross(f.su, f.sv)); dir = sub(dir, mul(n, dot(dir, n))); }
            if (dot(dir, D) < 0) dir = mul(dir, -1);
        } else dir = dot(t, t) > 1e-18 ? sub(D, mul(t, dot(D, t) / dot(t, t))) : D;
        if (len(dir) < 1e-12) continue;
        const moved = add(out[0][e], mul(unit(dir), reach)), shift = sub(moved, out[1][e]);
        out[1][e] = moved;
        if (order >= 2) out[2][e] = add(out[2][e], shift);
    }
    // Blend extra rows: the next rows follow the last aligned row's move, less and less (none past
    // `blend` rows), and less again as the input shape's influence grows.
    const last = order, reach = Math.min(blend, rows.length - 1 - last);
    for (let r = 1; r <= reach; r++) {
        const w = (1 - influence) * (1 - r / (blend + 1));
        out[last + r] = rows[last + r].map((v, j) => add(v, mul(sub(out[last][j], rows[last][j]), w)));
    }
    // Partial alignment: the side aligned in full between the start and the end (fractions along
    // it), easing out to no change at its ends.
    const x0 = along[q], x1 = along.at(-1 - q);
    const ease = t => t * t * (3 - 2 * t);
    const weight = greville.map(x => {
        const f = (x - x0) / (x1 - x0);
        if (f < p0) return ease(f / p0);
        if (f > p1) return ease((1 - f) / (1 - p1));
        return 1;
    });
    const moves = [];
    for (let i = 0; i <= last + reach; i++) for (let j = 0; j < out[i].length; j++) {
        const by = mul(sub(out[i][j], rows[i][j]), weight[j]);
        if (len(by) > 1e-12) moves.push([ids[i][j], by]);
    }
    return moves;
}

/**
 * Of the faces along an edge (readEdgeFaces), the one to use: the one whose middle lies farthest
 * from `away` (the other edge's middle), so the target carries the reference on; on the target
 * only B-spline faces count.
 */
export function pickFace(faces, away, target) {
    const usable = target ? faces.filter(f => f.spline) : faces;
    if (!usable.length) throw new Error(target ? 'the target edge must lie on a B-spline sheet; rebuild the face first' : 'that reference edge has no face');
    return usable.reduce((best, f) => dist(f.middle, away) > dist(best.middle, away) ? f : best);
}

/**
 * The curve halfway between two edges (points along each, in order), matched by length end to
 * end the way they lie: where Symmetric moves both sides.
 */
export function middleOf(a, b) {
    if (dist(a[0], b.at(-1)) + dist(a.at(-1), b[0]) < dist(a[0], b[0]) + dist(a.at(-1), b.at(-1))) b = [...b].reverse();
    const La = lengths(a), Lb = lengths(b);
    return Array.from({ length: 257 }, (_, k) => mul(add(pointAt(a, La, k / 256), pointAt(b, Lb, k / 256)), 0.5));
}

/** A frame whose tangent plane lies halfway between two faces' (the normals averaged, either way round). */
function meanFrame(f, g) {
    const n1 = unit(cross(f.su, f.sv));
    let n2 = unit(cross(g.su, g.sv));
    if (dot(n1, n2) < 0) n2 = mul(n2, -1);
    const n = unit(add(n1, n2));
    const e = unit(cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
    return { at: f.at, su: e, sv: cross(n, e), suu: [0, 0, 0], suv: [0, 0, 0], svv: [0, 0, 0] };
}

/**
 * The whole of Align Surface against a backend (either build): `target` and `reference` are
 * { body, edge }. Returns { body, moves } for previewMoveFacePoles / commitMoveFacePoles, moves as
 * [[face, pole, [dx, dy, dz]]].
 */
export async function alignRequest(backend, { target, reference, continuity = 'G1', tension = 1, blend = 0, influence = 0, partial = [0, 1], symmetric = false, boundary = 'natural' }) {
    if (target.body === reference.body && target.edge === reference.edge) throw new Error('pick two different edges: the one to move, then the one to meet');
    if (symmetric) return symmetricRequest(backend, { target, reference, continuity, tension, blend, influence, partial, boundary });
    const [tTeeth, rTeeth] = await Promise.all([target, reference].map(e => backend.edgeCurvature({ body: e.body, edge: e.edge, n: 400 })));
    const tAlong = tTeeth.map(t => t.at), rAlong = rTeeth.map(t => t.at);
    const middle = pts => pts[Math.floor(pts.length / 2)];
    const tFace = pickFace(readEdgeFaces(await backend.edgeFaces({ body: target.body, edge: target.edge, points: [] }), 0), middle(rAlong), true);
    const side = sideOf(tFace.spline, tAlong.filter((_, i) => i % 25 === 0));
    const plan = alignPoints(side, rAlong);
    const rFaces = readEdgeFaces(await backend.edgeFaces({ body: reference.body, edge: reference.edge, points: plan.points }), plan.points.length);
    const rFace = pickFace(rFaces, middle(tAlong), false);
    const moves = alignMoves(side, plan, rFace.frames, { continuity, tension, blend, influence, partial, boundary });
    // What Analysis needs to check the result: the side, and the reference edge and face.
    const check = { side, reference, face: rFace.face, target: tFace.face, moves };
    return { body: target.body, moves: moves.map(([pole, by]) => [tFace.face, pole, by]), check };
}

/** The face of the target edge that Align Surface moves: a B-spline face, away from the reference. */
export async function targetFace(backend, target, reference) {
    const teeth = await backend.edgeCurvature({ body: reference.body, edge: reference.edge, n: 64 });
    return pickFace(readEdgeFaces(await backend.edgeFaces({ body: target.body, edge: target.edge, points: [] }), 0), teeth[Math.floor(teeth.length / 2)].at, true).face;
}

/**
 * Align Surface's Symmetric: both sides move, meeting on the curve halfway between their edges
 * (G0) and, for G1, in the tangent plane halfway between their faces'. Both edges must lie on
 * B-spline sheets. Returns { body, moves, more: [{ body, moves }] } (the second side in `more`
 * when it is on another body, else among `moves`).
 */
async function symmetricRequest(backend, { target, reference, continuity, ...opts }) {
    if (continuity === 'G2') throw new Error('Symmetric meets the sides in G0 or G1; set the continuity to G0 or G1');
    const edges = [target, reference];
    const along = (await Promise.all(edges.map(e => backend.edgeCurvature({ body: e.body, edge: e.edge, n: 400 })))).map(teeth => teeth.map(t => t.at));
    const middle = pts => pts[Math.floor(pts.length / 2)];
    const faces = await Promise.all(edges.map(async (e, k) => pickFace(readEdgeFaces(await backend.edgeFaces({ body: e.body, edge: e.edge, points: [] }), 0), middle(along[1 - k]), true)));
    if (target.body === reference.body && faces[0].face === faces[1].face) throw new Error('the two edges are sides of one face; pick edges of two sheets');
    const mid = middleOf(along[0], along[1]);
    const out = await Promise.all(edges.map(async (e, k) => {
        const side = sideOf(faces[k].spline, along[k].filter((_, i) => i % 25 === 0));
        const plan = alignPoints(side, mid);
        let frames = plan.points.map(() => null);
        if (continuity === 'G1') {
            // Both faces' frames at this side's points, averaged.
            const [mine, theirs] = await Promise.all(edges.map(async (x, j) => {
                const list = readEdgeFaces(await backend.edgeFaces({ body: x.body, edge: x.edge, points: plan.points }), plan.points.length);
                return list.find(f => f.face === faces[j].face).frames;
            }));
            frames = mine.map((f, j) => meanFrame(f, theirs[j]));
        }
        return { body: e.body, moves: alignMoves(side, plan, frames, { continuity, ...opts }).map(([pole, by]) => [faces[k].face, pole, by]) };
    }));
    if (target.body === reference.body) return { body: target.body, moves: [...out[0].moves, ...out[1].moves] };
    return { body: target.body, moves: out[0].moves, more: [out[1]] };
}

/** Analysis's default tolerances: gap in mm, angle in degrees, curvature difference in percent. */
export const ANALYSIS_TOLERANCES = { g0: 0.01, g1: 0.5, g2: 5 };

/**
 * `n` samples along `side` (from sideOf) with its poles moved by `moves` ([[pole, by]] in the face's
 * numbering): each the point on the side, the derivative along it, the derivative across it and,
 * with three rows and degree 2 or more across, the second derivative across.
 */
export function sideSamples(side, moves, n = 32) {
    const { rows, ids, along, q, across: A, p } = side;
    const by = new Map(moves.map(([pole, d]) => [pole, d]));
    const R = rows.map((r, i) => r.map((v, j) => by.has(ids[i][j]) ? add(v, by.get(ids[i][j])) : v));
    const a = p / (A[p + 1] - A[1]);
    const curved = R.length >= 3 && p >= 2;
    const c1 = curved ? (A[p + 1] - A[2]) / (p - 1) : 0, c2 = curved ? (A[p + 2] - A[2]) / p : 0;
    const x0 = along[q], x1 = along.at(-1 - q);
    return Array.from({ length: n }, (_, k) => {
        const x = x0 + (x1 - x0) * (k + 0.5) / n, { N, dN } = basis(along, q, x);
        const row = (r, w) => w.reduce((s, v, j) => v ? add(s, mul(r[j], v)) : s, [0, 0, 0]);
        const r0 = row(R[0], N), r1 = row(R[1], N);
        const across = mul(sub(r1, r0), a);
        let second = null;
        if (curved) {
            const Q0 = across, Q1 = mul(sub(row(R[2], N), r1), 1 / c2);
            second = mul(sub(Q1, Q0), 1 / c1);
        }
        return { at: r0, along: row(R[0], dN), across, second };
    });
}

/**
 * Align Surface's Analysis: how well the side (sideSamples) meets the reference face (its frames at
 * the same points, from readEdgeFaces). Returns the worst gap (mm), the worst angle between the
 * faces (degrees), the worst curvature difference across the edge (percent of the larger, or null
 * when the side can't say) and whether each is within `tol`.
 */
export function analyse(samples, frames, tol = ANALYSIS_TOLERANCES) {
    let gap = 0, angle = 0, bend = null;
    samples.forEach((s, k) => {
        const f = frames[k];
        gap = Math.max(gap, dist(s.at, f.at));
        const nt = unit(cross(s.along, s.across));
        let nr = unit(cross(f.su, f.sv));
        if (dot(nt, nr) < 0) nr = mul(nr, -1);
        angle = Math.max(angle, Math.acos(Math.min(1, Math.max(-1, dot(nt, nr)))) * 180 / Math.PI);
        if (!s.second) return;
        // The normal curvature of each face across the edge, at the same point and the same way round.
        const kt = dot(s.second, nt) / dot(s.across, s.across);
        let e = sub(s.across, mul(nr, dot(s.across, nr)));
        if (len(e) < 1e-12) return;
        const kr = normalCurvature(f, nr, unit(e));
        const big = Math.max(Math.abs(kt), Math.abs(kr));
        // Both flat, or nearly: they agree.
        const diff = big < 1e-6 ? 0 : Math.abs(kt - kr) / big * 100;
        bend = Math.max(bend ?? 0, diff);
    });
    return { gap, angle, bend, ok: { g0: gap <= tol.g0, g1: angle <= tol.g1, g2: bend === null ? null : bend <= tol.g2 } };
}

/** Analysis of an alignRequest's result against a backend: the reference face's frames along the moved side. */
export async function alignAnalysis(backend, req, tol = ANALYSIS_TOLERANCES) {
    if (!req.check) throw new Error('Analysis checks one sheet aligned to another; turn Symmetric off');
    const { side, reference, face, moves } = req.check;
    const samples = sideSamples(side, moves);
    const faces = readEdgeFaces(await backend.edgeFaces({ body: reference.body, edge: reference.edge, points: samples.map(s => s.at) }), samples.length);
    const ref = faces.find(f => f.face === face) ?? faces[0];
    return analyse(samples, ref.frames, tol);
}
