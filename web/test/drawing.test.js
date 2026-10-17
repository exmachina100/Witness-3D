// SVG and DXF export (Plasticity's) in the browser build: the hidden-line drawing of bodies seen from
// a view, and the files written from it. The desktop's tests are crates/w3d-kernel/tests/drawing.rs.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as THREE from 'three';
import { box, loadKernel, primitive } from '../src/Kernel.js';
import { hiddenLines } from '../src/Drawing.js';
import { extent, flatten, toDxf, toSvg } from '../src/drawingExport.js';

before(async () => { await loadKernel() });

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const length = l => { let s = 0; for (let i = 2; i < l.points.length; i += 2) s += Math.hypot(l.points[i] - l.points[i - 2], l.points[i + 1] - l.points[i - 1]); return s; };
const total = (lines, hidden) => lines.filter(l => l.hidden === hidden).reduce((s, l) => s + length(l), 0);

test('a box from above draws its rectangle', () => {
    const lines = hiddenLines([box(v(0, 0, 0), v(10, 20, 30))], [0, 0, 0], [0, 0, 1], [1, 0, 0], 0.01);
    assert.ok(Math.abs(total(lines, false) - 60) < 1e-6, `visible ${total(lines, false)}`);
    assert.deepEqual(extent(lines).map(v => Math.round(v * 1e6) / 1e6), [0, 0, 10, 20]);
});

test('a cube seen corner on hides the three far edges', () => {
    const r = Math.SQRT1_2, lines = hiddenLines([box(v(0, 0, 0), v(10, 10, 10))], [0, 0, 0], [1, 1, 1].map(v => v / Math.sqrt(3)), [r, -r, 0], 0.01);
    const edge = 10 * Math.sqrt(2 / 3);
    assert.ok(Math.abs(total(lines, false) - 9 * edge) < 1e-6, `visible ${total(lines, false)}`);
    assert.ok(Math.abs(total(lines, true) - 3 * edge) < 1e-6, `hidden ${total(lines, true)}`);
});

test('a cylinder from the side draws its silhouettes and hides the back of its rims', () => {
    const cyl = primitive({ kind: 'cylinder', frame: { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] }, radius: 5, height: 20 });
    const lines = hiddenLines([cyl], [0, 0, 0], [0, -1, 0], [1, 0, 0], 0.001);
    assert.ok(Math.abs(total(lines, false) - 60) < 0.01, `visible ${total(lines, false)}`);
    assert.ok(Math.abs(total(lines, true) - 20) < 0.01, `hidden ${total(lines, true)}`);
});

test('a bad tolerance is refused', () => {
    assert.throws(() => hiddenLines([box(v(0, 0, 0), v(1, 1, 1))], [0, 0, 0], [0, 0, 1], [1, 0, 0], 0));
});

test('curves lay flat in the view and the files carry every line', () => {
    const view = { origin: [0, 0, 0], toward: [0, 0, 1], x: [1, 0, 0] };
    assert.deepEqual(flatten([[3, 4, 9], [5, 6, -2]], view), [3, 4, 5, 6]);
    const lines = [
        { hidden: false, points: [0, 0, 10, 0] },
        { hidden: true, points: [0, 0, 0, 10, 5, 10] },
        { curve: true, points: [0, 0, 10, 0, 10, 10, 0, 0] },
    ];
    const svg = toSvg(lines);
    assert.match(svg, /width="20mm" height="20mm" viewBox="0 0 20 20"/);
    assert.equal(svg.match(/<polyline/g).length, 3);
    assert.match(svg, /<g id="hidden"[^>]*stroke-dasharray/);
    // y runs up the page as in the view: the drawing's (0, 0) is the page's bottom left plus the margin.
    assert.match(svg, /points="5,15 15,15"/);
    assert.equal(toSvg(lines, { hidden: false }).match(/<polyline/g).length, 2);
    const dxf = toDxf(lines);
    assert.match(dxf, /^0\nSECTION\n2\nHEADER\n/);
    assert.ok(dxf.trimEnd().endsWith('0\nEOF'));
    assert.equal(dxf.match(/\nLINE\n/g).length, 1);
    assert.equal(dxf.match(/\nPOLYLINE\n/g).length, 2);
    // The closed curve is one closed polyline of three vertices.
    assert.equal(dxf.match(/\nVERTEX\n/g).length, 3 + 3);
    assert.match(dxf, /POLYLINE\n8\nCURVES\n66\n1\n10\n0\n20\n0\n30\n0\n70\n1\n/);
    assert.match(dxf, /LAYER\n2\nHIDDEN\n70\n0\n62\n8\n6\nDASHED/);
});
