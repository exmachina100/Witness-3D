import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nSidedFill } from '../src/nSided.js';
import { surfaceAt } from '../src/square.js';

/** A regular n-gon's sides of radius r at height z, each sampled k+1 times. */
const polygon = (n, r, z = 0, k = 8) => Array.from({ length: n }, (_, i) => {
    const a = 2 * Math.PI * i / n, b = 2 * Math.PI * (i + 1) / n;
    const A = [r * Math.cos(a), r * Math.sin(a), z], B = [r * Math.cos(b), r * Math.sin(b), z];
    return Array.from({ length: k + 1 }, (_, j) => A.map((x, c) => x + (B[c] - x) * j / k));
});

test('a flat pentagon fills as five flat patches meeting smoothly', () => {
    const r = nSidedFill(polygon(5, 10));
    assert.equal(r.patches.length, 5);
    assert.ok(r.gap < 0.01, `gap ${r.gap}`);
    assert.ok(r.seam < 0.5, `seam ${r.seam}`);
    for (const f of r.patches) for (const [u, v] of [[0.3, 0.3], [0.7, 0.5]]) assert.ok(Math.abs(surfaceAt(f, u, v)[2]) < 1e-6);
});

test('a hexagonal hole in a pyramid, G1 to its faces: the patches leave the faces and meet each other smoothly', () => {
    // The hole's six straight sides at z = 0; each face slopes up and in at 0.5 rad.
    const sides = polygon(6, 10, 0, 12).map((pts, i) => {
        const a = 2 * Math.PI * (i + 0.5) / 6;
        pts.out = pts.map(() => [-Math.cos(a) * Math.cos(0.5), -Math.sin(a) * Math.cos(0.5), Math.sin(0.5)]);
        return pts;
    });
    const r = nSidedFill(sides, { continuity: 'G1' });
    assert.equal(r.patches.length, 6);
    assert.ok(r.gap < 0.01, `gap ${r.gap}`);
    assert.ok(r.turn < 0.5, `turn ${r.turn}`);
    assert.ok(r.seam < 0.5, `seam ${r.seam}`);
    // The middle rises as the faces carry on up.
    const top = Math.max(...r.patches.map(f => surfaceAt(f, 0.5, 0.5)[2]));
    assert.ok(top > 1, `top ${top}`);
});
