// Mirror's Cut down mirror plane and Union halves in the browser build (LocalBackend).
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { box, loadKernel, volume } from '../src/Kernel.js';
import { LocalBackend } from '../src/app/LocalBackend.js';

before(async () => { await loadKernel() });

const setup = () => {
    const be = new LocalBackend();
    const id = be.nextId++;
    be.put(id, box({ x: -40, y: 0, z: 0 }, { x: 40, y: 10, z: 10 }));   // corners: x -40..40, volume 8000
    return { be, id };
};
const v = s => Math.round(volume(s) * 1000) / 1000;

test('Cut keeps the half behind the plane and adds its mirror image', async () => {
    const { be, id } = setup();
    const r = await be.commitMirror({ bodies: [id], origin: [20, 0, 0], normal: [1, 0, 0], cut: true });
    assert.equal(r.ids.length, 2);
    assert.equal(v(be.shapes.get(r.ids[0])), 6000);
    assert.equal(v(be.shapes.get(r.ids[1])), 6000);
});

test('Cut with Union fuses the halves; the negative side keeps the other half', async () => {
    let { be, id } = setup();
    let r = await be.commitMirror({ bodies: [id], origin: [20, 0, 0], normal: [1, 0, 0], cut: true, join: true });
    assert.deepEqual(r.ids, [id]);
    assert.equal(v(be.shapes.get(id)), 12000);
    ({ be, id } = setup());
    r = await be.commitMirror({ bodies: [id], origin: [20, 0, 0], normal: [-1, 0, 0], cut: true });
    assert.equal(v(be.shapes.get(id)), 2000);
});
