// Move Face in the browser build: flat faces moved with G, only the move across them counting.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { box, boolean, loadKernel, volume } from '../src/Kernel.js';
import { faceSurfaces } from '../src/faceSurfaces.js';

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

test('a move along the face alone does nothing, and turning several faces is for the desktop', async () => {
    const { be, seed, top } = setup();
    const same = await be.previewMoveFaces({ body: seed.id, faces: [top], offset: [5, 0, 0] });
    assert.ok(Math.abs(same.volume - seed.volume) < 1e-6);
    await assert.rejects(async () => be.commitMoveFaces({ body: seed.id, faces: [top], offset: [5, 0, 0] }), /nothing/);
    await assert.rejects(async () => be.previewMoveFaces({ body: seed.id, faces: [top, 0], angle: 0.2, axis: [0, 0, 1] }), /desktop/);
});

test('a top turned about an edge leans, and its sides follow, either way', async () => {
    const { be, seed, top } = setup();
    const a = 10 * Math.PI / 180, wedge = 0.5 * 80 * 80 * Math.tan(a) * 50;
    // About its edge at x = 40: the far end rises, or drops.
    const up = await be.previewMoveFaces({ body: seed.id, faces: [top], pivot: [40, 30, 0], axis: [0, 0, 1], angle: -a });
    assert.ok(Math.abs(up.volume - (seed.volume + wedge)) < 1e-3, `${up.volume}`);
    const down = await be.previewMoveFaces({ body: seed.id, faces: [top], pivot: [40, 30, 0], axis: [0, 0, 1], angle: a });
    assert.ok(Math.abs(down.volume - (seed.volume - wedge)) < 1e-3, `${down.volume}`);
    // Turned and moved up 5 at once.
    const both = await be.previewMoveFaces({ body: seed.id, faces: [top], pivot: [40, 30, 0], axis: [0, 0, 1], angle: -a, offset: [0, 5, 0] });
    assert.ok(Math.abs(both.volume - (seed.volume + wedge + 80 * 5 * 50)) < 1e-3, `${both.volume}`);
    await be.commitMoveFaces({ body: seed.id, faces: [top], pivot: [40, 30, 0], axis: [0, 0, 1], angle: -a });
    assert.equal(be.scene()[0].facePlanes.length, 6);
});

test('a tread turned up against its riser stops at the riser', async () => {
    const { be, seed } = setup();
    // A step: the block with a second block standing on its left half.
    be.shapes.set(seed.id, boolean(be.shapes.get(seed.id), box({ x: -40, y: 30, z: -25 }, { x: 0, y: 60, z: 25 }), 'union'));
    const v0 = volume(be.shapes.get(seed.id));
    const tread = faceSurfaces(be.shapes.get(seed.id)).findIndex(f => f.kind === 'plane' && f.normal[1] > 0.999 && Math.abs(f.origin[1] - 30) < 1e-6);
    assert.ok(tread >= 0);
    const a = 10 * Math.PI / 180;
    const b = await be.previewMoveFaces({ body: seed.id, faces: [tread], pivot: [40, 30, 0], axis: [0, 0, 1], angle: -a });
    // The tread's wedge, 40 long, beside the riser.
    assert.ok(Math.abs(b.volume - (v0 + 0.5 * 40 * 40 * Math.tan(a) * 50)) < 1e-3, `${b.volume}`);
});
