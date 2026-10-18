// Plasticity's Rebuild Face in the browser build, as w3d_rebuild_faces does it on the desktop: each
// face given a new polynomial B-spline surface fitted to its old one, keeping the parameters, so its
// edges and trims stay where they were. Explicit control fits a set degree and number of spans;
// Tolerance fits degree 3 with as few uniform spans as keep the face within the tolerance.
//
// The browser's OpenCascade has no BRep_Builder to hang the new surface under the old edges, so the
// face is made again: from its parameter bounds when its edges run along them (a Patch, Bridge or
// Loft sheet, a cylinder's wall, a sphere), else from its edges' curves on the new surface; then it
// is sewn back among the body's other faces.

import { numbered, numberedEdges, oc } from './Kernel.js';
import { extendBSpline, isoSide } from './ExtendSheet.js';

/** All `n` B-spline basis functions of degree `p` on the clamped knots `T` at `t` (Cox-de Boor). */
function basis(T, p, n, t) {
    const N = new Array(n).fill(0);
    let k = p;
    if (t >= T[n]) k = n - 1;
    else while (k < n - 1 && t >= T[k + 1]) k++;
    const b = new Array(p + 1).fill(0), left = new Array(p + 1), right = new Array(p + 1);
    b[0] = 1;
    for (let j = 1; j <= p; j++) {
        left[j] = t - T[k + 1 - j];
        right[j] = T[k + j] - t;
        let saved = 0;
        for (let r = 0; r < j; r++) {
            const tmp = b[r] / (right[r + 1] + left[j - r]);
            b[r] = saved + right[r + 1] * tmp;
            saved = left[j - r] * tmp;
        }
        b[j] = saved;
    }
    for (let j = 0; j <= p; j++) N[k - p + j] = b[j];
    return N;
}

/**
 * The least-squares fit of `n` poles of degree `p` (knots `T` over [a, b]) to `m` values at uniform
 * parameters, the end poles held at the end values: the n x m matrix taking values to poles.
 */
function fitMatrix(T, p, n, m, a, b) {
    const A = Array.from({ length: m }, (_, i) => basis(T, p, n, a + (b - a) * i / (m - 1)));
    const F = Array.from({ length: n }, () => new Array(m).fill(0));
    F[0][0] = 1;
    F[n - 1][m - 1] = 1;
    const k = n - 2;
    if (k <= 0) return F;
    const M = Array.from({ length: k }, () => new Array(k).fill(0));
    const R = Array.from({ length: k }, () => new Array(m).fill(0));
    for (let i = 1; i < m - 1; i++) {
        for (let r = 0; r < k; r++) {
            const w = A[i][r + 1];
            if (w === 0) continue;
            for (let c = 0; c < k; c++) M[r][c] += w * A[i][c + 1];
            R[r][i] += w;
            R[r][0] -= w * A[i][0];
            R[r][m - 1] -= w * A[i][n - 1];
        }
    }
    for (let col = 0; col < k; col++) {
        let piv = col;
        for (let r = col + 1; r < k; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
        if (Math.abs(M[piv][col]) < 1e-14) throw new Error('too many control points for the face; use fewer spans');
        [M[col], M[piv]] = [M[piv], M[col]];
        [R[col], R[piv]] = [R[piv], R[col]];
        for (let r = 0; r < k; r++) {
            if (r === col) continue;
            const f = M[r][col] / M[col][col];
            if (f === 0) continue;
            for (let c = col; c < k; c++) M[r][c] -= f * M[col][c];
            for (let c = 0; c < m; c++) R[r][c] -= f * R[col][c];
        }
    }
    for (let r = 0; r < k; r++) for (let c = 0; c < m; c++) F[r + 1][c] = R[r][c] / M[r][r];
    return F;
}

/** `at(u, v)` (an [x, y, z]) over [u0, u1] x [v0, v1] refitted as a B-spline of degree (du, dv) with (su, sv) spans. */
export function refit(at, [u0, u1, v0, v1], [du, dv], [su, sv]) {
    const o = oc();
    const knots = (p, s, a, b) => [...Array(p + 1).fill(a), ...Array.from({ length: s - 1 }, (_, i) => a + (b - a) * (i + 1) / s), ...Array(p + 1).fill(b)];
    const nu = su + du, nv = sv + dv, mu = 4 * su + du + 1, mv = 4 * sv + dv + 1;
    const Fu = fitMatrix(knots(du, su, u0, u1), du, nu, mu, u0, u1), Fv = fitMatrix(knots(dv, sv, v0, v1), dv, nv, mv, v0, v1);
    const G = Array.from({ length: mu }, (_, i) => Array.from({ length: mv }, (_, j) => at(u0 + (u1 - u0) * i / (mu - 1), v0 + (v1 - v0) * j / (mv - 1))));
    const C = G.map(row => Fv.map(f => [0, 1, 2].map(x => row.reduce((t, q, j) => t + q[x] * f[j], 0))));
    const poles = new o.NCollection_Array2_gp_Pnt(1, nu, 1, nv);
    Fu.forEach((f, r) => {
        for (let c = 0; c < nv; c++) {
            const [x, y, z] = [0, 1, 2].map(a => C.reduce((t, row, i) => t + row[c][a] * f[i], 0));
            poles.SetValue(r + 1, c + 1, new o.gp_Pnt(x, y, z));
        }
    });
    const arr = (vals, Type) => { const a = new Type(1, vals.length); vals.forEach((v, i) => a.SetValue(i + 1, v)); return a; };
    const ks = (s, a, b) => Array.from({ length: s + 1 }, (_, i) => a + (b - a) * i / s);
    const ms = (s, p) => Array.from({ length: s + 1 }, (_, i) => (i === 0 || i === s) ? p + 1 : 1);
    return new o.Geom_BSplineSurface(poles, arr(ks(su, u0, u1), o.NCollection_Array1_double), arr(ks(sv, v0, v1), o.NCollection_Array1_double),
        arr(ms(su, du), o.NCollection_Array1_int), arr(ms(sv, dv), o.NCollection_Array1_int), du, dv, false, false);
}

const STEPS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48];
const xyz = p => [p.X(), p.Y(), p.Z()];
const far = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The furthest `s` strays from `at` over [u0, u1] x [v0, v1], sampled n x n. */
function deviation(at, s, [u0, u1, v0, v1], n = 24) {
    let worst = 0;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
        const u = u0 + (u1 - u0) * i / n, v = v0 + (v1 - v0) * j / n;
        worst = Math.max(worst, far(at(u, v), xyz(s.Value(u, v))));
    }
    return worst;
}

/** The face again on `made`: from its bounds `b` if its edges run along them, else from its edges' curves on `made`. */
function remade(face, made, b) {
    const o = oc();
    const surface = o.BRep_Tool.Surface(face);
    const along = numberedEdges(face).every(e => o.BRep_Tool.Degenerated(e) || isoSide(e, face, surface, b) >= 0);
    let f;
    if (along) {
        const mk = new o.BRepBuilderAPI_MakeFace(made, b[0], b[1], b[2], b[3], 1e-7);
        if (!mk.IsDone()) throw new Error('the rebuilt surface could not be made into a face');
        f = mk.Face();
    } else {
        const fwd = o.TopoDS.Face(face.Oriented(o.TopAbs_Orientation.TopAbs_FORWARD));
        let mk = null;
        for (const w of numbered(fwd, 'TopAbs_WIRE')) {
            const wire = new o.BRepBuilderAPI_MakeWire();
            for (const ex = new o.TopExp_Explorer(w, o.TopAbs_ShapeEnum.TopAbs_EDGE, o.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
                const e = o.TopoDS.Edge(ex.Current());
                if (o.BRep_Tool.IsClosed(e, fwd)) throw new Error('this build rebuilds a trimmed face only where it has no seam; the desktop app rebuilds this one');
                const pc = new o.BRepAdaptor_Curve2d(e, fwd);
                const me = new o.BRepBuilderAPI_MakeEdge(pc.Curve(), made, pc.FirstParameter(), pc.LastParameter());
                if (!me.IsDone()) throw new Error('an edge of that face could not be laid on the rebuilt surface');
                let ne = me.Edge();
                // MakeEdge runs the edge forward along its curve; the wire wanted it as `e` runs.
                if (e.Orientation() === o.TopAbs_Orientation.TopAbs_REVERSED) ne = o.TopoDS.Edge(ne.Reversed());
                o.BRepLib.BuildCurves3d(ne);
                wire.Add(ne);
                if (!wire.IsDone()) throw new Error("the face's edges could not be joined on the rebuilt surface");
            }
            if (!mk) mk = new o.BRepBuilderAPI_MakeFace(made, wire.Wire(), true);
            else mk.Add(wire.Wire());
        }
        if (!mk?.IsDone()) throw new Error('the rebuilt surface could not be made into a face');
        f = mk.Face();
    }
    if (face.Orientation() === o.TopAbs_Orientation.TopAbs_REVERSED) f.Reverse();
    return f;
}

/** `shape` with the faces in `replaced` (by number) swapped in: the lone face, or all faces sewn within `gap` (a solid again if it was one). */
function assemble(shape, all, replaced, gap, what, hint = '') {
    const o = oc();
    let result;
    if (shape.ShapeType() === o.TopAbs_ShapeEnum.TopAbs_FACE) result = replaced.get(0);
    else {
        const sew = new o.BRepBuilderAPI_Sewing(gap, true, true, true, false);
        all.forEach((f, i) => sew.Add(replaced.get(i) ?? f));
        sew.Perform(new o.Message_ProgressRange());
        result = sew.SewedShape();
        if (!numbered(result, 'TopAbs_SHELL').length) {
            // One face sews to itself: hold it in a shell, as the body held it.
            const tb = new o.TopoDS_Builder(), shell = new o.TopoDS_Shell();
            tb.MakeShell(shell);
            for (const f of numbered(result, 'TopAbs_FACE')) tb.Add(shell, f);
            shell.Closed(o.BRep_Tool.IsClosed(shell));
            result = shell;
        }
        const solid = numbered(shape, 'TopAbs_SOLID').length > 0;
        const shells = numbered(result, 'TopAbs_SHELL');
        if (solid) {
            if (shells.length !== 1 || !o.BRep_Tool.IsClosed(shells[0])) throw new Error(`${what} no longer closes the solid; try a tighter tolerance`);
            const mk = new o.BRepBuilderAPI_MakeSolid(o.TopoDS.Shell(shells[0]));
            if (!mk.IsDone()) throw new Error(`${what} no longer closes the solid; try a tighter tolerance`);
            result = mk.Solid();
            o.BRepLib.OrientClosedSolid(result);
        }
    }
    if (!new o.BRepCheck_Analyzer(result, true, false, false).IsValid()) throw new Error(`${what} is not valid${hint}`);
    return result;
}

/**
 * `shape` with `faces` rebuilt; `how` as FaceRebuild on the desktop: { explicit, degree: [u, v],
 * spans: [u, v], tolerance, extend: [u, v] (mm past both sides), shrink }. Returns the new shape and,
 * per face, its degree, pole counts and furthest deviation from the old surface.
 */
export function rebuildFaces(shape, faces, how = {}) {
    const o = oc();
    const { explicit = false, degree = [3, 3], spans = [4, 4], tolerance = 0.01, extend = [0, 0], shrink = true } = how;
    if (!faces?.length) throw new Error('select the faces to rebuild');
    if (explicit && !degree.every(d => Number.isInteger(d) && d >= 1 && d <= 9)) throw new Error('the degree must be 1 to 9');
    if (explicit && !spans.every(s => Number.isInteger(s) && s >= 1 && s <= 64)) throw new Error('the spans must be 1 to 64');
    if (!explicit && !(tolerance > 0)) throw new Error('the tolerance must be above zero');
    if (!extend.every(e => e >= 0)) throw new Error('extend must be zero or more');
    const all = numbered(shape, 'TopAbs_FACE').map(f => o.TopoDS.Face(f));
    const out = [], replaced = new Map();
    // Sewing gap: the rebuilt face may stand off its neighbours by its deviation, and edges remade
    // from curves on it by their 3D approximation (well inside the 0.01 mm bar).
    let gap = 1e-4;
    for (const n of faces) {
        const face = all[n];
        if (!face) throw new Error('that face no longer exists');
        const ad = new o.BRepAdaptor_Surface(face, true);
        const at = (u, v) => xyz(ad.Value(u, v));
        const { UMin, UMax, VMin, VMax } = o.BRepTools.UVBounds(face, 0, 0, 0, 0);
        const own = [UMin, UMax, VMin, VMax];
        const b = [...own];
        if (!shrink) {
            const whole = new o.BRepAdaptor_Surface(face, false);
            const [a0, a1, b0, b1] = [whole.FirstUParameter(), whole.LastUParameter(), whole.FirstVParameter(), whole.LastVParameter()];
            if (Math.abs(a0) < 1e50 && Math.abs(a1) < 1e50) { b[0] = Math.min(a0, UMin); b[1] = Math.max(a1, UMax); }
            if (Math.abs(b0) < 1e50 && Math.abs(b1) < 1e50) { b[2] = Math.min(b0, VMin); b[3] = Math.max(b1, VMax); }
        }
        if (!(b[1] - b[0] > 1e-12) || !(b[3] - b[2] > 1e-12)) throw new Error('that face has no area to rebuild');
        let made;
        if (explicit) made = refit(at, b, degree, spans);
        else for (const k of STEPS) {
            made = refit(at, b, [3, 3], [k, k]);
            if (deviation(at, made, own) <= tolerance) break;
        }
        for (let side = 0; side < 4; side++) {
            const by = extend[side < 2 ? 0 : 1];
            if (by > 0 && !(side < 2 ? ad.IsUClosed() : ad.IsVClosed())) made = extendBSpline(made, side, by);
        }
        const dev = deviation(at, made, own, 48);
        gap = Math.max(gap, dev * 1.5 + 1e-4);
        replaced.set(n, remade(face, made, own));
        out.push({ face: n, degree: [made.UDegree(), made.VDegree()], poles: [made.NbUPoles(), made.NbVPoles()], deviation: dev });
    }
    return { shape: assemble(shape, all, replaced, gap, 'the rebuilt face', '; try more spans or a higher degree'), rebuilt: out };
}

/**
 * Plasticity's Raise Surface Degree, as w3d_raise_faces: each of `faces` (all of them when empty)
 * with its U and V degree raised by one, which adds control points without changing its shape. A
 * face that isn't a B-spline is first fitted as one, degree 3, within 1e-3 mm.
 */
export function raiseFaces(shape, faces = []) {
    const o = oc();
    const all = numbered(shape, 'TopAbs_FACE').map(f => o.TopoDS.Face(f));
    const which = faces.length ? faces : all.map((_, i) => i);
    const out = [], replaced = new Map();
    let gap = 1e-4;
    for (const n of which) {
        const face = all[n];
        if (!face) throw new Error('that face no longer exists');
        const ad = new o.BRepAdaptor_Surface(face, true);
        const at = (u, v) => xyz(ad.Value(u, v));
        const { UMin, UMax, VMin, VMax } = o.BRepTools.UVBounds(face, 0, 0, 0, 0);
        const own = [UMin, UMax, VMin, VMax];
        let made;
        if (ad.GetType() === o.GeomAbs_SurfaceType.GeomAbs_BSplineSurface) made = new o.Geom_BSplineSurface(ad.BSpline());
        else for (const k of STEPS) {
            made = refit(at, own, [3, 3], [k, k]);
            if (deviation(at, made, own) <= 1e-3) break;
        }
        if (made.UDegree() >= 25 && made.VDegree() >= 25) throw new Error('that face is already at the highest degree');
        made.IncreaseDegree(Math.min(made.UDegree() + 1, 25), Math.min(made.VDegree() + 1, 25));
        const dev = deviation(at, made, own, 48);
        gap = Math.max(gap, dev * 1.5 + 1e-4);
        replaced.set(n, remade(face, made, own));
        out.push({ face: n, degree: [made.UDegree(), made.VDegree()], poles: [made.NbUPoles(), made.NbVPoles()], deviation: dev });
    }
    return { shape: assemble(shape, all, replaced, gap, 'the raised face'), rebuilt: out };
}
