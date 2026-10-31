// Plasticity's smart clicks (manual: Selecting Objects): Alt+click a face selects all related
// faces, Ctrl+Alt+click all parallel faces (parallel cylindrical faces for a cylinder); Alt+click a
// curve or region selects all curves or regions on the same plane. The manual doesn't say what
// "related" means; we read it as the faces running smoothly on from the one clicked, across edges
// where they meet without a crease (a fillet with the faces it blends, a box's coplanar pieces).

const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const unit = u => { const l = Math.hypot(...u); return l ? u.map(x => x / l) : u; };

/** Whether two planes (origin, normal) are one plane, within `tol` mm and about 0.06°. */
export function samePlane(a, b, tol = 1e-4) {
    return Math.abs(dot(unit(a.normal), unit(b.normal))) > 1 - 1e-6 && Math.abs(dot(sub(b.origin, a.origin), unit(a.normal))) < tol;
}

/** The faces whose planes are parallel to face `start`'s (either way round): flat faces only. */
export function parallelFlatFaces(planes, start) {
    const p = planes[start];
    if (!p) return [start];
    return planes.flatMap((q, n) => q && Math.abs(dot(unit(q.normal), unit(p.normal))) > 1 - 1e-6 ? [n] : []);
}

/** Cylindrical faces with axes parallel to face `start`'s (surfaces as faceSurfaces gives them). */
export function parallelCylinders(surfaces, start) {
    const s = surfaces[start];
    if (s?.kind !== 'cylinder') return [start];
    return surfaces.flatMap((q, n) => q?.kind === 'cylinder' && Math.abs(dot(unit(q.axis), unit(s.axis))) > 1 - 1e-6 ? [n] : []);
}

/**
 * The faces reached from `start` across edges where the faces either side meet smoothly (normals
 * within `deg` at the edge's middle, read off the display triangles, so a few degrees of facet
 * error are allowed for). `topo` is edgeLoops.js topology(body).
 */
export function relatedFaces(body, start, topo, deg = 10) {
    const { positions: p, indices: ix, faceIds, edges } = body;
    const cos = Math.cos(deg * Math.PI / 180);
    // A face's normal near point q: the normal of its triangle with a corner nearest q.
    const near = (face, q) => {
        let best = null, bestD = Infinity;
        for (let t = 0; t < faceIds.length; t++) {
            if (faceIds[t] !== face) continue;
            const tri = [0, 1, 2].map(k => { const i = ix[3 * t + k]; return [p[3 * i], p[3 * i + 1], p[3 * i + 2]]; });
            const d = Math.min(...tri.map(v => Math.hypot(...sub(v, q))));
            const n = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]));
            if (Math.hypot(...n) < 1e-14) continue;
            if (d < bestD) { bestD = d; best = unit(n); }
        }
        return best;
    };
    const smooth = topo.info.map((e, n) => {
        if (e.faces.length !== 2) return false;
        const pts = edges[n], count = pts.length / 3, m = Math.floor((count - 1) / 2);
        const q = count > 2 ? [pts[3 * m], pts[3 * m + 1], pts[3 * m + 2]] : [0, 1, 2].map(k => (pts[k] + pts[3 + k]) / 2);
        const a = near(e.faces[0], q), b = near(e.faces[1], q);
        return !!a && !!b && dot(a, b) > cos;
    });
    const out = new Set([start]), todo = [start];
    while (todo.length) {
        const f = todo.pop();
        topo.info.forEach((e, n) => {
            if (!smooth[n] || !e.faces.includes(f)) return;
            const g = e.faces.find(x => x !== f);
            if (g !== undefined && !out.has(g)) { out.add(g); todo.push(g); }
        });
    }
    return [...out].sort((a, b) => a - b);
}
