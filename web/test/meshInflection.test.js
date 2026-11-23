import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { curveFromNurbs } from '../src/curves.js';
import { extrudeCurve } from '../src/Forms.js';
import { hasSurfaceInflection, loadKernel } from '../src/Kernel.js';

before(async () => { await loadKernel(); });

test('opt-in refinement increases mesh density on a curvature reversal and leaves a box unchanged', async () => {
    const backend = new LocalBackend();
    const [id] = backend.shapes.keys();
    const exportMesh = async inflect => (await backend.meshBodies([id], { tolerance: 0.5, angle: 0.4, inflect }))[0];
    assert.equal(hasSurfaceInflection(backend.shapes.get(id)), false);
    assert.deepEqual(await exportMesh(true), await exportMesh(false));

    const curve = curveFromNurbs({
        degree: 3,
        poles: [[0, 0, 0], [10, 0, 12], [20, 0, -12], [30, 0, 0]],
        weights: [1, 1, 1, 1],
        knots: [0, 0, 0, 0, 1, 1, 1, 1],
    }, [0, -1, 0]);
    const sheet = extrudeCurve(curve, [0, 0, 0], [0, 12, 0]);
    backend.shapes.set(id, sheet);
    assert.equal(hasSurfaceInflection(sheet), true);
    const coarse = await exportMesh(false), refined = await exportMesh(true);
    assert.ok(refined.indices.length > coarse.indices.length);
});
