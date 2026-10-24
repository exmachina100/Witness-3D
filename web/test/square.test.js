import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byLength, orderLoop, square, surfaceAt } from '../src/square.js';

const arc = (f, n = 40) => Array.from({ length: n + 1 }, (_, i) => f(i / n));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// Four sides of a saddle-ish frame: straight bottom and top, bowed left and right.
const bottom = arc(t => [20 * t, 0, 0]);
const right = arc(t => [20 + 3 * Math.sin(Math.PI * t), 4 * Math.sin(Math.PI * t), 10 * t]);
const top = arc(t => [20 * (1 - t), 0, 10]);
const left = arc(t => [-3 * Math.sin(Math.PI * t), -4 * Math.sin(Math.PI * t), 10 * (1 - t)]);

test('sides given in any order and direction are put round the loop', () => {
    const loop = orderLoop([bottom, [...top].reverse(), left, right], 0.01);
    for (let i = 0; i < 4; i++) assert.ok(dist(loop[i].at(-1), loop[(i + 1) % 4][0]) < 1e-9);
    assert.throws(() => orderLoop([bottom, right, top, left.map(p => [p[0], p[1] + 1, p[2]])], 0.01), /meet|close/);
});

test('four sides fill with a sheet whose sides follow them within tolerance', () => {
    const s = square([right, bottom, left, [...top].reverse()], { tolerance: 0.01 });
    assert.ok(s.gap <= 0.01, `gap ${s.gap}`);
    // Every point of every side has the sheet near it.
    const grid = [];
    for (let i = 0; i <= 100; i++) for (const v of [0, 1]) { grid.push(surfaceAt(s, i / 100, v)); grid.push(surfaceAt(s, v, i / 100)); }
    for (const p of [...bottom, ...right, ...top, ...left]) assert.ok(Math.min(...grid.map(q => dist(p, q))) < 0.15);
});

test('chosen degree and spans are kept', () => {
    const s = square([bottom, right, top, left], { degree: 5, spans: [3, 2] });
    assert.deepEqual(s.spans, [3, 2]);
    assert.equal(s.poles.length, 8);
    assert.equal(s.poles[0].length, 7);
});

test('two sides loft straight between them', () => {
    const a = arc(t => [20 * t, 3 * Math.sin(Math.PI * t), 0]), b = arc(t => [20 * (1 - t), 0, 10]);
    const s = square([a, b], { tolerance: 0.01 });
    assert.ok(s.gap <= 0.01);
    const mid = surfaceAt(s, 0.5, 0.5);
    assert.ok(dist(mid, [10, 1.5, 5]) < 0.05, `mid ${mid}`);
});

test('a side of no length is refused', () => {
    assert.throws(() => byLength([[1, 1, 1], [1, 1, 1]]), /length/);
    assert.throws(() => square([bottom, right, top]), /four sides/);
});
