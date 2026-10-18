// Plasticity's Create Outline: the outline of solids or sheets seen along the construction plane's
// normal, as 3D curves where that outline lies on the body (Project Outline makes the same outline
// flat on the plane). Each piece of the flat outline (from the backend's Project Outline) is lifted
// back onto the body: onto the body's own edge when one runs above it, otherwise onto the surface
// the line along the normal grazes. Shared by both builds; the ray cast comes from the viewport.
import { nurbsPoints } from './curves.js';
import { edgeCurve } from './altDuplicate.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(...a);
const unit = a => { const l = len(a); return a.map(v => v / l); };

/** Model-space points along a drawn curve shape of kind 'nurbs' (what Project Outline returns). */
export function nurbsModelPoints(c, perSpan = 16) {
    const N = unit(c.normal), X = unit(sub(c.x, N.map(v => v * dot(c.x, N)))), Y = cross(N, X);
    return nurbsPoints(c, perSpan).map(([u, v, h]) => add(add(add(c.origin, X, u), Y, v), N, h));
}

/**
 * The point on the body above `P` (a point of the flat outline), seen from the normal's side: on an
 * edge whose shadow passes within `tol` of P (the highest such), else at the height of `cast(P)`,
 * the body's point over P (the viewport's mesh point nearest the line along the normal).
 */
export function liftPoint(P, { normal, edges, cast, tol }) {
    const N = unit(normal);
    let best = null, top = -Infinity;
    for (const e of edges) {
        for (let i = 1; i < e.length; i++) {
            const A = e[i - 1], B = e[i], AB = sub(B, A);
            // The segment's shadow and P's offset from A, both with the normal part dropped.
            const s = sub(AB, N.map(v => v * dot(AB, N))), d0 = sub(P, A), d = sub(d0, N.map(v => v * dot(d0, N)));
            const ss = dot(s, s);
            const t = ss > 1e-18 ? Math.min(1, Math.max(0, dot(d, s) / ss)) : 0;
            if (len(sub(d, s.map(v => v * t))) > tol) continue;
            const Q = add(A, AB, t), h = dot(Q, N);
            if (h > top) { top = h; best = Q; }
        }
    }
    if (best) return best;
    const hit = cast?.(P);
    // Keep P's place across the plane (the outline there is exact) and take only the height.
    return hit ? add(P, N, dot(sub(hit, P), N)) : null;
}

/**
 * A triangle mesh's silhouette seen along `normal`: the edges between a triangle facing the normal's
 * side and one facing away (or with no neighbour), as segments [[a, b], ...]. `tris` is a flat list
 * of model-space corners, nine numbers a triangle; corners closer than `merge` are the same.
 */
export function meshSilhouette(tris, normal, merge = 1e-6) {
    const N = unit(normal), key = (x, y, z) => `${Math.round(x / merge)},${Math.round(y / merge)},${Math.round(z / merge)}`;
    const sides = new Map();
    for (let t = 0; t + 8 < tris.length; t += 9) {
        const P = [0, 1, 2].map(i => [tris[t + 3 * i], tris[t + 3 * i + 1], tris[t + 3 * i + 2]]);
        const f = dot(cross(sub(P[1], P[0]), sub(P[2], P[0])), N);
        if (Math.abs(f) < 1e-18) continue;
        for (let i = 0; i < 3; i++) {
            const a = P[i], b = P[(i + 1) % 3], ka = key(...a), kb = key(...b), k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
            const e = sides.get(k) ?? { a, b, up: 0, down: 0 };
            if (f > 0) e.up++; else e.down++;
            sides.set(k, e);
        }
    }
    const out = [];
    for (const e of sides.values()) if ((e.up && e.down) || e.up + e.down === 1) out.push([e.a, e.b]);
    return out;
}

/**
 * The point over `P` on the segments nearest the line through P along the normal (within `slack`
 * of the nearest, the highest), or null when none comes within `reach`.
 */
export function nearestOver(P, segments, normal, slack, reach = Infinity) {
    const N = unit(normal), found = [];
    let near = Infinity;
    for (const [A, B] of segments) {
        const AB = sub(B, A), s = sub(AB, N.map(v => v * dot(AB, N))), d0 = sub(P, A), d = sub(d0, N.map(v => v * dot(d0, N)));
        const ss = dot(s, s), t = ss > 1e-18 ? Math.min(1, Math.max(0, dot(d, s) / ss)) : 0;
        const gap = len(sub(d, s.map(v => v * t)));
        if (gap > reach) continue;
        found.push([gap, add(A, AB, t)]);
        near = Math.min(near, gap);
    }
    let best = null, top = -Infinity;
    for (const [gap, Q] of found) if (gap <= near + slack && dot(Q, N) > top) { top = dot(Q, N); best = Q; }
    return best;
}

/** Douglas–Peucker thinning of a 3D polyline to within `tol`. */
function thin(pts, tol) {
    if (pts.length < 3) return pts;
    const A = pts[0], B = pts.at(-1), AB = sub(B, A), l = len(AB);
    let far = 0, at = 0;
    for (let i = 1; i < pts.length - 1; i++) {
        const d = l > 1e-12 ? len(cross(sub(pts[i], A), AB)) / l : len(sub(pts[i], A));
        if (d > far) { far = d; at = i; }
    }
    if (far <= tol) return [A, B];
    return [...thin(pts.slice(0, at + 1), tol).slice(0, -1), ...thin(pts.slice(at), tol)];
}

/** The plane through 3D points when they all lie in one (within `tol`), else null. */
function planeThrough(pts, tol) {
    const O = pts[0];
    let F = O;
    for (const p of pts) if (len(sub(p, O)) > len(sub(F, O))) F = p;
    const X = sub(F, O);
    if (len(X) < 1e-12) return null;
    let n = [0, 0, 0];
    for (const p of pts) { const c = cross(X, sub(p, O)); if (len(c) > len(n)) n = c; }
    // Straight: any plane through the line does.
    if (len(n) < 1e-9 * dot(X, X)) n = cross(X, Math.abs(X[0]) < 0.9 * len(X) ? [1, 0, 0] : [0, 1, 0]);
    n = unit(n);
    if (pts.some(p => Math.abs(dot(sub(p, O), n)) > tol)) return null;
    return { origin: O, x: unit(X), normal: n };
}

/** A run of lifted points as one curve: a line, circle, arc or spline in their plane, else a 3D polyline. */
function runCurve(out, normal, tol, loose = tol) {
    const plane = planeThrough(out, tol);
    if (plane) return edgeCurve(out, plane);
    const N = unit(normal), h = out.map(p => dot(p, N)), lo = Math.min(...h), hi = Math.max(...h);
    // Heights found on the viewport's mesh wobble with its facets: level within `loose`, they are level.
    if (hi - lo <= loose) {
        const mid = (lo + hi) / 2, level = out.map((p, i) => add(p, N, mid - h[i]));
        const X = Math.abs(N[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
        return edgeCurve(level, { origin: level[0], x: sub(X, N.map(v => v * dot(X, N))), normal: N });
    }
    const pts = thin(out, Math.max(tol, loose) / 4), O = pts[0];
    const X = unit(sub(pts.at(-1), O).some(v => Math.abs(v) > 1e-9) ? sub(pts.at(-1), O) : sub(pts[1], O));
    const ref = Math.abs(dot(X, N)) < 0.9 ? N : (Math.abs(X[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
    const n = unit(sub(ref, X.map(v => v * dot(ref, X)))), Y = cross(n, X);
    const local = pts.map(p => { const d = sub(p, O); return [dot(d, X), dot(d, Y), dot(d, n)]; });
    const total = local.slice(1).reduce((s, p, i) => s + len(sub(p, local[i])), 0);
    let run = 0;
    const knots = [0, 0, ...local.slice(1, -1).map((p, i) => (run += len(sub(p, local[i]))) / total), 1, 1];
    return { origin: O, x: X, normal: n, kind: 'nurbs', degree: 1, poles: local, weights: local.map(() => 1), knots };
}

/**
 * One piece of the flat outline lifted onto the body as drawn curves (`opts`: normal, edges, cast,
 * tol, and `loose`, how far heights cast on the mesh may wobble and still count as level). It is split where it turns
 * sharply (a box's corners), each run a line, circle, arc or spline in the plane of its lifted points
 * when they lie in one, else a 3D polyline (a degree-1 NURBS); runs that are all straight and lie in
 * one plane come back as one polyline (closed round a loop). Empty when no part of it lies over the body.
 */
export function liftPiece(piece, opts) {
    const per = 16, flat = nurbsModelPoints(piece, per);
    const N = unit(opts.normal);
    const lifted = flat.map(P => liftPoint(P, opts));
    const closed = flat.length > 3 && len(sub(flat[0], flat.at(-1))) < 1e-9;
    // Corners: the flat piece's sharp knots (repeated as often as its degree), where the lifted
    // points also turn. Samples run `per` to a span, so the k-th span boundary is sample k·per.
    const { degree: p, knots } = piece, inner = [];
    for (let k = p + 1; k < piece.poles.length; k++) if (knots[k] > knots[p] && knots[k] < knots[piece.poles.length]) {
        const m = knots.filter(v => Math.abs(v - knots[k]) < 1e-12).length;
        if (m >= p && !inner.includes(knots[k])) inner.push(knots[k]);
    }
    const spans = [...new Set(knots.slice(p, piece.poles.length + 1))];
    const turns = i => {
        const q = lifted[i], a = lifted[i - 1] ?? (closed ? lifted.at(-2) : null), b = lifted[i + 1] ?? (closed ? lifted[1] : null);
        if (!q || !a || !b) return false;
        const u = sub(q, a), v = sub(b, q);
        return len(u) > 1e-12 && len(v) > 1e-12 && dot(u, v) / (len(u) * len(v)) < Math.cos(Math.PI / 18);
    };
    let corners = inner.map(k => spans.indexOf(k) * per).filter(i => i > 0 && i < flat.length - 1 && turns(i));
    if (closed && turns(0)) corners = [0, ...corners];
    const keep = pts => pts.filter((q, i) => q && !(i && pts[i - 1] && len(sub(q, pts[i - 1])) < 1e-9));
    const runs = [];
    if (!corners.length) runs.push(lifted);
    else if (closed) {
        const n = flat.length - 1, ring = i => lifted[i % n];
        for (let k = 0; k < corners.length; k++) {
            const a = corners[k], b = k + 1 < corners.length ? corners[k + 1] : corners[0] + n;
            runs.push(Array.from({ length: b - a + 1 }, (_, j) => ring(a + j)));
        }
    } else {
        const at = [0, ...corners, flat.length - 1];
        for (let k = 1; k < at.length; k++) runs.push(lifted.slice(at[k - 1], at[k] + 1));
    }
    const kept = runs.map(keep).filter(r => r.length >= 2);
    if (!kept.length) return [];
    const curves = kept.map(r => runCurve(r, N, opts.tol, opts.loose)).filter(Boolean);
    // Straight runs end to end in one plane: one polyline, closed round a loop.
    const whole = kept.length === runs.length && curves.length === kept.length && curves.every(c => c.kind === 'polyline' && c.points.length === 2);
    const ends = kept.map(r => r[0]).concat(closed ? [] : [kept.at(-1).at(-1)]);
    const plane = whole && ends.length >= 2 && planeThrough(ends, opts.tol);
    if (plane && kept.length > 1) {
        const X = plane.x, Y = cross(plane.normal, X);
        return [{ origin: plane.origin, x: X, normal: plane.normal, kind: 'polyline', points: ends.map(q => { const d = sub(q, plane.origin); return [dot(d, X), dot(d, Y)]; }), closed }];
    }
    return curves;
}
