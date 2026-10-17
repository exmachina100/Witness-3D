// Project Outline (Plasticity's Project with one body and no curves) in the browser build: the
// body's outline as seen along the plane's normal, laid on the plane. The desktop's tests are
// crates/w3d-kernel/tests/outline.rs.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as THREE from 'three';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { boolean, box, loadKernel, primitive } from '../src/Kernel.js';
import { projectOutline } from '../src/Outline.js';
import { nurbsPoints } from '../src/curves.js';

before(async () => { await loadKernel() });

const Z = new THREE.Vector3(0, 0, 1), X = new THREE.Vector3(1, 0, 0), O = new THREE.Vector3();

/** A curve's points in model space. */
function world(c) {
    const n = new THREE.Vector3(...c.normal).normalize(), x = new THREE.Vector3(...c.x), y = n.clone().cross(x), o = new THREE.Vector3(...c.origin);
    return nurbsPoints(c).map(([u, v, h]) => o.clone().addScaledVector(x, u).addScaledVector(y, v).addScaledVector(n, h));
}
/** Whether `p` lies on the rectangle x0..x1 by z0..z1 in the plane y = 0. */
const onRectXZ = (p, [x0, x1, z0, z1]) => Math.abs(p.y) < 1e-6 && p.x > x0 - 1e-6 && p.x < x1 + 1e-6 && p.z > z0 - 1e-6 && p.z < z1 + 1e-6
    && Math.min(Math.abs(p.x - x0), Math.abs(p.x - x1), Math.abs(p.z - z0), Math.abs(p.z - z1)) < 1e-6;

test("the seed block's outline on the ground is its footprint", async () => {
    const be = new LocalBackend();
    const seed = be.scene()[0];
    const out = await be.previewProject({ mode: 'outline', body: seed.id, origin: [0, 0, 0], normal: [0, 1, 0] });
    assert.equal(out.length, 1);
    const pts = world(out[0]);
    const xs = pts.map(p => p.x), zs = pts.map(p => p.z);
    const box2 = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    assert.ok(Math.abs(box2[1] - box2[0] - 80) < 1e-6, `width ${box2[1] - box2[0]}`);
    for (const p of pts) assert.ok(onRectXZ(p, box2), `${p.toArray()} off the footprint`);
});

test("a sphere's outline is its silhouette circle, on a plane well away from it", () => {
    const ball = primitive({ kind: 'sphere', center: [3, 4, 20], radius: 6 });
    const out = projectOutline(ball, new THREE.Vector3(0, 0, -5), Z, X);
    assert.equal(out.length, 1);
    const c = out[0];
    const pts = nurbsPoints(c);
    assert.ok(pts.length > 16);
    for (const [x, y, z] of pts) {
        assert.ok(Math.abs(z + 5) < 1e-6, 'on the plane');
        assert.ok(Math.abs(Math.hypot(x - 3, y - 4) - 6) < 0.01, `radius ${Math.hypot(x - 3, y - 4)}`);
    }
});

test('a hole through a plate gives a second loop; seen edge-on it is hidden', () => {
    const plate = box(new THREE.Vector3(0, 0, 0), new THREE.Vector3(20, 10, 2));
    const pin = primitive({ kind: 'cylinder', frame: { origin: [10, 5, -1], x: [1, 0, 0], normal: [0, 0, 1] }, radius: 2, height: 4 });
    const holed = boolean(plate, pin, 'difference');
    assert.equal(projectOutline(holed, O, Z, X).length, 2);
    // Seen edge-on the hole is hidden: one rectangle.
    assert.equal(projectOutline(holed, O, new THREE.Vector3(0, 1, 0), X).length, 1);
});

test('the outline needs a body', async () => {
    const be = new LocalBackend();
    await assert.rejects(be.previewProject({ mode: 'outline', body: 'nope', origin: [0, 0, 0], normal: [0, 1, 0] }), /no longer exists/);
});
