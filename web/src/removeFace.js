// Plasticity's Remove Face in the browser build, for faces whose neighbours are all flat (the
// desktop uses OCCT's defeaturing, which opencascade.js lacks). Each connected run of removed faces
// is closed by the planes of its neighbours, extended until they meet: the cell those planes bound
// on the run's side, kept to the piece that meets the run, is added to the body when the run lies
// inside every neighbour (a round on an outside corner, a hole) and taken away when it lies outside
// any (a round in an inside corner).

import { blendEdges, bounds, numbered, numberedEdges, oc, planeSheet, unifyWithHistory } from './Kernel.js';

const v = p => [p.X(), p.Y(), p.Z()];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => a.map((x, k) => x - b[k]);

/** The body with faces `faces` (numbers in TopExp order) removed and the gaps closed. */
export function removeFaces(shape, faces) {
    const o = oc();
    const all = numbered(shape, 'TopAbs_FACE').map(f => o.TopoDS.Face(f));
    if (!faces.length) throw new Error('select the faces to remove');
    if (faces.some(n => !all[n])) throw new Error('a face in the selection is not on this body; select the faces again');
    if (faces.length >= all.length) throw new Error('that would remove the whole body');
    const edgesOf = all.map(f => numberedEdges(f));
    const touch = (a, b) => edgesOf[a].some(e => edgesOf[b].some(g => g.IsSame(e)));
    // The removed faces in connected runs.
    const runs = [], left = new Set(faces);
    while (left.size) {
        const run = [left.values().next().value];
        left.delete(run[0]);
        for (let i = 0; i < run.length; i++) for (const n of [...left]) if (touch(run[i], n)) { run.push(n); left.delete(n); }
        runs.push(run);
    }
    const box = bounds(shape), size = box.getSize(new (box.min.constructor)()).length() || 1;
    const centre = box.getCenter(new (box.min.constructor)()).toArray();
    const reach = 4 * size, tol = 1e-6 * size;
    const fills = [], cuts = [];
    for (const run of runs) {
        const samples = run.map(n => mid(all[n]));
        const neighbours = all.map((_, n) => n).filter(n => !run.includes(n) && run.some(r => touch(r, n)));
        if (!neighbours.length) throw new Error('a removed face has no neighbours to close the gap');
        // Each neighbour's plane, outward normal and the side the run lies on.
        let inside = true;
        let cell = new o.BRepPrimAPI_MakeBox(new o.gp_Pnt(...box.min.toArray().map(x => x - size)), new o.gp_Pnt(...box.max.toArray().map(x => x + size))).Shape();
        for (const n of neighbours) {
            const s = new o.BRepAdaptor_Surface(all[n], true);
            if (s.GetType() !== o.GeomAbs_SurfaceType.GeomAbs_Plane) throw new Error('in the browser, Remove Face closes gaps between flat faces only; the desktop app does the rest');
            const pln = s.Plane(), ax = pln.Axis().Direction();
            const at = v(pln.Location());
            let normal = v(ax);
            if (all[n].Orientation() === o.TopAbs_Orientation.TopAbs_REVERSED) normal = normal.map(x => -x);
            const side = samples.map(p => dot(sub(p, at), normal));
            const out = side.filter(d => d > tol).length, inn = side.filter(d => d < -tol).length;
            if (out && inn) throw new Error('the removed faces lie on both sides of a neighbour; remove fewer at once');
            if (!out && !inn) continue;
            if (out) inside = false;
            // Away with the half the run is not on: the plane swept off that way.
            const away = out ? normal.map(x => -x) : normal;
            const foot = sub(centre, normal.map(x => x * dot(sub(centre, at), normal)));
            const slab = new o.BRepPrimAPI_MakePrism(planeSheet(foot, normal, reach), new o.gp_Vec(...away.map(x => x * reach)), false, true).Shape();
            cell = run_(new o.BRepAlgoAPI_Cut(cell, slab, new o.Message_ProgressRange()));
        }
        // The part of the cell beside the run: air to fill, or body to take away.
        const pieces = numbered(run_(inside ? new o.BRepAlgoAPI_Cut(cell, shape, new o.Message_ProgressRange()) : new o.BRepAlgoAPI_Common(cell, shape, new o.Message_ProgressRange())), 'TopAbs_SOLID');
        const marks = samples.map(p => new o.BRepBuilderAPI_MakeVertex(new o.gp_Pnt(...p)).Shape());
        const near = pieces.filter(p => marks.some(m => { const d = new o.BRepExtrema_DistShapeShape(m, p); return d.IsDone() && d.Value() < 1e-4 * size; }));
        // A piece running out to the cell's outer box is not closed by the neighbours (a box with its
        // top removed would grow up to it), so there is nothing sound to fill.
        const lo = box.min.toArray().map(x => x - size + 1e-3 * size), hi = box.max.toArray().map(x => x + size - 1e-3 * size);
        const open = near.some(p => { const b = bounds(p); return [0, 1, 2].some(k => b.min.getComponent(k) < lo[k] || b.max.getComponent(k) > hi[k]); });
        if (!near.length || open) throw new Error('the neighbours of those faces do not close round them');
        (inside ? fills : cuts).push(...near);
    }
    let result = shape;
    for (const p of fills) result = run_(new o.BRepAlgoAPI_Fuse(result, p, new o.Message_ProgressRange()));
    for (const p of cuts) result = run_(new o.BRepAlgoAPI_Cut(result, p, new o.Message_ProgressRange()));
    const { shape: merged } = unifyWithHistory(result);
    if (numbered(merged, 'TopAbs_SOLID').length !== numbered(shape, 'TopAbs_SOLID').length) throw new Error('removing those faces splits the body');
    return merged;
}

function run_(algo) {
    if (!algo.IsDone() || algo.HasErrors()) throw new Error('the kernel could not close the gap');
    return algo.Shape();
}

/** A point on a face: its centre of area brought onto it, or the middle of its parameters. */
function mid(face) {
    const o = oc();
    const props = new o.GProp_GProps();
    o.BRepGProp.SurfaceProperties(face, props, false, false);
    const pr = new o.GeomAPI_ProjectPointOnSurf(props.CentreOfMass(), o.BRep_Tool.Surface(face), o.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad);
    if (pr.NbPoints()) {
        const p = pr.NearestPoint();
        const d = new o.BRepExtrema_DistShapeShape(new o.BRepBuilderAPI_MakeVertex(p).Shape(), face);
        if (d.IsDone() && d.Value() < 1e-7) return v(p);
    }
    const { UMin, UMax, VMin, VMax } = o.BRepTools.UVBounds(face, 0, 0, 0, 0);
    return v(new o.BRepAdaptor_Surface(face, true).Value((UMin + UMax) / 2, (VMin + VMax) / 2));
}

/**
 * Numbers of the faces that look like fillets, as w3d_fillet_faces on the desktop: curved faces
 * running smoothly into at least two others. A curved face whose smooth neighbours are all curved
 * counts only when it is no wider than they are (a corner ball counts; a cylinder rounded at both
 * ends does not). With `seeds`, only the fillet chains (fillets meeting smoothly) holding them.
 */
export function filletFaces(shape, seeds = []) {
    const o = oc();
    const all = numbered(shape, 'TopAbs_FACE').map(f => o.TopoDS.Face(f));
    const n = all.length;
    const ads = all.map(f => new o.BRepAdaptor_Surface(f, true));
    const T = o.GeomAbs_SurfaceType;
    const curved = ads.map(s => s.GetType() !== T.GeomAbs_Plane);
    const radius = i => {
        const s = ads[i], t = s.GetType();
        return t === T.GeomAbs_Cylinder ? s.Cylinder().Radius() : t === T.GeomAbs_Sphere ? s.Sphere().Radius() : t === T.GeomAbs_Torus ? s.Torus().MinorRadius() : -1;
    };
    const smooth = all.map(() => new Set());
    const edges = all.map(f => numberedEdges(f));
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
        if (sameSurface(ads[a], ads[b])) continue;
        for (const e of edges[a]) {
            if (o.BRep_Tool.Degenerated(e) || !edges[b].some(g => g.IsSame(e))) continue;
            if (tangentAlong(e, all[a], all[b])) { smooth[a].add(b); smooth[b].add(a); break; }
        }
    }
    const fillet = all.map((_, i) => {
        if (!curved[i] || smooth[i].size < 2) return false;
        let flat = false, least = Infinity;
        for (const j of smooth[i]) { if (!curved[j]) flat = true; const r = radius(j); if (r > 0) least = Math.min(least, r); }
        const r = radius(i);
        return flat || (r > 0 && r <= least + 1e-6);
    });
    const keep = all.map(() => !seeds.length);
    const todo = seeds.filter(s => fillet[s] && !keep[s]);
    for (const s of todo) keep[s] = true;
    while (todo.length) for (const j of smooth[todo.pop()]) if (fillet[j] && !keep[j]) { keep[j] = true; todo.push(j); }
    return all.map((_, i) => i).filter(i => fillet[i] && keep[i]);
}

/** Whether two faces meet without a crease along an edge they share: their normals agree along it. */
function tangentAlong(edge, fa, fb) {
    const o = oc();
    const c = new o.BRepAdaptor_Curve(edge), t0 = c.FirstParameter(), t1 = c.LastParameter();
    const normal = (face, t) => {
        const uv = new o.BRepAdaptor_Curve2d(edge, face).Value(t);
        const p = new o.gp_Pnt(), du = new o.gp_Vec(), dv = new o.gp_Vec();
        new o.BRepAdaptor_Surface(face, true).D1(uv.X(), uv.Y(), p, du, dv);
        const nn = du.Crossed(dv);
        if (nn.Magnitude() < 1e-12) return null;
        if (face.Orientation() === o.TopAbs_Orientation.TopAbs_REVERSED) nn.Reverse();
        return nn.Normalized();
    };
    for (const s of [0.25, 0.5, 0.75]) {
        const t = t0 + (t1 - t0) * s, a = normal(fa, t), b = normal(fb, t);
        if (!a || !b || a.Dot(b) < Math.cos(Math.PI / 180)) return false;
    }
    return true;
}

/** Whether two faces lie on one surface (two halves of a cylinder, say), for the analytic kinds. */
function sameSurface(a, b) {
    const o = oc(), T = o.GeomAbs_SurfaceType;
    if (a.GetType() !== b.GetType()) return false;
    const coaxial = (x, y) => x.IsCoaxial(y, 1e-6, 1e-6) || x.IsCoaxial(y.Reversed(), 1e-6, 1e-6);
    switch (a.GetType()) {
        case T.GeomAbs_Cylinder: return Math.abs(a.Cylinder().Radius() - b.Cylinder().Radius()) < 1e-6 && coaxial(a.Cylinder().Axis(), b.Cylinder().Axis());
        case T.GeomAbs_Sphere: return Math.abs(a.Sphere().Radius() - b.Sphere().Radius()) < 1e-6 && a.Sphere().Location().Distance(b.Sphere().Location()) < 1e-6;
        case T.GeomAbs_Torus: return Math.abs(a.Torus().MinorRadius() - b.Torus().MinorRadius()) < 1e-6 && Math.abs(a.Torus().MajorRadius() - b.Torus().MajorRadius()) < 1e-6 && coaxial(a.Torus().Axis(), b.Torus().Axis());
        case T.GeomAbs_Plane: return a.Plane().Position().IsCoplanar(b.Plane().Position(), 1e-6, 1e-6);
        default: return false;
    }
}

/**
 * Dimension on a fillet, as w3d_refillet: the fillet faces `faces` taken off (see removeFaces) and
 * the sharp edges that leaves rounded again at `radius`.
 */
export function refilletFaces(shape, faces, radius) {
    const o = oc();
    if (!(radius > 0)) throw new Error('a fillet needs a radius above zero');
    const sharp = removeFaces(shape, faces);
    // The new edges: those not lying along an edge the body had.
    const kept = numberedEdges(shape);
    const fresh = numberedEdges(sharp).map((e, n) => [e, n]).filter(([e]) => {
        const c = new o.BRepAdaptor_Curve(e), p = c.Value((c.FirstParameter() + c.LastParameter()) / 2);
        const at = new o.BRepBuilderAPI_MakeVertex(p).Shape();
        return !kept.some(k => { const d = new o.BRepExtrema_DistShapeShape(at, k); return d.IsDone() && d.Value() < 1e-6; });
    }).map(([, n]) => n);
    if (!fresh.length) throw new Error('taking the fillet off left no edge to round again');
    return blendEdges(sharp, fresh, radius);
}

/**
 * Dimension on a chamfer in the browser build: the corner filled back in and cut again `to` from
 * it. `corner` is a point on the line where the two faces beside the chamfer meet, `axis` that
 * line's direction, `sides` the unit directions across each face from it, `span` the run along
 * `axis` the chamfer covers and `size` its distance now (chamferDimensions in dimension.js).
 */
export function rechamfer(shape, { corner, axis, sides, span, size, to }) {
    const o = oc();
    if (!(to > 0)) throw new Error('a chamfer needs a distance above zero');
    const prism = d => {
        const at = (s, t) => new o.gp_Pnt(...corner.map((c, k) => c + axis[k] * span[0] + (s ? sides[s - 1][k] * t : 0)));
        const ps = [at(0, 0), at(1, d), at(2, d)], mk = new o.BRepBuilderAPI_MakeWire();
        for (let i = 0; i < 3; i++) mk.Add(new o.BRepBuilderAPI_MakeEdge(ps[i], ps[(i + 1) % 3]).Edge());
        const f = new o.BRepBuilderAPI_MakeFace(mk.Wire(), true).Face();
        return new o.BRepPrimAPI_MakePrism(f, new o.gp_Vec(...axis.map(x => x * (span[1] - span[0]))), false, true).Shape();
    };
    const filled = run_(new o.BRepAlgoAPI_Fuse(shape, prism(size), new o.Message_ProgressRange()));
    const cut = run_(new o.BRepAlgoAPI_Cut(filled, prism(to), new o.Message_ProgressRange()));
    const { shape: merged } = unifyWithHistory(cut);
    if (numbered(merged, 'TopAbs_SOLID').length !== numbered(shape, 'TopAbs_SOLID').length) throw new Error('a chamfer that size cuts the body apart');
    return merged;
}
