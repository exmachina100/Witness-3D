// The browser backend for App.js: OpenCascade compiled to WebAssembly, on the page's own thread.
// It speaks the same protocol as the desktop app's Rust engine, so one UI drives both.

import * as THREE from 'three';
import { ExtrudeFactory } from '../ExtrudeFactory.js';
import { NoOpError } from '../GeometryFactory.js';
import { blendEdges, box, count, exportSTEP, facePlane, tessellate, volume } from '../Kernel.js';

const v3 = a => new THREE.Vector3(...a);

export class LocalBackend {
    info = { kernel: 'OPENCASCADE · WASM', units: 'mm' };

    constructor() {
        this.shapes = new Map();
        this.nextId = 1;
        this.undoStack = [];
        this.redoStack = [];
        this.pending = null;
        this.running = false;
        // The product-enclosure blank, in millimetres, as on the desktop.
        this.shapes.set(this.nextId++, box(new THREE.Vector3(-40, 0, -25), new THREE.Vector3(40, 30, 25)));
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
        return { id, positions: mesh.getAttribute('position').array, indices: Array.from(index), faceIds, facePlanes, edges: polylines, volume: volume(shape) };
    }

    bodies() { return [...this.shapes].map(([id, s]) => this.body(id, s)) }

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

    blend({ body, edges, size, kind }) {
        const shape = this.shapes.get(body);
        if (!shape) throw new Error('that body no longer exists');
        if (!edges.length) throw new Error('select at least one edge');
        if (!(size > 0)) throw new Error(`the ${kind === 'chamfer' ? 'distance' : 'radius'} must be greater than zero`);
        return blendEdges(shape, [...new Set(edges)], size, kind === 'chamfer');
    }

    async commitBlend(req) {
        const shape = this.blend(req);
        this.checkpoint();
        this.shapes.set(req.body, shape);
        return { id: req.body, scene: this.bodies() };
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

    checkpoint() {
        this.undoStack.push(new Map(this.shapes));
        this.redoStack = [];
    }

    async commit(req) {
        const { r } = await this.run(req);
        this.checkpoint();
        const id = r.replaces ?? this.nextId++;
        this.shapes.set(id, r.shape);
        return { id, scene: this.bodies() };
    }

    undo() {
        if (this.undoStack.length) { this.redoStack.push(this.shapes); this.shapes = this.undoStack.pop(); }
        return this.bodies();
    }

    redo() {
        if (this.redoStack.length) { this.undoStack.push(this.shapes); this.shapes = this.redoStack.pop(); }
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
