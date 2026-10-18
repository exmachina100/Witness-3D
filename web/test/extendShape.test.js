import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extendCurve, samples } from '../src/curveEdit.js';
import { loops } from '../src/curves.js';

const plane = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0] };
const r6 = p => p.map(v => +v.toFixed(6));

test('an arc extends round its circle (natural) or straight along its end (linear)', () => {
    const arc = { ...plane, kind: 'arc', start: [10, 0], mid: [10 * Math.SQRT1_2, 10 * Math.SQRT1_2], end: [0, 10] };
    const nat = extendCurve(arc, 1, Math.PI * 5);
    assert.equal(nat.kind, 'arc');
    assert.deepEqual(r6(nat.end), [-10, 0]);
    const lin = extendCurve(arc, 1, 4, 'linear');
    assert.equal(lin.kind, 'contour');
    assert.deepEqual(lin.pieces.map(p => p.kind), ['arc', 'polyline']);
    assert.deepEqual(r6(lin.pieces[1].points[1]), [-4, 10]);
    // At the start, the new piece goes first and runs into the arc.
    const lin0 = extendCurve(arc, 0, 4, 'linear');
    assert.deepEqual(r6(lin0.pieces[0].points[0]), [10, -4]);
    assert.deepEqual(r6(lin0.pieces[0].points[1]), [10, 0]);
});

test('a spline extends with an arc of its end curvature, or a line', () => {
    // Points on a circle of radius 20: the natural extension carries on round the same circle.
    const pts = Array.from({ length: 9 }, (_, i) => { const t = i * 0.1; return [20 * Math.cos(t), 20 * Math.sin(t)]; });
    const sp = { ...plane, kind: 'spline', points: pts, samples: Array.from({ length: 401 }, (_, i) => { const t = i * 0.8 / 400; return [20 * Math.cos(t), 20 * Math.sin(t)]; }), closed: false };
    const nat = extendCurve(sp, 1, 10);
    assert.deepEqual(nat.pieces.map(p => p.kind), ['spline', 'arc']);
    const end = nat.pieces[1].end, want = 0.8 + 10 / 20;
    assert.ok(Math.hypot(end[0] - 20 * Math.cos(want), end[1] - 20 * Math.sin(want)) < 0.05, `end ${end}`);
    const lin = extendCurve(sp, 1, 10, 'linear');
    assert.equal(lin.pieces[1].kind, 'polyline');
    assert.ok(!loops(lin.pieces));
    // A joined curve extends its last piece the same way.
    const contour = { ...plane, kind: 'contour', pieces: [{ kind: 'polyline', points: [[-5, 0], [10, 0]], closed: false }, { kind: 'arc', start: [10, 0], mid: [10 + 5 * Math.SQRT1_2, 5 - 5 * Math.SQRT1_2], end: [15, 5] }] };
    const c2 = extendCurve(contour, 1, 2, 'linear');
    assert.deepEqual(c2.pieces.map(p => p.kind), ['polyline', 'arc', 'polyline']);
    assert.deepEqual(r6(samples(c2).points.at(-1)), [15, 7]);
});
