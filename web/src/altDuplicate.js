// Plasticity's Alternative Duplicate / Duplicate Curve and Project (Alt+D): curves and body edges
// copied flat onto the construction plane along its normal, as new curves. A curve lying in a plane
// parallel to it keeps its exact shape; edges that are straight, round or arcs stay a line, circle
// or arc; anything else becomes a spline through points along it. Shared by both builds.
import { circleThrough } from './curves.js';

const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => { const l = Math.hypot(...a); return a.map(v => v / l); };

/** A plane { origin, x, normal } (model space) as an origin and three unit axes. */
export function axes({ origin, x, normal }) {
    const N = unit(normal), X = unit(sub(x, N.map(v => v * dot(x, N))));
    return { O: origin, X, Y: cross(N, X), N };
}

/** Plane coordinates of a model-space point on `p` (the part along its normal dropped). */
const flat = (p, P) => { const d = sub(P, p.O); return [dot(d, p.X), dot(d, p.Y)]; };

/**
 * A drawn curve copied onto `plane`. `points3` gives model-space points along any curve (used when
 * its plane is not parallel). Returns the new curve's shape (origin, x, normal and its own fields).
 */
export function flattenCurve(curve, plane, points3) {
    const to = axes(plane), from = axes(curve);
    const head = { origin: plane.origin, x: plane.x, normal: plane.normal };
    if (Math.abs(Math.abs(dot(from.N, to.N)) - 1) < 1e-9) {
        const P = q => from.O.map((v, i) => v + from.X[i] * q[0] + from.Y[i] * q[1]);
        const pt = q => flat(to, P(q));
        const vec = q => { const V = from.X.map((v, i) => v * q[0] + from.Y[i] * q[1]); return [dot(V, to.X), dot(V, to.Y)]; };
        const k = curve.kind;
        if (k === 'circle') return { ...head, kind: 'circle', center: pt(curve.center), radius: curve.radius };
        if (k === 'arc') return { ...head, kind: 'arc', start: pt(curve.start), mid: pt(curve.mid), end: pt(curve.end) };
        if (k === 'ellipse') return { ...head, kind: 'ellipse', center: pt(curve.center), major: vec(curve.major), minor: curve.minor };
        if (k === 'polyline' || k === 'spline' || k === 'cv') return { ...head, kind: k, points: curve.points.map(pt), closed: !!curve.closed };
    }
    return edgeCurve(points3, plane);
}

/**
 * Model-space points along an edge (or any curve), flattened onto `plane`: a line, a circle or arc
 * when they lie on one (within 1e-6 of the size), else a spline through up to 32 of them.
 */
export function edgeCurve(points, plane) {
    const to = axes(plane), head = { origin: plane.origin, x: plane.x, normal: plane.normal };
    let q = points.map(P => flat(to, P));
    q = q.filter((p, i) => i === 0 || Math.hypot(p[0] - q[i - 1][0], p[1] - q[i - 1][1]) > 1e-9);
    if (q.length < 2) return null;
    const closed = q.length > 2 && Math.hypot(q[0][0] - q.at(-1)[0], q[0][1] - q.at(-1)[1]) < 1e-6;
    if (closed) q = q.slice(0, -1);
    const a = q[0], b = closed ? q[Math.floor(q.length / 3)] : q.at(-1);
    const size = Math.max(...q.map(p => Math.hypot(p[0] - a[0], p[1] - a[1])));
    if (size < 1e-9) return null;
    const tol = 1e-6 * Math.max(1, size);
    // Straight: every point on the line through the ends.
    const d = [b[0] - a[0], b[1] - a[1]], len = Math.hypot(...d);
    if (!closed && q.every(p => Math.abs((p[0] - a[0]) * d[1] - (p[1] - a[1]) * d[0]) / len < tol)) {
        return { ...head, kind: 'polyline', points: [a, b], closed: false };
    }
    const mid = q[Math.floor(q.length / 2)], third = closed ? q[Math.floor(2 * q.length / 3)] : mid;
    const g = circleThrough(a, closed ? b : mid, closed ? third : b);
    if (g && q.every(p => Math.abs(Math.hypot(p[0] - g.center[0], p[1] - g.center[1]) - g.radius) < tol)) {
        return closed ? { ...head, kind: 'circle', center: g.center, radius: g.radius } : { ...head, kind: 'arc', start: a, mid, end: b };
    }
    const step = Math.max(1, Math.ceil(q.length / 32));
    const picked = q.filter((_, i) => i % step === 0);
    if (!closed && picked.at(-1) !== q.at(-1)) picked.push(q.at(-1));
    return { ...head, kind: 'spline', points: picked, closed };
}
