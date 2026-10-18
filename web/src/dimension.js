// Plasticity's Dimension (=): the sizes a selection has, and the edit that gives each a new value.
// A curve's circle or arc has a diameter and a rectangle two sides; a round face a diameter; two
// flat faces of one body the distance between them; a ball its diameter and a block its three
// sides. Each edit is an existing operation (Offset Face, a scale about a centre, a curve
// replaced), so both builds share this file; the faces' surfaces come from the backend
// (faceSurfaces.js in the browser, w3d_face_surfaces on the desktop).
import { circleThrough } from './curves.js';

const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const along = (p, d, t) => p.map((v, i) => v + d[i] * t);

/** A closed four-point polyline with square corners: [corner, along first side, along second]. */
function rectangle(c) {
    if (c.kind !== 'polyline' || !c.closed || c.points.length !== 4) return null;
    const p = c.points, side = (i, j) => [p[j][0] - p[i][0], p[j][1] - p[i][1]];
    for (let i = 0; i < 4; i++) {
        const a = side(i, (i + 1) % 4), b = side((i + 1) % 4, (i + 2) % 4);
        if (Math.abs(a[0] * b[0] + a[1] * b[1]) > 1e-6 * Math.hypot(...a) * Math.hypot(...b)) return null;
    }
    return { corner: p[0], u: side(0, 1), v: side(0, 3) };
}

/** A curve's sizes. Each edit returns { op: 'curve', curve } with the curve's new shape. */
export function curveDimensions(c) {
    if (c.kind === 'circle') {
        return [{ label: 'DIAMETER', value: 2 * c.radius, edit: d => ({ op: 'curve', curve: { ...c, radius: d / 2 } }) }];
    }
    if (c.kind === 'arc') {
        const g = circleThrough(c.start, c.mid, c.end);
        if (!g) return [];
        const k = q => d => g.center.map((m, i) => m + (q[i] - m) * d / (2 * g.radius));
        return [{ label: 'DIAMETER', value: 2 * g.radius, edit: d => ({ op: 'curve', curve: { ...c, start: k(c.start)(d), mid: k(c.mid)(d), end: k(c.end)(d) } }) }];
    }
    const r = rectangle(c);
    if (!r) return [];
    const lu = Math.hypot(...r.u), lv = Math.hypot(...r.v);
    const rect = (w, l) => {
        const u = r.u.map(x => x / lu * w), v = r.v.map(x => x / lv * l), o = r.corner;
        return { op: 'curve', curve: { ...c, points: [o, [o[0] + u[0], o[1] + u[1]], [o[0] + u[0] + v[0], o[1] + u[1] + v[1]], [o[0] + v[0], o[1] + v[1]]] } };
    };
    return [
        { label: 'WIDTH', value: lu, edit: w => rect(w, lv) },
        { label: 'LENGTH', value: lv, edit: l => rect(lu, l) },
    ];
}

/**
 * Selected faces of one body: one round face's diameter (Offset Face moves it; out for a boss,
 * in for a hole), or two flat parallel faces' distance (the second moves). Edits return
 * { op: 'offset', body, faces, distance }. `a` and `b` are where to draw the dimension.
 */
export function faceDimensions(body, faces, surfaces) {
    const s = faces.map(n => surfaces[n]);
    if (faces.length === 1 && (s[0]?.kind === 'cylinder' || s[0]?.kind === 'sphere')) {
        const f = s[0], sign = f.outward ? 1 : -1;
        return [{ label: 'DIAMETER', value: 2 * f.radius, edit: d => ({ op: 'offset', body, faces, distance: sign * (d / 2 - f.radius) }) }];
    }
    if (faces.length === 2 && s.every(f => f?.kind === 'plane')) {
        const [f1, f2] = s;
        if (Math.abs(Math.abs(dot(f1.normal, f2.normal)) - 1) > 1e-6) return [];
        const gap = dot(sub(f2.origin, f1.origin), f1.normal), d = Math.abs(gap);
        if (d < 1e-9) return [];
        // The second face moves away from the first as the distance grows.
        const sign = Math.sign(dot(sub(f2.origin, f1.origin), f2.normal)) || 1;
        return [{ label: 'DISTANCE', value: d, a: f1.origin, b: along(f1.origin, f1.normal, gap), edit: v => ({ op: 'offset', body, faces: [faces[1]], distance: sign * (v - d) }) }];
    }
    return [];
}

/**
 * A whole solid's sizes: a ball's diameter (scaled about its centre: { op: 'scale', body, pivot,
 * scale }), or a block's width, length and height along its sides, the side facing most along
 * +x, back (model −z) and up (model +y) moving.
 */
export function solidDimensions(body, surfaces) {
    if (surfaces.length === 1 && surfaces[0].kind === 'sphere' && surfaces[0].outward) {
        const f = surfaces[0];
        return [{ label: 'DIAMETER', value: 2 * f.radius, edit: d => ({ op: 'scale', body, pivot: f.centre, scale: d / (2 * f.radius) }) }];
    }
    if (surfaces.length !== 6 || !surfaces.every(f => f.kind === 'plane')) return [];
    const pairs = [], used = new Set();
    for (let i = 0; i < 6; i++) {
        if (used.has(i)) continue;
        const j = surfaces.findIndex((f, k) => k !== i && !used.has(k) && dot(f.normal, surfaces[i].normal) < -1 + 1e-6);
        if (j < 0) return [];
        used.add(i); used.add(j);
        pairs.push([i, j]);
    }
    const square = pairs.every(([a], m) => pairs.every(([b], n) => m === n || Math.abs(dot(surfaces[a].normal, surfaces[b].normal)) < 1e-6));
    if (!square) return [];
    const WORLD = [['WIDTH', [1, 0, 0]], ['LENGTH', [0, 0, -1]], ['HEIGHT', [0, 1, 0]]];
    const out = [];
    for (const [label, dir] of WORLD) {
        // The pair lying most along this direction, its face pointing that way the one that moves.
        const best = pairs.filter(p => !out.some(o => o.pair === p)).sort((p, q) => Math.abs(dot(surfaces[q[0]].normal, dir)) - Math.abs(dot(surfaces[p[0]].normal, dir)))[0];
        const [i, j] = dot(surfaces[best[0]].normal, dir) >= 0 ? best : [best[1], best[0]];
        const d = Math.abs(dot(sub(surfaces[i].origin, surfaces[j].origin), surfaces[i].normal));
        out.push({ label, value: d, pair: best, edit: v => ({ op: 'offset', body, faces: [i], distance: v - d }) });
    }
    return out.map(({ pair, ...rest }) => rest);
}
