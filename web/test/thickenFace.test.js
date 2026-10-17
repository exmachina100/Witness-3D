// Thicken Face (Plasticity's) in the browser build: faces of a body made a solid of their own, front
// out of the body and back into it; the body stays. The desktop's tests are
// crates/w3d-kernel/tests/thicken_face.rs.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as THREE from 'three';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { box, count, facePlane, loadKernel, primitive, volume } from '../src/Kernel.js';
import { joinSheets, unjoin } from '../src/Join.js';
import { thickenFaces } from '../src/Thicken.js';

before(async () => { await loadKernel() });

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
/** The face of `shape` whose outward normal is `n`. */
const facing = (shape, n) => [...Array(count(shape, 'TopAbs_FACE')).keys()].find(i => facePlane(shape, i)?.normal.dot(n) > 0.999);

test("a box's top becomes a slab on it and the box stays", async () => {
    const be = new LocalBackend();
    const seed = be.scene()[0];
    const s = be.shapes.get(seed.id);
    const top = facing(s, v(0, 1, 0));
    const before = volume(s);
    const { id, scene } = await be.commitThicken({ body: seed.id, faces: [top], front: 2, back: 0.5 });
    assert.notEqual(id, seed.id);
    assert.equal(scene.length, 2);
    close(volume(be.shapes.get(seed.id)), before);
    // The seed block is 80 × 50 across its top.
    close(volume(be.shapes.get(id)), 80 * 50 * 2.5, 1e-4);
});

test('two faces meeting at an edge thicken into one bent plate', () => {
    const cube = box(v(0, 0, 0), v(10, 10, 10));
    const plate = thickenFaces(cube, [facing(cube, v(0, 0, 1)), facing(cube, v(1, 0, 0))], 1);
    // Two 10 × 10 × 1 plates and the 1 × 1 × 10 corner where they meet outside the box.
    close(volume(plate), 210);
});

test('a round face thickens evenly and bad picks are refused', () => {
    const rod = primitive({ kind: 'cylinder', frame: { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] }, radius: 5, height: 10 });
    const wall = [...Array(count(rod, 'TopAbs_FACE')).keys()].find(i => !facePlane(rod, i));
    const exact = Math.PI * (36 - 25) * 10;
    assert.ok(Math.abs(volume(thickenFaces(rod, [wall], 1)) - exact) / exact < 1e-3);
    assert.throws(() => thickenFaces(rod, [], 1));
    assert.throws(() => thickenFaces(rod, [99], 1));
    assert.throws(() => thickenFaces(rod, [wall, wall], 1));
});

test('a face of a sheet thickens on its own', async () => {
    const cube = box(v(0, 0, 0), v(10, 10, 10));
    const pieces = unjoin(cube, true);
    const sheet = joinSheets([pieces[facing(cube, v(0, 0, 1))], pieces[facing(cube, v(1, 0, 0))]]);
    const be = new LocalBackend();
    const id = be.nextId++;
    be.put(id, sheet);
    const flat = facing(sheet, v(0, 0, 1));
    const { id: slab } = await be.commitThicken({ body: id, faces: [flat], front: 1 });
    close(volume(be.shapes.get(slab)), 100);
});
