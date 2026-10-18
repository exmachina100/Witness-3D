// Plasticity's fillet Shape in the browser build. Chordal, as blend::blend does it on the desktop:
// the distance is the width across the round (its chord), so each edge's radius is the distance
// over 2 sin(θ/2), θ the angle between its faces' normals; edges at different angles keep their own
// radius as variable points. Conic and G2 need the desktop kernel (w3d_reshape_fillets).

import { numbered, numberedEdges, oc } from './Kernel.js';

/** The angle (radians) between the outward normals of the two faces at the middle of edge `index`, or -1. */
export function edgeTurn(shape, index) {
    const o = oc();
    const edge = numberedEdges(shape)[index];
    if (!edge) throw new Error('an edge in the selection is not on this body; select the edges again');
    const faces = numbered(shape, 'TopAbs_FACE').map(f => o.TopoDS.Face(f)).filter(f => numberedEdges(f).some(e => e.IsSame(edge)));
    if (faces.length !== 2) return -1;
    const c = new o.BRepAdaptor_Curve(edge), t = (c.FirstParameter() + c.LastParameter()) / 2;
    const [a, b] = faces.map(f => {
        const uv = new o.BRepAdaptor_Curve2d(edge, f).Value(t);
        const s = new o.BRepAdaptor_Surface(f, true), p = new o.gp_Pnt(), du = new o.gp_Vec(), dv = new o.gp_Vec();
        s.D1(uv.X(), uv.Y(), p, du, dv);
        const n = du.Crossed(dv);
        if (f.Orientation() === o.TopAbs_Orientation.TopAbs_REVERSED) n.Reverse();
        return n;
    });
    return a.Angle(b);
}

/** A chordal round's radius and, where the edges' angles differ, the variable points that hold each edge's own. */
export function chordal(shape, edges, size) {
    const o = oc();
    const radii = edges.map(e => {
        const turn = edgeTurn(shape, e);
        if (!(turn > 1e-6)) throw new Error('a chordal round needs faces that meet at an angle');
        return size / (2 * Math.sin(turn / 2));
    });
    const r = radii[0];
    if (radii.every(x => Math.abs(x - r) <= 1e-9 * r)) return { size: r, variable: [] };
    const all = numberedEdges(shape), variable = [];
    edges.forEach((e, i) => {
        const c = new o.BRepAdaptor_Curve(all[e]), t0 = c.FirstParameter(), t1 = c.LastParameter();
        for (const t of [t0, (t0 + t1) / 2, t1]) {
            const p = c.Value(t);
            variable.push({ edge: e, point: [p.X(), p.Y(), p.Z()], scale: radii[i] / r });
        }
    });
    return { size: r, variable };
}

/** The direction of the picked edges at `p` (along the nearest piece of each edge sampled), or null off them. */
function along(shape, edges, p) {
    const o = oc(), all = numberedEdges(shape);
    let best = Infinity, dir = null;
    for (const e of edges) {
        const c = new o.BRepAdaptor_Curve(all[e]), t0 = c.FirstParameter(), t1 = c.LastParameter(), n = 256;
        let prev = null;
        for (let i = 0; i <= n; i++) {
            const q = c.Value(t0 + (t1 - t0) * i / n), cur = [q.X(), q.Y(), q.Z()];
            if (prev) {
                const d = cur.map((v, k) => v - prev[k]), dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
                if (dd > 1e-24) {
                    const s = Math.min(1, Math.max(0, ((p[0] - prev[0]) * d[0] + (p[1] - prev[1]) * d[1] + (p[2] - prev[2]) * d[2]) / dd));
                    const gap = Math.hypot(...prev.map((v, k) => v + d[k] * s - p[k]));
                    if (gap < best) { best = gap; dir = d.map(v => v / Math.sqrt(dd)); }
                }
            }
            prev = cur;
        }
    }
    return best <= 1e-3 ? dir : null;
}

/**
 * Plasticity's limit points (L), as blend::limited on the desktop: `rounded` (`shape` with the
 * round) kept only between the planes square to the edges through the two `limits`, the round
 * ending flat there. Returns the result of `shape` minus what the round took off between them.
 */
export function limitRound(shape, rounded, edges, limits, booleanWithHistory) {
    const o = oc();
    if (limits.length !== 2) throw new Error('place two limit points, one at each end of the stretch to round');
    const [a, b] = limits;
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-6) throw new Error('the limit points are on top of each other');
    const ta = along(shape, edges, a), tb = along(shape, edges, b);
    if (!ta || !tb) throw new Error('a limit point is not on an edge being rounded');
    const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const ab = b.map((v, k) => v - a[k]);
    const na = dot(ta, ab) >= 0 ? ta : ta.map(v => -v), nb = dot(tb, ab) <= 0 ? tb : tb.map(v => -v);
    const step = (Op, x, y) => {
        const r = new Op(x, y, new o.Message_ProgressRange());
        if (!r.IsDone() || r.HasErrors()) throw new Error('the round could not be cut at a limit point');
        return r.Shape();
    };
    let piece = step(o.BRepAlgoAPI_Cut, shape, rounded);
    const box = new o.Bnd_Box();
    o.BRepBndLib.Add(shape, box, false);
    const size = Math.sqrt(box.SquareExtent()) * 4;
    for (const [p, n] of [[a, na], [b, nb]]) {
        const face = new o.BRepBuilderAPI_MakeFace(new o.gp_Pln(new o.gp_Pnt(...p), new o.gp_Dir(...n)), -size, size, -size, size).Face();
        const half = new o.BRepPrimAPI_MakeHalfSpace(face, new o.gp_Pnt(...p.map((v, k) => v + n[k] * size / 2))).Solid();
        piece = step(o.BRepAlgoAPI_Common, piece, half);
    }
    if (!numbered(piece, 'TopAbs_SOLID').length) throw new Error('the limit points leave nothing of the round');
    return booleanWithHistory(shape, piece, 'difference');
}
