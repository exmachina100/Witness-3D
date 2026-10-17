// Plasticity's Patch in the browser build, as w3d_patch does it on the desktop: a sheet filling one
// closed loop of drawn curves and body edges. A flat loop with no tangent edges is filled with its
// plane; anything else with an energy-minimising plate (GeomPlate), which is a height field over its
// first guess, so walls standing square to the loop are refused rather than met.
//
// The browser's OpenCascade lacks the desktop's free-bounds joiner and plane finder, so the loop is
// chained and its flatness checked here.

import * as THREE from 'three';
import { numbered, numberedEdges, oc } from './Kernel.js';
import { curveWire } from './Forms.js';

/** How far apart the loop's pieces may be and still join; a tenth of how far the sheet may stray. */
const TOL = 1e-3;
/** The most a tangent edge may be off tangent, in degrees: the quality bar. */
const TANGENT = 0.5;

const point = p => new THREE.Vector3(p.X(), p.Y(), p.Z());

/** An edge's points, `n` + 1 of them, end to end. */
function along(edge, n = 16) {
    const { returnValue: g, First, Last } = oc().BRep_Tool.Curve(edge, 0, 0);
    if (!g) return [];
    return Array.from({ length: n + 1 }, (_, i) => point(g.Value(First + (Last - First) * i / n)));
}

/** The pieces in loop order (each `{ edge, face, ends }`), or throws saying why they do not make one closed loop. */
function loop(pieces) {
    const left = [...pieces], run = [left.shift()];
    let tail = run[0].ends[1];
    while (left.length) {
        const i = left.findIndex(p => p.ends[0].distanceTo(tail) < TOL || p.ends[1].distanceTo(tail) < TOL);
        if (i < 0) throw new Error('the curves and edges must join end to end into one loop');
        const [p] = left.splice(i, 1);
        tail = p.ends[0].distanceTo(tail) < TOL ? p.ends[1] : p.ends[0];
        run.push(p);
    }
    if (tail.distanceTo(run[0].ends[0]) > TOL) throw new Error('the loop is open; its ends must meet');
    return run;
}

/** Whether `pts` all lie in one plane, within TOL. */
function flat(pts) {
    const a = pts[0];
    let n = null;
    for (let i = 1; i < pts.length && !n; i++) for (let j = i + 1; j < pts.length && !n; j++) {
        const c = new THREE.Vector3().subVectors(pts[i], a).cross(new THREE.Vector3().subVectors(pts[j], a));
        if (c.length() > 1e-6 * Math.max(1, pts[i].distanceTo(a) * pts[j].distanceTo(a))) n = c.normalize();
    }
    return !n || pts.every(p => Math.abs(new THREE.Vector3().subVectors(p, a).dot(n)) < TOL);
}

/** The face of `shape` beside `edge`, the first found; throws `why` when there is none. */
export function faceBeside(shape, edge, why = 'a tangent edge needs a face beside it') {
    const o = oc();
    for (const f of numbered(shape, 'TopAbs_FACE')) {
        for (const e of numberedEdges(f)) if (e.IsSame(edge)) return o.TopoDS.Face(f);
    }
    throw new Error(why);
}

/**
 * The sheet filling one closed loop of drawn `curves` and body `edges` ({ shape, n, tangent }, `n`
 * numbered within the body). Throws when the loop does not close or the sheet cannot meet it.
 */
export function patch(curves, edges) {
    const o = oc();
    const pieces = [];
    for (const c of curves) for (const e of numberedEdges(curveWire(c))) pieces.push({ edge: e, face: null });
    for (const { shape, n, tangent } of edges) {
        const e = numberedEdges(shape)[n];
        if (!e) throw new Error('that edge no longer exists');
        pieces.push({ edge: e, face: tangent ? faceBeside(shape, e) : null });
    }
    if (!pieces.length) throw new Error('select a closed loop of curves or edges to patch');
    for (const p of pieces) { const pts = along(p.edge); p.points = pts; p.ends = [pts[0], pts.at(-1)]; }
    const ordered = loop(pieces);

    const smooth = pieces.some(p => p.face);
    if (!smooth && flat(pieces.flatMap(p => p.points))) {
        const mk = new o.BRepBuilderAPI_MakeWire();
        for (const p of ordered) mk.Add(p.edge);
        if (mk.IsDone()) {
            const face = new o.BRepBuilderAPI_MakeFace(mk.Wire(), true);
            if (face.IsDone()) return face.Face();
        }
    }
    const fill = new o.BRepOffsetAPI_MakeFilling(3, 15, 2, false, 1e-5, TOL, 0.01, 0.1, 8, 9);
    for (const p of pieces) {
        if (p.face) fill.Add(p.edge, p.face, o.GeomAbs_Shape.GeomAbs_G1, true);
        else fill.Add(p.edge, o.GeomAbs_Shape.GeomAbs_C0, true);
    }
    fill.Build(new o.Message_ProgressRange());
    if (!fill.IsDone()) throw new Error('no surface could be filled inside that loop');
    if (fill.G0Error() > 10 * TOL) throw new Error(`the patch misses its boundary by ${fill.G0Error()} mm`);
    const off = fill.G1Error() * 180 / Math.PI;
    if (smooth && off > TANGENT) throw new Error(`the patch meets the faces up to ${off.toFixed(2)} degrees off tangent; try plain (G0) edges where the walls stand square to the loop`);
    return fill.Shape();
}

/** Whether `shape` holds no solid: a sheet, as Patch makes. */
export function isSheet(shape) {
    return numbered(shape, 'TopAbs_SOLID').length === 0;
}
