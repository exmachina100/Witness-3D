// Plasticity's Project Align: the side of a B-spline sheet along one of its edges (the target)
// projected onto another surface (the reference), along the reference's normal or along a vector,
// and made to meet it in position (G0), tangent (G1), curvature (G2) or square to it
// (Perpendicular). Shared by both builds: the reference face is read through faceUvn (its points
// from surface parameters and back), and the rows move as Align Surface moves them (alignMoves).

import { alignMoves, curveAt, pickFace, readEdgeFaces, sideOf } from './alignSurface.js';

const sub = (a, b) => a.map((v, i) => v - b[i]);
const add = (a, b) => a.map((v, i) => v + b[i]);
const mul = (a, s) => a.map(v => v * s);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(...a);
const unit = a => mul(a, 1 / len(a));

/** Continuity in the order Tab cycles it. */
export const PROJECT_CONTINUITY = ['G0', 'G1', 'G2', 'PERP'];

/** The step in face parameters (0..1 over the face) for derivatives by differences. */
const H = 1e-3;

/**
 * Surface frames (point, Su, Sv, Suu, Suv, Svv) of a face at parameters `st` ([[s, t]]), from the
 * face's points around each one: `mapAt(points)` maps [s, t, 0] to points in one call.
 */
export async function framesAt(mapAt, st) {
    const around = ([s, t]) => [[s, t], [s + H, t], [s - H, t], [s, t + H], [s, t - H], [s + H, t + H], [s + H, t - H], [s - H, t + H], [s - H, t - H]];
    const P = await mapAt(st.flatMap(q => around(q).map(([a, b]) => [a, b, 0])));
    return st.map((_, k) => {
        const [c, up, um, vp, vm, pp, pm, mp, mm] = P.slice(9 * k, 9 * k + 9);
        return {
            at: c,
            su: mul(sub(up, um), 1 / (2 * H)), sv: mul(sub(vp, vm), 1 / (2 * H)),
            suu: mul(add(sub(up, mul(c, 2)), um), 1 / (H * H)), svv: mul(add(sub(vp, mul(c, 2)), vm), 1 / (H * H)),
            suv: mul(add(sub(pp, pm), sub(mm, mp)), 1 / (4 * H * H)),
        };
    });
}

/**
 * Points projected onto the reference: along its normal (the nearest point), or along `direction`
 * (either way), by Newton steps on the height over the face. `uvn(points)` gives each point's
 * [s, t, n] (n its height along the face normal), `mapAt` points from [s, t, n].
 */
export async function projectOnto(uvn, mapAt, points, direction = null) {
    if (!direction) return (await uvn(points)).map(([s, t]) => [s, t]);
    const d = unit(direction);
    let lambda = points.map(() => 0);
    for (let it = 0; it < 12; it++) {
        const at = points.map((p, k) => add(p, mul(d, lambda[k])));
        const q = await uvn(at);
        // The face's normal under each point: from its point and the point one unit above it.
        const lifted = await mapAt(q.flatMap(([s, t]) => [[s, t, 0], [s, t, 1]]));
        let worst = 0;
        lambda = lambda.map((l, k) => {
            const n = sub(lifted[2 * k + 1], lifted[2 * k]), along = dot(d, n);
            if (Math.abs(along) < 1e-6) throw new Error('the projection runs along the reference surface; pick another direction');
            const step = q[k][2] / along;
            worst = Math.max(worst, Math.abs(step));
            return l - step;
        });
        if (worst < 1e-7) break;
    }
    const final = await uvn(points.map((p, k) => add(p, mul(d, lambda[k]))));
    if (final.some(q => Math.abs(q[2]) > 1e-3)) throw new Error('the edge does not project onto the reference surface that way');
    return final.map(([s, t]) => [s, t]);
}

/**
 * The whole of Project Align against a backend (either build): `target` { body, edge } on a
 * B-spline sheet and `reference` { body, face }. `direction` null projects along the reference's
 * normal. Returns { body, moves } for previewMoveFacePoles / commitMoveFacePoles.
 */
export async function projectAlignRequest(backend, { target, reference, direction = null, continuity = 'G1', tension = 1, blend = 0, influence = 0 }) {
    if (target.body === reference.body) throw new Error('the reference surface must be another body');
    const uvn = async points => (await backend.faceUvn({ body: reference.body, face: reference.face, points })).points;
    const mapAt = async points => (await backend.faceUvn({ body: reference.body, face: reference.face, map: true, points })).points;
    const teeth = await backend.edgeCurvature({ body: target.body, edge: target.edge, n: 400 });
    const along = teeth.map(t => t.at);
    const [refMiddle] = await mapAt([[0.5, 0.5, 0]]);
    const face = pickFace(readEdgeFaces(await backend.edgeFaces({ body: target.body, edge: target.edge, points: [] }), 0), refMiddle, true);
    const side = sideOf(face.spline, along.filter((_, i) => i % 25 === 0));
    const { rows, along: knots, q } = side, m = rows[0].length;
    const greville = Array.from({ length: m }, (_, j) => knots.slice(j + 1, j + q + 1).reduce((s, k) => s + k, 0) / q || knots[j]);
    const onSide = greville.map(x => curveAt(rows[0], knots, q, x));
    const st = await projectOnto(uvn, mapAt, onSide, direction);
    if (st.some(([s, t]) => s < -0.02 || s > 1.02 || t < -0.02 || t > 1.02)) throw new Error('the edge projects past the reference surface; extend it or pick a bigger one');
    const frames = await framesAt(mapAt, st);
    if (frames.some(f => len(cross(f.su, f.sv)) < 1e-12)) throw new Error('the reference surface has no tangent plane there');
    const moves = alignMoves(side, { greville, points: frames.map(f => f.at) }, frames, { continuity, tension, blend, influence });
    return { body: target.body, moves: moves.map(([pole, by]) => [face.face, pole, by]) };
}
