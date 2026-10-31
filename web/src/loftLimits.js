// Plasticity's Loft limit points (L): "Specify the range to loft". Up to two points on a profile
// curve; clicking a point again reverses which side of it lofts. Points are in the curve's plane
// coordinates, as Split Curve takes them, and the range comes back as a curve of its own.
import { distanceTo, samples, splitCurve } from './curveEdit.js';

/** The curve split at `at`, or null where `at` is an end of it (nothing to split). */
function split(c, at) {
    try { return splitCurve(c, at) } catch { return null }
}

const frameOf = c => ({ origin: c.origin, x: c.x, normal: c.normal });
const shapeOf = ({ origin, x, normal, ...shape }) => shape;
/** One piece, or a contour of several, in the frame of `c`. */
const joined = (c, pieces) => pieces.length === 1 ? { ...frameOf(c), ...pieces[0] } : { ...frameOf(c), kind: 'contour', pieces };

/**
 * A closed curve already opened at one point (it starts and ends there), cut in two at `at`: the
 * part from its start to `at`, and from `at` round to its end. A contour (a circle opens as two
 * arcs) is cut in the piece nearest `at`, the pieces either side kept whole.
 */
function apart(opened, at) {
    if (opened.kind !== 'contour') return split(opened, at);
    const ps = opened.pieces, d = ps.map(p => distanceTo({ ...frameOf(opened), ...p }, at));
    const k = d.indexOf(Math.min(...d));
    const cut = split({ ...frameOf(opened), ...ps[k] }, at);
    if (cut?.length === 2) return [joined(opened, [...ps.slice(0, k), shapeOf(cut[0])]), joined(opened, [shapeOf(cut[1]), ...ps.slice(k + 1)])];
    // At a joint between pieces: the pieces before it and after it.
    const near = p => Math.hypot(p[0] - at[0], p[1] - at[1]) < 1e-6;
    const j = near(ps[k].start ?? ps[k].points?.[0] ?? [NaN, NaN]) ? k : k + 1;
    if (j <= 0 || j >= ps.length) return null;
    return [joined(opened, ps.slice(0, j)), joined(opened, ps.slice(j))];
}

/**
 * The part of `c` that lofts, given its `limits` (0 to 2 plane points) and `flip`: one point on an
 * open curve keeps the part before it (after it when flipped); one on a closed curve opens it there,
 * so the sheet's seam starts at that point; two keep the stretch between them (on a closed curve,
 * the other way round when flipped).
 */
export function limitCurve(c, limits = [], flip = false) {
    if (!limits.length) return c;
    if (limits.length > 2) throw new Error('up to two limit points on each curve');
    const closed = samples(c).closed;
    const [a, b] = limits;
    const first = split(c, a);
    if (!first) return limits.length === 2 ? limitCurve(c, [b], flip) : c;
    if (limits.length === 1) return closed ? first[0] : first[flip ? 1 : 0];
    if (closed) {
        const round = apart(first[0], b);
        if (!round) return first[0];
        return round[flip ? 1 : 0];
    }
    // Open, two points: the piece holding b, cut again at b; the stretch next to a is the range.
    const k = distanceTo(first[0], b) <= distanceTo(first[1], b) ? 0 : 1;
    const again = split(first[k], b);
    if (!again) return first[k];
    return k === 1 ? again[0] : again[1];
}
