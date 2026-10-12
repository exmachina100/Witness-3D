// The browser backend for App.js: OpenCascade compiled to WebAssembly, on the page's own thread.
// It speaks the same protocol as the desktop app's Rust engine, so one UI drives both.

import * as THREE from 'three';
import { ExtrudeFactory } from '../ExtrudeFactory.js';
import { NoOpError } from '../GeometryFactory.js';
import { blendEdges, box, count, exportSTEP, facePlane, numberedEdges, tessellate, transform, volume } from '../Kernel.js';

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
        f.profile = req.profile.kind === 'circle'
            ? new THREE.Shape().absarc(0, 0, req.profile.radius, 0, Math.PI * 2, false)
            : new THREE.Shape().moveTo(-req.profile.width / 2, -req.profile.height / 2).lineTo(req.profile.width / 2, -req.profile.height / 2)
                .lineTo(req.profile.width / 2, req.profile.height / 2).lineTo(-req.profile.width / 2, req.profile.height / 2).closePath();
        f.origin.copy(v3(req.origin));
        f.normal.copy(v3(req.normal));
        f.xAxis.copy(v3(req.xAxis));
        f.distance = req.distance;
        f.target = req.target ?? undefined;
        f.operation = req.newBody ? 'new' : 'auto';
        const [r] = await f.calculate();
        const outcome = r.replaces === undefined ? 'new' : f.operationType === 'union' ? 'join' : 'cut';
        return { f, r, outcome };
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

    blend({ body, edges, size, kind }, withHistory = false) {
        const shape = this.shapes.get(body);
        if (!shape) throw new Error('that body no longer exists');
        if (!edges.length) throw new Error('select at least one edge');
        if (!(size > 0)) throw new Error(`the ${kind === 'chamfer' ? 'distance' : 'radius'} must be greater than zero`);
        return blendEdges(shape, [...new Set(edges)], size, kind === 'chamfer', withHistory);
    }

    async commitBlend(req) {
        const { shape, history } = this.blend(req, true);
        this.checkpoint();
        this.put(req.body, shape, history);
        return { id: req.body, scene: this.bodies() };
    }

    /** Move or turn a body rigidly. Faces and edges keep their numbers and refs. */
    async commitMotion({ body, offset = [0, 0, 0], pivot = [0, 0, 0], axis = [0, 1, 0], angle = 0 }) {
        const shape = this.shapes.get(body);
        if (!shape) throw new Error('that body no longer exists');
        if ([...offset, ...pivot, ...axis, angle].some(v => !Number.isFinite(v))) throw new Error('the move or turn is not a valid number');
        if (Math.hypot(...offset) < 1e-12 && Math.abs(angle) < 1e-12) throw new Error('nothing to do');
        this.checkpoint();
        this.shapes.set(body, transform(shape, { offset, pivot, axis, angle }));
        return { id: body, scene: this.bodies() };
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

    snapshot() { return { shapes: new Map(this.shapes), refs: new Map(this.refs) } }
    restore(s) { this.shapes = s.shapes; this.refs = s.refs; this.revision++ }

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
