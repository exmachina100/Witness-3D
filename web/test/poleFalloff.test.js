import test from 'node:test';
import assert from 'node:assert/strict';
import { falloff, weights, mirrorOf, poleMoves } from '../src/poleFalloff.js';

// A 5 × 5 flat net, 10 mm apart.
const net = Array.from({ length: 5 }, (_, i) => Array.from({ length: 5 }, (_, j) => [i * 10, j * 10, 0]));
const up = () => [0, 0, 4];

test('the falloff is 1 at the pick and 0 from the edge of its reach', () => {
  assert.equal(falloff(0), 1);
  assert.equal(falloff(1), 0);
  assert.equal(falloff(2), 0);
  assert.equal(falloff(0.5), 0.5);
});

test('with Proportional off only the picked point moves', () => {
  const m = poleMoves([net], [{ face: 0, n: 12 }], up);
  assert.deepEqual(m, [[0, 12, [0, 0, 4]]]);
});

test('with Proportional on all, the points round the pick follow less the further they are', () => {
  const m = new Map(poleMoves([net], [{ face: 0, n: 12 }], up, { mode: 'all', fu: 2, fv: 2 }).map(([, n, d]) => [n, d[2]]));
  assert.equal(m.get(12), 4);
  assert.ok(m.get(13) > 0 && m.get(13) < 4, `${m.get(13)}`);
  assert.ok(m.get(18) < m.get(13), 'a diagonal neighbour moves less than a side one');
  assert.ok(!m.has(10) && !m.has(14), 'two columns away is out of reach');
  // A wider falloff in V reaches further along the columns.
  const wide = new Map(poleMoves([net], [{ face: 0, n: 12 }], up, { mode: 'all', fu: 1, fv: 3 }).map(([, n, d]) => [n, d[2]]));
  assert.ok(wide.has(10) && !wide.has(2));
});

test('with Proportional on the selection, the middle of the picks moves most', () => {
  const picks = [11, 12, 13].map(n => ({ face: 0, n }));
  const w = new Map(weights([net], picks, { mode: 'selected', fu: 2, fv: 2 }).map(x => [x.n, x.w]));
  assert.equal(w.get(12), 1);
  assert.ok(w.get(11) < 1 && w.get(11) > 0 && Math.abs(w.get(11) - w.get(13)) < 1e-12);
  assert.ok(!w.has(10));
});

test('mirror moves the point across the net, its move reflected', () => {
  assert.equal(mirrorOf(5, 5, 1, 'v'), 3);
  assert.equal(mirrorOf(5, 5, 5, 'u'), 15);
  assert.equal(mirrorOf(5, 5, 2, 'v'), null);
  // Moving point (0, 1) towards +y moves (0, 3) towards −y; an upward move stays upward.
  const m = new Map(poleMoves([net], [{ face: 0, n: 1 }], () => [0, 2, 3], { mirror: 'v' }).map(([, n, d]) => [n, d]));
  assert.deepEqual(m.get(1), [0, 2, 3]);
  assert.deepEqual(m.get(3), [0, -2, 3]);
});
