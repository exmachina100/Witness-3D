// Join (for sheets) and Unjoin in the browser build. The desktop's tests are
// crates/w3d-kernel/tests/join.rs.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { count, loadKernel, volume } from '../src/Kernel.js';
import { joinSheets, unjoin } from '../src/Join.js';
import { isSheet } from '../src/Patch.js';

before(async () => { await loadKernel() });

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);


test('the six faces of a block, unjoined then joined, make the block again', async () => {
    const be = new LocalBackend();
    const seed = be.scene()[0];
    const v = volume(be.shapes.get(seed.id));
    const { ids } = await be.commitUnjoin({ body: seed.id, faces: true });
    assert.equal(ids.length, 6);
    assert.equal(ids[0], seed.id);
    assert.ok(ids.every(id => isSheet(be.shapes.get(id))));
    const preview = await be.previewJoinSheets({ bodies: ids });
    assert.equal(preview.sheet, false);
    const { id, scene } = await be.commitJoinSheets({ bodies: ids });
    assert.equal(id, seed.id);
    assert.equal(scene.length, 1);
    close(volume(be.shapes.get(id)), v, 1e-6);
    await be.undo();
    assert.equal(be.scene().length, 6);
    await be.undo();
    assert.equal(be.scene().length, 1);
});

test('two sheets sharing an edge join into one open sheet; sheets apart are refused', () => {
    const be = new LocalBackend();
    const faces = unjoin(be.shapes.get(be.scene()[0].id), true);
    // Two neighbouring faces of the block share one edge.
    let pair = null;
    for (let i = 0; i < faces.length && !pair; i++) for (let j = i + 1; j < faces.length && !pair; j++) {
        try { pair = joinSheets([faces[i], faces[j]]); } catch { /* opposite faces */ }
    }
    assert.ok(pair && isSheet(pair));
    assert.equal(count(pair, 'TopAbs_FACE'), 2);
    // Opposite faces are 30 mm or more apart.
    const apart = faces.find((f, j) => j > 0 && (() => { try { joinSheets([faces[0], f]); return false; } catch { return true; } })());
    assert.throws(() => joinSheets([faces[0], apart]), /edge to edge/);
    assert.throws(() => joinSheets([be.shapes.get(be.scene()[0].id), faces[0]]), /Boolean/);
});

test('a one-piece body has nothing to unjoin into pieces', () => {
    const be = new LocalBackend();
    assert.throws(() => unjoin(be.shapes.get(be.scene()[0].id), false), /all one piece/);
});
