// The browser backend for App.js: OpenCascade compiled to WebAssembly, on the page's own thread.
// It speaks the same protocol as the desktop app's Rust engine, so one UI drives both.

import * as THREE from 'three';
import { ExtrudeFactory } from '../ExtrudeFactory.js';
import { NoOpError } from '../GeometryFactory.js';
import { blendEdges, booleanWithHistory, box, count, exportSTEP, facePlane, numberedEdges, tessellate, transform, volume } from '../Kernel.js';

const v3 = a => new THREE.Vector3(...a);

export class LocalBackend {
    info = { kernel: 'OPENCASCADE · WASM', units: 'mm' };

    constructor() {
        this.shapes = new Map();
        // Per body, persistent face and edge ids by number, as in the Rust Document (document.rs).
        this.refs = new Map();
        this.nextId = 1;
        this.nextRef = 1;
        this.revision = 0;
        this.undoStack = [];
        this.redoStack = [];
        this.pending = null;
        this.running = false;
        // Drawn curves by id: { origin, x, normal, kind: 'polyline' | 'circle', points, closed, center, radius }.
        this.curveMap = new Map();
        this.nextCurve = 1;
        // The product-enclosure blank, in millimetres, as on the desktop.
        this.put(this.nextId++, box(new THREE.Vector3(-40, 0, -25), new THREE.Vector3(40, 30, 25)));
    }

    fresh(n) { const start = this.nextRef; this.nextRef += n; return Array.from({ length: n }, (_, i) => start + i) }

    /** Store a body. With `history`, its faces and edges inherit the refs of what they came from. */
    put(id, shape, history) {
        const nf = count(shape, 'TopAbs_FACE'), ne = numberedEdges(shape).length;
        const old = this.refs.get(id);
        const inherit = (n, pairs, from) => {
            const out = new Array(n).fill(null);
            if (history && from) for (const [a, b] of pairs) if (out[b] === null && from[a] !== undefined) out[b] = from[a];
            return out.map(r => r ?? this.fresh(1)[0]);
        };
        this.shapes.set(id, shape);
        this.refs.set(id, { faces: inherit(nf, history?.faces[0] ?? [], old?.faces), edges: inherit(ne, history?.edges[0] ?? [], old?.edges) });
    }

    body(id, shape) {
        const { mesh, polylines } = tessellate(shape, { deflection: 0.05 });
        const index = mesh.index.array, faceIndex = mesh.getAttribute('faceIndex').array;
        const faceIds = new Uint32Array(index.length / 3);
        for (let t = 0; t < faceIds.length; t++) faceIds[t] = faceIndex[index[3 * t]];
        const facePlanes = Array.from({ length: count(shape, 'TopAbs_FACE') }, (_, i) => {
            const p = facePlane(shape, i);
            return p ? { origin: p.origin.toArray(), normal: p.normal.toArray() } : null;
        });
        return { id, positions: mesh.getAttribute('position').array, indices: Array.from(index), faceIds, facePlanes, edges: polylines, volume: volume(shape), faceRefs: [], edgeRefs: [], revision: 0 };
    }

    bodies() {
        return [...this.shapes].map(([id, s]) => {
            const { faces, edges } = this.refs.get(id);
            return { ...this.body(id, s), faceRefs: faces, edgeRefs: edges, revision: this.revision };
        });
    }

    /** Run the extrude through Plasticity's factory logic (ExtrudeFactory.calculate). */
    async run(req) {
        const f = new ExtrudeFactory({ shape: id => this.shapes.get(id) });
        if (req.region !== undefined && req.region !== null) {
            const c = this.curveMap.get(req.region);
            if (!c) throw new Error('that curve no longer exists');
            const shape = regionShape(c);
            if (!shape) throw new Error('only a closed curve has a region to extrude');
            f.profile = shape;
            f.origin.copy(v3(c.origin)); f.normal.copy(v3(c.normal)); f.xAxis.copy(v3(c.x));
        } else if (req.face !== undefined && req.face !== null) {
            f.face = req.face;
        } else {
            f.profile = req.profile.kind === 'circle'
                ? new THREE.Shape().absarc(0, 0, req.profile.radius, 0, Math.PI * 2, false)
                : new THREE.Shape().moveTo(-req.profile.width / 2, -req.profile.height / 2).lineTo(req.profile.width / 2, -req.profile.height / 2)
                    .lineTo(req.profile.width / 2, req.profile.height / 2).lineTo(-req.profile.width / 2, req.profile.height / 2).closePath();
            f.origin.copy(v3(req.origin));
            f.normal.copy(v3(req.normal));
            f.xAxis.copy(v3(req.xAxis));
        }
        f.distance = req.distance;
        f.target = req.target ?? undefined;
        f.operation = req.newBody || req.op === 'new' ? 'new' : ({ union: 'union', difference: 'difference', intersect: 'intersection' })[req.op] ?? 'auto';
        const [r] = await f.calculate();
        const outcome = r.replaces === undefined ? 'new' : ({ union: 'join', difference: 'cut', intersection: 'intersect' })[f.operationType];
        return { f, r, outcome };
    }

    /** Drawn curves, as { id, ...curve }. */
    curves() { return [...this.curveMap].map(([id, c]) => ({ id, ...structuredClone(c) })) }

    /** Add drawn curves, as one undo step. */
    async addCurves(list) {
        if (!list.length) throw new Error('nothing to do');
        for (const c of list) checkCurve(c);
        this.checkpoint();
        return { ids: list.map(c => { const id = this.nextCurve++; this.curveMap.set(id, structuredClone(c)); return id; }) };
    }

    /** Delete bodies and curves together, as one undo step. */
    async deleteItems(bodies = [], curves = []) {
        if (!bodies.length && !curves.length) throw new Error('nothing to do');
        if (bodies.some(id => !this.shapes.has(id))) throw new Error('that body no longer exists');
        if (curves.some(id => !this.curveMap.has(id))) throw new Error('that curve no longer exists');
        this.checkpoint();
        for (const id of bodies) { this.shapes.delete(id); this.refs.delete(id); }
        for (const id of curves) this.curveMap.delete(id);
        return this.bodies();
    }

    /** The target after a boolean with each tool in turn, and the chained history. */
    booleanResult({ target, tools, op }) {
        const kind = { union: 'union', auto: 'union', difference: 'difference', intersect: 'intersection' }[op];
        if (!kind) throw new Error('a boolean needs union, difference or intersect');
        if (!tools?.length) throw new Error('select a tool body as well as the target');
        if (tools.includes(target)) throw new Error("the target can't also be a tool");
        if (![target, ...tools].every(id => this.shapes.has(id))) throw new Error('that body no longer exists');
        let shape = this.shapes.get(target), history = null;
        for (const t of tools) {
            const r = booleanWithHistory(shape, this.shapes.get(t), kind);
            history = history ? chain(history, r.history) : r.history;
            shape = r.shape;
        }
        if (count(shape, 'TopAbs_FACE') === 0) throw new Error('the boolean leaves nothing');
        return { shape, history };
    }

    previewBoolean(req) {
        return this.latest(async () => this.body(req.target, this.booleanResult(req).shape));
    }

    /** Plasticity's Boolean: the target changes and the tools go unless kept, as one undo step. */
    async commitBoolean(req) {
        const { shape, history } = this.booleanResult(req);
        this.checkpoint();
        this.put(req.target, shape, history);
        if (!req.keepTools) for (const id of req.tools) { this.shapes.delete(id); this.refs.delete(id); }
        return { id: req.target, scene: this.bodies() };
    }

    scene() { return this.bodies() }

    /** Only the newest of the requests queued during a computation runs; the others resolve to null. */
    preview(req) {
        return this.latest(async () => {
            try {
                const { f, r, outcome } = await this.run(req);
                return { outcome, tool: this.body(0, f.tool()), result: r.replaces === undefined ? null : this.body(r.replaces, r.shape) };
            } catch (e) {
                if (e instanceof NoOpError) return { outcome: 'none', tool: null, result: null };
                throw e;
            }
        });
    }

    /** The body as it would be after a fillet or chamfer; throws BlendError (with `edges`) on failure. */
    previewBlend(req) {
        return this.latest(async () => this.body(req.body, this.blend(req)));
    }

    blend({ body, edges, size, kind, angle = Math.PI / 4 }, withHistory = false) {
        const shape = this.shapes.get(body);
        if (!shape) throw new Error('that body no longer exists');
        if (!edges.length) throw new Error('select at least one edge');
        if (!(size > 0)) throw new Error(`the ${kind === 'chamfer' ? 'distance' : 'radius'} must be greater than zero`);
        if (kind === 'chamfer' && !(angle > 0 && angle < Math.PI / 2)) throw new Error('the chamfer angle must be between 0 and 90 degrees');
        return blendEdges(shape, [...new Set(edges)], size, kind === 'chamfer', withHistory, angle);
    }

    async commitBlend(req) {
        const { shape, history } = this.blend(req, true);
        this.checkpoint();
        this.put(req.body, shape, history);
        return { id: req.body, scene: this.bodies() };
    }

    /** Move, turn or scale bodies about one pivot. Faces and edges keep their numbers and refs. */
    async commitMotion({ bodies, offset = [0, 0, 0], pivot = [0, 0, 0], axis = [0, 1, 0], angle = 0, scale = 1 }) {
        if (!bodies?.length) throw new Error('select something to transform');
        if (bodies.some(id => !this.shapes.has(id))) throw new Error('that body no longer exists');
        if ([...offset, ...pivot, ...axis, angle, scale].some(v => !Number.isFinite(v))) throw new Error('the move, turn or scale is not a valid number');
        if (!(scale > 0)) throw new Error('the scale must be greater than zero');
        if (Math.hypot(...offset) < 1e-12 && Math.abs(angle) < 1e-12 && Math.abs(scale - 1) < 1e-12) throw new Error('nothing to do');
        this.checkpoint();
        for (const id of bodies) this.shapes.set(id, transform(this.shapes.get(id), { offset, pivot, axis, angle, scale }));
        return { id: bodies[0], scene: this.bodies() };
    }

    /** Delete bodies, as one undo step. */
    async deleteBodies(ids) {
        if (!ids.length) throw new Error('nothing to do');
        if (ids.some(id => !this.shapes.has(id))) throw new Error('that body no longer exists');
        this.checkpoint();
        for (const id of ids) { this.shapes.delete(id); this.refs.delete(id); }
        return this.bodies();
    }

    /** Copy bodies in place, as one undo step; the copies get new ids and refs. */
    async duplicateBodies(ids) {
        if (!ids.length) throw new Error('nothing to do');
        if (ids.some(id => !this.shapes.has(id))) throw new Error('that body no longer exists');
        this.checkpoint();
        const out = ids.map(id => { const n = this.nextId++; this.put(n, transform(this.shapes.get(id), {})); return n; });
        return { ids: out, scene: this.bodies() };
    }

    latest(job) {
        return new Promise((resolve, reject) => {
            this.pending?.resolve(null);
            this.pending = { job, resolve, reject };
            this.pump();
        });
    }

    async pump() {
        if (this.running) return;
        this.running = true;
        // Let pointer events that queued up during the last computation arrive first.
        while (await new Promise(r => setTimeout(r)), this.pending) {
            const { job, resolve, reject } = this.pending;
            this.pending = null;
            try { resolve(await job()); } catch (e) { reject(e); }
        }
        this.running = false;
    }

    snapshot() { return { shapes: new Map(this.shapes), refs: new Map(this.refs), curves: new Map(this.curveMap) } }
    restore(s) { this.shapes = s.shapes; this.refs = s.refs; this.curveMap = s.curves; this.revision++ }

    checkpoint() {
        this.undoStack.push(this.snapshot());
        this.redoStack = [];
        this.revision++;
    }

    async commit(req) {
        const { r } = await this.run(req);
        this.checkpoint();
        const id = r.replaces ?? this.nextId++;
        this.put(id, r.shape, r.history);
        return { id, scene: this.bodies() };
    }

    undo() {
        if (this.undoStack.length) { this.redoStack.push(this.snapshot()); this.restore(this.undoStack.pop()); }
        return this.bodies();
    }

    redo() {
        if (this.redoStack.length) { this.undoStack.push(this.snapshot()); this.restore(this.redoStack.pop()); }
        return this.bodies();
    }

    exportStep(id) {
        const name = `witness3d-body-${id}.step`;
        const url = URL.createObjectURL(new Blob([exportSTEP(this.shapes.get(id))], { type: 'application/step' }));
        Object.assign(document.createElement('a'), { href: url, download: name }).click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return `SAVED ${name.toUpperCase()}`;
    }
}

/** A closed curve's region as a THREE.Shape in its plane, or null for an open curve. */
function regionShape(c) {
    if (c.kind === 'circle') return new THREE.Shape().absarc(c.center[0], c.center[1], c.radius, 0, Math.PI * 2, false);
    if (!c.closed || c.points.length < 3) return null;
    const s = new THREE.Shape().moveTo(...c.points[0]);
    for (const p of c.points.slice(1)) s.lineTo(...p);
    return s.closePath();
}

function checkCurve(c) {
    const finite = a => Array.isArray(a) && a.every(Number.isFinite);
    const x = v3(c.x ?? []), n = v3(c.normal ?? []);
    if (!finite(c.origin) || !finite(c.x) || !finite(c.normal) || n.length() < 1e-9 || x.clone().cross(n).length() < 1e-9) throw new Error("the curve's plane is not valid");
    if (c.kind === 'circle') { if (!finite(c.center) || !(c.radius > 0)) throw new Error("the circle's radius must be greater than zero"); }
    else if (c.kind === 'polyline') {
        if (!Array.isArray(c.points) || c.points.length < 2 || (c.closed && c.points.length < 3)) throw new Error('a line needs two points, a closed one three');
        if (!c.points.every(finite)) throw new Error('a point is not a number');
    } else throw new Error('a curve is a polyline or a circle');
}

/** The history of doing `a` then `b`, for the body being changed (input 0). */
function chain(a, b) {
    const compose = (x, y) => {
        const out = [];
        for (const [f, m] of x) for (const [m2, t] of y) if (m === m2 && !out.some(([p, q]) => p === f && q === t)) out.push([f, t]);
        return out;
    };
    return { faces: [compose(a.faces[0], b.faces[0]), []], edges: [compose(a.edges[0], b.edges[0]), []], generatedFaces: [] };
}
