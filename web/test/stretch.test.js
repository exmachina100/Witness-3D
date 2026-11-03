// Plasticity's Scale along X, Y or Z in the browser build. The desktop's tests are crates/w3d-kernel/tests/stretch.rs.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { loadKernel, volume, bounds } from '../src/Kernel.js';
import { LocalBackend } from '../src/app/LocalBackend.js';

before(async () => { await loadKernel() });

test('a block stretched along x about a pivot grows only that way, then moves', async () => {
    // The seed block: x −40..40, y 0..30, z −25..25.
    const be = new LocalBackend({ seed: 'enclosure' });
    const [seed] = be.scene();
    await be.commitStretch({ bodies: [seed.id], pivot: [20, 0, 0], matrix: [2, 0, 0, 0, 1, 0, 0, 0, 1], offset: [0, 1, 0] });
    const s = be.shapes.get(seed.id);
    assert.ok(Math.abs(volume(s) - 240000) < 1, `volume ${volume(s)}`);
    const bb = bounds(s);
    assert.deepEqual([bb.min.x, bb.max.x, bb.min.y, bb.max.y].map(v => Math.round(v * 100) / 100), [-100, 60, 1, 31]);
});

test('the backend stretches bodies as one undo step and refuses flattening them', async () => {
    const be = new LocalBackend({ seed: 'enclosure' });
    const [seed] = be.scene();
    const v0 = seed.volume;
    await assert.rejects(be.commitStretch({ bodies: [seed.id], matrix: [1, 0, 0, 0, 0, 0, 0, 0, 1] }), /greater than zero/);
    const { scene } = await be.commitStretch({ bodies: [seed.id], pivot: [0, 0, 0], matrix: [1, 0, 0, 0, 1.5, 0, 0, 0, 1] });
    assert.ok(Math.abs(scene[0].volume - 1.5 * v0) < 1e-2 * v0 / 1000, `volume ${scene[0].volume}`);
    const back = await be.undo();
    assert.ok(Math.abs(back[0].volume - v0) < 1e-3);
});
