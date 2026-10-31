import assert from 'node:assert/strict';
import { test } from 'node:test';
import { freeMove, freeRotate, freeScale, FREE_STEPS } from '../src/freestyle.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test('Freestyle Move goes from the start point to the end point', () => {
  assert.deepEqual(freeMove([1, 2, 3], [4, 0, 3]), [3, -2, 0]);
});

test('Freestyle Rotate turns reference onto target about the clicked axis', () => {
  const r = freeRotate([5, 5, 0], [5, 5, 10], [6, 5, 3], [5, 7, 8]);
  assert.deepEqual(r.axis, [0, 0, 1]);
  near(r.angle, Math.PI / 2);
  near(freeRotate([0, 0, 0], [0, 0, -1], [1, 0, 0], [0, 1, 0]).angle, -Math.PI / 2);
  assert.equal(freeRotate([0, 0, 0], [0, 0, 0], [1, 0, 0], [0, 1, 0]), null);
  assert.equal(freeRotate([0, 0, 0], [0, 0, 1], [0, 0, 4], [0, 1, 0]), null);
});

test('Freestyle Scale is the ratio of distances from the origin', () => {
  near(freeScale([0, 0, 0], [2, 0, 0], [0, 5, 0]), 2.5);
  assert.equal(freeScale([1, 1, 1], [1, 1, 1], [2, 2, 2]), null);
  assert.equal(FREE_STEPS.rotate.length, 4);
});
