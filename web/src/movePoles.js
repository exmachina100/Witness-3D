// Moving a face's control points in the browser build (G on a face's points, Slide Surface CV), as
// w3d_move_face_poles does it on the desktop: the face's control surface (facePoles.js) with the
// points moved, the face made again on it and sewn back among the body's other faces. Edges the
// face shares with another face move only with points the other face has too (a block's corner is
// a point of each face meeting there, and moves in all of them); its own open edges follow the surface.

import { boundaryEdges, numbered, oc } from './Kernel.js';
import { controlSurface } from './facePoles.js';
import { assemble, remade } from './rebuildFace.js';

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
                if (m === n) return;
                const other = surfaceOf(m);
                if (!other) return;
                const count = other.surface.NbUPoles() * other.surface.NbVPoles();
                for (let j = 0; j < count; j++) {
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
    let result;
    try { result = assemble(shape, all, replaced, gap, 'the moved face', '; move the points less, or fewer of them'); }
    catch (e) { throw new Error(/closes the solid/.test(e.message) ? TORN : e.message); }
    // A sheet's faces stay joined.
    if (boundaryEdges(result).length > boundaryEdges(shape).length) throw new Error(TORN);
    return result;
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
