// Plasticity's edge loops (Alt+click) and rings (Ctrl+Alt+click), and Select Adjacent, read off a
// body as the app shows it: its edge polylines and its faces' triangles. The manual names the keys
// only, so a loop and a ring follow the usual meaning for a grid of four-sided faces: a loop runs
// on through each corner where four edges meet (the edge sharing no face with the one before), or
// on into the one edge carrying straight on (a tangent chain, as round a fillet); a ring steps
// across each four-sided face to its opposite edge.

const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const unit = u => { const l = Math.hypot(...u); return l ? u.map(x => x / l) : u; };

/** Whether `q` lies within `tol` of the triangle (in its plane, inside or on its sides). */
function nearTriangle(q, [a, b, c], tol) {
    const n = cross(sub(b, a), sub(c, a)), l = Math.hypot(...n);
    if (l < 1e-12) return false;
    if (Math.abs(dot(sub(q, a), n)) / l > tol) return false;
    return [[a, b], [b, c], [c, a]].every(([s, e]) => dot(cross(sub(e, s), sub(q, s)), n) / l >= -tol * Math.hypot(...sub(e, s)));
}

const point = (e, i) => [e[3 * i], e[3 * i + 1], e[3 * i + 2]];

/**
 * The body's edge topology: for each edge its faces, its two end corners (keys) and its direction
 * leaving each end; for each corner its edges.
 */
export function topology(body) {
    const { positions: p, indices: ix, faceIds, edges } = body;
    let size = 0;
    for (let i = 0; i < p.length; i++) size = Math.max(size, Math.abs(p[i]));
    const tol = 1e-5 * (1 + size);
    const key = q => q.map(x => Math.round(x / (10 * tol))).join(',');
    const tris = [];
    for (let t = 0; t < faceIds.length; t++) {
        const tri = [0, 1, 2].map(k => { const i = ix[3 * t + k]; return [p[3 * i], p[3 * i + 1], p[3 * i + 2]]; });
        const lo = [0, 1, 2].map(k => Math.min(tri[0][k], tri[1][k], tri[2][k]) - tol), hi = [0, 1, 2].map(k => Math.max(tri[0][k], tri[1][k], tri[2][k]) + tol);
        tris.push({ tri, face: faceIds[t], lo, hi });
    }
    const corners = new Map();
    const info = edges.map((e, n) => {
        const count = e.length / 3;
        if (count < 2) return { faces: [], ends: [], dirs: [] };
        // A point inside the edge lies on the faces either side: its middle node where it has one
        // (a corner of those faces' triangles), else the middle of its one segment.
        const inner = count > 2, q = inner ? point(e, Math.floor(count / 2)) : point(e, 0).map((x, k) => (x + point(e, 1)[k]) / 2);
        const on = t => inner ? t.tri.some(v => Math.hypot(...sub(v, q)) < tol) : nearTriangle(q, t.tri, tol);
        const faces = [...new Set(tris.filter(t => q.every((x, k) => x >= t.lo[k] && x <= t.hi[k]) && on(t)).map(t => t.face))];
        const a = point(e, 0), b = point(e, count - 1);
        const ends = [key(a), key(b)];
        const dirs = [unit(sub(point(e, 1), a)), unit(sub(point(e, count - 2), b))];
        for (const k of new Set(ends)) { if (!corners.has(k)) corners.set(k, []); corners.get(k).push(n); }
        return { faces, ends, dirs };
    });
    return { info, corners };
}

/** The loop through edge `start`: the edge numbers, `start` first. */
export function edgeLoop(body, start, topo = topology(body)) {
    const { info, corners } = topo;
    const out = [start], seen = new Set(out);
    for (const side of [0, 1]) {
        let cur = start, at = info[start].ends[side], into = info[start].dirs[side];
        for (;;) {
            if (!at) break;
            const others = (corners.get(at) ?? []).filter(n => n !== cur);
            let next;
            if (others.length === 3) next = others.filter(n => !info[n].faces.some(f => info[cur].faces.includes(f)));
            else {
                // Carrying straight on: the edge leaving opposite to the way this one came in (within
                // about 11°, as a curved edge's first polyline segment leans off its tangent).
                next = others.filter(n => { const s = info[n].ends.indexOf(at); return s >= 0 && dot(info[n].dirs[s], into) < -0.98; });
            }
            if (next.length !== 1 || seen.has(next[0])) break;
            const n = next[0], s = info[n].ends.indexOf(at);
            seen.add(n);
            side ? out.push(n) : out.unshift(n);
            cur = n;
            at = info[n].ends[1 - s];
            into = info[n].dirs[1 - s];
        }
    }
    // The picked edge first, the rest in order round.
    const i = out.indexOf(start);
    return [...out.slice(i), ...out.slice(0, i)];
}

/** The ring through edge `start`: across each four-sided face to the edge opposite. */
export function edgeRing(body, start, topo = topology(body)) {
    const { info } = topo;
    const faceEdges = new Map();
    info.forEach((e, n) => { for (const f of e.faces) { if (!faceEdges.has(f)) faceEdges.set(f, []); faceEdges.get(f).push(n); } });
    const out = [start], seen = new Set(out);
    for (const f0 of info[start].faces) {
        let cur = start, face = f0;
        for (;;) {
            const own = faceEdges.get(face) ?? [];
            if (own.length !== 4) break;
            const opposite = own.filter(n => n !== cur && !info[n].ends.some(k => info[cur].ends.includes(k)));
            if (opposite.length !== 1 || seen.has(opposite[0])) break;
            cur = opposite[0];
            seen.add(cur);
            out.push(cur);
            const next = info[cur].faces.filter(f => f !== face);
            if (next.length !== 1) break;
            face = next[0];
        }
    }
    return out;
}

/**
 * Select Adjacent: what touches the selection on each body. Faces gain the faces sharing an edge
 * with them; edges gain the edges sharing a corner.
 */
export function adjacent(body, kind, picked, topo = topology(body)) {
    const { info, corners } = topo;
    const have = new Set(picked), out = new Set(picked);
    if (kind === 'edge') {
        for (const n of have) for (const k of info[n]?.ends ?? []) for (const m of corners.get(k) ?? []) out.add(m);
    } else if (kind === 'face') {
        for (const e of info) if (e.faces.some(f => have.has(f))) for (const f of e.faces) out.add(f);
    }
    return [...out];
}
