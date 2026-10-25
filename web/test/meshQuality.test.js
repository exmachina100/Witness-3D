// Preferences › Performance › CPU facet quality in the browser build: finer or coarser facets.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { loadKernel } from '../src/Kernel.js';
import { LocalBackend } from '../src/app/LocalBackend.js';

before(async () => { await loadKernel() });

test('a higher facet quality tessellates curved bodies finer', async () => {
    const be = new LocalBackend();
    const { id } = await be.commitPrimitive({ kind: 'cylinder', frame: { origin: [100, 0, 0], x: [1, 0, 0], normal: [0, 1, 0] }, radius: 20, height: 10 });
    const tris = list => list.find(b => b.id === id).indices.length / 3;
    const plain = tris(be.bodies());
    const fine = tris(await be.setMeshQuality(4));
    const coarse = tris(await be.setMeshQuality(0.25));
    assert.ok(fine > plain && plain > coarse, `${coarse} < ${plain} < ${fine}`);
    await assert.rejects(be.setMeshQuality(10));
});
