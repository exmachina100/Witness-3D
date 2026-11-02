// Plasticity's Pipe Distance 1 and Distance 2 (2025.2's extend methods): each end of the path is
// moved by its distance, a fraction of the path's length. 1 leaves the end where it is, less pulls
// it back along the path (Distance 1 the start, Distance 2 the end), more carries the path on past
// it as Extend Curve's Natural does. The manual says only that values below 1 shorten the pipe;
// reading the values as fractions of the length, and above 1 as extending, is inferred. Pure.
import { extendCurve, samples, splitCurve } from './curveEdit.js';

const length = pts => pts.slice(1).reduce((l, p, i) => l + Math.hypot(...p.map((v, k) => v - pts[i][k])), 0);

/** The point `s` along the sampled path. */
function pointAt(pts, s) {
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], d = Math.hypot(...b.map((v, k) => v - a[k]));
        if (s <= d || i === pts.length - 1) { const t = d > 0 ? Math.min(1, Math.max(0, s / d)) : 0; return a.map((v, k) => v + (b[k] - v) * t); }
        s -= d;
    }
    return pts[pts.length - 1];
}

/** True when both distances leave the path as it is. */
export const untrimmed = (d1 = 1, d2 = 1) => Math.abs(d1 - 1) < 1e-9 && Math.abs(d2 - 1) < 1e-9;

/** The curve `c` with its start moved by `d1` and its end by `d2` (fractions of its length). */
export function pipePath(c, d1 = 1, d2 = 1) {
    if (!(Number.isFinite(d1) && d1 > 0 && Number.isFinite(d2) && d2 > 0)) throw new Error('the distances must be greater than zero');
    if (untrimmed(d1, d2)) return c;
    const { points, closed } = samples(c, 256);
    if (closed) throw new Error('distances need a path with two ends');
    const L = length(points), s0 = Math.max(0, 1 - d1) * L, s1 = Math.min(1, d2) * L;
    if (s1 - s0 < 1e-3 * L) throw new Error('the distances leave no pipe; make them add up to more than 1');
    let out = c;
    if (d1 < 1) out = splitCurve(out, pointAt(points, s0))[1];
    if (d2 < 1) out = splitCurve(out, pointAt(points, s1))[0];
    if (d1 > 1) out = extendCurve(out, 0, (d1 - 1) * L);
    if (d2 > 1) out = extendCurve(out, 1, (d2 - 1) * L);
    return out;
}
