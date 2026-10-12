import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as THREE from 'three';
import { BlendError, blendEdges, box, count, loadKernel, numberedEdges, tessellate, volume } from '../src/Kernel.js';

before(async () => { await loadKernel() });

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

// The seed enclosure, in millimetres: 80 wide, 30 tall, 50 deep.
const enclosure = () => box(new THREE.Vector3(-40, 0, -25), new THREE.Vector3(40, 30, 25));

/** Numbers of the vertical edges: one x and one z along the whole edge. */
function vertical(shape) {
    return tessellate(shape).polylines.flatMap((p, i) => {
        for (let j = 3; j < p.length; j += 3) if (Math.abs(p[j] - p[0]) > 1e-6 || Math.abs(p[j + 2] - p[2]) > 1e-6) return [];
        return [i];
    });
}

test('edges are numbered once each, one polyline per edge', () => {
    const s = enclosure();
    assert.equal(numberedEdges(s).length, 12);
    assert.equal(tessellate(s).polylines.length, 12);
    assert.equal(vertical(s).length, 4);
});

test('rounding the four corners removes exactly the corner material', () => {
    const s = blendEdges(enclosure(), vertical(enclosure()), 4);
    close(volume(s), 120000 - 4 * (16 - Math.PI * 4) * 30, 1e-3);
    assert.equal(count(s, 'TopAbs_FACE'), 10);
});

test('a chamfer cuts a triangular prism', () => {
    const s = enclosure();
    const top = tessellate(s).polylines.findIndex(p => p[1] === 30 && p[4] === 30 && p[2] === 25 && p[5] === 25);
    close(volume(blendEdges(s, [top], 3, true)), 120000 - 0.5 * 9 * 80, 1e-6);
});

test('a round too big for its faces fails with a reason instead of crashing', () => {
    const s = enclosure();
    assert.throws(() => blendEdges(s, vertical(s), 30), e => e instanceof BlendError && e.message.length > 0);
    assert.throws(() => blendEdges(s, [99], 1), BlendError);
});
