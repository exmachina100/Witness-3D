import test from 'node:test';
import assert from 'node:assert/strict';
import { faceProfile } from '../src/faceProfile.js';

const plane = { origin: [0, 0, 5], normal: [0, 0, 1] };
const seg = (a, b) => [...a, ...b];
const arcPts = (cx, cy, r, a0, a1, k = 16) => Array.from({ length: k + 1 }, (_, i) => { const t = a0 + (a1 - a0) * i / k; return [cx + r * Math.cos(t), cy + r * Math.sin(t), 5]; }).flat();

test('a square face becomes a closed polygon of its four corners', () => {
    // Edges given out of order and one reversed, as a body's edge list may have them.
    const edges = [seg([10, 0, 5], [10, 10, 5]), seg([0, 0, 5], [10, 0, 5]), seg([0, 10, 5], [10, 10, 5]), seg([0, 10, 5], [0, 0, 5])];
    const { curve, holes } = faceProfile(edges, plane);
    assert.equal(curve.kind, 'polyline');
    assert.equal(curve.closed, true);
    assert.equal(curve.points.length, 4);
    assert.equal(holes, 0);
});

test('a round face becomes a circle', () => {
    const { curve } = faceProfile([arcPts(3, 4, 2, 0, 2 * Math.PI, 48)], plane);
    assert.equal(curve.kind, 'circle');
    assert.ok(Math.abs(curve.radius - 2) < 1e-9);
});

test('a slot face becomes a contour of lines and arcs, and its hole is counted', () => {
    const edges = [seg([0, 0, 5], [10, 0, 5]), arcPts(10, 2, 2, -Math.PI / 2, Math.PI / 2), seg([10, 4, 5], [0, 4, 5]), arcPts(0, 2, 2, Math.PI / 2, 1.5 * Math.PI), arcPts(5, 2, 0.5, 0, 2 * Math.PI, 24)];
    const { curve, holes } = faceProfile(edges, plane);
    assert.equal(curve.kind, 'contour');
    assert.deepEqual(curve.pieces.map(p => p.kind), ['polyline', 'arc', 'polyline', 'arc']);
    assert.equal(holes, 1);
});

test('a bowed edge that is no arc becomes a spline through its points', () => {
    const bow = Array.from({ length: 9 }, (_, i) => { const t = i / 8; return [10 * t, -3 * Math.sin(Math.PI * t) ** 3, 5]; }).flat();
    const { curve } = faceProfile([bow, seg([10, 0, 5], [10, 10, 5]), seg([10, 10, 5], [0, 10, 5]), seg([0, 10, 5], [0, 0, 5])], plane);
    assert.equal(curve.kind, 'contour');
    assert.deepEqual(curve.pieces.map(p => p.kind), ['spline', 'polyline']);
});

test('edges that never close are refused', () => {
    assert.throws(() => faceProfile([seg([0, 0, 5], [1, 0, 5])], plane), /outline/);
});
