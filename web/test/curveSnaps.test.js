import test from 'node:test';
import assert from 'node:assert/strict';
import { along, curvePointSnaps, intersections, perpendicularFeet, tangentPoints, closestOnScreen, circleTangents } from '../src/curveSnaps.js';

const near = (a, b, t = 1e-6) => assert.ok(a.every((v, i) => Math.abs(v - b[i]) < t), `${a} vs ${b}`);
const circle = (r, n = 360) => Array.from({ length: n }, (_, i) => [r * Math.cos(2 * Math.PI * i / n), r * Math.sin(2 * Math.PI * i / n), 0]);

test('quarter points go by length, not by vertex count', () => {
  const pts = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [10, 0, 0]];
  near(along(pts, 0.25), [2.5, 0, 0]);
  const s = curvePointSnaps(pts);
  assert.deepEqual(s.map(x => x.kind), ['END', 'END', 'MIDDLE', '1/4', '3/4']);
  near(s.find(x => x.kind === '3/4').point, [7.5, 0, 0]);
  const closed = curvePointSnaps([[0, 0, 0], [4, 0, 0], [4, 4, 0], [0, 4, 0]], { closed: true, center: [2, 2, 0] });
  assert.ok(!closed.some(x => x.kind === 'END'));
  near(closed.find(x => x.kind === 'MIDDLE').point, [4, 4, 0]);
  near(closed.find(x => x.kind === 'CENTER').point, [2, 2, 0]);
});

test('crossing curves give one intersection; parallel ones none', () => {
  const x = intersections([{ pts: [[-5, 0, 0], [5, 0, 0]] }, { pts: [[1, -5, 0], [1, 0, 0], [1, 5, 0]] }]);
  assert.equal(x.length, 1); near(x[0].point, [1, 0, 0]);
  assert.equal(intersections([{ pts: [[0, 0, 0], [5, 0, 0]] }, { pts: [[0, 1, 0], [5, 1, 0]] }]).length, 0);
  assert.equal(intersections([{ pts: [[-5, 0, 0], [5, 0, 0]] }, { pts: [[0, -5, 2], [0, 5, 2]] }]).length, 0);
  assert.equal(intersections([{ pts: circle(3), closed: true }, { pts: [[-5, 0.5, 0], [5, 0.5, 0]] }]).length, 2);
});

test('perpendicular feet from a point', () => {
  const f = perpendicularFeet([[0, 0, 0], [10, 0, 0]], [3, 4, 0]);
  assert.equal(f.length, 1); near(f[0].point, [3, 0, 0]);
  const c = perpendicularFeet(circle(5), [10, 0, 0], true);
  assert.ok(c.some(p => Math.abs(p.point[0] - 5) < 1e-6) && c.some(p => Math.abs(p.point[0] + 5) < 1e-6));
});

test('tangents from a point to a circle, on the polyline and exactly', () => {
  const from = [10, 0, 0], exact = circleTangents([0, 0, 0], 5, [0, 0, 1], from);
  assert.equal(exact.length, 2);
  for (const t of exact) { near([Math.hypot(t.point[0], t.point[1])], [5]); near([t.point[0]], [2.5]); }
  const poly = tangentPoints(circle(5, 720), from, [0, 0, 1], true);
  assert.equal(poly.length, 2);
  for (const t of poly) assert.ok(Math.abs(t.point[0] - 2.5) < 0.01);
  assert.equal(circleTangents([0, 0, 0], 5, [0, 0, 1], [1, 0, 0]).length, 0);
});

test('closest point uses the screen positions', () => {
  const pts = [[0, 0, 0], [10, 0, 0]], screen = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  const c = closestOnScreen(pts, screen, { x: 30, y: 4 });
  near(c.point, [3, 0, 0]); assert.equal(c.d, 4);
});
