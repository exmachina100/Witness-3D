// Square's Refit in the browser build: a one-face sheet is replaced by the fitted one, keeping its
// id, in one undo step.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { loadKernel } from '../src/Kernel.js';

before(async () => { await loadKernel() });

// A bilinear 10 × 10 patch, degree 1 each way, as flat sheet data.
const flat = (z = 0) => [1, 1, 2, 2, 4, 4, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, z, 10, 0, z, 0, 10, z, 10, 10, z];

test('commitSplineSheet with replace keeps the id and count, and undo brings the old sheet back', async () => {
    const b = new LocalBackend({ seed: 'enclosure' });
    const { ids: [sheet] } = await b.commitSplineSheet({ data: flat(0) });
    const count = b.bodies().length;
    const { ids, scene } = await b.commitSplineSheet({ data: flat(5), replace: sheet });
    assert.deepEqual(ids, [sheet]);
    assert.equal(scene.length, count);
    const zs = () => { const p = b.bodies().find(x => x.id === sheet).positions; return Math.max(...p.filter((_, i) => i % 3 === 2)); };
    assert.ok(Math.abs(zs() - 5) < 1e-6, `${zs()}`);
    await b.undo();
    assert.ok(Math.abs(zs()) < 1e-6, 'undo brings the old sheet back');
    await assert.rejects(b.commitSplineSheet({ data: flat(1), replace: 999 }), /no longer exists/);
});
