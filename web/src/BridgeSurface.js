// Plasticity's Bridge Surface in the browser build, as w3d_bridge_surface does it on the desktop: a
// sheet from one body edge to another, leaving each tangent to its face. Four rows of points (the
// two edges and, between, each carried out along its face by a third of the gap times the tension)
// are fitted through the same parameters, so they share knots and make a cubic-across B-spline sheet.

import * as THREE from 'three';
import { numberedEdges, oc } from './Kernel.js';
import { faceBeside } from './Patch.js';

const N = 48;

const v3 = p => new THREE.Vector3(p.X(), p.Y(), p.Z());

/** Points along edge `n` of `shape` and the way out of its face at each, `n` + 1 of them (`n` for a closed edge). */
function side(shape, n, shift = 0, backwards = false, count = N) {
    const o = oc();
    const edge = numberedEdges(shape)[n];
    if (!edge) throw new Error('that edge no longer exists');
    const face = faceBeside(shape, edge, 'bridge edges of sheets or solids; a loose edge has no face to leave');
    // The edge as the face's wire runs it: the face lies on its left.
    let inFace = edge;
    for (const ex = new o.TopExp_Explorer(face, o.TopAbs_ShapeEnum.TopAbs_EDGE, o.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
        if (ex.Current().IsSame(edge)) { inFace = o.TopoDS.Edge(ex.Current()); break; }
    }
    const reversed = inFace.Orientation() === o.TopAbs_Orientation.TopAbs_REVERSED;
    const curve = new o.BRepAdaptor_Curve(inFace);
    // Where each point sits on the face's surface (the browser build lacks the edge's own curve on it).
    const surface = o.BRep_Tool.Surface(face);
    const props = new o.BRepGProp_Face(face, false);
    const a = curve.FirstParameter(), b = curve.LastParameter();
    const closed = v3(curve.Value(a)).distanceTo(v3(curve.Value(b))) < 1e-7;
    const at = [], out = [];
    for (let i = 0; i < (closed ? count : count + 1); i++) {
        let s = closed ? ((i / count + shift) % 1 + 1) % 1 : i / count;
        if (backwards) s = closed ? ((1 - s) % 1 + 1) % 1 : 1 - s;
        const t = a + (b - a) * s;
        const p = new o.gp_Pnt(), d = new o.gp_Vec();
        curve.D1(t, p, d);
        if (reversed) d.Reverse();
        const pr = new o.GeomAPI_ProjectPointOnSurf(p, surface, o.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad);
        if (!pr.NbPoints()) throw new Error('that edge is not on its face');
        const { U, V } = pr.LowerDistanceParameters(0, 0);
        const on = new o.gp_Pnt(), normal = new o.gp_Vec();
        props.Normal(U, V, on, normal);
        const way = v3(d).cross(v3(normal));
        if (way.length() < 1e-12) throw new Error('the face is degenerate along that edge');
        at.push(v3(p));
        out.push(way.normalize());
    }
    return { at, out, closed };
}

/** The sheet bridging edge `a.n` of `a.shape` to edge `b.n` of `b.shape`, tangent to their faces. */
export function bridgeSurface(a, b, tension = 1) {
    const o = oc();
    if (a.shape === b.shape && a.n === b.n) throw new Error('select two different edges');
    if (!(tension > 0)) throw new Error('the tension must be above zero');
    const A = side(a.shape, a.n);
    let B = side(b.shape, b.n);
    if (A.closed !== B.closed) throw new Error('bridge two open edges or two closed ones');
    let backwards = false, shift = 0;
    if (!A.closed) {
        const [a0, a1, b0, b1] = [A.at[0], A.at.at(-1), B.at[0], B.at.at(-1)];
        backwards = a0.distanceTo(b0) + a1.distanceTo(b1) > a0.distanceTo(b1) + a1.distanceTo(b0);
    } else {
        // Start B where it is nearest A's start, then run it the way that keeps them together.
        const fine = side(b.shape, b.n, 0, false, 720);
        let best = 0;
        fine.at.forEach((p, i) => { if (p.distanceTo(A.at[0]) < fine.at[best].distanceTo(A.at[0])) best = i; });
        shift = best / 720;
        const gap = s => s.at.reduce((d, p, i) => d + p.distanceTo(A.at[i]), 0);
        backwards = gap(side(b.shape, b.n, 1 - shift, true)) < gap(side(b.shape, b.n, shift));
        if (backwards) shift = 1 - shift;
    }
    B = side(b.shape, b.n, shift, backwards);
    // Four rows; a closed pair repeats its first points at the end with matching seam tangents.
    const k = A.at.length, m = A.closed ? k + 1 : k;
    const rows = [[], [], [], []];
    for (let i = 0; i < k; i++) {
        const h = tension * A.at[i].distanceTo(B.at[i]) / 3;
        rows[0].push(A.at[i]);
        rows[1].push(A.at[i].clone().addScaledVector(A.out[i], h));
        rows[2].push(B.at[i].clone().addScaledVector(B.out[i], h));
        rows[3].push(B.at[i]);
    }
    const params = new o.NCollection_Array1_double(1, m);
    for (let i = 0; i < m; i++) params.SetValue(i + 1, i / (m - 1));
    const fits = rows.map(row => {
        const pts = new o.NCollection_Array1_gp_Pnt(1, m);
        for (let i = 0; i < m; i++) { const p = row[i % k]; pts.SetValue(i + 1, new o.gp_Pnt(p.x, p.y, p.z)); }
        const fit = new o.GeomAPI_Interpolate(new o.NCollection_HArray1_gp_Pnt(pts), new o.NCollection_HArray1_double(params), false, 1e-9);
        if (A.closed) {
            const seam = row[1].clone().sub(row[k - 1]).multiplyScalar((m - 1) / 2);
            const v = new o.gp_Vec(seam.x, seam.y, seam.z);
            fit.Load(v, v, false);
        }
        fit.Perform();
        if (!fit.IsDone()) throw new Error('the bridge could not be fitted between those edges');
        return fit.Curve();
    });
    const c0 = fits[0], np = c0.NbPoles();
    if (fits.some(f => f.NbPoles() !== np)) throw new Error("the bridge's rows do not match");
    const poles = new o.NCollection_Array2_gp_Pnt(1, np, 1, 4);
    fits.forEach((f, j) => { for (let i = 1; i <= np; i++) poles.SetValue(i, j + 1, f.Pole(i)); });
    const nk = c0.NbKnots();
    const uk = new o.NCollection_Array1_double(1, nk), um = new o.NCollection_Array1_int(1, nk);
    for (let i = 1; i <= nk; i++) { uk.SetValue(i, c0.Knot(i)); um.SetValue(i, c0.Multiplicity(i)); }
    const vk = new o.NCollection_Array1_double(1, 2), vm = new o.NCollection_Array1_int(1, 2);
    vk.SetValue(1, 0); vk.SetValue(2, 1); vm.SetValue(1, 4); vm.SetValue(2, 4);
    const surf = new o.Geom_BSplineSurface(poles, uk, vk, um, vm, c0.Degree(), 3, false, false);
    const mk = new o.BRepBuilderAPI_MakeFace(surf, 1e-6);
    if (!mk.IsDone()) throw new Error('the bridge could not be made into a face');
    return mk.Face();
}
