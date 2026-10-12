import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { loadKernel } from '../src/Kernel.js';
import { LocalBackend } from '../src/app/LocalBackend.js';

before(async () => { await loadKernel() });

const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
/** A rectangle drawn on the enclosure's top face (y = 30). */
const topRect = (w, d) => ({ origin: [0, 30, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'polyline', points: [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]], closed: true });

test('a drawn region extrudes with a chosen operation, and undo takes back curve and solid in turn', async () => {
    const be = new LocalBackend();
    const { ids } = await be.addCurves([topRect(20, 10)]);
    assert.deepEqual(be.curves().map(c => c.id), ids);
    const p = await be.preview({ target: 1, region: ids[0], distance: 5 });
    assert.equal(p.outcome, 'join');
    const { scene } = await be.commit({ target: 1, region: ids[0], distance: 5 });
    close(scene[0].volume, 120000 + 1000);
    // W cuts even pulling out: here it takes the boss back off.
    const w = await be.preview({ target: 1, region: ids[0], distance: 5, op: 'difference' });
    assert.equal(w.outcome, 'cut');
    close(w.result.volume, 120000);
    const x = await be.preview({ target: 1, region: ids[0], distance: -10, op: 'intersect' });
    assert.equal(x.outcome, 'intersect');
    close(x.result.volume, 2000);
    await assert.rejects(be.addCurves([{ ...topRect(1, 1), kind: 'circle', center: [0, 0], radius: 0 }]));
    await be.addCurves([{ ...topRect(1, 1), kind: 'polyline', points: [[0, 0], [5, 0]], closed: false }]);
    await assert.rejects(be.preview({ target: 1, region: ids[0] + 1, distance: 5 }), /closed curve/);
    be.undo();
    assert.equal(be.curves().length, 1);
    close(be.undo()[0].volume, 120000);
    be.undo();
    assert.equal(be.curves().length, 0);
});

test('a circle region with an offset centre extrudes where it was drawn', async () => {
    const be = new LocalBackend();
    const { ids } = await be.addCurves([{ ...topRect(1, 1), kind: 'circle', center: [100, 0], radius: 5 }]);
    const { id, scene } = await be.commit({ target: 1, region: ids[0], distance: 4 });
    assert.notEqual(id, 1); // off the body, so a new one
    const b = scene.find(x => x.id === id);
    close(b.volume, Math.PI * 25 * 4, 0.5);
    const xs = []; for (let i = 0; i < b.positions.length; i += 3) xs.push(b.positions[i]);
    close(Math.min(...xs), 95, 0.01);
});

test('a face extrudes along its normal and joins or cuts', async () => {
    const be = new LocalBackend();
    const top = be.scene()[0].facePlanes.findIndex(p => p && p.normal[1] > 0.99);
    let { scene } = await be.commit({ target: 1, face: top, distance: 10 });
    close(scene[0].volume, 80 * 40 * 50);
    const top2 = scene[0].facePlanes.findIndex(p => p && p.normal[1] > 0.99 && p.origin[1] > 39);
    ({ scene } = await be.commit({ target: 1, face: top2, distance: -10 }));
    close(scene[0].volume, 120000);
});

test('boolean changes the target, removes the tools unless kept, and undoes', async () => {
    const be = new LocalBackend();
    const { ids } = await be.duplicateBodies([1]);
    await be.commitMotion({ bodies: ids, offset: [40, 0, 0] });
    close((await be.previewBoolean({ target: 1, tools: ids, op: 'difference' })).volume, 60000);
    let { scene } = await be.commitBoolean({ target: 1, tools: ids, op: 'difference' });
    assert.equal(scene.length, 1);
    close(scene[0].volume, 60000);
    assert.equal(scene[0].faceRefs.length, scene[0].facePlanes.length);
    be.undo();
    ({ scene } = await be.commitBoolean({ target: 1, tools: ids, op: 'intersect', keepTools: true }));
    assert.equal(scene.length, 2);
    close(scene[0].volume, 60000);
    await assert.rejects(be.commitBoolean({ target: 1, tools: [1], op: 'union' }));
    await be.deleteItems([ids[0]], []);
    assert.equal(be.scene().length, 1);
});
