import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridLines } from '../src/gridLines.js';

test('a line every snap step, every tenth one major', () => {
    const g = gridLines(2.5, 10, 50);
    assert.equal(g.spacing, 2.5);
    assert.equal(g.major.length, 2 * 41);
    // x lines at -50, -47.5 … 50; majors at multiples of 25.
    const xs = [];
    for (let i = 0; i < g.major.length; i += 2) xs.push([g.positions[i * 6], g.major[i]]);
    assert.deepEqual(xs.filter(([, m]) => m).map(([x]) => x), [-50, -25, 0, 25, 50]);
});

test('Line every 4 with a 5 mm step puts majors 20 mm apart', () => {
    const g = gridLines(5, 4, 40);
    const majors = [];
    for (let i = 0; i < g.major.length; i += 2) if (g.major[i]) majors.push(g.positions[i * 6]);
    assert.deepEqual(majors, [-40, -20, 0, 20, 40]);
});

test('tiny steps thin out to whole multiples so lines stay on snap points', () => {
    const g = gridLines(0.01, 10, 200, 400);
    assert.ok(g.major.length / 2 <= 801);
    assert.ok(Math.abs(g.spacing / 0.01 - Math.round(g.spacing / 0.01)) < 1e-9);
    assert.equal(gridLines(-1).spacing, 1);
});
