// Offset Curve's corner styles (Plasticity 26.1: Linear, Round, Natural) and exact offsets of
// contours of lines and arcs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arcGeometry, offsetCurve, samples } from '../src/curveEdit.js';

const plane = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] };
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const rect = { ...plane, kind: 'polyline', points: [[0, 0], [10, 0], [10, 6], [0, 6]], closed: true };
/** Area inside a closed curve, from its samples. */
function area(c) {
    const pts = samples(c, 2048).points;
    let s = 0;
    for (let i = 0; i < pts.length; i++) s += pts[i][0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * pts[i][1];
    return Math.abs(s) / 2;
}
const arcs = c => c.pieces.filter(p => p.kind === 'arc').map(p => arcGeometry(p.start, p.mid, p.end));

test('a rectangle offset with round corners gains quarter circles about its corners', () => {
    const linear = offsetCurve(rect, 2, 'linear');
    assert.equal(linear.kind, 'polyline');
    close(area(linear), 14 * 10, 1e-9);
    assert.deepEqual(offsetCurve(rect, 2, 'natural'), linear, 'lines carry on straight either way');
    const round = offsetCurve(rect, 2, 'round');
    assert.equal(round.kind, 'contour');
    const gs = arcs(round);
    assert.equal(gs.length, 4);
    for (const g of gs) { close(g.radius, 2); close(Math.abs(g.sweep), Math.PI / 2, 1e-9); }
    close(area(round), 60 + 2 * 2 * (10 + 6) + Math.PI * 4, 0.01);
    // Shrinking has no outside corners: all three styles give the same smaller rectangle.
    for (const corner of ['linear', 'round', 'natural']) close(area(offsetCurve(rect, -1, corner)), 8 * 4, 1e-9);
});

test('an open corner rounds on its outside only', () => {
    const ell = { ...plane, kind: 'polyline', points: [[0, 0], [10, 0], [10, 10]], closed: false };
    // To the right of travel is the outside of this left turn.
    const out = offsetCurve(ell, -2, 'round');
    const [g] = arcs(out);
    close(g.center[0], 10); close(g.center[1], 0); close(g.radius, 2);
    const mid = out.pieces.find(p => p.kind === 'arc').mid;
    close(mid[0], 10 + Math.SQRT2); close(mid[1], -Math.SQRT2);
    // To the left it is the inside: cut sharp.
    const inside = offsetCurve(ell, 2, 'round');
    assert.equal(inside.kind, 'polyline');
    assert.deepEqual(inside.points, [[0, 2], [8, 2], [8, 10]]);
});

test('a slot of lines and an arc offsets exactly, the arc staying an arc', () => {
    const slot = { ...plane, kind: 'contour', pieces: [
        { kind: 'polyline', points: [[0, 0], [10, 0]], closed: false },
        { kind: 'arc', start: [10, 0], mid: [15, 5], end: [10, 10] },
        { kind: 'polyline', points: [[10, 10], [0, 10], [0, 0]], closed: false },
    ] };
    const o = offsetCurve(slot, 1);
    assert.equal(o.kind, 'contour');
    const [g] = arcs(o);
    close(g.center[0], 10); close(g.center[1], 5); close(g.radius, 6);
    const pts = samples(o, 512).points;
    for (const [x, y] of pts) assert.ok(Math.abs(y + 1) < 1e-9 || Math.abs(y - 11) < 1e-9 || Math.abs(x + 1) < 1e-9 || Math.abs(Math.hypot(x - 10, y - 5) - 6) < 1e-9, `${x},${y} off the offset`);
    close(area(o), 12 * 11 + Math.PI * 36 / 2, 0.01);
});

test('where a line meets an arc at a corner, the three styles part ways', () => {
    // A line along x, then an arc turning down round (15, 0): a right turn, so left is outside.
    const hook = { ...plane, kind: 'contour', pieces: [
        { kind: 'polyline', points: [[0, 0], [10, 0]], closed: false },
        { kind: 'arc', start: [10, 0], mid: [15, -5], end: [20, 0] },
    ] };
    const corner = c => c.pieces[0].points.at(-1);
    // Natural: the line straight on to where the arc's circle (now radius 4) meets it.
    const natural = offsetCurve(hook, 1, 'natural');
    const p = corner(natural);
    close(p[1], 1); close(p[0], 15 - Math.sqrt(15));
    assert.equal(natural.pieces.length, 2);
    close(arcs(natural)[0].radius, 4);
    // Linear: both carried on along their end tangents, meeting square at (11, 1).
    const linear = offsetCurve(hook, 1, 'linear');
    assert.deepEqual(linear.pieces[0].points, [[0, 1], [11, 1], [11, 0]], 'square on, then down to the arc');
    // Round: an arc of radius 1 about the original corner.
    const round = offsetCurve(hook, 1, 'round');
    const g = arcs(round).find(a => Math.abs(a.radius - 1) < 1e-9);
    close(g.center[0], 10); close(g.center[1], 0);
    assert.throws(() => offsetCurve(hook, 1, 'chamfer'), /corner/);
});
