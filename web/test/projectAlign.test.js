import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectAlignRequest } from '../src/projectAlign.js';

// A flat cubic sheet, 30 × 30 at z = 10 (4 × 4 poles, u along y, v along x); its edge at y = 0 is the target.
const knots = [0, 0, 0, 0, 1, 1, 1, 1];
const poles = Array.from({ length: 4 }, (_, a) => Array.from({ length: 4 }, (_, b) => [10 * b, 10 * a, 10]));
const raw = [1, 0, 15, 15, 10, 1, 3, 3, 4, 4, 8, 8, ...knots, ...knots, 0, ...poles.flat(2)];
// The reference: the plane z = 0, s along x from -10 to 40 and t along y from -20 to 40, n up.
const plane = {
    uvn: ([x, y, z]) => [(x + 10) / 50, (y + 20) / 60, z],
    at: ([s, t, n]) => [50 * s - 10, 60 * t - 20, n],
};
const backend = {
    edgeCurvature: async () => Array.from({ length: 401 }, (_, i) => ({ at: [30 * i / 400, 0, 10] })),
    edgeFaces: async () => raw,
    faceUvn: async ({ map, points }) => ({ size: [50, 60], points: points.map(map ? plane.at : plane.uvn) }),
};
const target = { body: 2, edge: 0 }, reference = { body: 1, face: 0 };
/** The poles after the moves, by their number in the face (u slowest). */
const after = moves => {
    const out = poles.flat().map(p => [...p]);
    for (const [, n, by] of moves) for (let k = 0; k < 3; k++) out[n][k] += by[k];
    return out;
};
const near = (a, b, eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < eps);

test('G0 along the normal sets the side down on the reference, the rest stays', async () => {
    const r = await projectAlignRequest(backend, { target, reference, continuity: 'G0' });
    const p = after(r.moves);
    for (let b = 0; b < 4; b++) assert.ok(near(p[b], [10 * b, 0, 0]), `${p[b]}`);
    for (let n = 4; n < 16; n++) assert.ok(near(p[n], poles.flat()[n]));
    assert.equal(r.body, 2);
});

test('along a vector the side lands where the slanted line meets the reference', async () => {
    const r = await projectAlignRequest(backend, { target, reference, continuity: 'G0', direction: [0, 1, -1] });
    const p = after(r.moves);
    for (let b = 0; b < 4; b++) assert.ok(near(p[b], [10 * b, 10, 0], 1e-5), `${p[b]}`);
});

test('G1 lays the next row into the reference tangent plane; Perpendicular stands it square', async () => {
    const g1 = after((await projectAlignRequest(backend, { target, reference, continuity: 'G1' })).moves);
    for (let b = 0; b < 4; b++) assert.ok(Math.abs(g1[4 + b][2]) < 1e-5, `${g1[4 + b]}`);
    const perp = after((await projectAlignRequest(backend, { target, reference, continuity: 'PERP' })).moves);
    for (let b = 0; b < 4; b++) {
        const d = perp[4 + b].map((v, k) => v - perp[b][k]);
        assert.ok(Math.abs(d[0]) < 1e-5 && Math.abs(d[1]) < 1e-5 && Math.abs(Math.abs(d[2]) - 10) < 1e-4, `${d}`);
    }
    await assert.rejects(() => projectAlignRequest(backend, { target, reference: { body: 2, face: 0 } }), /another body/);
    await assert.rejects(() => projectAlignRequest(backend, { target, reference, direction: [1, 0, 0] }), /along the reference/);
});
