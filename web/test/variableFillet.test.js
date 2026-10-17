import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as THREE from 'three';
import { BlendError, blendEdges, boolean, box, loadKernel, tessellate, volume } from '../src/Kernel.js';

before(async () => { await loadKernel() });

// A 40 × 30 × 20 block; its edge at x = 0, z = 0 runs up y from 0 to 30.
const block = () => box(new THREE.Vector3(0, 0, 0), new THREE.Vector3(40, 30, 20));
const upright = s => tessellate(s).polylines.findIndex(p => { for (let j = 0; j < p.length; j += 3) if (Math.abs(p[j]) > 1e-6 || Math.abs(p[j + 2]) > 1e-6) return false; return true; });
const FULL = 40 * 30 * 20;
const half = (s, lower) => volume(boolean(s, lower ? box(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(41, 15, 21)) : box(new THREE.Vector3(-1, 15, -1), new THREE.Vector3(41, 31, 21)), 'intersection'));

test('a variable point widens the round where it is, the same as on the desktop', () => {
    const s = block(), e = upright(s);
    const constant = FULL - volume(blendEdges(s, [e], 3));
    assert.ok(Math.abs(constant - (1 - Math.PI / 4) * 9 * 30) < 0.5, String(constant));
    const r = blendEdges(s, [e], 3, false, false, Math.PI / 4, [{ edge: e, point: [0, 15, 0], scale: 2 }]);
    const taken = FULL - volume(r);
    assert.ok(taken > constant * 1.5 && taken < constant * 4, `${taken} vs ${constant}`);
    assert.ok(Math.abs(half(r, true) - half(r, false)) < 1);
    for (const [y, lowerLosesMore] of [[4, true], [26, false]]) {
        const v = blendEdges(s, [e], 3, false, false, Math.PI / 4, [{ edge: e, point: [0, y, 0], scale: 2.5 }]);
        assert.equal(half(v, true) < half(v, false), lowerLosesMore, `point at y = ${y}`);
    }
});

test('variable points are checked', () => {
    const s = block(), e = upright(s);
    assert.throws(() => blendEdges(s, [e], 3, false, false, Math.PI / 4, [{ edge: (e + 1) % 12, point: [0, 0, 0], scale: 2 }]), BlendError);
    assert.throws(() => blendEdges(s, [e], 3, false, false, Math.PI / 4, [{ edge: e, point: [0, 15, 0], scale: 0 }]), BlendError);
    // A chamfer ignores them.
    assert.ok(blendEdges(s, [e], 3, true, false, Math.PI / 4, [{ edge: e, point: [0, 15, 0], scale: 2 }]));
});
