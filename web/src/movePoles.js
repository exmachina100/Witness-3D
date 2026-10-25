// Moving a face's control points in the browser build (G on a face's points, Slide Surface CV), as
// w3d_move_face_poles does it on the desktop: the face's control surface (facePoles.js) with the
// points moved, the face made again on it and sewn back among the body's other faces. A point the
// face shares with another face moves in both (a block's corner is a point of each face meeting
// there); any other neighbour whose edge the move bends is filled again inside its new edges (a
// cylinder's flat end follows its rim), so the solid stays closed; open edges follow the surface.

import { boundaryEdges, numbered, numberedEdges, oc } from './Kernel.js';
import { controlSurface } from './facePoles.js';
import { assemble, refit, remade } from './rebuildFace.js';

const TORN = "those points hold an edge shared with another face; move the points inside it, or move the points of a sheet's open side";

/** `shape` with control points moved: `moves` is [[face, pole, [dx, dy, dz]]], poles numbered as facePoles gives them (rows of u, v fastest). */
export function moveFacePoles(shape, moves) {
    const o = oc();
    if (!moves?.length) throw new Error('select the face\'s control points to move');
    const all = numbered(shape, 'TopAbs_FACE').map(f => o.TopoDS.Face(f));
    const byFace = new Map();
    for (const [face, pole, by] of moves) {
        if (!by.every(Number.isFinite)) throw new Error('the move must be a number');
        byFace.set(face, [...(byFace.get(face) ?? []), [pole, by]]);
    }
    const surfaces = new Map(), surfaceOf = n => {
        if (!surfaces.has(n)) surfaces.set(n, all[n] ? controlSurface(all[n]) : null);
        return surfaces.get(n);
    };
    const poleAt = (s, k) => { const nv = s.NbVPoles(), p = s.Pole(Math.floor(k / nv) + 1, k % nv + 1); return [p.X(), p.Y(), p.Z()]; };
    // A point that sits where another face has one too (a block's corner is a corner of each of its
    // three faces) moves in every such face, so the faces stay joined, as Plasticity does.
    for (const [n, list] of [...byFace]) {
        const cs = surfaceOf(n);
        if (!cs) continue;
        for (const [k, by] of list) {
            if (!(k >= 0 && k < cs.surface.NbUPoles() * cs.surface.NbVPoles())) continue;
            const at = poleAt(cs.surface, k);
            all.forEach((_, m) => {
                const other = surfaceOf(m);
                if (!other) return;
                const count = other.surface.NbUPoles() * other.surface.NbVPoles();
                // In its own face too: a closed face's seam holds each point twice.
                for (let j = 0; j < count; j++) {
                    if (m === n && j === k) continue;
                    const q = poleAt(other.surface, j);
                    if (Math.hypot(q[0] - at[0], q[1] - at[1], q[2] - at[2]) > 1e-6) continue;
                    const mine = byFace.get(m) ?? [];
                    if (!mine.some(([i]) => i === j)) byFace.set(m, [...mine, [j, by]]);
                }
            });
        }
    }
    const replaced = new Map();
    let gap = 1e-4;
    for (const [n, list] of byFace) {
        const face = all[n];
        if (!face) throw new Error('that face no longer exists');
        const cs = surfaceOf(n);
        if (!cs) throw new Error('this build cannot move the points of that face; rebuild it first');
        const s = cs.surface, nv = s.NbVPoles();
        for (const [k, [dx, dy, dz]] of list) {
            if (!(k >= 0 && k < s.NbUPoles() * nv)) throw new Error('that control point no longer exists');
            const a = Math.floor(k / nv) + 1, c = k % nv + 1, p = s.Pole(a, c);
            s.SetPole(a, c, new o.gp_Pnt(p.X() + dx, p.Y() + dy, p.Z() + dz));
        }
        // A fitted surface stands off the face by its fit; the sewing covers that.
        if (!cs.exact) gap = Math.max(gap, 2e-3);
        replaced.set(n, remade(face, s, cs.bounds));
    }
    gap = Math.max(gap, followNeighbours(all, replaced));
    let result;
    try { result = assemble(shape, all, replaced, gap, 'the moved face', '; move the points less, or fewer of them'); }
    catch (e) { throw new Error(/closes the solid/.test(e.message) ? TORN : e.message); }
    // A sheet's faces stay joined.
    if (boundaryEdges(result).length > boundaryEdges(shape).length) throw new Error(TORN);
    return result;
}

/**
 * Neighbours of the moved faces whose shared edge the move bent, each made again to follow: its
 * surface carried along by how far each point of the shared edges moved (spread inward, nearest
 * edge points weighing most), refitted, and the face remade on it within its own edges. Adds them
 * to `replaced`; returns the sewing gap the refits need.
 */
function followNeighbours(all, replaced) {
    const o = oc(), moved = [...replaced.keys()];
    const SAMPLES = 24;
    let gap = 0;
    all.forEach((face, m) => {
        if (replaced.has(m)) return;
        const own = new o.BRepAdaptor_Surface(face, true);
        // Points of the shared edges: where they were, and where the moved face now has them.
        const pins = [];
        for (const e of numberedEdges(face)) {
            if (o.BRep_Tool.Degenerated(e)) continue;
            const n = moved.find(n => numberedEdges(all[n]).some(x => x.IsSame(e)));
            if (n === undefined) {
                // Its other edges stay put: pinned where they are.
                const c = new o.BRepAdaptor_Curve(e), here = new o.BRepAdaptor_Curve2d(e, face), [a, z] = [c.FirstParameter(), c.LastParameter()];
                for (let i = 0; i <= SAMPLES; i++) { const t = a + (z - a) * i / SAMPLES, p = c.Value(t); pins.push({ at: [p.X(), p.Y(), p.Z()], uv: here.Value(t), by: [0, 0, 0] }); }
                continue;
            }
            // A control surface runs on its face's parameters, so the edge's place on the old face
            // is its place on the moved one.
            const there = new o.BRepAdaptor_Curve2d(e, all[n]), here = new o.BRepAdaptor_Curve2d(e, face);
            const now = new o.BRepAdaptor_Surface(replaced.get(n), false), c = new o.BRepAdaptor_Curve(e);
            const [a, z] = [c.FirstParameter(), c.LastParameter()];
            for (let i = 0; i <= SAMPLES; i++) {
                const t = a + (z - a) * i / SAMPLES, was = c.Value(t), uv = there.Value(t), p = now.Value(uv.X(), uv.Y());
                pins.push({ at: [was.X(), was.Y(), was.Z()], uv: here.Value(t), by: [p.X() - was.X(), p.Y() - was.Y(), p.Z() - was.Z()] });
            }
        }
        if (!pins.length || pins.every(p => Math.hypot(...p.by) < 1e-6)) return;
        const start = controlSurface(face);
        if (!start) throw new Error(TORN);
        const spread = q => {
            let w = 0;
            const out = [0, 0, 0];
            for (const p of pins) {
                const d = Math.hypot(q[0] - p.at[0], q[1] - p.at[1], q[2] - p.at[2]);
                if (d < 1e-9) return p.by;
                const k = 1 / d ** 3;
                w += k;
                for (let j = 0; j < 3; j++) out[j] += k * p.by[j];
            }
            return out.map(x => x / w);
        };
        const at = (u, v) => { const p = own.Value(u, v), q = [p.X(), p.Y(), p.Z()], by = spread(q); return q.map((x, j) => x + by[j]); };
        const made = refit(at, start.bounds, [3, 3], [8, 8]);
        // How far the refit misses the moved edges: the sewing must close that.
        let miss = 0;
        for (const p of pins) {
            const q = made.Value(p.uv.X(), p.uv.Y());
            miss = Math.max(miss, Math.hypot(q.X() - p.at[0] - p.by[0], q.Y() - p.at[1] - p.by[1], q.Z() - p.at[2] - p.by[2]));
        }
        gap = Math.max(gap, 2 * miss + 1e-4);
        replaced.set(m, remade(face, made, start.bounds));
    });
    return gap;
}

/**
 * Plasticity's Subdivide on faces, as w3d_subdivide_faces: each of `faces` with its spans doubled
 * in u and v (a knot in the middle of every span) on its control surface, the same shape with twice
 * the control points.
 */
export function subdivideFaces(shape, faces) {
    const o = oc();
    if (!faces?.length) throw new Error('select the faces to subdivide');
    const all = numbered(shape, 'TopAbs_FACE').map(f => o.TopoDS.Face(f));
    const replaced = new Map();
    let gap = 1e-4;
    for (const n of faces) {
        const face = all[n];
        if (!face) throw new Error('that face no longer exists');
        const cs = controlSurface(face);
        if (!cs) throw new Error('this build cannot subdivide that face; rebuild it first');
        const s = cs.surface;
        if (s.NbUPoles() * s.NbVPoles() > 4096) throw new Error('that face already has as many control points as it can take');
        const mids = (count, knot) => Array.from({ length: count - 1 }, (_, i) => (knot(i + 1) + knot(i + 2)) / 2);
        const us = mids(s.NbUKnots(), i => s.UKnot(i)), vs = mids(s.NbVKnots(), i => s.VKnot(i));
        for (const u of us) s.InsertUKnot(u, 1, 1e-9, true);
        for (const v of vs) s.InsertVKnot(v, 1, 1e-9, true);
        if (!cs.exact) gap = Math.max(gap, 2e-3);
        replaced.set(n, remade(face, s, cs.bounds));
    }
    return assemble(shape, all, replaced, gap, 'the subdivided face');
}
