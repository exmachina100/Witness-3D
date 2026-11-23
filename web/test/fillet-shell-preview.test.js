import assert from 'node:assert/strict';
import { test } from 'node:test';
import { box, filletShell, loadKernel, shellFaces, volume } from '../src/Kernel.js';
import { LocalBackend } from '../src/app/LocalBackend.js';

test('Fillet Shell preview forwards only the shape to the viewport body builder', async () => {
    const request = { body: 7 };
    const shape = {};
    const history = {};
    const preview = {};
    const backend = Object.create(LocalBackend.prototype);
    backend.latest = work => work();
    backend.filletShell = options => {
        assert.equal(options, request);
        return { shape, history };
    };
    backend.body = (id, result) => {
        assert.equal(id, request.body);
        assert.equal(result, shape);
        return preview;
    };

    assert.equal(await backend.previewFilletShell(request), preview);
});

test('Fillet Shell starts from the same validated open shell as Shell', async () => {
    await loadKernel();
    const solid = box({ x: 0, y: 0, z: 0 }, { x: 12, y: 12, z: 12 });
    const expected = shellFaces(solid, [0], 1);
    const result = filletShell(solid, [0], [], [], 1, 1);
    assert.ok(volume(result.shape) < volume(solid));
    assert.equal(volume(result.shape), volume(expected.shape));
    assert.deepEqual(result.history, expected.history);
    assert.throws(() => filletShell(solid, [99], [], [], 1, 1), /face in the selection/);
});
