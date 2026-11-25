import assert from 'node:assert/strict';
import { test } from 'node:test';
import { edgeGap, nearestEdgePair } from '../src/nearEdges.js';

// Two 10 mm squares side by side with a 1 mm gap: A from x 0 to 10, B from x 11 to 21.
const sq = x => [
    { n: 0, points: [x, 0, 0, x + 10, 0, 0] },
    { n: 1, points: [x + 10, 0, 0, x + 10, 10, 0] },
    { n: 2, points: [x + 10, 10, 0, x, 10, 0] },
    { n: 3, points: [x, 10, 0, x, 0, 0] },
];

test('near-edge pairing picks the facing sides of two sheets', () => {
    const p = nearestEdgePair(sq(0), sq(11));
    assert.equal(p.a, 1);
    assert.equal(p.b, 3);
    assert.ok(Math.abs(p.gap - 1) < 1e-9);
});

test('edge gap: parallel edges, and none from empty lists', () => {
    assert.ok(Math.abs(edgeGap([0, 0, 0, 10, 0, 0], [0, 2, 0, 10, 2, 0]) - 2) < 1e-9);
    assert.equal(nearestEdgePair([], sq(0)), null);
});
