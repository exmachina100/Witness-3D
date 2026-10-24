// Plasticity's Bridge Edge: a curve between points on two body edges (each at a parameter from 0 to
// 1 along its edge) that meets each edge in position (G0), direction (G1) or curvature too (G2).
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

/** Continuity names in the order Tab cycles them (Plasticity has G3 too; not here yet). */
export const EDGE_CONTINUITY = ['G0', 'G1', 'G2'];

/**
 * The point of an edge at parameter `s` (0 to 1) from its comb `teeth` ({ at, dir, k }, evenly
 * spaced in the edge's parameter): where it is, the unit direction the edge runs there, its
 * curvature and the unit normal towards the centre of its bend. Ends tell which end they are.
 */
export function edgePoint(teeth, s) {
    const n = teeth.length - 1;
    if (n < 2) throw new Error('that edge is too short to bridge from');
    if (!(s >= 0 && s <= 1)) throw new Error('the parameter runs from 0 to 1');
    const i = Math.round(s * n), P = j => teeth[j].at;
    // Second-order differences, one-sided at the ends.
    const d = i === 0 ? add(mul(sub(P(1), P(0)), 2), mul(sub(P(0), P(2)), 0.5))
        : i === n ? add(mul(sub(P(n), P(n - 1)), 2), mul(sub(P(n - 2), P(n)), 0.5))
        : mul(sub(P(i + 1), P(i - 1)), 0.5);
    if (len(d) < 1e-12) throw new Error('that edge is a single point there');
    const t = teeth[i], k = t.k > 0 && len(t.dir) > 0 ? t.k : 0;
    return { at: [...t.at], along: unit(d), k, centre: k ? mul(unit(t.dir), -1) : [0, 0, 0], end: i === 0 ? 0 : i === n ? 1 : null };
}

/**
 * The bridge from edge point `A` to edge point `B` (from edgePoint) as a degree 5 Bézier, model-space
 * poles. `tension` scales how far it holds each end's direction.
 */
export function bridgePoles(A, B, { tension = 1, continuity = ['G1', 'G1'] } = {}) {
    if (!(Number.isFinite(tension) && tension > 0)) throw new Error('the tension must be greater than zero');
    for (const g of continuity) if (!EDGE_CONTINUITY.includes(g)) throw new Error(`continuity is ${EDGE_CONTINUITY.join(', ')}`);
    const gap = len(sub(B.at, A.at));
    if (gap < 1e-6) throw new Error('those points already meet');
    const k = gap * tension / 5;
    const side = (E, g, toward) => {
        if (g === 'G0') return [E.at, add(E.at, mul(sub(toward, E.at), 0.2)), add(E.at, mul(sub(toward, E.at), 0.4))];
        // Off an end, carry the edge on; inside it, head the way of the other point.
        const out = E.end === 0 ? mul(E.along, -1) : E.end === 1 ? E.along : dot(E.along, sub(toward, E.at)) >= 0 ? E.along : mul(E.along, -1);
        const p1 = add(E.at, mul(out, k));
        // A degree n Bézier starts with curvature (n − 1)/n · h/k² for a bend h square to it.
        const h = g === 'G2' ? E.k * k * k * 5 / 4 : 0;
        return [E.at, p1, add(add(p1, mul(out, k)), mul(E.centre, h))];
    };
    const [p0, p1, p2] = side(A, continuity[0], B.at), [p5, p4, p3] = side(B, continuity[1], A.at);
    return [p0, p1, p2, p3, p4, p5];
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
    const local = poles.map(p => { const d = sub(p, O); const w = dot(d, N); return [dot(d, X), dot(d, Y), Math.abs(w) < 1e-9 ? 0 : w]; });
    return { origin: [...O], x: X, normal: N, kind: 'nurbs', degree: 5, poles: local, weights: local.map(() => 1), knots: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1] };
}
