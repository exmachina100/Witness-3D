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

test('proportional: All moves the neighbours less the further they are, Selected eases the ends', () => {
    const line = { ...cv, points: [[0, 0], [10, 0], [20, 0], [30, 0], [40, 0]] };
    const all = slideCurveCVs(line, [2], 2, 'u', { mode: 'all', falloff: 2 });
    near(all.points[2], [22, 0]);
    assert.ok(all.points[1][0] > 10 && all.points[1][0] < 12, `${all.points[1]}`);
    assert.ok(Math.abs((all.points[3][0] - 30) - (all.points[1][0] - 10)) < 1e-9);
    assert.deepEqual(all.points[0], [0, 0]);
    // None leaves the neighbours alone.
    assert.deepEqual(slideCurveCVs(line, [2], 2, 'u', { mode: 'none' }).points[1], [10, 0]);
    // Selected: the middle pick moves most.
    const sel = slideCurveCVs(line, [1, 2, 3], 2, 'u', { mode: 'selected', falloff: 2 });
    assert.ok(sel.points[2][0] - 20 > sel.points[1][0] - 10);
});

test('mirror: the point as far from the other end slides the mirror way', () => {
    // A symmetric cage about x = 20.
    const sym = { ...cv, points: [[0, 0], [10, 10], [20, 12], [30, 10], [40, 0]] };
    const m = slideCurveCVs(sym, [1], 2, 'u', { mirror: true });
    near([40 - m.points[3][0], m.points[3][1]], m.points[1]);
    const across = slideCurveCVs(sym, [1], 2, 'n', { mirror: true });
    near([40 - across.points[3][0], across.points[3][1]], across.points[1]);
    assert.deepEqual(slideCurveCVs(sym, [2], 2, 'u', { mirror: true }).points[1], [10, 10]);
});
