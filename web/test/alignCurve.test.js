// Plasticity's Align Vertex / Align Curve: a curve's end moved onto another curve's end (or a point
// along it) in G0, G1 or G2 by moving its first control points.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alignCurveEnd, continuity } from '../src/curveEdit.js';

const plane = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] };
// Reference: a quarter arc of radius 10 about (0, 10), from (0, 0) to (10, 10), ending heading up.
const arc = { ...plane, kind: 'arc', start: [0, 0], mid: [10 * Math.SQRT1_2, 10 - 10 * Math.SQRT1_2], end: [10, 10] };
// Target: a control point curve starting a little off the arc's end.
const wave = { ...plane, kind: 'cv', points: [[12, 13], [14, 18], [18, 20], [24, 19], [30, 22]], closed: false };

for (const g of ['G0', 'G1', 'G2']) test(`a curve's start meets an arc's end in ${g}`, () => {
    const out = alignCurveEnd(wave, 0, arc, 1, { continuity: g });
    const m = continuity(arc, 1, out, 0);
    assert.ok(m.gap < 1e-9, `gap ${m.gap}`);
    if (g === 'G0') return;
    assert.ok(m.angle < 1e-4, `angle ${m.angle}`);
    if (g === 'G1') return;
    assert.ok(Math.abs(m.ka - m.kb) < 1e-3 * m.ka, `curvature ${m.ka} vs ${m.kb}`);
    assert.equal(m.continuity, 'G2');
});

test("the target's far end stays and its other end can be aligned too", () => {
    const out = alignCurveEnd(wave, 1, arc, 0, { continuity: 'G1' });
    assert.deepEqual(out.poles[0].slice(0, 2), wave.points[0]);
    const m = continuity(arc, 0, out, 1);
    assert.ok(m.gap < 1e-9 && m.angle < 1e-4);
});

test('G2 needs three control points of degree 2 or more', () => {
    const line = { ...plane, kind: 'polyline', points: [[12, 13], [20, 20]], closed: false };
    assert.throws(() => alignCurveEnd(line, 0, arc, 1, { continuity: 'G2' }), /3 control points|degree/);
    const m = continuity(arc, 1, alignCurveEnd(line, 0, arc, 1, { continuity: 'G1' }), 0);
    assert.ok(m.gap < 1e-9 && m.angle < 1e-4, 'a line turns to carry the arc on');
});
