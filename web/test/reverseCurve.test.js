import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reverseCurve, samples } from '../src/curveEdit.js';
import { nurbsPoints } from '../src/curves.js';

const plane = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0] };
const ends = c => { const p = samples(c).points; return [p[0], p.at(-1)].map(q => q.map(v => +v.toFixed(6))); };

test('reverse curve swaps the ends of lines, arcs, splines and joined curves', () => {
    const line = { ...plane, kind: 'polyline', points: [[0, 0], [10, 0], [10, 5]], closed: false };
    assert.deepEqual(reverseCurve(line).points, [[10, 5], [10, 0], [0, 0]]);
    const arc = { ...plane, kind: 'arc', start: [10, 0], mid: [0, 10], end: [-10, 0] };
    assert.deepEqual(ends(reverseCurve(arc)), [[-10, 0], [10, 0]]);
    const contour = { ...plane, kind: 'contour', pieces: [{ kind: 'polyline', points: [[-10, -5], [-10, 0]], closed: false }, { kind: 'arc', start: [-10, 0], mid: [0, 10], end: [10, 0] }] };
    const r = reverseCurve(contour);
    assert.deepEqual(ends(r), [[10, 0], [-10, -5]]);
    assert.equal(r.pieces[0].kind, 'arc');
    assert.deepEqual(r.origin, [0, 0, 0]);
    // A closed outline keeps its first corner.
    const sq = { ...plane, kind: 'polyline', points: [[0, 0], [1, 0], [1, 1], [0, 1]], closed: true };
    assert.deepEqual(reverseCurve(sq).points, [[0, 0], [0, 1], [1, 1], [1, 0]]);
    assert.throws(() => reverseCurve({ ...plane, kind: 'circle', center: [0, 0], radius: 1 }), /no direction/);
});

test('a reversed NURBS traces the same points backwards', () => {
    const c = { ...plane, kind: 'nurbs', degree: 3, poles: [[0, 0, 0], [5, 8, 0], [12, -3, 0], [20, 4, 0], [25, 0, 0]], weights: [1, 2, 1, 1, 1], knots: [0, 0, 0, 0, 0.3, 1, 1, 1, 1] };
    const a = nurbsPoints(c), b = nurbsPoints(reverseCurve(c)).reverse();
    assert.equal(a.length, b.length);
    // It starts where the original ends and ends where it starts.
    assert.deepEqual(a[0].map(v => +v.toFixed(6)), b[0].map(v => +v.toFixed(6)));
    assert.deepEqual(a.at(-1).map(v => +v.toFixed(6)), b.at(-1).map(v => +v.toFixed(6)));
});
