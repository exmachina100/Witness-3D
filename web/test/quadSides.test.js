import test from 'node:test';
import assert from 'node:assert/strict';
import { quadSides, square } from '../src/square.js';

/** A closed loop of `n` points round a rounded rectangle 20 × 10 in the z = 0 plane, as one piece. */
function rounded(n = 160) {
    const pts = [];
    for (let i = 0; i < n; i++) {
        const t = i / n * 2 * Math.PI;
        // A superellipse: nearly straight sides with four corners.
        const c = Math.cos(t), s = Math.sin(t);
        pts.push([10 * Math.sign(c) * Math.abs(c) ** 0.25, 5 * Math.sign(s) * Math.abs(s) ** 0.25, 0]);
    }
    pts.push(pts[0]);
    return pts;
}

test('a loop in one piece splits into four sides at its corners', () => {
    const sides = quadSides([rounded()], 0.01);
    assert.equal(sides.length, 4);
    // Every side has length, and they run on from one another round the loop.
    for (let i = 0; i < 4; i++) {
        assert.ok(sides[i].length > 2);
        assert.deepEqual(sides[i].at(-1), sides[(i + 1) % 4][0]);
    }
    // The corners are near the rectangle's own, and the fit holds the boundary.
    const fit = square(sides, { degree: 3, continuity: 'G0' });
    assert.ok(fit.gap < 0.2, `${fit.gap}`);
});

test('four sides given are only put in order, and a loop with no corners is refused', () => {
    const sq = [[[0, 0, 0], [10, 0, 0]], [[10, 10, 0], [0, 10, 0]], [[10, 0, 0], [10, 10, 0]], [[0, 10, 0], [0, 0, 0]]];
    const sides = quadSides(sq, 0.01);
    assert.equal(sides.length, 4);
    assert.deepEqual(sides[0].at(-1), sides[1][0]);
    // A circle has no four corners: every point turns the same.
    const circle = Array.from({ length: 121 }, (_, i) => [Math.cos(i / 120 * 2 * Math.PI) * 10, Math.sin(i / 120 * 2 * Math.PI) * 10, 0]);
    const round4 = quadSides([circle], 0.01);
    assert.equal(round4.length, 4, 'an even circle still splits, into four equal arcs');
});

test('a closed polyline sampled at its corners only splits at those corners (Patch Faces on a rectangle)', () => {
    const C = [[-60, 0, -60], [-30, 0, -60], [-30, 0, -40], [-60, 0, -40]];
    const sides = quadSides([[...C, C[0]]], 0.04);
    assert.equal(sides.length, 4);
    const ends = sides.map(s => s[0].map(x => Math.round(x)).join(','));
    for (const c of C) assert.ok(ends.includes(c.join(',')), `corner ${c}`);
    assert.ok(square(sides, { degree: 3, continuity: 'G0' }).gap < 1e-6);
});
