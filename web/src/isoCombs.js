// Toggle Surface Curvature on faces: curvature combs along a few isoparams of each face, in u and in
// v, cut to the face where trims or holes take part of its surface away. The points come from the
// face's own surface (Deform Curve's face coordinates, s and t scaled 0..1 over the face), so this
// is shared by both builds; the combs are read off them.

const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(...a);

/** `count` isoparams each way across the face, `n` + 1 face coordinates [s, t, 0] along each. */
export function isoLines(count = 5, n = 96) {
    const lines = [];
    for (const u of [true, false]) for (let i = 0; i < count; i++) {
        const c = (i + 0.5) / count;
        lines.push(Array.from({ length: n + 1 }, (_, j) => u ? [j / n, c, 0] : [c, j / n, 0]));
    }
    return lines;
}

/**
 * Comb teeth { at, dir, k } along a run of points: the curvature of the circle through each point
 * and its neighbours, the tooth standing away from its centre. Ends copy their neighbour's.
 */
export function combTeeth(points) {
    const n = points.length;
    if (n < 3) return [];
    const teeth = points.map((p, i) => {
        if (i === 0 || i === n - 1) return null;
        const a = sub(points[i - 1], p), b = sub(points[i + 1], p), ab = sub(b, a);
        const w = cross(a, b), w2 = dot(w, w);
        const scale = len(a) * len(b) * len(ab);
        if (scale < 1e-18 || w2 < 1e-18 * scale * scale) return { at: [...p], dir: [0, 0, 0], k: 0 };
        // Circumcentre offset from p: (|a|²(b × w) + |b|²(w × a)) / 2|w|².
        const c = cross(b, w).map((v, j) => (dot(a, a) * v + dot(b, b) * cross(w, a)[j]) / (2 * w2));
        const r = len(c);
        return { at: [...p], dir: c.map(v => -v / r), k: 1 / r };
    });
    teeth[0] = { ...teeth[1], at: [...points[0]] };
    teeth[n - 1] = { ...teeth[n - 2], at: [...points[n - 1]] };
    return teeth;
}

/** The nearest distance from `p` to triangle `a b c`. */
function toTriangle(p, a, b, c) {
    const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
    const d1 = dot(ab, ap), d2 = dot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return len(ap);
    const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return len(bp);
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return len(sub(ap, ab.map(x => x * v))); }
    const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return len(cp);
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return len(sub(ap, ac.map(x => x * w))); }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return len(sub(bp, sub(c, b).map(x => x * w))); }
    const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
    return len(sub(ap, ab.map((x, i) => x * v + ac[i] * w)));
}

/**
 * The runs of `points` (one isoparam) that lie on the face drawn by `triangles` ([a, b, c] each),
 * within `tol`: the parts of the surface trimmed away fall off the triangles and split the run.
 */
export function onFace(points, triangles, tol) {
    // Each triangle's bounding sphere, to pass over the far ones quickly.
    const balls = triangles.map(([a, b, c]) => {
        const m = [0, 1, 2].map(i => (a[i] + b[i] + c[i]) / 3);
        return { m, r: Math.max(len(sub(a, m)), len(sub(b, m)), len(sub(c, m))) + tol };
    });
    const runs = [];
    let run = [];
    for (const p of points) {
        if (triangles.some((t, i) => len(sub(p, balls[i].m)) <= balls[i].r && toTriangle(p, ...t) <= tol)) run.push(p);
        else { if (run.length >= 3) runs.push(run); run = []; }
    }
    if (run.length >= 3) runs.push(run);
    return runs;
}
