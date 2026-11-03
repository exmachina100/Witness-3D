// Offset Face for curved faces in the browser build. This OpenCascade build has no per-face
// offset, so each picked face is thickened into a slab (the face and its offset, joined by walls
// along the face's normals at its edges) and the slabs are joined to the body (out) or cut from it
// (in). Faces whose neighbours meet them square on (a boss's or a hole's wall, a cylinder's side
// between its caps) come out as the desktop's offset; a face whose neighbours run on smoothly from
// it (a fillet) gets walls standing square to them instead, so it is refused unless every face it
// touches meets it square on.

import { booleanWithHistory, numbered, oc, volume } from './Kernel.js';

/**
 * @param shape the solid
 * @param {number[]} faceNos its faces to offset (numbered order)
 * @param {number} distance out of the body (positive) or into it (negative)
 * @returns {{shape, history}}
 */
export function offsetCurvedFaces(shape, faceNos, distance) {
    const o = oc();
    const faces = numbered(shape, 'TopAbs_FACE').map(f => o.TopoDS.Face(f));
    if (!faceNos.length || faceNos.some(n => !faces[n])) throw new Error('select the faces to offset again');
    const out = distance > 0, d = Math.abs(distance);
    for (const n of faceNos) squareOn(shape, faces, n);
    let tool = null;
    for (const n of faceNos) {
        // A copy of the face, so the slab shares nothing with the body; turned round to grow outward.
        const copy = new o.BRepBuilderAPI_Transform(faces[n], new o.gp_Trsf(), true, false).Shape();
        const mk = new o.BRepOffsetAPI_MakeThickSolid();
        mk.MakeThickSolidBySimple(out ? copy.Reversed() : copy, -d);
        if (!mk.IsDone()) throw new Error('that face could not be offset that far');
        const slab = mk.Shape();
        if (!(volume(slab) > 0)) throw new Error('that face could not be offset that far');
        tool = tool ? booleanWithHistory(tool, slab, 'union').shape : slab;
    }
    const r = booleanWithHistory(shape, tool, out ? 'union' : 'difference');
    if (!(volume(r.shape) > 0) || numbered(r.shape, 'TopAbs_SOLID').length !== 1) throw new Error('that offset breaks the body; offset the face less');
    return r;
}

/** Refuses a face that a neighbour runs on from smoothly (the slab's walls would stand off it). */
function squareOn(shape, faces, n) {
    const o = oc(), face = faces[n];
    for (const e of numbered(face, 'TopAbs_EDGE')) {
        const edge = o.TopoDS.Edge(e);
        if (o.BRep_Tool.Degenerated(edge)) continue;
        const c = new o.BRepAdaptor_Curve(edge), t = (c.FirstParameter() + c.LastParameter()) / 2, p = c.Value(t);
        const other = faces.find((f, i) => i !== n && numbered(f, 'TopAbs_EDGE').some(x => x.IsSame(edge)));
        if (!other) continue;
        const na = normalAt(face, p), nb = normalAt(other, p);
        if (na && nb && Math.abs(na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2]) > 0.02) throw new Error('the browser demo offsets curved faces whose neighbours meet them square on (a boss or a hole); the desktop app offsets any face');
    }
}

/** The face's surface normal (up to sign) nearest the point p. */
function normalAt(face, p) {
    const o = oc();
    const pr = new o.GeomAPI_ProjectPointOnSurf(p, o.BRep_Tool.Surface(face), o.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad);
    if (!pr.NbPoints()) return null;
    const { U, V } = pr.LowerDistanceParameters(0, 0);
    const ad = new o.BRepAdaptor_Surface(face, false), P = new o.gp_Pnt(), du = new o.gp_Vec(), dv = new o.gp_Vec();
    ad.D1(U, V, P, du, dv);
    const n = du.Crossed(dv), l = n.Magnitude();
    return l > 1e-12 ? [n.X() / l, n.Y() / l, n.Z() / l] : null;
}
