// Plasticity's Project Outline in the browser build, as w3d_project_outline does it on the desktop:
// hidden-line removal draws every sharp edge and silhouette on the plane, they split a sheet
// covering them, the pieces the body casts its shadow on are kept and merged, and the merged
// region's boundary is the outline, holes through the body included.
//
// The browser's OpenCascade lacks the face classifier and the ray-face intersector, so a point
// inside each piece comes from its mesh and the shadow test casts the line against the body's mesh.

import * as THREE from 'three';
import { numbered, numberedEdges, oc, tessellate } from './Kernel.js';
import { bspline, chains, triangles } from './Project.js';

/** Whether the whole line through `p` along `d` crosses a triangle. */
function crosses(tris, p, d) {
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), h = new THREE.Vector3(), s = new THREE.Vector3(), q = new THREE.Vector3();
    for (const t of tris) {
        e1.subVectors(t.b, t.a); e2.subVectors(t.c, t.a);
        h.crossVectors(d, e2);
        const det = e1.dot(h);
        if (Math.abs(det) < 1e-14) continue;
        s.subVectors(p, t.a);
        const u = s.dot(h) / det;
        if (u < 0 || u > 1) continue;
        q.crossVectors(s, e1);
        const v = d.dot(q) / det;
        if (v >= 0 && u + v <= 1) return true;
    }
    return false;
}

/** A point well inside `face`: the centroid of its largest mesh triangle. */
function inside(face) {
    const { mesh } = tessellate(face, { deflection: 0.01 });
    const pos = mesh.getAttribute('position'), idx = mesh.getIndex()?.array ?? [];
    let best = null, area = 0;
    for (let i = 0; i < idx.length; i += 3) {
        const [a, b, c] = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(pos, idx[i + k]));
        const ar = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).length();
        if (ar > area) { area = ar; best = a.add(b).add(c).divideScalar(3); }
    }
    return best;
}

/**
 * The outline of `shape` seen along `normal`, drawn on the plane through `origin` whose x is `x`
 * (THREE.Vector3s), as NURBS in model space. Throws when the body casts no outline there.
 */
export function projectOutline(shape, origin, normal, x) {
    const o = oc();
    const n = normal.clone().normalize();
    const frame = new o.gp_Ax2(new o.gp_Pnt(origin.x, origin.y, origin.z), new o.gp_Dir(n.x, n.y, n.z), new o.gp_Dir(x.x, x.y, x.z));
    const hlr = new o.HLRBRep_Algo();
    hlr.Add(shape, 0);
    hlr.Projector(new o.HLRAlgo_Projector(frame));
    hlr.Update();
    hlr.Hide();
    const out = new o.HLRBRep_HLRToShape(hlr);
    // HLR draws in the frame's own x, y; carry it back onto the plane in model space.
    const place = new o.gp_Trsf();
    place.SetTransformation(new o.gp_Ax3(frame), new o.gp_Ax3());
    const tools = new o.NCollection_List_TopoDS_Shape();
    const box = new THREE.Box3();
    let any = false;
    for (const c of [out.VCompound(), out.OutLineVCompound(), out.HCompound(), out.OutLineHCompound(), out.Rg1LineVCompound()]) {
        if (c.IsNull()) continue;
        for (const e of numberedEdges(c)) {
            o.BRepLib.BuildCurves3d(e, 1e-5, o.GeomAbs_Shape.GeomAbs_C1, 14, 0);
            const moved = new o.BRepBuilderAPI_Transform(e, place, true, false).Shape();
            tools.Append(moved);
            for (const v of numbered(moved, 'TopAbs_VERTEX')) { const p = o.BRep_Tool.Pnt(o.TopoDS.Vertex(v)); box.expandByPoint(new THREE.Vector3(p.X(), p.Y(), p.Z())); }
            any = true;
        }
    }
    if (!any) throw new Error("the body has no outline seen along that plane's normal");
    // A sheet on the plane covering every line, split by them.
    // Round the plane's origin, out past the farthest line (the body need not sit over the origin).
    const size = Math.max(...[box.min.x, box.max.x].flatMap(x => [box.min.y, box.max.y].flatMap(y => [box.min.z, box.max.z].map(z => origin.distanceTo(new THREE.Vector3(x, y, z)))))) + 10;
    const sheet = new o.BRepBuilderAPI_MakeFace(new o.gp_Pln(new o.gp_Pnt(origin.x, origin.y, origin.z), new o.gp_Dir(n.x, n.y, n.z)), -size, size, -size, size).Face();
    const args = new o.NCollection_List_TopoDS_Shape();
    args.Append(sheet);
    const split = new o.BRepAlgoAPI_Splitter();
    split.SetArguments(args);
    split.SetTools(tools);
    split.Build(new o.Message_ProgressRange());
    if (!split.IsDone()) throw new Error('the outline could not be traced');
    // Keep the pieces in the body's shadow: the line through a point inside each, along the normal, meets the body.
    const tris = triangles(shape);
    const shadow = numbered(split.Shape(), 'TopAbs_FACE').map(f => o.TopoDS.Face(f)).filter(f => { const p = inside(f); return p && crosses(tris, p, n); });
    if (!shadow.length) throw new Error('the body casts no shadow on that plane');
    const sew = new o.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);
    for (const f of shadow) sew.Add(f);
    sew.Perform(new o.Message_ProgressRange());
    const unify = new o.ShapeUpgrade_UnifySameDomain(sew.SewedShape(), true, true, true);
    unify.Build();
    const merged = unify.Shape();
    // The outline is the edges bounding the shadow: those on one shadow face only.
    const faces = numbered(merged, 'TopAbs_FACE');
    const rim = numberedEdges(merged).filter(e => faces.filter(f => numberedEdges(f).some(g => g.IsSame(e))).length === 1);
    const curves = chains(rim.map(e => bspline(e)));
    if (!curves.length) throw new Error('the outline could not be traced');
    return curves;
}
