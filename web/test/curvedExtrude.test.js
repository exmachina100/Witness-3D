import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { loadKernel } from '../src/Kernel.js';
import { LocalBackend } from '../src/app/LocalBackend.js';

before(async () => { await loadKernel() });

test('Extrude pulls a curved face out along a direction and joins it to its body', async () => {
    const be = new LocalBackend({ seed: 'enclosure' });
    const { id } = await be.commitPrimitive({ kind: 'cylinder', frame: { origin: [100, 0, 0], x: [1, 0, 0], normal: [0, 1, 0] }, radius: 5, height: 10, op: 'new' });
    const body = (await be.scene()).find(b => b.id === id);
    const side = body.facePlanes.findIndex(p => !p);
    assert.ok(side >= 0, 'the cylinder has a curved side');
    const before = body.volume;
    const r = await be.commit({ target: id, face: side, faces: [], distance: 3, op: 'auto', back: 0, angle: 0, thickness: 0, direction: [1, 0, 0] });
    const after = r.scene.find(b => b.id === r.id);
    assert.equal(r.id, id, 'joined to its own body');
    assert.ok(after.volume > before + 1, `${before} -> ${after.volume}`);
});
