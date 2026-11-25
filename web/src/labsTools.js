// LABS tools for an AI agent: one registry that the in-app agent panel, the MCP server and the
// headless runner all use. Each tool is a JSON schema the model sees plus `run(session, args)`,
// which calls the same code the LABS commands use (seamCheck.js, seamSolver.js, g3Blend.js,
// classAFit.js, layoutPlanner.js) against a backend (LocalBackend in the browser and in node, the
// desktop's commands in the app). Every tool returns a small JSON result with measured numbers.
//
// Changes go through the backend's undo stack. A session counts the steps it made, so the user can
// keep them all or roll every one back (the agent can also undo its own last step); it never
// undoes anything that was there before the session started.

import { CLASS_A, HIGHLIGHT_KINK, checkSeam } from './seamCheck.js';
import { SOLVER_CONTINUITY, seamSolveRequest } from './seamSolver.js';
import { g3Blend, nearestEdge } from './g3Blend.js';
import { FIT_TOLERANCE, classAFitFace } from './classAFit.js';
import { planFaceLayout } from './layoutPlanner.js';

const r4 = v => (v === null || v === undefined ? null : Math.round(v * 1e4) / 1e4);
const pt = p => p.map(v => Math.round(v * 100) / 100);

/** A Seam Check result in a few numbers. */
export function seamNumbers(r) {
    return {
        level: r.level,
        gap_mm: r4(r.worst.gap), angle_deg: r4(r.worst.angle), g2_pct: r4(r.worst.g2), g3_pct: r4(r.worst.g3),
        highlight_deg: r4(r.highlight?.worst ?? null),
        ok: r.ok,
    };
}

const edgeMiddle = e => { const k = Math.floor(e.length / 6) * 3; return [e[k], e[k + 1], e[k + 2]]; };
const edgeLength = e => { let s = 0; for (let i = 3; i < e.length; i += 3) s += Math.hypot(e[i] - e[i - 3], e[i + 1] - e[i - 2], e[i + 2] - e[i - 1]); return s; };

/**
 * A session: the backend, the scene as last reported, how many undo steps this session added, and
 * `onScene` (the app redraws there).
 */
export function labsSession(backend, { scene = [], onScene = () => {}, onCommit = () => {}, onUndo = () => {} } = {}) {
    const s = {
        backend, scene, steps: 0, log: [],
        show(list) { if (list) { s.scene = list; onScene(list); } },
        /** A change went in: `list` the new scene, `what` the step's name, `id` the body it made or moved. */
        async committed(list, what, id = null) { s.steps++; s.log.push(what); onCommit(what, id); s.show(list); },
        /** Take back this session's last step. */
        async undoOne() {
            const list = await s.backend.undo();
            s.steps--;
            const what = s.log.pop();
            onUndo(what);
            s.show(list);
            return what;
        },
        /** Undo every step this session made. */
        async rollback() { while (s.steps > 0) await s.undoOne(); },
        /** Keep what the session made: later rollbacks leave it alone. */
        keep() { s.steps = 0; s.log = []; },
    };
    return s;
}

const edgeArgs = (prefix, what) => ({
    [`${prefix}body`]: { type: 'integer', description: `body id of the ${what}` },
    [`${prefix}edge`]: { type: 'integer', description: `edge number of the ${what} in that body` },
});

/** The registry. */
export const LABS_TOOLS = [
    {
        name: 'describe_model',
        description: 'List the bodies in the model: id, whether a sheet or solid, face count and each edge (number, middle point, length). Coordinates are millimetres with y up. Call this first to find edge and face numbers.',
        input_schema: { type: 'object', properties: {} },
        async run(s) {
            const list = s.scene.length ? s.scene : (await s.backend.bodies?.()) ?? [];
            return {
                bodies: list.map(b => ({
                    id: b.id, kind: b.sheet ? 'sheet' : 'solid', faces: b.facePlanes?.length ?? null,
                    edges: b.edges.length <= 200 ? b.edges.map((e, n) => ({ edge: n, middle: pt(edgeMiddle(e)), length_mm: Math.round(edgeLength(e) * 10) / 10 })) : `${b.edges.length} edges (too many to list)`,
                })),
                targets: { gap_mm: CLASS_A.g0, angle_deg: CLASS_A.g1, g2_pct: CLASS_A.g2, g3_pct: CLASS_A.g3, highlight_deg: HIGHLIGHT_KINK, fit_mm: FIT_TOLERANCE },
            };
        },
    },
    {
        name: 'seam_check',
        description: 'Measure a seam against the Class-A targets: gap, angle between the faces, G2 and G3 differences and highlight-line kink, worst along the seam. Give one edge two faces share, or an edge plus the matching edge of the other sheet (other_body/other_edge).',
        input_schema: { type: 'object', properties: { ...edgeArgs('', 'seam edge'), ...edgeArgs('other_', 'partner edge on the other sheet (optional)') }, required: ['body', 'edge'] },
        async run(s, a) {
            const seam = { body: a.body, edge: a.edge, ...(a.other_body !== undefined ? { other: { body: a.other_body, edge: a.other_edge } } : {}) };
            return seamNumbers(await checkSeam(s.backend, seam));
        },
    },
    {
        name: 'seam_solve',
        description: "Move the target sheet's control-point rows next to its edge so it meets the reference edge's face in G0, G1, G2 or G3. Changes the model (one undo step) and reports Seam Check before and after.",
        input_schema: {
            type: 'object',
            properties: { ...edgeArgs('target_', 'sheet edge to move'), ...edgeArgs('reference_', 'edge to meet'), continuity: { type: 'string', enum: SOLVER_CONTINUITY } },
            required: ['target_body', 'target_edge', 'reference_body', 'reference_edge'],
        },
        async run(s, a) {
            const target = { body: a.target_body, edge: a.target_edge }, reference = { body: a.reference_body, edge: a.reference_edge };
            const before = seamNumbers(await checkSeam(s.backend, { ...target, other: reference }));
            const req = await seamSolveRequest(s.backend, { target, reference, continuity: a.continuity ?? 'G3' });
            const { scene } = await s.backend.commitMoveFacePoles({ body: req.body, moves: req.moves });
            await s.committed(scene, `seam_solve ${a.continuity ?? 'G3'}`, req.body);
            const after = seamNumbers(await checkSeam(s.backend, { ...target, other: reference }));
            return { moved_points: req.moves.length, before, after };
        },
    },
    {
        name: 'g3_blend',
        description: 'Make a new sheet between two edges that meets both faces in G0 to G3, with a tension at each end (1 = default; higher runs further along the face before turning). Changes the model and reports Seam Check at both ends.',
        input_schema: {
            type: 'object',
            properties: { ...edgeArgs('a_', 'first edge'), ...edgeArgs('b_', 'second edge'), continuity: { type: 'string', enum: SOLVER_CONTINUITY }, tension_a: { type: 'number' }, tension_b: { type: 'number' } },
            required: ['a_body', 'a_edge', 'b_body', 'b_edge'],
        },
        async run(s, a) {
            const A = { body: a.a_body, edge: a.a_edge }, B = { body: a.b_body, edge: a.b_edge };
            const c = a.continuity ?? 'G3';
            const mids = [A, B].map(e => edgeMiddle(s.scene.find(b => b.id === e.body)?.edges[e.edge] ?? [0, 0, 0]));
            const r = await g3Blend(s.backend, A, B, { continuity: [c, c], tension: [a.tension_a ?? 1, a.tension_b ?? 1] });
            const { ids: [id], scene } = await s.backend.commitSplineSheet({ data: r.data });
            await s.committed(scene, `g3_blend ${c}`, id);
            const seams = [];
            for (const [k, ref] of [A, B].entries()) seams.push(seamNumbers(await checkSeam(s.backend, { body: id, edge: nearestEdge(scene, id, mids[k]), other: ref })));
            return { body: id, seams };
        },
    },
    {
        name: 'class_a_fit',
        description: 'Rebuild one face as a single faired Bézier patch of degree 5 to 7 within a tolerance (mm). Adds the patch as a new sheet beside the face; reports degree, deviation and inflections before/after. Refuses with the closest fit when no single patch fits.',
        input_schema: { type: 'object', properties: { body: { type: 'integer' }, face: { type: 'integer' }, tolerance: { type: 'number' }, fair: { type: 'boolean' } }, required: ['body', 'face'] },
        async run(s, a) {
            const r = await classAFitFace(s.backend, { body: a.body, face: a.face }, { tolerance: a.tolerance ?? FIT_TOLERANCE, fair: a.fair ?? true });
            const { ids: [id], scene } = await s.backend.commitSplineSheet({ data: r.data });
            await s.committed(scene, `class_a_fit degree ${r.degree}`, id);
            return { body: id, degree: r.degree, deviation_mm: r4(r.deviation), inflections_before: r.before, inflections_after: r.inflections };
        },
    },
    {
        name: 'patch_layout',
        description: "Lay a face out in Class-A patches: cuts where its bend changes fastest (or the cuts you give, as fractions 0..1 along u and v), the patches fitted together so they meet in G1. Adds them as one new sheet; reports each patch's deviation and the cuts.",
        input_schema: {
            type: 'object',
            properties: { body: { type: 'integer' }, face: { type: 'integer' }, tolerance: { type: 'number' }, cuts_u: { type: 'array', items: { type: 'number' } }, cuts_v: { type: 'array', items: { type: 'number' } } },
            required: ['body', 'face'],
        },
        async run(s, a) {
            const cuts = a.cuts_u || a.cuts_v ? [a.cuts_u ?? [], a.cuts_v ?? []] : null;
            const r = await planFaceLayout(s.backend, { body: a.body, face: a.face }, { tolerance: a.tolerance ?? 0.05, ...(cuts ? { cuts } : {}) });
            const [first, ...more] = r.data;
            const { ids: [id], scene } = await s.backend.commitSplineSheet({ data: first, more });
            await s.committed(scene, `patch_layout ${r.patches.length}`, id);
            return {
                body: id, ok: r.plan.ok,
                cuts_u: r.fractions[0].map(r4), cuts_v: r.fractions[1].map(r4),
                patches: r.patches.map(p => ({ deviation_mm: r4(p.deviation), inflections: p.inflections })),
            };
        },
    },
    {
        name: 'undo_last',
        description: 'Undo the last change this session made (only changes made in this session can be undone this way).',
        input_schema: { type: 'object', properties: {} },
        async run(s) {
            if (s.steps < 1) return { undone: false, reason: 'nothing of this session to undo' };
            return { undone: await s.undoOne() };
        },
    },
];

/** Tool schemas for the Messages API / MCP tools/list. */
export const labsSchemas = (extra = []) => [...LABS_TOOLS, ...extra].map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema }));

/** Run tool `name` with `args` in session `s`: { ok, result } or { ok: false, error }. */
export async function runLabsTool(s, name, args = {}, extra = []) {
    const tool = [...LABS_TOOLS, ...extra].find(t => t.name === name);
    if (!tool) return { ok: false, error: `no tool called ${name}` };
    try { return { ok: true, result: await tool.run(s, args ?? {}) }; }
    catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
}
