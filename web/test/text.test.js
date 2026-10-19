// Text (text.js): TrueType glyphs read and laid out as closed NURBS curves.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { nurbsPoints } from '../src/curves.js';
import { contourNurbs, FONTS, parseFont, textShapes } from '../src/text.js';

const font = file => parseFont(readFileSync(new URL(`../src/fonts/${file}`, import.meta.url)));

test('every bundled font reads, with letters that have outlines', () => {
    for (const [, file] of FONTS) {
        const f = font(file);
        assert.ok(f.unitsPerEm >= 256, file);
        const A = f.glyph('A'.codePointAt(0)), space = f.glyph(32);
        assert.ok(A.contours.length >= 1 && A.advance > 0, file);
        assert.equal(space.contours.length, 0);
        assert.ok(space.advance > 0);
        // An o has a hole: two contours.
        assert.equal(f.glyph('o'.codePointAt(0)).contours.length, 2, file);
    }
});

test("a contour's NURBS passes through its on-curve points and closes", () => {
    // A square with one rounded corner: on, on, off (corner control), on.
    const c = [{ x: 0, y: 0, on: true }, { x: 10, y: 0, on: true }, { x: 10, y: 10, on: false }, { x: 0, y: 10, on: true }];
    const n = contourNurbs(c);
    assert.equal(n.degree, 2);
    assert.deepEqual(n.poles[0], n.poles.at(-1));
    assert.equal(n.knots.length, n.poles.length + 3);
    const pts = nurbsPoints(n, 8);
    for (const q of [[0, 0], [10, 0], [0, 10]]) assert.ok(pts.some(p => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-9), `${q}`);
    // The straight bottom stays straight.
    assert.ok(pts.filter(p => p[0] > 0 && p[0] < 10 && Math.abs(p[1]) < 1e-9).length > 3);
});

test('text lays out along the line at the size asked, lines going down', () => {
    const f = font('JetBrainsMono-Regular.ttf');
    const one = textShapes(f, 'HI', 10);
    const adv = f.glyph('H'.codePointAt(0)).advance * 10 / f.unitsPerEm;
    assert.ok(Math.abs(one.width - 2 * adv) < 1e-9);
    const xs = one.shapes.flatMap(s => s.poles.map(p => p[0])), ys = one.shapes.flatMap(s => s.poles.map(p => p[1]));
    assert.ok(Math.min(...xs) >= -1e-9 && Math.max(...xs) <= one.width + 1e-9);
    // Capitals stand on the baseline and reach about 0.7 of the em.
    assert.ok(Math.abs(Math.min(...ys)) < 1e-9 && Math.max(...ys) > 6 && Math.max(...ys) < 8.5);
    const two = textShapes(f, 'H\nH', 10, 'center');
    const ys2 = two.shapes.flatMap(s => s.poles.map(p => p[1]));
    assert.ok(Math.min(...ys2) < -9);
    const xs2 = two.shapes.flatMap(s => s.poles.map(p => p[0]));
    assert.ok(Math.abs(Math.min(...xs2) + Math.max(...xs2)) < 1);
});
