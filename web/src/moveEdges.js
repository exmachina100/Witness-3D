// Move Edge in the browser build (G or R with edges of one solid selected), as the desktop's
// W3dMoveFaces does it with picked edges: the edges and their corners move, each face at a moved
// corner keeps its plane while that still holds its corners where they now stand, otherwise it tilts
// to the plane through them, and a face that can't stay flat is refused with the reason.
//
// The browser moves straight edges whose faces round the moved corners are flat (blocks, wedges,
// prisms, and such faces on any body: a block with a round hole through it, the hole left as it is).
// The faces that move are remade from their corners, their holes kept, and sewn back to the rest.

import { bounds, numbered, numberedEdges, oc, unifyWithHistory } from './Kernel.js';

/**
 * @param shape the solid
 * @param {number[]} edgeNos its edges to move (numberedEdges order)
 * @param {{offset?: number[], pivot?: number[], axis?: number[], angle?: number}} move
 * @returns the moved solid
 */
export function moveEdges(shape, edgeNos, { offset = [0, 0, 0], pivot = [0, 0, 0], axis = [0, 0, 1], angle = 0 } = {}) {
    const o = oc();
    const box = bounds(shape), size = box.getSize(new (box.min.constructor)()).length() || 1, tol = 1e-6 * size;
    const all = numberedEdges(shape);
    const picked = edgeNos.map(n => all[n]);
    if (!picked.length || picked.some(e => !e)) throw new Error('select the edges to move again');
    const straight = e => new o.BRepAdaptor_Curve(e).GetType() === o.GeomAbs_CurveType.GeomAbs_Line;
    if (!picked.every(straight)) throw new Error('the browser demo moves straight edges; the desktop app moves curved ones');
    // The corners that move, by where they stand.
    const ends = e => numbered(e, 'TopAbs_VERTEX').map(v => xyz(o.BRep_Tool.Pnt(o.TopoDS.Vertex(v))));
    const moving = picked.flatMap(ends);
    const moves = p => moving.some(q => dist(p, q) <= tol);
    const l = Math.hypot(...axis) || 1, u = axis.map(x => x / l);
    const to = p => moves(p) ? add(turned(sub(p, pivot), u, angle), add(pivot, offset)) : p;

    const faces = numbered(shape, 'TopAbs_FACE').map(f => o.TopoDS.Face(f));
    const out = [];
    for (const face of faces) {
        if (!numbered(face, 'TopAbs_VERTEX').some(v => moves(xyz(o.BRep_Tool.Pnt(o.TopoDS.Vertex(v)))))) { out.push(face); continue; }
        const s = new o.BRepAdaptor_Surface(face, true);
        if (s.GetType() !== o.GeomAbs_SurfaceType.GeomAbs_Plane) throw new Error('a curved face beside the edges would have to change shape; the browser demo moves edges beside flat faces, the desktop app beside curved ones');
        // Each loop of the face: one with a moving corner is remade through its corners where they
        // now stand (its edges must be straight); one without stays as it is, round holes included.
        const outer = o.BRepTools.OuterWire(face);
        const loops = numbered(face, 'TopAbs_WIRE').map(w => {
            const wire = o.TopoDS.Wire(w), edges = numbered(wire, 'TopAbs_EDGE').map(e => o.TopoDS.Edge(e));
            const touched = numbered(wire, 'TopAbs_VERTEX').some(v => moves(xyz(o.BRep_Tool.Pnt(o.TopoDS.Vertex(v)))));
            if (touched && !edges.every(straight)) throw new Error('a face beside the edges has a curved edge that would have to move; the desktop app moves those');
            const now = touched ? loopOf(wire, tol).map(to) : null;
            // Where the loop stands now: its corners, or points along its edges when it stays.
            const pts = now ?? edges.flatMap(e => { const c = new o.BRepAdaptor_Curve(e); return [0, 0.25, 0.5, 0.75, 1].map(t => xyz(c.Value(c.FirstParameter() + (c.LastParameter() - c.FirstParameter()) * t))); });
            return { wire, now, pts, outer: wire.IsSame(outer) };
        });
        const pln = s.Plane(), n0 = xyz(pln.Axis().Direction()), p0 = xyz(pln.Location());
        const pts = loops.flatMap(lp => lp.pts);
        // The face keeps its plane while every corner still lies on it; else the plane through them.
        let plane = pln;
        if (!pts.every(p => Math.abs(dot(sub(p, p0), n0)) <= tol)) {
            const main = loops.find(lp => lp.outer) ?? loops[0];
            const [c, n] = fitPlane(main.pts);
            if (main.pts.some(p => Math.abs(dot(sub(p, c), n)) > 1e3 * tol)) throw new Error("a face beside the edges would have to bend (its corners no longer lie in one plane); move the edges across their faces");
            if (pts.some(p => Math.abs(dot(sub(p, c), n)) > 1e3 * tol)) throw new Error('a face beside the edges has a hole that would have to tilt with it; the desktop app moves those');
            plane = new o.gp_Pln(pnt(c), new o.gp_Dir(n[0], n[1], n[2]));
        }
        const wires = loops.map(lp => {
            if (!lp.now) return lp.wire;
            const now = lp.now;
            if (now.some((p, i) => dist(p, now[(i + 1) % now.length]) <= tol)) throw new Error('that move closes up a face beside the edges');
            const wire = new o.BRepBuilderAPI_MakeWire();
            now.forEach((p, i) => wire.Add(new o.BRepBuilderAPI_MakeEdge(pnt(p), pnt(now[(i + 1) % now.length])).Edge()));
            if (!wire.IsDone()) throw new Error('a face beside the edges could not be remade');
            return wire.Wire();
        });
        const first = loops.findIndex(lp => lp.outer);
        const order = first > 0 ? [wires[first], ...wires.filter((_, i) => i !== first)] : wires;
        const mk = new o.BRepBuilderAPI_MakeFace(plane, order[0], true);
        for (const w of order.slice(1)) mk.Add(w);
        if (!mk.IsDone()) throw new Error('a face beside the edges could not be remade flat');
        const fix = new o.ShapeFix_Face(mk.Face());
        fix.FixOrientation();
        fix.Perform();
        out.push(fix.Face());
    }
    return closeUp(out, tol);
}

/** The faces sewn back into one closed solid, checked, with faces in one plane merged. */
function closeUp(out, tol, what = 'the edges') {
    const o = oc();
    const sew = new o.BRepBuilderAPI_Sewing(10 * tol, true, true, true, false);
    for (const f of out) sew.Add(f);
    sew.Perform(new o.Message_ProgressRange());
    const shells = numbered(sew.SewedShape(), 'TopAbs_SHELL');
    if (shells.length !== 1) throw new Error(`the faces no longer meet round the body; move ${what} less`);
    const shell = o.TopoDS.Shell(shells[0]);
    if (!o.BRep_Tool.IsClosed(shell)) throw new Error(`the faces no longer close round the body; move ${what} less`);
    const mk = new o.BRepBuilderAPI_MakeSolid(shell);
    if (!mk.IsDone()) throw new Error('the moved faces do not make a solid');
    const solid = mk.Solid();
    o.BRepLib.OrientClosedSolid(solid);
    if (!new o.BRepCheck_Analyzer(solid, true, false, false).IsValid()) throw new Error(`that move turns the body inside out or through itself; move ${what} less`);
    return unifyWithHistory(solid).shape;
}

/**
 * Move Face on a body with flat faces and straight edges (the browser's Move Face for several
 * faces, or turned ones): each selected face's plane is carried by the move, the other faces keep
 * theirs, and every corner goes where the planes of its faces now meet, so the faces round the
 * moved ones stretch or shrink to them as on the desktop (a face moved along itself looks the same).
 * Holes in the faces are corners like any other.
 */
export function moveFlatFaces(shape, faceNos, { offset = [0, 0, 0], pivot = [0, 0, 0], axis = [0, 0, 1], angle = 0 } = {}) {
    const o = oc();
    const box = bounds(shape), size = box.getSize(new (box.min.constructor)()).length() || 1, tol = 1e-6 * size;
    const faces = numbered(shape, 'TopAbs_FACE').map(f => o.TopoDS.Face(f));
    if (!faceNos.length || faceNos.some(n => !faces[n])) throw new Error('select the faces to move again');
    for (const e of numberedEdges(shape)) if (new o.BRepAdaptor_Curve(e).GetType() !== o.GeomAbs_CurveType.GeomAbs_Line) throw new Error('the browser demo moves these faces on bodies with flat faces and straight edges; the desktop app moves faces on any body');
    const l = Math.hypot(...axis) || 1, u = axis.map(x => x / l);
    const carry = p => add(turned(sub(p, pivot), u, angle), add(pivot, offset));
    // Each face's plane n·x = d, carried for the selected faces.
    const planes = faces.map((f, i) => {
        const s = new o.BRepAdaptor_Surface(f, true);
        if (s.GetType() !== o.GeomAbs_SurfaceType.GeomAbs_Plane) throw new Error('the browser demo moves these faces on bodies with flat faces only; the desktop app moves faces on any body');
        const pl = s.Plane();
        let n = xyz(pl.Axis().Direction()), p = xyz(pl.Location());
        if (faceNos.includes(i)) { n = turned(n, u, angle); p = carry(p); }
        return { n, d: dot(n, p) };
    });
    // Corners, and the faces each lies on.
    const corners = [];
    faces.forEach((f, i) => {
        for (const v of numbered(f, 'TopAbs_VERTEX')) {
            const p = xyz(o.BRep_Tool.Pnt(o.TopoDS.Vertex(v)));
            let c = corners.find(c => dist(c.p, p) <= 10 * tol);
            if (!c) corners.push(c = { p, faces: new Set() });
            c.faces.add(i);
        }
    });
    for (const c of corners) {
        if (![...c.faces].some(i => faceNos.includes(i))) { c.now = c.p; continue; }
        // Least squares over the corner's planes; three that don't pin a point can't place it.
        const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
        for (const i of c.faces) { const { n, d } = planes[i]; for (let r = 0; r < 3; r++) { b[r] += n[r] * d; for (let k = 0; k < 3; k++) A[r][k] += n[r] * n[k]; } }
        const det = A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
        if (Math.abs(det) < 1e-9) throw new Error('a corner of the moved faces has no faces across it to stop at (the faces round it run parallel to the move)');
        const col = (k, v) => A.map((row, r) => row.map((x, j) => j === k ? v[r] : x));
        const d3 = M => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
        c.now = [0, 1, 2].map(k => d3(col(k, b)) / det);
        if ([...c.faces].some(i => Math.abs(dot(planes[i].n, c.now) - planes[i].d) > 1e3 * tol)) throw new Error('the faces at a corner no longer meet in one point; the desktop app moves those');
    }
    const to = p => corners.find(c => dist(c.p, p) <= 10 * tol).now;
    if (corners.every(c => dist(c.p, c.now) <= tol)) return null;
    const out = faces.map((face, i) => {
        if (!numbered(face, 'TopAbs_VERTEX').some(v => { const p = xyz(o.BRep_Tool.Pnt(o.TopoDS.Vertex(v))); return dist(p, to(p)) > tol; })) return face;
        const outer = o.BRepTools.OuterWire(face);
        const wires = numbered(face, 'TopAbs_WIRE').map(w => {
            const wire = o.TopoDS.Wire(w), now = loopOf(wire, tol).map(to);
            if (now.some((p, j) => dist(p, now[(j + 1) % now.length]) <= tol)) throw new Error('that move closes up a face beside the moved ones');
            const mw = new o.BRepBuilderAPI_MakeWire();
            now.forEach((p, j) => mw.Add(new o.BRepBuilderAPI_MakeEdge(pnt(p), pnt(now[(j + 1) % now.length])).Edge()));
            if (!mw.IsDone()) throw new Error('a face could not be remade');
            return { wire: mw.Wire(), outer: wire.IsSame(outer) };
        }).sort((x, y) => y.outer - x.outer);
        const { n, d } = planes[i];
        const plane = new o.gp_Pln(pnt(n.map(x => x * d)), new o.gp_Dir(n[0], n[1], n[2]));
        const mk = new o.BRepBuilderAPI_MakeFace(plane, wires[0].wire, true);
        for (const w of wires.slice(1)) mk.Add(w.wire);
        if (!mk.IsDone()) throw new Error('a face could not be remade flat');
        const fix = new o.ShapeFix_Face(mk.Face());
        fix.FixOrientation();
        fix.Perform();
        return fix.Face();
    });
    return closeUp(out, tol, 'the faces');
}

/** A wire's corners in order round it, from its straight edges. */
function loopOf(wire, tol) {
    const o = oc();
    const segs = numbered(wire, 'TopAbs_EDGE').map(e => numbered(e, 'TopAbs_VERTEX').map(v => xyz(o.BRep_Tool.Pnt(o.TopoDS.Vertex(v)))));
    if (segs.some(s => s.length !== 2)) throw new Error('a face beside the edges has a closed edge; the desktop app moves those');
    const loop = [segs[0][0], segs[0][1]];
    const left = segs.slice(1);
    while (left.length) {
        const end = loop.at(-1);
        const i = left.findIndex(s => dist(s[0], end) <= 10 * tol || dist(s[1], end) <= 10 * tol);
        if (i < 0) throw new Error("a face's edges do not run end to end");
        const [s] = left.splice(i, 1);
        loop.push(dist(s[0], end) <= 10 * tol ? s[1] : s[0]);
    }
    if (dist(loop[0], loop.at(-1)) <= 10 * tol) loop.pop();
    return loop;
}

/** The centre and unit normal (Newell's) of a loop of points. */
function fitPlane(pts) {
    const n = [0, 0, 0];
    pts.forEach((p, i) => {
        const q = pts[(i + 1) % pts.length];
        n[0] += (p[1] - q[1]) * (p[2] + q[2]); n[1] += (p[2] - q[2]) * (p[0] + q[0]); n[2] += (p[0] - q[0]) * (p[1] + q[1]);
    });
    const l = Math.hypot(...n) || 1, c = pts.reduce((a, p) => add(a, p), [0, 0, 0]).map(x => x / pts.length);
    return [c, n.map(x => x / l)];
}

/** p turned by `angle` about the unit axis u through the origin (Rodrigues). */
function turned(p, u, angle) {
    const c = Math.cos(angle), s = Math.sin(angle), d = dot(u, p), x = cross(u, p);
    return [0, 1, 2].map(k => p[k] * c + x[k] * s + u[k] * d * (1 - c));
}

const pnt = p => new (oc().gp_Pnt)(p[0], p[1], p[2]);
const xyz = p => [p.X(), p.Y(), p.Z()];
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
