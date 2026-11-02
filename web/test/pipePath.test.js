import test from 'node:test';
import assert from 'node:assert/strict';
import { pipePath, untrimmed } from '../src/pipePath.js';

const plane = { origin: [0, 0, 0], normal: [0, 0, 1], xAxis: [1, 0, 0] };
const line = { ...plane, kind: 'polyline', closed: false, points: [[0, 0], [10, 0], [10, 10]] };
const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

test('distances below 1 pull the ends back along the path', () => {
    assert.equal(pipePath(line, 1, 1), line);
    assert.ok(untrimmed(1, 1) && !untrimmed(0.5, 1));
    const p = pipePath(line, 0.75, 0.75); // 20 long: from 5 to 15
    assert.ok(close(p.points[0], [5, 0]) && close(p.points.at(-1), [10, 5]), JSON.stringify(p.points));
});

test('distances above 1 carry the path on past its ends', () => {
    const p = pipePath(line, 1.25, 1); // 5 more before the start
    assert.ok(close(p.points[0], [-5, 0]) && close(p.points.at(-1), [10, 10]));
    const arc = { ...plane, kind: 'arc', start: [10, 0], mid: [Math.SQRT1_2 * 10, Math.SQRT1_2 * 10], end: [0, 10] };
    const half = pipePath(arc, 1, 0.5);
    assert.ok(close(half.end, [Math.SQRT1_2 * 10, Math.SQRT1_2 * 10]), JSON.stringify(half));
});

test('distances that leave nothing, or a closed path, are refused', () => {
    assert.throws(() => pipePath(line, 0.4, 0.5), /leave no pipe/);
    assert.throws(() => pipePath({ ...plane, kind: 'circle', center: [0, 0], radius: 5 }, 0.5, 1), /two ends/);
    assert.throws(() => pipePath(line, 0, 1), /greater than zero/);
});
