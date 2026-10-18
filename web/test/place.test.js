// Place in the browser build. The desktop's tests are crates/w3d-kernel/tests/place.rs.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { bounds, loadKernel, volume } from '../src/Kernel.js';
import { LocalBackend } from '../src/app/LocalBackend.js';

before(async () => { await loadKernel() });

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
/** The seed block (80 × 30 × 50, id 1) and a 10 mm cube standing beside it. */
async function scene() {
    const be = new LocalBackend();
    const seed = be.scene()[0].id;
    const { id: cube } = await be.commitPrimitive({ kind: 'box', frame: { origin: [100, 0, 0], x: [1, 0, 0], normal: [0, 1, 0] }, width: 10, depth: 10, height: 10 });
    return { be, seed, cube };
}
const pivot = [105, 0, -5]; // the cube's base centre

test('a copy lands turned and scaled', async () => {
    const { be, cube } = await scene();
    const motion = { pivot, offset: [50 - 105, 0, 50 + 5], axis: [0, 1, 0], angle: Math.PI / 2, scale: 2 };
    const { ids } = await be.commitPlace({ bodies: [cube], motion });
    assert.equal(ids.length, 1);
    const s = be.shapes.get(ids[0]);
    close(volume(s), 8000);
    const b = bounds(s);
    close(b.min.x, 40, 1e-3); close(b.max.x, 60, 1e-3); close(b.min.y, 0, 1e-3); close(b.max.y, 20, 1e-3); close(b.min.z, 40, 1e-3); close(b.max.z, 60, 1e-3);
    assert.ok(be.shapes.has(cube), 'the original stays');
    be.undo();
    assert.ok(!be.shapes.has(ids[0]), 'one undo step');
});

test('a copy cuts the body it lands on, and a slice leaves the piece', async () => {
    const { be, seed, cube } = await scene();
    const before = volume(be.shapes.get(seed));
    // Half sunk into the seed's top (y = 30).
    const motion = { pivot, offset: [-105, 25, 5], axis: [0, 1, 0], angle: 0 };
    const preview = await be.previewPlace({ bodies: [cube], motion, target: seed, op: 'difference' });
    assert.equal(preview.tools.length, 1);
    assert.ok(preview.result);
    const { ids } = await be.commitPlace({ bodies: [cube], motion, target: seed, op: 'difference' });
    assert.deepEqual(ids, [seed]);
    close(before - volume(be.shapes.get(seed)), 500, 1e-3);
    const sliced = await be.commitPlace({ bodies: [cube], motion: { ...motion, offset: [-85, 25, 5] }, target: seed, op: 'slice' });
    assert.equal(sliced.ids.length, 2);
    close(volume(be.shapes.get(sliced.ids[1])), 500, 1e-3);
});

test('bad placements are refused', async () => {
    const { be, seed, cube } = await scene();
    const motion = { pivot, offset: [1, 0, 0], axis: [0, 1, 0], angle: 0 };
    await assert.rejects(be.commitPlace({ bodies: [cube], motion: { ...motion, scale: 0 } }), /above zero/);
    await assert.rejects(be.commitPlace({ bodies: [seed], motion, target: seed, op: 'union' }), /another body/);
    await assert.rejects(be.commitPlace({ bodies: [cube], motion: { ...motion, offset: [0, 500, 0] }, target: seed, op: 'difference' }), /does not meet/);
});
