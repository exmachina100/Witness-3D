// Plasticity's Offset Edge and Offset Face Loop on flat faces: a solid's edges, as drawn by either
// backend (one polyline of model points per B-rep edge), turned into exact lines and arcs in the
// face's plane, offset there with Offset Curve's corner styles, and handed to Imprint, which splits
// the face along them. Shared by the browser and desktop builds.

import { circleThrough } from './curves.js';
import { extendCurve, offsetCurve } from './curveEdit.js';

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit3 = a => { const l = Math.hypot(...a); return a.map(v => v / l); };
const near2 = (a, b, tol) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;

/** A frame for a flat face ({ origin, normal }): an x across it, and the plane coordinates of model points. */
export function faceFrame(plane) {
    const n = unit3(plane.normal);
    const ref = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
    const x = unit3(cross3(ref, n)), y = cross3(n, x);
    const local = p => { const d = sub3(p, plane.origin); return [dot3(d, x), dot3(d, y)]; };
    return { origin: [...plane.origin], x, normal: n, local };
}

/** An edge's points (flat x, y, z, ...) as plane coordinates. */
const edgePoints = (flat, local) => Array.from({ length: flat.length / 3 }, (_, i) => local([flat[3 * i], flat[3 * i + 1], flat[3 * i + 2]]));

/**
 * One edge as a contour piece: a line when its points are in a row, an arc when they lie on a
 * circle (to `tol`), otherwise a spline through them; a closed edge on a circle is a circle.
 */
export function edgePiece(pts, tol = 1e-4) {
    const a = pts[0], b = pts.at(-1), closed = pts.length > 3 && near2(a, b, tol);
    const lineOff = p => { const d = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(...d); return l ? Math.abs((p[0] - a[0]) * d[1] - (p[1] - a[1]) * d[0]) / l : Math.hypot(p[0] - a[0], p[1] - a[1]); };
    if (!closed && pts.every(p => lineOff(p) <= tol)) return { kind: 'polyline', points: [a, b], closed: false };
    const m = pts[Math.floor(pts.length / 2)], q = pts[Math.floor(pts.length / 4)];
    const circ = closed ? circleThrough(a, q, m) : circleThrough(a, m, b);
    if (circ && pts.every(p => Math.abs(Math.hypot(p[0] - circ.center[0], p[1] - circ.center[1]) - circ.radius) <= tol * Math.max(1, circ.radius / 10))) {
        return closed ? { kind: 'circle', center: circ.center, radius: circ.radius } : { kind: 'arc', start: a, mid: m, end: b };
    }
    return { kind: 'spline', points: closed ? pts.slice(0, -1) : pts, closed };
}

const pieceEnds = p => p.kind === 'arc' ? [p.start, p.end] : [p.points[0], p.points.at(-1)];
const flip = p => p.kind === 'arc' ? { ...p, start: p.end, end: p.start } : { ...p, points: [...p.points].reverse() };

/** Pieces joined end to end into runs: { pieces, closed }. Circles and closed splines stand alone. */
export function chainPieces(pieces, tol = 1e-3) {
    const left = [...pieces], out = [];
    while (left.length) {
        const first = left.shift();
        if (first.kind === 'circle' || first.closed) { out.push({ pieces: [first], closed: true }); continue; }
        const run = [first];
        for (let grew = true; grew;) {
            grew = false;
            for (let i = 0; i < left.length; i++) {
                const p = left[i];
                if (p.kind === 'circle' || p.closed) continue;
                const [s, e] = pieceEnds(p), head = pieceEnds(run[0])[0], tail = pieceEnds(run.at(-1))[1];
                let add = null, front = false;
                if (near2(tail, s, tol)) add = p;
                else if (near2(tail, e, tol)) add = flip(p);
                else if (near2(head, e, tol)) { add = p; front = true; }
                else if (near2(head, s, tol)) { add = flip(p); front = true; }
                if (!add) continue;
                front ? run.unshift(add) : run.push(add);
                left.splice(i, 1);
                grew = true;
                break;
            }
        }
        out.push({ pieces: run, closed: run.length > 1 && near2(pieceEnds(run[0])[0], pieceEnds(run.at(-1))[1], tol) });
    }
    return out;
}

/** A run of pieces as one curve in `frame`. */
function runCurve(frame, { pieces, closed }) {
    const f = { origin: frame.origin, x: frame.x, normal: frame.normal };
    if (pieces.length === 1 && (pieces[0].kind === 'circle' || pieces[0].closed)) return { ...f, ...pieces[0] };
    if (pieces.every(p => p.kind === 'polyline')) {
        const points = [pieces[0].points[0], ...pieces.map(p => p.points.at(-1))];
        if (closed) points.pop();
        return { ...f, kind: 'polyline', points, closed };
    }
    if (pieces.length === 1 && pieces[0].kind === 'arc') return { ...f, ...pieces[0] };
    return { ...f, kind: 'contour', pieces: pieces.map(p => p.kind === 'spline' ? { ...p, closed: false } : p) };
}

/** Twice the signed area enclosed by a run, from its pieces' points. */
function area2(points) {
    let s = 0;
    for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; s += a[0] * b[1] - a[1] * b[0]; }
    return s;
}
const runPoints = ({ pieces }) => pieces.flatMap(p => p.kind === 'arc' ? [p.start, p.mid] : p.kind === 'circle' ? Array.from({ length: 16 }, (_, i) => [p.center[0] + p.radius * Math.cos(i * Math.PI / 8), p.center[1] + p.radius * Math.sin(i * Math.PI / 8)]) : p.points.slice(0, -1).concat(p.closed ? [p.points.at(-1)] : []));

/** Whether plane point `q` is inside the closed point loop. */
function inside(loop, q) {
    let hit = false;
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
        const a = loop[i], b = loop[j];
        if ((a[1] > q[1]) !== (b[1] > q[1]) && q[0] < (b[0] - a[0]) * (q[1] - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
    }
    return hit;
}

/** The loops round a flat face, in its frame: the outer one first, then its holes. */
export function faceLoops(body, face, edgeIds) {
    const plane = body.facePlanes[face];
    if (!plane) throw new Error('Offset Face Loop works on flat faces');
    const frame = faceFrame(plane);
    const runs = chainPieces(edgeIds.map(n => edgePiece(edgePoints(body.edges[n], frame.local))));
    const loops = runs.filter(r => r.closed).map(r => ({ run: r, pts: runPoints(r) }));
    if (!loops.length) throw new Error("that face's edges do not close into a loop");
    loops.sort((a, b) => Math.abs(area2(b.pts)) - Math.abs(area2(a.pts)));
    return { frame, loops };
}

/**
 * Plasticity's Offset Face Loop: the edges round a flat face moved `d` into it (outer edges in,
 * holes out), as curves in the face's plane. `edgeIds` are the face's edges.
 */
export function faceLoopOffsets(body, face, edgeIds, d, corner = 'linear') {
    if (!(Number.isFinite(d) && Math.abs(d) > 1e-9)) throw new Error('the distance must not be zero');
    const { frame, loops } = faceLoops(body, face, edgeIds);
    return loops.map((l, i) => offsetCurve(runCurve(frame, l.run), i === 0 ? -d : d, corner));
}

/**
 * Plasticity's Offset Edge on one flat face: the picked edges of that face (joined where they meet)
 * moved `d` across it, into the face, and carried on straight past their ends so they split the
 * face from side to side. `faceEdgeIds` are all the face's edges, to tell which side is inside.
 */
export function edgeOffsetsOnFace(body, face, faceEdgeIds, picked, d, corner = 'linear') {
    if (!(Number.isFinite(d) && d > 1e-9)) throw new Error('the distance must be greater than zero');
    const { frame, loops } = faceLoops(body, face, faceEdgeIds);
    const outer = loops[0].pts, holes = loops.slice(1).map(l => l.pts);
    const inFace = q => inside(outer, q) && !holes.some(h => inside(h, q));
    // Far enough to cross the face from any point on it, and no further.
    const size = Math.max(...outer.map(p => Math.hypot(p[0] - outer[0][0], p[1] - outer[0][1]))) + 1;
    return chainPieces(picked.map(n => edgePiece(edgePoints(body.edges[n], frame.local)))).map(run => {
        const c = runCurve(frame, run);
        if (run.closed) {
            // A whole loop: in towards the face, as Offset Face Loop does.
            const isOuter = Math.abs(Math.abs(area2(runPoints(run))) - Math.abs(area2(outer))) < 1e-6 * Math.abs(area2(outer));
            return offsetCurve(c, isOuter ? -d : d, corner);
        }
        // Which side the face is on: try both and keep the one whose middle lands inside it.
        const sides = [d, -d].map(s => { try { return offsetCurve(c, s, corner); } catch { return null; } }).filter(Boolean);
        const mid = o => { const p = o.kind === 'polyline' ? o.points : o.kind === 'arc' ? [o.mid] : o.kind === 'contour' ? (o.pieces[0].kind === 'arc' ? [o.pieces[0].mid] : o.pieces[0].points) : o.points; const a = p[0], b = p[Math.min(1, p.length - 1)]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
        const into = sides.find(o => inFace(mid(o)));
        if (!into) throw new Error('the offset would leave the face; use a smaller distance');
        return extendCurve(extendCurve(into, 0, size, 'linear'), 1, size, 'linear');
    });
}
