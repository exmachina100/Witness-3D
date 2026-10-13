// Round 7: Offset Curve, Fillet Curve, Explode and Trim, as plain geometry (no kernel needed).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arcGeometry, explode, filletCurve, offsetCurve, samples, trim } from '../src/curveEdit.js';
import { loops } from '../src/curves.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const plane = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0] };
const rect = (w, h, ccw = true) => ({ ...plane, kind: 'polyline', closed: true, points: ccw ? [[0, 0], [w, 0], [w, h], [0, h]] : [[0, 0], [0, h], [w, h], [w, 0]] });
const line = (a, b) => ({ ...plane, kind: 'polyline', closed: false, points: [a, b] });
const bounds = pts => ({ minX: Math.min(...pts.map(p => p[0])), maxX: Math.max(...pts.map(p => p[0])), minY: Math.min(...pts.map(p => p[1])), maxY: Math.max(...pts.map(p => p[1])) });

test('offset grows a closed rectangle outward whichever way it was drawn', () => {
    for (const ccw of [true, false]) {
        const o = offsetCurve(rect(10, 6, ccw), 2);
        assert.equal(o.kind, 'polyline');
        assert.equal(o.closed, true);
        const b = bounds(o.points);
        close(b.minX, -2); close(b.maxX, 12); close(b.minY, -2); close(b.maxY, 8);
        const s = bounds(offsetCurve(rect(10, 6, ccw), -1).points);
        close(s.minX, 1); close(s.maxX, 9);
    }
    assert.throws(() => offsetCurve(rect(10, 6), -4), /inside out/);
});

test('offset keeps circles and arcs exact and moves open lines to their left', () => {
    const c = offsetCurve({ ...plane, kind: 'circle', center: [1, 2], radius: 5 }, 1.5);
    assert.deepEqual([c.kind, c.center, c.radius], ['circle', [1, 2], 6.5]);
    assert.throws(() => offsetCurve({ ...plane, kind: 'circle', center: [0, 0], radius: 1 }, -1), /shrink/);
    const a = offsetCurve({ ...plane, kind: 'arc', start: [5, 0], mid: [0, 5], end: [-5, 0] }, 2);
    close(arcGeometry(a.start, a.mid, a.end).radius, 7);
    const l = offsetCurve(line([0, 0], [10, 0]), 3);
    assert.deepEqual(l.points, [[0, 3], [10, 3]]);
    assert.equal(offsetCurve({ ...plane, kind: 'ellipse', center: [0, 0], major: [6, 0], minor: 3 }, 1).kind, 'spline');
    assert.throws(() => offsetCurve(line([0, 0], [1, 0]), 0), /nothing to do/);
});

test('fillet curve rounds every corner of a rectangle with tangent arcs', () => {
    const f = filletCurve(rect(10, 6), 1);
    assert.equal(f.kind, 'contour');
    assert.ok(loops(f.pieces), 'still closed');
    const arcs = f.pieces.filter(p => p.kind === 'arc');
    assert.equal(arcs.length, 4);
    for (const a of arcs) close(arcGeometry(a.start, a.mid, a.end).radius, 1, 1e-9);
    // The straight sides shorten by the radius at each end.
    const lens = f.pieces.filter(p => p.kind === 'polyline').map(p => Math.hypot(p.points[1][0] - p.points[0][0], p.points[1][1] - p.points[0][1])).sort((x, y) => x - y);
    assert.deepEqual(lens.map(v => +v.toFixed(9)), [4, 4, 8, 8]);
    // Only the chosen corner, on an open polyline.
    const open = filletCurve({ ...plane, kind: 'polyline', closed: false, points: [[0, 0], [10, 0], [10, 10]] }, 2);
    assert.equal(open.pieces.filter(p => p.kind === 'arc').length, 1);
    assert.throws(() => filletCurve(rect(10, 6), 4), /too large/);
    assert.throws(() => filletCurve(line([0, 0], [5, 0]), 1), /no corner/);
    assert.throws(() => filletCurve({ ...plane, kind: 'circle', center: [0, 0], radius: 1 }, 1), /corners/);
});

test('explode splits a rectangle into four lines and a contour into its pieces', () => {
    const lines = explode(rect(10, 6));
    assert.equal(lines.length, 4);
    assert.ok(lines.every(l => l.kind === 'polyline' && !l.closed && l.points.length === 2));
    assert.deepEqual(lines[3].points, [[0, 6], [0, 0]], 'the closing side too');
    assert.equal(explode(filletCurve(rect(10, 6), 1)).length, 8);
    assert.throws(() => explode(line([0, 0], [1, 0])), /single line/);
    assert.throws(() => explode({ ...plane, kind: 'circle', center: [0, 0], radius: 1 }), /explode/);
});

test('trim drops the piece of a line between the crossings nearest the click', () => {
    const target = line([0, 0], [10, 0]);
    const cutters = [line([3, -1], [3, 1]), line([7, -1], [7, 1])];
    const middle = trim(target, cutters, [5, 0.1]);
    assert.deepEqual(middle.map(c => c.points), [[[0, 0], [3, 0]], [[7, 0], [10, 0]]]);
    const end = trim(target, cutters, [9, 0]);
    assert.deepEqual(end.map(c => c.points), [[[0, 0], [3, 0]], [[3, 0], [7, 0]]]);
    assert.deepEqual(trim(target, [], [5, 0]), [], 'nothing crosses it: the whole line goes');
    // A cutter in another plane doesn't count.
    assert.deepEqual(trim(target, [{ ...line([5, -1], [5, 1]), origin: [0, 5, 0] }], [2, 0]), []);
});

test('trim opens a rectangle and cuts circles and arcs into arcs', () => {
    const cross = line([5, -2], [5, 8]);
    const box = trim(rect(10, 6), [cross], [8, 0]);
    assert.equal(box.length, 1);
    assert.equal(box[0].closed, false);
    const b = bounds(box[0].points);
    close(b.maxX, 5); close(b.minX, 0);

    const circle = { ...plane, kind: 'circle', center: [0, 0], radius: 5 };
    const half = trim(circle, [line([-10, 0], [10, 0])], [0, -5]);
    assert.equal(half.length, 1);
    assert.equal(half[0].kind, 'arc');
    const g = arcGeometry(half[0].start, half[0].mid, half[0].end);
    close(Math.abs(g.sweep), Math.PI, 1e-9);
    assert.ok(half[0].mid[1] > 0, 'the top half stays');

    const arc = { ...plane, kind: 'arc', start: [5, 0], mid: [0, 5], end: [-5, 0] };
    const kept = trim(arc, [line([0, 0], [0, 10])], [3.5, 3.5]);
    assert.equal(kept.length, 1);
    assert.ok(kept[0].mid[0] < 0, 'the left part stays');
});

test('samples close loops without repeating the first point', () => {
    const s = samples({ kind: 'ellipse', center: [0, 0], major: [4, 0], minor: 2 }, 16);
    assert.equal(s.points.length, 16);
    assert.equal(s.closed, true);
});
