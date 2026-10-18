import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as THREE from 'three';
import { boolean, box, count, facePlane, loadKernel, volume } from '../src/Kernel.js';
import { LocalBackend } from '../src/app/LocalBackend.js';

before(async () => { await loadKernel() });

const close = (a, b, eps = 0.5) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const v = (x, y, z) => new THREE.Vector3(x, y, z);

test('offset face grow modes past the outer wall, as on the desktop', async () => {
    // A 10 wide, 20 tall block with a 20 long, 5 tall ledge beyond it; its wall over the ledge is at x = 10.
    const step = boolean(box(v(0, 0, 0), v(10, 20, 20)), box(v(10, 0, 0), v(30, 20, 5)), 'union');
    const be = new LocalBackend();
    be.put(1, step);
    const wall = Array.from({ length: count(step, 'TopAbs_FACE') }, (_, j) => j)
        .find(j => { const p = facePlane(step, j); return p && p.normal.x > 0.999 && Math.abs(p.origin.x - 10) < 1e-6 });
    assert.ok(wall !== undefined);
    const grown = (distance, grow) => volume(be.offset({ body: 1, faces: [wall], distance, grow }).shape);
    for (const g of ['moving', 'fixed', 'none']) close(grown(8, g), volume(step) + 8 * 20 * 15);
    close(grown(25, 'fixed'), 30 * 20 * 20);
    close(grown(25, 'none'), 30 * 20 * 20 + 5 * 20 * 15);
    close(grown(25, 'moving'), 35 * 20 * 20);
});
