// Plasticity's Extend Sheet in the browser build, as w3d_extend_sheet does it on the desktop: the
// sheet grown past one open edge, carrying straight on from its face. An edge along a side of a
// B-spline sheet (as Patch and Bridge Surface make) extends the surface itself; a straight edge of a
// flat sheet extends the plane with a strip merged into it.
//
// The browser's OpenCascade cannot hand a surface to GeomLib's extender, so the B-spline is
// extended here, exactly: a straight run off the side, C1 with the surface, joined into its knots.

import * as THREE from 'three';
import { numbered, numberedEdges, oc } from './Kernel.js';
import { isSheet } from './Patch.js';
import { insertKnot } from './curveEdit.js';

const v3 = p => new THREE.Vector3(p.X(), p.Y(), p.Z());

/** Which side of `face`'s surface (u0, u1, v0, v1 as 0..3) `edge` runs along, or -1. */
function isoSide(edge, face, surface, b) {
    const o = oc();
    const { returnValue: g, First, Last } = o.BRep_Tool.Curve(edge, 0, 0);
    if (!g) return -1;
    const uv = [];
    for (let i = 0; i <= 8; i++) {
        const pr = new o.GeomAPI_ProjectPointOnSurf(g.Value(First + (Last - First) * i / 8), surface, o.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad);
        if (!pr.NbPoints() || pr.LowerDistance() > 1e-6) return -1;
        const { U, V } = pr.LowerDistanceParameters(0, 0);
        uv.push([U, V]);
    }
    const eu = 1e-6 * Math.max(1, b[1] - b[0]), ev = 1e-6 * Math.max(1, b[3] - b[2]);
    for (let side = 0; side < 4; side++) {
        if (uv.every(([u, v]) => Math.abs((side < 2 ? u : v) - b[side]) < (side < 2 ? eu : ev))) return side;
    }
    return -1;
}

/** The Bezier with control points `B` (arrays) at the blossom arguments `ts`: de Casteljau, one argument per level. */
function blossom(B, ts) {
    let b = B.map(q => [...q]);
    for (const t of ts) b = b.slice(1).map((q, i) => q.map((v, m) => (1 - t) * b[i][m] + t * v));
    return b[0];
}

/**
 * The `p` poles that carry a clamped B-spline row (`pts`, knots `flat`) on past its end by `T` in
 * its parameter, following its last span's polynomial (Natural): that span cut out as a Bezier,
 * then its continuation past 1 by blossoming. Ordered away from the end.
 */
function naturalRun(pts, flat, p, T) {
    let c = { degree: p, poles: pts.map(q => [q.x, q.y, q.z]), weights: pts.map(() => 1), knots: [...flat] };
    const n = pts.length, a = flat[n - 1], b = flat[n];
    while (c.knots.filter(k => k === a).length < p && a > flat[0]) c = insertKnot(c, a);
    const B = c.poles.slice(-(p + 1)), t = 1 + T / (b - a);
    return Array.from({ length: p }, (_, k) => { const [x, y, z] = blossom(B, [...Array(p - k - 1).fill(1), ...Array(k + 1).fill(t)]); return new THREE.Vector3(x, y, z); });
}

/**
 * `s` (a non-rational B-spline surface) run on `distance` past side `side` (0..3 as u0, u1, v0, v1):
 * straight on (Linear) or following its curvature there (Natural).
 */
function extendBSpline(s, side, distance, natural = false) {
    const o = oc();
    const inU = side < 2, after = side % 2 === 1;
    const nu = s.NbUPoles(), nv = s.NbVPoles();
    // Work on rows along the extended direction: rows[i][j], i across it.
    const n = inU ? nu : nv, m = inU ? nv : nu;
    const P = Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => v3(inU ? s.Pole(i + 1, j + 1) : s.Pole(j + 1, i + 1))));
    const p = inU ? s.UDegree() : s.VDegree();
    const nk = inU ? s.NbUKnots() : s.NbVKnots();
    const knots = [], mults = [];
    for (let i = 1; i <= nk; i++) { knots.push(inU ? s.UKnot(i) : s.VKnot(i)); mults.push(inU ? s.UMultiplicity(i) : s.VMultiplicity(i)); }
    if (mults[0] !== p + 1 || mults.at(-1) !== p + 1) throw new Error('that sheet is periodic across the edge; it has no side to extend');
    const flat = knots.flatMap((k, i) => Array(mults[i]).fill(k));
    // The derivative across the side at each pole (the clamped end's first difference), and the run.
    const [edge, inner, c] = after
        ? [P[n - 1], P[n - 2], p / (flat[n - 1 + p] - flat[n - 1])]
        : [P[0], P[1], p / (flat[p + 1] - flat[1])];
    const d = edge.map((q, j) => q.clone().sub(inner[j]).multiplyScalar(c));
    // One parameter run for the whole side keeps the join C1: the side's mean speed sets it.
    const speed = d.reduce((t, v) => t + v.length(), 0) / d.length;
    if (!(speed > 1e-12)) throw new Error('the sheet is degenerate along that edge');
    const T = distance / speed;
    let extra = Array.from({ length: p }, (_, k) => edge.map((q, j) => q.clone().addScaledVector(d[j], T * (k + 1) / p)));
    if (natural) {
        // Each row across the side carried on by its own last span; the start side as the end of the row reversed.
        const a0 = flat[0], a1 = flat.at(-1);
        const runs = Array.from({ length: m }, (_, j) => {
            const row = P.map(r => r[j]);
            return after ? naturalRun(row, flat, p, T) : naturalRun([...row].reverse(), flat.map(k => a0 + a1 - k).reverse(), p, T);
        });
        extra = Array.from({ length: p }, (_, k) => runs.map(r => r[k]));
    }
    let rows, ks, ms;
    if (after) {
        rows = [...P, ...extra];
        ks = [...knots, knots.at(-1) + T];
        ms = [...mults.slice(0, -1), p, p + 1];
    } else {
        rows = [...extra.reverse(), ...P];
        ks = [knots[0] - T, ...knots];
        ms = [p + 1, p, ...mults.slice(1)];
    }
    const N = rows.length;
    const poles = inU ? new o.NCollection_Array2_gp_Pnt(1, N, 1, m) : new o.NCollection_Array2_gp_Pnt(1, m, 1, N);
    rows.forEach((row, i) => row.forEach((q, j) => {
        const pt = new o.gp_Pnt(q.x, q.y, q.z);
        if (inU) poles.SetValue(i + 1, j + 1, pt); else poles.SetValue(j + 1, i + 1, pt);
    }));
    const arr = (vals, Type) => { const a = new Type(1, vals.length); vals.forEach((v, i) => a.SetValue(i + 1, v)); return a; };
    const other = inU ? 'V' : 'U';
    const ok = [], om = [];
    for (let i = 1; i <= s[`Nb${other}Knots`](); i++) { ok.push(s[`${other}Knot`](i)); om.push(s[`${other}Multiplicity`](i)); }
    const [uk, um, vk, vm] = inU
        ? [arr(ks, o.NCollection_Array1_double), arr(ms, o.NCollection_Array1_int), arr(ok, o.NCollection_Array1_double), arr(om, o.NCollection_Array1_int)]
        : [arr(ok, o.NCollection_Array1_double), arr(om, o.NCollection_Array1_int), arr(ks, o.NCollection_Array1_double), arr(ms, o.NCollection_Array1_int)];
    return new o.Geom_BSplineSurface(poles, uk, vk, um, vm, s.UDegree(), s.VDegree(), s.IsUPeriodic(), s.IsVPeriodic());
}

/**
 * Sheet `shape` grown `distance` past its open edge number `n`, straight on or, when `natural`,
 * following the surface's curvature; throws saying why when it cannot be.
 */
export function extendSheet(shape, n, distance, natural = false) {
    const o = oc();
    if (!Number.isFinite(distance) || !(distance > 1e-6)) throw new Error('the distance must be above zero');
    if (!isSheet(shape)) throw new Error('extend edges of sheets; that body is solid');
    const edge = numberedEdges(shape)[n];
    if (!edge) throw new Error('that edge no longer exists');
    const faces = numbered(shape, 'TopAbs_FACE').map(f => o.TopoDS.Face(f));
    const around = faces.filter(f => numberedEdges(f).some(e => e.IsSame(edge)));
    if (around.length !== 1) throw new Error(around.length ? 'extend an open edge of a sheet; that edge joins two faces' : 'that edge has no sheet to extend');
    const face = around[0];
    const ad = new o.BRepAdaptor_Surface(face, true);
    const surface = o.BRep_Tool.Surface(face);
    const { UMin, UMax, VMin, VMax } = o.BRepTools.UVBounds(face, 0, 0, 0, 0);
    const b = [UMin, UMax, VMin, VMax];
    let grown = null;
    if (ad.GetType() === o.GeomAbs_SurfaceType.GeomAbs_BSplineSurface) {
        const s = ad.BSpline();
        const full = Math.abs(UMin - s.UKnot(1)) < 1e-9 && Math.abs(UMax - s.UKnot(s.NbUKnots())) < 1e-9 && Math.abs(VMin - s.VKnot(1)) < 1e-9 && Math.abs(VMax - s.VKnot(s.NbVKnots())) < 1e-9;
        const side = isoSide(edge, face, surface, b);
        const untrimmed = full && numberedEdges(face).every(e => o.BRep_Tool.Degenerated(e) || isoSide(e, face, surface, b) >= 0);
        if (side >= 0 && untrimmed) {
            if (s.IsURational() || s.IsVRational()) throw new Error('this build extends polynomial sheets only; the desktop app extends this one');
            const mk = new o.BRepBuilderAPI_MakeFace(extendBSpline(s, side, distance, natural), 1e-7);
            if (!mk.IsDone()) throw new Error('the extended surface could not be made into a face');
            grown = mk.Face();
            if (face.Orientation() === o.TopAbs_Orientation.TopAbs_REVERSED) grown.Reverse();
        }
    }
    if (!grown) {
        const curve = new o.BRepAdaptor_Curve(edge);
        if (ad.GetType() !== o.GeomAbs_SurfaceType.GeomAbs_Plane || curve.GetType() !== o.GeomAbs_CurveType.GeomAbs_Line) {
            throw new Error("extend a side of the sheet's surface, or a straight edge of a flat sheet; that edge is trimmed across its surface");
        }
        // Out of the face, in its plane: the edge as the face's wire runs it has the face on its left.
        let inFace = edge;
        for (const ex = new o.TopExp_Explorer(face, o.TopAbs_ShapeEnum.TopAbs_EDGE, o.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
            if (ex.Current().IsSame(edge)) { inFace = o.TopoDS.Edge(ex.Current()); break; }
        }
        const d = v3(curve.Value(curve.LastParameter())).sub(v3(curve.Value(curve.FirstParameter()))).normalize();
        if (inFace.Orientation() === o.TopAbs_Orientation.TopAbs_REVERSED) d.negate();
        const ax = ad.Plane().Axis().Direction();
        const normal = new THREE.Vector3(ax.X(), ax.Y(), ax.Z());
        if (face.Orientation() === o.TopAbs_Orientation.TopAbs_REVERSED) normal.negate();
        const out = d.cross(normal).normalize().multiplyScalar(distance);
        const strip = new o.BRepPrimAPI_MakePrism(edge, new o.gp_Vec(out.x, out.y, out.z), false, true).Shape();
        const fuse = new o.BRepAlgoAPI_Fuse(face, strip, new o.Message_ProgressRange());
        if (!fuse.IsDone()) throw new Error('the strip could not be joined to the sheet');
        const unify = new o.ShapeUpgrade_UnifySameDomain(fuse.Shape(), true, true, false);
        unify.Build();
        const merged = numbered(unify.Shape(), 'TopAbs_FACE');
        if (merged.length !== 1) throw new Error('the strip could not be merged into the sheet');
        grown = o.TopoDS.Face(merged[0]);
    }
    let result = grown;
    if (faces.length > 1) {
        const sew = new o.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);
        for (const f of faces) sew.Add(f.IsSame(face) ? grown : f);
        sew.Perform(new o.Message_ProgressRange());
        result = sew.SewedShape();
    }
    if (!new o.BRepCheck_Analyzer(result, true, false, false).IsValid()) throw new Error('the extended sheet is not valid; try a shorter distance');
    return result;
}
