// Extrude's Freestyle (F) and Individual (I) in the browser build. The desktop's tests are
// crates/w3d-kernel/tests/extrude_options.rs; these mirror them.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as THREE from 'three';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { box, facePlane, loadKernel, tessellate, volume } from '../src/Kernel.js';

before(async () => { await loadKernel() });

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
function bounds(shape) {
    const { mesh } = tessellate(shape, { deflection: 0.001 });
    return new THREE.Box3().setFromBufferAttribute(mesh.getAttribute('position'));
}
/** A backend holding a 20 mm cube from the origin, and the face of it facing `n`. */
function cube() {
    const be = new LocalBackend();
    be.shapes.clear();
    be.put(1, box(new THREE.Vector3(0, 0, 0), new THREE.Vector3(20, 20, 20)));
    const face = n => { for (let i = 0; i < 6; i++) if (facePlane(be.shapes.get(1), i).normal.dot(n) > 0.99) return i; };
    return { be, face };
}

test('freestyle leans a region extrude along its direction', async () => {
    const be = new LocalBackend();
    const { ids: [sq] } = await be.addCurves([{ origin: [0, 0, 50], x: [1, 0, 0], normal: [0, 0, 1], kind: 'polyline', points: [[-5, -5], [5, -5], [5, 5], [-5, 5]], closed: true }]);
    const { r } = await be.run({ region: sq, distance: 10, direction: [1, 0, 1], op: 'new' });
    const h = 10 / Math.SQRT2;
    close(volume(r.shape), 100 * h, 1e-6);
    const b = bounds(r.shape);
    close(b.max.z - 50, h);
    close(b.max.x, 5 + h);
});

test('freestyle into the body cuts', async () => {
    const { be, face } = cube();
    const top = face(new THREE.Vector3(0, 0, 1));
    const { r, outcome } = await be.run({ target: 1, face: top, distance: 5, direction: [0.5, 0, -1] });
    assert.equal(outcome, 'cut');
    assert.ok(volume(r.shape) < 8000 - 1);
});

test('individual takes each face along its own normal; direct refuses a face along it', async () => {
    const { be, face } = cube();
    const top = face(new THREE.Vector3(0, 0, 1)), side = face(new THREE.Vector3(1, 0, 0));
    const { r } = await be.run({ target: 1, face: top, faces: [side], individual: true, distance: 5 });
    close(volume(r.shape), 8000 + 2 * 400 * 5, 1e-3);
    const b = bounds(r.shape);
    close(b.max.z, 25);
    close(b.max.x, 25);
    await assert.rejects(be.run({ target: 1, face: top, faces: [side], distance: 5 }), /Individual/);
});
