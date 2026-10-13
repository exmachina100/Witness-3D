// Round 7: Plasticity's curve editing — Offset Curve, Fillet Curve, Explode and Trim — as plain 2D
// geometry in each curve's plane. Shared by the browser and desktop builds: the result is ordinary
// curves that either backend stores (replaceCurves / addCurves), so both give the same answer.
//
// A curve is { origin, x, normal, kind, ... } with points in its plane's coordinates (see
// LocalBackend.checkCurve). Lengths are millimetres.

import { arcPoints, circleThrough, ellipsePoints, loops } from './curves.js';

const EPS = 1e-9, TAU = 2 * Math.PI;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k], len = a => Math.hypot(a[0], a[1]);
const norm = a => { const l = len(a); return l < EPS ? [0, 0] : [a[0] / l, a[1] / l]; };
const dist = (a, b) => len(sub(a, b)), cross2 = (a, b) => a[0] * b[1] - a[1] * b[0], dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];
const left = d => [-d[1], d[0]];
const frameOf = c => ({ origin: c.origin, x: c.x, normal: c.normal });
const withShape = (c, shape) => ({ ...frameOf(c), ...shape });

/** Twice the signed area of a closed point loop: positive when counter-clockwise. */
function area2(pts) {
    let s = 0;
    for (let i = 0; i < pts.length; i++) s += cross2(pts[i], pts[(i + 1) % pts.length]);
    return s;
}

/** Centre, radius, start angle and signed sweep of the arc from `a` through `b` to `c`. */
export function arcGeometry(a, b, c) {
    const circ = circleThrough(a, b, c);
    if (!circ) return null;
    const { center, radius } = circ;
    const ang = q => Math.atan2(q[1] - center[1], q[0] - center[0]);
    const n = x => ((x % TAU) + TAU) % TAU;
    let sweep = n(ang(c) - ang(a));
    if (n(ang(b) - ang(a)) > sweep) sweep -= TAU;
    return { center, radius, start: ang(a), sweep };
}
const arcAt = (g, s) => { const t = g.start + g.sweep * s; return [g.center[0] + g.radius * Math.cos(t), g.center[1] + g.radius * Math.sin(t)]; };
const arcPiece = (g, s0, s1) => ({ kind: 'arc', start: arcAt(g, s0), mid: arcAt(g, (s0 + s1) / 2), end: arcAt(g, s1) });

/** Points along a curve shape in its plane: one polyline, closed or not, for intersections and approximations. */
export function samples(shape, n = 96) {
    switch (shape.kind) {
        case 'polyline': return { points: shape.points.map(p => [...p]), closed: !!shape.closed };
        case 'spline': return { points: (shape.samples ?? shape.points).map(p => [...p]), closed: !!shape.closed };
        case 'circle': return { points: Array.from({ length: n }, (_, i) => add(shape.center, mul([Math.cos(TAU * i / n), Math.sin(TAU * i / n)], shape.radius))), closed: true };
        case 'arc': return { points: arcPoints(shape.start, shape.mid, shape.end, Math.max(8, n / 2)), closed: false };
        case 'ellipse': return { points: ellipsePoints(shape.center, shape.major, shape.minor, n), closed: true };
        case 'contour': {
            const pts = [];
            for (const piece of shape.pieces) {
                const s = samples(piece, n / 2).points;
                pts.push(...(pts.length ? s.slice(1) : s));
            }
            const closed = loops(shape.pieces);
            if (closed) pts.pop();
            return { points: pts, closed };
        }
        default: throw new Error('a curve is a line, circle, spline, arc, ellipse or contour');
    }
}

// --- Offset Curve ---------------------------------------------------------------------------------

/** The polyline offset by `d` with mitred corners: to the left of travel, or outward when `outward` and closed. */
function offsetPolyline(pts, closed, d) {
    const n = pts.length, m = closed ? n : n - 1;
    const lines = [];
    for (let i = 0; i < m; i++) {
        const a = pts[i], b = pts[(i + 1) % n], nrm = left(norm(sub(b, a)));
        lines.push([add(a, mul(nrm, d)), add(b, mul(nrm, d))]);
    }
    const meet = (l1, l2) => {
        const r = sub(l1[1], l1[0]), s = sub(l2[1], l2[0]), den = cross2(r, s);
        if (Math.abs(den) < EPS * len(r) * len(s)) return l1[1];
        const t = cross2(sub(l2[0], l1[0]), s) / den;
        return add(l1[0], mul(r, t));
    };
    if (closed) return lines.map((l, i) => meet(lines[(i - 1 + m) % m], l));
    const out = [lines[0][0]];
    for (let i = 1; i < m; i++) out.push(meet(lines[i - 1], lines[i]));
    out.push(lines[m - 1][1]);
    return out;
}

/** Every `k`-th point, keeping the last, so a spline isn't overfed with near-duplicate points. */
function thin(pts, closed, max = 64) {
    const k = Math.max(1, Math.ceil(pts.length / max));
    const out = pts.filter((_, i) => i % k === 0);
    if (!closed && out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
    return out.filter((p, i) => i === 0 || dist(p, out[i - 1]) > 1e-4);
}

/**
 * Plasticity's Offset Curve: a copy `d` mm away. A closed curve grows with a positive distance and
 * shrinks with a negative one; an open one moves to the left of its direction (right if negative).
 * Lines stay lines (with mitred corners), circles and arcs stay circles and arcs; ellipses, splines
 * and contours with curved pieces become a smooth curve through the offset points.
 */
export function offsetCurve(c, d) {
    if (!Number.isFinite(d)) throw new Error('the distance is not a number');
    if (Math.abs(d) < 1e-9) throw new Error('nothing to do');
    if (c.kind === 'circle') {
        const radius = c.radius + d;
        if (!(radius > 1e-6)) throw new Error('the circle would shrink to nothing; use a smaller distance');
        return withShape(c, { kind: 'circle', center: [...c.center], radius });
    }
    if (c.kind === 'arc') {
        const g = arcGeometry(c.start, c.mid, c.end);
        if (!g) throw new Error('the arc is a straight line');
        const radius = g.radius + d;
        if (!(radius > 1e-6)) throw new Error('the arc would shrink to nothing; use a smaller distance');
        return withShape(c, arcPiece({ ...g, radius }, 0, 1));
    }
    const lineOnly = c.kind === 'polyline' || (c.kind === 'contour' && c.pieces.every(p => p.kind === 'polyline'));
    const { points, closed } = samples(c);
    if (points.length < 2) throw new Error('the curve is too short to offset');
    // Closed curves grow outward whichever way round they were drawn.
    const side = closed && area2(points) < 0 ? -1 : 1;
    const dd = closed ? -d * side : d;
    let out = offsetPolyline(lineOnly && c.kind === 'contour' ? dedupe(points) : points, closed, dd);
    if (closed && Math.sign(area2(out)) !== Math.sign(area2(points))) throw new Error('the curve would turn inside out; use a smaller distance');
    if (lineOnly) return withShape(c, { kind: 'polyline', points: out, closed });
    out = thin(out, closed);
    if (out.length < (closed ? 3 : 2)) throw new Error('the curve would shrink to nothing; use a smaller distance');
    return withShape(c, { kind: 'spline', points: out, closed });
}
const dedupe = pts => pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > 1e-6);

// --- Fillet Curve ---------------------------------------------------------------------------------

/**
 * Plasticity's Fillet Curve: round the corners of a polyline (or a contour of straight pieces) with
 * arcs of `radius`. `corners`, when given, is which vertex numbers to round; otherwise all of them.
 * The result is one contour of lines and arcs, closed if the polyline was.
 */
export function filletCurve(c, radius, corners = null) {
    if (!(Number.isFinite(radius) && radius > 1e-6)) throw new Error('the radius must be greater than zero');
    let pts, closed;
    if (c.kind === 'polyline') { pts = dedupe(c.points); closed = !!c.closed; }
    else if (c.kind === 'contour' && c.pieces.every(p => p.kind === 'polyline')) ({ points: pts, closed } = samples(c));
    else throw new Error('fillet the corners of lines and rectangles; this curve has none');
    const n = pts.length;
    if (closed && n > 2 && dist(pts[0], pts[n - 1]) < 1e-6) pts = pts.slice(0, -1);
    const N = pts.length;
    // Per vertex: how far the round reaches back along each side.
    const cut = new Array(N).fill(0), info = new Array(N).fill(null);
    for (let i = 0; i < N; i++) {
        if (!closed && (i === 0 || i === N - 1)) continue;
        if (corners && !corners.includes(i)) continue;
        const a = pts[(i - 1 + N) % N], b = pts[i], d = pts[(i + 1) % N];
        const u = norm(sub(a, b)), v = norm(sub(d, b));
        const theta = Math.acos(Math.max(-1, Math.min(1, dot2(u, v))));
        if (Math.PI - theta < 1e-6) continue; // straight through
        const t = radius / Math.tan(theta / 2);
        cut[i] = t;
        info[i] = { u, v, theta };
    }
    if (!cut.some(t => t > 0)) throw new Error('there is no corner to round');
    const segs = closed ? N : N - 1;
    for (let i = 0; i < segs; i++) {
        const j = (i + 1) % N;
        if (cut[i] + cut[j] > dist(pts[i], pts[j]) + 1e-9) throw new Error('the radius is too large for these sides; use a smaller one');
    }
    const pieces = [];
    const line = (p, q) => { if (dist(p, q) > 1e-6) pieces.push({ kind: 'polyline', points: [p, q], closed: false }); };
    const roundAt = i => {
        const { u, v, theta } = info[i], b = pts[i];
        const p = add(b, mul(u, cut[i])), q = add(b, mul(v, cut[i]));
        const bis = norm(add(u, v)), centre = add(b, mul(bis, radius / Math.sin(theta / 2)));
        const mid = add(centre, mul(norm(sub(b, centre)), radius));
        return { p, q, arc: { kind: 'arc', start: p, mid, end: q } };
    };
    let at = closed ? (cut[0] ? roundAt(0).q : pts[0]) : pts[0];
    for (let k = 1; k <= (closed ? N : N - 1); k++) {
        const i = k % N;
        if (cut[i] && info[i]) {
            const r = roundAt(i);
            line(at, r.p);
            pieces.push(r.arc);
            at = r.q;
        } else {
            line(at, pts[i]);
            at = pts[i];
        }
    }
    const out = withShape(c, { kind: 'contour', pieces });
    if (closed && !loops(pieces)) throw new Error('the rounded curve does not close');
    return out;
}

// --- Explode --------------------------------------------------------------------------------------

/** Plasticity's Explode: a polyline into its straight pieces, a contour into its pieces. */
export function explode(c) {
    if (c.kind === 'polyline') {
        const pts = dedupe(c.points), n = pts.length, m = c.closed ? n : n - 1;
        if (m < 2) throw new Error('a single line has nothing to explode');
        return Array.from({ length: m }, (_, i) => withShape(c, { kind: 'polyline', points: [pts[i], pts[(i + 1) % n]], closed: false }));
    }
    if (c.kind === 'contour') {
        if (c.pieces.length < 2) throw new Error('this curve has one piece');
        return c.pieces.map(p => withShape(c, structuredClone(p)));
    }
    throw new Error('explode lines, rectangles, polygons and joined curves');
}

// --- Trim -----------------------------------------------------------------------------------------

const v3 = { sub: (a, b) => a.map((v, i) => v - b[i]), dot: (a, b) => a.reduce((s, v, i) => s + v * b[i], 0) };
function planeAxes(c) {
    const n = c.normal, l = Math.hypot(...n), N = n.map(v => v / l);
    const xd = v3.dot(c.x, N), X0 = c.x.map((v, i) => v - N[i] * xd), xl = Math.hypot(...X0), X = X0.map(v => v / xl);
    const Y = [N[1] * X[2] - N[2] * X[1], N[2] * X[0] - N[0] * X[2], N[0] * X[1] - N[1] * X[0]];
    return { O: c.origin, X, Y, N };
}
/** `other`'s sample points in `c`'s plane coordinates, or null when it isn't in the same plane. */
function inPlaneOf(c, other) {
    const a = planeAxes(c), b = planeAxes(other);
    if (Math.abs(Math.abs(v3.dot(a.N, b.N)) - 1) > 1e-6) return null;
    if (Math.abs(v3.dot(v3.sub(b.O, a.O), a.N)) > 1e-4) return null;
    const { points, closed } = samples(other);
    const world = p => b.O.map((o, i) => o + b.X[i] * p[0] + b.Y[i] * p[1]);
    const local = w => { const d = v3.sub(w, a.O); return [v3.dot(d, a.X), v3.dot(d, a.Y)]; };
    return { points: points.map(p => local(world(p))), closed };
}

/** Where segment p0p1 meets segment q0q1: the parameter along p0p1, or null. */
function segHit(p0, p1, q0, q1) {
    const r = sub(p1, p0), s = sub(q1, q0), den = cross2(r, s);
    if (Math.abs(den) < 1e-12) return null;
    const t = cross2(sub(q0, p0), s) / den, u = cross2(sub(q0, p0), r) / den;
    return t > 1e-9 && t < 1 - 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? t : null;
}
const segmentsOf = ({ points, closed }) => {
    const out = [];
    for (let i = 0; i < points.length - 1; i++) out.push([points[i], points[i + 1]]);
    if (closed && points.length > 2) out.push([points[points.length - 1], points[0]]);
    return out;
};

/**
 * Plasticity's Trim: cut the curve `c` where the other curves in its plane cross it, and drop the
 * piece nearest `at` (plane coordinates). Returns the curves to keep in its place: none when nothing
 * crosses it (the whole curve goes, as in Plasticity). Lines, rectangles, polygons, circles and arcs.
 */
export function trim(c, others, at) {
    const cutters = others.map(o => inPlaneOf(c, o)).filter(Boolean).flatMap(segmentsOf);
    if (c.kind === 'polyline') {
        const pts = dedupe(c.points), closed = !!c.closed, n = pts.length, m = closed ? n : n - 1;
        // Breaks as positions along the polyline: segment index plus a fraction.
        const breaks = [];
        for (let i = 0; i < m; i++) {
            const a = pts[i], b = pts[(i + 1) % n];
            for (const [q0, q1] of cutters) { const t = segHit(a, b, q0, q1); if (t !== null) breaks.push(i + t); }
        }
        const pos = s => { const i = Math.min(Math.floor(s), m - 1), t = s - i; return add(pts[i], mul(sub(pts[(i + 1) % n], pts[i]), t)); };
        // The click's position along the polyline.
        let best = { d: Infinity, s: 0 };
        for (let i = 0; i < m; i++) {
            const a = pts[i], b = pts[(i + 1) % n], ab = sub(b, a), L = dot2(ab, ab);
            const t = L < EPS ? 0 : Math.max(0, Math.min(1, dot2(sub(at, a), ab) / L));
            const d = dist(at, add(a, mul(ab, t)));
            if (d < best.d) best = { d, s: i + t };
        }
        const cuts = [...new Set(breaks.map(b => +b.toFixed(9)))].sort((x, y) => x - y);
        const run = (s0, s1) => { // points from position s0 to s1, going forward (wrapping when closed)
            const out = [pos(s0)];
            const end = s1 >= s0 ? s1 : s1 + m;
            for (let k = Math.floor(s0) + 1; k < end; k++) out.push(pts[k % n]);
            out.push(pos(s1));
            return dedupe(out);
        };
        if (!closed) {
            const marks = [0, ...cuts, m];
            const keep = [];
            for (let k = 0; k < marks.length - 1; k++) {
                if (best.s >= marks[k] - 1e-9 && best.s <= marks[k + 1] + 1e-9) continue;
                const p = run(marks[k], marks[k + 1]);
                if (p.length >= 2 && dist(p[0], p[p.length - 1]) > 1e-6) keep.push(withShape(c, { kind: 'polyline', points: p, closed: false }));
            }
            return keep;
        }
        if (cuts.length < 2) return [];
        // Closed: drop the stretch between the two cuts around the click; the rest is one open line.
        const after = cuts.find(x => x > best.s) ?? cuts[0];
        const before = [...cuts].reverse().find(x => x < best.s) ?? cuts[cuts.length - 1];
        return [withShape(c, { kind: 'polyline', points: run(after, before), closed: false })];
    }
    if (c.kind === 'circle' || c.kind === 'arc') {
        const g = c.kind === 'circle'
            ? { center: c.center, radius: c.radius, start: 0, sweep: TAU }
            : arcGeometry(c.start, c.mid, c.end);
        if (!g) throw new Error('the arc is a straight line');
        // Where each cutter segment crosses the circle, as a fraction of the sweep.
        const fr = p => {
            let t = (Math.atan2(p[1] - g.center[1], p[0] - g.center[0]) - g.start) / g.sweep;
            if (c.kind === 'circle') t = ((t % 1) + 1) % 1;
            return t;
        };
        const breaks = [];
        for (const [q0, q1] of cutters) {
            const d = sub(q1, q0), f = sub(q0, g.center);
            const A = dot2(d, d), B = 2 * dot2(f, d), C = dot2(f, f) - g.radius * g.radius, disc = B * B - 4 * A * C;
            if (A < EPS || disc < 0) continue;
            for (const sgn of [-1, 1]) {
                const u = (-B + sgn * Math.sqrt(disc)) / (2 * A);
                if (u < -1e-9 || u > 1 + 1e-9) continue;
                const t = fr(add(q0, mul(d, u)));
                // A circle has no ends, so a crossing at its zero angle counts; an arc's ends don't.
                if (c.kind === 'circle') breaks.push(t > 1 - 1e-9 ? 0 : t);
                else if (t > 1e-9 && t < 1 - 1e-9) breaks.push(t);
            }
        }
        const cuts = [...new Set(breaks.map(b => +b.toFixed(9)))].sort((x, y) => x - y);
        const s = fr(at);
        if (c.kind === 'arc') {
            const marks = [0, ...cuts, 1];
            const keep = [];
            for (let k = 0; k < marks.length - 1; k++) {
                if (s >= marks[k] - 1e-9 && s <= marks[k + 1] + 1e-9) continue;
                keep.push(withShape(c, arcPiece(g, marks[k], marks[k + 1])));
            }
            return keep;
        }
        if (cuts.length < 2) return [];
        const after = cuts.find(x => x > s) ?? cuts[0];
        const before = [...cuts].reverse().find(x => x < s) ?? cuts[cuts.length - 1];
        const end = before > after ? before : before + 1;
        return [withShape(c, arcPiece(g, after, end))];
    }
    throw new Error('trim lines, rectangles, polygons, circles and arcs');
}
