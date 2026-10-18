// Round 7: Plasticity's curve editing — Offset Curve, Fillet Curve, Explode and Trim — as plain 2D
// geometry in each curve's plane. Shared by the browser and desktop builds: the result is ordinary
// curves that either backend stores (replaceCurves / addCurves), so both give the same answer.
//
// A curve is { origin, x, normal, kind, ... } with points in its plane's coordinates (see
// LocalBackend.checkCurve). Lengths are millimetres.

import { arcPoints, circleThrough, cvDegree, cvPoints, ellipsePoints, loops, nurbsLoop, nurbsPoints } from './curves.js';

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
        case 'cv': return { points: cvPoints(shape.points, !!shape.closed, n), closed: !!shape.closed };
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
        case 'nurbs': {
            if (shape.poles.some(q => Math.abs(q[2]) > 1e-7)) throw new Error('this projected curve is not flat, so it cannot be edited in a plane');
            const pts = nurbsPoints(shape).map(([u, v]) => [u, v]), closed = nurbsLoop(shape);
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

// Exact offsets of lines and arcs, with Plasticity 26.1's corner styles. A piece is a line
// { line: true, p0, p1 } or an arc { line: false, c, r, ccw, p0, p1 }, running p0 to p1.

/** The pieces of a polyline or a contour of lines and arcs, or null for other curves. */
function exactPieces(c) {
    const out = [];
    const lines = (pts, closed) => {
        const q = dedupe(pts);
        if (closed && q.length > 2 && dist(q[0], q[q.length - 1]) < 1e-6) q.pop();
        for (let i = 0; i < (closed ? q.length : q.length - 1); i++) out.push({ line: true, p0: q[i], p1: q[(i + 1) % q.length] });
    };
    if (c.kind === 'polyline') { lines(c.points, !!c.closed); return { pieces: out, closed: !!c.closed }; }
    if (c.kind !== 'contour' || !c.pieces.every(p => p.kind === 'polyline' || p.kind === 'arc')) return null;
    for (const p of c.pieces) {
        if (p.kind === 'polyline') { lines(p.points, false); continue; }
        const g = arcGeometry(p.start, p.mid, p.end);
        if (!g) { out.push({ line: true, p0: p.start, p1: p.end }); continue; }
        out.push({ line: false, c: g.center, r: g.radius, ccw: g.sweep > 0, p0: p.start, p1: p.end });
    }
    return { pieces: out, closed: loops(c.pieces) };
}

/** The unit direction of travel at the start (`at` 0) or end (`at` 1) of a piece. */
function tangent(q, at) {
    if (q.line) return norm(sub(q.p1, q.p0));
    const radial = norm(sub(at ? q.p1 : q.p0, q.c));
    return q.ccw ? left(radial) : mul(left(radial), -1);
}

/** The piece moved `d` to the left of its travel. */
function shiftPiece(q, d) {
    if (q.line) { const n = mul(left(norm(sub(q.p1, q.p0))), d); return { ...q, p0: add(q.p0, n), p1: add(q.p1, n) }; }
    const r = q.ccw ? q.r - d : q.r + d;
    if (!(r > 1e-6)) throw new Error('an arc would shrink to nothing; use a smaller distance');
    const at = p => add(q.c, mul(norm(sub(p, q.c)), r));
    return { ...q, r, p0: at(q.p0), p1: at(q.p1) };
}

/** Where two pieces' whole lines or circles cross. */
function crossings(a, b) {
    const lineLine = (p, u, q, v) => {
        const den = cross2(u, v);
        if (Math.abs(den) < 1e-12) return [];
        return [add(p, mul(u, cross2(sub(q, p), v) / den))];
    };
    const lineCircle = (p, u, c, r) => {
        const f = sub(p, c), b2 = dot2(f, u), cc = dot2(f, f) - r * r, disc = b2 * b2 - cc;
        if (disc < -1e-12) return [];
        const s = Math.sqrt(Math.max(0, disc));
        return [add(p, mul(u, -b2 - s)), add(p, mul(u, -b2 + s))];
    };
    const circleCircle = (c1, r1, c2, r2) => {
        const dd = dist(c1, c2);
        if (dd < 1e-12 || dd > r1 + r2 + 1e-9 || dd < Math.abs(r1 - r2) - 1e-9) return [];
        const a = (r1 * r1 - r2 * r2 + dd * dd) / (2 * dd), h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
        const e = norm(sub(c2, c1)), m = add(c1, mul(e, a));
        return [add(m, mul(left(e), h)), add(m, mul(left(e), -h))];
    };
    if (a.line && b.line) return lineLine(a.p0, norm(sub(a.p1, a.p0)), b.p0, norm(sub(b.p1, b.p0)));
    if (a.line) return lineCircle(a.p0, norm(sub(a.p1, a.p0)), b.c, b.r);
    if (b.line) return lineCircle(b.p0, norm(sub(b.p1, b.p0)), a.c, a.r);
    return circleCircle(a.c, a.r, b.c, b.r);
}

const nearest = (pts, to) => pts.reduce((best, p) => (best && dist(best, to) <= dist(p, to) ? best : p), null);

/** An arc piece as a curve shape, from p0 to p1 the way it runs. */
function arcShape(q) {
    const a0 = Math.atan2(q.p0[1] - q.c[1], q.p0[0] - q.c[0]), a1 = Math.atan2(q.p1[1] - q.c[1], q.p1[0] - q.c[0]);
    const n = x => ((x % TAU) + TAU) % TAU;
    const sweep = q.ccw ? n(a1 - a0) || TAU : -(n(a0 - a1) || TAU);
    const t = a0 + sweep / 2;
    return { kind: 'arc', start: q.p0, mid: [q.c[0] + q.r * Math.cos(t), q.c[1] + q.r * Math.sin(t)], end: q.p1 };
}

/**
 * The exact offset of lines and arcs by `d` (to the left of travel). Where the pieces part at an
 * outside corner, `corner` closes the gap: 'linear' carries each on along its end tangent until
 * they meet, 'round' puts in an arc about the original corner, and 'natural' carries each piece on
 * as itself (a line straight, an arc round its circle). Inside corners are cut where they cross.
 */
function offsetExact({ pieces, closed }, d, corner) {
    const moved = pieces.map(q => shiftPiece(q, d));
    const n = moved.length, joins = closed ? n : n - 1;
    const before = Array.from({ length: n }, () => []);   // pieces to put in after piece i
    for (let i = 0; i < joins; i++) {
        const j = (i + 1) % n, A = moved[i], B = moved[j];
        if (dist(A.p1, B.p0) < 1e-9) continue;
        const corner0 = pieces[i].p1;
        const turn = cross2(tangent(pieces[i], 1), tangent(pieces[j], 0));
        if (Math.abs(turn) < 1e-12 && dot2(tangent(pieces[i], 1), tangent(pieces[j], 0)) > 0) continue;
        const outside = turn * d < 0;
        if (!outside) {
            const at = nearest(crossings(A, B), corner0);
            if (!at) throw new Error('the curve would turn inside out; use a smaller distance');
            A.p1 = at; B.p0 = at;
            continue;
        }
        if (corner === 'round') {
            before[i].push({ line: false, c: corner0, r: Math.abs(d), ccw: d < 0, p0: A.p1, p1: B.p0 });
            continue;
        }
        if (corner === 'natural') {
            const at = nearest(crossings(A, B), corner0);
            if (at) { A.p1 = at; B.p0 = at; continue; }
        }
        // Linear (or natural with nothing to meet): straight on from each end until they meet.
        const ta = tangent(A, 1), tb = tangent(B, 0);
        const [at] = crossings({ line: true, p0: A.p1, p1: add(A.p1, ta) }, { line: true, p0: B.p0, p1: add(B.p0, tb) });
        if (!at) { before[i].push({ line: true, p0: A.p1, p1: B.p0 }); continue; }
        if (A.line) A.p1 = at; else before[i].push({ line: true, p0: A.p1, p1: at, ext: true });
        if (B.line) B.p0 = at; else before[i].push({ line: true, p0: at, p1: B.p0, ext: true });
    }
    // A trimmed line must still run its own way.
    moved.forEach((q, i) => { if (q.line && dot2(sub(q.p1, q.p0), sub(pieces[i].p1, pieces[i].p0)) <= 0) throw new Error('the curve would turn inside out; use a smaller distance'); });
    const out = [];
    moved.forEach((q, i) => {
        out.push(q.line ? { kind: 'polyline', points: [q.p0, q.p1], closed: false } : arcShape(q));
        for (const e of before[i]) out.push(e.line ? { kind: 'polyline', points: [e.p0, e.p1], closed: false } : arcShape(e));
    });
    return out.filter(p => p.kind !== 'polyline' || dist(p.points[0], p.points[1]) > 1e-9);
}

/** Consecutive line pieces merged into polylines, for a tidy contour. */
function mergeLines(pieces) {
    const out = [];
    for (const p of pieces) {
        const last = out[out.length - 1];
        if (p.kind === 'polyline' && last?.kind === 'polyline' && dist(last.points.at(-1), p.points[0]) < 1e-9) {
            const u = norm(sub(last.points.at(-1), last.points.at(-2))), v = norm(sub(p.points[1], p.points[0]));
            if (Math.abs(cross2(u, v)) < 1e-12 && dot2(u, v) > 0) last.points[last.points.length - 1] = p.points[1];
            else last.points.push(p.points[1]);
        } else out.push(p.kind === 'polyline' ? { ...p, points: p.points.map(q => [...q]) } : p);
    }
    return out;
}

/** Plasticity 26.1's corner styles for Offset Curve. */
export const OFFSET_CORNERS = ['linear', 'round', 'natural'];

/**
 * Plasticity's Offset Curve: a copy `d` mm away. A closed curve grows with a positive distance and
 * shrinks with a negative one; an open one moves to the left of its direction (right if negative).
 * Lines and arcs are offset exactly, and where they part at an outside corner `corner` closes the
 * gap (see offsetExact); circles stay circles; ellipses and splines become a smooth curve through
 * the offset points.
 */
/** The nearest distance from 2D point `p` to the curve's samples, as straight pieces between them. */
export function distanceTo(c, p) {
    const { points, closed } = samples(c);
    let best = Infinity;
    const n = points.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
        const a = points[i], b = points[(i + 1) % n], ab = sub(b, a);
        const t = Math.max(0, Math.min(1, dot2(sub(p, a), ab) / (dot2(ab, ab) || 1)));
        best = Math.min(best, dist(add(a, mul(ab, t)), p));
    }
    return best;
}

/**
 * Freestyle offset (F): the signed distance that puts the offset through `p`, or as near as the
 * corners allow: its size is how far `p` is from the curve, its sign whichever side `p` is on.
 */
export function offsetThrough(c, p, corner = 'linear') {
    const d = distanceTo(c, p);
    if (!(d > 1e-9)) throw new Error('click off the curve to set the distance');
    const miss = s => { try { return distanceTo(offsetCurve(c, s, corner), p); } catch { return Infinity; } };
    return miss(d) <= miss(-d) ? d : -d;
}

export function offsetCurve(c, d, corner = 'linear') {
    if (!Number.isFinite(d)) throw new Error('the distance is not a number');
    if (Math.abs(d) < 1e-9) throw new Error('nothing to do');
    if (!OFFSET_CORNERS.includes(corner)) throw new Error(`the corner is ${OFFSET_CORNERS.join(', ')}`);
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
    const { points, closed } = samples(c);
    if (points.length < 2) throw new Error('the curve is too short to offset');
    // Closed curves grow outward whichever way round they were drawn.
    const side = closed && area2(points) < 0 ? -1 : 1;
    const dd = closed ? -d * side : d;
    const exact = exactPieces(c);
    if (exact && exact.pieces.length) {
        const pieces = mergeLines(offsetExact(exact, dd, corner));
        const shape = c.kind === 'polyline' && pieces.length === 1 && pieces[0].kind === 'polyline'
            ? { kind: 'polyline', points: closed ? pieces[0].points.slice(0, -1) : pieces[0].points, closed }
            : { kind: 'contour', pieces };
        if (closed && Math.sign(area2(samples(shape).points)) !== Math.sign(area2(points))) throw new Error('the curve would turn inside out; use a smaller distance');
        return withShape(c, shape);
    }
    let out = offsetPolyline(points, closed, dd);
    if (closed && Math.sign(area2(out)) !== Math.sign(area2(points))) throw new Error('the curve would turn inside out; use a smaller distance');
    out = thin(out, closed);
    if (out.length < (closed ? 3 : 2)) throw new Error('the curve would shrink to nothing; use a smaller distance');
    return withShape(c, { kind: 'spline', points: out, closed });
}

/** A shape as contour pieces in its plane (lines, arcs and splines). */
function piecesOf(shape) {
    if (shape.kind === 'contour') return shape.pieces.map(p => ({ ...p }));
    if (shape.kind === 'arc') return [{ kind: 'arc', start: shape.start, mid: shape.mid, end: shape.end }];
    if (shape.kind === 'polyline') return [{ kind: 'polyline', points: shape.points.map(p => [...p]), closed: false }];
    return [{ kind: 'spline', points: samples(shape).points, closed: false }];
}
const flipPiece = p => p.kind === 'arc' ? { kind: 'arc', start: p.end, mid: p.mid, end: p.start } : { ...p, points: [...p.points].reverse() };

/**
 * Plasticity's Offset Region O (slot): an open curve offset `d` to both sides, the two offsets closed
 * by half circles round its ends, as one closed contour.
 */
export function offsetSlot(c, d, corner = 'linear') {
    if (!(Number.isFinite(d) && d > 1e-6)) throw new Error('the distance must be greater than zero');
    if (c.kind === 'circle' || c.kind === 'ellipse') throw new Error('a slot is drawn round an open curve');
    const { points, closed } = samples(c);
    if (closed) throw new Error('a slot is drawn round an open curve');
    if (points.length < 2) throw new Error('the curve is too short to offset');
    const left = piecesOf(offsetCurve(c, d, corner)), right = piecesOf(offsetCurve(c, -d, corner)).reverse().map(flipPiece);
    // The ends of the curve and the way out of it there: each cap bulges out by d.
    const start = points[0], end = points.at(-1);
    const outStart = norm(sub(points[0], points[1])), outEnd = norm(sub(end, points.at(-2)));
    const cap = (from, to, at, out) => ({ kind: 'arc', start: from, mid: add(at, mul(out, d)), end: to });
    const Le = pieceEnd(left.at(-1)), Rs = pieceStart(right[0]), Re = pieceEnd(right.at(-1)), Ls = pieceStart(left[0]);
    for (const [a, b, at] of [[Le, Rs, end], [Re, Ls, start]]) {
        if (Math.abs(dist(a, at) - d) > 1e-3 * Math.max(1, d) || Math.abs(dist(b, at) - d) > 1e-3 * Math.max(1, d)) throw new Error('the offsets do not meet the ends; use a smaller distance');
    }
    return withShape(c, { kind: 'contour', pieces: [...left, cap(Le, Rs, end, outEnd), ...right, cap(Re, Ls, start, outStart)] });
}

// --- Offset Region I: combine overlapping regions -------------------------------------------------

/** A closed shape as line and arc pieces (circles as two half arcs; other curves as lines between samples). */
function loopPieces(c) {
    if (c.kind === 'circle') {
        const [x, y] = c.center, r = c.radius, a = [x + r, y], b = [x - r, y];
        return { pieces: [{ line: false, c: c.center, r, ccw: true, p0: a, p1: b }, { line: false, c: c.center, r, ccw: true, p0: b, p1: a }], exact: true };
    }
    const e = exactPieces(c);
    if (e) return { pieces: e.pieces, exact: true };
    const { points } = samples(c, 192);
    return { pieces: points.map((p, i) => ({ line: true, soft: true, p0: p, p1: points[(i + 1) % points.length] })), exact: false };
}
/** The angle of `p` round arc piece `q`, as a fraction of its sweep from p0 (outside 0..1 when off the arc). */
function arcFraction(q, p) {
    const a0 = Math.atan2(q.p0[1] - q.c[1], q.p0[0] - q.c[0]), a1 = Math.atan2(q.p1[1] - q.c[1], q.p1[0] - q.c[0]);
    const n = x => ((x % TAU) + TAU) % TAU;
    const sweep = q.ccw ? n(a1 - a0) || TAU : n(a0 - a1) || TAU;
    const a = Math.atan2(p[1] - q.c[1], p[0] - q.c[0]);
    return (q.ccw ? n(a - a0) : n(a0 - a)) / sweep;
}
/** Where along piece `q` point `p` sits (0 start, 1 end), or null when it isn't on the piece. */
function along(q, p, tol) {
    if (q.line) {
        const d = sub(q.p1, q.p0), L = dot2(d, d);
        if (L < EPS) return null;
        const t = dot2(sub(p, q.p0), d) / L;
        if (t < -1e-9 || t > 1 + 1e-9 || dist(add(q.p0, mul(d, t)), p) > tol) return null;
        return t;
    }
    if (Math.abs(dist(p, q.c) - q.r) > tol) return null;
    if (dist(p, q.p0) < tol) return 0;
    if (dist(p, q.p1) < tol) return 1;
    const t = arcFraction(q, p);
    return t <= 1 ? t : null;
}
function pointAt(q, t) {
    if (q.line) return add(q.p0, mul(sub(q.p1, q.p0), t));
    const a0 = Math.atan2(q.p0[1] - q.c[1], q.p0[0] - q.c[0]);
    const n = x => ((x % TAU) + TAU) % TAU;
    const a1 = Math.atan2(q.p1[1] - q.c[1], q.p1[0] - q.c[0]);
    const sweep = q.ccw ? n(a1 - a0) || TAU : -(n(a0 - a1) || TAU);
    const a = a0 + sweep * t;
    return [q.c[0] + q.r * Math.cos(a), q.c[1] + q.r * Math.sin(a)];
}
const subPiece = (q, p0, p1) => ({ ...q, p0, p1 });
/** Whether `p` is inside the closed polygon `pts` (even-odd). */
function insidePolygon(pts, p) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i], b = pts[j];
        if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
}

/**
 * Plasticity's Offset Region I (combined): closed curves in one plane merged where they overlap,
 * as the outlines of their union (holes come back as loops of their own). Lines and arcs stay exact;
 * other curves go through their points. Curves that touch nothing come back unchanged.
 */
export function unionLoops(shapes) {
    if (shapes.length < 2) return shapes;
    const f0 = frameOf(shapes[0]);
    const same = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
    for (const c of shapes) {
        const f = frameOf(c);
        if (!same(f.origin, f0.origin) || !same(f.x, f0.x) || !same(f.normal, f0.normal)) throw new Error('combine regions drawn on one plane');
    }
    const loopsIn = shapes.map(loopPieces);
    const polys = shapes.map(c => samples(c, 192).points);
    let size = 0;
    for (const p of polys.flat()) size = Math.max(size, Math.abs(p[0]), Math.abs(p[1]));
    const tol = 1e-7 * Math.max(1, size), eps = 1e-4 * Math.max(1, size), join = Math.max(1e-6, tol * 10);
    // Cut every piece where pieces of the other loops cross it, keep the parts outside all of them.
    const kept = [];
    const touched = new Set();
    loopsIn.forEach(({ pieces }, i) => {
        for (const q of pieces) {
            const ts = [];
            loopsIn.forEach(({ pieces: other }, j) => {
                if (j === i) return;
                for (const o of other) for (const x of crossings(q, o)) {
                    const t = along(q, x, tol);
                    if (t !== null && along(o, x, tol) !== null) { ts.push(t); touched.add(i); touched.add(j); }
                }
            });
            const cuts = [0, ...ts.filter(t => t > 1e-9 && t < 1 - 1e-9).sort((a, b) => a - b), 1];
            for (let k = 0; k < cuts.length - 1; k++) {
                if (cuts[k + 1] - cuts[k] < 1e-9) continue;
                const mid = pointAt(q, (cuts[k] + cuts[k + 1]) / 2);
                // On the union's outline: filled on one side and empty on the other (this also keeps
                // just one copy where two outlines run along each other).
                const across = q.line ? left(norm(sub(q.p1, q.p0))) : norm(sub(mid, q.c));
                const filled = p => polys.some(poly => insidePolygon(poly, p));
                if (filled(add(mid, mul(across, eps))) === filled(add(mid, mul(across, -eps)))) continue;
                if (kept.some(o => o.loop !== i && dist(pointAt(o.q, 0.5), mid) < join)) continue;
                kept.push({ loop: i, q: subPiece(q, k ? pointAt(q, cuts[k]) : q.p0, k + 1 < cuts.length - 1 ? pointAt(q, cuts[k + 1]) : q.p1) });
            }
        }
    });
    // Loops that touch nothing: unchanged, or gone when inside another.
    const out = [];
    shapes.forEach((c, i) => {
        if (touched.has(i)) return;
        if (!polys.some((poly, j) => j !== i && insidePolygon(poly, polys[i][0]))) out.push(c);
    });
    // Chain the kept parts end to end into closed loops.
    const rest = kept.filter(k => touched.has(k.loop)).map(k => k.q);
    const flip = q => q.line ? { ...q, p0: q.p1, p1: q.p0 } : { ...q, ccw: !q.ccw, p0: q.p1, p1: q.p0 };
    while (rest.length) {
        const chain = [rest.shift()];
        for (let guard = 0; dist(chain.at(-1).p1, chain[0].p0) > join; guard++) {
            const end = chain.at(-1).p1;
            let k = rest.findIndex(q => dist(q.p0, end) <= join);
            if (k < 0) { k = rest.findIndex(q => dist(q.p1, end) <= join); if (k >= 0) rest[k] = flip(rest[k]); }
            if (k < 0 || guard > 100000) throw new Error('the combined outline does not close up');
            const next = rest.splice(k, 1)[0];
            chain.push({ ...next, p0: end });
        }
        chain[chain.length - 1] = { ...chain.at(-1), p1: chain[0].p0 };
        // Arcs of one circle running on from each other become one arc.
        for (let k = chain.length - 1; k > 0; k--) {
            const a = chain[k - 1], b = chain[k];
            if (!a.line && !b.line && a.ccw === b.ccw && dist(a.c, b.c) < join && Math.abs(a.r - b.r) < join && dist(a.p0, b.p1) > join) chain.splice(k - 1, 2, { ...a, p1: b.p1 });
        }
        // Runs of points from a smooth curve go back in as one spline piece.
        const parts = [];
        for (const q of chain) {
            const last = parts.at(-1);
            if (q.soft && last?.soft) last.points.push(q.p1);
            else parts.push(q.soft ? { kind: 'spline', points: [q.p0, q.p1], closed: false, soft: true } : q.line ? { kind: 'polyline', points: [q.p0, q.p1], closed: false } : arcShape(q));
        }
        // A loop that starts part way along a spline run: carry that run on round the end.
        if (parts.length > 1 && parts[0].soft && parts.at(-1).soft) { const tail = parts.pop(); parts[0].points = [...tail.points, ...parts[0].points.slice(1)]; }
        const pieces = mergeLines(parts.map(({ soft, ...p }) => p));
        if (pieces.length === 1 && pieces[0].kind === 'spline') {
            const points = pieces[0].points.slice(0, -1);
            out.push(withShape(shapes[0], { kind: 'spline', points, closed: true }));
        } else if (pieces.every(p => p.kind === 'polyline')) {
            const points = pieces.flatMap((p, k) => k ? p.points.slice(1) : p.points);
            points.pop();
            out.push(withShape(shapes[0], { kind: 'polyline', points, closed: true }));
        } else out.push(withShape(shapes[0], { kind: 'contour', pieces }));
    }
    return out;
}
const dedupe = pts => pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > 1e-6);

// --- Fillet Curve ---------------------------------------------------------------------------------

/**
 * Plasticity's Fillet Curve: round the corners of a polyline (or a contour of straight pieces) with
 * arcs of `radius`. `corners`, when given, is which vertex numbers to round; otherwise all of them.
 * The result is one contour of lines and arcs, closed if the polyline was.
 */
export function filletCurve(c, radius, corners = null, chamfer = false) {
    if (!(Number.isFinite(radius) && radius > 1e-6)) throw new Error(chamfer ? 'the chamfer distance must be greater than zero' : 'the radius must be greater than zero');
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
        // A chamfer (Fillet Vertex dragged the other way) cuts `radius` back along each side.
        const t = chamfer ? radius : radius / Math.tan(theta / 2);
        cut[i] = t;
        info[i] = { u, v, theta };
    }
    if (!cut.some(t => t > 0)) throw new Error('there is no corner to round');
    const segs = closed ? N : N - 1;
    for (let i = 0; i < segs; i++) {
        const j = (i + 1) % N;
        if (cut[i] + cut[j] > dist(pts[i], pts[j]) + 1e-9) throw new Error(`the ${chamfer ? 'chamfer' : 'radius'} is too large for these sides; use a smaller one`);
    }
    const pieces = [];
    const line = (p, q) => { if (dist(p, q) > 1e-6) pieces.push({ kind: 'polyline', points: [p, q], closed: false }); };
    const roundAt = i => {
        const { u, v, theta } = info[i], b = pts[i];
        const p = add(b, mul(u, cut[i])), q = add(b, mul(v, cut[i]));
        if (chamfer) return { p, q, arc: { kind: 'polyline', points: [p, q], closed: false } };
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
    if (closed && !loops(pieces)) throw new Error('the rounded curve does not close');
    if (pieces.every(p => p.kind === 'polyline')) {
        // Chamfers keep a polyline a polyline.
        const points = [pieces[0].points[0]];
        for (const p of pieces) points.push(p.points[1]);
        if (closed) points.pop();
        return withShape(c, { kind: 'polyline', points, closed });
    }
    return withShape(c, { kind: 'contour', pieces });
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

// --- Reverse Curve --------------------------------------------------------------------------------

/**
 * Plasticity's Reverse Curve: the same curve running the other way, so its start becomes its end
 * (offset sides, bridge ends and sweep directions follow). Circles and ellipses are stored without
 * a direction here, so there is nothing to turn round.
 */
export function reverseCurve(c) {
    const { origin, x, normal, ...shape } = c;
    return withShape(c, flipShape(shape));
}
function flipShape(c) {
    switch (c.kind) {
        // A closed outline keeps its first vertex and runs round the other way.
        case 'polyline': case 'cv': return { kind: c.kind, points: c.closed ? [c.points[0], ...c.points.slice(1).reverse()] : [...c.points].reverse(), closed: !!c.closed };
        case 'spline': return { kind: 'spline', points: [...c.points].reverse(), closed: !!c.closed, ...(c.samples ? { samples: [...c.samples].reverse() } : {}) };
        case 'arc': return { kind: 'arc', start: c.end, mid: c.mid, end: c.start };
        case 'nurbs': {
            const a = c.knots[0], b = c.knots.at(-1);
            return { kind: 'nurbs', degree: c.degree, poles: [...c.poles].reverse(), weights: [...c.weights].reverse(), knots: c.knots.map(k => a + b - k).reverse() };
        }
        case 'contour': return { kind: 'contour', pieces: [...c.pieces].reverse().map(flipShape) };
        default: throw new Error('circles and ellipses have no direction to reverse');
    }
}

// --- Convert Vertex ---------------------------------------------------------------------------------

/** A Bezier's control points one degree higher, same curve. */
function elevateBezier(P) {
    const m = P.length - 1;
    return [P[0], ...P.slice(1).map((q, i) => { const a = (i + 1) / (m + 1); return add(mul(P[i], a), mul(q, 1 - a)); }), P[m]];
}

/**
 * Plasticity's Convert Vertex: the picked corners of a line become control vertices, so the line
 * runs smoothly past them instead of through them. Between each pair of corners kept, the converted
 * vertices are the control points of one smooth span (a Bezier, or a cubic B-spline when there are
 * more than two); the whole comes back as one NURBS curve, or a control-point curve when every
 * vertex but the ends is converted. `ns` are vertex numbers as curveVertices lists them.
 */
export function convertVertices(c, ns) {
    let pts, closed;
    if (c.kind === 'polyline') { pts = c.points.map(p => [...p]); closed = !!c.closed; }
    else if (c.kind === 'contour' && c.pieces.every(p => p.kind === 'polyline')) {
        pts = dedupe(c.pieces.flatMap(p => p.points.map(q => [...q])));
        closed = loops(c.pieces);
        if (closed && dist(pts[0], pts.at(-1)) < 1e-6) pts.pop();
    } else throw new Error('Convert Vertex works on the corners of lines');
    const soft = new Set(ns.filter(n => n >= 0 && n < pts.length && (closed || (n > 0 && n < pts.length - 1))));
    if (!soft.size) throw new Error(closed ? 'pick corners to convert' : 'pick corners between the ends; the ends stay put');
    const frame = frameOf(c);
    if (soft.size === pts.length || (!closed && soft.size === pts.length - 2)) return { ...frame, kind: 'cv', points: pts, closed };
    // Start a closed outline at a corner that stays, and come back to it.
    let order = pts.map((_, i) => i);
    if (closed) { const s = order.find(i => !soft.has(i)); order = [...order.slice(s), ...order.slice(0, s), s]; }
    const spans = [];
    let run = [order[0]];
    for (const i of order.slice(1)) {
        run.push(i);
        if (!soft.has(i)) { spans.push(run.map(j => pts[j])); run = [i]; }
    }
    const d = Math.min(3, Math.max(...spans.map(s => s.length - 1)));
    const poles = [], knots = [...Array(d + 1).fill(0)];
    spans.forEach((s, k) => {
        let P = s, inner = [];
        if (s.length - 1 <= d) while (P.length - 1 < d) P = elevateBezier(P);
        else {
            // A clamped cubic B-spline through this run's control points, its own knots inside the span.
            const spansIn = s.length - d;
            inner = Array.from({ length: spansIn - 1 }, (_, i) => k + (i + 1) / spansIn);
        }
        poles.push(...(k ? P.slice(1) : P));
        knots.push(...inner, ...Array(k === spans.length - 1 ? d + 1 : d).fill(k + 1));
    });
    const total = spans.length;
    return { ...frame, kind: 'nurbs', degree: d, poles: poles.map(([x, y]) => [x, y, 0]), weights: poles.map(() => 1), knots: knots.map(v => v / total) };
}

// --- Rebuild Curve ----------------------------------------------------------------------------------

/** The values of the `count` B-spline basis functions of degree `p` on `knots` at `t`. */
function basisAll(knots, p, count, t) {
    let k = p;
    while (k < count - 1 && t >= knots[k + 1]) k++;
    const N = new Array(p + 1).fill(0), L = [], R = [];
    N[0] = 1;
    for (let j = 1; j <= p; j++) {
        L[j] = t - knots[k + 1 - j]; R[j] = knots[k + j] - t;
        let saved = 0;
        for (let r = 0; r < j; r++) {
            const den = R[r + 1] + L[j - r], tmp = den ? N[r] / den : 0;
            N[r] = saved + R[r + 1] * tmp;
            saved = L[j - r] * tmp;
        }
        N[j] = saved;
    }
    const out = new Array(count).fill(0);
    for (let j = 0; j <= p; j++) out[k - p + j] = N[j];
    return out;
}

/** Solve A x = B for x (B has any number of columns), by Gaussian elimination with partial pivoting. */
function solveN(A, B) {
    const n = A.length, w = B[0].length, M = A.map((r, i) => [...r, ...B[i]]);
    for (let c = 0; c < n; c++) {
        let piv = c;
        for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
        if (Math.abs(M[piv][c]) < 1e-14) throw new Error('too many control points for this curve: try fewer');
        [M[c], M[piv]] = [M[piv], M[c]];
        for (let r = 0; r < n; r++) {
            if (r === c) continue;
            const f = M[r][c] / M[c][c];
            if (f) for (let k = c; k < n + w; k++) M[r][k] -= f * M[c][k];
        }
    }
    return M.map((r, i) => r.slice(n).map(v => v / r[i]));
}

/** Least-squares poles for basis rows `rows` (one per sample) against samples `Q`, with poles in `fixed` held. */
function fitPoles(rows, Q, count, fixed) {
    const free = [...Array(count).keys()].filter(i => !fixed.has(i));
    const at = new Map(free.map((i, j) => [i, j]));
    const A = free.map(() => new Array(free.length).fill(0)), B = free.map(() => [0, 0]);
    rows.forEach((N, k) => {
        let r = Q[k];
        for (const [i, P] of fixed) if (N[i]) r = sub(r, mul(P, N[i]));
        for (const i of free) {
            if (!N[i]) continue;
            const a = at.get(i);
            B[a][0] += N[i] * r[0]; B[a][1] += N[i] * r[1];
            for (const j of free) if (N[j]) A[a][at.get(j)] += N[i] * N[j];
        }
    });
    const x = free.length ? solveN(A, B) : [];
    return [...Array(count).keys()].map(i => fixed.get(i) ?? x[at.get(i)]);
}

/** Chord-length parameters in [0, 1] of the points (the last back at the first when `closed`). */
function chordParams(pts) {
    const d = [0];
    for (let i = 1; i < pts.length; i++) d.push(d[i - 1] + dist(pts[i], pts[i - 1]));
    const total = d.at(-1);
    if (!(total > EPS)) throw new Error('that curve has no length');
    return d.map(v => v / total);
}

/**
 * Knot insertion (Boehm): the same NURBS curve with `u` added to its knots once more, so it has one
 * more control point and traces exactly the same points.
 */
export function insertKnot(c, u) {
    const { degree: p, knots } = c;
    let k = p;
    while (k < c.poles.length - 1 && u >= knots[k + 1]) k++;
    const hom = c.poles.map((q, i) => [q[0] * c.weights[i], q[1] * c.weights[i], q[2] * c.weights[i], c.weights[i]]);
    const out = [];
    for (let i = 0; i <= hom.length; i++) {
        if (i <= k - p) out.push(hom[i]);
        else if (i > k) out.push(hom[i - 1]);
        else {
            const den = knots[i + p] - knots[i], a = den ? (u - knots[i]) / den : 0;
            out.push(hom[i].map((v, m) => a * v + (1 - a) * hom[i - 1][m]));
        }
    }
    return { ...c, poles: out.map(([x, y, z, w]) => [x / w, y / w, z / w]), weights: out.map(h => h[3]), knots: [...knots.slice(0, k + 1), u, ...knots.slice(k + 1)] };
}

/** A rational quadratic arc about `center` from angle `a0` through `sweep`, as poles, weights and knots. */
function arcNurbs(center, r, a0, sweep) {
    const segs = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9)), d = sweep / segs, w = Math.cos(d / 2);
    const at = a => [center[0] + r * Math.cos(a), center[1] + r * Math.sin(a), 0];
    const poles = [at(a0)], weights = [1], knots = [0, 0, 0];
    for (let i = 0; i < segs; i++) {
        const m = a0 + d * (i + 0.5), e = a0 + d * (i + 1);
        poles.push([center[0] + r / w * Math.cos(m), center[1] + r / w * Math.sin(m), 0], at(e));
        weights.push(w, 1);
        if (i < segs - 1) knots.push((i + 1) / segs, (i + 1) / segs);
    }
    knots.push(1, 1, 1);
    return { kind: 'nurbs', degree: 2, poles, weights, knots };
}

/** A clamped NURBS shape from a periodic one whose last `p` poles repeat its first, cut at 0 and 1. */
function clampPeriodic(s) {
    const p = s.degree;
    for (const u of [0, 1]) while (s.knots.filter(k => Math.abs(k - u) < 1e-12).length < p) s = insertKnot(s, u);
    const a = s.knots.findIndex(k => Math.abs(k) < 1e-12), b = s.knots.findLastIndex(k => Math.abs(k - 1) < 1e-12);
    const poles = s.poles.slice(a - 1, b - p + 1), weights = s.weights.slice(a - 1, b - p + 1);
    poles[poles.length - 1] = [...poles[0]];
    weights[weights.length - 1] = weights[0];
    return { kind: 'nurbs', degree: p, poles, weights, knots: [0, ...s.knots.slice(a, b + 1).map(k => Math.abs(k) < 1e-12 ? 0 : Math.abs(k - 1) < 1e-12 ? 1 : k), 1] };
}

/**
 * The curve as an exactly equal NURBS curve, for the tools that work on control points: lines,
 * arcs, circles and control-point curves convert without changing shape; other curves need
 * Rebuild Curve first.
 */
export function asNurbs(c) {
    const frame = frameOf(c);
    const flat = q => [q[0], q[1], 0];
    switch (c.kind) {
        case 'nurbs': return c;
        case 'polyline': {
            const pts = c.closed ? [...c.points, c.points[0]] : c.points, t = chordParams(pts);
            return { ...frame, kind: 'nurbs', degree: 1, poles: pts.map(flat), weights: pts.map(() => 1), knots: [0, ...t, 1] };
        }
        case 'cv': {
            const m = c.points.length, p = cvDegree(m, !!c.closed);
            if (!c.closed) {
                const inner = m - p, knots = [...Array(p + 1).fill(0)];
                for (let i = 1; i < inner; i++) knots.push(i / inner);
                knots.push(...Array(p + 1).fill(1));
                return { ...frame, kind: 'nurbs', degree: p, poles: c.points.map(flat), weights: c.points.map(() => 1), knots };
            }
            const P = [...c.points, ...c.points.slice(0, p)];
            return { ...frame, ...clampPeriodic({ kind: 'nurbs', degree: p, poles: P.map(flat), weights: P.map(() => 1), knots: Array.from({ length: P.length + p + 1 }, (_, i) => (i - p) / m) }) };
        }
        case 'arc': {
            const g = arcGeometry(c.start, c.mid, c.end);
            if (!g) return asNurbs({ ...frame, kind: 'polyline', points: [c.start, c.end], closed: false });
            return { ...frame, ...arcNurbs(g.center, g.radius, g.start, g.sweep) };
        }
        case 'circle': return { ...frame, ...arcNurbs(c.center, c.radius, 0, TAU) };
        default: throw new Error('rebuild this curve first (Rebuild Curve) to work on its control points');
    }
}

/** The parameter of the NURBS curve `c` nearest the plane point `q`. */
function nearestParam(c, q) {
    const k0 = c.knots[c.degree], k1 = c.knots[c.poles.length];
    let best = k0, bestD = Infinity;
    const N = 400;
    for (let i = 0; i <= N; i++) {
        const u = k0 + (k1 - k0) * i / N, d = dist(evalNurbs(c, u), q);
        if (d < bestD) { bestD = d; best = u; }
    }
    // Golden-section refinement in the bracketing step.
    let a = Math.max(k0, best - (k1 - k0) / N), b = Math.min(k1, best + (k1 - k0) / N);
    for (let i = 0; i < 60; i++) {
        const m1 = a + (b - a) * 0.382, m2 = a + (b - a) * 0.618;
        if (dist(evalNurbs(c, m1), q) < dist(evalNurbs(c, m2), q)) b = m2; else a = m1;
    }
    return (a + b) / 2;
}
/** The plane point of the NURBS curve `c` at parameter `u`. */
function evalNurbs(c, u) {
    const N = basisAll(c.knots, c.degree, c.poles.length, Math.min(u, c.knots[c.poles.length] - 1e-12));
    let x = 0, y = 0, w = 0;
    N.forEach((v, i) => { if (!v) return; const k = v * c.weights[i]; x += k * c.poles[i][0]; y += k * c.poles[i][1]; w += k; });
    return [x / w, y / w];
}

/**
 * Plasticity's Insert Knot: a control point added where the curve passes nearest `at` (plane
 * coordinates), without changing its shape. Returns the curve as NURBS with the extra point.
 */
export function insertKnotAt(c, at) {
    const n = asNurbs(c), u = nearestParam(n, at);
    const k0 = n.knots[n.degree], k1 = n.knots[n.poles.length];
    if (u - k0 < 1e-9 * (k1 - k0) || k1 - u < 1e-9 * (k1 - k0)) throw new Error('click along the curve, not at its end');
    if (n.knots.filter(k => Math.abs(k - u) < 1e-12).length >= n.degree) throw new Error('there is already a sharp corner there');
    return insertKnot(n, u);
}

/**
 * Plasticity's Raise Degree: the same curve one degree higher, so it has more control points to
 * shape with. Every knot gains a repeat, which keeps the curve exactly; the poles are solved for
 * in homogeneous coordinates so rational curves (arcs, circles) stay exact too.
 */
export function raiseDegree(c) {
    const n = asNurbs(c), p = n.degree, q = p + 1;
    if (q > 7) throw new Error('7 is the highest degree');
    const k0 = n.knots[p], k1 = n.knots[n.poles.length];
    const distinct = [...new Set(n.knots.slice(p, n.poles.length + 1))];
    const knots = [];
    distinct.forEach((k, i) => {
        const mult = n.knots.filter(v => v === k).length;
        const times = i === 0 || i === distinct.length - 1 ? q + 1 : Math.min(q, mult + 1);
        for (let j = 0; j < times; j++) knots.push(k);
    });
    const count = knots.length - q - 1;
    // Samples in every span, then a least-squares solve that is exact up to rounding.
    const us = [];
    for (let i = 0; i < distinct.length - 1; i++) for (let j = 0; j <= 2 * q + 2; j++) us.push(distinct[i] + (distinct[i + 1] - distinct[i]) * (j + 0.5) / (2 * q + 3));
    us.push(k0, k1 - 1e-12 * (k1 - k0));
    const hom = u => {
        const N = basisAll(n.knots, p, n.poles.length, Math.min(u, k1 - 1e-12 * (k1 - k0)));
        const h = [0, 0, 0, 0];
        N.forEach((v, i) => { if (!v) return; const w = v * n.weights[i]; h[0] += w * n.poles[i][0]; h[1] += w * n.poles[i][1]; h[2] += w * n.poles[i][2]; h[3] += w; });
        return h;
    };
    const A = Array.from({ length: count }, () => new Array(count).fill(0)), B = Array.from({ length: count }, () => [0, 0, 0, 0]);
    for (const u of us) {
        const N = basisAll(knots, q, count, u), h = hom(u);
        for (let i = 0; i < count; i++) {
            if (!N[i]) continue;
            for (let m = 0; m < 4; m++) B[i][m] += N[i] * h[m];
            for (let j = 0; j < count; j++) if (N[j]) A[i][j] += N[i] * N[j];
        }
    }
    const H = solveN(A, B);
    const poles = H.map(([x, y, z, w]) => [x / w, y / w, z / w]), weights = H.map(h => h[3]);
    if (nurbsLoop(n)) poles[poles.length - 1] = [...poles[0]];
    return { ...frameOf(n), kind: 'nurbs', degree: q, poles, weights, knots };
}

/**
 * Plasticity's Rebuild Curve: the curve refitted as one smooth NURBS curve with `count` control
 * points of degree `degree`, by least squares on points along it. Open curves keep their ends; a
 * closed curve comes back closed and smooth all round (a periodic fit, then clamped at its start).
 * Returns the curve and `deviation`, the furthest the new curve strays from the old, in mm.
 */
export function rebuildCurve(c, count = 8, degree = 3) {
    const p = Math.round(degree), n = Math.round(count);
    if (!(p >= 1 && p <= 7)) throw new Error('the degree is from 1 to 7');
    const { points, closed } = samples(c, 256);
    let Q, t;
    if (c.kind === 'nurbs' && !closed) {
        // Keep a NURBS curve's own parameters, so a curve rebuilt as itself comes back unchanged.
        const k0 = c.knots[c.degree], k1 = c.knots[c.poles.length], per = Math.ceil(Math.max(256, 8 * n) / (c.poles.length - c.degree));
        const pts = nurbsPoints(c, per);
        t = [];
        for (let k = c.degree; k < c.poles.length; k++) {
            const a = c.knots[k], b = c.knots[k + 1];
            if (!(b > a)) continue;
            for (let i = t.length ? 1 : 0; i <= per; i++) t.push((a + (b - a) * i / per - k0) / (k1 - k0));
        }
        Q = pts.map(([x, y]) => [x, y]);
    } else {
        Q = resample(dedupe(closed ? [...points, points[0]] : points), Math.max(256, 8 * n));
        t = chordParams(Q);
    }
    let shape;
    if (!closed) {
        if (n < p + 1) throw new Error(`a degree ${p} curve needs at least ${p + 1} control points`);
        // Knots by averaging the parameters (The NURBS Book, eq. 9.69), so every span holds samples.
        const d = Q.length / (n - p), inner = [];
        for (let j = 1; j < n - p; j++) { const i = Math.floor(j * d), a = j * d - i; inner.push((1 - a) * t[i - 1 < 0 ? 0 : i - 1] + a * t[i]); }
        const knots = [...Array(p + 1).fill(0), ...inner, ...Array(p + 1).fill(1)];
        const rows = t.map(u => basisAll(knots, p, n, u));
        const P = fitPoles(rows, Q, n, new Map([[0, Q[0]], [n - 1, Q.at(-1)]]));
        shape = { kind: 'nurbs', degree: p, poles: P.map(([x, y]) => [x, y, 0]), weights: P.map(() => 1), knots };
    } else {
        if (n < p + 1 || n < 3) throw new Error(`a closed degree ${p} curve needs at least ${Math.max(3, p + 1)} control points`);
        // A uniform periodic B-spline: poles wrap round, so the seam is as smooth as the rest.
        const knots = Array.from({ length: n + 2 * p + 1 }, (_, j) => (j - p) / n);
        const rows = t.slice(0, -1).map(u => {
            const N = basisAll(knots, p, n + p, Math.min(u, 1 - 1e-12)), w = new Array(n).fill(0);
            N.forEach((v, i) => { w[i % n] += v; });
            return w;
        });
        const P = fitPoles(rows, Q.slice(0, -1), n, new Map());
        shape = clampPeriodic({ kind: 'nurbs', degree: p, poles: [...P, ...P.slice(0, p)].map(([x, y]) => [x, y, 0]), weights: new Array(n + p).fill(1), knots });
    }
    const fitted = nurbsPoints(shape, 32).map(([x, y]) => [x, y]);
    let deviation = 0;
    for (const q of points) {
        let best = Infinity;
        for (let i = 0; i < fitted.length - 1; i++) best = Math.min(best, segDist(q, fitted[i], fitted[i + 1]));
        deviation = Math.max(deviation, best);
    }
    return { curve: withShape(c, shape), deviation };
}
/** `count` points evenly spaced along the polyline, its ends kept, so every span has samples. */
function resample(pts, count) {
    if (pts.length < 2) throw new Error('that curve has no length');
    const t = chordParams(pts), out = [];
    for (let i = 0, k = 0; i < count; i++) {
        const u = i / (count - 1);
        while (k < pts.length - 2 && t[k + 1] < u) k++;
        const span = t[k + 1] - t[k], a = span > 0 ? Math.min(1, Math.max(0, (u - t[k]) / span)) : 0;
        out.push(add(pts[k], mul(sub(pts[k + 1], pts[k]), a)));
    }
    return out;
}
function segDist(q, a, b) {
    const ab = sub(b, a), l2 = dot2(ab, ab), s = l2 ? Math.max(0, Math.min(1, dot2(sub(q, a), ab) / l2)) : 0;
    return dist(q, add(a, mul(ab, s)));
}

// --- Trim -----------------------------------------------------------------------------------------

const v3 = { sub: (a, b) => a.map((v, i) => v - b[i]), dot: (a, b) => a.reduce((s, v, i) => s + v * b[i], 0) };
function planeAxes(c) {
    const n = c.normal, l = Math.hypot(...n), N = n.map(v => v / l);
    const xd = v3.dot(c.x, N), X0 = c.x.map((v, i) => v - N[i] * xd), xl = Math.hypot(...X0), X = X0.map(v => v / xl);
    const Y = [N[1] * X[2] - N[2] * X[1], N[2] * X[0] - N[0] * X[2], N[0] * X[1] - N[1] * X[0]];
    return { O: c.origin, X, Y, N };
}
// --- Move, Rotate and Scale curves ------------------------------------------------------------------

/** The shape's plane coordinates scaled by `s` about the plane's origin. */
function scaleShape(c, s) {
    const P = p => p.map(v => v * s);
    switch (c.kind) {
        case 'polyline': case 'cv': return { ...c, points: c.points.map(P) };
        case 'spline': return { ...c, points: c.points.map(P), ...(c.samples ? { samples: c.samples.map(P) } : {}) };
        case 'circle': return { ...c, center: P(c.center), radius: c.radius * s };
        case 'arc': return { ...c, start: P(c.start), mid: P(c.mid), end: P(c.end) };
        case 'ellipse': return { ...c, center: P(c.center), major: P(c.major), minor: c.minor * s };
        case 'contour': return { ...c, pieces: c.pieces.map(p => scaleShape(p, s)) };
        case 'nurbs': return { ...c, poles: c.poles.map(P) };
        case 'spiral': return { ...c, radius: c.radius * s, length: c.length * s };
        default: return c;
    }
}

/**
 * The curve moved by Plasticity's Move, Rotate or Scale: points p go to pivot + offset +
 * rotate(scale · (p − pivot)), with `rotate` turning a model-space vector and `scale` uniform.
 */
export function transformCurve(c, { pivot, offset = [0, 0, 0], rotate = v => v, scale = 1 }) {
    const d = c.origin.map((v, i) => (v - pivot[i]) * scale), r = rotate(d);
    const origin = r.map((v, i) => v + pivot[i] + offset[i]);
    return { ...scaleShape(c, scale), origin, x: rotate(c.x), normal: rotate(c.normal) };
}

/**
 * The curve with the vertices in `moves` (vertex number → new model-space point) moved, each kept
 * in the curve's plane by dropping the part of its move across the plane.
 */
export function moveVerticesTo(c, moves) {
    const a = planeAxes(c), local = new Map();
    for (const [n, w] of moves) { const q = v3.sub(w, a.O); local.set(n, [v3.dot(q, a.X), v3.dot(q, a.Y)]); }
    return moveVertices(c, local);
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

// --- Extend and Bridge ----------------------------------------------------------------------------

/** The end of an open line or arc nearest `at`: 0 for its start, 1 for its end. */
export function nearestEnd(c, at) {
    if (ends2(c) === null) throw new Error('extend the open end of a curve');
    const { points } = samples(c);
    const [a, b] = c.kind === 'arc' ? [c.start, c.end] : [points[0], points[points.length - 1]];
    return dist(at, a) <= dist(at, b) ? 0 : 1;
}

/**
 * Plasticity's Extend Curve: lengthen an open line or arc by `length` mm at end `which` (0 start,
 * 1 end), carrying on in the same direction or round the same circle.
 */
/** Plasticity 26.1's Extend Curve shapes: carry on as the curve does, or straight along its end. */
export const EXTEND_SHAPES = ['natural', 'linear'];

export function extendCurve(c, which, length, shape = 'natural') {
    if (!(Number.isFinite(length) && length > 1e-6)) throw new Error('the length must be greater than zero');
    if (!EXTEND_SHAPES.includes(shape)) throw new Error(`the shape is ${EXTEND_SHAPES.join(' or ')}`);
    if (c.kind === 'polyline' && !c.closed) {
        const pts = dedupe(c.points).map(p => [...p]);
        if (pts.length < 2) throw new Error('the line is too short to extend');
        const [i, j] = which ? [pts.length - 1, pts.length - 2] : [0, 1];
        const dir = norm(sub(pts[i], pts[j]));
        pts[i] = add(pts[i], mul(dir, length));
        return withShape(c, { kind: 'polyline', points: pts, closed: false });
    }
    if (c.kind === 'arc' && shape === 'natural') {
        const g = arcGeometry(c.start, c.mid, c.end);
        if (!g) throw new Error('the arc is a straight line');
        const extra = Math.sign(g.sweep) * length / g.radius, sweep = g.sweep + extra;
        if (Math.abs(sweep) >= TAU - 1e-6) throw new Error('the arc would close on itself; use a circle');
        const h = which ? { ...g, sweep } : { ...g, start: g.start - extra, sweep };
        return withShape(c, arcPiece(h, 0, 1));
    }
    if (ends2(c) === null) throw new Error('extend the open end of a curve');
    // A joined curve extends its end piece the same way.
    if (c.kind === 'contour') {
        const k = which ? c.pieces.length - 1 : 0, piece = c.pieces[k];
        const grown = extendCurve({ ...frameOf(c), ...piece }, which, length, shape);
        const { origin, x, normal, ...g } = grown;
        const parts = g.kind === 'contour' ? g.pieces : [g];
        const pieces = [...c.pieces.slice(0, k), ...parts, ...c.pieces.slice(k + 1)];
        return withShape(c, { kind: 'contour', pieces: mergeLines(pieces) });
    }
    // Anything else gets a new piece at that end: a line along it, or (natural) an arc of its end curvature.
    const pts = samples(c, 192).points, n = pts.length;
    let [p, q, r] = which ? [pts[n - 3] ?? pts[n - 2], pts[n - 2], pts[n - 1]] : [pts[2] ?? pts[1], pts[1], pts[0]];
    let out = norm(sub(r, q));
    if (c.kind === 'arc') {
        // An arc's end direction exactly: square to its radius, the way it runs.
        const g = arcGeometry(c.start, c.mid, c.end), t = which ? g.start + g.sweep : g.start, turn = Math.sign(g.sweep);
        const along = [-Math.sin(t) * turn, Math.cos(t) * turn];
        r = which ? c.end : c.start; out = which ? along : mul(along, -1);
    }
    const k = shape === 'natural' && n >= 3 && c.kind !== 'arc' ? curvature3(p, q, r) : 0;
    let extra;
    if (Math.abs(k) * length < 1e-6) extra = { kind: 'polyline', points: [r, add(r, mul(out, length))], closed: false };
    else {
        if (Math.abs(k) * length >= TAU - 1e-6) throw new Error('the extension would close on itself; use a shorter length');
        const center = add(r, mul(left(out), 1 / k));
        extra = arcPiece({ center, radius: 1 / Math.abs(k), start: Math.atan2(r[1] - center[1], r[0] - center[0]), sweep: length * k }, 0, 1);
    }
    const own = c.kind === 'arc' ? [{ kind: 'arc', start: c.start, mid: c.mid, end: c.end }]
        : c.kind === 'spline' ? [{ kind: 'spline', points: c.points.map(v => [...v]), closed: false }]
        : [{ kind: 'spline', points: pts, closed: false }];
    const flipped = extra.kind === 'arc' ? { kind: 'arc', start: extra.end, mid: extra.mid, end: extra.start } : { ...extra, points: [...extra.points].reverse() };
    return withShape(c, { kind: 'contour', pieces: which ? [...own, extra] : [flipped, ...own] });
}

/** The end point and outward direction of an open curve at end `which` (0 start, 1 end). */
function endOf(c, which) {
    const { points } = samples(c);
    if (points.length < 2) throw new Error('the curve is too short');
    const [p, q] = which ? [points[points.length - 1], points[points.length - 2]] : [points[0], points[1]];
    return { at: p, out: norm(sub(p, q)) };
}

/**
 * Plasticity's Bridge Curves: a smooth curve from an end of `a` to an end of `b`, leaving each along
 * its own direction. `tension` scales how far the bridge holds each tangent (1 is a natural blend).
 * Both curves must lie in one plane; the bridge is drawn in `a`'s plane coordinates.
 */
export function bridgeCurves(a, endA, b, endB, tension = 1) {
    if (!(Number.isFinite(tension) && tension > 0)) throw new Error('the tension must be greater than zero');
    if (ends2(a) === null || ends2(b) === null) throw new Error('bridge the open ends of two curves');
    const bInA = inPlaneOf(a, b);
    if (!bInA) throw new Error('the two curves must lie in one plane');
    const A = endOf(a, endA);
    const Bpts = bInA.points, B = endB ? { at: Bpts[Bpts.length - 1], out: norm(sub(Bpts[Bpts.length - 1], Bpts[Bpts.length - 2])) } : { at: Bpts[0], out: norm(sub(Bpts[0], Bpts[1])) };
    const gap = dist(A.at, B.at);
    if (gap < 1e-6) throw new Error('those ends already meet; join them instead');
    // A cubic Bézier leaving A along its direction and arriving at B against its own.
    const k = gap * tension / 3;
    const P = [A.at, add(A.at, mul(A.out, k)), add(B.at, mul(B.out, k)), B.at];
    const at = t => { const u = 1 - t; return [0, 1].map(i => u * u * u * P[0][i] + 3 * u * u * t * P[1][i] + 3 * u * t * t * P[2][i] + t * t * t * P[3][i]); };
    return withShape(a, { kind: 'spline', points: Array.from({ length: 9 }, (_, i) => at(i / 8)), closed: false });
}
/** Bridge continuity names, in the order Tab cycles them (Plasticity's Bridge Vertex has G3 too; not here yet). */
export const BRIDGE_CONTINUITY = ['G0', 'G1', 'G2'];

/**
 * Plasticity's Bridge Vertex / Bridge Curve with continuity: a degree 5 Bézier from an end of `a`
 * to an end of `b` that meets each in position (G0), direction too (G1), or curvature too (G2),
 * per end. `tension` scales how far the bridge holds each end's direction. In `a`'s plane, as an
 * exact NURBS curve.
 */
export function bridgeContinuous(a, endA, b, endB, { tension = 1, continuity = ['G1', 'G1'] } = {}) {
    if (!(Number.isFinite(tension) && tension > 0)) throw new Error('the tension must be greater than zero');
    if (ends2(a) === null || ends2(b) === null) throw new Error('bridge the open ends of two curves');
    for (const g of continuity) if (!BRIDGE_CONTINUITY.includes(g)) throw new Error(`continuity is ${BRIDGE_CONTINUITY.join(', ')}`);
    // Each end: where it is, the way out of the curve, and its curvature travelling out. Lines and
    // arcs are exact; anything else is read off close samples.
    const end = (shape, which) => {
        const piece = shape.kind === 'contour' ? (which ? shape.pieces.at(-1) : shape.pieces[0]) : shape;
        if (piece.kind === 'arc') {
            const g = arcGeometry(piece.start, piece.mid, piece.end), t = which ? g.start + g.sweep : g.start, turn = Math.sign(g.sweep);
            const along = [-Math.sin(t) * turn, Math.cos(t) * turn];
            return { at: which ? piece.end : piece.start, out: which ? along : mul(along, -1), k: (which ? turn : -turn) / g.radius };
        }
        const pts = samples(piece, 192).points, n = pts.length;
        const [p, q, r] = which ? [pts[n - 3] ?? pts[n - 2], pts[n - 2], pts[n - 1]] : [pts[2] ?? pts[1], pts[1], pts[0]];
        return { at: r, out: norm(sub(r, q)), k: piece.kind === 'polyline' || n < 3 ? 0 : curvature3(p, q, r) };
    };
    // `b` in `a`'s plane coordinates, piece by piece so its lines and arcs stay exact.
    const mapped = sh => {
        const own = { ...frameOf(b), ...sh };
        if (sh.kind === 'polyline' || sh.kind === 'arc' || sh.kind === 'circle') return exactIn(a, own);
        const flat = inPlaneOf(a, own);
        return flat && { kind: 'spline', points: flat.points, closed: false };
    };
    const bShape = b.kind === 'contour' ? { kind: 'contour', pieces: b.pieces.map(mapped) } : mapped(b);
    if (bShape?.pieces?.some(p => !p)) throw new Error('the two curves must lie in one plane');
    if (!bShape) throw new Error('the two curves must lie in one plane');
    const A = end(a, endA), B = end(bShape, endB);
    const gap = dist(A.at, B.at);
    if (gap < 1e-6) throw new Error('those ends already meet; join them instead');
    // Poles 0-2 from A and 5-3 from B. With d1 = k·out and d2 = k·out + h·left(out), a degree n
    // Bézier starts with curvature (n − 1)/n · h/k², so h = κk²·n/(n − 1) matches the curve's.
    const k = gap * tension / 5;
    const side = (E, g, toward) => {
        if (g === 'G0') return [E.at, add(E.at, mul(sub(toward, E.at), 0.2)), add(E.at, mul(sub(toward, E.at), 0.4))];
        const p1 = add(E.at, mul(E.out, k));
        const h = g === 'G2' ? E.k * k * k * 5 / 4 : 0;
        return [E.at, p1, add(add(p1, mul(E.out, k)), mul(left(E.out), h))];
    };
    const [p0, p1, p2] = side(A, continuity[0], B.at), [p5, p4, p3] = side(B, continuity[1], A.at);
    const poles = [p0, p1, p2, p3, p4, p5].map(p => [p[0], p[1], 0]);
    return withShape(a, { kind: 'nurbs', degree: 5, poles, weights: poles.map(() => 1), knots: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1] });
}
const ends2 = c => (c.kind === 'arc' || ((c.kind === 'polyline' || c.kind === 'spline' || c.kind === 'cv') && !c.closed) || (c.kind === 'nurbs' && !nurbsLoop(c)) || (c.kind === 'contour' && !loops(c.pieces))) ? true : null;

// --- Tangent Circle -------------------------------------------------------------------------------

/** `other` mapped into `c`'s plane coordinates exactly, for lines, circles and arcs; null if not in that plane. */
function exactIn(c, other) {
    const a = planeAxes(c), b = planeAxes(other);
    if (Math.abs(Math.abs(v3.dot(a.N, b.N)) - 1) > 1e-6 || Math.abs(v3.dot(v3.sub(b.O, a.O), a.N)) > 1e-4) return null;
    const map = p => { const w = b.O.map((o, i) => o + b.X[i] * p[0] + b.Y[i] * p[1]), d = v3.sub(w, a.O); return [v3.dot(d, a.X), v3.dot(d, a.Y)]; };
    if (other.kind === 'circle') { const e = map([other.center[0] + other.radius, other.center[1]]), m = map(other.center); return { kind: 'circle', center: m, radius: dist(e, m) }; }
    if (other.kind === 'arc') return { kind: 'arc', start: map(other.start), mid: map(other.mid), end: map(other.end) };
    if (other.kind === 'polyline') return { kind: 'polyline', points: other.points.map(map), closed: !!other.closed };
    const s = inPlaneOf(c, other);
    return s && { kind: 'polyline', points: s.points, closed: s.closed };
}

/** Distance from `q` to a shape in plane coordinates, and the unit direction from its nearest point to `q`. */
function distTo(shape, q) {
    if (shape.kind === 'circle') {
        const v = sub(q, shape.center), on = add(shape.center, mul(norm(v), shape.radius));
        return { d: Math.abs(len(v) - shape.radius), dir: norm(sub(q, on)) };
    }
    if (shape.kind === 'arc') {
        const g = arcGeometry(shape.start, shape.mid, shape.end), v = sub(q, g.center);
        // How far round from the start, in the arc's own direction.
        const off = (((Math.atan2(v[1], v[0]) - g.start) * Math.sign(g.sweep)) % TAU + TAU) % TAU;
        if (off <= Math.abs(g.sweep)) {
            const on = add(g.center, mul(norm(v), g.radius));
            return { d: Math.abs(len(v) - g.radius), dir: norm(sub(q, on)) };
        }
        const e = [arcAt(g, 0), arcAt(g, 1)].sort((x, y) => dist(x, q) - dist(y, q))[0];
        return { d: dist(e, q), dir: norm(sub(q, e)) };
    }
    const segs = segmentsOf({ points: shape.points, closed: shape.closed });
    let best = { d: Infinity, dir: [0, 0] };
    for (const [a, b] of segs) {
        const ab = sub(b, a), L = dot2(ab, ab), t = L < EPS ? 0 : Math.max(0, Math.min(1, dot2(sub(q, a), ab) / L));
        const on = add(a, mul(ab, t)), d = dist(q, on);
        if (d < best.d) best = { d, dir: norm(sub(q, on)) };
    }
    return best;
}

/** Where centres `r` away from a shape can be: offset segments and circles (plane coordinates). */
function loci(shape, r) {
    if (shape.kind === 'circle') return [{ c: shape.center, r: shape.radius + r }, ...(Math.abs(shape.radius - r) > 1e-12 ? [{ c: shape.center, r: Math.abs(shape.radius - r) }] : [])];
    if (shape.kind === 'arc') {
        const g = arcGeometry(shape.start, shape.mid, shape.end);
        return [{ c: g.center, r: g.radius + r }, { c: g.center, r: Math.abs(g.radius - r) }, { c: shape.start, r }, { c: shape.end, r }];
    }
    const out = [];
    for (const [a, b] of segmentsOf({ points: shape.points, closed: shape.closed })) {
        const n = left(norm(sub(b, a)));
        for (const s of [1, -1]) out.push({ a: add(a, mul(n, s * r)), b: add(b, mul(n, s * r)) });
    }
    for (const q of shape.points) out.push({ c: q, r });
    return out;
}

/** The points where two loci (segments {a, b} or circles {c, r}) cross. */
function meet(p, q) {
    if (p.a && q.a) {
        const r = sub(p.b, p.a), s = sub(q.b, q.a), den = cross2(r, s);
        if (Math.abs(den) < 1e-12) return [];
        const t = cross2(sub(q.a, p.a), s) / den, u = cross2(sub(q.a, p.a), r) / den;
        return t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? [add(p.a, mul(r, t))] : [];
    }
    if (p.c && q.a) return meet(q, p);
    if (p.a && q.c) {
        const d = sub(p.b, p.a), f = sub(p.a, q.c), A = dot2(d, d), B = 2 * dot2(f, d), C = dot2(f, f) - q.r * q.r, disc = B * B - 4 * A * C;
        if (A < 1e-18 || disc < 0) return [];
        return [-1, 1].map(sg => (-B + sg * Math.sqrt(disc)) / (2 * A)).filter(t => t >= -1e-9 && t <= 1 + 1e-9).map(t => add(p.a, mul(d, t)));
    }
    const d = dist(p.c, q.c);
    if (d < 1e-12 || d > p.r + q.r + 1e-12 || d < Math.abs(p.r - q.r) - 1e-12) return [];
    const x = (d * d + p.r * p.r - q.r * q.r) / (2 * d), h = Math.sqrt(Math.max(0, p.r * p.r - x * x));
    const u = mul(sub(q.c, p.c), 1 / d), base = add(p.c, mul(u, x));
    return [add(base, mul(left(u), h)), add(base, mul(left(u), -h))];
}

/**
 * Plasticity's Tangent Circle: a circle touching curves `a` and `b`, the one whose centre is nearest
 * `at` (plane coordinates of `a`). With `radius` it has that radius; without, its size follows `at`:
 * the centre is the point nearest `at` that is equally far from both curves. Lines, circles and arcs
 * are measured exactly; other curves through their samples.
 */
export function tangentCircle(a, b, at, radius = null) {
    const A = exactIn(a, a), B = exactIn(a, b);
    if (!B) throw new Error('the two curves must lie in one plane');
    if (radius !== null && !(Number.isFinite(radius) && radius > 1e-6)) throw new Error('the radius must be greater than zero');
    let c = [...at];
    if (radius !== null) {
        // Every centre r away from a curve lies on one of its offset loci; the circles that touch both
        // curves sit where A's loci cross B's. Keep the true tangents and take the one nearest `at`.
        const hits = [];
        for (const la of loci(A, radius)) for (const lb of loci(B, radius)) hits.push(...meet(la, lb));
        const ok = hits.filter(h => Math.abs(distTo(A, h).d - radius) < 1e-7 * Math.max(1, radius) && Math.abs(distTo(B, h).d - radius) < 1e-7 * Math.max(1, radius));
        if (!ok.length) throw new Error('no circle of that radius touches both curves');
        c = ok.reduce((x, y) => dist(y, at) < dist(x, at) ? y : x);
        return withShape(a, { kind: 'circle', center: c, radius });
    }
    for (let i = 0; i < 100; i++) {
        // Slide along the difference's gradient onto the curve of points equally far from both.
        const da = distTo(A, c), db = distTo(B, c);
        const f = da.d - db.d, g = sub(da.dir, db.dir), gg = dot2(g, g);
        if (Math.abs(f) < 1e-10 || gg < 1e-12) break;
        c = sub(c, mul(g, f / gg));
    }
    const r = distTo(A, c).d;
    if (!(r > 1e-6) || Math.abs(distTo(B, c).d - r) > 1e-6 * Math.max(1, r)) throw new Error('no circle touches both curves near there');
    return withShape(a, { kind: 'circle', center: c, radius: r });
}

// --- Split Curve At Point -------------------------------------------------------------------------

/**
 * Plasticity's Split Curve At Point: two curves meeting at the point of `c` nearest `at` (plane
 * coordinates). Lines and arcs split exactly; a closed polyline opens there instead. Splines split
 * at the nearest point of their samples, each half keeping its own through-points.
 */
export function splitCurve(c, at) {
    if (c.kind === 'polyline') {
        const pts = dedupe(c.points), n = pts.length, m = c.closed ? n : n - 1;
        let best = { d: Infinity, i: 0, t: 0 };
        for (let i = 0; i < m; i++) {
            const a = pts[i], b = pts[(i + 1) % n], ab = sub(b, a), L = dot2(ab, ab);
            const t = L < EPS ? 0 : Math.max(0, Math.min(1, dot2(sub(at, a), ab) / L)), d = dist(at, add(a, mul(ab, t)));
            if (d < best.d) best = { d, i, t };
        }
        const q = add(pts[best.i], mul(sub(pts[(best.i + 1) % n], pts[best.i]), best.t));
        const before = pts.slice(0, best.i + 1), after = pts.slice(best.i + 1);
        if (c.closed) {
            // Opened at the point: one line from there all the way round back to it.
            const round = dedupe([q, ...after, ...before, q]);
            return [withShape(c, { kind: 'polyline', points: round, closed: false })];
        }
        const first = dedupe([...before, q]), second = dedupe([q, ...after]);
        if (first.length < 2 || second.length < 2) throw new Error('that is the end of the line; split it further in');
        return [withShape(c, { kind: 'polyline', points: first, closed: false }), withShape(c, { kind: 'polyline', points: second, closed: false })];
    }
    if (c.kind === 'arc') {
        const g = arcGeometry(c.start, c.mid, c.end), v = sub(at, g.center);
        const off = (((Math.atan2(v[1], v[0]) - g.start) * Math.sign(g.sweep)) % TAU + TAU) % TAU;
        const s = Math.min(1, off / Math.abs(g.sweep));
        if (s < 1e-6 || s > 1 - 1e-6) throw new Error('that is the end of the arc; split it further in');
        return [withShape(c, arcPiece(g, 0, s)), withShape(c, arcPiece(g, s, 1))];
    }
    if (c.kind === 'spline' && !c.closed) {
        const { points } = samples(c);
        let k = 0;
        points.forEach((p, i) => { if (dist(p, at) < dist(points[k], at)) k = i; });
        if (k === 0 || k === points.length - 1) throw new Error('that is the end of the curve; split it further in');
        const q = points[k], tAt = k / (points.length - 1);
        // Through-points before and after the split, by where they fall along the curve.
        const place = c.points.map(p => { let j = 0; points.forEach((s, i) => { if (dist(s, p) < dist(points[j], p)) j = i; }); return j / (points.length - 1); });
        const first = [...c.points.filter((_, i) => place[i] < tAt - 1e-9), q], second = [q, ...c.points.filter((_, i) => place[i] > tAt + 1e-9)];
        return [first, second].map(pts => withShape(c, { kind: pts.length > 2 ? 'spline' : 'polyline', points: dedupe(pts), closed: false }));
    }
    throw new Error('split lines, arcs and open splines');
}

// --- Curvature and continuity (Plasticity's Toggle Curvature and Measure Continuity) -----------------

/** Signed curvature of the circle through three points (positive turning left), 0 on a line. */
function curvature3(a, b, q) {
    const ab = dist(a, b), bq = dist(b, q), aq = dist(a, q);
    if (ab * bq * aq < 1e-18) return 0;
    return 2 * cross2(sub(b, a), sub(q, a)) / (ab * bq * aq);
}

/**
 * Points along `c` with the curvature there and the direction a comb tooth points (out of the turn,
 * on the convex side, as Plasticity and Alias draw it):
 * [{ at, k, dir }] in plane coordinates. Circles and arcs are exact; other curves use dense samples.
 */
export function curvatureComb(c, n = 160) {
    if (c.kind === 'circle') {
        return Array.from({ length: n }, (_, i) => {
            const t = TAU * i / n, u = [Math.cos(t), Math.sin(t)];
            return { at: add(c.center, mul(u, c.radius)), k: 1 / c.radius, dir: u };
        });
    }
    if (c.kind === 'arc') {
        const g = arcGeometry(c.start, c.mid, c.end);
        return Array.from({ length: n + 1 }, (_, i) => {
            const at = arcAt(g, i / n);
            return { at, k: 1 / g.radius, dir: norm(sub(at, g.center)) };
        });
    }
    const { points, closed } = samples(c, n);
    const m = points.length;
    return points.map((p, i) => {
        const a = points[closed ? (i - 1 + m) % m : Math.max(0, i - 1)], q = points[closed ? (i + 1) % m : Math.min(m - 1, i + 1)];
        if (a === p || q === p) return { at: p, k: 0, dir: [0, 0] };
        const k = curvature3(a, p, q), t = norm(sub(q, a));
        return { at: p, k: Math.abs(k), dir: mul(left(t), -(Math.sign(k) || 1)) };
    });
}

/**
 * Plasticity's Measure Continuity where end `endA` of `a` meets end `endB` of `b` (0 start, 1 end):
 * the gap, the angle between the tangents, both curvatures, and the class: G0 when the ends touch,
 * G1 when the tangents also line up, G2 when the curvatures match too.
 */
export function continuity(a, endA, b, endB) {
    const A = exactIn(a, a), B = exactIn(a, b);
    if (!B) throw new Error('the two curves must lie in one plane');
    const ea = endInfo(A, endA), eb = endInfo(B, endB);
    const gap = dist(ea.at, eb.at);
    // Across the joint, A leaves along its direction and B arrives against its own.
    const angle = Math.acos(Math.max(-1, Math.min(1, -dot2(ea.out, eb.out)))) * 180 / Math.PI;
    const g = gap > 1e-4 ? 'NONE' : angle > 0.1 ? 'G0' : Math.abs(ea.k - eb.k) > 1e-3 * Math.max(1, ea.k, eb.k) ? 'G1' : 'G2';
    return { gap, angle, ka: ea.k, kb: eb.k, continuity: g };
}

/** The end point of a shape (0 start, 1 end), its outward direction there, and its curvature. Exact for lines and arcs. */
function endInfo(shape, which) {
    if (shape.kind === 'arc') {
        const g = arcGeometry(shape.start, shape.mid, shape.end), t = g.start + g.sweep * which;
        const along = mul([-Math.sin(t), Math.cos(t)], Math.sign(g.sweep));
        return { at: arcAt(g, which), out: which ? along : mul(along, -1), k: 1 / g.radius };
    }
    if (shape.kind === 'circle') throw new Error('a circle has no ends');
    const pts = shape.kind === 'polyline' ? dedupe(shape.points) : samples(shape, 1000).points;
    const n = pts.length;
    if (n < 2) throw new Error('the curve is too short to measure');
    const [p, q] = which ? [pts[n - 1], pts[n - 2]] : [pts[0], pts[1]];
    const k = shape.kind === 'polyline' || n < 3 ? 0 : Math.abs(curvature3(which ? pts[n - 3] : pts[2], q, p));
    return { at: p, out: norm(sub(p, q)), k };
}

// --- Vertices: the corners and points a curve is drawn through (Plasticity's point selection) ---

/** A polyline or contour as its pieces, and whether it closes; null for curves without vertices to edit. */
function asPieces(c) {
    if (c.kind === 'polyline') {
        const pts = c.points.map(p => [...p]);
        return { pieces: [{ kind: 'polyline', points: c.closed ? [...pts, [...pts[0]]] : pts, closed: false }], closed: !!c.closed };
    }
    if (c.kind === 'arc') return { pieces: [{ kind: 'arc', start: c.start, mid: c.mid, end: c.end }], closed: false };
    if (c.kind === 'contour') return { pieces: c.pieces.map(p => ({ ...p })), closed: loops(c.pieces) };
    return null;
}

/** Where each vertex of a piece list sits: point `at` of piece `piece`, 'end' for an open curve's last point. */
function vertexEntries({ pieces, closed }) {
    const out = [];
    pieces.forEach((p, k) => {
        if (p.kind === 'polyline') for (let j = 0; j < p.points.length - 1; j++) out.push({ piece: k, at: j });
        else out.push({ piece: k, at: 0 });
    });
    if (!closed && pieces.length) out.push({ piece: pieces.length - 1, at: 'end' });
    return out;
}
const pieceStart = p => p.kind === 'arc' ? p.start : p.points[0];
const pieceEnd = p => p.kind === 'arc' ? p.end : p.points.at(-1);

/**
 * The curve's vertices in its plane, in order: a polyline's points, the corners and joints of a
 * contour, an arc's two ends, the points a spline or control-point curve was drawn from. Circles,
 * ellipses and spirals have none.
 */
export function curveVertices(c) {
    if (c.kind === 'spline' || c.kind === 'cv') return c.points.map(p => [...p]);
    // A NURBS curve's vertices are its control points (a closed one's last repeats its first).
    if (c.kind === 'nurbs') return (nurbsLoop(c) ? c.poles.slice(0, -1) : c.poles).map(q => [q[0], q[1]]);
    const a = asPieces(c);
    if (!a) return [];
    return vertexEntries(a).map(({ piece, at }) => {
        const p = a.pieces[piece];
        return [...(at === 'end' ? pieceEnd(p) : p.kind === 'arc' ? p.start : p.points[at])];
    });
}

/** The arc from `start` to `end` with the same sweep as `p`, its middle kept on the same side. */
function refitArc(p, start, end) {
    const chord = dist(p.start, p.end);
    if (chord < EPS) throw new Error('that arc has no length');
    const m = mul(add(p.start, p.end), 0.5), off = sub(p.mid, m), dir = norm(sub(p.end, p.start));
    // The middle's place across and along the chord, scaled to the new chord.
    const across = cross2(dir, off) / chord, along = dot2(dir, off) / chord;
    const c2 = dist(start, end);
    if (c2 < EPS) throw new Error('the two ends of an arc would meet');
    const d2 = norm(sub(end, start)), m2 = mul(add(start, end), 0.5);
    return { kind: 'arc', start, mid: add(m2, add(mul(d2, along * c2), mul(left(d2), across * c2))), end };
}

/**
 * The curve with some vertices moved: `moves` maps a vertex number (as curveVertices lists them) to
 * its new place in the curve's plane. Lines and splines go through the new points; an arc keeps
 * its sweep; a joint moves both pieces that meet there.
 */
export function moveVertices(c, moves) {
    const at = n => moves.get(n);
    if (c.kind === 'spline' || c.kind === 'cv') {
        const { samples: _, ...rest } = c;
        return { ...rest, points: c.points.map((p, n) => at(n) ? [...at(n)] : [...p]) };
    }
    if (c.kind === 'nurbs') {
        const poles = c.poles.map(q => [...q]), loop = nurbsLoop(c);
        poles.forEach((q, n) => { if (at(n)) poles[n] = [...at(n), q[2]]; });
        if (loop) poles[poles.length - 1] = [...poles[0]];
        return { ...c, poles };
    }
    const a = asPieces(c);
    if (!a) throw new Error('circles, ellipses and spirals have no vertices to move');
    const entries = vertexEntries(a);
    // Where every piece starts and ends after the move, then each piece rebuilt between them.
    const pieces = a.pieces.map(p => p.kind === 'polyline' ? { ...p, points: p.points.map(q => [...q]) } : { ...p });
    const starts = pieces.map(pieceStart), ends = pieces.map(pieceEnd);
    entries.forEach((v, n) => {
        const to = at(n);
        if (!to) return;
        if (v.at === 'end') { ends[v.piece] = to; return; }
        const p = pieces[v.piece];
        if (p.kind === 'polyline' && v.at > 0) { p.points[v.at] = [...to]; return; }
        starts[v.piece] = to;
        const before = v.piece > 0 ? v.piece - 1 : a.closed ? pieces.length - 1 : -1;
        if (before >= 0) ends[before] = to;
    });
    const out = pieces.map((p, k) => {
        if (p.kind === 'arc') return refitArc(p, [...starts[k]], [...ends[k]]);
        const pts = p.points;
        pts[0] = [...starts[k]]; pts[pts.length - 1] = [...ends[k]];
        return p;
    });
    if (c.kind === 'arc') return withShape(c, out[0]);
    if (c.kind === 'polyline') {
        const points = out[0].points;
        if (a.closed) points.pop();
        return withShape(c, { kind: 'polyline', points, closed: !!c.closed });
    }
    return withShape(c, { kind: 'contour', pieces: out });
}

/**
 * Where a vertex at `p` in curve `c`'s plane goes so that its coordinate along `axis` (a model-space
 * unit vector) is `value`: the shortest move that stays in the curve's plane.
 */
export function alignedInPlane(c, p, axis, value) {
    const { origin, x, normal } = frameOf(c);
    const y = [normal[1] * x[2] - normal[2] * x[1], normal[2] * x[0] - normal[0] * x[2], normal[0] * x[1] - normal[1] * x[0]];
    const d3 = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const inPlane = [d3(axis, x), d3(axis, y)], l2 = dot2(inPlane, inPlane);
    if (l2 < 1e-9) throw new Error('that axis points straight out of the curve\'s plane');
    const now = d3(origin, axis) + p[0] * inPlane[0] + p[1] * inPlane[1];
    return add(p, mul(inPlane, (value - now) / l2));
}

const pieceLength = p => {
    if (p.kind === 'arc') { const g = arcGeometry(p.start, p.mid, p.end); return g ? Math.abs(g.sweep) * g.radius : dist(p.start, p.end); }
    let l = 0;
    for (let i = 1; i < p.points.length; i++) l += dist(p.points[i - 1], p.points[i]);
    return l;
};

/** The piece cut `s` along from its start into two. */
function splitPiece(p, s) {
    if (!(s > EPS) || s >= pieceLength(p) - EPS) throw new Error('the distance runs past the next vertex; use a smaller distance');
    if (p.kind === 'arc') {
        const g = arcGeometry(p.start, p.mid, p.end), t = s / pieceLength(p);
        return [arcPiece(g, 0, t), arcPiece(g, t, 1)];
    }
    let walked = 0;
    for (let i = 1; i < p.points.length; i++) {
        const a = p.points[i - 1], b = p.points[i], l = dist(a, b);
        if (walked + l > s + EPS) {
            const q = add(a, mul(sub(b, a), (s - walked) / l));
            const before = [...p.points.slice(0, i), q], after = [q, ...p.points.slice(i)];
            return [{ ...p, points: before }, { ...p, points: after }];
        }
        walked += l;
    }
    throw new Error('the distance runs past the next vertex; use a smaller distance');
}
const reversePiece = p => p.kind === 'arc' ? { ...p, start: p.end, end: p.start } : { ...p, points: [...p.points].reverse() };

/**
 * Plasticity's Offset Vertex: new vertices `d` along the curve on both sides of vertex `n` (one
 * side at an open end). The curve keeps its shape; lines and arcs are cut where the new vertices go.
 */
export function offsetVertex(c, n, d) {
    if (!Number.isFinite(d) || !(d > EPS)) throw new Error('the distance must be above zero');
    if (c.kind === 'polyline' && c.closed && n === 0 && c.points.length > 2) {
        // Start the loop one point earlier so the corner sits inside it.
        const k = c.points.length;
        return offsetVertex({ ...c, points: [c.points[k - 1], ...c.points.slice(0, k - 1)] }, 1, d);
    }
    const a = asPieces(c);
    if (!a) throw new Error('Offset Vertex works on lines, arcs and contours of them');
    let { pieces } = a;
    const entries = vertexEntries(a);
    const v = entries[n];
    if (!v) throw new Error('no such vertex');
    // The vertex as the joint between piece r - 1 (ending there) and piece r (starting there).
    let r;
    if (v.at === 'end') r = pieces.length;
    else if (v.at === 0) r = v.piece;
    else {
        const p = pieces[v.piece];
        pieces = [...pieces.slice(0, v.piece), { ...p, points: p.points.slice(0, v.at + 1) }, { ...p, points: p.points.slice(v.at) }, ...pieces.slice(v.piece + 1)];
        r = v.piece + 1;
    }
    const m = pieces.length;
    const l = r > 0 ? r - 1 : a.closed ? m - 1 : -1;
    const right = r < m ? r : -1;
    if (l === right) throw new Error('the curve is a single closed piece; Offset Vertex needs a corner');
    const out = pieces.map(p => [p]);
    if (right >= 0) out[right] = splitPiece(pieces[right], d);
    if (l >= 0) out[l] = splitPiece(reversePiece(pieces[l]), d).map(reversePiece).reverse();
    const flat = out.flat();
    if (c.kind === 'polyline' && flat.every(p => p.kind === 'polyline')) {
        const points = [flat[0].points[0]];
        for (const p of flat) points.push(...p.points.slice(1));
        // A closed polyline went round from vertex 0; put the corner back first.
        if (a.closed) points.pop();
        return withShape(c, { kind: 'polyline', points, closed: a.closed });
    }
    return withShape(c, { kind: 'contour', pieces: flat });
}
