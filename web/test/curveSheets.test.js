import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { loadKernel } from '../src/Kernel.js';
import { LocalBackend } from '../src/app/LocalBackend.js';

before(async () => { await loadKernel() });

// An open line 10 mm off the y axis, 20 long, in the XY plane; and a path straight along z.
const line = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1], kind: 'polyline', points: [[10, 0], [10, 20]], closed: false };
const along = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'polyline', points: [[10, 0], [10, 30]], closed: false };

test('Revolve turns an open curve into a sheet, a new body', async () => {
    const be = new LocalBackend({ seed: 'enclosure' });
    const { ids: [c] } = await be.addCurves([line]);
    const { id, scene } = await be.commitForm({ target: null, regions: [c], kind: 'revolve', axisPoint: [0, 0, 0], axisDir: [0, 1, 0], angle: 2 * Math.PI, op: 'new' });
    const b = scene.find(x => x.id === id);
    assert.ok(b.sheet, 'a sheet');
    assert.equal(scene.length, 2);
    await assert.rejects(be.commitForm({ target: 1, regions: [c], kind: 'revolve', axisPoint: [0, 0, 0], axisDir: [0, 1, 0], angle: 1, op: 'union' }), /sheet/);
});

test('Sweep carries an open curve along a path into a sheet', async () => {
    const be = new LocalBackend({ seed: 'enclosure' });
    const { ids: [c, p] } = await be.addCurves([line, along]);
    const { id, scene } = await be.commitForm({ target: null, regions: [c], kind: 'sweep', path: p, op: 'new' });
    const b = scene.find(x => x.id === id);
    assert.ok(b.sheet, 'a sheet');
    assert.equal(b.facePlanes.length, 1);
});

test('Extrude draws curves out into sheets, one body each, in one undo step', async () => {
    const be = new LocalBackend({ seed: 'enclosure' });
    const { ids: [c, p] } = await be.addCurves([line, along]);
    const pv = await be.preview({ curves: [c, p], direction: [0, 0, 1], distance: 5, back: 5 });
    assert.equal(pv.outcome, 'new');
    assert.equal(pv.more.length, 1);
    const { id, scene } = await be.commit({ curves: [c, p], direction: [0, 0, 1], distance: 5, back: 5 });
    assert.equal(scene.length, 3);
    const b = scene.find(x => x.id === id);
    assert.ok(b.sheet, 'a sheet');
    // The line drawn 10 along z: one flat face 20 × 10, from z -5 to 5.
    const first = scene.find(x => x.id === id - 1);
    assert.equal(first.facePlanes.length, 1);
    const zs = []; for (let i = 2; i < first.positions.length; i += 3) zs.push(first.positions[i]);
    assert.ok(Math.abs(Math.min(...zs) + 5) < 1e-6 && Math.abs(Math.max(...zs) - 5) < 1e-6, `${Math.min(...zs)} ${Math.max(...zs)}`);
    assert.equal((await be.undo()).length, 1);
    await assert.rejects(be.commit({ curves: [c], direction: [0, 0, 1], distance: 5, op: 'union' }), /sheet/);
});
