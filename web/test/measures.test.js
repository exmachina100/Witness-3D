import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureAxis, distanceMeasure, circleOf3, radiusMeasure, checkMeasure, measureShape, moveMeasure } from '../src/app/measures.js';

const frame = { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] };
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);

test('the pointer pulled up measures across, pulled sideways measures up', () => {
    const a = [0, 0, 0], b = [30, 10, 0];
    assert.equal(measureAxis(a, b, [15, 40, 0], frame), 'u');
    assert.equal(measureAxis(a, b, [60, 5, 0], frame), 'v');
    // Points on a vertical: whichever way it is pulled sideways, it measures the height.
    assert.equal(measureAxis([0, 0, 0], [0, 0, 25], [20, 0, 12], frame), 'n');
});

test('an axis distance runs through the pointer with its extension lines', () => {
    const m = distanceMeasure([0, 0, 0], [30, 10, 0], [15, 40, 0], frame, 'u');
    near(m.value, 30);
    assert.deepEqual(m.line, [[0, 40, 0], [30, 40, 0]]);
    assert.deepEqual(m.ext[1], [[30, 10, 0], [30, 40, 0]]);
});

test('a straight distance is the true length, offset towards the pointer', () => {
    const m = distanceMeasure([0, 0, 0], [30, 40, 0], [0, 50, 0], frame, null);
    near(m.value, 50);
    // The line stays parallel to the points.
    const [A, B] = m.line;
    near((B[0] - A[0]) / 30, (B[1] - A[1]) / 40);
});

test('a radius from three points, its leader from the circle to the pointer', () => {
    const c = circleOf3([10, 0, 5], [0, 10, 5], [-10, 0, 5]);
    near(c.radius, 10); near(c.centre[2], 5); near(Math.abs(c.normal[2]), 1);
    const m = radiusMeasure(c, [0, -30, 5]);
    near(m.value, 10);
    near(m.line[0][1], -10);
    assert.equal(circleOf3([0, 0, 0], [1, 1, 1], [2, 2, 2]), null);
});

test('stored measurements check, draw and move', () => {
    const d = { id: 1, kind: 'distance', a: [0, 0, 0], b: [30, 10, 0], p: [15, 40, 0], axis: [1, 0, 0] };
    const r = { id: 2, kind: 'radius', centre: [0, 0, 0], normal: [0, 0, 1], radius: 4, p: [10, 0, 0] };
    assert.deepEqual(checkMeasure(d), []);
    assert.deepEqual(checkMeasure(r), []);
    assert.deepEqual(checkMeasure({ id: 3, kind: 'distance', a: [0, 0], b: [1, 1, 1], p: [0, 0, 0], axis: null }), ['points']);
    near(measureShape(d).value, 30);
    near(measureShape({ ...d, axis: null }).value, Math.hypot(30, 10));
    near(measureShape(r).value, 4);
    assert.deepEqual(moveMeasure(r, [1, 2, 3]).centre, [1, 2, 3]);
    assert.deepEqual(moveMeasure(d, [1, 0, 0]).b, [31, 10, 0]);
});
