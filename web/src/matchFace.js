// Plasticity's Match Face in the browser build, as w3d_match_faces does it on the desktop: faces of
// a solid replaced by another face's surface, the body grown out to it or cut back to it. Each
// face's column (the face swept along its outward normal both ways, past everything) is split by
// the target's surface carried on well past its edges; inside the columns the body keeps only what
// lies on the face's inner side of that surface, grown out to it where the face stood short.

import * as THREE from 'three';
import { numbered, oc } from './Kernel.js';
import { extendBSpline } from './ExtendSheet.js';
import { refit } from './rebuildFace.js';

const v3 = p => new THREE.Vector3(p.X(), p.Y(), p.Z());
const STEPS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48];

/** A face's outward normal at the middle of its parameters. */
function faceOut(f) {
    const o = oc();
    const { UMin, UMax, VMin, VMax } = o.BRepTools.UVBounds(f, 0, 0, 0, 0);
    const s = new o.BRepAdaptor_Surface(f, true), p = new o.gp_Pnt(), du = new o.gp_Vec(), dv = new o.gp_Vec();
    s.D1((UMin + UMax) / 2, (VMin + VMax) / 2, p, du, dv);
    const n = v3(du).cross(v3(dv));
    if (n.length() < 1e-12) throw new Error('that face has no direction at its middle');
    if (f.Orientation() === o.TopAbs_Orientation.TopAbs_REVERSED) n.negate();
    return n.normalize();
}

/** Face `tf`'s surface as a B-spline (fitted within 1e-4 mm) carried straight on `far` past each open side. */
function wideSurface(tf, far) {
    const o = oc();
    const ad = new o.BRepAdaptor_Surface(tf, true);
    const at = (u, v) => { const p = ad.Value(u, v); return [p.X(), p.Y(), p.Z()]; };
    const { UMin, UMax, VMin, VMax } = o.BRepTools.UVBounds(tf, 0, 0, 0, 0);
    const b = [UMin, UMax, VMin, VMax];
    let s;
    for (const k of STEPS) {
        s = refit(at, b, [3, 3], [k, k]);
        let worst = 0;
        for (let i = 0; i <= 16; i++) for (let j = 0; j <= 16; j++) {
            const u = UMin + (UMax - UMin) * i / 16, v = VMin + (VMax - VMin) * j / 16;
            const q = s.Value(u, v), p = at(u, v);
            worst = Math.max(worst, Math.hypot(q.X() - p[0], q.Y() - p[1], q.Z() - p[2]));
        }
        if (worst <= 1e-4) break;
    }
    for (let side = 0; side < 4; side++) if (!(side < 2 ? ad.IsUClosed() : ad.IsVClosed())) s = extendBSpline(s, side, far);
    return s;
}

/** `shape` (a solid) with `faces` replaced by the surface of face `tface` of `target`. */
export function matchFaces(shape, faces, target, tface) {
    const o = oc();
    if (!faces?.length) throw new Error('select the faces to match');
    if (!numbered(shape, 'TopAbs_SOLID').length) throw new Error('Match Face works on the faces of a solid');
    const all = numbered(shape, 'TopAbs_FACE').map(f => o.TopoDS.Face(f));
    const tf = numbered(target, 'TopAbs_FACE')[tface];
    if (!tf) throw new Error('that target face no longer exists');
    const box = new o.Bnd_Box();
    o.BRepBndLib.Add(shape, box, false);
    o.BRepBndLib.Add(target, box, false);
    const far = Math.sqrt(box.SquareExtent()) * 2;
    const wide = wideSurface(o.TopoDS.Face(tf), far);
    const mk = new o.BRepBuilderAPI_MakeFace(wide, 1e-7);
    if (!mk.IsDone()) throw new Error('the target surface could not be carried on past its edges');
    const sheet = mk.Face();
    /** The target's normal (unnormalised) and foot at the point nearest `p`, or null. */
    const foot = p => {
        const pr = new o.GeomAPI_ProjectPointOnSurf(new o.gp_Pnt(p.x, p.y, p.z), wide, o.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad);
        if (!pr.NbPoints()) return null;
        const { U, V } = pr.LowerDistanceParameters(0, 0);
        const q = new o.gp_Pnt(), du = new o.gp_Vec(), dv = new o.gp_Vec();
        wide.D1(U, V, q, du, dv);
        return { q: v3(q), m: v3(du).cross(v3(dv)) };
    };
    const columns = [], outs = [];
    let sense = 0;
    for (const n of faces) {
        const f = all[n];
        if (!f) throw new Error('that face no longer exists');
        const d = faceOut(f), t = new o.gp_Trsf();
        t.SetTranslation(new o.gp_Vec(-d.x * far, -d.y * far, -d.z * far));
        const low = new o.BRepBuilderAPI_Transform(f, t, true, false).Shape();
        columns.push(new o.BRepPrimAPI_MakePrism(low, new o.gp_Vec(d.x * 2 * far, d.y * 2 * far, d.z * 2 * far), false, true).Shape());
        outs.push(new o.BRepPrimAPI_MakePrism(f, new o.gp_Vec(d.x * far, d.y * far, d.z * far), false, true).Shape());
        const g = new o.GProp_GProps();
        o.BRepGProp.SurfaceProperties(f, g, false, false);
        const at = foot(v3(g.CentreOfMass()));
        if (!at) throw new Error('the target surface does not lie across that face');
        sense += d.dot(at.m.normalize());
    }
    if (Math.abs(sense) < 1e-6 * faces.length) throw new Error('the target surface runs along that face, not across it');
    const inner = sense > 0 ? -1 : 1;
    const fuse = list => list.reduce((a, b) => {
        const f = new o.BRepAlgoAPI_Fuse(a, b, new o.Message_ProgressRange());
        if (!f.IsDone() || f.HasErrors()) throw new Error("the faces' columns could not be joined");
        return f.Shape();
    });
    const column = fuse(columns), out = fuse(outs);
    const args = new o.NCollection_List_TopoDS_Shape(), tools = new o.NCollection_List_TopoDS_Shape();
    args.Append(column);
    tools.Append(sheet);
    const split = new o.BRepAlgoAPI_Splitter();
    split.SetArguments(args);
    split.SetTools(tools);
    split.Build(new o.Message_ProgressRange());
    if (!split.IsDone() || split.HasErrors()) throw new Error('the target surface could not cut across the faces');
    const pieces = numbered(split.Shape(), 'TopAbs_SOLID');
    const below = pieces.filter(p => {
        const g = new o.GProp_GProps();
        o.BRepGProp.VolumeProperties(p, g, false, false, false);
        const c = v3(g.CentreOfMass()), at = foot(c);
        return at && c.clone().sub(at.q).dot(at.m) * inner > 0;
    });
    if (pieces.length < 2 || !below.length) throw new Error('the target surface does not cut across the faces');
    const step = (Op, a, b, why) => {
        const r = new Op(a, b, new o.Message_ProgressRange());
        if (!r.IsDone() || r.HasErrors()) throw new Error(why);
        return r.Shape();
    };
    const rest = step(o.BRepAlgoAPI_Cut, shape, column, 'the body could not be cut around the faces');
    const grown = step(o.BRepAlgoAPI_Fuse, shape, out, 'the body could not be cut around the faces');
    const within = step(o.BRepAlgoAPI_Common, grown, fuse(below), 'the body could not be matched to the target');
    const joined = step(o.BRepAlgoAPI_Fuse, rest, within, 'the matched part could not be joined back');
    const unify = new o.ShapeUpgrade_UnifySameDomain(joined, true, true, false);
    unify.Build();
    const result = unify.Shape();
    const solids = numbered(result, 'TopAbs_SOLID').length;
    if (solids !== 1) throw new Error(solids ? 'matching to that surface splits the body in pieces' : 'matching to that surface leaves nothing of the body');
    if (!new o.BRepCheck_Analyzer(result, true, false, false).IsValid()) throw new Error('matching to that surface breaks the body');
    return result;
}
