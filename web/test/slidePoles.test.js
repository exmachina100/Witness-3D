// Slide Surface CV: control points sliding along a face's net (polesEdit.js).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { slidePoles } from '../src/polesEdit.js';

// A 3 × 3 flat net, 10 mm apart in x (u) and y (v).
const rows = [0, 1, 2].map(a => [0, 1, 2].map(c => [10 * a, 10 * c, 0]));
const close = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 1e-9);

test('the middle point slides along u, back along u, along v and across', () => {
    assert.ok(close(slidePoles(rows, [4], 2, 'u')[0][1], [2, 0, 0]));
    assert.ok(close(slidePoles(rows, [4], 2, '-u')[0][1], [-2, 0, 0]));
    assert.ok(close(slidePoles(rows, [4], 2, 'v')[0][1], [0, 2, 0]));
    assert.ok(close(slidePoles(rows, [4], 2, '-v')[0][1], [0, -2, 0]));
    assert.ok(close(slidePoles(rows, [4], 2, 'n')[0][1], [0, 0, 2]));
});

test('an edge point slides along its one span, several points each their own way', () => {
    const moves = slidePoles(rows, [0, 8], 1, 'u');
    assert.deepEqual(moves.map(m => m[0]), [0, 8]);
    assert.ok(close(moves[0][1], [1, 0, 0]) && close(moves[1][1], [1, 0, 0]));
});

test('a closed net wraps round its seam', () => {
    // Four points round a square, the first repeated last: the seam point slides from the last
    // distinct point to the second.
    const ring = [[10, 0, 0], [0, 10, 0], [-10, 0, 0], [0, -10, 0], [10, 0, 0]].map(p => [p, [p[0], p[1], 5]]);
    const [[, by]] = slidePoles(ring, [0], 1, 'u');
    assert.ok(close(by, [0, 1, 0]), JSON.stringify(by));
});

test('bad points and distances are refused', () => {
    assert.throws(() => slidePoles(rows, [9], 1, 'u'), /no longer exists/);
    assert.throws(() => slidePoles(rows, [4], NaN, 'u'), /number/);
    assert.throws(() => slidePoles([[[0, 0, 0], [0, 0, 0]], [[0, 0, 0], [0, 0, 0]]], [0], 1, 'u'), /no direction/);
});
