// Edge Align's near-edge pairing (Plasticity 2026.2): with two sheets picked in face or solid mode,
// the boundary edges of the two that lie nearest each other are the pair to align. Pure: edges are
// polylines given as flat [x, y, z, ...] arrays.

const pts = flat => { const out = []; for (let i = 2; i < flat.length; i += 3) out.push([flat[i - 2], flat[i - 1], flat[i]]); return out; };

/** The distance from point p to the polyline q (a list of points). */
function toPolyline(p, q) {
    if (q.length === 1) return Math.hypot(p[0] - q[0][0], p[1] - q[0][1], p[2] - q[0][2]);
    let best = Infinity;
    for (let i = 1; i < q.length; i++) {
        const a = q[i - 1], b = q[i], ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / l2)) : 0;
        best = Math.min(best, Math.hypot(p[0] - a[0] - t * ab[0], p[1] - a[1] - t * ab[1], p[2] - a[2] - t * ab[2]));
    }
    return best;
}

/** How far apart two edges lie: the mean distance of each one's points to the other, both ways. */
export function edgeGap(a, b) {
    const pa = pts(a), pb = pts(b);
    if (!pa.length || !pb.length) return Infinity;
    const mean = (xs, ys) => xs.reduce((s, p) => s + toPolyline(p, ys), 0) / xs.length;
    return (mean(pa, pb) + mean(pb, pa)) / 2;
}

/**
 * The pair of edges, one from each list of candidates ({ n, points }), that lie nearest each other,
 * as { a, b, gap } with a and b the edge numbers; null when either list is empty.
 */
export function nearestEdgePair(first, second) {
    let best = null;
    for (const a of first) for (const b of second) {
        const gap = edgeGap(a.points, b.points);
        if (!best || gap < best.gap) best = { a: a.n, b: b.n, gap };
    }
    return best;
}
