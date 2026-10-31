import * as THREE from 'three';
import { arrayMotions } from './arrayMotions.js';

export { arrayMotions };

// OpenCascade (OCCT) as the Witness 3D geometry kernel, standing in for the C3D kernel Plasticity
// links as a native addon (nkallen/plasticity src/kernel/kernel.ts:1). Solids are exact B-rep
// shapes; Three.js only ever sees their tessellation and their real edges.

let kernel;

/** Load the OCCT WebAssembly build once. `options` go to the Emscripten loader (e.g. wasmBinary). */
export async function loadKernel(options = {}) {
    if (!kernel) {
        const { default: init } = await import('replicad-opencascadejs');
        kernel = await init(options);
    }
    return kernel;
}

export function oc() {
    if (!kernel) throw new Error("Kernel not loaded; await loadKernel() first");
    return kernel;
}

const pnt = v => new (oc().gp_Pnt)(v.x, v.y, v.z);
const dir = v => new (oc().gp_Dir)(v.x, v.y, v.z);

/**
 * A planar face from a THREE.Shape placed by `frame` (a Matrix4 whose basis is x, y, normal).
 * A single full arc becomes an exact circle; anything else is traced as a polygon.
 */
export function makeProfileFace(shape, frame) {
    const o = oc();
    const origin = new THREE.Vector3().setFromMatrixPosition(frame);
    const x = new THREE.Vector3(), y = new THREE.Vector3(), z = new THREE.Vector3();
    frame.extractBasis(x, y, z);

    const curves = shape.curves;
    const wire = new o.BRepBuilderAPI_MakeWire();
    if (curves.length === 1 && curves[0].isEllipseCurve && Math.abs(Math.abs(curves[0].aEndAngle - curves[0].aStartAngle) - Math.PI * 2) < 1e-9) {
        const c = curves[0];
        const center = new THREE.Vector3(c.aX, c.aY, 0).applyMatrix4(frame);
        const circ = new o.gp_Circ(new o.gp_Ax2(pnt(center), dir(z), dir(x)), c.xRadius);
        wire.Add(new o.BRepBuilderAPI_MakeEdge(circ).Edge());
    } else {
        const pts = shape.getPoints(48).map(p => new THREE.Vector3(p.x, p.y, 0).applyMatrix4(frame));
        if (pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-9) pts.pop();
        for (let i = 0; i < pts.length; i++) {
            wire.Add(new o.BRepBuilderAPI_MakeEdge(pnt(pts[i]), pnt(pts[(i + 1) % pts.length])).Edge());
        }
    }
    return new o.BRepBuilderAPI_MakeFace(wire.Wire(), true).Face();
}

export function prism(face, vector) {
    const o = oc();
    return new o.BRepPrimAPI_MakePrism(face, new o.gp_Vec(vector.x, vector.y, vector.z), false, true).Shape();
}

/** The numbered flat face of `shape` swept along its outward normal by `distance`. */
export function extrudeFace(shape, faceIndex, distance) {
    const o = oc();
    const plane = facePlane(shape, faceIndex);
    if (!plane) throw new Error('only flat faces can be extruded here yet');
    let i = 0;
    for (const ex = new o.TopExp_Explorer(shape, o.TopAbs_ShapeEnum.TopAbs_FACE, o.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next(), i++) {
        if (i === faceIndex) return prism(o.TopoDS.Face(ex.Current()), plane.normal.clone().multiplyScalar(distance));
    }
    throw new Error('that face no longer exists');
}

export function box(min, max) {
    return new (oc().BRepPrimAPI_MakeBox)(pnt(min), pnt(max)).Shape();
}

/** Union, difference or intersection, followed by merging coplanar faces like a CAD kernel would. */
export function boolean(a, b, op) {
    return booleanWithHistory(a, b, op).shape;
}

/**
 * {@link boolean} with its history, shaped like the Rust kernel's `History`: `faces[k]` and
 * `edges[k]` hold [number in input k, number in the result] pairs, input 0 being `a`.
 */
export function booleanWithHistory(a, b, op) {
    const o = oc();
    const Op = { union: o.BRepAlgoAPI_Fuse, difference: o.BRepAlgoAPI_Cut, intersection: o.BRepAlgoAPI_Common }[op];
    const algo = new Op(a, b, new o.Message_ProgressRange());
    if (!algo.IsDone() || algo.HasErrors()) throw new Error(`Boolean ${op} failed`);
    const unify = new o.ShapeUpgrade_UnifySameDomain(algo.Shape(), true, true, false);
    unify.Build();
    const shape = unify.Shape();
    return { shape, history: trace([a, b], shape, s => successors(algo, s)) };
}

/**
 * Plasticity's Delete Redundant Topology: faces on one surface merged, and edges on one curve, with
 * the history traced by where each old face and edge now lies.
 */
export function unifyWithHistory(shape) {
    const o = oc();
    const unify = new o.ShapeUpgrade_UnifySameDomain(shape, true, true, false);
    unify.AllowInternalEdges(false);
    unify.Build();
    const result = unify.Shape();
    if (!new o.BRepCheck_Analyzer(result, true, false, false).IsValid()) throw new Error('merging the faces breaks the body');
    return { shape: result, history: trace([shape], result, s => [s]) };
}

const KINDS = { faces: 'TopAbs_FACE', edges: 'TopAbs_EDGE' };

/** The shape's faces or edges, each once, in TopExp::MapShapes order (see numberedEdges). */
/**
 * Plasticity's Find Boundary Edges: the numbers (numberedEdges order) of the edges that bound only
 * one face, a sheet's open sides. Seams (an edge met twice in its one face) and degenerate edges are
 * skipped. As w3d_boundary_edges on the desktop.
 */
export function boundaryEdges(shape) {
    const o = oc();
    const faceEdges = numbered(shape, 'TopAbs_FACE').map(f => {
        const list = [];
        for (const ex = new o.TopExp_Explorer(f, o.TopAbs_ShapeEnum.TopAbs_EDGE, o.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) list.push(ex.Current());
        return list;
    });
    const out = [];
    numberedEdges(shape).forEach((e, n) => {
        if (o.BRep_Tool.Degenerated(e)) return;
        const uses = faceEdges.map(list => list.filter(x => x.IsSame(e)).length).filter(k => k > 0);
        if (uses.length === 1 && uses[0] === 1) out.push(n);
    });
    return out;
}

export function numbered(shape, kind) {
    const o = oc(), out = [];
    for (const ex = new o.TopExp_Explorer(shape, o.TopAbs_ShapeEnum[kind], o.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
        const s = ex.Current();
        if (!out.some(t => t.IsSame(s))) out.push(s);
    }
    return out;
}

function listOf(list) {
    const copy = new (oc().NCollection_List_TopoDS_Shape)(list), out = [];
    while (!copy.IsEmpty()) { out.push(copy.First()); copy.RemoveFirst(); }
    return out;
}

/** What `s` became through one builder: nothing if deleted, its pieces if modified, else itself. */
export function successors(mk, s) {
    if (mk.IsDeleted(s)) return [];
    const m = listOf(mk.Modified(s));
    return m.length ? m : [s];
}

/** A point strictly inside a face or edge, for finding what it was merged into. */
function innerPoint(s) {
    const o = oc();
    if (s.ShapeType() === o.TopAbs_ShapeEnum.TopAbs_EDGE) {
        const c = new o.BRepAdaptor_Curve(o.TopoDS.Edge(s));
        return c.Value((c.FirstParameter() + c.LastParameter()) / 2);
    }
    const face = o.TopoDS.Face(s), loc = new o.TopLoc_Location();
    new o.BRepMesh_IncrementalMesh(face, 0.01, false, 0.25, false);
    const tri = o.BRep_Tool.Triangulation(face, loc, 0);
    if (!tri || !tri.NbTriangles?.()) return null;
    const t = tri.Triangle(1), trsf = loc.Transformation();
    const [p, q, r] = [1, 2, 3].map(i => tri.Node(t.Value(i)).Transformed(trsf));
    return new o.gp_Pnt((p.X() + q.X() + r.X()) / 3, (p.Y() + q.Y() + r.Y()) / 3, (p.Z() + q.Z() + r.Z()) / 3);
}

/**
 * Where each face and edge of `inputs` ended up in `result`, through `step` (a builder's own
 * history). The coplanar-face merge that follows a boolean has no history in this build, so a
 * piece it merged away is found by the result face or edge it lies on.
 */
export function trace(inputs, result, step) {
    const o = oc();
    const history = { faces: [[], []], edges: [[], []], generatedFaces: [] };
    for (const [key, kind] of Object.entries(KINDS)) {
        const out = numbered(result, kind);
        const merged = new Map();
        const find = s => {
            const j = out.findIndex(t => t.IsSame(s));
            if (j >= 0) return j;
            if (merged.has(s)) return merged.get(s);
            const p = innerPoint(s);
            let best = -1, bestD = 0.05;
            if (p) {
                const v = new o.BRepBuilderAPI_MakeVertex(p).Shape();
                out.forEach((t, i) => {
                    const d = new o.BRepExtrema_DistShapeShape(v, t);
                    if (d.IsDone() && d.Value() < bestD) { bestD = d.Value(); best = i; }
                });
            }
            merged.set(s, best);
            return best;
        };
        inputs.forEach((input, k) => {
            numbered(input, kind).forEach((s, i) => {
                for (const t of step(s)) {
                    if (t.ShapeType() !== s.ShapeType()) continue;
                    const j = find(t);
                    if (j >= 0 && !history[key][k].some(([a, b]) => a === i && b === j)) history[key][k].push([i, j]);
                }
            });
        });
    }
    return history;
}

/** Scale by `scale` and rotate by `angle` radians about `axis`, both about `pivot`, then move by `offset`. */
export function transform(shape, { offset = [0, 0, 0], pivot = [0, 0, 0], axis = [0, 1, 0], angle = 0, scale = 1 }) {
    const o = oc();
    const t = new o.gp_Trsf();
    if (angle) t.SetRotation(new o.gp_Ax1(new o.gp_Pnt(...pivot), new o.gp_Dir(...axis)), angle);
    if (scale !== 1) {
        const s = new o.gp_Trsf();
        s.SetScale(new o.gp_Pnt(...pivot), scale);
        t.Multiply(s);
    }
    const move = new o.gp_Trsf();
    move.SetTranslation(new o.gp_Vec(...offset));
    move.Multiply(t);
    return new o.BRepBuilderAPI_Transform(shape, move, true, false).Shape();
}

// Gauss–Kronrod to a relative error of 1e-6: the plain Gauss rule misreads B-spline faces such as
// shelled lofts and fillets by several percent.
export function volume(shape) {
    const o = oc();
    const props = new o.GProp_GProps();
    o.BRepGProp.VolumePropertiesGK(shape, props, 1e-6, true, true, false, false, false);
    return props.Mass();
}

export function count(shape, kind) {
    const o = oc();
    let n = 0;
    for (const ex = new o.TopExp_Explorer(shape, o.TopAbs_ShapeEnum[kind], o.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) n++;
    return n;
}

export function bounds(shape) {
    const o = oc();
    const b = new o.Bnd_Box();
    o.BRepBndLib.Add(shape, b, false);
    const min = b.CornerMin(), max = b.CornerMax();
    return new THREE.Box3(new THREE.Vector3(min.X(), min.Y(), min.Z()), new THREE.Vector3(max.X(), max.Y(), max.Z()));
}

/**
 * Tessellate a shape for display. Returns the triangle mesh (with a per-vertex `faceIndex` so a
 * pick can find the B-rep face) and the true B-rep edges as line segments.
 */
export function tessellate(shape, { deflection = 0.01, angle = 0.25 } = {}) {
    const o = oc();
    new o.BRepMesh_IncrementalMesh(shape, deflection, false, angle, false);

    const positions = [], faceIndex = [], indices = [];
    let faceNo = 0;
    for (const ex = new o.TopExp_Explorer(shape, o.TopAbs_ShapeEnum.TopAbs_FACE, o.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next(), faceNo++) {
        const face = o.TopoDS.Face(ex.Current());
        const loc = new o.TopLoc_Location();
        const tri = o.BRep_Tool.Triangulation(face, loc, 0);
        if (!tri || tri.NbTriangles?.() === undefined) continue;
        const trsf = loc.Transformation();
        const base = positions.length / 3;
        for (let i = 1; i <= tri.NbNodes(); i++) {
            const p = tri.Node(i).Transformed(trsf);
            positions.push(p.X(), p.Y(), p.Z());
            faceIndex.push(faceNo);
        }
        const reversed = face.Orientation() === o.TopAbs_Orientation.TopAbs_REVERSED;
        for (let i = 1; i <= tri.NbTriangles(); i++) {
            const t = tri.Triangle(i);
            const a = t.Value(1) - 1 + base, b = t.Value(2) - 1 + base, c = t.Value(3) - 1 + base;
            if (reversed) indices.push(a, c, b); else indices.push(a, b, c);
        }
    }
    const mesh = new THREE.BufferGeometry();
    mesh.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    mesh.setAttribute('faceIndex', new THREE.Float32BufferAttribute(faceIndex, 1));
    mesh.setIndex(indices);
    // Faces never share vertices, so normals are smooth within a face and crisp across edges.
    mesh.computeVertexNormals();
    mesh.computeBoundingBox();

    // Each edge once, in the kernel's numbering (see numberedEdges), as a polyline per edge.
    const segments = [], polylines = [];
    for (const edge of numberedEdges(shape)) {
        const curve = new o.BRepAdaptor_Curve(edge);
        // Lines need only their ends; curves are sampled evenly in parameter, enough for display.
        const u0 = curve.FirstParameter(), u1 = curve.LastParameter();
        const n = curve.GetType() === o.GeomAbs_CurveType.GeomAbs_Line ? 1 : Math.max(8, Math.ceil(Math.abs(u1 - u0) / angle * 2));
        const pts = [];
        for (let i = 0; i <= n; i++) {
            const p = curve.Value(u0 + (u1 - u0) * i / n);
            pts.push([p.X(), p.Y(), p.Z()]);
        }
        polylines.push(pts.flat());
        for (let i = 0; i < pts.length - 1; i++) segments.push(...pts[i], ...pts[i + 1]);
    }
    const edges = new THREE.BufferGeometry();
    edges.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
    return { mesh, edges, polylines };
}

/**
 * The shape's edges, each once, in the order OpenCascade's TopExp::MapShapes numbers them (first
 * meeting in an explorer walk). The Rust kernel numbers edges the same way, so an edge number
 * means the same edge on the web and on the desktop.
 */
export function numberedEdges(shape) {
    const o = oc(), edges = [];
    for (const ex = new o.TopExp_Explorer(shape, o.TopAbs_ShapeEnum.TopAbs_EDGE, o.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
        const e = o.TopoDS.Edge(ex.Current());
        if (!edges.some(f => f.IsSame(e))) edges.push(e);
    }
    return edges;
}

/** A fillet or chamfer the kernel could not build: the edges it names (maybe none), and why. */
export class BlendError extends Error {
    constructor(message, edges = []) { super(message); this.edges = edges; }
}

const STRIPE_REASONS = {
    ChFiDS_WalkingFailure: 'the round could not be traced along the edge; a neighbouring face is probably narrower than the radius',
    ChFiDS_StartsolFailure: 'no starting point for the round was found; the radius is probably too large for the faces it joins',
    ChFiDS_TwistedSurface: 'the rounding surface would twist on itself',
};

/**
 * Where a point on an edge falls along its fillet contour, as the contour's relative parameter
 * [0, 1]: the arc length from the edge's start to the point (on a fine polyline of the edge), placed
 * by the curvilinear abscissae the builder gives the edge's two vertices. As w3d_spine_param.
 */
function spineParam(mk, ic, edge, p) {
    const o = oc();
    const c = new o.BRepAdaptor_Curve(edge), u0 = c.FirstParameter(), u1 = c.LastParameter(), n = 512;
    const at3 = u => { const q = c.Value(u); return new THREE.Vector3(q.X(), q.Y(), q.Z()); };
    let prev = at3(u0), run = 0, best = Infinity, at = 0;
    for (let i = 1; i <= n; i++) {
        const q = at3(u0 + (u1 - u0) * i / n), d = q.clone().sub(prev), l = d.length();
        const t = l > 0 ? Math.max(0, Math.min(1, p.clone().sub(prev).dot(d) / (l * l))) : 0;
        const dist = prev.clone().addScaledVector(d, t).distanceTo(p);
        if (dist < best) { best = dist; at = run + t * l; }
        run += l;
        prev = q;
    }
    const len = run, total = mk.Length(ic);
    if (total <= 0) return 0;
    const s0 = at3(u0), s1 = at3(u1);
    let v0 = null, v1 = null, d0 = Infinity, d1 = Infinity;
    for (const v of numbered(edge, 'TopAbs_VERTEX')) {
        const vx = o.TopoDS.Vertex(v), q = o.BRep_Tool.Pnt(vx), w = new THREE.Vector3(q.X(), q.Y(), q.Z());
        if (w.distanceTo(s0) < d0) { d0 = w.distanceTo(s0); v0 = vx; }
        if (w.distanceTo(s1) < d1) { d1 = w.distanceTo(s1); v1 = vx; }
    }
    let a;
    if (!v0 || !v1 || v0.IsSame(v1)) a = at * total / len;
    else {
        const a0 = mk.Abscissa(ic, v0), a1 = mk.Abscissa(ic, v1), tol = 1e-3 * Math.max(1, total);
        if (Math.abs(a0 + len - a1) < tol || (Math.abs(a0 + len - total) < tol && a1 < tol)) a = a0 + at;
        else a = (a0 < tol ? total : a0) - at;
    }
    return Math.max(0, Math.min(1, a / total));
}

/**
 * Round (or, with `chamfer`, bevel) the numbered edges by `size`. Throws BlendError. With
 * `withHistory`, returns { shape, history } (see booleanWithHistory). `variable` holds a fillet's
 * variable points, { edge, point: [x, y, z], scale }: the radius there is `size` × scale, running
 * smoothly from point to point and back to `size` at the ends of the edge's contour.
 */
export function blendEdges(shape, edgeIds, size, chamfer = false, withHistory = false, angle = Math.PI / 4, variable = []) {
    const o = oc();
    const edges = numberedEdges(shape);
    if (edgeIds.some(i => !(i >= 0 && i < edges.length))) throw new BlendError('an edge in the selection is not on this body; select the edges again');
    if (!chamfer && variable.length) return variableFillet(shape, edges, edgeIds, size, withHistory, variable);
    const mk = chamfer ? new o.BRepFilletAPI_MakeChamfer(shape) : new o.BRepFilletAPI_MakeFillet(shape, o.ChFi3d_FilletShape.ChFi3d_Rational);
    for (const i of edgeIds) {
        // A chamfer at an angle is `size` on the edge's first face, at `angle` from it.
        const face = chamfer && Math.abs(angle - Math.PI / 4) > 1e-9 && numbered(shape, 'TopAbs_FACE').find(f => numberedEdges(f).some(e => e.IsSame(edges[i])));
        if (face) mk.AddDA(size, angle, edges[i], o.TopoDS.Face(face));
        else mk.Add(size, edges[i]);
    }
    try { mk.Build(new o.Message_ProgressRange()); }
    catch { throw new BlendError(`the kernel could not build the ${chamfer ? 'chamfer' : 'round'}; try a smaller ${chamfer ? 'distance' : 'radius'}`); }
    if (!mk.IsDone()) {
        if (chamfer) throw new BlendError('the kernel could not build the chamfer; try a smaller distance');
        const failed = [];
        let reason;
        for (let i = 1; i <= mk.NbFaultyContours(); i++) {
            const ic = mk.FaultyContour(i);
            for (let j = 1; j <= mk.NbEdges(ic); j++) {
                const k = edges.findIndex(e => e.IsSame(mk.Edge(ic, j)));
                if (k >= 0) failed.push(k);
            }
            // Some opencascade.js builds leave ChFiDS_ErrorStatus unbound, so the reason may not be readable.
            let status = null;
            try { status = mk.StripeStatus(ic); } catch { /* no reason then */ }
            if (status !== null) reason ??= Object.entries(STRIPE_REASONS).find(([name]) => o.ChFiDS_ErrorStatus?.[name] === status)?.[1];
        }
        if (!reason && mk.NbFaultyVertices() > 0) reason = 'the round could not be finished where it meets a corner; try a smaller radius';
        throw new BlendError(reason ?? 'the kernel could not build the round', failed);
    }
    return blendResult(shape, mk, edges, edgeIds, chamfer, withHistory);
}

function variableFillet(shape, edges, edgeIds, size, withHistory, variable) {
    const o = oc();
    const probe = new o.BRepFilletAPI_MakeFillet(shape, o.ChFi3d_FilletShape.ChFi3d_Rational);
    for (const i of edgeIds) probe.Add(size, edges[i]);
    const laws = new Map();
    for (const v of variable) {
        if (!edgeIds.includes(v.edge)) throw new BlendError("a variable point is on an edge that isn't being rounded");
        if (!(v.scale > 0) || !Number.isFinite(v.scale)) throw new BlendError("a variable point's radius must be greater than zero");
        const ic = probe.Contour(edges[v.edge]);
        if (!laws.has(ic)) laws.set(ic, []);
        laws.get(ic).push([spineParam(probe, ic, edges[v.edge], new THREE.Vector3(...v.point)), size * v.scale]);
    }
    const mk = new o.BRepFilletAPI_MakeFillet(shape, o.ChFi3d_FilletShape.ChFi3d_Rational);
    for (let ic = 1; ic <= probe.NbContours(); ic++) {
        const first = probe.Edge(ic, 1), law = laws.get(ic);
        if (!law) { mk.Add(size, first); continue; }
        // The ends keep the radius unless a point sits on them; points closer than 0.1% merge.
        let r0 = size, r1 = size;
        const mid = [];
        for (const q of law) { if (q[0] < 1e-3) r0 = q[1]; else if (q[0] > 1 - 1e-3) r1 = q[1]; else mid.push(q); }
        mid.sort((a, b) => a[0] - b[0]);
        const keep = [[0, r0]];
        for (const q of mid) { if (q[0] - keep.at(-1)[0] < 1e-3) keep.at(-1)[1] = q[1]; else keep.push(q); }
        const fv = o.BRep_Tool.Pnt(probe.FirstVertex(ic)), lv = o.BRep_Tool.Pnt(probe.LastVertex(ic));
        const closed = fv.Distance(lv) < 1e-7;
        keep.push([1, closed ? (r0 !== size ? r0 : r1) : r1]);
        if (closed) keep[0][1] = keep.at(-1)[1];
        const arr = new o.NCollection_Array1_gp_Pnt2d(1, keep.length);
        keep.forEach(([u, r], k) => arr.SetValue(k + 1, new o.gp_Pnt2d(u, r)));
        mk.Add(arr, first);
    }
    let built = true;
    try { mk.Build(new o.Message_ProgressRange()); } catch { built = false; }
    if (!built || !mk.IsDone()) throw new BlendError('the kernel could not build the variable round; try radii closer to each other or a smaller radius', edgeIds);
    return blendResult(shape, mk, edges, edgeIds, false, withHistory);
}

function blendResult(shape, mk, edges, edgeIds, chamfer, withHistory) {
    const o = oc();
    const result = mk.Shape();
    if (!new o.BRepCheck_Analyzer(result, true, false, false).IsValid()) {
        throw new BlendError(`the kernel built a ${chamfer ? 'chamfer' : 'round'} but the solid it produced is invalid; try a smaller ${chamfer ? 'distance' : 'radius'}`, edgeIds);
    }
    if (!withHistory) return result;
    const history = trace([shape], result, s => successors(mk, s));
    const faces = numbered(result, 'TopAbs_FACE');
    edges.forEach((e, i) => {
        for (const f of listOf(mk.Generated(e))) {
            const j = faces.findIndex(t => t.IsSame(f));
            if (j >= 0) history.generatedFaces.push([i, j]);
        }
    });
    return { shape: result, history };
}

/** The planar face of `shape` at `faceIndex` (as numbered by tessellate): a point on it and its outward normal. */
export function facePlane(shape, faceIndex) {
    const o = oc();
    let i = 0;
    for (const ex = new o.TopExp_Explorer(shape, o.TopAbs_ShapeEnum.TopAbs_FACE, o.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next(), i++) {
        if (i !== faceIndex) continue;
        const face = o.TopoDS.Face(ex.Current());
        const surface = new o.BRepAdaptor_Surface(face, true);
        if (surface.GetType() !== o.GeomAbs_SurfaceType.GeomAbs_Plane) return undefined;
        const pln = surface.Plane();
        const d = pln.Axis().Direction(), l = pln.Location();
        const n = new THREE.Vector3(d.X(), d.Y(), d.Z());
        if (face.Orientation() === o.TopAbs_Orientation.TopAbs_REVERSED) n.negate();
        return { normal: n, origin: new THREE.Vector3(l.X(), l.Y(), l.Z()) };
    }
    return undefined;
}

/**
 * Offset Face's adjacent angle (A), as w3d_offset_faces on the desktop: the faces meeting the
 * numbered flat faces at sharp edges lean by `angle` radians, pivoting where they end away from the
 * face, so it shrinks (positive) or grows.
 */
export function draftWithHistory(shape, faces, angle) {
    const o = oc();
    const all = numbered(shape, 'TopAbs_FACE').map(f => o.TopoDS.Face(f));
    const edgesOf = f => numbered(f, 'TopAbs_EDGE');
    const draft = new o.BRepOffsetAPI_DraftAngle(shape);
    const done = new Set();
    for (const i of faces) {
        const p = facePlane(shape, i);
        if (!p) throw new Error('an angle needs flat faces');
        const f = all[i], fe = edgesOf(f), slopes = [];
        let reach = 0;
        all.forEach((g, j) => {
            if (faces.includes(j) || done.has(j)) return;
            const shared = edgesOf(g).find(e => fe.some(k => k.IsSame(e)));
            if (!shared) return;
            if (o.BRep_Tool.Continuity(o.TopoDS.Edge(shared), f, g) !== o.GeomAbs_Shape.GeomAbs_C0) return;
            done.add(j);
            slopes.push(g);
            const b = new o.Bnd_Box();
            o.BRepBndLib.Add(g, b, true);
            const lo = b.CornerMin(), hi = b.CornerMax();
            for (let k = 0; k < 8; k++) {
                const c = new THREE.Vector3(k & 1 ? hi.X() : lo.X(), k & 2 ? hi.Y() : lo.Y(), k & 4 ? hi.Z() : lo.Z());
                reach = Math.min(reach, c.sub(p.origin).dot(p.normal));
            }
        });
        const at = p.origin.clone().addScaledVector(p.normal, reach), n = new o.gp_Dir(p.normal.x, p.normal.y, p.normal.z);
        const neutral = new o.gp_Pln(new o.gp_Pnt(at.x, at.y, at.z), n);
        for (const g of slopes) {
            draft.Add(g, n, angle, neutral, true);
            if (!draft.AddDone()) throw new Error('the faces next to it cannot lean that far');
        }
    }
    if (!done.size) throw new Error('no faces meet it at a sharp edge to lean');
    draft.Build(new o.Message_ProgressRange());
    if (!draft.IsDone()) throw new Error('the faces next to it cannot lean that far; try a smaller angle');
    const result = draft.Shape();
    // This build's DraftAngle reports nothing as Modified; ModifiedShape gives each image.
    const image = s => { try { return [draft.ModifiedShape(s)]; } catch { return [s]; } };
    return { shape: result, history: trace([shape], result, image) };
}

/** Write a STEP file and return its bytes. */
export function exportSTEP(shape) {
    const o = oc();
    const writer = new o.STEPControl_Writer();
    writer.Transfer(shape, o.STEPControl_StepModelType.STEPControl_AsIs, true, new o.Message_ProgressRange());
    const path = '/witness3d-export.step';
    writer.Write(path);
    const bytes = o.FS.readFile(path);
    o.FS.unlink(path);
    return bytes;
}

// --- Round 6: Box, Cylinder, Sphere, Shell and Mirror, matching crates/w3d-kernel/src/solids.rs ---

const SMALL = 1e-6;
const finite = a => a.every(Number.isFinite);
const vec = a => new THREE.Vector3(...a);

function checkFrame({ origin, x, normal }) {
    if (![origin, x, normal].every(v => Array.isArray(v) && v.length === 3 && finite(v)) || vec(x).cross(vec(normal)).length() < 1e-9) throw new Error('the construction plane is not valid');
    const n = vec(normal).normalize(), xa = vec(x).addScaledVector(n, -vec(x).dot(n)).normalize();
    return { o: vec(origin), x: xa, y: new THREE.Vector3().crossVectors(n, xa), n };
}

/**
 * Plasticity's Box, Cylinder and Sphere as a solid. `p` is { kind: 'box', frame, width, depth, height }
 * (from the frame's origin along its x, y and normal; negative grows the other way),
 * { kind: 'cylinder', frame, radius, height } or { kind: 'sphere', center, radius }.
 */
export function primitive(p) {
    const o = oc();
    if (p.kind === 'box') {
        const { width: w, depth: d, height: h } = p;
        if (!finite([w, d, h])) throw new Error("the box's size is not a number");
        if (Math.abs(w) < SMALL || Math.abs(d) < SMALL || Math.abs(h) < SMALL) throw new Error('a box needs a width, a depth and a height');
        const f = checkFrame(p.frame);
        const at = (u, v) => f.o.clone().addScaledVector(f.x, u).addScaledVector(f.y, v);
        let pts = [at(0, 0), at(w, 0), at(w, d), at(0, d)];
        if (w * d < 0) pts = pts.reverse();
        const wire = new o.BRepBuilderAPI_MakeWire();
        pts.forEach((q, i) => wire.Add(new o.BRepBuilderAPI_MakeEdge(pnt(q), pnt(pts[(i + 1) % 4])).Edge()));
        const face = new o.BRepBuilderAPI_MakeFace(wire.Wire(), true).Face();
        return prism(face, f.n.clone().multiplyScalar(h));
    }
    if (p.kind === 'cylinder') {
        const { radius: r, height: h } = p;
        if (!finite([r, h])) throw new Error("the cylinder's size is not a number");
        if (!(r > SMALL)) throw new Error("the cylinder's radius must be greater than zero");
        if (Math.abs(h) < SMALL) throw new Error('a cylinder needs a height');
        const f = checkFrame(p.frame);
        const n = h < 0 ? f.n.clone().negate() : f.n;
        return new o.BRepPrimAPI_MakeCylinder(new o.gp_Ax2(pnt(f.o), dir(n), dir(f.x)), r, Math.abs(h)).Shape();
    }
    if (p.kind === 'sphere') {
        if (!Array.isArray(p.center) || !finite(p.center) || !Number.isFinite(p.radius)) throw new Error("the sphere's size is not a number");
        if (!(p.radius > SMALL)) throw new Error("the sphere's radius must be greater than zero");
        return new o.BRepPrimAPI_MakeSphere(pnt(vec(p.center)), p.radius).Shape();
    }
    throw new Error('a primitive is a box, a cylinder or a sphere');
}

/**
 * Plasticity's Shell: hollow `shape` to walls `thickness` thick inside its outer surface, open at the
 * numbered faces. Returns { shape, history }; the inner walls are new faces.
 */
export function shellFaces(shape, faces, thickness) {
    const o = oc();
    if (!Number.isFinite(thickness)) throw new Error('the thickness is not a number');
    if (!(thickness > SMALL)) throw new Error('the wall thickness must be greater than zero');
    if (!faces?.length) return hollow(shape, thickness);
    const all = numbered(shape, 'TopAbs_FACE');
    const ids = [...new Set(faces)];
    if (ids.some(i => !Number.isInteger(i) || !all[i])) throw new Error('a face in the selection is not on this body; select the faces again');
    if (ids.length === all.length) throw new Error('leave at least one face closed');
    const closing = new o.NCollection_List_TopoDS_Shape();
    for (const i of ids) closing.Append(all[i]);
    // A real shell adds an inner wall for every face it keeps. On some free-form bodies (a loft of
    // closed splines) the intersection join hands the body back untouched; the arc join, which
    // rounds the inner corners instead, often succeeds there.
    const before = count(shape, 'TopAbs_FACE');
    const attempt = join => {
        const m = new o.BRepOffsetAPI_MakeThickSolid();
        try {
            m.MakeThickSolidByJoin(shape, closing, -thickness, 1e-6, o.BRepOffset_Mode.BRepOffset_Skin, false, false, join, false, new o.Message_ProgressRange());
        } catch { return null; }
        return m.IsDone() && !m.Shape().IsNull() && count(m.Shape(), 'TopAbs_FACE') > before ? m : null;
    };
    const mk = attempt(o.GeomAbs_JoinType.GeomAbs_Intersection) ?? attempt(o.GeomAbs_JoinType.GeomAbs_Arc);
    if (!mk) throw new Error("the walls can't be that thick here; try a thinner shell");
    const result = mk.Shape();
    if (!new o.BRepCheck_Analyzer(result, true, false, false).IsValid() || count(result, 'TopAbs_SOLID') !== count(shape, 'TopAbs_SOLID')) throw new Error('a shell that thick breaks the body; try a thinner one');
    return { shape: result, history: trace([shape], result, s => successors(mk, s)) };
}

/**
 * Shell with no face open (a whole solid): hollow round a closed void, walls `thickness` thick all
 * round; the body offset inward is cut out of it. Returns { shape, history }.
 */
function hollow(shape, thickness) {
    const o = oc();
    if (count(shape, 'TopAbs_SOLID') === 0) throw new Error('a sheet has no inside to hollow; thicken it first');
    const thick = new Error("the walls can't be that thick here; try a thinner shell");
    const m = new o.BRepOffsetAPI_MakeThickSolid();
    try {
        m.MakeThickSolidByJoin(shape, new o.NCollection_List_TopoDS_Shape(), -thickness, 1e-6, o.BRepOffset_Mode.BRepOffset_Skin, false, false, o.GeomAbs_JoinType.GeomAbs_Intersection, false, new o.Message_ProgressRange());
    } catch { throw thick; }
    if (!m.IsDone() || m.Shape().IsNull()) throw thick;
    const inner = m.Shape(), v0 = volume(shape), v1 = volume(inner);
    // Too thick, the offset turns inside out: its skin then stands nearer the body's than the thickness.
    const skin = s => { const e = new o.TopExp_Explorer(s, o.TopAbs_ShapeEnum.TopAbs_SHELL, o.TopAbs_ShapeEnum.TopAbs_SHAPE); return e.More() ? e.Current() : s; };
    const gap = new o.BRepExtrema_DistShapeShape(skin(shape), skin(inner));
    if (!(v1 > SMALL && v1 < v0 - SMALL) || !gap.IsDone() || Math.abs(gap.Value() - thickness) > 1e-4 * (1 + thickness)) throw thick;
    const r = booleanWithHistory(shape, inner, 'difference');
    if (!new o.BRepCheck_Analyzer(r.shape, true, false, false).IsValid()) throw new Error('a shell that thick breaks the body; try a thinner one');
    return r;
}

/** A copy of `shape` reflected in the plane through `origin` with normal `normal`. */
export function mirror(shape, origin, normal) {
    const o = oc();
    if (![origin, normal].every(v => Array.isArray(v) && v.length === 3 && finite(v))) throw new Error('the mirror plane is not a number');
    if (Math.hypot(...normal) < 1e-9) throw new Error('the mirror plane has no direction');
    const t = new o.gp_Trsf();
    t.SetMirror(new o.gp_Ax2(new o.gp_Pnt(...origin), new o.gp_Dir(...normal)));
    return new o.BRepBuilderAPI_Transform(shape, t, true, false).Shape();
}


/**
 * Split `shape` by `tools` (sheets or solids) into its solid pieces (Plasticity's Cut). Returns
 * { pieces, history }, the history tracing the body's faces and edges into the first piece. Throws
 * when nothing is cut.
 */
export function splitWithHistory(shape, tools) {
    const o = oc();
    const args = new o.NCollection_List_TopoDS_Shape(), cutters = new o.NCollection_List_TopoDS_Shape();
    args.Append(shape);
    for (const t of tools) cutters.Append(t);
    const mk = new o.BRepAlgoAPI_Splitter();
    mk.SetArguments(args);
    mk.SetTools(cutters);
    mk.Build(new o.Message_ProgressRange());
    if (!mk.IsDone() || mk.HasErrors()) throw new Error('the body could not be cut there');
    const pieces = [];
    for (const ex = new o.TopExp_Explorer(mk.Shape(), o.TopAbs_ShapeEnum.TopAbs_SOLID, o.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) pieces.push(o.TopoDS.Solid(ex.Current()));
    if (pieces.length < 2) throw new Error('the curve does not cut the body; draw it across the solid');
    // The biggest piece keeps the body's id, so its faces carry their refs.
    pieces.sort((a, b) => volume(b) - volume(a));
    return { pieces, history: trace([shape], pieces[0], s => successors(mk, s)) };
}

/**
 * Plasticity's Imprint: the numbered faces of `shape` (every face when `faces` is empty) split where
 * `sheets` cross them; the body stays whole. Returns { shape, history }. Throws when no face is divided.
 */
export function imprintWithHistory(shape, faces, sheets) {
    const o = oc();
    const all = numbered(shape, 'TopAbs_FACE');
    for (const f of faces) if (!(f >= 0 && f < all.length)) throw new Error('that face no longer exists');
    const targets = faces.length ? faces.map(f => all[f]) : all;
    const tools = new o.NCollection_List_TopoDS_Shape();
    let edges = 0;
    for (const face of targets) for (const sheet of sheets) {
        const sec = new o.BRepAlgoAPI_Section(face, sheet, false);
        sec.ComputePCurveOn1(true);
        sec.Approximation(true);
        sec.Build(new o.Message_ProgressRange());
        if (!sec.IsDone()) continue;
        for (const e of numbered(sec.Shape(), 'TopAbs_EDGE')) { tools.Append(e); edges++; }
    }
    if (!edges) throw new Error('the curves do not cross those faces');
    const args = new o.NCollection_List_TopoDS_Shape();
    args.Append(shape);
    const mk = new o.BRepAlgoAPI_Splitter();
    mk.SetArguments(args);
    mk.SetTools(tools);
    mk.Build(new o.Message_ProgressRange());
    if (!mk.IsDone() || mk.HasErrors()) throw new Error('the curves could not be imprinted there');
    const solid = numbered(mk.Shape(), 'TopAbs_SOLID')[0];
    if (!solid) throw new Error('the curves could not be imprinted there');
    const result = o.TopoDS.Solid(solid);
    if (count(result, 'TopAbs_FACE') <= all.length) throw new Error('the curves do not divide those faces; draw them across a face or as closed loops');
    return { shape: result, history: trace([shape], result, s => successors(mk, s)) };
}

/**
 * Imprint Curve Body with its options: `shape` split along `edges` lying on its faces (from
 * projectedEdges). Edges ending inside a face stay there as edges of it (Completion None).
 */
export function imprintEdgesWithHistory(shape, edges) {
    const o = oc();
    const tools = new o.NCollection_List_TopoDS_Shape();
    for (const e of edges) tools.Append(e);
    const args = new o.NCollection_List_TopoDS_Shape();
    args.Append(shape);
    const mk = new o.BRepAlgoAPI_Splitter();
    mk.SetArguments(args);
    mk.SetTools(tools);
    mk.Build(new o.Message_ProgressRange());
    if (!mk.IsDone() || mk.HasErrors()) throw new Error('the curves could not be imprinted there');
    const solid = numbered(mk.Shape(), 'TopAbs_SOLID')[0], shell = numbered(mk.Shape(), 'TopAbs_SHELL')[0];
    if (!solid && !shell) throw new Error('the curves could not be imprinted there');
    const result = solid ? o.TopoDS.Solid(solid) : o.TopoDS.Shell(shell);
    if (count(result, 'TopAbs_EDGE') <= count(shape, 'TopAbs_EDGE')) throw new Error('the curves do not reach those faces');
    return { shape: result, history: trace([shape], result, s => successors(mk, s)) };
}

/** A square sheet `size` each way on the plane through `origin` with `normal`, for cutting. */
export function planeSheet(origin, normal, size) {
    const o = oc();
    const n = new THREE.Vector3(...normal);
    if (n.length() < 1e-12) throw new Error('the plane has no direction');
    n.normalize();
    const x = new THREE.Vector3(1, 0, 0);
    if (Math.abs(n.dot(x)) > 0.9) x.set(0, 1, 0);
    x.addScaledVector(n, -x.dot(n)).normalize();
    const y = new THREE.Vector3().crossVectors(n, x);
    const c = new THREE.Vector3(...origin);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => c.clone().addScaledVector(x, a * size).addScaledVector(y, b * size));
    const wire = new o.BRepBuilderAPI_MakeWire();
    for (let i = 0; i < 4; i++) wire.Add(new o.BRepBuilderAPI_MakeEdge(pnt(corners[i]), pnt(corners[(i + 1) % 4])).Edge());
    return new o.BRepBuilderAPI_MakeFace(wire.Wire(), true).Face();
}

/**
 * Face `index` of `shape` as a cutting tool grown past the body (w3d_face_sheet on the desktop):
 * a plane becomes a square `size` each way, a cylinder its whole round `size` each way along the
 * axis; any other face its surface carried straight on `size` past its open sides by `wide(face,
 * size)` (matchFace.js's wideSurface; this module can't import it), or as it is without one.
 */
export function faceSheet(shape, index, size, wide = null) {
    const o = oc();
    const face = numbered(shape, 'TopAbs_FACE')[index];
    if (!face) throw new Error('that face no longer exists');
    const surface = new o.BRepAdaptor_Surface(o.TopoDS.Face(face), true);
    const type = surface.GetType();
    if (type === o.GeomAbs_SurfaceType.GeomAbs_Plane) {
        const pln = surface.Plane(), l = pln.Location(), d = pln.Axis().Direction();
        return planeSheet([l.X(), l.Y(), l.Z()], [d.X(), d.Y(), d.Z()], size);
    }
    if (type === o.GeomAbs_SurfaceType.GeomAbs_Cylinder) {
        const cyl = surface.Cylinder(), ax = cyl.Axis(), l = ax.Location(), d = ax.Direction();
        const start = new o.gp_Pnt(l.X() - d.X() * size, l.Y() - d.Y() * size, l.Z() - d.Z() * size);
        const circ = new o.gp_Circ(new o.gp_Ax2(start, d, cyl.XAxis().Direction()), cyl.Radius());
        const edge = new o.BRepBuilderAPI_MakeEdge(circ).Edge();
        return new o.BRepPrimAPI_MakePrism(edge, new o.gp_Vec(d.X() * 2 * size, d.Y() * 2 * size, d.Z() * 2 * size), false, true).Shape();
    }
    if (!wide) return face;
    const mk = new o.BRepBuilderAPI_MakeFace(wide(o.TopoDS.Face(face), size), 1e-7);
    return mk.IsDone() ? mk.Face() : face;
}

/**
 * Plasticity's Draft Face: the numbered faces tilted by `angle` radians about the neutral plane
 * through `origin`, square to `pull` (the direction the part leaves its mould). Positive angles
 * open the faces out along `pull`. Flat, cylindrical and conical faces. Returns { shape, history }.
 */
export function draftFaces(shape, faces, pull, origin, angle) {
    const o = oc();
    if (!faces.length) throw new Error('select the faces to draft');
    if (!(Math.abs(angle) > 1e-9) || !Number.isFinite(angle)) throw new Error('the draft angle must not be zero');
    if (Math.abs(angle) >= Math.PI / 2) throw new Error('a draft is less than 90 degrees');
    const all = numbered(shape, 'TopAbs_FACE');
    const n = new THREE.Vector3(...pull);
    if (n.length() < 1e-12) throw new Error('the pull direction has no length');
    n.normalize();
    const dirn = new o.gp_Dir(n.x, n.y, n.z);
    const neutral = new o.gp_Pln(new o.gp_Pnt(...origin), dirn);
    const draft = new o.BRepOffsetAPI_DraftAngle(shape);
    for (const i of faces) {
        if (!all[i]) throw new Error('that face no longer exists');
        draft.Add(o.TopoDS.Face(all[i]), dirn, angle, neutral, true);
        if (!draft.AddDone()) throw new Error('that face cannot be drafted; faces square to the pull, or free-form ones, cannot');
    }
    draft.Build(new o.Message_ProgressRange());
    if (!draft.IsDone()) throw new Error('the faces cannot be drafted that far; try a smaller angle');
    const result = draft.Shape();
    const image = s => { try { return [draft.ModifiedShape(s)]; } catch { return [s]; } };
    return { shape: result, history: trace([shape], result, image) };
}

/**
 * Plasticity's Boolean Region, as w3d_regions on the desktop: a solid for each part of space the
 * `shapes` (solids and sheets) close off, largest first. A box round them all is split by their
 * faces; the pieces that don't reach out to the box's sides are the enclosed regions.
 */
export function regions(shapes) {
    const o = oc();
    if (!shapes.length) throw new Error('select the bodies to make regions from');
    const all = new THREE.Box3();
    for (const s of shapes) all.union(bounds(s));
    const size = all.getSize(new THREE.Vector3());
    const m = 0.1 * Math.max(size.x, size.y, size.z, 1);
    const lo = all.min.clone().subScalar(m), hi = all.max.clone().addScalar(m);
    const cage = box({ x: lo.x, y: lo.y, z: lo.z }, { x: hi.x, y: hi.y, z: hi.z });
    const args = new o.NCollection_List_TopoDS_Shape(), tools = new o.NCollection_List_TopoDS_Shape();
    args.Append(cage);
    for (const s of shapes) tools.Append(s);
    const mk = new o.BRepAlgoAPI_Splitter();
    mk.SetArguments(args);
    mk.SetTools(tools);
    mk.Build(new o.Message_ProgressRange());
    if (!mk.IsDone() || mk.HasErrors()) throw new Error('the bodies could not be split into regions');
    const tol = 0.5 * m;
    const out = numbered(mk.Shape(), 'TopAbs_SOLID').map(s => o.TopoDS.Solid(s)).filter(s => {
        const b = bounds(s);
        // A piece reaching out to the box's sides is the open space round the bodies.
        return b.min.x >= all.min.x - tol && b.min.y >= all.min.y - tol && b.min.z >= all.min.z - tol
            && b.max.x <= all.max.x + tol && b.max.y <= all.max.y + tol && b.max.z <= all.max.z + tol;
    });
    if (!out.length) throw new Error('the bodies close off no region');
    return out.map(s => [volume(s), s]).sort((a, b) => b[0] - a[0]).map(([, s]) => s);
}
