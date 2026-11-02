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
    assert.deepEqual(skipped, { TEXT: 1, 'INSERT (MISSING BLOCK)': 1 });
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

/** A DXF with a BLOCKS section holding the given blocks, then the entities. */
const withBlocks = (blocks, ...entities) => [
    0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, 4, 0, 'ENDSEC',
    0, 'SECTION', 2, 'BLOCKS', ...blocks.flat(), 0, 'ENDSEC',
    0, 'SECTION', 2, 'ENTITIES', ...entities.flat(), 0, 'ENDSEC', 0, 'EOF',
].join('\n');
const block = (name, base, ...entities) => [0, 'BLOCK', 8, '0', 2, name, 70, 0, 10, base[0], 20, base[1], 30, 0, ...entities.flat(), 0, 'ENDBLK'];

test('a block placed by INSERT: moved from its base, scaled, turned and repeated in a grid', () => {
    const b = block('B', [1, 0], [0, 'LINE', 10, 1, 20, 0, 11, 2, 21, 0], [0, 'CIRCLE', 10, 1, 20, 0, 40, 1]);
    const { curves, inserted, skipped } = readDxf(withBlocks([b],
        [0, 'INSERT', 2, 'B', 10, 10, 20, 0],
        [0, 'INSERT', 2, 'B', 10, 0, 20, 5, 41, 2, 42, 2, 50, 90],
        [0, 'INSERT', 2, 'B', 10, 0, 20, 20, 70, 3, 71, 2, 44, 5, 45, 7]));
    assert.equal(inserted, 3);
    assert.deepEqual(skipped, {});
    // Moved: the base (1, 0) lands on (10, 0).
    closeP(curves[0].points[0], [10, 0]); closeP(curves[0].points[1], [11, 0]);
    closeP(curves[1].center, [10, 0]);
    // Doubled and turned 90°: the line runs up from (0, 5), the circle twice the size.
    closeP(curves[2].points[1], [0, 7]);
    close(curves[3].radius, 2);
    // Three columns, two rows: six lines and six circles.
    assert.equal(curves.length, 4 + 12);
    closeP(curves.at(-2).points[0], [10, 27]);
});

test('an unevenly scaled circle becomes an ellipse, and nested blocks are followed', () => {
    const inner = block('IN', [0, 0], [0, 'CIRCLE', 10, 0, 20, 0, 40, 1]);
    const outer = block('OUT', [0, 0], [0, 'INSERT', 2, 'IN', 10, 3, 20, 0]);
    const { curves } = readDxf(withBlocks([inner, outer], [0, 'INSERT', 2, 'OUT', 10, 0, 20, 0, 41, 2, 42, 1]));
    assert.equal(curves.length, 1);
    assert.equal(curves[0].kind, 'ellipse');
    closeP(curves[0].center, [6, 0]);
    close(Math.hypot(...curves[0].major), 2); close(curves[0].minor, 1);
    assert.throws(() => readDxf(withBlocks([], [0, 'INSERT', 2, 'NONE', 10, 0, 20, 0])), /INSERT \(MISSING BLOCK\)/);
});

test('TEXT and MTEXT come in as letter outlines in the given font, or are skipped without one', async () => {
    const { readFileSync } = await import('node:fs');
    const { parseFont } = await import('../src/text.js');
    const buf = readFileSync(new URL('../src/fonts/Outfit-Regular.ttf', import.meta.url));
    const font = parseFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const file = dxf(4,
        [0, 'TEXT', 10, 10, 20, 5, 40, 2.5, 1, 'HI'],
        [0, 'MTEXT', 10, 0, 20, 0, 40, 5, 71, 1, 1, '{\\fArial|b0;A}\\PB']);
    const { curves, texts } = readDxf(file, { font });
    assert.equal(texts, 2);
    assert.ok(curves.every(c => c.kind === 'nurbs'));
    // HI: its capitals stand on the baseline at y = 5 and reach 2.5 above it, from x = 10.
    const hi = curves.filter(c => c.poles.every(p => p[1] > 4));
    const ys = hi.flatMap(c => c.poles.map(p => p[1])), xs = hi.flatMap(c => c.poles.map(p => p[0]));
    close(Math.min(...ys), 5, 1e-6); close(Math.max(...ys), 7.5, 1e-6);
    assert.ok(Math.min(...xs) >= 10);
    // The MTEXT hangs from its top left corner: two lines below y = 0, the top at 0.
    const m = curves.filter(c => c.poles.every(p => p[1] < 1e-6));
    close(Math.max(...m.flatMap(c => c.poles.map(p => p[1]))), 0, 1e-6);
    assert.throws(() => readDxf(file), /ONLY TEXT, MTEXT/);
});

test('HATCH boundaries come in as closed loops; pattern data and associative loops are left out', () => {
    const { curves, hatches, skipped } = readDxf(dxf(4,
        // A polyline loop (a 4 x 2 rectangle with a bulged right end), then the pattern's own codes.
        [0, 'HATCH', 10, 0, 20, 0, 30, 0, 2, 'ANSI31', 70, 0, 71, 0, 91, 2,
            92, 2, 72, 1, 73, 1, 93, 4, 10, 0, 20, 0, 42, 0, 10, 4, 20, 0, 42, 1, 10, 4, 20, 2, 42, 0, 10, 0, 20, 2, 42, 0, 97, 0,
            // An edge loop: a line, a half circle round the right end, a line, and a spline closing it.
            92, 1, 93, 4,
            72, 1, 10, 10, 20, 0, 11, 14, 21, 0,
            72, 2, 10, 14, 20, 1, 40, 1, 50, 270, 51, 90, 73, 1,
            72, 1, 10, 14, 20, 2, 11, 10, 21, 2,
            72, 4, 94, 1, 73, 0, 74, 0, 95, 4, 96, 2, 40, 0, 40, 0, 40, 1, 40, 1, 10, 10, 20, 2, 10, 10, 20, 0, 97, 0,
            97, 0,
            75, 0, 76, 1, 52, 0, 41, 1, 77, 0, 78, 1, 53, 45, 43, 0, 44, 0, 45, -1, 46, 1, 79, 0, 98, 1, 10, 99, 20, 99],
        [0, 'HATCH', 10, 0, 20, 0, 30, 0, 2, 'SOLID', 70, 1, 71, 1, 91, 1,
            92, 2, 72, 0, 73, 1, 93, 3, 10, 0, 20, 0, 10, 1, 20, 0, 10, 0, 20, 1, 97, 1, 330, 'AB', 75, 0, 76, 1, 98, 0]));
    assert.equal(hatches, 1);
    assert.deepEqual(skipped, { 'HATCH (BOUNDARY ALREADY DRAWN)': 1 });
    assert.equal(curves.length, 2);
    const [poly, edges] = curves;
    assert.equal(poly.kind, 'contour');
    assert.deepEqual(poly.pieces.map(p => p.kind), ['polyline', 'arc', 'polyline']);
    closeP(poly.pieces[1].mid, [5, 1]);
    assert.equal(edges.kind, 'contour');
    assert.deepEqual(edges.pieces.map(p => p.kind), ['polyline', 'arc', 'polyline', 'polyline']);
    // Counter-clockwise from 270° through 0° to 90°: from (14, 0) round the right to (14, 2).
    const arc = edges.pieces[1];
    closeP(arc.start, [14, 0]); closeP(arc.mid, [15, 1]); closeP(arc.end, [14, 2]);
    // A clockwise edge's angles are measured clockwise: 90° to 270° runs from (0, -1) by the left to (0, 1).
    const cw = readDxf(dxf(4, [0, 'HATCH', 91, 1, 92, 1, 93, 2, 72, 2, 10, 0, 20, 0, 40, 1, 50, 90, 51, 270, 73, 0, 72, 1, 10, 0, 20, 1, 11, 0, 21, -1, 97, 0])).curves[0].pieces[0];
    closeP(cw.start, [0, -1]); closeP(cw.mid, [-1, 0]); closeP(cw.end, [0, 1]);
    // The seed point (99, 99) after the pattern is not a curve point.
    assert.ok(curves.every(c => !JSON.stringify(c).match(/(^|[^.\d])99[,\]]/)));
});

test('a DIMENSION is drawn from its block: lines, arrowheads (SOLID) and text', async () => {
    const { parseFont } = await import('../src/text.js');
    const { readFileSync, readdirSync } = await import('node:fs');
    const dir = new URL('../src/fonts/', import.meta.url);
    const file = readdirSync(dir).find(f => f.endsWith('.ttf'));
    const buf = readFileSync(new URL(file, dir));
    const font = parseFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const b = block('*D1', [0, 0],
        [0, 'LINE', 10, 0, 20, 5, 11, 10, 21, 5],
        [0, 'SOLID', 10, 0, 20, 5, 11, 1, 21, 5.2, 12, 1, 22, 4.8, 13, 1, 23, 4.8],
        [0, 'MTEXT', 10, 5, 20, 5.5, 40, 1, 71, 8, 1, '10']);
    const { curves, dimensions, skipped } = readDxf(withBlocks([b], [0, 'DIMENSION', 2, '*D1', 10, 0, 20, 5, 70, 0]), { font });
    assert.equal(dimensions, 1);
    assert.deepEqual(skipped, {});
    assert.equal(curves[0].kind, 'polyline');
    assert.equal(curves[1].kind, 'polyline'); assert.equal(curves[1].closed, true); assert.equal(curves[1].points.length, 3);
    assert.ok(curves.length > 3, 'the text came in as letters');
});
