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

// Quaternions as [x, y, z, w].
const quat = (axis, angle) => { const l = Math.hypot(...axis) || 1, s = Math.sin(angle / 2); return [axis[0] / l * s, axis[1] / l * s, axis[2] / l * s, Math.cos(angle / 2)]; };
const qmul = ([ax, ay, az, aw], [bx, by, bz, bw]) => [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
const qrot = (q, v) => { const [x, y, z, w] = qmul(qmul(q, [...v, 0]), [-q[0], -q[1], -q[2], q[3]]); return [x, y, z]; };
/** A quaternion as an axis and an angle in radians. */
function axisAngle(q) {
    if (q[3] < 0) q = q.map(v => -v);
    const s = Math.sqrt(Math.max(0, 1 - q[3] * q[3]));
    return s < 1e-12 ? { axis: [0, 0, 1], angle: 0 } : { axis: [q[0] / s, q[1] / s, q[2] / s], angle: 2 * Math.acos(Math.min(1, q[3])) };
}

/**
 * The motion of every copy (the original excluded) for an array spec of kind 'motions': `count`
 * places in all, spaced evenly by length (a closed curve's last place stops short of its start).
 * Options (Plasticity's Curve Array dialog): `twist`, degrees the last copy turns about the curve
 * (the copies between in proportion), and `scale`, the last copy's size (the copies between
 * growing evenly from 1). How Plasticity spreads them is not documented; even steps are inferred.
 */
export function curveArrayMotions(c, count, align = true, { twist = 0, scale = 1 } = {}) {
    if (!Number.isFinite(twist)) throw new Error('the twist must be a number');
    if (!(scale > 0)) throw new Error('the scale must be above zero');
    if (!Number.isInteger(count) || count < 1) throw new Error('the array count must be at least 1');
    if (count > 1000) throw new Error('that array makes more than 1000 bodies');
    if (count < 2) return [];
    const y = cross3(c.normal, c.x);
    const model = ([u, v]) => [0, 1, 2].map(k => c.origin[k] + u * c.x[k] + v * y[k]);
    const places = placesAlong(c, count), p0 = model(places[0].at), t0 = places[0].tangent;
    const last = places.length - 1;
    return places.slice(1).map(({ at, tangent }, k) => {
        const p = model(at), f = (k + 1) / last;
        const turn = align ? Math.atan2(t0[0] * tangent[1] - t0[1] * tangent[0], t0[0] * tangent[0] + t0[1] * tangent[1]) : 0;
        let q = quat(c.normal, turn);
        // The twist turns the copy about the curve where it stands, after the turn with the curve.
        if (twist) {
            const t = [0, 1, 2].map(i => tangent[0] * c.x[i] + tangent[1] * y[i]);
            q = qmul(quat(align ? t : qrot(q, [0, 1, 2].map(i => t0[0] * c.x[i] + t0[1] * y[i])), twist * f * Math.PI / 180), q);
        }
        const { axis, angle } = axisAngle(q);
        return { offset: sub3(p, p0), pivot: p0, axis, angle, scale: 1 + (scale - 1) * f };
    });
}
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
