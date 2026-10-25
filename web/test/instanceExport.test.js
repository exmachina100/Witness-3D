// Instances in STEP exports: the master written where the instance stands (LocalBackend.placedShape).
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as THREE from 'three';
import { bounds, exportSTEP, loadKernel } from '../src/Kernel.js';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { motionOf, newInstance } from '../src/app/instances.js';

before(async () => { await loadKernel() });
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('an instance moved, turned and scaled exports where it stands', () => {
    const be = new LocalBackend();
    const id = be.scene()[0].id;
    const box = bounds(be.shapes.get(id)), centre = box.getCenter(new THREE.Vector3());
    const n = { ...newInstance(1, id, centre.toArray()), position: [centre.x + 200, centre.y, centre.z], scale: 0.5,
        quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2).toArray() };
    const placed = bounds(be.placedShape(id, motionOf(n)));
    const size = box.getSize(new THREE.Vector3()), got = placed.getSize(new THREE.Vector3());
    // A quarter turn about y swaps x and z; half the size; centred 200 along x.
    close(got.x, size.z / 2, 1e-3);
    close(got.z, size.x / 2, 1e-3);
    close(got.y, size.y / 2, 1e-3);
    close(placed.getCenter(new THREE.Vector3()).x, centre.x + 200, 1e-3);
    assert.ok(exportSTEP(be.placedShape(id, motionOf(n))).length > 1000);
    // Without a motion it is the body itself.
    assert.equal(be.placedShape(id), be.shapes.get(id));
});

test('a drawing takes instances where they stand', async () => {
    const be = new LocalBackend();
    const id = be.scene()[0].id;
    const centre = bounds(be.shapes.get(id)).getCenter(new THREE.Vector3());
    const n = { ...newInstance(1, id, centre.toArray()), position: [centre.x + 200, centre.y, centre.z] };
    const view = { origin: [0, 0, 0], toward: [0, 0, 1], x: [1, 0, 0] };
    const alone = await be.hiddenLines({ bodies: [id], ...view });
    const both = await be.hiddenLines({ bodies: [id], placed: [{ body: id, motion: motionOf(n) }], ...view });
    const xs = lines => lines.flatMap(l => l.points.filter((_, i) => i % 2 === 0));
    assert.ok(Math.max(...xs(both)) > Math.max(...xs(alone)) + 150, 'the instance is drawn 200 to the right');
});

test('a mirrored instance stands where Mirror puts the copy, and exports there', async () => {
    const { mirroredInstance, matrixOf, checkInstance } = await import('../src/app/instances.js');
    const be = new LocalBackend();
    const id = be.scene()[0].id;
    const box = bounds(be.shapes.get(id)), centre = box.getCenter(new THREE.Vector3());
    const plane = { origin: [box.max.x + 10, 0, 0], normal: [1, 0, 0] };
    const n = mirroredInstance(1, id, plane, centre.toArray());
    assert.deepEqual(checkInstance(n), []);
    assert.deepEqual(checkInstance({ ...n, mirror: { origin: [0, 0, 0], normal: [0, 0, 0] } }), ['mirror']);
    // The master's far corner lands as far beyond the plane.
    const at = matrixOf(n), p = box.min.clone().applyMatrix4(at);
    close(p.x, 2 * (box.max.x + 10) - box.min.x);
    assert.ok(at.determinant() < 0);
    const placed = bounds(be.placedShape(id, motionOf(n), n.mirror));
    close(placed.min.x, box.max.x + 20, 1e-3);
    close(placed.max.x, 2 * (box.max.x + 10) - box.min.x, 1e-3);
});
