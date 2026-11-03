// Extrude with several targets in the browser build (Plasticity's Extrude takes 1..N target
// bodies). The desktop's tests are in crates/w3d-kernel/tests/extrude_options.rs; these mirror them.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as THREE from 'three';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { box, count, loadKernel, volume } from '../src/Kernel.js';

before(async () => { await loadKernel() });

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
/** Two 20 mm cubes (x 0..20 and 30..50) and a 50 × 10 region over both at z 20. */
async function twoCubes() {
    const be = new LocalBackend({ seed: 'enclosure' });
    be.shapes.clear();
    be.put(1, box(new THREE.Vector3(0, 0, 0), new THREE.Vector3(20, 20, 20)));
    be.put(2, box(new THREE.Vector3(30, 0, 0), new THREE.Vector3(50, 20, 20)));
    be.nextId = 3;
    const { ids: [sq] } = await be.addCurves([{ origin: [25, 10, 20], x: [1, 0, 0], normal: [0, 0, 1], kind: 'polyline', points: [[-25, -5], [25, -5], [25, 5], [-25, 5]], closed: true }]);
    return { be, sq };
}

test('an extrude cuts every target it reaches', async () => {
    const { be, sq } = await twoCubes();
    const p = await be.preview({ region: sq, target: 1, targets: [2], distance: -5, op: 'auto' });
    assert.equal(p.outcome, 'cut');
    assert.deepEqual(p.others.map(b => b.id), [2]);
    const { id } = await be.commit({ region: sq, target: 1, targets: [2], distance: -5, op: 'auto' });
    assert.equal(id, 1);
    close(volume(be.shapes.get(1)), 7000);
    close(volume(be.shapes.get(2)), 7000);
    be.undo();
    close(volume(be.shapes.get(2)), 8000);
});

test('an extrude pulled out joins every target into the first', async () => {
    const { be, sq } = await twoCubes();
    const p = await be.preview({ region: sq, target: 1, targets: [2], distance: 5, op: 'auto' });
    assert.deepEqual(p.folded, [2]);
    await be.commit({ region: sq, target: 1, targets: [2], distance: 5, op: 'auto' });
    assert.deepEqual([...be.shapes.keys()], [1]);
    assert.equal(count(be.shapes.get(1), 'TopAbs_SOLID'), 1);
    close(volume(be.shapes.get(1)), 16000 + 50 * 10 * 5);
});

test('a region and a curve extrude together in one step', async () => {
    const be = new LocalBackend({ seed: 'enclosure' });
    be.shapes.clear();
    const { ids: [sq, line] } = await be.addCurves([
        { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1], kind: 'polyline', points: [[-5, -5], [5, -5], [5, 5], [-5, 5]], closed: true },
        { origin: [20, 0, 0], x: [1, 0, 0], normal: [0, 0, 1], kind: 'polyline', points: [[0, 0], [10, 0]], closed: false },
    ]);
    const req = { region: sq, distance: 10, op: 'new', sheets: [line], sheetDirection: [0, 0, 1] };
    const p = await be.preview(req);
    assert.equal(p.more.length, 1);
    await be.commit(req);
    assert.equal(be.shapes.size, 2);
    close(Math.max(...[...be.shapes.values()].map(volume)), 1000);
    be.undo();
    assert.equal(be.shapes.size, 0);
});
