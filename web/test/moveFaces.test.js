// Move Face in the browser build: flat faces moved with G, only the move across them counting.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { loadKernel } from '../src/Kernel.js';

before(async () => { await loadKernel() });

// The seed block is x −40..40, y 0..30, z −25..25.
const setup = () => {
    const be = new LocalBackend();
    const seed = be.scene()[0];
    const top = seed.facePlanes.findIndex(p => p && p.normal[1] > 0.999);
    return { be, seed, top };
};

test('a top moved up and along itself makes the block taller', async () => {
    const { be, seed, top } = setup();
    const b = await be.previewMoveFaces({ body: seed.id, faces: [top], offset: [7, 10, -3] });
    assert.ok(Math.abs(b.volume - 80 * 40 * 50) < 1e-3, `${b.volume}`);
    await be.commitMoveFaces({ body: seed.id, faces: [top], offset: [0, -10, 0] });
    assert.ok(Math.abs(be.scene()[0].volume - 80 * 20 * 50) < 1e-3);
});

test('a move along the face alone does nothing, and turning is for the desktop', async () => {
    const { be, seed, top } = setup();
    const same = await be.previewMoveFaces({ body: seed.id, faces: [top], offset: [5, 0, 0] });
    assert.ok(Math.abs(same.volume - seed.volume) < 1e-6);
    await assert.rejects(async () => be.commitMoveFaces({ body: seed.id, faces: [top], offset: [5, 0, 0] }), /nothing/);
    await assert.rejects(async () => be.previewMoveFaces({ body: seed.id, faces: [top], angle: 0.2, axis: [0, 0, 1] }), /desktop/);
});
