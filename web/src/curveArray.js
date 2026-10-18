// Plasticity's Curve Array: copies of the selected bodies placed evenly along a curve, by length.
// The original stays where it is, at the curve's start; each copy is moved from the start to its
// place along the curve and, when aligned, turned with the curve's tangent about the curve's
// normal. Shared by the browser and desktop builds: both take the motions as an array spec.

import { samples } from './curveEdit.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** `count` places along the curve (start included): { at: plane point, tangent: plane direction }. */
export function placesAlong(c, count) {
    const { points, closed } = samples(c, 256);
    const pts = closed ? [...points, points[0]] : points;
    const lengths = [0];
    for (let i = 1; i < pts.length; i++) lengths.push(lengths[i - 1] + Math.hypot(...sub(pts[i], pts[i - 1])));
    const total = lengths.at(-1);
    if (!(total > 1e-9)) throw new Error('the curve has no length');
    const gaps = closed ? count : count - 1;
    // The point at length s along the samples (clamped on open curves, wrapped on closed ones).
    const pointAt = s => {
        if (closed) s = ((s % total) + total) % total;
        else s = Math.min(Math.max(s, 0), total);
        let k = 1;
        while (k < pts.length - 1 && lengths[k] <= s) k++;
        const d = sub(pts[k], pts[k - 1]), len = Math.hypot(...d) || 1, t = (s - lengths[k - 1]) / len;
        return [pts[k - 1][0] + d[0] * t, pts[k - 1][1] + d[1] * t];
    };
    const h = total / 2048;
    return Array.from({ length: count }, (_, i) => {
        const s = gaps ? total * i / gaps : 0;
        // Central difference, one-sided at an open curve's ends.
        const d = sub(pointAt(s + h), pointAt(s - h)), len = Math.hypot(...d) || 1;
        return { at: pointAt(s), tangent: [d[0] / len, d[1] / len] };
    });
}

/**
 * The motion of every copy (the original excluded) for an array spec of kind 'motions': `count`
 * places in all, spaced evenly by length (a closed curve's last place stops short of its start).
 */
export function curveArrayMotions(c, count, align = true) {
    if (!Number.isInteger(count) || count < 1) throw new Error('the array count must be at least 1');
    if (count > 1000) throw new Error('that array makes more than 1000 bodies');
    if (count < 2) return [];
    const y = cross3(c.normal, c.x);
    const model = ([u, v]) => [0, 1, 2].map(k => c.origin[k] + u * c.x[k] + v * y[k]);
    const places = placesAlong(c, count), p0 = model(places[0].at), t0 = places[0].tangent;
    return places.slice(1).map(({ at, tangent }) => {
        const p = model(at);
        const angle = align ? Math.atan2(t0[0] * tangent[1] - t0[1] * tangent[0], t0[0] * tangent[0] + t0[1] * tangent[1]) : 0;
        return { offset: sub3(p, p0), pivot: p0, axis: [...c.normal], angle };
    });
}
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
