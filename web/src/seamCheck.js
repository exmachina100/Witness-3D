// Seam Check (LABS): how well two surfaces meet along a seam, measured against Class-A targets.
// Shared by both builds: the kernel only reports points along the edge (edge_curvature) and each
// face's frame (point, first and second derivatives) at points projected onto it (edge_faces); the
// numbers are worked out here.
//
// Along the seam, at each sample:
//   G0  the gap between the two faces (mm),
//   G1  the angle between their normals (degrees),
//   G2  the difference of their normal curvatures across the seam, in percent of the larger (with
//       a floor so nearly flat faces don't divide by almost nothing),
//   G3  the difference of how fast that curvature changes going across (percent, same way), from
//       curvatures a little way into each face (a one-sided second-order difference): an estimate.
// A seam is either an edge two faces of one body share, or an edge of one body measured against an
// edge of another (two sheets that meet but aren't joined).

import { normalCurvature, readEdgeFaces } from './alignSurface.js';

const sub = (a, b) => a.map((v, i) => v - b[i]);
const add = (a, b) => a.map((v, i) => v + b[i]);
const mul = (a, s) => a.map(v => v * s);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(...a);
const dist = (a, b) => len(sub(a, b));
const unit = a => { const l = len(a); return l > 1e-15 ? mul(a, 1 / l) : [0, 0, 0]; };

/**
 * The Class-A targets: gap in mm, angle in degrees, G2 and G3 differences in percent. G0-G2 are the
 * user's numbers (2026-11-24); the G3 target is not given anywhere and is our own pick (inferred).
 */
export const CLASS_A = { g0: 0.001, g1: 0.05, g2: 0.5, g3: 5 };

/** Curvature below 1 / FLAT_RADIUS (mm) counts as flat when the G2 and G3 percentages are taken. */
export const FLAT_RADIUS = 10000;

/** The continuity a seam reaches against `tol`: 'G3', 'G2', 'G1', 'G0' or 'none'. */
export function levelOf(worst, tol = CLASS_A) {
    if (!(worst.gap <= tol.g0)) return 'none';
    if (!(worst.angle <= tol.g1)) return 'G0';
    if (worst.g2 === null || !(worst.g2 <= tol.g2)) return 'G1';
    if (worst.g3 === null || !(worst.g3 <= tol.g3)) return 'G2';
    return 'G3';
}

/** A frame's unit normal, the way the face faces. */
export function normalOf(f) {
    return mul(unit(cross(f.su, f.sv)), f.sign < 0 ? -1 : 1);
}

/**
 * The direction across the seam into a face at a sample: in the face's tangent plane, square to the
 * seam's tangent `t`, turned toward the face's `middle` (a point inside it).
 */
export function intoFace(f, t, middle) {
    const n = normalOf(f);
    let e = unit(cross(n, t));
    if (dot(e, sub(middle, f.at)) < 0) e = mul(e, -1);
    return e;
}

/** The normal curvature of a face (frame f) going `e`, its normal turned to agree with `up`. */
function bendAlong(f, e, up) {
    let n = normalOf(f);
    if (up && dot(n, up) < 0) n = mul(n, -1);
    const et = unit(sub(e, mul(n, dot(e, n))));
    return normalCurvature(f, n, et);
}

/** Percent difference of a and b, of the larger of the two or `floor`. */
const percent = (a, b, floor) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), floor) * 100;

/**
 * The numbers along a seam from the faces' frames. `tangents` are the seam's directions at the
 * samples; `a` and `b` are { frames, middle } for the faces on each side, and optionally `aIn` and
 * `bIn`: frames at h and 2h into each face for the G3 estimate (`h` in mm). `length` is the seam's
 * length, for the G3 floor. Returns per-sample numbers and the worst of each.
 */
export function seamMetrics(tangents, a, b, { h = 0, aIn = null, bIn = null, length = 1 } = {}) {
    const kFloor = 1 / FLAT_RADIUS, dkFloor = kFloor / Math.max(length, 1e-9);
    const samples = tangents.map((t, k) => {
        const fa = a.frames[k], fb = b.frames[k];
        const gap = dist(fa.at, fb.at);
        const na = normalOf(fa), nb = normalOf(fb);
        const c = Math.min(1, Math.abs(dot(na, nb)));
        const angle = Math.acos(c) * 180 / Math.PI;
        // One direction across the seam for both faces: into A. Normal curvature doesn't change
        // when the direction is turned round, so both faces' bends are compared the same way.
        const ea = intoFace(fa, t, a.middle), eb = intoFace(fb, t, b.middle);
        const ka = bendAlong(fa, ea, na), kb = bendAlong(fb, ea, na);
        const g2 = percent(ka, kb, kFloor);
        let g3 = null, dka = null, dkb = null;
        if (h > 0 && aIn && bIn) {
            // How fast each face's bend changes going away from the seam into it.
            const slope = (f0, k0, ins, e) => {
                const k1 = bendAlong(ins[0][k], e, na), k2 = bendAlong(ins[1][k], e, na);
                return (-3 * k0 + 4 * k1 - k2) / (2 * h);
            };
            dka = slope(fa, ka, aIn, ea);
            dkb = slope(fb, kb, bIn, eb);
            // Crossing from A into B, A's change runs the other way.
            g3 = percent(-dka, dkb, dkFloor);
        }
        return { at: fa.at, gap, angle, ka, kb, g2, dka, dkb, g3 };
    });
    const worst = { gap: 0, angle: 0, g2: null, g3: null, where: {} };
    for (const s of samples) {
        for (const key of ['gap', 'angle', 'g2', 'g3']) {
            if (s[key] === null) continue;
            if (worst[key] === null || s[key] > worst[key]) { worst[key] = s[key]; worst.where[key] = s.at; }
        }
    }
    return { samples, worst };
}

/**
 * Measure seam `seam` = { body, edge } (an edge two faces of the body share) or { body, edge, other:
 * { body, edge } } (an edge of one body against an edge of another) with `backend`. `n` samples,
 * away from the seam's ends. Returns { samples, worst, level, ok, length, faces }.
 */
export async function checkSeam(backend, seam, { n = 48, tol = CLASS_A, g3 = true } = {}) {
    const teeth = await backend.edgeCurvature({ body: seam.body, edge: seam.edge, n: n + 1 });
    if (teeth.length < 3) throw new Error('that edge is too short to measure');
    const along = teeth.map(t => t.at);
    let length = 0;
    for (let i = 1; i < along.length; i++) length += dist(along[i], along[i - 1]);
    if (!(length > 1e-9)) throw new Error('that edge is a single point');
    // The samples: the edge's points without its two ends, where a third face often meets it.
    const points = along.slice(1, -1);
    const tangents = points.map((_, k) => unit(sub(along[k + 2], along[k])));
    const facesOf = async (body, edge, pts) => readEdgeFaces(await backend.edgeFaces({ body, edge, points: pts }), pts.length);
    let A, B, bodyB = seam.body, edgeB = seam.edge;
    const here = await facesOf(seam.body, seam.edge, points);
    if (seam.other) {
        bodyB = seam.other.body;
        edgeB = seam.other.edge;
        const there = await facesOf(bodyB, edgeB, points);
        if (!here.length || !there.length) throw new Error('no face along one of the edges');
        // The face on each side that lies nearest the other edge's points.
        const nearest = fs => fs.reduce((best, f) => {
            const d = f.frames.reduce((s, q, k) => s + dist(q.at, points[k]), 0);
            return !best || d < best.d ? { f, d } : best;
        }, null).f;
        A = nearest(here);
        B = nearest(there);
    } else {
        if (here.length < 2) throw new Error('that edge has one face only: pick its partner edge on the other sheet too');
        [A, B] = here;
    }
    let aIn = null, bIn = null, h = 0;
    if (g3) {
        h = Math.max(length * 0.002, 1e-3);
        const into = (F, s) => points.map((p, k) => add(F.frames[k].at, mul(intoFace(F.frames[k], tangents[k], F.middle), s)));
        const pick = (fs, face) => fs.find(f => f.face === face) ?? fs[0];
        const ask = async (F, body, edge) => {
            const pts = [...into(F, h), ...into(F, 2 * h)];
            const fs = await facesOf(body, edge, pts);
            const f = pick(fs, F.face);
            return [f.frames.slice(0, points.length), f.frames.slice(points.length)];
        };
        try {
            aIn = await ask(A, seam.body, seam.edge);
            bIn = await ask(B, bodyB, edgeB);
        } catch { aIn = bIn = null; }
    }
    const { samples, worst } = seamMetrics(tangents, A, B, { h, aIn, bIn, length });
    const ok = { g0: worst.gap <= tol.g0, g1: worst.angle <= tol.g1, g2: worst.g2 === null ? null : worst.g2 <= tol.g2, g3: worst.g3 === null ? null : worst.g3 <= tol.g3 };
    return { samples, worst, ok, level: levelOf(worst, tol), length, faces: [A.face, B.face], bodies: [seam.body, bodyB] };
}

/** One line for a seam's result, as the panel and the agent show it. */
export function seamSummary(r, tol = CLASS_A) {
    const w = r.worst, f = (v, d) => v === null ? '—' : v.toFixed(d);
    const mark = ok => ok === null ? '' : ok ? ' ✓' : ' ✗';
    return `${r.level} · GAP ${f(w.gap, 4)} mm${mark(r.ok.g0)} · ANGLE ${f(w.angle, 3)}°${mark(r.ok.g1)} · G2 ${f(w.g2, 2)}%${mark(r.ok.g2)} · G3 ${f(w.g3, 1)}%${mark(r.ok.g3)}`;
}
