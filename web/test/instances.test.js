import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { newInstance, checkInstance, matrixOf, motionOf } from '../src/app/instances.js';

// The kernels' Motion::apply.
function apply(m, p) {
    const q = new THREE.Vector3(...p).sub(new THREE.Vector3(...m.pivot)).multiplyScalar(m.scale);
    if (m.angle) q.applyAxisAngle(new THREE.Vector3(...m.axis).normalize(), m.angle);
    return q.add(new THREE.Vector3(...m.pivot)).add(new THREE.Vector3(...m.offset));
}

test('a new instance stands on its master', () => {
    const m = newInstance(1, 4, [5, 6, 7]);
    assert.deepEqual(checkInstance(m), []);
    const p = new THREE.Vector3(1, 2, 3).applyMatrix4(matrixOf(m));
    assert.ok(p.distanceTo(new THREE.Vector3(1, 2, 3)) < 1e-12);
    const mo = motionOf(m);
    assert.equal(mo.angle, 0);
    assert.deepEqual(mo.offset, [0, 0, 0]);
});

test('realizing moves the master exactly where the instance is drawn', () => {
    const m = newInstance(2, 1, [10, 0, -4]);
    m.position = [30, 12, 5];
    m.quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 2, -0.5).normalize(), 2.4).toArray();
    m.scale = 1.75;
    const mat = matrixOf(m), mo = motionOf(m);
    for (const p of [[0, 0, 0], [10, 0, -4], [3, -8, 22], [-40, 1, 0.5]]) {
        const drawn = new THREE.Vector3(...p).applyMatrix4(mat);
        assert.ok(drawn.distanceTo(apply(mo, p)) < 1e-9, `${p}`);
    }
    // The pivot lands on the instance's position.
    assert.ok(new THREE.Vector3(10, 0, -4).applyMatrix4(mat).distanceTo(new THREE.Vector3(30, 12, 5)) < 1e-9);
});

test('bad stored instances are caught', () => {
    assert.ok(checkInstance({ ...newInstance(1, 1, [0, 0, 0]), scale: 0 }).includes('scale'));
    assert.ok(checkInstance({ ...newInstance(1, 1, [0, 0, 0]), quaternion: [0, 0, 0, 2] }).includes('turn'));
    assert.ok(checkInstance({ ...newInstance(1, 0, [0, 0, 0]) }).includes('master'));
    assert.ok(checkInstance(null).length > 0);
});
