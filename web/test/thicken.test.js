// Thicken (Plasticity's Thicken) in the browser build: a sheet made solid, front along its
// normals and back behind them. The desktop's tests are crates/w3d-kernel/tests/thicken.rs.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { bounds, loadKernel, volume } from '../src/Kernel.js';
import { isSheet } from '../src/Patch.js';
import { thicken } from '../src/Thicken.js';

before(async () => { await loadKernel() });

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
/** A circle of radius 3 on the ground, patched into a disc sheet body. */
async function disc(be) {
    const { ids: [ring] } = await be.addCurves([{ origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'circle', center: [0, 0], radius: 3 }]);
    const { id } = await be.commitPatch({ curves: [ring], edges: [] });
    return id;
}

test('a disc thickens into a puck, front and back', async () => {
    const be = new LocalBackend();
    const sheet = await disc(be);
    const puck = await be.previewThicken({ body: sheet, front: 2, back: 0 });
    assert.equal(puck.sheet, false);
    close(puck.volume, Math.PI * 9 * 2, 0.01);
    const s = be.thickenResult({ body: sheet, front: 1.5, back: 0.5 });
    close(volume(s), Math.PI * 9 * 2, 0.01);
    const b = bounds(s);
    close(b.max.y - b.min.y, 2);
    assert.ok(Math.abs(b.max.y - 1.5) < 1e-6 || Math.abs(b.min.y + 1.5) < 1e-6, `${b.min.y}..${b.max.y}`);
});

test('the sheet body turns solid in one undo step and keeps its id', async () => {
    const be = new LocalBackend();
    const sheet = await disc(be);
    const { id, scene } = await be.commitThicken({ body: sheet, front: 1 });
    assert.equal(id, sheet);
    assert.equal(scene.find(b => b.id === id).sheet, false);
    await be.undo();
    assert.ok(isSheet(be.shapes.get(sheet)));
});

test('solids and no thickness are refused', async () => {
    const be = new LocalBackend();
    const seed = be.scene()[0];
    await assert.rejects(be.previewThicken({ body: seed.id, front: 1 }), /already solid/);
    const sheet = await disc(be);
    assert.throws(() => thicken(be.shapes.get(sheet), 0, 0), /needs a thickness/);
    assert.throws(() => thicken(be.shapes.get(sheet), -1, 0), /below zero/);
});
