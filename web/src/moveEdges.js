// Move Edge in the browser build (G or R with edges of one solid selected), as the desktop's
// W3dMoveFaces does it with picked edges: the edges and their corners move, each face at a moved
// corner keeps its plane while that still holds its corners where they now stand, otherwise it tilts
// to the plane through them, and a face that can't stay flat is refused with the reason.
//
// The browser takes solids whose faces are all flat and whose edges are all straight (blocks,
// wedges, prisms). The faces that move are remade from their corners and sewn back to the rest.

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
    for (const e of all) if (new o.BRepAdaptor_Curve(e).GetType() !== o.GeomAbs_CurveType.GeomAbs_Line) throw new Error('the browser demo moves edges of bodies with straight edges and flat faces; the desktop app moves edges on curved bodies');
    // The corners that move, by where they stand.
    const ends = e => numbered(e, 'TopAbs_VERTEX').map(v => xyz(o.BRep_Tool.Pnt(o.TopoDS.Vertex(v))));
    const moving = picked.flatMap(ends);
    const moves = p => moving.some(q => dist(p, q) <= tol);
    const l = Math.hypot(...axis) || 1, u = axis.map(x => x / l);
    const to = p => moves(p) ? add(turned(sub(p, pivot), u, angle), add(pivot, offset)) : p;

    const faces = numbered(shape, 'TopAbs_FACE').map(f => o.TopoDS.Face(f));
    const out = [];
    for (const face of faces) {
        const s = new o.BRepAdaptor_Surface(face, true);
        if (s.GetType() !== o.GeomAbs_SurfaceType.GeomAbs_Plane) throw new Error('the browser demo moves edges of bodies with flat faces only; the desktop app moves edges on curved bodies');
        const wires = numbered(face, 'TopAbs_WIRE').map(w => loopOf(w, tol));
        if (!wires.some(w => w.some(moves))) { out.push(face); continue; }
        if (wires.length > 1) throw new Error('a face beside the edges has a hole; the browser demo moves edges beside faces without holes');
        const loop = wires[0], now = loop.map(to);
        // The face keeps its plane while every corner still lies on it; else the plane through them.
        const pln = s.Plane(), n0 = xyz(pln.Axis().Direction()), p0 = xyz(pln.Location());
        const keeps = now.every(p => Math.abs(dot(sub(p, p0), n0)) <= tol);
        if (!keeps) {
            const [c, n] = fitPlane(now);
            if (now.some(p => Math.abs(dot(sub(p, c), n)) > 1e3 * tol)) throw new Error("a face beside the edges would have to bend (its corners no longer lie in one plane); move the edges across their faces");
        }
        if (now.some((p, i) => dist(p, now[(i + 1) % now.length]) <= tol)) throw new Error('that move closes up a face beside the edges');
        const wire = new o.BRepBuilderAPI_MakeWire();
        now.forEach((p, i) => wire.Add(new o.BRepBuilderAPI_MakeEdge(pnt(p), pnt(now[(i + 1) % now.length])).Edge()));
        if (!wire.IsDone()) throw new Error('a face beside the edges could not be remade');
        const mk = new o.BRepBuilderAPI_MakeFace(wire.Wire(), true);
        if (!mk.IsDone()) throw new Error('a face beside the edges could not be remade flat');
        out.push(mk.Face());
    }
    const sew = new o.BRepBuilderAPI_Sewing(10 * tol, true, true, true, false);
    for (const f of out) sew.Add(f);
    sew.Perform(new o.Message_ProgressRange());
    const shells = numbered(sew.SewedShape(), 'TopAbs_SHELL');
    if (shells.length !== 1) throw new Error('the faces no longer meet round the body; move the edges less');
    const shell = o.TopoDS.Shell(shells[0]);
    if (!o.BRep_Tool.IsClosed(shell)) throw new Error('the faces no longer close round the body; move the edges less');
    const mk = new o.BRepBuilderAPI_MakeSolid(shell);
    if (!mk.IsDone()) throw new Error('the moved faces do not make a solid');
    const solid = mk.Solid();
    o.BRepLib.OrientClosedSolid(solid);
    if (!new o.BRepCheck_Analyzer(solid, true, false, false).IsValid()) throw new Error('that move turns the body inside out or through itself; move the edges less');
    return unifyWithHistory(solid).shape;
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
