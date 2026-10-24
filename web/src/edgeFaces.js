// Align Surface's view of an edge in the browser build, as w3d_edge_faces gives it on the desktop:
// the faces along edge `edge` of `shape`, each with its control surface (as Toggle Points shows and
// moves it) and its frames at `points`, in the flat layout alignSurface.js reads.

import { numbered, numberedEdges, oc } from './Kernel.js';
import { controlSurface } from './facePoles.js';

const xyz = p => [p.X(), p.Y(), p.Z()];

export function edgeFaces(shape, edge, points) {
    const o = oc();
    const e = numberedEdges(shape)[edge];
    if (!e) throw new Error('that edge no longer exists');
    const out = [0];
    numbered(shape, 'TopAbs_FACE').forEach((raw, n) => {
        const face = o.TopoDS.Face(raw);
        let on = false;
        for (const ex = new o.TopExp_Explorer(face, o.TopAbs_ShapeEnum.TopAbs_EDGE, o.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More() && !on; ex.Next()) on = ex.Current().IsSame(e);
        if (!on) return;
        out[0]++;
        const ad = new o.BRepAdaptor_Surface(face, true);
        const { UMin, UMax, VMin, VMax } = o.BRepTools.UVBounds(face, 0, 0, 0, 0);
        out.push(n, ...xyz(ad.Value((UMin + UMax) / 2, (VMin + VMax) / 2)));
        let cs = null;
        try { cs = controlSurface(face); } catch { cs = null; }
        if (cs?.exact) {
            const s = cs.surface, knots = (count, k, m) => {
                const flat = [];
                for (let i = 1; i <= count; i++) for (let j = 0; j < m(i); j++) flat.push(k(i));
                return flat;
            };
            const uk = knots(s.NbUKnots(), i => s.UKnot(i), i => s.UMultiplicity(i));
            const vk = knots(s.NbVKnots(), i => s.VKnot(i), i => s.VMultiplicity(i));
            out.push(1, s.UDegree(), s.VDegree(), s.NbUPoles(), s.NbVPoles(), uk.length, vk.length, ...uk, ...vk, s.IsURational() || s.IsVRational() ? 1 : 0);
            for (let a = 1; a <= s.NbUPoles(); a++) for (let c = 1; c <= s.NbVPoles(); c++) out.push(...xyz(s.Pole(a, c)));
        } else out.push(0);
        const surface = o.BRep_Tool.Surface(face);
        const sign = face.Orientation() === o.TopAbs_Orientation.TopAbs_REVERSED ? -1 : 1;
        for (const q of points) {
            const pr = new o.GeomAPI_ProjectPointOnSurf(new o.gp_Pnt(...q), surface, o.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad);
            if (!pr.NbPoints()) throw new Error('the reference face could not be found under the edge');
            const { U, V } = pr.LowerDistanceParameters(0, 0);
            const P = new o.gp_Pnt(), du = new o.gp_Vec(), dv = new o.gp_Vec(), duu = new o.gp_Vec(), dvv = new o.gp_Vec(), duv = new o.gp_Vec();
            ad.D2(U, V, P, du, dv, duu, dvv, duv);
            out.push(...xyz(P), ...xyz(du), ...xyz(dv), ...xyz(duu), ...xyz(duv), ...xyz(dvv), sign);
        }
    });
    return out;
}
