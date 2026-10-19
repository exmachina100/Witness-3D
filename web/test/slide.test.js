import assert from 'node:assert/strict';
import { test } from 'node:test';
import { slideCurveCVs } from '../src/curveEdit.js';

const near = (a, b) => assert.ok(a.every((v, i) => Math.abs(v - b[i]) < 1e-9), `${a} != ${b}`);
const cv = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'cv', closed: false, points: [[0, 0], [10, 0], [10, 10], [20, 10]] };

test('a control point slides along the cage through it, back, or across', () => {
    // Point 1's cage runs from point 0 to point 2: (10, 10) / √2.
    const s = Math.SQRT1_2 * 2;
    near(slideCurveCVs(cv, [1], 2, 'u').points[1], [10 + s, s]);
    near(slideCurveCVs(cv, [1], 2, '-u').points[1], [10 - s, -s]);
    near(slideCurveCVs(cv, [1], 2, 'n').points[1], [10 - s, s]);
    // The others stay; an end slides along its one span.
    assert.deepEqual(slideCurveCVs(cv, [1], 2).points[2], [10, 10]);
    near(slideCurveCVs(cv, [0], 3).points[0], [3, 0]);
});

test('several points slide along the cage as it was, and a closed NURBS keeps its loop', () => {
    const both = slideCurveCVs(cv, [1, 2], 1);
    near(both.points[1], [10 + Math.SQRT1_2, Math.SQRT1_2]);
    near(both.points[2], [10 + Math.SQRT1_2, 10 + Math.SQRT1_2]);
    const loop = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'nurbs', degree: 1, poles: [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], [0, 0, 0]], weights: [1, 1, 1, 1, 1], knots: [0, 0, 0.25, 0.5, 0.75, 1, 1] };
    const moved = slideCurveCVs(loop, [0], 1);
    // Point 0's cage runs from (0, 10) to (10, 0); the loop's last pole follows its first.
    near(moved.poles[0], [Math.SQRT1_2, -Math.SQRT1_2, 0]);
    assert.deepEqual(moved.poles.at(-1), moved.poles[0]);
    assert.throws(() => slideCurveCVs({ ...cv, kind: 'polyline' }, [1], 1), /control points/);
});
