// Plasticity's Offset Edge on curved faces and across several faces in the browser build, as
// w3d_offset_edge_faces and w3d_edge_tube do it on the desktop. The faces either side of the picked
// edges fall into two sides of the run; the offset is where a tube of radius d round the edges (a
// ball where two picked edges meet, straight on past the ends of a run) meets the faces of one
// side, imprinted there. It keeps d from the edges in space and joins round at corners.

import { imprintWithHistory, numbered, numberedEdges, oc } from './Kernel.js';

/** The faces of `shape` either side of `edges`, those on `side` (0 or 1, 2 for both). */
export function offsetEdgeFaces(shape, edges, side) {
    if (!edges?.length) throw new Error('select the edges to offset');
    const all = numberedEdges(shape), faces = numbered(shape, 'TopAbs_FACE');
    for (const e of edges) if (!all[e]) throw new Error('that edge no longer exists');
    const edgesOf = faces.map(f => numberedEdges(f).map(e => all.findIndex(g => g.IsSame(e))).filter(e => e >= 0));
    const facesOf = e => faces.map((_, f) => f).filter(f => edgesOf[f].includes(e));
    const picked = new Set(edges), touched = new Set();
    for (const e of picked) {
        const fs = facesOf(e);
        if (fs.length !== 2) throw new Error('offset edges between two faces of a solid');
        fs.forEach(f => touched.add(f));
    }
    const colour = new Map(), todo = [facesOf(edges[0])[0]];
    colour.set(todo[0], 0);
    while (todo.length) {
        const f = todo.pop();
        for (const e of edgesOf[f]) for (const g of facesOf(e)) {
            if (g === f || !touched.has(g)) continue;
            const want = picked.has(e) ? 1 - colour.get(f) : colour.get(f);
            if (!colour.has(g)) { colour.set(g, want); todo.push(g); }
            else if (colour.get(g) !== want) throw new Error("those edges don't run along one side of the faces; offset them in parts");
        }
    }
    for (const f of touched) if (!colour.has(f)) throw new Error("those edges don't join up; offset each run on its own");
    const out = [...colour].filter(([, c]) => side === 2 || c === side).map(([f]) => f).sort((a, b) => a - b);
    if (!out.length) throw new Error('no faces on that side');
    return out;
}

/** The tube of radius `d` round `edges` of `shape`. */
export function edgeTube(shape, edges, d) {
    const o = oc();
    if (!edges?.length) throw new Error('select the edges to offset');
    if (!(d > 1e-6)) throw new Error('the distance must be greater than zero');
    const all = numberedEdges(shape);
    const box = new o.Bnd_Box();
    o.BRepBndLib.Add(shape, box, false);
    const far = Math.sqrt(box.SquareExtent()) * 1.5;
    const ends = e => numbered(all[e], 'TopAbs_VERTEX');
    const parts = [];
    for (const e of new Set(edges)) {
        const edge = all[e];
        if (!edge) throw new Error('that edge no longer exists');
        const c = new o.BRepAdaptor_Curve(edge), t0 = c.FirstParameter(), t1 = c.LastParameter();
        const p = new o.gp_Pnt(), t = new o.gp_Vec();
        c.D1(t0, p, t);
        if (t.Magnitude() < 1e-12) throw new Error('an edge has no direction at its start');
        const ring = new o.BRepBuilderAPI_MakeWire(new o.BRepBuilderAPI_MakeEdge(new o.gp_Circ(new o.gp_Ax2(p, new o.gp_Dir(t)), d)).Edge()).Wire();
        const pipe = new o.BRepOffsetAPI_MakePipeShell(new o.BRepBuilderAPI_MakeWire(edge).Wire());
        pipe.Add(ring, false, false);
        pipe.Build(new o.Message_ProgressRange());
        if (!pipe.IsDone() || !pipe.MakeSolid()) throw new Error('the edge bends tighter than that distance; use a smaller one');
        parts.push(pipe.Shape());
        // A closed edge runs on into itself.
        if (ends(e).length < 2) continue;
        for (const end of [0, 1]) {
            const q = new o.gp_Pnt(), dir = new o.gp_Vec();
            c.D1(end ? t1 : t0, q, dir);
            const v = ends(e).find(v => o.BRep_Tool.Pnt(o.TopoDS.Vertex(v)).Distance(q) < 1e-6);
            const meeting = v && edges.some(g => g !== e && ends(g).some(w => w.IsSame(v)));
            if (meeting) { parts.push(new o.BRepPrimAPI_MakeSphere(q, d).Shape()); continue; }
            if (!end) dir.Reverse();
            if (dir.Magnitude() < 1e-12) continue;
            parts.push(new o.BRepPrimAPI_MakeCylinder(new o.gp_Ax2(q, new o.gp_Dir(dir)), d, far).Shape());
        }
    }
    return parts.reduce((a, b) => {
        const f = new o.BRepAlgoAPI_Fuse(a, b, new o.Message_ProgressRange());
        if (!f.IsDone() || f.HasErrors()) throw new Error('the offsets round the edges could not be joined');
        return f.Shape();
    });
}

/**
 * Offset Edge on any faces: `edges` of `shape` moved `d` across the faces on `side` (0 or 1, 2 for
 * both) and imprinted there; with `away` (a face number), the side without that face.
 */
export function offsetEdges(shape, edges, d, side = 0, away = null) {
    let faces = offsetEdgeFaces(shape, edges, away === null ? side : 0);
    if (away !== null && faces.includes(away)) faces = offsetEdgeFaces(shape, edges, 1);
    return imprintWithHistory(shape, faces, [edgeTube(shape, edges, d)]);
}
