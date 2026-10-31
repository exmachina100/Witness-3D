// Plasticity's Isoparam in the browser build, as w3d_isoparam_split does it on the desktop: a face
// split by edges along which one surface parameter stays put (v when `alongU`, so the edges run
// along u), at `params` from 0 to 1 across the face or, with none, through `point`. With
// `subdivide` each piece also gets its own part of the face's control surface, cut where the edges
// are, so the pieces' control points meet row for row along them.

import { numbered, oc, successors, trace } from './Kernel.js';
import { controlSurface } from './facePoles.js';
import { assemble, remade } from './rebuildFace.js';

/** Where the cuts fall in the face's own parameter (sorted), from `params` or `point`. */
function cutsOf(o, f, surface, alongU, point, params) {
    const { UMin, UMax, VMin, VMax } = o.BRepTools.UVBounds(f, 0, 0, 0, 0);
    const [c0, c1] = alongU ? [VMin, VMax] : [UMin, UMax];
    if (!(c1 - c0 > 1e-9)) throw new Error('the face is too thin that way for an isoparam');
    let at;
    if (!params?.length) {
        const pr = new o.GeomAPI_ProjectPointOnSurf(new o.gp_Pnt(...point), surface, o.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad);
        if (!pr.NbPoints()) throw new Error('that point is not on the face');
        const { U, V } = pr.LowerDistanceParameters(0, 0);
        at = [alongU ? V : U];
    } else {
        if (!params.every(t => t > 0 && t < 1)) throw new Error('each isoparam must lie inside the face, between 0 and 1');
        at = params.map(t => c0 + t * (c1 - c0));
    }
    at.sort((a, b) => a - b);
    const near = 1e-6 * Math.max(1, Math.abs(c1 - c0));
    if (at.some(c => c <= c0 + near || c >= c1 - near)) throw new Error("that isoparam runs along the face's edge; move it inside");
    return { at, bounds: [UMin, UMax, VMin, VMax] };
}

/** `shape` with face `face` split along isoparams: { shape, history } as the other edits give. */
export function isoparamSplit(shape, face, alongU, point, params = [], subdivide = false) {
    const o = oc();
    const faces = numbered(shape, 'TopAbs_FACE');
    if (!(face >= 0 && face < faces.length)) throw new Error('that face no longer exists');
    const f = o.TopoDS.Face(faces[face]);
    const surface = o.BRep_Tool.Surface(f);
    const { at, bounds: [u0, u1, v0, v1] } = cutsOf(o, f, surface, alongU, point, params);
    const fwd = o.TopoDS.Face(f.Oriented(o.TopAbs_Orientation.TopAbs_FORWARD));
    const tools = new o.NCollection_List_TopoDS_Shape();
    for (const c of at) {
        const iso = alongU ? surface.VIso(c) : surface.UIso(c);
        let a = alongU ? u0 : v0, b = alongU ? u1 : v1;
        if (!iso.IsPeriodic()) { a = Math.max(a, iso.FirstParameter()); b = Math.min(b, iso.LastParameter()); }
        if (!(b - a > 1e-9)) throw new Error('the face is too thin there for an isoparam');
        const whole = new o.BRepBuilderAPI_MakeEdge(iso, a, b).Edge();
        const common = new o.BRepAlgoAPI_Common(whole, fwd, new o.Message_ProgressRange());
        const pieces = common.IsDone() && !common.HasErrors() ? numbered(common.Shape(), 'TopAbs_EDGE') : [];
        if (pieces.length) for (const e of pieces) tools.Append(e); else tools.Append(whole);
    }
    const args = new o.NCollection_List_TopoDS_Shape();
    args.Append(shape);
    const mk = new o.BRepAlgoAPI_Splitter();
    mk.SetArguments(args);
    mk.SetTools(tools);
    mk.Build(new o.Message_ProgressRange());
    if (!mk.IsDone() || mk.HasErrors()) throw new Error('the isoparam could not be imprinted there');
    const solid = numbered(mk.Shape(), 'TopAbs_SOLID')[0], shell = numbered(mk.Shape(), 'TopAbs_SHELL')[0];
    if (!solid && !shell) throw new Error('the isoparam could not be imprinted there');
    let result = solid ? o.TopoDS.Solid(solid) : o.TopoDS.Shell(shell);
    const pieces = successors(mk, f);
    if (pieces.length < 2) throw new Error('the isoparam does not cross that face');
    if (subdivide) {
        const all = numbered(result, 'TopAbs_FACE').map(g => o.TopoDS.Face(g));
        const replaced = new Map();
        let gap = 1e-4;
        for (const p of pieces) {
            const n = all.findIndex(g => g.IsSame(p));
            if (n < 0) continue;
            const piece = all[n];
            // The face's control surface over the whole face (same parameters), cut to this piece.
            const cs = controlSurface(f);
            if (!cs) throw new Error('this build cannot subdivide that face; rebuild it first');
            if (!cs.exact) gap = Math.max(gap, 2e-3);
            const s = cs.surface;
            for (const c of at) alongU ? s.InsertVKnot(c, s.VDegree(), 1e-9, true) : s.InsertUKnot(c, s.UDegree(), 1e-9, true);
            const { UMin, UMax, VMin, VMax } = o.BRepTools.UVBounds(piece, 0, 0, 0, 0);
            const b = [UMin, UMax, VMin, VMax];
            const closed = alongU ? s.IsVPeriodic() : s.IsUPeriodic();
            if (!closed) {
                const [s0, s1] = alongU ? [s.VKnot(1), s.VKnot(s.NbVKnots())] : [s.UKnot(1), s.UKnot(s.NbUKnots())];
                const mid = alongU ? (VMin + VMax) / 2 : (UMin + UMax) / 2;
                let lo = s0, hi = s1;
                for (const c of at) { if (c <= mid) lo = c; else if (c < hi) { hi = c; break; } }
                if (alongU) { s.Segment(s.UKnot(1), s.UKnot(s.NbUKnots()), lo, hi, 1e-9, 1e-9); b[2] = Math.max(b[2], lo); b[3] = Math.min(b[3], hi); }
                else { s.Segment(lo, hi, s.VKnot(1), s.VKnot(s.NbVKnots()), 1e-9, 1e-9); b[0] = Math.max(b[0], lo); b[1] = Math.min(b[1], hi); }
            }
            replaced.set(n, remade(piece, s, b));
        }
        result = assemble(result, all, replaced, gap, 'the split face');
    }
    return { shape: result, history: trace([shape], result, s => successors(mk, s)) };
}
