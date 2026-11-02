// A flat face's outline as a closed drawn curve, so a face can serve where a closed curve is wanted
// (Pipe's custom profile: C, then click a face). Shared by both builds; pure.
//
// The face's edges come as the polylines the viewport draws them with. They are chained into loops
// and the largest loop is the outline; each edge becomes a line, an arc (when its points lie on one
// circle) or a smooth curve through its points, joined end to end as one contour.

/**
 * @param {number[][]} edges flat [x, y, z, ...] polylines of the face's own edges
 * @param {{origin: number[], normal: number[]}} plane the face's plane
 * @returns {{curve: object, holes: number}} the outline as a curve ({origin, x, normal, kind, ...})
 *   and how many inner loops (holes) it leaves out
 */
export function faceProfile(edges, plane, tol = 1e-4) {
    if (!edges.length) throw new Error('that face has no edges');
    const n = unit(plane.normal), origin = plane.origin;
    const x = unit(Math.abs(n[0]) < 0.9 ? cross(n, [1, 0, 0]) : cross(n, [0, 1, 0])), y = cross(n, x);
    const flat = edges.map(e => {
        const pts = [];
        for (let i = 0; i + 2 < e.length; i += 3) { const d = sub([e[i], e[i + 1], e[i + 2]], origin); pts.push([dot(d, x), dot(d, y)]); }
        return pts;
    }).filter(p => p.length >= 2);
    const size = Math.max(1, ...flat.flat(2).map(v => Math.abs(v)));
    const join = 1e-3 * size;
    const loops = chain(flat, join);
    if (!loops.length) throw new Error("the face's edges don't close into an outline");
    const areas = loops.map(l => Math.abs(area2(l.flatMap((e, i) => i ? e.slice(1) : e))));
    const outer = loops[areas.indexOf(Math.max(...areas))];
    const curve = { origin: [...origin], x, normal: n, ...shapeOf(outer, tol * size) };
    return { curve, holes: loops.length - 1 };
}

/** The edges chained into closed loops, each a list of point lists running end to end. */
function chain(edges, join) {
    const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < join;
    const left = edges.map(e => e.slice()), loops = [];
    while (left.length) {
        const first = left.shift();
        if (near(first[0], first.at(-1)) && first.length > 2) { loops.push([first]); continue; }
        const loop = [first];
        for (;;) {
            const end = loop.at(-1).at(-1);
            if (near(end, loop[0][0])) { loops.push(loop); break; }
            const i = left.findIndex(e => near(e[0], end) || near(e.at(-1), end));
            if (i < 0) break; // an open chain: not part of the outline
            const [e] = left.splice(i, 1);
            loop.push(near(e[0], end) ? e : e.reverse());
        }
    }
    return loops;
}

/** One loop as a curve shape: a polygon, a circle, or a contour of lines, arcs and splines. */
function shapeOf(loop, tol) {
    if (loop.length === 1) {
        const pts = loop[0].slice(0, -1);
        const c = circleOf(pts, tol);
        if (c) return { kind: 'circle', center: c.center, radius: c.radius };
        return { kind: 'spline', points: pts, closed: true };
    }
    const pieces = [];
    for (const e of loop) {
        const a = e[0], b = e.at(-1);
        if (e.every(p => lineGap(p, a, b) <= tol)) {
            const last = pieces.at(-1);
            if (last?.kind === 'polyline') last.points.push(b); else pieces.push({ kind: 'polyline', points: [a, b], closed: false });
            continue;
        }
        const c = e.length >= 3 && circleOf(e, tol);
        pieces.push(c ? { kind: 'arc', start: a, mid: e[Math.floor(e.length / 2)], end: b } : { kind: 'spline', points: e, closed: false });
    }
    if (pieces.length === 1 && pieces[0].kind === 'polyline') return { kind: 'polyline', points: pieces[0].points.slice(0, -1), closed: true };
    return { kind: 'contour', pieces };
}

/** The circle through the first, middle and last points, if every point lies on it within tol. */
function circleOf(pts, tol) {
    if (pts.length < 3) return null;
    const [a, b, c] = [pts[0], pts[Math.floor(pts.length / 3)], pts[Math.floor(2 * pts.length / 3)]];
    const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
    if (Math.abs(d) < 1e-12) return null;
    const s = p => p[0] * p[0] + p[1] * p[1];
    const center = [(s(a) * (b[1] - c[1]) + s(b) * (c[1] - a[1]) + s(c) * (a[1] - b[1])) / d, (s(a) * (c[0] - b[0]) + s(b) * (a[0] - c[0]) + s(c) * (b[0] - a[0])) / d];
    const radius = Math.hypot(a[0] - center[0], a[1] - center[1]);
    return pts.every(p => Math.abs(Math.hypot(p[0] - center[0], p[1] - center[1]) - radius) <= tol) ? { center, radius } : null;
}

/** How far p lies from the segment a-b. */
function lineGap(p, a, b) {
    const ab = [b[0] - a[0], b[1] - a[1]], l2 = ab[0] * ab[0] + ab[1] * ab[1];
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2)) : 0;
    return Math.hypot(p[0] - a[0] - t * ab[0], p[1] - a[1] - t * ab[1]);
}

const area2 = loop => loop.reduce((t, [px, py], i) => { const [u, v] = loop[(i + 1) % loop.length]; return t + px * v - u * py; }, 0);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => { const l = Math.hypot(...a); return a.map(v => v / l); };
