import test from 'node:test';
import assert from 'node:assert/strict';
import { stepSources } from '../src/app/sources.js';

const steps = [{ sources: [1] }, { sources: [] }, { sources: [2] }, { sources: [3] }];

test('steps back through operations with sources, skipping undone ones', () => {
  assert.equal(stepSources(steps, 4, null, -1), 3);
  assert.equal(stepSources(steps, 3, null, -1), 2);
  assert.equal(stepSources(steps, 4, 2, -1), 0);
  assert.equal(stepSources(steps, 4, 0, -1), null);
});

test('steps forward again, not past the live steps', () => {
  assert.equal(stepSources(steps, 4, 0, 1), 2);
  assert.equal(stepSources(steps, 3, 2, 1), null);
});
