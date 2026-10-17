// The hidden-line drawing behind SVG and DXF export in the browser build, as w3d_hidden_lines does it
// on the desktop: OpenCascade's hidden-line removal seen along the view, each line cut to within the
// tolerance, in the view's own x, y.

import { numberedEdges, oc } from './Kernel.js';

/**
 * The lines of `shapes` seen along `toward` (pointing at the viewer) through `origin`, `x` the
 * drawing's x (arrays): [{ hidden, points: [x0, y0, ...] }]. Throws when there is nothing to draw.
 */
export function hiddenLines(shapes, origin, toward, x, deflection) {
    if (!(deflection > 0)) throw new Error('the tolerance must be greater than zero');
    if (!shapes.length) throw new Error('nothing to draw');
    const o = oc();
    const frame = new o.gp_Ax2(new o.gp_Pnt(...origin), new o.gp_Dir(...toward), new o.gp_Dir(...x));
    const hlr = new o.HLRBRep_Algo();
    for (const s of shapes) hlr.Add(s, 0);
    hlr.Projector(new o.HLRAlgo_Projector(frame));
    hlr.Update();
    hlr.Hide();
    const out = new o.HLRBRep_HLRToShape(hlr);
    const lines = [];
    const emit = (c, hidden) => {
        if (c.IsNull()) return;
        for (const e of numberedEdges(c)) {
            o.BRepLib.BuildCurves3d(e, 1e-5, o.GeomAbs_Shape.GeomAbs_C1, 14, 0);
            const pts = new o.GCPnts_TangentialDeflection(new o.BRepAdaptor_Curve(e), 0.1, deflection);
            if (pts.NbPoints() < 2) continue;
            const points = [];
            for (let i = 1; i <= pts.NbPoints(); i++) { const p = pts.Value(i); points.push(p.X(), p.Y()); }
            lines.push({ hidden, points });
        }
    };
    emit(out.VCompound(), false);
    emit(out.Rg1LineVCompound(), false);
    emit(out.OutLineVCompound(), false);
    emit(out.HCompound(), true);
    emit(out.Rg1LineHCompound(), true);
    emit(out.OutLineHCompound(), true);
    if (!lines.length) throw new Error('nothing to draw seen from that view');
    return lines;
}
