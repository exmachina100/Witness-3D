// Deform Curve's face coordinates in the browser build, as w3d_face_uvn does them on the desktop:
// a point on or over a face as (s, t, n), s and t its surface parameters scaled to 0..1 over the
// face and n its height along the outward normal, and back.

import { numbered, oc } from './Kernel.js';

/**
 * Face `face` of `shape` as Deform's map: `uvn(point)` its (s, t, n) and `at([s, t, n])` the point
 * back, and `size`, the face's length along u and along v through its middle, in mm.
 */
export function faceMap(shape, face) {
    const o = oc();
    const faces = numbered(shape, 'TopAbs_FACE');
    if (!(face >= 0 && face < faces.length)) throw new Error('that face no longer exists');
    const f = o.TopoDS.Face(faces[face]);
    const back = f.Orientation() === o.TopAbs_Orientation.TopAbs_REVERSED;
    const ad = new o.BRepAdaptor_Surface(f, true);
    const { UMin: u0, UMax: u1, VMin: v0, VMax: v1 } = o.BRepTools.UVBounds(f, 0, 0, 0, 0);
    if (!(u1 - u0 > 1e-12) || !(v1 - v0 > 1e-12)) throw new Error('that face has no area');
    const p = new o.gp_Pnt(), du = new o.gp_Vec(), dv = new o.gp_Vec();
    const frame = (u, v) => {
        ad.D1(u, v, p, du, dv);
        let n = du.Crossed(dv);
        if (n.Magnitude() < 1e-14) {
            // A pole of the surface: step in a little to find which way it faces.
            ad.D1(u + (u1 - u0) * 1e-6, v + (v1 - v0) * 1e-6, new o.gp_Pnt(), du, dv);
            n = du.Crossed(dv);
        }
        if (n.Magnitude() < 1e-14) throw new Error('the face has no normal there');
        const m = n.Magnitude() * (back ? -1 : 1);
        return { p: [p.X(), p.Y(), p.Z()], n: [n.X() / m, n.Y() / m, n.Z() / m] };
    };
    const length = alongU => {
        let total = 0, last = null;
        for (let i = 0; i <= 64; i++) {
            const a = i / 64, q = alongU ? ad.Value(u0 + (u1 - u0) * a, (v0 + v1) / 2) : ad.Value((u0 + u1) / 2, v0 + (v1 - v0) * a);
            if (last) total += q.Distance(last);
            last = q;
        }
        return total;
    };
    const surface = o.BRep_Tool.Surface(f);
    // One projector, re-aimed at each point.
    let pr = null;
    return {
        size: [length(true), length(false)],
        at: ([s, t, h]) => {
            const { p, n } = frame(u0 + (u1 - u0) * s, v0 + (v1 - v0) * t);
            return [p[0] + n[0] * h, p[1] + n[1] * h, p[2] + n[2] * h];
        },
        uvn: q => {
            const g = new o.gp_Pnt(q[0], q[1], q[2]);
            if (!pr) pr = new o.GeomAPI_ProjectPointOnSurf(g, surface, o.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad);
            else pr.Perform(g);
            if (!pr.NbPoints()) throw new Error('that does not lie over the reference face');
            const { U, V } = pr.LowerDistanceParameters(0, 0);
            const { p, n } = frame(U, V);
            return [(U - u0) / (u1 - u0), (V - v0) / (v1 - v0), (q[0] - p[0]) * n[0] + (q[1] - p[1]) * n[1] + (q[2] - p[2]) * n[2]];
        },
    };
}

/**
 * Face `face` of `shape`: `points` ([x, y, z]) to their (s, t, n), or with `map` (s, t, n) back to
 * points. Also `size`, the face's length along u and along v through its middle, in mm.
 */
export function faceUvn(shape, face, map, points) {
    const m = faceMap(shape, face);
    try {
        return { size: m.size, points: points.map(map ? m.at : m.uvn) };
    } catch (e) {
        throw e.message === 'that does not lie over the reference face' ? new Error('a curve does not lie over the reference face') : e;
    }
}
