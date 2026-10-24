// Plasticity's Bridge Edge: a curve between points on two body edges (each at a parameter from 0 to
// 1 along its edge) that meets each edge in position (G0), direction (G1), curvature (G2) or the
// change of curvature too (G3).
// Off an edge's end the bridge carries the edge on; from inside an edge it leaves along the edge the
// way that heads for the other point. Each edge is read off its curvature comb (the teeth that
// Toggle Surface Curvature draws, evenly spaced in the edge's parameter), so both builds share it.

const sub = (a, b) => a.map((v, i) => v - b[i]);
const add = (a, b) => a.map((v, i) => v + b[i]);
const mul = (a, s) => a.map(v => v * s);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(...a);
const unit = a => mul(a, 1 / len(a));

/** Continuity names in the order Tab cycles them. */
export const EDGE_CONTINUITY = ['G0', 'G1', 'G2', 'G3'];

/**
 * The point of an edge at parameter `s` (0 to 1) from its comb `teeth` ({ at, dir, k }, evenly
 * spaced in the edge's parameter): where it is, the unit direction the edge runs there, its
 * curvature vector K (curvature times the unit normal towards the centre of the bend) and how K
 * changes per unit length along that direction (κ'N − κ²T + κτB, the third derivative in arc
 * length). Ends tell which end they are.
 */
export function edgePoint(teeth, s) {
    const n = teeth.length - 1;
    if (n < 2) throw new Error('that edge is too short to bridge from');
    if (!(s >= 0 && s <= 1)) throw new Error('the parameter runs from 0 to 1');
    const i = Math.round(s * n), P = j => teeth[j].at;
    const K = j => { const t = teeth[j]; return t.k > 0 && len(t.dir) > 0 ? mul(unit(t.dir), -t.k) : [0, 0, 0]; };
    // Second-order differences, one-sided at the ends.
    const diff = F => i === 0 ? add(mul(sub(F(1), F(0)), 2), mul(sub(F(0), F(2)), 0.5))
        : i === n ? add(mul(sub(F(n), F(n - 1)), 2), mul(sub(F(n - 2), F(n)), 0.5))
        : mul(sub(F(i + 1), F(i - 1)), 0.5);
    const d = diff(P), step = len(d);
    if (step < 1e-12) throw new Error('that edge is a single point there');
    return { at: [...P(i)], along: unit(d), K: K(i), dK: mul(diff(K), 1 / step), end: i === 0 ? 0 : i === n ? 1 : null };
}

/**
 * One side of a degree `n` Bézier bridge: its first poles from end `E` ({ at, out: the unit way the
 * bridge leaves, K: curvature vector, dK: its change per unit length going out }) to meet it in
 * position (G0), direction (G1), curvature (G2) or the change of curvature too (G3). The poles
 * match the end's arc-length derivatives, reparameterised by s(u) = L₁u + αu²/2 + βu³/6 with
 * L₁ = t1·L, α = (t2 − 1)L₁ and β = (t3 − 1)L₁: the G1 tension `t1` moves the first three poles,
 * the G2 tension `t2` the second and third along the end's direction, the G3 tension `t3` only the
 * third; none of them changes how the bridge meets the end.
 */
export function bridgeSide(E, g, toward, n, L, { t1 = 1, t2 = 1, t3 = 1 } = {}) {
    const m = (n - 1) / 2;
    if (g === 'G0') return Array.from({ length: m + 1 }, (_, i) => add(E.at, mul(sub(toward, E.at), i / n)));
    const T = E.out, L1 = t1 * L, alpha = (t2 - 1) * L1, beta = (t3 - 1) * L1;
    const K = g === 'G2' || g === 'G3' ? E.K : [0, 0, 0];
    // d²r/du² = L₁²K + αT and d³r/du³ = L₁³(dK − κ²T) + 3L₁αK + βT.
    const r2 = add(mul(K, L1 * L1), mul(T, alpha));
    const r3 = add(add(g === 'G3' ? mul(sub(E.dK, mul(T, dot(E.K, E.K))), L1 ** 3) : [0, 0, 0], mul(K, 3 * L1 * alpha)), mul(T, beta));
    const p0 = E.at, p1 = add(p0, mul(T, L1 / n));
    const p2 = add(sub(mul(p1, 2), p0), mul(r2, 1 / (n * (n - 1))));
    if (m === 2) return [p0, p1, p2];
    const p3 = add(add(sub(mul(p2, 3), mul(p1, 3)), p0), mul(r3, 1 / (n * (n - 1) * (n - 2))));
    return [p0, p1, p2, p3];
}

/**
 * Each end's tensions from a bridge's options: `tension` (G1), `tension2` (G2) and `tension3` (G3),
 * each one number for both ends or [start, end]; all must be above zero.
 */
export function endTensions({ tension = 1, tension2 = 1, tension3 = 1 } = {}) {
    const pair = v => Array.isArray(v) ? v : [v, v];
    const [a, b, c] = [tension, tension2, tension3].map(pair);
    for (const v of [...a, ...b, ...c]) if (!(Number.isFinite(v) && v > 0)) throw new Error('the tension must be greater than zero');
    return [0, 1].map(i => ({ t1: a[i], t2: b[i], t3: c[i] }));
}

/**
 * The bridge from edge point `A` to edge point `B` (from edgePoint) as a Bézier, model-space poles:
 * degree 5, or 7 when an end is G3. The tensions (see endTensions) say how far it holds each end.
 */
export function bridgePoles(A, B, { continuity = ['G1', 'G1'], ...options } = {}) {
    const ts = endTensions(options);
    for (const g of continuity) if (!EDGE_CONTINUITY.includes(g)) throw new Error(`continuity is ${EDGE_CONTINUITY.join(', ')}`);
    const gap = len(sub(B.at, A.at));
    if (gap < 1e-6) throw new Error('those points already meet');
    const n = continuity.includes('G3') ? 7 : 5;
    // Off an end, carry the edge on; inside it, head the way of the other point. Going against the
    // edge, its curvature vector stays and its change turns round.
    const end = (E, toward) => {
        const fwd = E.end === 1 || (E.end === null && dot(E.along, sub(toward, E.at)) >= 0);
        return { at: E.at, out: fwd ? E.along : mul(E.along, -1), K: E.K, dK: fwd ? E.dK : mul(E.dK, -1) };
    };
    const a = bridgeSide(end(A, B.at), continuity[0], B.at, n, gap, ts[0]);
    const b = bridgeSide(end(B, A.at), continuity[1], A.at, n, gap, ts[1]);
    return [...a, ...b.reverse()];
}

/**
 * The bridge as a drawn curve: an exact NURBS in a frame through its first point, flat in that
 * frame's plane when the bridge is flat (so it can be edited like a sketch), else with heights.
 */
export function bridgeCurve(poles) {
    const O = poles[0], X = unit(sub(poles.at(-1), O));
    let N = null;
    for (const p of poles) {
        const c = cross(X, sub(p, O));
        if (len(c) > 1e-6 * Math.max(1, len(sub(poles.at(-1), O)))) { N = unit(c); break; }
    }
    if (!N) { const a = Math.abs(X[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; N = unit(cross(X, a)); }
    const Y = cross(N, X);
    const knots = [...poles.map(() => 0), ...poles.map(() => 1)];
    const local = poles.map(p => { const d = sub(p, O); const w = dot(d, N); return [dot(d, X), dot(d, Y), Math.abs(w) < 1e-9 ? 0 : w]; });
    return { origin: [...O], x: X, normal: N, kind: 'nurbs', degree: poles.length - 1, poles: local, weights: local.map(() => 1), knots };
}
