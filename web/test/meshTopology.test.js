// OBJ Topology (Tris, Quads, Ngons) and Remove Small Features.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { polygonize, removeSmallParts, toObj } from '../src/meshExport.js';

// A closed box as 12 triangles, each face meshed on its own (corners repeated), as the kernel gives it.
function boxMesh(x0, y0, z0, x1, y1, z1) {
    const c = (i, j, k) => [[x0, x1][i], [y0, y1][j], [z0, z1][k]];
    const quads = [
        [c(0, 0, 0), c(0, 1, 0), c(1, 1, 0), c(1, 0, 0)], [c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)],
        [c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)], [c(0, 1, 0), c(0, 1, 1), c(1, 1, 1), c(1, 1, 0)],
        [c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), c(0, 1, 0)], [c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)],
    ];
    const positions = [], indices = [];
    for (const q of quads) {
        const b = positions.length / 3;
        positions.push(...q.flat());
        indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    return { positions, indices };
}

test('Quads pairs a box\'s triangles into its six faces', () => {
    const m = polygonize(boxMesh(0, 0, 0, 2, 3, 4), 'quads');
    assert.equal(m.positions.length / 3, 8);
    assert.equal(m.polygons.length, 6);
    assert.ok(m.polygons.every(p => p.length === 4));
    assert.match(toObj([{ name: 'B', positions: m.positions, indices: m.indices, polygons: m.polygons }]), /^f \d+ \d+ \d+ \d+$/m);
});

test('Ngons makes a flat run one polygon round its outline; Tris keeps the triangles', () => {
    // A 3 × 1 strip of squares in one plane: six triangles, one 8-cornered outline.
    const positions = [], indices = [];
    for (let i = 0; i <= 3; i++) positions.push(i, 0, 0, i, 1, 0);
    for (let i = 0; i < 3; i++) { const a = 2 * i; indices.push(a, a + 2, a + 3, a, a + 3, a + 1); }
    const n = polygonize({ positions, indices }, 'ngons');
    assert.equal(n.polygons.length, 1);
    assert.equal(n.polygons[0].length, 8);
    assert.equal(polygonize({ positions, indices }, 'tris').polygons.length, 6);
    // An L-shaped run is not convex: Convex Ngons Only leaves it triangles.
    const L = { positions: [0, 0, 0, 2, 0, 0, 2, 1, 0, 1, 1, 0, 1, 2, 0, 0, 2, 0, 0, 1, 0], indices: [0, 1, 2, 0, 2, 3, 0, 3, 6, 6, 3, 4, 6, 4, 5] };
    assert.equal(polygonize(L, 'ngons').polygons.length, 1);
    assert.equal(polygonize(L, 'ngons', { convexOnly: true }).polygons.length, 5);
});

test('Remove Small Features leaves out pieces smaller across than the size', () => {
    const a = boxMesh(0, 0, 0, 10, 10, 10), b = boxMesh(20, 0, 0, 21, 1, 1);
    const both = { positions: [...a.positions, ...b.positions], indices: [...a.indices, ...b.indices.map(i => i + a.positions.length / 3)] };
    const out = removeSmallParts(both, 5);
    assert.equal(out.indices.length, 36);
    assert.equal(out.positions.length / 3, 8);
    assert.equal(removeSmallParts(both, 0), both);
});
