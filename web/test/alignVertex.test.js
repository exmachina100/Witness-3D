import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alignedInPlane, curveVertices, moveVertices } from '../src/curveEdit.js';

const plane = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0] };
const round = v => v.map(p => p.map(x => +x.toFixed(6)));

test('moving vertices moves polyline points and both pieces at a joint', () => {
    const line = { ...plane, kind: 'polyline', points: [[0, 0], [10, 2], [20, 0]], closed: false };
    assert.deepEqual(moveVertices(line, new Map([[1, [10, 0]]])).points, [[0, 0], [10, 0], [20, 0]]);
    const sq = { ...plane, kind: 'polyline', points: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true };
    assert.deepEqual(moveVertices(sq, new Map([[0, [-1, -1]]])).points, [[-1, -1], [10, 0], [10, 10], [0, 10]]);
    // A line then a half circle: moving the joint moves the line's end and the arc's start.
    const contour = { ...plane, kind: 'contour', pieces: [{ kind: 'polyline', points: [[-10, -5], [-10, 0]], closed: false }, { kind: 'arc', start: [-10, 0], mid: [0, 10], end: [10, 0] }] };
    const m = moveVertices(contour, new Map([[1, [-12, 0]]]));
    assert.deepEqual(m.pieces[0].points.at(-1), [-12, 0]);
    assert.deepEqual(m.pieces[1].start, [-12, 0]);
    // The arc keeps its half-circle sweep: its middle sits a half chord above the chord's middle.
    assert.deepEqual(round([m.pieces[1].mid]), [[-1, 11]]);
    assert.deepEqual(round(curveVertices(m)), [[-10, -5], [-12, 0], [10, 0]]);
});

test('align puts vertices on one line along an axis, staying in the curve plane', () => {
    // User Y is model -z; on the XY plane the curve's own y is model -z too.
    const userY = [0, 0, -1];
    assert.deepEqual(round([alignedInPlane(plane, [3, 7], userY, 2)]), [[3, 2]]);
    assert.deepEqual(round([alignedInPlane(plane, [3, 7], [1, 0, 0], 0)]), [[0, 7]]);
    assert.throws(() => alignedInPlane(plane, [3, 7], [0, 1, 0], 0), /straight out/);
    // A plane tilted 45 degrees about x: aligning user Z moves along the tilted y.
    const tilted = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, Math.SQRT1_2, Math.SQRT1_2] };
    const p = alignedInPlane(tilted, [0, 0], [0, 1, 0], 1);
    // y axis = normal × x = (0, 1/√2, -1/√2); a model-y of 1 needs √2 along it.
    assert.deepEqual(round([p]), [[0, +Math.SQRT2.toFixed(6)]]);
});
