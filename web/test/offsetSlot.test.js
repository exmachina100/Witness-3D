import assert from 'node:assert/strict';
import { test } from 'node:test';
import { offsetSlot, samples } from '../src/curveEdit.js';
import { loops } from '../src/curves.js';

const plane = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0] };
const area = pts => pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;

test('a slot round a line is a closed stadium of two lines and two half circles', () => {
    const line = { ...plane, kind: 'polyline', points: [[0, 0], [20, 0]], closed: false };
    const slot = offsetSlot(line, 3);
    assert.equal(slot.kind, 'contour');
    assert.ok(loops(slot.pieces));
    assert.deepEqual(slot.pieces.map(p => p.kind), ['polyline', 'arc', 'polyline', 'arc']);
    // 20 x 6 rectangle plus a circle of radius 3.
    const a = Math.abs(area(samples(slot, 400).points));
    assert.ok(Math.abs(a - (120 + Math.PI * 9)) < 0.5, `area ${a}`);
    assert.deepEqual(slot.pieces[1].mid.map(v => +v.toFixed(9)), [23, 0]);
});

test('a slot round a bent line and round an arc closes up', () => {
    const bent = { ...plane, kind: 'polyline', points: [[0, 0], [10, 0], [10, 10]], closed: false };
    for (const corner of ['linear', 'round', 'natural']) assert.ok(loops(offsetSlot(bent, 2, corner).pieces), corner);
    const arc = { ...plane, kind: 'arc', start: [10, 0], mid: [0, 10], end: [-10, 0] };
    const s = offsetSlot(arc, 2);
    assert.ok(loops(s.pieces));
    assert.throws(() => offsetSlot({ ...plane, kind: 'circle', center: [0, 0], radius: 3 }, 1), /open curve/);
    assert.throws(() => offsetSlot(arc, 12), /shrink|meet/);
});
