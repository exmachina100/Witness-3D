import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterFillets } from '../src/filletFilter.js';

const surfaces = [
    { kind: 'plane' },
    { kind: 'cylinder', radius: 2, outward: true },
    { kind: 'cylinder', radius: 5, outward: false },
    { kind: 'round', radius: 1 },
    { kind: 'sphere', radius: 2, outward: true },
];

test('Any with no limit keeps every fillet face', () => {
    assert.deepEqual(filterFillets([1, 2, 3, 4], surfaces), [1, 2, 3, 4]);
});

test('Max Radius leaves the larger rounds', () => {
    assert.deepEqual(filterFillets([1, 2, 3, 4], surfaces, { maxRadius: 2 }), [1, 3, 4]);
});

test('Convex and Concave go by which way the face bulges', () => {
    assert.deepEqual(filterFillets([1, 2, 3, 4], surfaces, { convexity: 'convex' }), [1, 4]);
    assert.deepEqual(filterFillets([1, 2, 3, 4], surfaces, { convexity: 'concave' }), [2]);
    assert.deepEqual(filterFillets([1, 2], null, { convexity: 'any' }), [1, 2]);
});
