import assert from 'node:assert/strict';
import { test } from 'node:test';
import { edgeOffsetsBothSides, edgeOffsetsOnFace, edgePiece, faceFrame, faceLoopOffsets, facesLoopOffsets, lineSweptAlong } from '../src/edgeOffset.js';
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

test('both sides: a line on each face, framed to sweep along the other face', () => {
    // A 40 × 10 × 20 block: top face 0 (y = 10) and front face 1 (z = 0) share the edge (0,10,0)-(40,10,0).
    const block = {
        facePlanes: [{ origin: [0, 10, 0], normal: [0, 1, 0] }, { origin: [0, 0, 0], normal: [0, 0, -1] }],
        edges: [line([0, 10, 0], [40, 10, 0]), line([40, 10, 0], [40, 10, 20]), line([40, 10, 20], [0, 10, 20]), line([0, 10, 20], [0, 10, 0]),
            line([40, 0, 0], [40, 10, 0]), line([0, 0, 0], [40, 0, 0]), line([0, 10, 0], [0, 0, 0])],
    };
    const faceEdges = f => f === 0 ? [0, 1, 2, 3] : [0, 4, 5, 6];
    const [top, front] = edgeOffsetsBothSides(block, 0, 1, faceEdges, [0], 3);
    const pts = c => samples(c).points.map(p => model(c, p));
    for (const p of pts(top)) assert.ok(Math.abs(p[1] - 10) < 1e-9 && Math.abs(p[2] - 3) < 1e-9, `top ${p}`);
    for (const p of pts(front)) assert.ok(Math.abs(p[1] - 7) < 1e-9 && Math.abs(p[2]) < 1e-9, `front ${p}`);
    // Each sweeps along the other face: the top line straight down (in the front face), the front line along z (in the top face).
    assert.ok(Math.abs(Math.abs(top.normal[1]) - 1) < 1e-9);
    assert.ok(Math.abs(Math.abs(front.normal[2]) - 1) < 1e-9);
    assert.throws(() => lineSweptAlong({ ...top, kind: 'arc' }, [0, 1, 0]), /straight/);
});

test('offset face loop on two faces side by side: their outline together, or each alone (I)', () => {
    // Two 20 × 20 squares on y = 10 sharing the edge x = 20 (edge 3).
    const two = {
        facePlanes: [{ origin: [0, 10, 0], normal: [0, 1, 0] }, { origin: [20, 10, 0], normal: [0, 1, 0] }],
        edges: [line([0, 10, 0], [20, 10, 0]), line([0, 10, 20], [0, 10, 0]), line([20, 10, 20], [0, 10, 20]), line([20, 10, 0], [20, 10, 20]),
            line([20, 10, 0], [40, 10, 0]), line([40, 10, 0], [40, 10, 20]), line([40, 10, 20], [20, 10, 20])],
    };
    const faceEdges = f => f === 0 ? [0, 1, 2, 3] : [3, 4, 5, 6];
    const together = facesLoopOffsets(two, [0, 1], faceEdges, 2);
    assert.equal(together.shapes.length, 1);
    assert.deepEqual(together.faces, [0, 1]);
    const pts = samples(together.shapes[0]).points.map(p => model(together.shapes[0], p));
    assert.ok(Math.abs(Math.min(...pts.map(p => p[0])) - 2) < 1e-6 && Math.abs(Math.max(...pts.map(p => p[0])) - 38) < 1e-6);
    const alone = facesLoopOffsets(two, [0, 1], faceEdges, 2, 'linear', true);
    assert.equal(alone.shapes.length, 2);
    const xs = alone.shapes.map(s => samples(s).points.map(p => model(s, p)[0]));
    assert.ok(Math.abs(Math.max(...xs[0]) - 18) < 1e-6 && Math.abs(Math.min(...xs[1]) - 22) < 1e-6);
});

test("a face's own edges, not its coplanar neighbour's", async () => {
    const { faceBoundEdges } = await import('../src/app/Selection.js');
    const pos = [[0, 10, 0], [20, 10, 0], [20, 10, 20], [0, 10, 20], [40, 10, 0], [40, 10, 20]].flat();
    const two = {
        positions: pos, indices: [0, 2, 1, 0, 3, 2, 1, 5, 4, 1, 2, 5], faceIds: [0, 0, 1, 1],
        facePlanes: [{ origin: [0, 10, 0], normal: [0, 1, 0] }, { origin: [20, 10, 0], normal: [0, 1, 0] }],
        edges: [line([0, 10, 0], [20, 10, 0]), line([0, 10, 20], [0, 10, 0]), line([20, 10, 20], [0, 10, 20]), line([20, 10, 0], [20, 10, 20]),
            line([20, 10, 0], [40, 10, 0]), line([40, 10, 0], [40, 10, 20]), line([40, 10, 20], [20, 10, 20])],
    };
    assert.deepEqual(faceBoundEdges(two, 0), [0, 1, 2, 3]);
    assert.deepEqual(faceBoundEdges(two, 1), [3, 4, 5, 6]);
});
