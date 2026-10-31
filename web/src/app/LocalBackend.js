// The browser backend for App.js: OpenCascade compiled to WebAssembly, on the page's own thread.
// It speaks the same protocol as the desktop app's Rust engine, so one UI drives both.

import * as THREE from 'three';
import { ExtrudeFactory } from '../ExtrudeFactory.js';
import { NoOpError } from '../GeometryFactory.js';
import { arrayMotions, blendEdges, booleanWithHistory, extrudeFace, bounds, box, count, draftFaces, faceSheet, imprintEdgesWithHistory, imprintWithHistory, planeSheet, regions, unifyWithHistory, boundaryEdges, splitWithHistory, draftWithHistory, exportSTEP, facePlane, mirror, mirror as mirrorShape, numberedEdges, oc, primitive, shellFaces, tessellate, transform, volume } from '../Kernel.js';
import { cutSheets, loft, loftGuided, loftSheet, offsetFlatFaces, pipe, regionFace, revolve, splineSamples, sweep, sweepGuided } from '../Forms.js';
import { curveFromNurbs, ends, join, loops, MEET, nurbsLoop } from '../curves.js';
import { isoparam, meetCurves, projectCurveCurve, projectCurves, projectedEdges, sectionCurves } from '../Project.js';
import { isSheet, patch } from '../Patch.js';
import { patchTrim } from '../patchTrim.js';
import { offsetEdges } from '../edgeTube.js';
import { faceSurfaces } from '../faceSurfaces.js';
import { facePoles } from '../facePoles.js';
import { faceUvn } from '../faceUvn.js';
import { deformBodies, deformReblend } from '../deformBody.js';
import { filletFaces, rechamfer, refilletFaces, removeFaces, turnFlatFace } from '../removeFace.js';
import { moveFacePoles, subdivideFaces } from '../movePoles.js';
import { isoparamSplit } from '../isoparamSplit.js';
import { endless, withMaterial } from '../material.js';
import { chordal, fullRound, limitRound, reshapeRounds } from '../filletShape.js';
import { bridgeSurface } from '../BridgeSurface.js';
import { sheetFillet, trimWalls } from '../sheetFillet.js';
import { projectOutline } from '../Outline.js';
import { thicken, thickenFaces } from '../Thicken.js';
import { extendSheet, extendSheetTo } from '../ExtendSheet.js';
import { raiseFaces, rebuildFaces } from '../rebuildFace.js';
import { matchFacesGrow, wideSurface } from '../matchFace.js';
import { compound, untrimFace } from '../untrim.js';
import { splineSheet } from '../splineSheet.js';
import { unwrapFace } from '../unwrap.js';
import { edgeCurvature } from '../edgeCurvature.js';
import { edgeFaces } from '../edgeFaces.js';
import { joinSheets, unjoin } from '../Join.js';
import { hiddenLines } from '../Drawing.js';

const v3 = a => new THREE.Vector3(...a);

export class LocalBackend {
    info = { kernel: 'OPENCASCADE · WASM', units: 'mm' };

    constructor() {
        this.shapes = new Map();
        // Copy with Placement's bodies, outside the document and its undo steps.
        this.clipboard = [];
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
        const { mesh, polylines } = tessellate(shape, { deflection: 0.05 / (this.meshQuality ?? 1) });
        const index = mesh.index.array, faceIndex = mesh.getAttribute('faceIndex').array;
        const faceIds = new Uint32Array(index.length / 3);
        for (let t = 0; t < faceIds.length; t++) faceIds[t] = faceIndex[index[3 * t]];
        const facePlanes = Array.from({ length: count(shape, 'TopAbs_FACE') }, (_, i) => {
            const p = facePlane(shape, i);
            return p ? { origin: p.origin.toArray(), normal: p.normal.toArray() } : null;
        });
        return { id, positions: mesh.getAttribute('position').array, indices: Array.from(index), faceIds, facePlanes, edges: polylines, volume: isSheet(shape) ? 0 : volume(shape), sheet: isSheet(shape), faceRefs: [], edgeRefs: [], revision: 0 };
    }

    /** Preferences › Performance › CPU facet quality: finer (above 1) or coarser facets; the scene redrawn. */
    async setMeshQuality(q) {
        if (!(q >= 0.25 && q <= 4)) throw new Error('the facet quality runs from 0.25 to 4');
        this.meshQuality = q;
        // OCCT keeps a shape's facets when they are already finer than asked, so drop them first.
        const o = oc();
        for (const s of this.shapes.values()) o.BRepTools.Clean(s, true);
        return this.bodies();
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
            const holes = req.holes ?? [];
            for (const id of [...(req.moreRegions ?? []), ...holes].filter(id => id !== req.region)) {
                const m = this.curveMap.get(id);
                if (!m) throw new Error('that curve no longer exists');
                if (!isClosed(m)) throw new Error('only a closed curve has a region to extrude');
                f.moreFaces.push({ face: regionFace(m), hole: holes.includes(id) });
            }
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
        if (req.direction) f.direction = v3(req.direction);
        if (req.faces?.length) f.faces = req.faces;
        f.individual = !!req.individual;
        f.target = req.target ?? undefined;
        f.operation = req.newBody || req.op === 'new' ? 'new' : ({ union: 'union', difference: 'difference', intersect: 'intersection', slice: 'slice' })[req.op] ?? 'auto';
        const [r, piece] = await f.calculate();
        const outcome = r.replaces === undefined ? 'new' : ({ union: 'join', difference: 'cut', intersection: 'intersect', slice: 'slice' })[f.operationType];
        return { f, r, piece, outcome };
    }

    /** Drawn curves, as { id, ...curve }. */
    curves() { return [...this.curveMap].map(([id, c]) => ({ ...structuredClone(c), id, ...((c.kind === 'spline' || c.kind === 'contour') && { samples: splineSamples(c) }) })) }

    /**
     * Keep a curve under a new id. Edits hand back copies of listed curves, which carry the old id
     * and display samples; neither is the curve's own, and a stale id would hide the new one.
     */
    keepCurve(c) {
        const { id: _id, samples: _samples, ...curve } = structuredClone(c);
        const id = this.nextCurve++;
        this.curveMap.set(id, curve);
        return id;
    }

    /** Add drawn curves, as one undo step. */
    async addCurves(list) {
        if (!list.length) throw new Error('nothing to do');
        for (const c of list) checkCurve(c);
        this.checkpoint();
        return { ids: list.map(c => this.keepCurve(c)) };
    }

    /** Join Curves (J): the curves replaced by their joined runs, as one undo step. */
    async joinCurves(ids) {
        if (ids.some(id => !this.curveMap.has(id))) throw new Error('that curve no longer exists');
        const joined = join(ids.map(id => this.curveMap.get(id)));
        for (const c of joined) checkCurve(c);
        this.checkpoint();
        for (const id of ids) this.curveMap.delete(id);
        return { ids: joined.map(c => this.keepCurve(c)) };
    }

    /** Curve edits (Trim, Fillet Curve, Explode): the curves `ids` replaced by `list`, as one undo step. */
    async replaceCurves(ids, list) {
        if (!ids?.length && !list?.length) throw new Error('nothing to do');
        if (ids.some(id => !this.curveMap.has(id))) throw new Error('that curve no longer exists');
        for (const c of list) checkCurve(c);
        this.checkpoint();
        for (const id of ids) this.curveMap.delete(id);
        return { ids: list.map(c => this.keepCurve(c)) };
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
    booleanResult({ target, tools, op, targetMaterial = 'default', toolMaterial = 'default' }) {
        const kind = { union: 'union', auto: 'union', difference: 'difference', intersect: 'intersection' }[op];
        if (!kind) throw new Error('a boolean needs union, difference or intersect');
        if (!tools?.length) throw new Error('select a tool body as well as the target');
        if (tools.includes(target)) throw new Error("the target can't also be a tool");
        if (![target, ...tools].every(id => this.shapes.has(id))) throw new Error('that body no longer exists');
        const t0 = withMaterial(this.shapes.get(target), targetMaterial);
        let shape = t0.shape, history = null, open = t0.unbounded;
        for (const t of tools) {
            const tool = withMaterial(this.shapes.get(t), toolMaterial);
            open = endless(kind, open, tool.unbounded);
            if (open) throw new Error('that leaves a solid without end; change the target or tool material');
            const r = booleanWithHistory(shape, tool.shape, kind);
            history = history ? chain(history, r.history) : r.history;
            shape = r.shape;
        }
        if (count(shape, 'TopAbs_FACE') === 0) throw new Error('the boolean leaves nothing');
        return { shape, history };
    }

    /** Shift+Q: the target with the tools cut away, and for each tool the piece of the target inside it. */
    sliceResult(req) {
        const rest = this.booleanResult({ ...req, op: 'difference' }), body = withMaterial(this.shapes.get(req.target), req.targetMaterial).shape;
        const pieces = req.tools.map(t => {
            const piece = booleanWithHistory(body, withMaterial(this.shapes.get(t), req.toolMaterial).shape, 'intersection').shape;
            if (count(piece, 'TopAbs_FACE') === 0) throw new Error('a tool does not meet the body');
            return piece;
        });
        return { ...rest, pieces };
    }

    /** Region: a solid for each part of space the target and tools close off, the largest first. */
    regionResult({ target, tools = [] }) {
        if (tools.includes(target)) throw new Error("the target can't also be a tool");
        if (![target, ...tools].every(id => this.shapes.has(id))) throw new Error('that body no longer exists');
        const [first, ...pieces] = regions([target, ...tools].map(id => this.shapes.get(id)));
        return { shape: first, history: undefined, pieces };
    }

    previewBoolean(req) {
        return this.latest(async () => {
            if (req.region) {
                const r = this.regionResult(req);
                return { ...this.body(req.target, r.shape), pieces: r.pieces.map(p => this.body(0, p)) };
            }
            if (req.op !== 'slice') return this.body(req.target, this.booleanResult(req).shape);
            const r = this.sliceResult(req);
            return { ...this.body(req.target, r.shape), pieces: r.pieces.map(p => this.body(0, p)) };
        });
    }

    /** Plasticity's Boolean: the target changes and the tools go unless kept, as one undo step; a slice adds its pieces. */
    async commitBoolean(req) {
        const { shape, history, pieces = [] } = req.region ? this.regionResult(req) : req.op === 'slice' ? this.sliceResult(req) : this.booleanResult(req);
        this.checkpoint();
        if (req.region) this.refs.delete(req.target);
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
        // A guide is a drawn curve's id, or a curve given whole (a body edge picked as a guide).
        const guide = g => typeof g === 'object' && g ? g : c(g);
        if (!req.regions?.length) throw new Error('select a region first');
        let tool;
        if (req.kind === 'revolve') tool = revolve(c(req.regions[0]), req.axisPoint ?? [0, 0, 0], req.axisDir ?? [0, 1, 0], req.angle ?? 2 * Math.PI, req.thickness ?? 0);
        else if (req.kind === 'loft') {
            const guides = req.guides ?? [];
            if (guides.some(g => req.regions.includes(g))) throw new Error("a curve can't be both a profile and a guide");
            tool = guides.length ? loftGuided(req.regions.map(c), guides.map(guide)) : loft(req.regions.map(c));
        } else if (req.kind === 'sweep') {
            if (req.path === undefined || req.path === null) throw new Error('pick the path to sweep along');
            if (req.regions.includes(req.path)) throw new Error('pick a path other than the profile');
            const guides = req.guides ?? [], align = req.align ?? 'normal', corner = req.corner ?? 'mitre';
            if (!guides.length && align === 'normal' && corner !== 'round') tool = sweep(c(req.regions[0]), c(req.path), req.twist ?? 0, req.scale ?? 1);
            else {
                if (Math.abs(req.twist ?? 0) > 1e-12 || Math.abs((req.scale ?? 1) - 1) > 1e-12) throw new Error("twist and scale don't go with a guide, Parallel alignment or Round corners; set them back to 0 and 1");
                if (guides.some(g => g === req.path || req.regions.includes(g))) throw new Error('pick a guide other than the path and the profile');
                tool = sweepGuided(c(req.regions[0]), c(req.path), guides.map(guide), req.method ?? 'point', align, corner);
            }
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
    offset({ body, faces, distance, angle = 0, grow = 'moving', chamfer }) {
        const shape = this.shapes.get(body);
        if (!shape) throw new Error('that body no longer exists');
        if (!faces?.length) throw new Error('select at least one face');
        if (!Number.isFinite(distance)) throw new Error('the distance is not a number');
        if (!Number.isFinite(angle) || Math.abs(angle) >= Math.PI / 2) throw new Error('the angle must be between -90° and 90°');
        if (Math.abs(distance) < 1e-9 && Math.abs(angle) < 1e-9) return null;
        if (faces.some(f => !facePlane(shape, f))) throw new Error('the browser demo offsets flat faces only; the desktop app offsets any face');
        // A chamfer's new distance (Dimension): the faces beside it carried along.
        if (chamfer && Math.abs(angle) < 1e-9) return { shape: rechamfer(shape, chamfer) };
        const picked = [...new Set(faces)];
        let r = Math.abs(distance) < 1e-9 ? null : offsetFlatFaces(shape, picked, distance, booleanWithHistory, chain, grow);
        if (Math.abs(angle) < 1e-9) return r;
        // Then the adjacent angle (A) on what the picked faces became.
        const now = r ? picked.flatMap(f => r.history.faces[0].filter(([a]) => a === f).map(([, b]) => b)) : picked;
        const d = draftWithHistory(r ? r.shape : shape, now, angle);
        return { shape: d.shape, history: r ? chain(r.history, d.history) : d.history };
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

    /**
     * Move Face (G with faces selected): the faces carried by `offset`, the faces round them
     * following. A flat face moved along itself looks the same, so here only the move across it
     * counts: the faces are offset that far (they must all be flat and moved the same distance
     * across). Turning faces, and moving round ones, is the desktop's (document.rs preview_move_faces).
     */
    moveFacesResult(req) {
        const { body, faces, edges, offset = [0, 0, 0], angle = 0, chamfer } = req;
        const shape = this.shapes.get(body);
        if (!shape) throw new Error('that body no longer exists');
        // A chamfer turned to a new setback on one side (Dimension).
        if (chamfer) return { shape: rechamfer(shape, chamfer) };
        if (!faces?.length && edges?.length) throw new Error('the browser demo moves faces; the desktop app moves edges too');
        if (!faces?.length) throw new Error('select the faces to move');
        if (Math.abs(angle) > 1e-12) {
            if (faces.length !== 1) throw new Error('the browser demo turns one face at a time; the desktop app turns several');
            return { shape: turnFlatFace(shape, faces[0], { pivot: req.pivot, axis: req.axis, angle, offset }) };
        }
        const planes = faces.map(f => facePlane(shape, f));
        if (planes.some(p => !p)) throw new Error('the browser demo moves flat faces only; the desktop app moves any face');
        const across = planes.map(p => offset[0] * p.normal.x + offset[1] * p.normal.y + offset[2] * p.normal.z);
        if (across.some(d => Math.abs(d - across[0]) > 1e-9)) throw new Error('the browser demo moves faces the same distance across them; move them one at a time');
        if (Math.abs(across[0]) < 1e-9) return null;
        return this.offset({ body, faces, distance: across[0], grow: 'none' });
    }

    previewMoveFaces(req) {
        return this.latest(async () => { const r = this.moveFacesResult(req); return this.body(req.body, (r ?? { shape: this.shapes.get(req.body) }).shape); });
    }

    async commitMoveFaces(req) {
        const r = this.moveFacesResult(req);
        if (!r) throw new Error('nothing to do');
        this.checkpoint();
        this.put(req.body, r.shape, r.history);
        return { id: req.body, scene: this.bodies() };
    }

    // --- Round 6: Box, Cylinder, Sphere, Shell, Mirror and arrays (as document.rs) ---------------

    /**
     * Box, Cylinder or Sphere (see Kernel.primitive), and with `op` union, difference, intersect or
     * slice the body `target` it was drawn on, as Plasticity's Q, W, Shift+E and Shift+Q do; 'new' (B,
     * the default) leaves it a separate body. Mirrors document.rs preview_primitive.
     */
    primitiveResult(req) {
        const tool = primitive(req);
        const op = req.op ?? 'new';
        if (op === 'new' || req.target === undefined || req.target === null) return { tool, outcome: 'new' };
        const body = this.shapes.get(req.target);
        if (!body) throw new Error('that body no longer exists');
        if (op === 'slice') {
            const rest = booleanWithHistory(body, tool, 'difference'), piece = booleanWithHistory(body, tool, 'intersection').shape;
            if (count(piece, 'TopAbs_FACE') === 0) throw new Error('the solid does not meet the body');
            return { tool, result: rest, piece, outcome: 'slice' };
        }
        const kind = { union: 'union', difference: 'difference', intersect: 'intersection' }[op];
        if (!kind) throw new Error('a primitive is new, or a union, difference, intersect or slice');
        const r = booleanWithHistory(body, tool, kind);
        const met = kind === 'union' ? count(r.shape, 'TopAbs_SOLID') === count(body, 'TopAbs_SOLID')
            : kind === 'difference' ? r.history.faces[1].length > 0
            : count(r.shape, 'TopAbs_FACE') > 0;
        if (!met) throw new Error('the solid does not meet the body');
        return { tool, result: r, outcome: { union: 'join', difference: 'cut', intersection: 'intersect' }[kind] };
    }

    previewPrimitive(req) {
        return this.latest(async () => {
            const p = this.primitiveResult(req);
            return { outcome: p.outcome, tool: this.body(0, p.tool), result: p.result ? this.body(req.target, p.result.shape) : null, ...(p.piece && { piece: this.body(this.nextId, p.piece) }) };
        });
    }

    /** The primitive as one undo step: a new body, or the target changed (and a slice's piece added). */
    async commitPrimitive(req) {
        const p = this.primitiveResult(req);
        this.checkpoint();
        if (!p.result) { const id = this.nextId++; this.put(id, p.tool); return { id, scene: this.bodies() }; }
        this.put(req.target, p.result.shape, p.result.history);
        if (p.piece) this.put(this.nextId++, p.piece);
        // T keeps the primitive as a body of its own too.
        if (req.keep) this.put(this.nextId++, p.tool);
        return { id: req.target, scene: this.bodies() };
    }

    shell({ body, faces, thickness }) {
        const shape = this.shapes.get(body);
        if (!shape) throw new Error('that body no longer exists');
        return shellFaces(shape, faces, thickness);
    }

    previewShell(req) { return this.latest(async () => this.body(req.body, this.shell(req).shape)) }

    /** Shell as one undo step; the outer faces and edges keep their refs. */
    async commitShell(req) {
        const { shape, history } = this.shell(req);
        this.checkpoint();
        this.put(req.body, shape, history);
        return { id: req.body, scene: this.bodies() };
    }

    /** Per body, the copies `make` returns for it. */
    copies(bodies, make) {
        if (!bodies?.length) throw new Error('select a solid first');
        if (bodies.some(id => !this.shapes.has(id))) throw new Error('that body no longer exists');
        return bodies.map(id => [id, make(this.shapes.get(id))]);
    }

    /** Copies fused into their bodies when `join`, else added as new bodies; one undo step. */
    placeCopies(all, join) {
        if (join) {
            const fused = all.map(([id, cs]) => {
                let shape = this.shapes.get(id), history = null;
                for (const c of cs) {
                    const r = booleanWithHistory(shape, c, 'union');
                    history = history ? chain(history, r.history) : r.history;
                    shape = r.shape;
                }
                if (!history) throw new Error('nothing to do');
                return [id, shape, history];
            });
            this.checkpoint();
            for (const [id, shape, history] of fused) this.put(id, shape, history);
            return { ids: fused.map(([id]) => id), scene: this.bodies() };
        }
        const shapes = all.flatMap(([, cs]) => cs);
        if (!shapes.length) throw new Error('nothing to do');
        this.checkpoint();
        const ids = shapes.map(sh => { const id = this.nextId++; this.put(id, sh); return id; });
        return { ids, scene: this.bodies() };
    }

    mirrorCopies({ bodies, origin, normal }) { return this.copies(bodies, s => [mirror(s, origin, normal)]) }
    /** Mirror's Cut down mirror plane: the body less everything on the normal's side of the plane. */
    halfBehind(shape, origin, normal) {
        const o = oc(), size = this.sheetSize(), l = Math.hypot(...normal), n = normal.map(x => x / l);
        if (!(l > 1e-9)) throw new Error('the mirror plane has no direction');
        const front = new o.BRepPrimAPI_MakePrism(planeSheet(origin, n, size), new o.gp_Vec(n[0] * size, n[1] * size, n[2] * size), false, true).Shape();
        return booleanWithHistory(shape, front, 'difference');
    }
    /** Per body: its half behind the plane (with history) and that half mirrored. */
    mirrorCut({ bodies, origin, normal }) {
        if (!bodies?.length) throw new Error('select a solid first');
        if (bodies.some(id => !this.shapes.has(id))) throw new Error('that body no longer exists');
        return bodies.map(id => { const half = this.halfBehind(this.shapes.get(id), origin, normal); return [id, half, mirror(half.shape, origin, normal)]; });
    }
    previewMirror(req) {
        return this.latest(async () => req.cut ? this.mirrorCut(req).flatMap(([, h, c]) => [this.body(0, h.shape), this.body(0, c)]) : this.mirrorCopies(req).flatMap(([, cs]) => cs.map(c => this.body(0, c))));
    }
    async commitMirror(req) {
        if (!req.cut) return this.placeCopies(this.mirrorCopies(req), !!req.join);
        const parts = this.mirrorCut(req).map(([id, half, copy]) => {
            if (!req.join) return [id, half.shape, half.history, copy];
            const r = booleanWithHistory(half.shape, copy, 'union');
            return [id, r.shape, chain(half.history, r.history), null];
        });
        this.checkpoint();
        const ids = [];
        for (const [id, shape, history, copy] of parts) {
            this.put(id, shape, history);
            ids.push(id);
            if (copy) { const n = this.nextId++; this.put(n, copy); ids.push(n); }
        }
        return { ids, scene: this.bodies() };
    }

    arrayCopies({ bodies, spec }) {
        const motions = arrayMotions(spec);
        return this.copies(bodies, s => motions.map(m => transform(s, m)));
    }
    previewArray(req) { return this.latest(async () => this.arrayCopies(req).flatMap(([, cs]) => cs.map(c => this.body(0, c)))) }
    async commitArray(req) { return this.placeCopies(this.arrayCopies(req), !!req.join) }

    /** Deform Solid and Sheet (see deformBody.js and document.rs preview_deform): the bodies wrapped onto the target face. */
    deformResult(req) {
        if (!req.bodies?.length) throw new Error('select the solids or sheets to deform');
        const get = (id, what) => { const s = this.shapes.get(id); if (!s) throw new Error(`${what} no longer exists`); return s; };
        const all = req.bodies.map(b => get(b, 'that body'));
        const ref = get(req.reference, 'the reference body'), target = get(req.target, 'the target body');
        if (req.bodies.includes(req.target)) throw new Error("deform onto another body's face, not one being deformed");
        return (req.reblend ? deformReblend : deformBodies)(all, ref, req.rface, target, req.tface, req);
    }

    previewDeform(req) { return this.latest(async () => this.deformResult(req).map((s, i) => this.body(req.bodies[i], s))) }

    async commitDeform(req) {
        const made = this.deformResult(req);
        this.checkpoint();
        let ids = req.bodies;
        if (req.keep) ids = made.map(s => { const id = this.nextId++; this.put(id, s); return id; });
        else req.bodies.forEach((id, i) => this.put(id, made[i]));
        return { ids, scene: this.bodies() };
    }

    /** Remove Face (see removeFace.js): the faces gone and the gap closed by their flat neighbours. */
    removeFacesResult({ body, faces }) {
        const s = this.shapes.get(body);
        if (!s) throw new Error('that body no longer exists');
        return removeFaces(s, faces);
    }
    previewRemoveFaces(req) { return this.latest(async () => this.body(req.body, this.removeFacesResult(req))) }
    async commitRemoveFaces(req) {
        const made = this.removeFacesResult(req);
        this.checkpoint();
        this.put(req.body, made);
        return { id: req.body, scene: this.bodies() };
    }

    /** Remove Fillets: the fillet faces of a body, or the fillet chains holding `faces`. */
    async filletFaces({ body, faces = [] }) {
        const s = this.shapes.get(body);
        if (!s) throw new Error('that body no longer exists');
        const found = filletFaces(s, faces);
        if (!found.length) throw new Error(faces.length ? 'those faces are not fillets' : 'no fillets found on that body');
        return found;
    }

    /** Dimension on a fillet: the chain `faces` of `body` made again at `radius`. */
    refilletResult({ body, faces, radius }) {
        const s = this.shapes.get(body);
        if (!s) throw new Error('that body no longer exists');
        return refilletFaces(s, faces, radius);
    }
    previewRefillet(req) { return this.latest(async () => this.body(req.body, this.refilletResult(req))) }
    async commitRefillet(req) {
        const made = this.refilletResult(req);
        this.checkpoint();
        this.put(req.body, made);
        return { id: req.body, scene: this.bodies() };
    }

    /** Deform Curve: points on a face to (s, t, n) face coordinates, or back with `map` (see faceUvn.js). */
    async faceUvn({ body, face, map = false, points }) {
        const s = this.shapes.get(body);
        if (!s) throw new Error('that body no longer exists');
        return faceUvn(s, face, map, points);
    }

    /** Toggle Points: each face's control points, as rows (see facePoles.js). */
    async facePoles({ body }) {
        const shape = this.shapes.get(body);
        if (!shape) throw new Error('that body no longer exists');
        return facePoles(shape);
    }

    /** Dimension: what each face of a body lies on (see dimension.js). */
    async faceSurfaces({ body }) {
        const shape = this.shapes.get(body);
        if (!shape) throw new Error('that body no longer exists');
        return faceSurfaces(shape);
    }

    /**
     * Plasticity's Place: the bodies copied by one motion (scale, then turn, about the pivot, then
     * move), and with `op` combined with the body `target` one copy at a time. Mirrors document.rs
     * preview_place: a slice's pieces, and copies a union misses, become new bodies.
     */
    placeResult({ bodies = [], clipboard = false, motion, target = null, op = 'new' }) {
        const m = motion ?? {};
        const nums = [m.offset, m.pivot, m.axis].every(v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite));
        const scale = m.scale ?? 1;
        if (!nums || !Number.isFinite(m.angle ?? 0) || !Number.isFinite(scale)) throw new Error('the placement is not a number');
        if (scale <= 1e-9) throw new Error('the scale must be above zero');
        if (Math.abs(m.angle ?? 0) > 1e-12 && Math.hypot(...m.axis) < 1e-9) throw new Error("the placement's axis has no direction");
        const move = s => transform(s, { ...m, axis: Math.hypot(...m.axis) < 1e-9 ? [0, 1, 0] : m.axis, scale });
        // Paste with Placement places the copied bodies instead.
        if (clipboard && !this.clipboard.length) throw new Error('nothing is copied; select solids and copy them with Ctrl+Shift+C');
        const copies = clipboard ? this.clipboard.map(move) : this.copies(bodies, s => [move(s)]).flatMap(([, cs]) => cs);
        bodies = clipboard ? [] : bodies;
        if (op === 'new' || op === 'auto' || target === null || target === undefined) return { copies, result: null, pieces: [], loose: [] };
        if (bodies.includes(target)) throw new Error('place the copies on another body to combine with it');
        let shape = this.shapes.get(target), history = null;
        if (!shape) throw new Error('that body no longer exists');
        const pieces = [], loose = [];
        for (const c of copies) {
            if (op === 'slice') {
                const rest = booleanWithHistory(shape, c, 'difference'), piece = booleanWithHistory(shape, c, 'intersection').shape;
                if (count(piece, 'TopAbs_FACE') === 0) throw new Error('the slice does not cut through the body');
                pieces.push(piece);
                history = history ? chain(history, rest.history) : rest.history;
                shape = rest.shape;
                continue;
            }
            const kind = { union: 'union', difference: 'difference', intersect: 'intersection' }[op];
            if (!kind) throw new Error('a placement is new, or a union, difference, intersect or slice');
            const r = booleanWithHistory(shape, c, kind);
            const met = kind === 'union' ? count(r.shape, 'TopAbs_SOLID') === count(shape, 'TopAbs_SOLID')
                : kind === 'difference' ? r.history.faces[1].length > 0 || count(r.shape, 'TopAbs_FACE') !== count(shape, 'TopAbs_FACE')
                : count(r.shape, 'TopAbs_FACE') > 0;
            if (!met) {
                if (kind === 'union') { loose.push(c); continue; }
                throw new Error('the copy does not meet the body');
            }
            history = history ? chain(history, r.history) : r.history;
            shape = r.shape;
        }
        return { copies, result: history ? { shape, history } : null, pieces, loose };
    }

    previewPlace(req) {
        return this.latest(async () => {
            const p = this.placeResult(req);
            return {
                tools: p.copies.map(c => this.body(0, c)),
                result: p.result ? this.body(req.target, p.result.shape) : null,
                pieces: [...p.pieces, ...p.loose].map((s, i) => this.body(this.nextId + i, s)),
            };
        });
    }

    /**
     * Plasticity's Copy with Placement: the bodies kept to paste later, here or in a file opened
     * after; nothing in the document changes. Returns how many were copied.
     */
    async copyBodies(bodies) {
        this.clipboard = this.copies(bodies, s => [s]).flatMap(([, cs]) => cs);
        return this.clipboard.length;
    }

    /** Place as one undo step: the bodies made, the target first when it changed. */
    async commitPlace(req) {
        const p = this.placeResult(req);
        this.checkpoint();
        const ids = [];
        if (p.result) { this.put(req.target, p.result.shape, p.result.history); ids.push(req.target); }
        else if (!p.pieces.length && !p.loose.length) for (const c of p.copies) { const id = this.nextId++; this.put(id, c); ids.push(id); }
        for (const s of [...p.pieces, ...p.loose]) { const id = this.nextId++; this.put(id, s); ids.push(id); }
        return { ids, scene: this.bodies() };
    }

    /** Plasticity's Cut: each body split by sheets grown from the curves. [[id, { pieces, history }]]. */
    cutResult({ bodies, curves = [], tools = {} }) {
        if (!bodies?.length) throw new Error('select a solid to cut');
        const size = this.sheetSize(), sheets = this.toolSheets(curves, tools, size);
        if (!sheets.length && !tools.bodies?.length) throw new Error('select curves, faces or a plane to cut with');
        return bodies.map(id => {
            const s = this.shapes.get(id);
            if (!s) throw new Error('that body no longer exists');
            return [id, splitWithHistory(s, [...sheets, ...this.toolBodies(tools, id)])];
        });
    }

    /** How far cutting sheets reach: well past everything in the document. */
    sheetSize() {
        const box = new THREE.Box3();
        for (const s of this.shapes.values()) box.union(bounds(s));
        return 4 * box.getSize(new THREE.Vector3()).length() + 1000;
    }

    /** Cut and Imprint's sheets: the curves swept both ways, then faces grown past their body and the plane. */
    toolSheets(curves, { faces = [], plane = null, shapes = [] } = {}, size) {
        const cs = curves.map(id => { const c = this.curveMap.get(id); if (!c) throw new Error('that curve no longer exists'); return c; });
        // Curves not kept in the document (Offset Edge's offsets).
        for (const c of shapes) { checkCurve(c); cs.push(c); }
        const out = cs.length ? cutSheets(cs, size) : [];
        for (const { body, face } of faces) {
            const s = this.shapes.get(body);
            if (!s) throw new Error('that body no longer exists');
            out.push(faceSheet(s, face, size, wideSurface));
        }
        if (plane) out.push(planeSheet(plane.origin, plane.normal, size));
        return out;
    }

    /** The tool bodies other than `target`. */
    toolBodies({ bodies = [] } = {}, target) {
        return bodies.filter(b => b !== target).map(b => { const s = this.shapes.get(b); if (!s) throw new Error('that body no longer exists'); return s; });
    }

    previewCut(req) {
        return this.latest(async () => this.cutResult(req).flatMap(([id, r]) => r.pieces.map((p, i) => this.body(i ? 0 : id, p))));
    }

    /** Cut as one undo step: the biggest piece keeps each body's id and refs; the others are new bodies. */
    async commitCut(req) {
        const all = this.cutResult(req);
        this.checkpoint();
        const ids = [];
        for (const [id, { pieces, history }] of all) {
            this.put(id, pieces[0], history);
            ids.push(id);
            for (const p of pieces.slice(1)) { const n = this.nextId++; this.put(n, p); ids.push(n); }
        }
        return { ids, scene: this.bodies() };
    }

    /**
     * Plasticity's Project, by `mode`: curves onto a body ('curve-body', along `dir`, `both` ways,
     * `hide` occluded), where two bodies meet ('body-body') or two curves' sheets cross
     * ('curve-curve'). The curves it would make; Add Curves keeps them.
     */
    projectResult(req) {
        const shape = id => { const s = this.shapes.get(id); if (!s) throw new Error('that body no longer exists'); return s; };
        const curve = id => { const c = this.curveMap.get(id); if (!c) throw new Error('that curve no longer exists'); return c; };
        if (req.mode === 'body-body') {
            if (req.bodies[0] === req.bodies[1]) throw new Error('select two different bodies');
            // Curves that are not flat get a plane facing up.
            return meetCurves(shape(req.bodies[0]), shape(req.bodies[1])).map(p => curveFromNurbs(p, [0, -1, 0]));
        }
        if (req.mode === 'curve-curve') {
            if (req.curves[0] === req.curves[1]) throw new Error('select two different curves');
            const [a, b] = req.curves.map(curve);
            return projectCurveCurve(a, b, this.sheetSize()).map(p => curveFromNurbs(p, a.normal.map(v => -v)));
        }
        if (req.mode === 'section') {
            // Where the plane crosses the faces (all when none are given); Cut Curve cuts with faces by these.
            const normal = new THREE.Vector3(...req.normal);
            if (!(normal.length() > 1e-12)) throw new Error('the plane has no direction');
            normal.normalize();
            return sectionCurves(shape(req.body), req.faces ?? [], planeSheet(req.origin, normal.toArray(), this.sheetSize())).map(p => curveFromNurbs(p, normal.clone().negate().toArray()));
        }
        if (req.mode === 'isoparam') return [curveFromNurbs(isoparam(shape(req.body), req.face, req.point, !!req.u), [0, -1, 0])];
        if (req.mode === 'outline') {
            const normal = new THREE.Vector3(...req.normal);
            if (!(normal.length() > 1e-12)) throw new Error('the plane has no normal');
            normal.normalize();
            const x = Math.abs(normal.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
            x.addScaledVector(normal, -x.dot(normal)).normalize();
            const out = projectOutline(shape(req.body), new THREE.Vector3(...req.origin), normal, x);
            return out.map(p => curveFromNurbs(p, normal.clone().negate().toArray()));
        }
        if (!req.curves?.length) throw new Error('select the curves to project');
        const dir = new THREE.Vector3(...req.dir);
        if (!(dir.length() > 1e-12)) throw new Error('the projection has no direction');
        dir.normalize();
        const out = projectCurves(shape(req.body), req.faces ?? [], req.curves.map(curve), dir, { length: this.sheetSize(), both: !!req.both, hide: !!req.hide });
        return out.map(p => curveFromNurbs(p, dir.toArray()));
    }

    previewProject(req) { return this.latest(async () => this.projectResult(req)) }

    /** Plasticity's Imprint: the body's faces (all when `faces` is empty) split where the curves cross them. */
    imprintResult({ body, faces = [], curves = [], tools = {}, projection = null }) {
        const s = this.shapes.get(body);
        if (!s) throw new Error('that body no longer exists');
        if (projection) return this.imprintProjected(s, body, faces, curves, tools, projection);
        const all = [...this.toolSheets(curves, tools, this.sheetSize()), ...this.toolBodies(tools, body)];
        if (!all.length) throw new Error('select curves or another body to imprint');
        return imprintWithHistory(s, faces, all);
    }

    /**
     * Imprint Curve Body's options: the curves carried along their normals (Normal) or `dir`
     * (Vector), forwards or `both` ways, onto faces seen along the way with `hide`, carried on
     * past their ends with `complete` (Completion Edge); then other bodies imprint where they meet.
     */
    imprintProjected(s, body, faces, curves, tools, { dir = null, both = false, hide = false, complete = false }) {
        const cs = curves.map(id => { const c = this.curveMap.get(id); if (!c) throw new Error('that curve no longer exists'); return c; });
        for (const c of tools.shapes ?? []) { checkCurve(c); cs.push(c); }
        let fixed = null;
        if (dir) {
            fixed = new THREE.Vector3(...dir);
            if (!(fixed.length() > 1e-12)) throw new Error('the projection has no direction');
            fixed.normalize();
        }
        const dirOf = c => fixed ?? new THREE.Vector3(...c.normal).normalize();
        let r = cs.length ? imprintEdgesWithHistory(s, projectedEdges(s, faces, cs, dirOf, { length: this.sheetSize(), both, hide, extend: complete })) : null;
        const others = this.toolBodies(tools, body);
        if (others.length) {
            const next = imprintWithHistory(r ? r.shape : s, r ? [] : faces, others);
            r = r ? { shape: next.shape, history: chain(r.history, next.history) } : next;
        }
        if (!r) throw new Error('select curves or another body to imprint');
        return r;
    }

    previewImprint(req) { return this.latest(async () => this.body(req.body, this.imprintResult(req).shape)) }

    /** Plasticity's Isoparam: face `face` of `body` split along u (`u`) or v at `params` (0 to 1), or through `point`. */
    isoparamSplitResult({ body, face, u, point = [0, 0, 0], params = [], subdivide = false }) {
        const s = this.shapes.get(body);
        if (!s) throw new Error('that body no longer exists');
        return isoparamSplit(s, face, !!u, point, params, !!subdivide);
    }

    previewIsoparamSplit(req) { return this.latest(async () => this.body(req.body, this.isoparamSplitResult(req).shape)) }

    /** Isoparam's edges as one undo step. */
    async commitIsoparamSplit(req) {
        const { shape, history } = this.isoparamSplitResult(req);
        this.checkpoint();
        this.put(req.body, shape, history);
        return { id: req.body, scene: this.bodies() };
    }

    /** Plasticity's Reverse Sheet: the sheets turned to face the other way, as one undo step; refs kept. */
    async commitReverseSheets({ bodies }) {
        if (!bodies?.length) throw new Error('select the sheets to reverse');
        const done = bodies.map(id => {
            const s = this.shapes.get(id);
            if (!s) throw new Error('that body no longer exists');
            if (count(s, 'TopAbs_SOLID') > 0) throw new Error('Reverse Sheet works on sheets; a solid always faces out');
            return [id, s.Reversed()];
        });
        this.checkpoint();
        for (const [id, s] of done) this.shapes.set(id, s);
        return this.bodies();
    }

    /** Plasticity's Find Boundary Edges: each body's edges that bound only one face. */
    async boundaryEdges({ bodies }) {
        return bodies.map(id => {
            const s = this.shapes.get(id);
            if (!s) throw new Error('that body no longer exists');
            return { body: id, edges: boundaryEdges(s) };
        });
    }

    /** Plasticity's Delete Redundant Topology on the bodies, as one undo step; says how many faces and edges went. */
    async commitUnify({ bodies }) {
        if (!bodies?.length) throw new Error('select the bodies to clean up');
        let faces = 0, edges = 0;
        const done = bodies.map(id => {
            const s = this.shapes.get(id);
            if (!s) throw new Error('that body no longer exists');
            const r = unifyWithHistory(s);
            faces += count(s, 'TopAbs_FACE') - count(r.shape, 'TopAbs_FACE');
            edges += numberedEdges(s).length - numberedEdges(r.shape).length;
            return [id, r];
        });
        this.checkpoint();
        for (const [id, { shape, history }] of done) this.put(id, shape, history);
        return { faces, edges, scene: this.bodies() };
    }

    /** Imprint as one undo step; `consume` deletes the curves as well (the knife, K). */
    async commitImprint(req) {
        const { shape, history } = this.imprintResult(req);
        this.checkpoint();
        this.put(req.body, shape, history);
        if (req.consume) for (const id of req.curves ?? []) this.curveMap.delete(id);
        return { id: req.body, scene: this.bodies() };
    }

    /** Offset Edge on curved faces or several faces: `edges` moved `distance` across the faces on `side` (or away from face `away`). */
    offsetEdgesResult({ body, edges, distance, side = 0, away = null }) {
        const s = this.shapes.get(body);
        if (!s) throw new Error('that body no longer exists');
        return offsetEdges(s, edges, distance, side, away ?? null);
    }

    previewOffsetEdges(req) { return this.latest(async () => this.body(req.body, this.offsetEdgesResult(req).shape)) }

    /** Offset Edge on any faces as one undo step. */
    async commitOffsetEdges(req) {
        const { shape, history } = this.offsetEdgesResult(req);
        this.checkpoint();
        this.put(req.body, shape, history);
        return { id: req.body, scene: this.bodies() };
    }

    /** Plasticity's Bridge Surface: a sheet from one body edge to another, tangent to their faces. */
    bridgeSurfaceResult({ a, b, tension = 1 }) {
        const side = ({ body, edge }) => { const shape = this.shapes.get(body); if (!shape) throw new Error('that body no longer exists'); return { shape, n: edge }; };
        return bridgeSurface(side(a), side(b), tension);
    }

    previewBridgeSurface(req) { return this.latest(async () => this.body(0, this.bridgeSurfaceResult(req))) }

    /** Bridge Surface as one undo step: the sheet becomes a body of its own. */
    async commitBridgeSurface(req) {
        const sheet = this.bridgeSurfaceResult(req);
        this.checkpoint();
        const id = this.nextId++;
        this.put(id, sheet);
        return { id, scene: this.bodies() };
    }

    /**
     * Bridge Surface between two crossing sheets (sheetFillet.js): what becomes of each sheet and
     * the bridge, as w3d_sheet_fillet, and which of them to show.
     */
    sheetBridgeResult({ a, b, width, shape = 'g2', trim = 'both', sense = [false, false] }) {
        if (a === b) throw new Error('select two different sheets');
        const sa = this.shapes.get(a), sb = this.shapes.get(b);
        if (!sa || !sb) throw new Error('that body no longer exists');
        const w = trimWalls(sa, sb, sheetFillet(sa, sb, { width, shape, sense }), trim);
        const out = [w.a, w.b, w.bridge];
        const shown = trim === 'both' ? 0 : trim === 'none' ? 2 : out[0] !== sa ? 0 : 1;
        return { out, shown };
    }

    previewSheetBridge(req) { return this.latest(async () => { const { out, shown } = this.sheetBridgeResult(req); return this.body(0, out[shown]); }) }

    /** As one undo step: each sheet replaced by what it became (or gone), the bridge a body where it stands alone. */
    async commitSheetBridge(req) {
        const { out: [na, nb, bridge], shown } = this.sheetBridgeResult(req);
        this.checkpoint();
        for (const [id, s] of [[req.a, na], [req.b, nb]]) {
            if (s) this.put(id, s);
            else { this.shapes.delete(id); this.refs.delete(id); }
        }
        let added = null;
        if (bridge) { added = this.nextId++; this.put(added, bridge); }
        return { id: shown === 2 ? added : shown === 1 ? req.b : req.a, scene: this.bodies() };
    }

    /** Plasticity's Patch: a sheet filling one closed loop of curves and body edges. */
    patchResult({ curves = [], edges = [], tolerance, target, method }) {
        if (target !== undefined && target !== null) return this.patchTrimResult(target, edges, method);
        const cs = curves.map(id => { const c = this.curveMap.get(id); if (!c) throw new Error('that curve no longer exists'); return c; });
        const es = edges.map(({ body, edge, tangent, continuity }) => {
            const shape = this.shapes.get(body);
            if (!shape) throw new Error('that body no longer exists');
            // Continuity with the face along the edge: 0 none, 1 tangent (G1), 2 its curvature too.
            return { shape, n: edge, continuity: Math.min(2, continuity ?? (tangent ? 1 : 0)) };
        });
        return patch(cs, es, tolerance);
    }

    /** Patch › Method: the `target` sheet trimmed by edges of one base sheet (Trim to hole / sheet). */
    patchTrimResult(target, edges, method = 'hole') {
        if (!edges.length) throw new Error('select the edges of the base sheet to trim to');
        const base = edges[0].body;
        if (edges.some(e => e.body !== base)) throw new Error('the edges to trim to must be on one sheet');
        if (base === target) throw new Error("the target sheet must be another body than the edges'");
        const t = this.shapes.get(target), b = this.shapes.get(base);
        if (!t || !b) throw new Error('that body no longer exists');
        const all = numberedEdges(b);
        return patchTrim(t, b, edges.map(e => { if (!all[e.edge]) throw new Error('no such edge'); return all[e.edge]; }), method === 'sheet' ? 'sheet' : 'hole');
    }

    /** Loft of curves: a sheet through `req.curves` in order, closed back on the first with `req.loop`. */
    loftSheetResult(req) {
        const c = id => { const x = this.curveMap.get(id); if (!x) throw new Error('that curve no longer exists'); return x; };
        // A drawn curve's id, or a curve given whole (a body edge picked as a profile).
        return loftSheet((req.curves ?? []).map(g => typeof g === 'object' && g ? g : c(g)), !!req.loop, req.simplify ?? true);
    }

    previewLoftSheet(req) { return this.latest(async () => this.body(0, this.loftSheetResult(req))) }

    async commitLoftSheet(req) {
        const sheet = this.loftSheetResult(req);
        this.checkpoint();
        const id = this.nextId++;
        this.put(id, sheet);
        return { id, scene: this.bodies() };
    }

    previewPatch(req) { return this.latest(async () => this.body(0, this.patchResult(req))) }

    /** Patch as one undo step: the sheet becomes a body of its own, and the loop stays. */
    async commitPatch(req) {
        const sheet = this.patchResult(req);
        this.checkpoint();
        if (req.target !== undefined && req.target !== null) {
            this.put(req.target, sheet);
            return { id: req.target, scene: this.bodies() };
        }
        const id = this.nextId++;
        this.put(id, sheet);
        return { id, scene: this.bodies() };
    }

    /** Plasticity's Pipe: a tube along each of `curves`, round (`sides` 0) or polygonal, hollow with a `thickness`. */
    pipeResult({ curves = [], radius, thickness = 0, sides = 0, angle = 0, scale = 1 }) {
        if (!curves.length) throw new Error('select the curves to run pipes along');
        const o = oc();
        return curves.map(id => {
            const c = this.curveMap.get(id);
            if (!c) throw new Error('that curve no longer exists');
            const tube = pipe(c, radius, thickness, sides, angle, scale);
            if (!new o.BRepCheck_Analyzer(tube, true, false, false).IsValid() || count(tube, 'TopAbs_SOLID') === 0) throw new Error('the pipe crosses itself; use a smaller radius');
            return tube;
        });
    }

    /** Pipe's booleans (Q union, W difference, Shift+E intersect): the target with each tube in turn, or null for new bodies. */
    pipeInto(req, tubes) {
        const op = { union: 'union', difference: 'difference', intersect: 'intersection' }[req.op];
        if (!op || req.target === null || req.target === undefined) return null;
        let s = this.shapes.get(req.target), history = null;
        if (!s) throw new Error('that body no longer exists');
        for (const t of tubes) {
            const r = booleanWithHistory(s, t, op);
            history = history ? chain(history, r.history) : r.history;
            s = r.shape;
        }
        if (count(s, 'TopAbs_FACE') === 0) throw new Error('the boolean leaves nothing');
        return { shape: s, history };
    }

    /** The tubes as one preview shape. */
    previewPipe(req) {
        return this.latest(async () => {
            const o = oc(), tubes = this.pipeResult(req), into = this.pipeInto(req, tubes);
            if (into) return this.body(req.target, into.shape);
            if (tubes.length === 1) return this.body(0, tubes[0]);
            const all = new o.TopoDS_Compound(), b = new o.BRep_Builder();
            b.MakeCompound(all);
            for (const t of tubes) b.Add(all, t);
            return this.body(0, all);
        });
    }

    /** Pipe as one undo step: each tube is a body of its own and the curves stay. */
    async commitPipe(req) {
        const tubes = this.pipeResult(req), into = this.pipeInto(req, tubes);
        if (into) {
            this.checkpoint();
            this.put(req.target, into.shape, into.history);
            const ids = [req.target];
            if (req.keepTools) for (const t of tubes) { const id = this.nextId++; this.put(id, t); ids.push(id); }
            return { ids, scene: this.bodies() };
        }
        this.checkpoint();
        const ids = tubes.map(t => { const id = this.nextId++; this.put(id, t); return id; });
        return { ids, scene: this.bodies() };
    }

    /**
     * Plasticity's Thicken: sheet `body` made solid, `front` along its normals and `back` behind. With
     * `faces`, Thicken Face: those faces of the body made a solid of their own, the body kept.
     */
    thickenResult({ body, front, back = 0, faces = [] }) {
        const s = this.shapes.get(body);
        if (!s) throw new Error('that body no longer exists');
        if (!faces.length) return thicken(s, front, back);
        if (!isSheet(s)) return thickenFaces(s, faces, front, back);
        // On a sheet the faces are copied into a sheet of their own and thickened.
        if (new Set(faces).size !== faces.length) throw new Error('a face is picked twice');
        const pieces = count(s, 'TopAbs_FACE') === 1 ? [s] : unjoin(s, true);
        const picked = faces.map(f => { if (!pieces[f]) throw new Error('no such face'); return pieces[f]; });
        return thicken(picked.length === 1 ? picked[0] : joinSheets(picked), front, back);
    }

    previewThicken(req) { return this.latest(async () => this.body(req.body, this.thickenResult(req))) }

    /** Thicken as one undo step: the sheet becomes the solid, keeping its body; Thicken Face adds a body. */
    async commitThicken(req) {
        const solid = this.thickenResult(req);
        this.checkpoint();
        const id = req.faces?.length ? this.nextId++ : req.body;
        this.put(id, solid);
        return { id, scene: this.bodies() };
    }

    /** Plasticity's Extend Sheet: sheet `body` grown `distance` past its open `edge`. */
    /** Plasticity's Subdivide on `faces` of `body` as one undo step: spans doubled, shape unchanged. */
    async commitSubdivideFaces({ body, faces }) {
        const s = this.shapes.get(body);
        if (!s) throw new Error('that body no longer exists');
        const shape = subdivideFaces(s, faces);
        this.checkpoint();
        this.put(body, shape);
        return { id: body, scene: this.bodies() };
    }

    /** Surface control points of `body` moved: `moves` is [[face, pole, [dx, dy, dz]]] (see movePoles.js). */
    movePolesResult({ body, moves }) {
        const s = this.shapes.get(body);
        if (!s) throw new Error('that body no longer exists');
        return moveFacePoles(s, moves);
    }

    previewMoveFacePoles(req) { return this.latest(async () => this.body(req.body, this.movePolesResult(req))) }

    /** Moving surface control points as one undo step: the body keeps its id. `more` moves other bodies' in the same step. */
    async commitMoveFacePoles(req) {
        const all = [req, ...(req.more ?? [])].map(r => [r.body, this.movePolesResult(r)]);
        this.checkpoint();
        for (const [body, shape] of all) this.put(body, shape);
        return { id: req.body, scene: this.bodies() };
    }

    /** Plasticity's Rebuild Face: `faces` of `body` given new B-spline surfaces (see rebuildFace.js). */
    rebuildResult({ body, faces, ...how }) {
        const s = this.shapes.get(body);
        if (!s) throw new Error('that body no longer exists');
        return rebuildFaces(s, faces, how);
    }

    previewRebuildFaces(req) {
        return this.latest(async () => { const { shape, rebuilt } = this.rebuildResult(req); return { ...this.body(req.body, shape), rebuilt }; });
    }

    /** Plasticity's Match Face: `faces` of `body` replaced by the surface of face `tface` of body `target`. */
    matchResult({ body, faces, target, tface, grow = 'moving' }) {
        const s = this.shapes.get(body), t = this.shapes.get(target);
        if (!s) throw new Error('that body no longer exists');
        if (!t) throw new Error('the target body no longer exists');
        if (target === body && faces.includes(tface)) throw new Error('match the faces to another face, not one of themselves');
        return matchFacesGrow(s, faces, t, tface, grow || 'moving', target === body ? tface : -1);
    }

    previewMatchFaces(req) { return this.latest(async () => this.body(req.body, this.matchResult(req))) }

    /** Match Face as one undo step: the body keeps its id. */
    async commitMatchFaces(req) {
        const shape = this.matchResult(req);
        this.checkpoint();
        this.put(req.body, shape);
        return { id: req.body, scene: this.bodies() };
    }

    /** Plasticity's Toggle Surface Curvature: comb teeth { at, dir, k } along edge `edge` of `body`. */
    /** Align Surface: the faces along edge `edge` of `body` and their frames at `points` (see alignSurface.js). */
    async edgeFaces({ body, edge, points = [] }) {
        const s = this.shapes.get(body);
        if (!s) throw new Error('that body no longer exists');
        return edgeFaces(s, edge, points);
    }

    async edgeCurvature({ body, edge, n = 160 }) {
        const s = this.shapes.get(body);
        if (!s) throw new Error('that body no longer exists');
        return edgeCurvature(s, edge, Math.min(2000, Math.max(1, n)));
    }

    /** Constrained Surface: the sheet of the surface fitted through the clicked points (splineSheet.js numbers). */
    previewSplineSheet({ data }) {
        return this.latest(async () => this.body(0, splineSheet(data)));
    }

    /** Constrained Surface as one undo step: the sheet is a new body. */
    async commitSplineSheet({ data }) {
        const sheet = splineSheet(data);
        this.checkpoint();
        const id = this.nextId++;
        this.put(id, sheet);
        return { ids: [id], scene: this.bodies() };
    }

    /** Plasticity's Untrim: a sheet of the whole surface under each of `faces` of `body`, edges imprinted with `keep`. */
    untrimResult({ body, faces = [], keep = false }) {
        const s = this.shapes.get(body);
        if (!s) throw new Error('that body no longer exists');
        if (!faces.length) throw new Error('select the faces to untrim');
        return faces.map(f => untrimFace(s, f, keep));
    }

    previewUntrim(req) {
        return this.latest(async () => { const sheets = this.untrimResult(req); return this.body(0, sheets.length === 1 ? sheets[0] : compound(sheets)); });
    }

    /** Untrim as one undo step: each sheet is a body of its own and the faces' body stays. */
    async commitUntrim(req) {
        const sheets = this.untrimResult(req);
        this.checkpoint();
        const ids = sheets.map(s => { const id = this.nextId++; this.put(id, s); return id; });
        return { ids, scene: this.bodies() };
    }

    /** Plasticity's Unwrap Face: each of `faces` of `body` laid flat on the XY plane. */
    unwrapResult({ body, faces = [] }) {
        const s = this.shapes.get(body);
        if (!s) throw new Error('that body no longer exists');
        if (!faces.length) throw new Error('select the faces to unwrap');
        return faces.map(f => unwrapFace(s, f));
    }

    previewUnwrap(req) {
        return this.latest(async () => { const sheets = this.unwrapResult(req); return this.body(0, sheets.length === 1 ? sheets[0] : compound(sheets)); });
    }

    /** Unwrap as one undo step: each flat sheet is a body of its own and the faces' body stays. */
    async commitUnwrap(req) {
        const sheets = this.unwrapResult(req);
        this.checkpoint();
        const ids = sheets.map(s => { const id = this.nextId++; this.put(id, s); return id; });
        return { ids, scene: this.bodies() };
    }

    /** Plasticity's Raise Surface Degree as one undo step: `faces` of `body`, or all of them. */
    async commitRaiseFaces({ body, faces = [] }) {
        const s = this.shapes.get(body);
        if (!s) throw new Error('that body no longer exists');
        const { shape, rebuilt } = raiseFaces(s, faces);
        this.checkpoint();
        this.put(body, shape);
        return { id: body, scene: this.bodies(), rebuilt };
    }

    /** Rebuild Face as one undo step: the body keeps its id. */
    async commitRebuildFaces(req) {
        const { shape, rebuilt } = this.rebuildResult(req);
        this.checkpoint();
        this.put(req.body, shape);
        return { id: req.body, scene: this.bodies(), rebuilt };
    }

    extendSheetResult({ body, edge, distance, natural = false, shape, limit, outside = false }) {
        const s = this.shapes.get(body);
        if (!s) throw new Error('that body no longer exists');
        if (limit != null) {
            if (limit === body) throw new Error('limit the sheet by another body, not itself');
            const t = this.shapes.get(limit);
            if (!t) throw new Error('the limiting body no longer exists');
            return extendSheetTo(s, edge, t, shape ?? (natural ? 'natural' : 'linear'), outside);
        }
        return extendSheet(s, edge, distance, shape ?? natural);
    }

    previewExtendSheet(req) { return this.latest(async () => this.body(req.body, this.extendSheetResult(req))) }

    /** Extend Sheet as one undo step: the sheet keeps its body. */
    async commitExtendSheet(req) {
        const sheet = this.extendSheetResult(req);
        this.checkpoint();
        this.put(req.body, sheet);
        return { id: req.body, scene: this.bodies() };
    }

    /** Plasticity's Join for sheets: `bodies` sewn into one; a closed result is a solid. */
    joinResult({ bodies }) {
        const ids = [...new Set(bodies ?? [])];
        if (ids.length < 2) throw new Error('select two or more sheets to join');
        return joinSheets(ids.map(id => { const s = this.shapes.get(id); if (!s) throw new Error('that body no longer exists'); return s; }));
    }

    previewJoinSheets(req) { return this.latest(async () => this.body(req.bodies[0], this.joinResult(req))) }

    /** Join as one undo step: the first body becomes the joined one, the others go. */
    async commitJoinSheets(req) {
        const joined = this.joinResult(req);
        this.checkpoint();
        const [first, ...rest] = [...new Set(req.bodies)];
        this.put(first, joined);
        for (const id of rest) { this.shapes.delete(id); this.refs.delete(id); }
        return { id: first, scene: this.bodies() };
    }

    /** Plasticity's Unjoin: `body` taken apart into its faces (`faces`) or its separate pieces. */
    unjoinResult({ body, faces }) {
        const s = this.shapes.get(body);
        if (!s) throw new Error('that body no longer exists');
        return unjoin(s, !!faces);
    }

    /** Unjoin as one undo step: the body keeps the first piece and the rest become new bodies. */
    async commitUnjoin(req) {
        const [first, ...rest] = this.unjoinResult(req);
        this.checkpoint();
        this.put(req.body, first);
        const ids = [req.body];
        for (const p of rest) { const id = this.nextId++; this.put(id, p); ids.push(id); }
        return { ids, scene: this.bodies() };
    }

    /** Plasticity's Draft Face: `faces` of `body` tilted by `angle` about the neutral plane through `origin` square to `pull`. */
    draftResult({ body, faces = [], pull, origin, angle, grow = 'moving' }) {
        const s = this.shapes.get(body);
        if (!s) throw new Error('that body no longer exists');
        let { shape, history } = draftFaces(s, faces, pull, origin, angle);
        if (grow === 'none') return { shape, history };
        // The manual's Grow, for an inner face drafted out past the body's outer wall beyond it (as
        // document.rs): Moving takes the wall's flat faces out as far, Fixed stops the face at the wall.
        const o = oc(), tol = 1e-6;
        const corners = sh => {
            const out = [];
            for (const ex = new o.TopExp_Explorer(sh, o.TopAbs_ShapeEnum.TopAbs_VERTEX, o.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
                const p = o.BRep_Tool.Pnt(o.TopoDS.Vertex(ex.Current()));
                out.push(new THREE.Vector3(p.X(), p.Y(), p.Z()));
            }
            return out;
        };
        const before = corners(s), planes = Array.from({ length: count(s, 'TopAbs_FACE') }, (_, j) => facePlane(s, j));
        const reach = (pts, p) => Math.max(0, ...pts.map(q => q.clone().sub(p.origin).dot(p.normal)));
        const size = 4 * Math.max(1, ...before.map(q => q.length()));
        for (const f of faces) {
            const p = planes[f];
            if (!p) continue;
            const wall = reach(before, p);
            if (wall <= tol) continue;
            const past = reach(corners(shape), p) - wall;
            if (past <= tol) continue;
            let tool = null, op = 'union';
            if (grow === 'fixed') {
                const at = p.origin.clone().addScaledVector(p.normal, wall), n = p.normal;
                tool = new o.BRepPrimAPI_MakePrism(planeSheet(at.toArray(), n.toArray(), size), new o.gp_Vec(n.x * size, n.y * size, n.z * size), false, true).Shape();
                op = 'difference';
            } else {
                planes.forEach((q, g) => {
                    if (!q || q.normal.dot(p.normal) < 1 - 1e-9 || Math.abs(q.origin.clone().sub(p.origin).dot(p.normal) - wall) > 10 * tol) return;
                    const slab = extrudeFace(s, g, past);
                    tool = tool ? booleanWithHistory(tool, slab, 'union').shape : slab;
                });
                if (!tool) continue;
            }
            const r = booleanWithHistory(shape, tool, op);
            history = chain(history, r.history);
            shape = r.shape;
        }
        return { shape, history };
    }

    previewDraft(req) { return this.latest(async () => this.body(req.body, this.draftResult(req).shape)) }

    async commitDraft(req) {
        const { shape, history } = this.draftResult(req);
        this.checkpoint();
        this.put(req.body, shape, history);
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

    blend(req, withHistory = false) {
        const { body, edges, kind, limits = [] } = req;
        if (kind === 'chamfer' || !limits.length) return this.blendWhole(req, withHistory);
        const shape = this.shapes.get(body);
        if (!shape) throw new Error('that body no longer exists');
        const rounded = this.blendWhole(req, false);
        const r = limitRound(shape, rounded, [...new Set(edges)], limits, booleanWithHistory);
        return withHistory ? r : r.shape;
    }

    blendWhole({ body, edges, size, kind, angle = Math.PI / 4, variable = [], shape: section = 'round', tension = 0.5 }, withHistory = false) {
        const shape = this.shapes.get(body);
        if (!shape) throw new Error('that body no longer exists');
        if (!edges.length) throw new Error('select at least one edge');
        if (kind !== 'chamfer' && section === 'full') {
            const r = fullRound(shape, [...new Set(edges)], booleanWithHistory);
            return withHistory ? r : r.shape;
        }
        if (!(size > 0)) throw new Error(`the ${kind === 'chamfer' ? 'distance' : 'radius'} must be greater than zero`);
        if (kind === 'chamfer' && !(angle > 0 && angle < Math.PI / 2)) throw new Error('the chamfer angle must be between 0 and 90 degrees');
        const unique = [...new Set(edges)];
        if (kind !== 'chamfer' && (section === 'conic' || section === 'g2')) {
            if (variable.length) throw new Error('a conic or G2 round takes one radius; remove the variable points');
            const r = blendEdges(shape, unique, size, false, true, angle);
            const rounds = [...new Set(r.history.generatedFaces.map(([, f]) => f))];
            const out = reshapeRounds(r.shape, rounds, section, tension);
            return withHistory ? { shape: out, history: undefined } : out;
        }
        if (kind !== 'chamfer' && section === 'chordal') {
            if (variable.length) throw new Error('a chordal round takes one distance; remove the variable points');
            const c = chordal(shape, unique, size);
            return blendEdges(shape, unique, c.size, false, withHistory, angle, c.variable);
        }
        return blendEdges(shape, unique, size, kind === 'chamfer', withHistory, angle, variable);
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

    /**
     * Triangle meshes of bodies for export, at `tolerance` mm from the true surface and `angle` radians
     * between neighbouring normals (Plasticity's export-mesh angle tolerance). Any finer display mesh is
     * cleared first, so a coarser export really is coarser.
     */
    async meshBodies(ids, { tolerance = 0.05, angle = 0.25 } = {}) {
        if (!(tolerance > 0) || !(angle > 0)) throw new Error('the tolerance and angle must be greater than zero');
        return ids.map(id => {
            const s = this.shapes.get(id);
            if (!s) throw new Error('that body no longer exists');
            oc().BRepTools.Clean(s, true);
            const { mesh } = tessellate(s, { deflection: tolerance, angle });
            return { id, positions: Array.from(mesh.getAttribute('position').array), indices: Array.from(mesh.index.array) };
        });
    }

    /** The hidden-line drawing of bodies seen from the camera (see Drawing.js). */
    async hiddenLines({ bodies, placed = [], origin, toward, x, deflection = 0.01 }) {
        const shapes = [...bodies.map(id => this.placedShape(id)), ...placed.map(p => this.placedShape(p.body, p.motion, p.mirror))];
        return hiddenLines(shapes, origin, toward, x, deflection);
    }

    /** Hand the user a file: the browser downloads it. */
    saveExport(name, data) {
        const url = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }));
        Object.assign(document.createElement('a'), { href: url, download: name }).click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return `SAVED ${name.toUpperCase()}`;
    }

    /** Body `id`'s shape, or with `motion` (an instance's motionOf) where an instance of it stands,
     * reflected in `mirror` ({ origin, normal }) first for a mirrored instance. */
    placedShape(id, motion = null, mirror = null) {
        let shape = this.shapes.get(id);
        if (!shape) throw new Error('that body no longer exists');
        if (mirror) shape = mirrorShape(shape, mirror.origin, mirror.normal);
        return motion ? transform(shape, { ...motion, axis: Math.hypot(...motion.axis) < 1e-9 ? [0, 1, 0] : motion.axis }) : shape;
    }

    /** Body `id` as a STEP download; with `motion`, where an instance of it stands. */
    exportStep(id, { motion = null, mirror = null, name: what = `body-${id}` } = {}) {
        const name = `witness3d-${what}.step`;
        const url = URL.createObjectURL(new Blob([exportSTEP(this.placedShape(id, motion, mirror))], { type: 'application/step' }));
        Object.assign(document.createElement('a'), { href: url, download: name }).click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return `SAVED ${name.toUpperCase()}`;
    }
}

/** Whether the curve encloses a region. */
const isClosed = c => c.kind === 'circle' || c.kind === 'ellipse' || (c.kind === 'nurbs' && nurbsLoop(c)) || (['polyline', 'spline', 'cv'].includes(c.kind) && c.closed && c.points.length >= 3) || (c.kind === 'contour' && loops(c.pieces));

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
    } else if (c.kind === 'cv') {
        if (!Array.isArray(c.points) || c.points.length < 2 || (c.closed && c.points.length < 3)) throw new Error('a curve needs two control points, a closed one three');
        if (!c.points.every(finite)) throw new Error('a point is not a number');
    } else if (c.kind === 'arc') {
        if (![c.start, c.mid, c.end].every(finite)) throw new Error('a point is not a number');
        const cross = (c.mid[0] - c.start[0]) * (c.end[1] - c.start[1]) - (c.mid[1] - c.start[1]) * (c.end[0] - c.start[0]);
        if (Math.abs(cross) < 1e-9) throw new Error('the three points of an arc must not lie on a line');
    } else if (c.kind === 'spiral') {
        const ok = v => Number.isFinite(v) && v > 1e-9;
        if (!ok(c.radius) || !ok(c.length) || !ok(c.turns)) throw new Error('a spiral needs a radius, a length and turns greater than zero');
    } else if (c.kind === 'nurbs') {
        const n = c.poles?.length ?? 0, d = c.degree;
        if (!(Number.isInteger(d) && d >= 1) || n < d + 1 || c.weights?.length !== n || c.knots?.length !== n + d + 1) throw new Error("a NURBS curve's knots and weights do not match its poles");
        if (!c.poles.every(p => finite(p) && p.length === 3) || !finite(c.knots)) throw new Error('a point is not a number');
        if (!c.weights.every(w => Number.isFinite(w) && w > 0)) throw new Error("a NURBS curve's weights must be positive");
        if (c.knots.some((k, i) => i > 0 && k < c.knots[i - 1]) || !(c.knots[n] - c.knots[d] > 1e-12)) throw new Error("a NURBS curve's knots must increase");
    } else throw new Error('a curve is a line, circle, spline, control-point curve, arc, ellipse, contour, spiral or projected curve');
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
