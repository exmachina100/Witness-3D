// Revolve, Loft and Sweep of drawn regions, and Offset Face, on OpenCascade WebAssembly. They
// mirror the desktop kernel (vendor/opencascade-sys/include/w3d.hxx); Offset Face here is limited to
// flat faces, since this OpenCascade build leaves out the per-face offset algorithm.

import * as THREE from 'three';
import { count, extrudeFace, facePlane, oc } from './Kernel.js';

const pnt = v => new (oc().gp_Pnt)(v.x, v.y, v.z);
const dir = v => new (oc().gp_Dir)(v.x, v.y, v.z);

/** A drawn curve's plane: origin, x, y and normal as vectors. */
function plane(c) {
    const o = new THREE.Vector3(...c.origin), n = new THREE.Vector3(...c.normal).normalize();
    const x = new THREE.Vector3(...c.x).projectOnPlane(n).normalize();
    return { o, x, y: n.clone().cross(x), n, at: ([u, v]) => o.clone().addScaledVector(x, u).addScaledVector(new THREE.Vector3().crossVectors(n, x), v) };
}

/** The curve as points in space (polylines) or an exact circle. */
function geometry(c) {
    const p = plane(c);
    if (c.kind === 'circle') return { circle: { center: p.at(c.center), normal: p.n, radius: c.radius, x: p.x, y: p.y } };
    return { points: c.points.map(q => p.at(q)), closed: !!c.closed };
}

function wireOf(g) {
    const o = oc();
    const mk = new o.BRepBuilderAPI_MakeWire();
    if (g.circle) {
        mk.Add(new o.BRepBuilderAPI_MakeEdge(new o.gp_Circ(new o.gp_Ax2(pnt(g.circle.center), dir(g.circle.normal)), g.circle.radius)).Edge());
        return mk;
    }
    const pts = g.points, n = pts.length;
    for (let i = 0; i < (g.closed ? n : n - 1); i++) mk.Add(new o.BRepBuilderAPI_MakeEdge(pnt(pts[i]), pnt(pts[(i + 1) % n])).Edge());
    return mk;
}

/** A closed curve's region as a wire, with its centre and normal. */
function section(c) {
    const g = geometry(c);
    if (!g.circle && (!g.closed || g.points.length < 3)) throw new Error('only a closed curve has a region');
    const centre = g.circle ? g.circle.center : g.points.reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(g.points.length);
    return { wire: wireOf(g).Wire(), centre, normal: plane(c).n };
}

const face = wire => new (oc().BRepBuilderAPI_MakeFace)(wire, true).Face();

export function revolve(c, axisPoint, axisDir, angle) {
    const o = oc();
    if (!Number.isFinite(angle) || Math.abs(angle) < 1e-9) return null;
    const d = new THREE.Vector3(...axisDir);
    if (d.length() < 1e-9) throw new Error('pick two different points for the axis');
    const a = Math.max(-2 * Math.PI, Math.min(2 * Math.PI, angle));
    const mk = new o.BRepPrimAPI_MakeRevol(face(section(c).wire), new o.gp_Ax1(pnt(new THREE.Vector3(...axisPoint)), dir(d.normalize())), a, true);
    if (!mk.IsDone()) throw new Error('the profile could not be revolved about that axis');
    return mk.Shape();
}

export function loft(cs) {
    const o = oc();
    if (cs.length < 2) throw new Error('select two regions or more to loft');
    const mk = new o.BRepOffsetAPI_ThruSections(true, false, 1e-6);
    for (const c of cs) mk.AddWire(section(c).wire);
    mk.Build(new o.Message_ProgressRange());
    if (!mk.IsDone()) throw new Error('no surface could be lofted through those profiles');
    return mk.Shape();
}

/** Point and tangent a fraction `f` along the path. */
function along(g, f) {
    if (g.circle) {
        const { center, radius, x, y } = g.circle, t = f * 2 * Math.PI;
        return { point: center.clone().addScaledVector(x, radius * Math.cos(t)).addScaledVector(y, radius * Math.sin(t)), tangent: x.clone().multiplyScalar(-Math.sin(t)).addScaledVector(y, Math.cos(t)) };
    }
    const pts = g.closed ? [...g.points, g.points[0]] : g.points;
    const lengths = pts.slice(1).map((p, i) => p.distanceTo(pts[i]));
    let s = f * lengths.reduce((a, b) => a + b, 0);
    for (let i = 0; i < lengths.length; i++) {
        if (s <= lengths[i] || i === lengths.length - 1) {
            const tangent = pts[i + 1].clone().sub(pts[i]).normalize();
            return { point: pts[i].clone().addScaledVector(tangent, Math.min(s, lengths[i])), tangent };
        }
        s -= lengths[i];
    }
}

export function sweep(c, path, twist = 0, scale = 1) {
    const o = oc();
    if (!Number.isFinite(twist) || !(scale > 0)) throw new Error('the end scale must be greater than zero');
    const prof = section(c), g = geometry(path);
    const plain = Math.abs(twist) < 1e-12 && Math.abs(scale - 1) < 1e-12;
    if (!plain && (g.circle || g.closed)) throw new Error('twist and scale need a path with two ends');
    // The profile a fraction `f` along: turned and scaled about its centre, then carried by the
    // path's own turn (parallel transport) and position, as on the desktop.
    const sectionAt = (f, steps) => {
        const t = new o.gp_Trsf();
        t.SetRotation(new o.gp_Ax1(pnt(prof.centre), dir(prof.normal)), twist * f);
        const grow = new o.gp_Trsf();
        grow.SetScale(pnt(prof.centre), 1 + (scale - 1) * f);
        const carry = new THREE.Quaternion();
        const start = along(g, 0);
        let prev = start.tangent;
        for (let i = 1; i <= steps; i++) {
            const tan = along(g, f * i / steps).tangent;
            carry.premultiply(new THREE.Quaternion().setFromUnitVectors(prev.clone().normalize(), tan.clone().normalize()));
            prev = tan;
        }
        const r = new o.gp_Trsf();
        const ax = new THREE.Vector3(carry.x, carry.y, carry.z);
        if (ax.length() > 1e-12) r.SetRotation(new o.gp_Ax1(pnt(start.point), dir(ax.normalize())), 2 * Math.acos(Math.min(1, Math.max(-1, carry.w))));
        const end = along(g, f).point;
        const move = new o.gp_Trsf();
        move.SetTranslation(pnt(start.point), pnt(end));
        const all = move.Multiplied(r).Multiplied(grow).Multiplied(t);
        return o.TopoDS.Wire(new o.BRepBuilderAPI_Transform(prof.wire, all, true, false).Shape());
    };
    if (Math.abs(twist) > 1e-12) {
        const n = Math.max(8, Math.ceil(Math.abs(twist) / (Math.PI / 12)));
        const mk = new o.BRepOffsetAPI_ThruSections(true, false, 1e-6);
        for (let i = 0; i <= n; i++) mk.AddWire(sectionAt(i / n, 4 * n));
        mk.CheckCompatibility(false);
        mk.Build(new o.Message_ProgressRange());
        if (!mk.IsDone()) throw new Error('the profile could not be twisted along that path');
        return mk.Shape();
    }
    const spine = wireOf(g);
    const mk = new o.BRepOffsetAPI_MakePipeShell(spine.Wire());
    mk.SetMode(false);
    mk.SetTransitionMode(o.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner);
    mk.Add(prof.wire, false, false);
    if (!plain) mk.Add(sectionAt(1, 64), spine.Vertex(), false, false);
    mk.Build(new o.Message_ProgressRange());
    if (!mk.IsDone()) throw new Error('the profile could not be swept along that path');
    if (!mk.MakeSolid()) throw new Error('the sweep did not close into a solid');
    return mk.Shape();
}

/** Flat faces pushed out (positive) or in; each face's slab is joined or cut. */
export function offsetFlatFaces(shape, faces, distance, booleanWithHistory, chain) {
    let s = shape, history = null;
    // Later faces keep their numbers only until the first boolean, so take their slabs up front.
    const slabs = faces.map(f => extrudeFace(shape, f, distance));
    for (const slab of slabs) {
        const r = booleanWithHistory(s, slab, distance > 0 ? 'union' : 'difference');
        history = history ? chain(history, r.history) : r.history;
        s = r.shape;
    }
    // A pushed face ends up as the slab's far face; it stays the face that was picked, as on the
    // desktop, so it keeps its ref.
    const moved = [];
    for (const f of faces) {
        const p = facePlane(shape, f), at = p.origin.clone().addScaledVector(p.normal, distance);
        for (let j = 0; j < count(s, 'TopAbs_FACE'); j++) {
            const q = facePlane(s, j);
            if (q && q.normal.dot(p.normal) > 1 - 1e-9 && Math.abs(q.origin.clone().sub(at).dot(p.normal)) < 1e-6) moved.push([f, j]);
        }
    }
    history.faces[0] = [...moved, ...history.faces[0].filter(([, j]) => !moved.some(([, k]) => k === j))];
    return { shape: s, history };
}
