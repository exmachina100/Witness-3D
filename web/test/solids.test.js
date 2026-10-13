// Round 6: Box, Cylinder, Sphere, Shell, Mirror and arrays, against exact volumes.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as THREE from 'three';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { arrayMotions, bounds, box, count, loadKernel, mirror, primitive, shellFaces, volume } from '../src/Kernel.js';

before(async () => { await loadKernel() });

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const ground = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0] };
const cube = () => box(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 10, 10));

test('box, cylinder and sphere have exact volumes, whichever way they are dragged', () => {
    for (const [w, d, h] of [[10, 20, 30], [-10, 20, -30], [10, -20, 30]]) {
        const s = primitive({ kind: 'box', frame: ground, width: w, depth: d, height: h });
        close(volume(s), 6000);
        assert.equal(count(s, 'TopAbs_FACE'), 6);
    }
    close(volume(primitive({ kind: 'cylinder', frame: ground, radius: 5, height: -10 })), Math.PI * 250);
    close(volume(primitive({ kind: 'sphere', center: [1, 2, 3], radius: 3 })), 4 / 3 * Math.PI * 27);
});

test('a box on a tilted plane keeps its size', () => {
    const tilted = { origin: [5, 5, 5], x: [1, 1, 0], normal: [0, 0, 1] };
    close(volume(primitive({ kind: 'box', frame: tilted, width: 4, depth: 5, height: 6 })), 120);
});

test('primitives refuse sizes that make nothing', () => {
    assert.throws(() => primitive({ kind: 'box', frame: ground, width: 0, depth: 1, height: 1 }), /width, a depth and a height/);
    assert.throws(() => primitive({ kind: 'box', frame: ground, width: NaN, depth: 1, height: 1 }), /not a number/);
    assert.throws(() => primitive({ kind: 'cylinder', frame: ground, radius: -1, height: 1 }), /radius/);
    assert.throws(() => primitive({ kind: 'cylinder', frame: ground, radius: 1, height: 0 }), /height/);
    assert.throws(() => primitive({ kind: 'sphere', center: [0, 0, 0], radius: 0 }), /radius/);
    assert.throws(() => primitive({ kind: 'box', frame: { origin: [0, 0, 0], x: [0, 1, 0], normal: [0, 1, 0] }, width: 1, depth: 1, height: 1 }), /plane/);
    assert.throws(() => primitive({ kind: 'cone' }), /box, a cylinder or a sphere/);
});

test('shell hollows a cube to the right wall thickness and traces the outer faces', () => {
    const { shape, history } = shellFaces(cube(), [0], 1);
    // One face open, 1 mm walls: the cavity is 8 × 8 × 9.
    close(volume(shape), 1000 - 8 * 8 * 9);
    assert.equal(count(shape, 'TopAbs_SOLID'), 1);
    assert.equal(count(shape, 'TopAbs_FACE'), 11, 'five outer faces, five inner walls, the rim');
    assert.ok(history.faces[0].length >= 5, 'the five closed outer faces keep where they came from');
});

test('shell refuses impossible requests', () => {
    assert.throws(() => shellFaces(cube(), [], 1), /faces to open/);
    assert.throws(() => shellFaces(cube(), [0], 0), /greater than zero/);
    assert.throws(() => shellFaces(cube(), [0], 6), /thinner/);
    assert.throws(() => shellFaces(cube(), [9], 1), /not on this body/);
    assert.throws(() => shellFaces(cube(), [0, 1, 2, 3, 4, 5], 1), /at least one face closed/);
});

test('mirror reflects without changing size, and needs a plane', () => {
    const m = mirror(cube(), [20, 0, 0], [1, 0, 0]);
    close(volume(m), 1000);
    const b = bounds(m); // the cube spans x 0..10, so its reflection in x = 20 spans 30..40
    close(b.min.x, 30, 1e-6);
    close(b.max.x, 40, 1e-6);
    assert.equal(count(m, 'TopAbs_FACE'), 6);
    assert.throws(() => mirror(cube(), [0, 0, 0], [0, 0, 0]), /no direction/);
    assert.throws(() => mirror(cube(), [0, NaN, 0], [1, 0, 0]), /not a number/);
});

test('array motions count copies and spread a full turn evenly', () => {
    assert.equal(arrayMotions({ kind: 'rectangular', steps: [[15, 0, 0], [0, 0, 15], [0, 0, 0]], counts: [2, 3, 1] }).length, 5);
    assert.deepEqual(arrayMotions({ kind: 'radial', pivot: [0, 0, 0], axis: [0, 1, 0], angle: 2 * Math.PI, count: 4 }).map(m => +m.angle.toFixed(6)), [1.570796, 3.141593, 4.712389]);
    assert.deepEqual(arrayMotions({ kind: 'radial', pivot: [0, 0, 0], axis: [0, 1, 0], angle: Math.PI, count: 3 }).map(m => +m.angle.toFixed(6)), [1.570796, 3.141593], 'a partial turn reaches its end');
    assert.deepEqual(arrayMotions({ kind: 'rectangular', steps: [[1, 0, 0], [0, 0, 1], [0, 1, 0]], counts: [1, 1, 1] }), []);
    assert.throws(() => arrayMotions({ kind: 'rectangular', steps: [[0, 0, 0], [0, 0, 1], [0, 1, 0]], counts: [3, 1, 1] }), /needs a spacing/);
    assert.throws(() => arrayMotions({ kind: 'rectangular', steps: [[1, 0, 0], [0, 0, 1], [0, 1, 0]], counts: [20, 20, 20] }), /more than 1000/);
    assert.throws(() => arrayMotions({ kind: 'radial', pivot: [0, 0, 0], axis: [0, 0, 0], angle: 1, count: 3 }), /no direction/);
});

test('the backend adds primitives and shells as single undo steps', async () => {
    const be = new LocalBackend();
    const before = be.scene().length;
    const { id } = await be.commitPrimitive({ kind: 'sphere', center: [0, 100, 0], radius: 5 });
    assert.equal(be.scene().length, before + 1);
    close(be.scene().find(b => b.id === id).volume, 4 / 3 * Math.PI * 125, 1);
    be.undo();
    assert.equal(be.scene().length, before);

    const seed = be.scene()[0];
    const p = await be.previewShell({ body: seed.id, faces: [0], thickness: 2 });
    assert.ok(p.volume < seed.volume);
    close(be.scene()[0].volume, seed.volume, 1e-3);
    await be.commitShell({ body: seed.id, faces: [0], thickness: 2 });
    close(be.scene()[0].volume, p.volume, 1e-3);
    be.undo();
    close(be.scene()[0].volume, seed.volume, 1e-3);
});

test('mirror and arrays make copies, or join them, in one undo step', async () => {
    const be = new LocalBackend();
    const seed = be.scene()[0]; // 80 × 30 × 50, from x −40 to 40
    const copies = await be.previewMirror({ bodies: [seed.id], origin: [60, 0, 0], normal: [1, 0, 0] });
    assert.equal(copies.length, 1);
    assert.equal(be.scene().length, 1, 'a preview adds nothing');

    const m = await be.commitMirror({ bodies: [seed.id], origin: [60, 0, 0], normal: [1, 0, 0] });
    assert.equal(m.ids.length, 1);
    assert.equal(be.scene().length, 2);
    be.undo();

    // Joined across a plane through the body: the halves overlap, so the union is the body alone grown to the plane's far side.
    const j = await be.commitMirror({ bodies: [seed.id], origin: [40, 0, 0], normal: [1, 0, 0], join: true });
    assert.deepEqual(j.ids, [seed.id]);
    assert.equal(be.scene().length, 1);
    close(be.scene()[0].volume, 2 * seed.volume, 1);
    be.undo();

    const a = await be.commitArray({ bodies: [seed.id], spec: { kind: 'rectangular', steps: [[100, 0, 0], [0, 0, 0], [0, 0, 0]], counts: [3, 1, 1] } });
    assert.equal(a.ids.length, 2);
    assert.equal(be.scene().length, 3);
    be.undo();
    assert.equal(be.scene().length, 1);
    await assert.rejects(async () => be.commitArray({ bodies: [seed.id], spec: { kind: 'radial', pivot: [0, 0, 0], axis: [0, 1, 0], angle: 1, count: 1 } }), /nothing to do/);
    assert.equal(be.undoStack.length, 0, 'failed or empty requests add no undo step');
});
