import assert from 'node:assert/strict';
import { test } from 'node:test';
import { distanceTo, offsetCurve, offsetThrough } from '../src/curveEdit.js';

const plane = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0] };
const square = { ...plane, kind: 'polyline', points: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true };
const line = { ...plane, kind: 'polyline', points: [[0, 0], [10, 0]], closed: false };
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('freestyle offset takes its size from the click and its side from where it is', () => {
    close(distanceTo(square, [13, 5]), 3);
    close(offsetThrough(square, [13, 5]), 3, 1e-9);   // outside grows
    close(offsetThrough(square, [8, 5]), -2, 1e-9);   // inside shrinks
    const up = offsetThrough(line, [5, 4]), down = offsetThrough(line, [5, -4]);
    close(Math.abs(up), 4); close(down, -up);
    // The offset goes through the clicked point.
    close(distanceTo(offsetCurve(line, up), [5, 4]), 0, 1e-9);
    assert.throws(() => offsetThrough(line, [5, 0]), /click off the curve/);
});
