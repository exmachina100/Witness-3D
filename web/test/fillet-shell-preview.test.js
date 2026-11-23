import assert from 'node:assert/strict';
import { test } from 'node:test';
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
