import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { loadKernel } from '../src/Kernel.js';
import { LocalBackend } from '../src/app/LocalBackend.js';

before(async () => { await loadKernel() });

test('a new document starts with a 50 mm cube on the ground', () => {
    const [b] = new LocalBackend().scene();
    assert.ok(Math.abs(b.volume - 125000) < 1e-3, `volume ${b.volume}`);
});
