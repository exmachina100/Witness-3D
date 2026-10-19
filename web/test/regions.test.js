import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inside, nestingDepths, regionsToExtrude } from '../src/regions.js';

const square = (cx, cy, h) => [[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h]];

test('points inside and outside a loop', () => {
    assert.equal(inside([0, 0], square(0, 0, 1)), true);
    assert.equal(inside([2, 0], square(0, 0, 1)), false);
});

test('nesting depths: an O with an island in its hole, and a loop apart', () => {
    assert.deepEqual(nestingDepths([square(0, 0, 5), square(0, 0, 3), square(0, 0, 1), square(20, 0, 2)]), [0, 1, 2, 0]);
});

test('regions to extrude: holes cut, islands and outsides joined, the first a joined one', () => {
    const at = (id, cx, h, z = 0) => ({ id, origin: [0, z, 0], normal: [0, 1, 0], points: square(cx, 0, h).map(([a, b]) => [a, z, b]) });
    assert.deepEqual(regionsToExtrude([at(1, 0, 3), at(2, 0, 5), at(3, 20, 1)]), { first: 2, more: [3], holes: [1] });
    // On different planes nothing nests.
    assert.deepEqual(regionsToExtrude([at(1, 0, 3), at(2, 0, 5, 4)]), { first: 1, more: [2], holes: [] });
});
