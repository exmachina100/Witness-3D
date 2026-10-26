// Patch's Trim methods (Plasticity's Patch › Method), in the browser build; the desktop has
// w3d_patch_trim. A target sheet is cut by a fence standing on the picked edges of the base sheet,
// square to the target: Trim to hole keeps the target's piece inside the hole's loop, Trim to sheet
// the piece that does not lie over the base sheet (trimmed where the base sheet ends).

import { bounds, numbered, oc } from './Kernel.js';

const v = p => [p.X(), p.Y(), p.Z()];
const sub = (a, b) => a.map((x, k) => x - b[k]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => { const l = Math.hypot(...a); return a.map(x => x / l); };

/** A point lying on the face: its centre of mass pulled onto it, else its UV middle. */
function onFace(face) {
    const o = oc(), props = new o.GProp_GProps();
    o.BRepGProp.SurfaceProperties(face, props, false, false);
    const pr = new o.GeomAPI_ProjectPointOnSurf(props.CentreOfMass(), o.BRep_Tool.Surface(face), o.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad);
    if (pr.NbPoints()) {
        const p = pr.NearestPoint();
        const d = new o.BRepExtrema_DistShapeShape(new o.BRepBuilderAPI_MakeVertex(p).Shape(), face);
        if (d.IsDone() && d.Value() < 1e-7) return v(p);
    }
    // A ring's centre is in its hole: walk in from a point of its outer wire instead.
    const s = new o.BRepAdaptor_Surface(face, true);
    const { UMin, UMax, VMin, VMax } = o.BRepTools.UVBounds(face, 0, 0, 0, 0);
    for (let i = 1; i < 16; i++) for (let j = 1; j < 16; j++) {
        const p = s.Value(UMin + (UMax - UMin) * i / 16, VMin + (VMax - VMin) * j / 16);
        const d = new o.BRepExtrema_DistShapeShape(new o.BRepBuilderAPI_MakeVertex(p).Shape(), face);
        if (d.IsDone() && d.Value() < 1e-7) return v(p);
    }
    return v(s.Value((UMin + UMax) / 2, (VMin + VMax) / 2));
}

/** The target's normal at the point of it nearest `p`. */
function normalNear(target, p) {
    const o = oc();
    const d = new o.BRepExtrema_DistShapeShape(new o.BRepBuilderAPI_MakeVertex(new o.gp_Pnt(...p)).Vertex(), target);
    if (!d.IsDone() || d.NbSolution() < 1) throw new Error('the target sheet could not be reached');
    const face = o.TopoDS.Face(d.SupportOnShape2(1));
    const q = d.PointOnShape2(1);
    const pr = new o.GeomAPI_ProjectPointOnSurf(q, o.BRep_Tool.Surface(face), o.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad);
    const { u, v: w } = pr.NbPoints() ? (() => { const r = { u: 0, v: 0 }; const U = { current: 0 }, V = { current: 0 }; pr.LowerDistanceParameters(U, V); r.u = U.current; r.v = V.current; return r; })() : { u: 0, v: 0 };
    const s = new o.BRepAdaptor_Surface(face, true), P = new o.gp_Pnt(), du = new o.gp_Vec(), dv = new o.gp_Vec();
    s.D1(u, w, P, du, dv);
    const n = du.Crossed(dv);
    if (n.Magnitude() < 1e-12) throw new Error('the target sheet is degenerate there');
    return unit([n.X(), n.Y(), n.Z()]);
}

/**
 * The target sheet trimmed by the picked edges of the base: `edges` are TopoDS edges (a closed
 * loop for 'hole', any run for 'sheet'), `base` the sheet they belong to. Returns the trimmed sheet.
 */
export function patchTrim(target, base, edges, method = 'hole') {
    const o = oc();
    if (!edges.length) throw new Error('select the edges of the base sheet to trim to');
    // The edges' points, their middle, and the target's normal near it: the fence's direction.
    const pts = [];
    for (const e of edges) {
        const c = new o.BRepAdaptor_Curve(e), a = c.FirstParameter(), b = c.LastParameter();
        for (let i = 0; i <= 16; i++) pts.push(v(c.Value(a + (b - a) * i / 16)));
    }
    const mid = pts.reduce((s, p) => s.map((x, k) => x + p[k] / pts.length), [0, 0, 0]);
    const d = normalNear(target, mid);
    const box = bounds(target), size = 2 * (box.getSize(new (box.min.constructor)()).length() + Math.max(...pts.map(p => Math.hypot(...sub(p, mid))))) || 1;
    const fence = new o.TopoDS_Builder(), all = new o.TopoDS_Compound();
    fence.MakeCompound(all);
    for (const e of edges) {
        const back = new o.gp_Trsf();
        back.SetTranslation(new o.gp_Vec(...d.map(x => -x * size)));
        const moved = new o.BRepBuilderAPI_Transform(e, back, true).Shape();
        fence.Add(all, new o.BRepPrimAPI_MakePrism(moved, new o.gp_Vec(...d.map(x => 2 * x * size)), false, true).Shape());
    }
    const args = new o.NCollection_List_TopoDS_Shape(), tools = new o.NCollection_List_TopoDS_Shape();
    args.Append(target);
    tools.Append(all);
    const mk = new o.BRepAlgoAPI_Splitter();
    mk.SetArguments(args);
    mk.SetTools(tools);
    mk.Build(new o.Message_ProgressRange());
    if (!mk.IsDone() || mk.HasErrors()) throw new Error('the target sheet could not be cut there');
    const pieces = numbered(mk.Shape(), 'TopAbs_FACE').map(f => o.TopoDS.Face(f));
    if (pieces.length <= numbered(target, 'TopAbs_FACE').length) throw new Error('the picked edges do not reach across the target sheet');
    // Seen along the fence: the loop as a polygon, and whether a line through a point meets the base.
    const x = unit(cross(d, Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])), y = cross(d, x);
    const flat = p => [dot(sub(p, mid), x), dot(sub(p, mid), y)];
    const ring = orderLoop(edges).map(flat);
    const inside = p => {
        const [px, py] = flat(p);
        let inn = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [xi, yi] = ring[i], [xj, yj] = ring[j];
            if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inn = !inn;
        }
        return inn;
    };
    const overBase = p => {
        const a = new o.gp_Pnt(...p.map((c, k) => c - d[k] * size)), b = new o.gp_Pnt(...p.map((c, k) => c + d[k] * size));
        const line = new o.BRepBuilderAPI_MakeEdge(a, b).Edge();
        const dist = new o.BRepExtrema_DistShapeShape(line, base);
        return dist.IsDone() && dist.Value() < 1e-6 * size;
    };
    const keep = pieces.filter(f => { const c = onFace(f); return method === 'hole' ? inside(c) : !overBase(c); });
    if (!keep.length || keep.length === pieces.length) throw new Error(method === 'hole' ? 'the target sheet does not cover the hole' : 'the target sheet does not run past the base sheet');
    const sew = new o.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);
    for (const f of keep) sew.Add(f);
    sew.Perform(new o.Message_ProgressRange());
    return sew.SewedShape();
}

/** The edges' points in order round the loop (or along the run), each edge turned to follow on. */
function orderLoop(edges) {
    const o = oc();
    const runs = edges.map(e => { const c = new o.BRepAdaptor_Curve(e), a = c.FirstParameter(), b = c.LastParameter(); return Array.from({ length: 17 }, (_, i) => v(c.Value(a + (b - a) * i / 16))); });
    const out = [...runs.shift()];
    const close = (p, q) => Math.hypot(...sub(p, q)) < 1e-4 * (1 + Math.hypot(...p));
    while (runs.length) {
        const end = out[out.length - 1];
        let i = runs.findIndex(r => close(r[0], end) || close(r[r.length - 1], end));
        if (i < 0) i = 0;
        const r = runs.splice(i, 1)[0];
        out.push(...(close(r[r.length - 1], end) ? [...r].reverse() : r));
    }
    return out;
}
