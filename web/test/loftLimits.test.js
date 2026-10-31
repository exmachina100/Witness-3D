import assert from 'node:assert/strict';
import { test } from 'node:test';
import { limitCurve } from '../src/loftLimits.js';

const frame = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] };
const line = { ...frame, kind: 'polyline', points: [[0, 0], [10, 0]], closed: false };
const circle = { ...frame, kind: 'circle', center: [0, 0], radius: 5 };

test('one limit point on a line keeps one side, the other when flipped', () => {
    assert.deepEqual(limitCurve(line, [[3, 0]]).points, [[0, 0], [3, 0]]);
    assert.deepEqual(limitCurve(line, [[3, 0]], true).points, [[3, 0], [10, 0]]);
});

test('two limit points keep the stretch between them, in either order', () => {
    assert.deepEqual(limitCurve(line, [[3, 0], [7, 0]]).points, [[3, 0], [7, 0]]);
    assert.deepEqual(limitCurve(line, [[7, 0], [3, 0]]).points, [[3, 0], [7, 0]]);
});

test('a point at an end changes nothing; no points give the curve back', () => {
    assert.equal(limitCurve(line, []), line);
    assert.deepEqual(limitCurve(line, [[0, 0]]).points, line.points);
});

test('on a circle two points keep one arc, the other when flipped', () => {
    const arc = limitCurve(circle, [[5, 0], [-5, 0]]), other = limitCurve(circle, [[5, 0], [-5, 0]], true);
    for (const c of [arc, other]) assert.ok(c.kind === 'arc' || c.kind === 'contour', c.kind);
    const mid = c => c.kind === 'arc' ? c.mid : null;
    if (mid(arc) && mid(other)) assert.ok(Math.sign(mid(arc)[1]) !== Math.sign(mid(other)[1]));
});
