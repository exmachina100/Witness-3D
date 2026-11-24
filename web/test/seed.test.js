import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { loadKernel } from '../src/Kernel.js';
import { LocalBackend } from '../src/app/LocalBackend.js';

before(async () => { await loadKernel() });

test('a new document starts with a 50 mm cube on the ground, one corner at the origin', () => {
    const [b] = new LocalBackend().scene();
    assert.ok(Math.abs(b.volume - 125000) < 1e-3, `volume ${b.volume}`);
    const lo = [0, 1, 2].map(k => Math.min(...b.positions.filter((_, i) => i % 3 === k)));
    const hi = [0, 1, 2].map(k => Math.max(...b.positions.filter((_, i) => i % 3 === k)));
    // Viewport coordinates, y up: user X 0..50, Y 0..50 (viewport -z) and Z 0..50 (viewport y).
    assert.deepEqual([...lo, ...hi].map(v => Math.round(v * 1000) / 1000), [0, 0, -50, 50, 50, 0]);
});
