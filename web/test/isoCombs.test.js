import test from 'node:test';
import assert from 'node:assert/strict';
import { isoLines, combTeeth, onFace } from '../src/isoCombs.js';

test('isoparams run both ways across the face', () => {
    const lines = isoLines(3, 10);
    assert.equal(lines.length, 6);
    assert.deepEqual(lines[0][0], [0, 0.5 / 3, 0]);
    assert.deepEqual(lines[0][10], [1, 0.5 / 3, 0]);
    assert.deepEqual(lines[3][4], [0.5 / 3, 0.4, 0]);
});

test('comb teeth on a circle are 1 / radius and stand outward; a line has none', () => {
    const r = 8, pts = Array.from({ length: 40 }, (_, i) => { const a = i * 0.05; return [3 + r * Math.cos(a), r * Math.sin(a), 2 + 0.5 * 0]; });
    const teeth = combTeeth(pts);
    for (const t of teeth.slice(1, -1)) {
        assert.ok(Math.abs(t.k - 1 / r) < 1e-9);
        const out = [t.at[0] - 3, t.at[1], 0].map(v => v / r);
        assert.ok(Math.hypot(...t.dir.map((v, i) => v - out[i])) < 1e-9);
    }
    assert.equal(teeth[0].k, teeth[1].k);
    assert.ok(combTeeth([[0, 0, 0], [1, 1, 1], [2, 2, 2], [3, 3, 3]]).every(t => t.k === 0));
});

test('a run is cut where the face has a hole', () => {
    // A 10 × 10 square with a 4 × 4 hole in the middle, as eight triangles round the hole.
    const P = (x, y) => [x, y, 0];
    const ring = [[0, 0], [10, 0], [10, 10], [0, 10]].map(([x, y]) => P(x, y)), hole = [[3, 3], [7, 3], [7, 7], [3, 7]].map(([x, y]) => P(x, y));
    const tris = [];
    for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        tris.push([ring[i], ring[j], hole[j]], [ring[i], hole[j], hole[i]]);
    }
    const line = Array.from({ length: 101 }, (_, i) => P(i / 10, 5));
    const runs = onFace(line, tris, 0.01);
    assert.equal(runs.length, 2);
    assert.deepEqual(runs[0].at(-1), P(3, 5));
    assert.deepEqual(runs[1][0], P(7, 5));
    // Off the surface by more than the tolerance: nothing.
    assert.equal(onFace(line.map(([x, y]) => [x, y, 0.5]), tris, 0.01).length, 0);
});
