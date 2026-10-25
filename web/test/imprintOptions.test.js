// Imprint Curve Body's options: Normal or Vector, Bidirectional, Hide Occlusion and Completion.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { count, loadKernel } from '../src/Kernel.js';

before(async () => { await loadKernel() });

// The seed block is x −40..40, y 0..30; lines are drawn 10 mm above it, facing up.
const setup = async points => {
    const be = new LocalBackend();
    const seed = be.scene()[0];
    const { ids: [line] } = await be.addCurves([{ origin: [0, 40, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'polyline', points, closed: false }]);
    return { be, seed, line };
};
const across = [[10, -100], [10, 100]];

test('Normal goes forwards only unless Bidirectional', async () => {
    const { be, seed, line } = await setup(across);
    await assert.rejects(async () => be.previewImprint({ body: seed.id, curves: [line], projection: {} }), /miss/);
    const b = await be.previewImprint({ body: seed.id, curves: [line], projection: { both: true } });
    assert.equal(b.facePlanes.length, seed.facePlanes.length + 4, 'top, bottom, front and back split');
});

test('Vector with Hide Occlusion imprints only what is seen', async () => {
    const { be, seed, line } = await setup(across);
    const down = { dir: [0, -1, 0], both: true };
    assert.equal((await be.previewImprint({ body: seed.id, curves: [line], projection: down })).facePlanes.length, seed.facePlanes.length + 4);
    await be.commitImprint({ body: seed.id, curves: [line], projection: { ...down, hide: true } });
    assert.equal(be.scene()[0].facePlanes.length, seed.facePlanes.length + 1, 'only the top is split');
});

test('Completion Edge carries a short curve on across its face', async () => {
    const { be, seed, line } = await setup([[-10, 0], [10, 0]]);
    const down = { dir: [0, -1, 0], both: true, hide: true };
    const edges = count(be.shapes.get(seed.id), 'TopAbs_EDGE');
    const none = be.imprintResult({ body: seed.id, curves: [line], projection: down });
    assert.equal(count(none.shape, 'TopAbs_FACE'), seed.facePlanes.length, 'None leaves the edge inside the face');
    assert.ok(count(none.shape, 'TopAbs_EDGE') > edges);
    await be.commitImprint({ body: seed.id, curves: [line], projection: { ...down, complete: true } });
    assert.equal(be.scene()[0].facePlanes.length, seed.facePlanes.length + 1, 'Edge splits the top in two');
});

test('Hide Occlusion leaves flat faces seen edge-on alone', async () => {
    // Drawn on the top itself, carried on past its edges and down the sides.
    const be = new LocalBackend();
    const seed = be.scene()[0];
    const { ids: [line] } = await be.addCurves([{ origin: [0, 30, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'polyline', points: [[-10, 0], [10, 0]], closed: false }]);
    await be.commitImprint({ body: seed.id, curves: [line], projection: { dir: [0, -1, 0], both: true, hide: true, complete: true } });
    assert.equal(be.scene()[0].facePlanes.length, seed.facePlanes.length + 1);
});
