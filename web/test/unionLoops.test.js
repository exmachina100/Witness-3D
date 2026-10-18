import assert from 'node:assert/strict';
import { test } from 'node:test';
import { samples, unionLoops } from '../src/curveEdit.js';

const plane = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0] };
const area = pts => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
const square = (x, y, w) => ({ ...plane, kind: 'polyline', points: [[x, y], [x + w, y], [x + w, y + w], [x, y + w]], closed: true });

test('two overlapping squares combine into one outline', () => {
    const out = unionLoops([square(0, 0, 10), square(5, 5, 10)]);
    assert.equal(out.length, 1);
    assert.equal(out[0].kind, 'polyline');
    assert.equal(out[0].points.length, 8);
    assert.ok(Math.abs(area(out[0].points) - 175) < 1e-9);
});

test('overlapping circles combine into two exact arcs; apart or inside they stay or go', () => {
    const circle = (x, r) => ({ ...plane, kind: 'circle', center: [x, 0], radius: r });
    const out = unionLoops([circle(0, 5), circle(6, 5)]);
    assert.equal(out.length, 1);
    assert.deepEqual(out[0].pieces.map(p => p.kind), ['arc', 'arc']);
    // Two discs of radius 5, 6 apart: 2 × 25π minus the lens.
    const d = 6, r = 5, lens = 2 * r * r * Math.acos(d / (2 * r)) - (d / 2) * Math.sqrt(4 * r * r - d * d);
    const a = area(samples(out[0], 2000).points);
    assert.ok(Math.abs(a - (2 * Math.PI * 25 - lens)) < 0.05, `area ${a}`);
    assert.equal(unionLoops([circle(0, 2), circle(10, 2)]).length, 2);
    assert.equal(unionLoops([circle(0, 5), circle(1, 1)]).length, 1);
});

test('a ring of offsets keeps its hole as a loop of its own', () => {
    // Four bars round a square leave a hole in the middle.
    const bar = (x, y, w, h) => ({ ...plane, kind: 'polyline', points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], closed: true });
    const out = unionLoops([bar(0, 0, 30, 5), bar(25, 0, 5, 30), bar(0, 25, 30, 5), bar(0, 0, 5, 30)]);
    assert.equal(out.length, 2);
    const areas = out.map(c => area(c.points)).sort((a, b) => a - b);
    assert.deepEqual(areas, [400, 900]);
});

test('an ellipse merged with a circle keeps its smooth part as one spline piece', () => {
    const circle = { ...plane, kind: 'circle', center: [0, 0], radius: 5 };
    const ellipse = { ...plane, kind: 'ellipse', center: [8, 0], major: [6, 0], minor: 3 };
    const out = unionLoops([circle, ellipse]);
    assert.equal(out.length, 1);
    assert.deepEqual(out[0].pieces.map(p => p.kind).sort(), ['arc', 'spline']);
});
