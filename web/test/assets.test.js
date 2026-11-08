// Mark as Asset (outliner) and P-Menu › Insert Asset in the browser build: a body kept in a library
// outside the file and put back into any document as a new body.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { loadKernel, volume } from '../src/Kernel.js';

before(async () => { await loadKernel() });

test('an asset kept from one document is inserted into another as a new body, then deleted', async () => {
    const a = new LocalBackend({ seed: 'enclosure' });
    const id = a.bodies()[0].id, v = volume(a.shapes.get(id));
    await a.markAsset({ id, name: 'HOUSING' });
    const b = new LocalBackend({ seed: 'enclosure' });
    b.assetMap = a.assetMap; // one library for the app, whichever document is open
    assert.deepEqual(await b.listAssets(), ['HOUSING']);
    const before = b.bodies().length;
    const { id: added, scene } = await b.insertAsset({ name: 'HOUSING' });
    assert.equal(scene.length, before + 1);
    assert.ok(Math.abs(volume(b.shapes.get(added)) - v) < 1e-3 * v);
    await b.deleteAsset({ name: 'HOUSING' });
    assert.deepEqual(await b.listAssets(), []);
    await assert.rejects(b.insertAsset({ name: 'HOUSING' }), /no longer in the library/);
});
