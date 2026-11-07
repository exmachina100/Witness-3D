// Tangent Arc ending tangent to a second curve (curves.js tangentArcEnds).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tangentArc, tangentArcEnds } from '../src/curves.js';

test('the arc from a tangent start ends where it touches a second curve', () => {
    const line = Array.from({ length: 101 }, (_, i) => [-50 + i, 20]);
    const [hit] = tangentArcEnds([0, 0], [1, 0], line, false, [5, 20]);
    assert.ok(Math.hypot(hit.end[0], hit.end[1] - 20) < 1e-6);
    assert.ok(Math.abs(hit.radius - 10) < 1e-6);
    const arc = tangentArc([0, 0], [1, 0], hit.end);
    assert.ok(Math.abs(arc.radius - 10) < 1e-6);
    // A circle of radius 5 round (30, 0): the arc leaving (0, 0) along +y touches it on the near side.
    const ring = Array.from({ length: 720 }, (_, i) => [30 + 5 * Math.cos(i * Math.PI / 360), 5 * Math.sin(i * Math.PI / 360)]);
    const [touch] = tangentArcEnds([0, 0], [0, 1], ring, true, [25, 0]);
    // Centre (k, 0) with k − 5 = |k| → k = 12.5 (outside touch): the touch is at (25, 0).
    assert.ok(Math.hypot(touch.end[0] - 25, touch.end[1]) < 0.05, `${touch.end}`);
});
