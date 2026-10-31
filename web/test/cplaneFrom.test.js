import test from 'node:test';
import assert from 'node:assert/strict';
import { planeFrom, fitNormal } from '../src/cplaneFrom.js';

const near = (a, b, t = 1e-9) => assert.ok(a.every((v, i) => Math.abs(v - b[i]) < t), `${a} vs ${b}`);

test('one flat face gives its plane; a curved one is refused', () => {
  const p = planeFrom({ faces: [{ origin: [1, 2, 3], normal: [0, 0, 1] }] });
  near(p.origin, [1, 2, 3]); near(p.normal, [0, 0, 1]);
  assert.ok(planeFrom({ faces: [{ curved: true }] }).error);
});

test('a face and an edge give a plane through the edge square to the face', () => {
  const p = planeFrom({ faces: [{ origin: [0, 0, 0], normal: [0, 0, 1] }], edges: [[[0, 0, 0], [10, 0, 0]]], view: [0, -1, 0] });
  near(p.origin, [5, 0, 0]); near(p.normal, [0, -1, 0]);
  assert.equal(p.kind, 'FACE + EDGE');
});

test('two parallel faces give the midplane; others are refused', () => {
  const p = planeFrom({ faces: [{ origin: [0, 0, 0], normal: [0, 0, 1] }, { origin: [3, 4, 10], normal: [0, 0, -1] }] });
  near(p.origin, [0, 0, 5]); near(p.normal, [0, 0, 1]);
  assert.equal(p.kind, 'MIDPLANE');
  assert.ok(planeFrom({ faces: [{ origin: [0, 0, 0], normal: [0, 0, 1] }, { origin: [0, 0, 0], normal: [1, 0, 0] }] }).error);
});

test('three points give their plane, facing the view', () => {
  const p = planeFrom({ points: [[0, 0, 2], [1, 0, 2], [0, 1, 2]], view: [0, 0, -1] });
  near(p.normal, [0, 0, -1]); near(p.origin, [1 / 3, 1 / 3, 2]);
});

test('four or more points get the best fitting plane', () => {
  const pts = [[0, 0, 0], [4, 0, 0.01], [4, 4, -0.01], [0, 4, 0], [2, 2, 0]];
  const p = planeFrom({ points: pts, view: [0, 0, 1] });
  assert.ok(p.normal[2] > 0.999);
  near(fitNormal([[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]]).map(Math.abs), [0, 1, 0]);
});

test('two points make a plane through them turned toward the view', () => {
  const p = planeFrom({ points: [[0, 0, 0], [10, 0, 0]], view: [0, 1, 1] });
  near(p.normal, [0, Math.SQRT1_2, Math.SQRT1_2]); near(p.origin, [5, 0, 0]);
  assert.equal(p.kind, 'LINE');
});

test('a planar curve gives its plane; curves on one plane share it', () => {
  near(planeFrom({ curves: [{ origin: [0, 0, 1], normal: [1, 0, 0] }] }).normal, [1, 0, 0]);
  const two = planeFrom({ curves: [{ origin: [0, 0, 1], normal: [0, 0, 1] }, { origin: [4, 0, 1], normal: [0, 0, -1] }] });
  near(two.origin, [2, 0, 1]);
  assert.ok(planeFrom({ curves: [{ origin: [0, 0, 1], normal: [0, 0, 1] }, { origin: [0, 0, 3], normal: [0, 0, 1] }] }).error);
});

test('nothing usable is refused', () => assert.ok(planeFrom({}).error));
