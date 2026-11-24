import test from 'node:test';
import assert from 'node:assert/strict';
import { square, surfaceAt } from '../src/square.js';
import { throughGuides, resample } from '../src/profileGuides.js';

const line = (a, b, n = 9) => Array.from({ length: n }, (_, i) => a.map((x, k) => x + (b[k] - x) * i / (n - 1)));
const sides = [line([0, 0, 0], [100, 0, 0]), line([100, 0, 0], [100, 0, 100]), line([100, 0, 100], [0, 0, 100]), line([0, 0, 100], [0, 0, 0])];
// An arch across the middle, 15 mm up, its ends on the sides.
const arch = Array.from({ length: 21 }, (_, i) => [5 + 90 * i / 20, 15 * Math.sin(Math.PI * i / 20), 50]);

test('a flat fill bends through a guide curve and keeps its sides', () => {
    const flat = square(sides, { spans: [6, 6] });
    const { surface, miss } = throughGuides(flat, [arch]);
    assert.ok(miss < 0.5, `guide missed by ${miss}`);
    // The sides do not move.
    for (const t of [0, 0.3, 0.7, 1]) {
        assert.ok(Math.abs(surfaceAt(surface, t, 0)[1]) < 1e-9);
        assert.ok(Math.abs(surfaceAt(surface, 0, t)[1]) < 1e-9);
    }
    assert.ok(surfaceAt(surface, 0.5, 0.5)[1] > 10);
});

test('G1 rows stay and a sheet with no inner points refuses', () => {
    const g1 = square(sides, { spans: [6, 6] });
    const before = g1.poles[1][3].slice();
    const { surface } = throughGuides(g1, [arch], { held: 2 });
    assert.deepEqual(surface.poles[1][3], before);
    const tiny = square(sides, { spans: [1, 1], degree: 1 });
    assert.throws(() => throughGuides(tiny, [arch]), /no inner control points/);
});

test('resample spaces points evenly', () => {
    const r = resample([[0, 0, 0], [1, 0, 0], [3, 0, 0]], 4);
    assert.deepEqual(r.map(p => +p[0].toFixed(6)), [0, 1, 2, 3]);
});

test('fitThroughGuides adds spans until the guide is met', async () => {
    const { fitThroughGuides } = await import('../src/profileGuides.js');
    const fit = fitThroughGuides(s => square(sides, { spans: s || [1, 1] }), [arch], { tolerance: 0.05 });
    assert.ok(fit.guideMiss <= 0.05, `missed by ${fit.guideMiss}`);
    assert.ok(fit.spans[0] >= 2);
});
