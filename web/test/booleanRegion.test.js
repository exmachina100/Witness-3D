// Boolean Region in the browser build (Kernel.js regions, LocalBackend).
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { box, loadKernel, planeSheet, regions, volume } from '../src/Kernel.js';
import { LocalBackend } from '../src/app/LocalBackend.js';

before(async () => { await loadKernel() });

const round = v => Math.round(v * 1000) / 1000;

test('two overlapping blocks make three regions, largest first', () => {
    const r = regions([box({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 }), box({ x: 5, y: 5, z: 5 }, { x: 15, y: 15, z: 15 })]);
    assert.deepEqual(r.map(s => round(volume(s))), [875, 875, 125]);
});

test('a sheet across a block splits it; an open sheet alone closes nothing', () => {
    const block = box({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 });
    const r = regions([block, planeSheet([5, 5, 3], [0, 0, 1], 20)]);
    assert.deepEqual(r.map(s => round(volume(s))), [700, 300]);
    assert.throws(() => regions([planeSheet([0, 0, 0], [0, 0, 1], 5)]), /no region/);
});

test('Region as one undo step replaces the bodies with the regions', async () => {
    const be = new LocalBackend();
    const a = be.nextId++, b = be.nextId++;
    be.put(a, box({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 }));
    be.put(b, box({ x: 5, y: 5, z: 5 }, { x: 15, y: 15, z: 15 }));
    const before = be.bodies().length;
    const { scene } = await be.commitBoolean({ target: a, tools: [b], op: 'union', region: true });
    assert.equal(scene.length, before + 1);
    assert.ok(!be.shapes.has(b));
});
