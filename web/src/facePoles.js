// Toggle Points in the browser build: each face's control points (the desktop asks w3d_face_poles).
// Kept apart so the desktop UI never pulls in the browser kernel.
import { numbered, oc } from './Kernel.js';
import { refit } from './rebuildFace.js';

const rowsOf = b => {
    const rows = [];
    for (let a = 1; a <= b.NbUPoles(); a++) {
        const row = [];
        for (let c = 1; c <= b.NbVPoles(); c++) { const p = b.Pole(a, c); row.push([p.X(), p.Y(), p.Z()]); }
        rows.push(row);
    }
    return rows;
};

/**
 * A face's control surface, in model space: { surface (a Geom_BSplineSurface of its own), bounds
 * [u0, u1, v0, v1], exact }. A B-spline face gives a copy of its own; a flat face the bilinear
 * patch over its extent (the same parameters, so exact); other round faces (this build cannot
 * convert them exactly, as w3d_face_poles does) a cubic B-spline fitted to them. A Bezier face has
 * none here. Toggle Points shows these poles and moving them (movePoles.js) moves these.
 */
export function controlSurface(face) {
    const o = oc();
    const ad = new o.BRepAdaptor_Surface(face, true), T = o.GeomAbs_SurfaceType;
    const [UMin, UMax, VMin, VMax] = [ad.FirstUParameter(), ad.LastUParameter(), ad.FirstVParameter(), ad.LastVParameter()];
    const bounds = [UMin, UMax, VMin, VMax];
    const at = (u, v) => { const p = ad.Value(u, v); return [p.X(), p.Y(), p.Z()]; };
    const type = ad.GetType();
    // The adaptor's B-spline is already where the face sits.
    if (type === T.GeomAbs_BSplineSurface) return { surface: new o.Geom_BSplineSurface(ad.BSpline()), bounds, exact: true };
    if (type === T.GeomAbs_BezierSurface) return null;
    if (![UMin, UMax, VMin, VMax].every(Number.isFinite)) return null;
    if (type === T.GeomAbs_Plane) return { surface: refit(at, bounds, [1, 1], [1, 1]), bounds, exact: true };
    const spans = (a, b) => Math.max(1, Math.min(8, Math.ceil(Math.abs(b - a) / (Math.PI / 4))));
    return { surface: refit(at, bounds, [3, 3], [spans(UMin, UMax), spans(VMin, VMax)]), bounds, exact: false };
}

/**
 * Per face (numbered order), its control points as rows of [x, y, z] (u slowest); [] where it has
 * none (see controlSurface).
 */
export function facePoles(shape) {
    const o = oc();
    return numbered(shape, 'TopAbs_FACE').map(f => {
        const face = o.TopoDS.Face(f);
        try {
            const ad = new o.BRepAdaptor_Surface(face, true);
            if (ad.GetType() === o.GeomAbs_SurfaceType.GeomAbs_BezierSurface) {
                const b = ad.Bezier(), rows = [];
                for (let a = 1; a <= b.NbUPoles(); a++) { const row = []; for (let c = 1; c <= b.NbVPoles(); c++) { const p = b.Pole(a, c); row.push([p.X(), p.Y(), p.Z()]); } rows.push(row); }
                return rows;
            }
            const cs = controlSurface(face);
            return cs ? rowsOf(cs.surface) : [];
        } catch { return []; }
    });
}
