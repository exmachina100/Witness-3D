// Offset Face's Dependent offset: the distance that carries a face onto a picked face.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { loadKernel } from '../src/Kernel.js';
import { distanceToFace } from '../src/dependentOffset.js';

before(async () => { await loadKernel() });

const facing = (b, normal) => b.facePlanes.findIndex(p => p && p.normal.every((v, k) => Math.abs(v - normal[k]) < 1e-9));

test('a face runs up to a parallel face, forward or back, and misses one off to the side', async () => {
    const be = new LocalBackend();
    const { id: a } = await be.commitPrimitive({ kind: 'box', frame: { origin: [0, 0, 10], x: [1, 0, 0], normal: [0, 1, 0] }, width: 10, depth: 10, height: 10, op: 'new' });
    const { id: shelf } = await be.commitPrimitive({ kind: 'box', frame: { origin: [-5, 17.5, 15], x: [1, 0, 0], normal: [0, 1, 0] }, width: 20, depth: 20, height: 2, op: 'new' });
    const body = id => be.bodies().find(b => b.id === id);
    const top = facing(body(a), [0, 1, 0]), under = facing(body(shelf), [0, -1, 0]), over = facing(body(shelf), [0, 1, 0]);
    // The top of the box (y = 10) up to the shelf's underside (y = 17.5) and its top (y = 19.5).
    const from = [5, 10, 5], up = [0, 1, 0];
    assert.ok(Math.abs(distanceToFace(body(shelf), under, from, up) - 7.5) < 1e-9);
    assert.ok(Math.abs(distanceToFace(body(shelf), over, from, up) - 9.5) < 1e-9);
    // Back down: the box's own bottom face is 10 below.
    assert.ok(Math.abs(distanceToFace(body(a), facing(body(a), [0, -1, 0]), from, up) + 10) < 1e-9);
    // A face beside the line is missed.
    assert.equal(distanceToFace(body(a), facing(body(a), [1, 0, 0]), from, up), null);
    assert.equal(top >= 0, true);
});
