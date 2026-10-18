import assert from 'node:assert/strict';
import { test } from 'node:test';
import { edgeOffsetsOnFace, edgePiece, faceFrame, faceLoopOffsets } from '../src/edgeOffset.js';
import { samples } from '../src/curveEdit.js';

// The top face of a 40 × 20 block at height 10, with a round hole of radius 3 at (10, 10, 10).
const line = (a, b) => [...a, ...b];
const ring = Array.from({ length: 33 }, (_, i) => [10 + 3 * Math.cos(i * Math.PI / 16), 10, 10 + 3 * Math.sin(i * Math.PI / 16)]).flat();
const body = {
    facePlanes: [{ origin: [0, 10, 0], normal: [0, 1, 0] }],
    edges: [line([0, 10, 0], [40, 10, 0]), line([40, 10, 0], [40, 10, 20]), line([40, 10, 20], [0, 10, 20]), line([0, 10, 20], [0, 10, 0]), ring],
};
const all = [0, 1, 2, 3, 4];
const model = (c, p) => { const y = [c.normal[1] * c.x[2] - c.normal[2] * c.x[1], c.normal[2] * c.x[0] - c.normal[0] * c.x[2], c.normal[0] * c.x[1] - c.normal[1] * c.x[0]]; return c.origin.map((o, i) => o + c.x[i] * p[0] + y[i] * p[1]); };

test('edges become exact lines and circles in the face plane', () => {
    const f = faceFrame(body.facePlanes[0]);
    const pts = n => Array.from({ length: body.edges[n].length / 3 }, (_, i) => f.local(body.edges[n].slice(3 * i, 3 * i + 3)));
    assert.equal(edgePiece(pts(0)).kind, 'polyline');
    const c = edgePiece(pts(4));
    assert.equal(c.kind, 'circle');
    assert.ok(Math.abs(c.radius - 3) < 1e-9);
});

test('offset face loop moves the outline in and the hole out', () => {
    const [outer, hole] = faceLoopOffsets(body, 0, all, 2);
    const pts = samples(outer).points.map(p => model(outer, p));
    for (const p of pts) assert.ok(p[0] > 1.999 && p[0] < 38.001 && p[2] > 1.999 && p[2] < 18.001, `${p}`);
    assert.ok(pts.some(p => Math.abs(p[0] - 2) < 1e-6) && pts.some(p => Math.abs(p[2] - 18) < 1e-6));
    assert.equal(hole.kind, 'circle');
    assert.ok(Math.abs(hole.radius - 5) < 1e-9);
});

test('offset edge runs across the face, inside it, from side to side', () => {
    const [c] = edgeOffsetsOnFace(body, 0, all, [0], 5);
    const pts = samples(c).points.map(p => model(c, p));
    for (const p of pts) assert.ok(Math.abs(p[2] - 5) < 1e-6 && Math.abs(p[1] - 10) < 1e-9, `${p}`);
    assert.ok(Math.min(...pts.map(p => p[0])) < 0 && Math.max(...pts.map(p => p[0])) > 40);
    // Two edges that meet: one L, still inside.
    const [l] = edgeOffsetsOnFace(body, 0, all, [0, 1], 4);
    const q = samples(l).points.map(p => model(l, p));
    assert.ok(q.some(p => Math.abs(p[0] - 36) < 1e-6 && Math.abs(p[2] - 4) < 1e-6), 'the corner moves in');
    assert.throws(() => edgeOffsetsOnFace(body, 0, all, [0], 25), /leave the face/);
});
