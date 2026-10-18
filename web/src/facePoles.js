// Toggle Points in the browser build: each face's control points (the desktop asks w3d_face_poles).
// Kept apart so the desktop UI never pulls in the browser kernel.
import { numbered, oc } from './Kernel.js';
import { refit } from './rebuildFace.js';

const rowsOf = (b, at = p => p) => {
    const rows = [];
    for (let a = 1; a <= b.NbUPoles(); a++) {
        const row = [];
        for (let c = 1; c <= b.NbVPoles(); c++) { const p = at(b.Pole(a, c)); row.push([p.X(), p.Y(), p.Z()]); }
        rows.push(row);
    }
    return rows;
};

/**
 * Per face (numbered order), its control points as rows of [x, y, z] (u slowest); [] where it has
 * none. A B-spline or Bezier face gives its own; a flat face its four corners; other round faces
 * (this build cannot convert them exactly, as w3d_face_poles does) a cubic B-spline fitted to them.
 */
export function facePoles(shape) {
    const o = oc();
    return numbered(shape, 'TopAbs_FACE').map(f => {
        const face = o.TopoDS.Face(f);
        try {
            const ad = new o.BRepAdaptor_Surface(face, true), T = o.GeomAbs_SurfaceType;
            const u0 = ad.FirstUParameter(), u1 = ad.LastUParameter(), v0 = ad.FirstVParameter(), v1 = ad.LastVParameter();
            const at = (u, v) => { const p = ad.Value(u, v); return [p.X(), p.Y(), p.Z()]; };
            // The adaptor's B-spline and Bezier are the bare surface; carry them where the face sits.
            const t = face.Location().Transformation(), moved = p => p.Transformed(t);
            const type = ad.GetType();
            if (type === T.GeomAbs_BSplineSurface) return rowsOf(ad.BSpline().get(), moved);
            if (type === T.GeomAbs_BezierSurface) return rowsOf(ad.Bezier().get(), moved);
            if (type === T.GeomAbs_Plane) return [[at(u0, v0), at(u0, v1)], [at(u1, v0), at(u1, v1)]];
            if (![u0, u1, v0, v1].every(Number.isFinite)) return [];
            const spans = (a, b) => Math.max(1, Math.min(8, Math.ceil(Math.abs(b - a) / (Math.PI / 4))));
            return rowsOf(refit(at, [u0, u1, v0, v1], [3, 3], [spans(u0, u1), spans(v0, v1)]));
        } catch { return []; }
    });
}
