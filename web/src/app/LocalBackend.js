// The browser backend for App.js: OpenCascade compiled to WebAssembly, on the page's own thread.
// It speaks the same protocol as the desktop app's Rust engine, so one UI drives both.

import * as THREE from 'three';
import { ExtrudeFactory } from '../ExtrudeFactory.js';
import { NoOpError } from '../GeometryFactory.js';
import { blendEdges, booleanWithHistory, box, count, exportSTEP, facePlane, numberedEdges, oc, tessellate, transform, volume } from '../Kernel.js';
import { loft, offsetFlatFaces, regionFace, revolve, splineSamples, sweep } from '../Forms.js';
import { ends, join, loops, MEET } from '../curves.js';

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
        // Drawn curves by id: { origin, x, normal, kind: 'polyline' | 'circle' | 'spline' | 'arc' | 'ellipse'
        // | 'contour', points, closed, center, radius, start, mid, end, major, minor, pieces }.
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
            if (!isClosed(c)) throw new Error('only a closed curve has a region to extrude');
            f.baseFace = regionFace(c);
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
        Object.assign(f, { back: req.back ?? 0, angle: req.angle ?? 0, thickness: req.thickness ?? 0 });
        f.target = req.target ?? undefined;
        f.operation = req.newBody || req.op === 'new' ? 'new' : ({ union: 'union', difference: 'difference', intersect: 'intersection', slice: 'slice' })[req.op] ?? 'auto';
        const [r, piece] = await f.calculate();
        const outcome = r.replaces === undefined ? 'new' : ({ union: 'join', difference: 'cut', intersection: 'intersect', slice: 'slice' })[f.operationType];
        return { f, r, piece, outcome };
    }

    /** Drawn curves, as { id, ...curve }. */
    curves() { return [...this.curveMap].map(([id, c]) => ({ id, ...structuredClone(c), ...((c.kind === 'spline' || c.kind === 'contour') && { samples: splineSamples(c) }) })) }

    /** Add drawn curves, as one undo step. */
    async addCurves(list) {
        if (!list.length) throw new Error('nothing to do');
        for (const c of list) checkCurve(c);
        this.checkpoint();
        return { ids: list.map(c => { const id = this.nextCurve++; this.curveMap.set(id, structuredClone(c)); return id; }) };
    }

    /** Join Curves (J): the curves replaced by their joined runs, as one undo step. */
    async joinCurves(ids) {
        if (ids.some(id => !this.curveMap.has(id))) throw new Error('that curve no longer exists');
        const joined = join(ids.map(id => this.curveMap.get(id)));
        for (const c of joined) checkCurve(c);
        this.checkpoint();
        for (const id of ids) this.curveMap.delete(id);
        return { ids: joined.map(c => { const id = this.nextCurve++; this.curveMap.set(id, c); return id; }) };
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

    /** Shift+Q: the target with the tools cut away, and for each tool the piece of the target inside it. */
    sliceResult(req) {
        const rest = this.booleanResult({ ...req, op: 'difference' }), body = this.shapes.get(req.target);
        const pieces = req.tools.map(t => {
            const piece = booleanWithHistory(body, this.shapes.get(t), 'intersection').shape;
            if (count(piece, 'TopAbs_FACE') === 0) throw new Error('a tool does not meet the body');
            return piece;
        });
        return { ...rest, pieces };
    }

    previewBoolean(req) {
        return this.latest(async () => {
            if (req.op !== 'slice') return this.body(req.target, this.booleanResult(req).shape);
            const r = this.sliceResult(req);
            return { ...this.body(req.target, r.shape), pieces: r.pieces.map(p => this.body(0, p)) };
        });
    }

    /** Plasticity's Boolean: the target changes and the tools go unless kept, as one undo step; a slice adds its pieces. */
    async commitBoolean(req) {
        const { shape, history, pieces = [] } = req.op === 'slice' ? this.sliceResult(req) : this.booleanResult(req);
        this.checkpoint();
        this.put(req.target, shape, history);
        if (!req.keepTools) for (const id of req.tools) { this.shapes.delete(id); this.refs.delete(id); }
        for (const p of pieces) this.put(this.nextId++, p);
        return { id: req.target, scene: this.bodies() };
    }

    /**
     * Revolve, Loft or Sweep of drawn regions: the new shape, and the target after the boolean when
     * Q, W or Shift+E asked for one (as the desktop's form.rs). Null when there is nothing to make.
     */
    form(req) {
        const c = id => { const x = this.curveMap.get(id); if (!x) throw new Error('that curve no longer exists'); return x; };
        if (!req.regions?.length) throw new Error('select a region first');
        let tool;
        if (req.kind === 'revolve') tool = revolve(c(req.regions[0]), req.axisPoint ?? [0, 0, 0], req.axisDir ?? [0, 1, 0], req.angle ?? 2 * Math.PI, req.thickness ?? 0);
        else if (req.kind === 'loft') tool = loft(req.regions.map(c));
        else if (req.kind === 'sweep') {
            if (req.path === undefined || req.path === null) throw new Error('pick the path to sweep along');
            if (req.regions.includes(req.path)) throw new Error('pick a path other than the profile');
            tool = sweep(c(req.regions[0]), c(req.path), req.twist ?? 0, req.scale ?? 1);
        } else throw new Error('a form is a revolve, a loft or a sweep');
        if (!tool) return null;
        const o = oc();
        if (!new o.BRepCheck_Analyzer(tool, true, false, false).IsValid() || count(tool, 'TopAbs_SOLID') === 0) throw new Error('the shape crosses itself; change the axis, path or profiles');
        const kind = { union: 'union', difference: 'difference', intersect: 'intersection' }[req.op];
        if (!kind || !this.shapes.has(req.target)) return { tool, outcome: 'new' };
        const body = this.shapes.get(req.target);
        const r = booleanWithHistory(body, tool, kind);
        const met = kind === 'union' ? count(r.shape, 'TopAbs_SOLID') === count(body, 'TopAbs_SOLID')
            : kind === 'difference' ? r.history.faces[1].length > 0 || count(r.shape, 'TopAbs_FACE') !== count(body, 'TopAbs_FACE')
            : count(r.shape, 'TopAbs_FACE') > 0;
        if (!met) { if (kind === 'union') return { tool, outcome: 'new' }; throw new Error('the shape does not meet the body'); }
        return { tool, result: r, outcome: { union: 'join', difference: 'cut', intersection: 'intersect' }[kind] };
    }

    previewForm(req) {
        return this.latest(async () => {
            const f = this.form(req);
            if (!f) return { outcome: 'none', tool: null, result: null };
            return { outcome: f.outcome, tool: this.body(0, f.tool), result: f.result ? this.body(req.target, f.result.shape) : null };
        });
    }

    async commitForm(req) {
        const f = this.form(req);
        if (!f) throw new Error('nothing to do');
        this.checkpoint();
        if (f.result) { this.put(req.target, f.result.shape, f.result.history); return { id: req.target, scene: this.bodies() }; }
        const id = this.nextId++;
        this.put(id, f.tool);
        return { id, scene: this.bodies() };
    }

    /** Offset Face. This build has no per-face offset, so flat faces are pushed by joining or cutting slabs. */
    offset({ body, faces, distance }) {
        const shape = this.shapes.get(body);
        if (!shape) throw new Error('that body no longer exists');
        if (!faces?.length) throw new Error('select at least one face');
        if (!Number.isFinite(distance)) throw new Error('the distance is not a number');
        if (Math.abs(distance) < 1e-9) return null;
        if (faces.some(f => !facePlane(shape, f))) throw new Error('the browser demo offsets flat faces only; the desktop app offsets any face');
        return offsetFlatFaces(shape, [...new Set(faces)], distance, booleanWithHistory, chain);
    }

    previewOffset(req) {
        return this.latest(async () => { const r = this.offset(req); return this.body(req.body, (r ?? { shape: this.shapes.get(req.body) }).shape); });
    }

    async commitOffset(req) {
        const r = this.offset(req);
        if (!r) throw new Error('nothing to do');
        this.checkpoint();
        this.put(req.body, r.shape, r.history);
        return { id: req.body, scene: this.bodies() };
    }

    scene() { return this.bodies() }

    /** Only the newest of the requests queued during a computation runs; the others resolve to null. */
    preview(req) {
        return this.latest(async () => {
            try {
                const { f, r, piece, outcome } = await this.run(req);
                return { outcome, tool: this.body(0, f.tool()), result: r.replaces === undefined ? null : this.body(r.replaces, r.shape), ...(piece && { piece: this.body(this.nextId, piece.shape) }) };
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
        const { r, piece } = await this.run(req);
        this.checkpoint();
        const id = r.replaces ?? this.nextId++;
        this.put(id, r.shape, r.history);
        if (piece) this.put(this.nextId++, piece.shape);
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

/** Whether the curve encloses a region. */
const isClosed = c => c.kind === 'circle' || c.kind === 'ellipse' || (['polyline', 'spline'].includes(c.kind) && c.closed && c.points.length >= 3) || (c.kind === 'contour' && loops(c.pieces));

function checkCurve(c) {
    const finite = a => Array.isArray(a) && a.every(Number.isFinite);
    const x = v3(c.x ?? []), n = v3(c.normal ?? []);
    if (!finite(c.origin) || !finite(c.x) || !finite(c.normal) || n.length() < 1e-9 || x.clone().cross(n).length() < 1e-9) throw new Error("the curve's plane is not valid");
    checkShape(c);
}

function checkShape(c) {
    const finite = a => Array.isArray(a) && a.every(Number.isFinite);
    if (c.kind === 'ellipse') {
        if (!finite(c.center) || !finite(c.major)) throw new Error('a point is not a number');
        if (!(Math.hypot(...c.major) > 1e-9) || !(c.minor > 1e-9) || !Number.isFinite(c.minor)) throw new Error('an ellipse needs two radii greater than zero');
    } else if (c.kind === 'contour') {
        if (!c.pieces?.length) throw new Error('a contour needs a piece');
        for (const p of c.pieces) {
            if (!ends(p)) throw new Error('a contour is made of lines, arcs and splines with two ends');
            checkShape(p);
        }
        for (let i = 1; i < c.pieces.length; i++) {
            const a = ends(c.pieces[i - 1])[1], b = ends(c.pieces[i])[0];
            if (Math.hypot(a[0] - b[0], a[1] - b[1]) > MEET) throw new Error('the pieces of a contour must meet end to end');
        }
    } else if (c.kind === 'circle') { if (!finite(c.center) || !(c.radius > 0)) throw new Error("the circle's radius must be greater than zero"); }
    else if (c.kind === 'polyline') {
        if (!Array.isArray(c.points) || c.points.length < 2 || (c.closed && c.points.length < 3)) throw new Error('a line needs two points, a closed one three');
        if (!c.points.every(finite)) throw new Error('a point is not a number');
    } else if (c.kind === 'spline') {
        if (!Array.isArray(c.points) || c.points.length < 2 || (c.closed && c.points.length < 3)) throw new Error('a curve needs two points, a closed one three');
        if (!c.points.every(finite)) throw new Error('a point is not a number');
        if (c.points.some((p, i) => i > 0 && Math.hypot(p[0] - c.points[i - 1][0], p[1] - c.points[i - 1][1]) < 1e-6)) throw new Error('two points of the curve are in the same place');
    } else if (c.kind === 'arc') {
        if (![c.start, c.mid, c.end].every(finite)) throw new Error('a point is not a number');
        const cross = (c.mid[0] - c.start[0]) * (c.end[1] - c.start[1]) - (c.mid[1] - c.start[1]) * (c.end[0] - c.start[0]);
        if (Math.abs(cross) < 1e-9) throw new Error('the three points of an arc must not lie on a line');
    } else throw new Error('a curve is a line, circle, spline, arc, ellipse or contour');
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
