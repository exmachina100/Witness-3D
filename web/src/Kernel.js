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
    const o = oc();
    const Op = { union: o.BRepAlgoAPI_Fuse, difference: o.BRepAlgoAPI_Cut, intersection: o.BRepAlgoAPI_Common }[op];
    const algo = new Op(a, b, new o.Message_ProgressRange());
    if (!algo.IsDone() || algo.HasErrors()) throw new Error(`Boolean ${op} failed`);
    const unify = new o.ShapeUpgrade_UnifySameDomain(algo.Shape(), true, true, false);
    unify.Build();
    return unify.Shape();
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

    // Each edge is visited once per adjacent face; key on its sampled points to draw it once.
    const segments = [], seen = new Set();
    for (const ex = new o.TopExp_Explorer(shape, o.TopAbs_ShapeEnum.TopAbs_EDGE, o.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
        const edge = o.TopoDS.Edge(ex.Current());
        const curve = new o.BRepAdaptor_Curve(edge);
        // Lines need only their ends; curves are sampled evenly in parameter, enough for display.
        const u0 = curve.FirstParameter(), u1 = curve.LastParameter();
        const n = curve.GetType() === o.GeomAbs_CurveType.GeomAbs_Line ? 1 : Math.max(8, Math.ceil(Math.abs(u1 - u0) / angle * 2));
        const pts = [];
        for (let i = 0; i <= n; i++) {
            const p = curve.Value(u0 + (u1 - u0) * i / n);
            pts.push([p.X(), p.Y(), p.Z()]);
        }
        const key = pts.map(p => p.map(c => c.toFixed(5)).join(',')).sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        for (let i = 0; i < pts.length - 1; i++) segments.push(...pts[i], ...pts[i + 1]);
    }
    const edges = new THREE.BufferGeometry();
    edges.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
    return { mesh, edges };
}

/** The planar face of `shape` at `faceIndex` (as numbered by tessellate) — its plane, for sketching on. */
export function facePlane(shape, faceIndex) {
    const o = oc();
    let i = 0;
    for (const ex = new o.TopExp_Explorer(shape, o.TopAbs_ShapeEnum.TopAbs_FACE, o.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next(), i++) {
        if (i !== faceIndex) continue;
        const face = o.TopoDS.Face(ex.Current());
        const surface = new o.BRepAdaptor_Surface(face, true);
        if (surface.GetType() !== o.GeomAbs_SurfaceType.GeomAbs_Plane) return undefined;
        const pln = surface.Plane();
        const d = pln.Axis().Direction();
        const n = new THREE.Vector3(d.X(), d.Y(), d.Z());
        if (face.Orientation() === o.TopAbs_Orientation.TopAbs_REVERSED) n.negate();
        return { normal: n };
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
