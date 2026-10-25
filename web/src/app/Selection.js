// What is selected, following Plasticity's selection model (manual: Selection Mode, Selecting
// Objects). Modes say which kinds a click can pick: 'point', 'edge', 'face', 'solid'. Edges and
// faces are held by number on a body and also as refs, so a selection survives edits that renumber
// the body (see Body.edgeRefs and Body.faceRefs in App.js).
//
// An item is { kind: 'solid', body }, { kind: 'edge' | 'face', body, n }, or a drawn curve or the
// region inside a closed one, { kind: 'curve' | 'region', id } (Plasticity's mode 2 picks curves
// with edges, mode 3 regions with faces), or a curve's vertex, { kind: 'vertex', id, n } (mode 1,
// points), or a face's control point shown by Toggle Points, { kind: 'pole', body, face, n } (mode 1).

export const KINDS = ['point', 'edge', 'face', 'solid'];

const keyOf = it => it.kind === 'solid' ? `s:${it.body}` : it.kind === 'curve' || it.kind === 'region' ? `${it.kind}:${it.id}`
    : it.kind === 'vertex' ? `vertex:${it.id}:${it.n}` : it.kind === 'pole' ? `pole:${it.body}:${it.face}:${it.n}` : `${it.kind[0]}:${it.body}:${it.n}`;
const onBody = it => it.body !== undefined;

export class Selection {
    constructor() {
        /** Active modes. Plasticity starts with every mode on. */
        this.modes = new Set(['point', 'edge', 'face', 'solid']);
        this.items = new Map();
    }

    // --- modes -------------------------------------------------------------
    setMode(kind) { this.modes = new Set(kind === 'all' ? KINDS : [kind]) }
    toggleMode(kind) {
        if (this.modes.has(kind) && this.modes.size > 1) this.modes.delete(kind);
        else this.modes.add(kind);
    }
    allows(kind) { return this.modes.has(kind) }

    // --- items -------------------------------------------------------------
    get size() { return this.items.size }
    has(it) { return this.items.has(keyOf(it)) }
    list(kind) { return [...this.items.values()].filter(it => !kind || it.kind === kind) }
    clear() { this.items.clear() }
    add(it) { this.items.set(keyOf(it), { ...it }) }
    remove(it) { this.items.delete(keyOf(it)) }
    toggle(it) { this.has(it) ? this.remove(it) : this.add(it) }
    replace(it) { this.clear(); if (it) this.add(it) }

    /** Selected solids' ids. */
    get solids() { return this.list('solid').map(it => it.body) }
    /** Selected edges grouped by body: Map<body, number[]>. */
    edgesByBody() { return group(this.list('edge')) }
    facesByBody() { return group(this.list('face')) }
    /** Every body that has anything selected on it. */
    get bodies() { return [...new Set(this.list().filter(onBody).map(it => it.body))] }
    /** Ids of the selected curves, and of the curves whose regions are selected. */
    get curves() { return [...new Set(this.list().filter(it => it.kind === 'curve' || it.kind === 'region').map(it => it.id))] }
    /** Drop curves and regions whose curve is gone; `ids` are the curves that exist. */
    keepCurves(ids) { for (const it of this.list()) if (!onBody(it) && !ids.includes(it.id)) this.remove(it) }

    /**
     * Change every item to `kind` (Plasticity's Ctrl+2, Ctrl+3, Ctrl+4): edges and faces of the
     * selected solids, or the solids of the selected edges and faces.
     */
    convert(kind, scene) {
        const out = [];
        for (const it of this.list()) {
            const b = scene.find(x => x.id === it.body);
            if (!b) { if (!onBody(it)) out.push(it); continue; }
            if (kind === 'solid') out.push({ kind: 'solid', body: b.id });
            else if (kind === 'edge') {
                if (it.kind === 'edge') out.push(it);
                else if (it.kind === 'solid') b.edges.forEach((_, n) => out.push({ kind: 'edge', body: b.id, n }));
                else if (it.kind === 'face') for (const n of faceEdges(b, it.n)) out.push({ kind: 'edge', body: b.id, n });
            } else if (kind === 'face') {
                if (it.kind === 'face') out.push(it);
                else if (it.kind === 'solid') b.facePlanes.forEach((_, n) => out.push({ kind: 'face', body: b.id, n }));
            }
        }
        this.clear();
        for (const it of out) this.add(it);
        this.modes.add(kind);
    }

    /** Everything the active modes can pick in `scene` (Plasticity's A): solids when they can be picked. */
    selectAll(scene) {
        for (const b of scene) {
            if (this.allows('solid')) this.add({ kind: 'solid', body: b.id });
            else if (this.allows('face')) b.facePlanes.forEach((_, n) => this.add({ kind: 'face', body: b.id, n }));
            else if (this.allows('edge')) b.edges.forEach((_, n) => this.add({ kind: 'edge', body: b.id, n }));
        }
    }

    /** Swap selected and unselected among the kinds already selected (Plasticity's Alt+A). */
    invert(scene) {
        const kinds = new Set(this.list().map(it => it.kind));
        if (!kinds.size) return this.selectAll(scene);
        const all = [];
        for (const b of scene) {
            if (kinds.has('solid')) all.push({ kind: 'solid', body: b.id });
            if (kinds.has('face')) b.facePlanes.forEach((_, n) => all.push({ kind: 'face', body: b.id, n }));
            if (kinds.has('edge')) b.edges.forEach((_, n) => all.push({ kind: 'edge', body: b.id, n }));
        }
        const was = new Set(this.items.keys());
        this.clear();
        for (const it of all) if (!was.has(keyOf(it))) this.add(it);
    }

    /** The selection as refs, to carry across a scene change. */
    toRefs(scene) {
        return this.list().map(it => {
            if (it.kind === 'solid' || !onBody(it)) return it;
            const b = scene.find(x => x.id === it.body);
            if (it.kind === 'pole') return { ...it, ref: b?.faceRefs?.[it.face] };
            const refs = it.kind === 'edge' ? b?.edgeRefs : b?.faceRefs;
            return { ...it, ref: refs?.[it.n] };
        });
    }

    /** Re-select saved refs in a new scene. Items whose body or ref is gone are dropped. */
    fromRefs(saved, scene) {
        this.clear();
        for (const it of saved) {
            if (!onBody(it)) { this.add(it); continue; }
            const b = scene.find(x => x.id === it.body);
            if (!b) continue;
            if (it.kind === 'solid') { this.add(it); continue; }
            if (it.kind === 'pole') {
                // The face's control points keep their numbers while the face keeps its net.
                b.faceRefs?.forEach((r, face) => { if (r === it.ref) this.add({ kind: 'pole', body: b.id, face, n: it.n }); });
                continue;
            }
            const refs = it.kind === 'edge' ? b.edgeRefs : b.faceRefs;
            if (!refs?.length || it.ref === undefined) continue;
            refs.forEach((r, n) => { if (r === it.ref) this.add({ kind: it.kind, body: b.id, n }); });
        }
    }
}

function group(items) {
    const m = new Map();
    for (const it of items) m.set(it.body, [...(m.get(it.body) ?? []), it.n].sort((a, b) => a - b));
    return m;
}

/** Edges on a face's boundary: those whose every point lies on the face's plane (flat faces only). */
export function faceEdges(body, face) {
    const p = body.facePlanes[face];
    if (!p) return [];
    const [ox, oy, oz] = p.origin, [nx, ny, nz] = p.normal;
    const out = [];
    body.edges.forEach((e, n) => {
        for (let i = 0; i < e.length; i += 3) if (Math.abs((e[i] - ox) * nx + (e[i + 1] - oy) * ny + (e[i + 2] - oz) * nz) > 1e-4) return;
        out.push(n);
    });
    return out;
}

/**
 * The edges that bound one flat face: {@link faceEdges} keeps every edge lying in the face's plane,
 * which takes in a neighbouring face's edges when two faces share a plane; here an edge must also
 * touch one of the face's own triangles at its middle.
 */
export function faceBoundEdges(body, face) {
    const { positions: p, indices: ix, faceIds } = body;
    const tris = [];
    for (let t = 0; t < faceIds.length; t++) if (faceIds[t] === face) tris.push([0, 1, 2].map(k => { const i = ix[3 * t + k]; return [p[3 * i], p[3 * i + 1], p[3 * i + 2]]; }));
    return faceEdges(body, face).filter(n => {
        const e = body.edges[n], m = Math.max(0, Math.floor((e.length / 3 - 1) / 2));
        // The middle of the edge's middle segment.
        const q = [0, 1, 2].map(k => (e[3 * m + k] + e[3 * Math.min(m + 1, e.length / 3 - 1) + k]) / 2);
        return tris.some(t => nearTriangle(q, t, 1e-4));
    });
}

/** Whether `q` lies within `tol` of the triangle (in its plane, inside or on its sides). */
function nearTriangle(q, [a, b, c], tol) {
    const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
    const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const n = cross(sub(b, a), sub(c, a)), l = Math.hypot(...n);
    if (l < 1e-12) return false;
    if (Math.abs(dot(sub(q, a), n)) / l > tol) return false;
    // Inside or within tol of each side, measured in the plane.
    return [[a, b], [b, c], [c, a]].every(([s, e]) => dot(cross(sub(e, s), sub(q, s)), n) / l >= -tol * Math.hypot(...sub(e, s)));
}
