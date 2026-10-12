import * as THREE from 'three';

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

const KINDS = { faces: 'TopAbs_FACE', edges: 'TopAbs_EDGE' };

/** The shape's faces or edges, each once, in TopExp::MapShapes order (see numberedEdges). */
function numbered(shape, kind) {
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
function successors(mk, s) {
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
function trace(inputs, result, step) {
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

/** Rotate by `angle` radians about `axis` through `pivot`, then move by `offset` (arrays of 3). */
export function transform(shape, { offset = [0, 0, 0], pivot = [0, 0, 0], axis = [0, 1, 0], angle = 0 }) {
    const o = oc();
    const t = new o.gp_Trsf();
    if (angle) t.SetRotation(new o.gp_Ax1(new o.gp_Pnt(...pivot), new o.gp_Dir(...axis)), angle);
    const move = new o.gp_Trsf();
    move.SetTranslation(new o.gp_Vec(...offset));
    move.Multiply(t);
    return new o.BRepBuilderAPI_Transform(shape, move, true, false).Shape();
}

export function volume(shape) {
    const o = oc();
    const props = new o.GProp_GProps();
    o.BRepGProp.VolumeProperties(shape, props, false, false, false);
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

/** Round (or, with `chamfer`, bevel) the numbered edges by `size`. Throws BlendError. With
 * `withHistory`, returns { shape, history } (see booleanWithHistory). */
export function blendEdges(shape, edgeIds, size, chamfer = false, withHistory = false) {
    const o = oc();
    const edges = numberedEdges(shape);
    if (edgeIds.some(i => !(i >= 0 && i < edges.length))) throw new BlendError('an edge in the selection is not on this body; select the edges again');
    const mk = chamfer ? new o.BRepFilletAPI_MakeChamfer(shape) : new o.BRepFilletAPI_MakeFillet(shape, o.ChFi3d_FilletShape.ChFi3d_Rational);
    for (const i of edgeIds) mk.Add(size, edges[i]);
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
            const status = mk.StripeStatus(ic);
            reason ??= Object.entries(STRIPE_REASONS).find(([name]) => o.ChFiDS_ErrorStatus?.[name] === status)?.[1];
        }
        if (!reason && mk.NbFaultyVertices() > 0) reason = 'the round could not be finished where it meets a corner; try a smaller radius';
        throw new BlendError(reason ?? 'the kernel could not build the round', failed);
    }
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
