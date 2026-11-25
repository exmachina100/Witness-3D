// G3 Blend (LABS): a sheet between two edges that meets each edge's face in G0 to G3, with its own
// tension at each end. Shared by both builds; the kernel only makes sheets, reports edge geometry
// and evaluates faces.
//
// How: a first sheet, degree 7 across (8 rows of points, one span) and cubic along, is laid from
// edge A to edge B leaving each face square to its edge. Then the Seam Solver (seamSolver.js) fits
// rows 0-3 to face A and rows 4-7 to face B. With one degree-7 span across, each end's position and
// first three derivatives depend only on its own four rows, so the two solves don't disturb each
// other. The first sheet is made on the kernel only so the solver can measure it, and is taken back
// with one undo; the result is the numbers of the final sheet (splineSheet.js layout).

import { readEdgeFaces } from './alignSurface.js';
import { intoFace } from './seamCheck.js';
import { SOLVER_CONTINUITY, basisDers, seamSolveRequest, solve } from './seamSolver.js';

const sub = (a, b) => a.map((v, i) => v - b[i]);
const add = (a, b) => a.map((v, i) => v + b[i]);
const mul = (a, s) => a.map(v => v * s);
const len = a => Math.hypot(...a);
const dist = (a, b) => len(sub(a, b));
const unit = a => { const l = len(a); return l > 1e-15 ? mul(a, 1 / l) : [0, 0, 0]; };

/** Rows across the blend: one span of degree 7, so each end's G0-G3 is set by its own four rows. */
export const ACROSS = 7;
/** Points along the blend (cubic): enough to follow an edge that bends, few enough to stay fair. */
export const ALONG = 16;

/** Clamped uniform knots, flat, for `count` points of degree `p`. */
export function clampedKnots(count, p) {
    const inner = count - p - 1;
    return [...Array(p + 1).fill(0), ...Array.from({ length: inner }, (_, i) => (i + 1) / (inner + 1)), ...Array(p + 1).fill(1)];
}

/**
 * Poles and flat knots of the cubic through `rows` of points (each row the same length, points at
 * even steps of the edge's parameter), so the blend's sides lie on the edges from the start.
 */
export function interpolateRows(rows, q = 3) {
    const m = rows[0].length;
    if (m <= q) throw new Error('too few points along the edge');
    const u = Array.from({ length: m }, (_, j) => j / (m - 1));
    // Knots by averaging the parameters (Piegl & Tiller 9.8).
    const inner = Array.from({ length: m - q - 1 }, (_, j) => u.slice(j + 1, j + q + 1).reduce((s, v) => s + v, 0) / q);
    const knots = [...Array(q + 1).fill(0), ...inner, ...Array(q + 1).fill(1)];
    const N = u.map(x => basisDers(knots, q, x, 0)[0]);
    return { knots, rows: rows.map(row => solve(N.map(r => r.slice()), row)) };
}

/** Points along an edge and the way out of its face at each (away from the face, square to the edge). */
async function edgeSide(backend, e, n) {
    const teeth = await backend.edgeCurvature({ body: e.body, edge: e.edge, n: n + 1 });
    if (teeth.length < 3) throw new Error('that edge is too short to blend');
    const at = teeth.map(t => t.at);
    const faces = readEdgeFaces(await backend.edgeFaces({ body: e.body, edge: e.edge, points: at }), at.length);
    if (!faces.length) throw new Error('blend edges of sheets or solids; a loose curve has no face to leave');
    // A solid's edge has two faces: the blend leaves the first one (a sheet's edge has one).
    const f = faces[0];
    const out = at.map((p, k) => {
        const t = unit(sub(at[Math.min(k + 1, at.length - 1)], at[Math.max(k - 1, 0)]));
        return mul(intoFace(f.frames[k], t, f.middle), -1);
    });
    return { at, out, face: f.face };
}

/**
 * The first sheet's numbers (splineSheet.js layout, u across from A to B, v along): rows leave each
 * edge along its face, a third of the way less a little, times that end's tension.
 */
export function firstSheet(A, B, { tension = [1, 1] } = {}) {
    const m = A.at.length;
    // B runs the way A does.
    const flip = dist(A.at[0], B.at[0]) + dist(A.at[m - 1], B.at[m - 1]) > dist(A.at[0], B.at[m - 1]) + dist(A.at[m - 1], B.at[0]);
    const bAt = flip ? [...B.at].reverse() : B.at, bOut = flip ? [...B.out].reverse() : B.out;
    const rows = Array.from({ length: ACROSS + 1 }, () => []);
    for (let j = 0; j < m; j++) {
        const a = A.at[j], b = bAt[j], gap = dist(a, b);
        if (!(gap > 1e-6)) throw new Error('the two edges touch; blend edges with a gap between them');
        for (let i = 0; i <= 3; i++) rows[i].push(add(a, mul(A.out[j], gap * tension[0] * i / ACROSS)));
        for (let i = 4; i <= ACROSS; i++) rows[i].push(add(b, mul(bOut[j], gap * tension[1] * (ACROSS - i) / ACROSS)));
    }
    const uk = clampedKnots(ACROSS + 1, ACROSS), { knots: vk, rows: fitted } = interpolateRows(rows);
    return [ACROSS, 3, ACROSS + 1, m, uk.length, vk.length, ...uk, ...vk, ...fitted.flat(2)];
}

/** `data` with pole moves [pole, [dx, dy, dz]] added (pole k = row k / nv, column k % nv). */
export function movePoles(data, moves) {
    const [, , nu, nv, nku, nkv] = data, at = 6 + nku + nkv, out = [...data];
    for (const [k, d] of moves) {
        if (!(k >= 0 && k < nu * nv)) throw new Error('the solve moved a point the blend does not have');
        for (let c = 0; c < 3; c++) out[at + 3 * k + c] += d[c];
    }
    return out;
}

/** The edge of `body` in `scene` whose middle lies nearest `p`. */
export function nearestEdge(scene, body, p) {
    const b = scene.find(x => x.id === body);
    if (!b) throw new Error('the blend sheet went missing');
    let best = null;
    b.edges.forEach((e, n) => {
        const k = Math.floor(e.length / 6) * 3, d = dist([e[k], e[k + 1], e[k + 2]], p);
        if (!best || d < best.d) best = { n, d };
    });
    return best.n;
}

/**
 * The blend from edge `a` to edge `b` ({ body, edge }): continuity per end (G0-G3) and tension per
 * end. Returns { data, solves: [A, B] } where each solve says how close the solver got (its G3 rate
 * miss, when G3). Leaves the kernel as it found it.
 */
export async function g3Blend(backend, a, b, { continuity = ['G3', 'G3'], tension = [1, 1], along = ALONG, passes = 1 } = {}) {
    if (a.body === b.body && a.edge === b.edge) throw new Error('pick two different edges');
    for (const c of continuity) if (!SOLVER_CONTINUITY.includes(c)) throw new Error('the continuity is G0, G1, G2 or G3');
    if (!tension.every(t => t > 0)) throw new Error('the tension must be above zero');
    const [A, B] = await Promise.all([edgeSide(backend, a, along - 1), edgeSide(backend, b, along - 1)]);
    const mid = s => s.at[Math.floor(s.at.length / 2)];
    let data = firstSheet(A, B, { tension }), solves = [];
    // Each pass solves both ends on the sheet the last pass left: the second mops up what the first
    // couldn't see (each end's fit was measured with the other end's rows not yet moved).
    for (let pass = 0; pass < passes; pass++) {
        const { ids: [id], scene } = await backend.commitSplineSheet({ data });
        try {
            const ends = [nearestEdge(scene, id, mid(A)), nearestEdge(scene, id, mid(B))];
            if (ends[0] === ends[1]) throw new Error('the blend sheet folded onto itself; move the edges apart');
            solves = [];
            let next = data;
            for (const [k, ref] of [a, b].entries()) {
                const req = await seamSolveRequest(backend, { target: { body: id, edge: ends[k] }, reference: ref, continuity: continuity[k], tension: tension[k] });
                next = movePoles(next, req.check.moves);
                solves.push({ continuity: continuity[k], points: req.check.moves.length, g3: req.g3 ?? null });
            }
            data = next;
        } finally {
            await backend.undo();
        }
    }
    return { data, solves };
}
