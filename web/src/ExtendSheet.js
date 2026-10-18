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

/** The poles, knots and degree of a clamped B-spline's derivative. */
function derivative({ poles, flat, p }) {
    const q = poles.slice(1).map((v, i) => v.clone().sub(poles[i]).multiplyScalar(p / (flat[i + p + 1] - flat[i + 1])));
    return { poles: q, flat: flat.slice(1, -1), p: p - 1 };
}

/** Rows `rows[k][j]` (k across, j along) as a B-spline surface keeping `s`'s knots along side `side`. */
function rowsSurface(s, inU, rows, ks, ms, degree) {
    const o = oc();
    const R = rows.length, m = rows[0].length;
    const poles = inU ? new o.NCollection_Array2_gp_Pnt(1, R, 1, m) : new o.NCollection_Array2_gp_Pnt(1, m, 1, R);
    rows.forEach((row, k) => row.forEach((q, j) => {
        const pt = new o.gp_Pnt(q.x, q.y, q.z);
        if (inU) poles.SetValue(k + 1, j + 1, pt); else poles.SetValue(j + 1, k + 1, pt);
    }));
    const arr = (vals, Type) => { const a = new Type(1, vals.length); vals.forEach((v, i) => a.SetValue(i + 1, v)); return a; };
    const other = inU ? 'V' : 'U';
    const ok = [], om = [];
    for (let i = 1; i <= s[`Nb${other}Knots`](); i++) { ok.push(s[`${other}Knot`](i)); om.push(s[`${other}Multiplicity`](i)); }
    const [xk, xm, yk, ym] = [arr(ks, o.NCollection_Array1_double), arr(ms, o.NCollection_Array1_int), arr(ok, o.NCollection_Array1_double), arr(om, o.NCollection_Array1_int)];
    const od = inU ? s.VDegree() : s.UDegree();
    return inU ? new o.Geom_BSplineSurface(poles, xk, yk, xm, ym, degree, od, false, false)
        : new o.Geom_BSplineSurface(poles, yk, xk, ym, xm, od, degree, false, false);
}

/**
 * Soft and Reflective, as w3d_extension_face makes them on the desktop: a face of its own past side
 * `side` of the clamped polynomial B-spline `s`, sharing that side's poles. Soft: per pole column, a
 * cubic leaving with the column's tangent and curvature (G2), the curvature fading out by its far
 * end. Reflective: the strip `distance` deep inside the side turned through it (2 e(v) − S(u, v)).
 */
function extensionFace(s, side, distance, reflective) {
    const o = oc();
    const inU = side < 2, after = side % 2 === 1;
    if (s.IsURational() || s.IsVRational()) throw new Error('soft and reflective extend polynomial sheets only; try natural or linear');
    if (inU ? s.IsUPeriodic() : s.IsVPeriodic()) throw new Error('that sheet is periodic across the edge; it has no side to extend');
    const grid = g => {
        const nu = g.NbUPoles(), nv = g.NbVPoles(), n = inU ? nu : nv, m = inU ? nv : nu;
        const P = Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => v3(inU ? g.Pole(i + 1, j + 1) : g.Pole(j + 1, i + 1))));
        const nk = inU ? g.NbUKnots() : g.NbVKnots(), knots = [], mults = [];
        for (let i = 1; i <= nk; i++) { knots.push(inU ? g.UKnot(i) : g.VKnot(i)); mults.push(inU ? g.UMultiplicity(i) : g.VMultiplicity(i)); }
        return { P, n, m, knots, mults, flat: knots.flatMap((k, i) => Array(mults[i]).fill(k)) };
    };
    const p = inU ? s.UDegree() : s.VDegree();
    const { P, n, m, knots, mults, flat } = grid(s);
    const a = knots[0], b = knots.at(-1), at = after ? b : a;
    if (!reflective) {
        const rows = [[], [], [], []], T = distance;
        for (let j = 0; j < m; j++) {
            const c0 = { poles: P.map(r => r[j]), flat, p };
            const c1 = derivative(c0), c2 = p > 1 ? derivative(c1) : null;
            const end = c => after ? c.poles.at(-1) : c.poles[0];
            const e = end(c0), d1 = end(c1).clone(), d2 = c2 ? end(c2).clone() : new THREE.Vector3();
            if (!after) d1.negate();
            const sp = d1.length();
            if (!(sp > 1e-12)) throw new Error('the sheet is degenerate along that edge');
            const v = d1.divideScalar(sp), w = d2.addScaledVector(v, -d2.dot(v)).divideScalar(sp * sp);
            rows[0].push(e.clone());
            rows[1].push(e.clone().addScaledVector(v, T / 3));
            rows[2].push(e.clone().addScaledVector(v, 2 * T / 3).addScaledVector(w, T * T / 6));
            rows[3].push(e.clone().addScaledVector(v, T).addScaledVector(w, T * T / 3));
        }
        return rowsSurface(s, inU, rows, [0, T], [4, 4], 3);
    }
    // How deep inside the side `distance` reaches, along the middle of it.
    const ok = inU ? [s.VKnot(1), s.VKnot(s.NbVKnots())] : [s.UKnot(1), s.UKnot(s.NbUKnots())];
    const mid = (ok[0] + ok[1]) / 2, N = 1024;
    const at_ = t => v3(inU ? s.Value(t, mid) : s.Value(mid, t));
    let run = 0, depth = -1, last = at_(at);
    for (let i = 1; i <= N && depth < 0; i++) {
        const t = after ? b - (b - a) * i / N : a + (b - a) * i / N;
        const here = at_(t), step = last.distanceTo(here);
        if (run + step >= distance) depth = Math.abs(t - at) - (b - a) / N * (1 - (distance - run) / Math.max(step, 1e-300));
        run += step;
        last = here;
    }
    if (depth <= 0) throw new Error(`reflective mirrors the sheet itself, which is only ${+run.toPrecision(3)} mm across there; extend less`);
    const strip = new o.Geom_BSplineSurface(s);
    const [lo, hi] = after ? [b - depth, b] : [a, a + depth];
    if (inU) strip.Segment(lo, hi, ok[0], ok[1], 1e-9, 1e-9); else strip.Segment(ok[0], ok[1], lo, hi, 1e-9, 1e-9);
    const g = grid(strip);
    const edgeRow = after ? g.P[g.n - 1] : g.P[0];
    const order = after ? [...g.P].reverse() : g.P;
    const rows = order.map(row => row.map((q, j) => edgeRow[j].clone().multiplyScalar(2).sub(q)));
    const ks = (after ? [...g.knots].reverse() : g.knots).map(k => Math.abs(k - at));
    const ms = after ? [...g.mults].reverse() : g.mults;
    return rowsSurface(s, inU, rows, ks, ms, p);
}

/**
 * Sheet `shape` grown `distance` past its open edge number `n`: `natural` is the shape's name
 * ('linear', 'natural', 'soft' or 'reflective'), or true for Natural and false for Linear. Linear goes
 * straight on, Natural follows the surface's curvature, Soft and Reflective add a face of their own
 * (see extensionFace); throws saying why when it cannot be.
 */
export function extendSheet(shape, n, distance, natural = false) {
    const kind = typeof natural === 'string' ? natural : natural ? 'natural' : 'linear';
    if (!['linear', 'natural', 'soft', 'reflective'].includes(kind)) throw new Error('that is not an extension shape');
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
        if ((kind === 'soft' || kind === 'reflective') && side >= 0 && untrimmed) {
            const mk = new o.BRepBuilderAPI_MakeFace(extensionFace(s, side, distance, kind === 'reflective'), 1e-7);
            if (!mk.IsDone()) throw new Error('the extension could not be made into a face');
            const sew = new o.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);
            sew.Add(shape);
            sew.Add(mk.Face());
            sew.Perform(new o.Message_ProgressRange());
            const result = sew.SewedShape();
            const shared = x => numberedEdges(x).filter(e => numbered(x, 'TopAbs_FACE').filter(f => numberedEdges(f).some(g => g.IsSame(e))).length === 2).length;
            if (shared(result) !== shared(shape) + 1) throw new Error('the extension could not be joined to the sheet');
            if (!new o.BRepCheck_Analyzer(result, true, false, false).IsValid()) throw new Error('the extended sheet is not valid; try a shorter distance');
            return result;
        }
        if (side >= 0 && untrimmed) {
            if (s.IsURational() || s.IsVRational()) throw new Error('this build extends polynomial sheets only; the desktop app extends this one');
            const mk = new o.BRepBuilderAPI_MakeFace(extendBSpline(s, side, distance, kind === 'natural'), 1e-7);
            if (!mk.IsDone()) throw new Error('the extended surface could not be made into a face');
            grown = mk.Face();
            if (face.Orientation() === o.TopAbs_Orientation.TopAbs_REVERSED) grown.Reverse();
        }
    }
    if (!grown) {
        // A flat sheet has no curvature to keep or mirror: Soft and Reflective carry it straight on.
        if ((kind === 'soft' || kind === 'reflective') && ad.GetType() !== o.GeomAbs_SurfaceType.GeomAbs_Plane) throw new Error("soft and reflective extend a side of the sheet's surface; that edge is trimmed across it");
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

/**
 * Extend Sheet's Limit (Plasticity's Minimal), as w3d_extend_sheet_to does it on the desktop: sheet
 * `shape` carried on past its open edge `n` in shape `kind` until it first meets `target`. The sheet
 * is extended well past the target, split by it, and the pieces reached from the edge without
 * crossing the target are kept.
 */
export function extendSheetTo(shape, n, target, kind = 'natural') {
    const o = oc();
    if (kind === 'reflective') throw new Error("reflective mirrors only as much sheet as there is, so it can't reach to a body; pick another shape");
    const edge = numberedEdges(shape)[n];
    if (!edge) throw new Error('that edge no longer exists');
    const along = new o.BRepAdaptor_Curve(edge);
    const mid = new o.BRepBuilderAPI_MakeVertex(along.Value((along.FirstParameter() + along.LastParameter()) / 2)).Shape();
    const box = new o.Bnd_Box();
    o.BRepBndLib.Add(shape, box, false);
    o.BRepBndLib.Add(target, box, false);
    const far = Math.sqrt(box.SquareExtent()) * 1.5;
    let grown;
    try { grown = extendSheet(shape, n, far, kind); } catch { throw new Error("the sheet can't be carried on as far as that body in this shape; try Linear"); }
    const args = new o.NCollection_List_TopoDS_Shape(), tools = new o.NCollection_List_TopoDS_Shape();
    args.Append(grown);
    tools.Append(target);
    const split = new o.BRepAlgoAPI_Splitter();
    split.SetArguments(args);
    split.SetTools(tools);
    split.Build(new o.Message_ProgressRange());
    if (!split.IsDone() || split.HasErrors()) throw new Error('the extension could not be cut at that body');
    const near = (a, b, tol) => { const d = new o.BRepExtrema_DistShapeShape(a, b); return d.IsDone() && d.Value() < tol; };
    const faces = numbered(split.Shape(), 'TopAbs_FACE').map(f => o.TopoDS.Face(f));
    const edgesOf = faces.map(f => numberedEdges(f));
    const meets = new Map();
    const onTarget = e => {
        for (const [k, v] of meets) if (k.IsSame(e)) return v;
        let on = false;
        if (!o.BRep_Tool.Degenerated(e)) {
            const c = new o.BRepAdaptor_Curve(e);
            on = near(new o.BRepBuilderAPI_MakeVertex(c.Value((c.FirstParameter() + c.LastParameter()) / 2)).Shape(), target, 1e-5);
        }
        meets.set(e, on);
        return on;
    };
    const keep = faces.map(f => near(mid, f, 1e-6));
    const todo = keep.flatMap((k, i) => k ? [i] : []);
    if (!todo.length) throw new Error('the extension lost track of its edge');
    let reached = false;
    while (todo.length) {
        const f = todo.pop();
        for (const e of edgesOf[f]) {
            if (onTarget(e)) { reached = true; continue; }
            edgesOf.forEach((es, g) => {
                if (!keep[g] && es.some(x => x.IsSame(e))) { keep[g] = true; todo.push(g); }
            });
        }
    }
    if (!reached) throw new Error('the extension never meets that body; pick a body the edge points at');
    const sew = new o.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);
    faces.forEach((f, i) => keep[i] && sew.Add(f));
    sew.Perform(new o.Message_ProgressRange());
    const result = sew.SewedShape();
    if (!new o.BRepCheck_Analyzer(result, true, false, false).IsValid()) throw new Error('the extended sheet is not valid');
    return result;
}
