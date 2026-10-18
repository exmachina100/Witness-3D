import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readDxf } from '../src/dxf.js';

/** A text DXF from [code, value] pairs: a header with $INSUNITS and the given entities. */
const dxf = (units, ...entities) => [
    0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, units, 0, 'ENDSEC',
    0, 'SECTION', 2, 'ENTITIES', ...entities.flat(), 0, 'ENDSEC', 0, 'EOF',
].join('\n');
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const closeP = (p, q) => { close(p[0], q[0]); close(p[1], q[1]); };

test('lines, circles and arcs land on the XY plane, scaled to millimetres', () => {
    const { curves, units, scale } = readDxf(dxf(1,
        [0, 'LINE', 8, '0', 10, 0, 20, 0, 30, 0, 11, 2, 21, 1, 31, 0],
        [0, 'CIRCLE', 10, 1, 20, 1, 40, 0.5],
        [0, 'ARC', 10, 0, 20, 0, 40, 1, 50, 0, 51, 90]));
    assert.equal(units, 'IN'); assert.equal(scale, 25.4);
    assert.deepEqual(curves[0].normal, [0, 1, 0]);
    assert.equal(curves[0].kind, 'polyline');
    closeP(curves[0].points[1], [50.8, 25.4]);
    assert.equal(curves[1].kind, 'circle'); close(curves[1].radius, 12.7);
    const arc = curves[2];
    closeP(arc.start, [25.4, 0]); closeP(arc.end, [0, 25.4]);
    closeP(arc.mid, [25.4 * Math.SQRT1_2, 25.4 * Math.SQRT1_2]);
});

test('a closed lightweight polyline with a bulge becomes a contour with an arc', () => {
    // A 2 × 1 slot end: straight along the bottom, a half circle (bulge 1) up the right side.
    const { curves } = readDxf(dxf(4, [0, 'LWPOLYLINE', 90, 4, 70, 1,
        10, 0, 20, 0, 10, 2, 20, 0, 42, 1, 10, 2, 20, 1, 10, 0, 20, 1]));
    const c = curves[0];
    assert.equal(c.kind, 'contour');
    const arc = c.pieces.find(p => p.kind === 'arc');
    closeP(arc.start, [2, 0]); closeP(arc.end, [2, 1]);
    // Counter-clockwise from (2, 0) to (2, 1) bulges out to the right, through (2.5, 0.5).
    closeP(arc.mid, [2.5, 0.5]);
    assert.deepEqual(c.pieces.at(-1).points.at(-1), [0, 0], 'the contour closes back at the start');
    const plain = readDxf(dxf(4, [0, 'LWPOLYLINE', 90, 3, 70, 1, 10, 0, 20, 0, 10, 1, 20, 0, 10, 0, 20, 1])).curves[0];
    assert.deepEqual(plain, { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'polyline', points: [[0, 0], [1, 0], [0, 1]], closed: true });
});

test('old style polylines, ellipses and splines; the rest is counted as skipped', () => {
    const { curves, skipped, approximated } = readDxf(dxf(0,
        [0, 'POLYLINE', 66, 1, 70, 0, 0, 'VERTEX', 10, 0, 20, 0, 0, 'VERTEX', 10, 3, 20, 4, 0, 'SEQEND'],
        [0, 'ELLIPSE', 10, 0, 20, 0, 11, 4, 21, 0, 40, 0.5, 41, 0, 42, 6.283185307179586],
        [0, 'ELLIPSE', 10, 0, 20, 0, 11, 4, 21, 0, 40, 0.5, 41, 0, 42, 1.5707963267948966],
        [0, 'SPLINE', 70, 8, 71, 3, 72, 8, 73, 4, 40, 0, 40, 0, 40, 0, 40, 0, 40, 1, 40, 1, 40, 1, 40, 1,
            10, 0, 20, 0, 30, 0, 10, 1, 20, 2, 30, 0, 10, 3, 20, 2, 30, 0, 10, 4, 20, 0, 30, 0],
        [0, 'TEXT', 10, 0, 20, 0, 1, 'HELLO'],
        [0, 'INSERT', 2, 'BLOCK1']));
    assert.deepEqual(curves.map(c => c.kind), ['polyline', 'ellipse', 'spline', 'nurbs']);
    closeP(curves[0].points[1], [3, 4]);
    close(curves[1].minor, 2);
    assert.equal(approximated, 1);
    closeP(curves[2].points.at(-1), [0, 2]);
    assert.equal(curves[3].degree, 3);
    assert.deepEqual(curves[3].poles[1], [1, 2, 0]);
    assert.deepEqual(skipped, { TEXT: 1, INSERT: 1 });
});

test('a mirrored circle and nothing usable', () => {
    const { curves } = readDxf(dxf(4, [0, 'CIRCLE', 10, 5, 20, 1, 40, 2, 210, 0, 220, 0, 230, -1]));
    closeP(curves[0].center, [-5, 1]);
    assert.throws(() => readDxf(dxf(4, [0, 'TEXT', 1, 'X'])), /ONLY TEXT/);
    assert.throws(() => readDxf('AC1015 binary junk'), /NOT A DXF/);
});

test('a vertex missing its y is left out as damaged, not sent on as null', () => {
    const { curves, skipped } = readDxf(dxf(4,
        [0, 'LWPOLYLINE', 90, 2, 70, 0, 10, 0, 20, 0, 10, 'oops', 20, 1],
        [0, 'LINE', 10, 0, 20, 0, 11, 1, 21, 1]));
    assert.equal(curves.length, 1);
    assert.deepEqual(skipped, { 'DAMAGED ENTITY': 1 });
});
