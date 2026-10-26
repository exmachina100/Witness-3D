// Round 6: Box, Cylinder, Sphere, Shell, Mirror and arrays, against exact volumes.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as THREE from 'three';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { arrayMotions, boundaryEdges, bounds, box, count, loadKernel, numbered, planeSheet, mirror, primitive, shellFaces, volume } from '../src/Kernel.js';

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

test('a hole is a round cut: to a depth, or through, as one undo step', async () => {
    const be = new LocalBackend();
    const seed = be.scene()[0]; // 80 × 30 × 50, top face at y = 30
    const hole = depth => ({ target: seed.id, origin: [10, 30, 5], normal: [0, 1, 0], xAxis: [1, 0, 0], profile: { kind: 'circle', radius: 3 }, distance: -depth, op: 'difference' });
    const p = await be.preview(hole(10));
    assert.equal(p.outcome, 'cut');
    close(p.result.volume, seed.volume - Math.PI * 9 * 10, 0.5);
    await be.commit(hole(200));
    close(be.scene()[0].volume, seed.volume - Math.PI * 9 * 30, 0.5);
    be.undo();
    close(be.scene()[0].volume, seed.volume, 1e-3);
});

test('cut splits a body along a drawn line into separate solids, as one undo step', async () => {
    const be = new LocalBackend();
    const seed = be.scene()[0]; // 80 × 30 × 50 at x −40..40, y 0..30
    // A line across the top, drawn on the ground plane: x = 10, from front to back.
    const { ids: [line] } = await be.addCurves([{ origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'polyline', points: [[10, -100], [10, 100]], closed: false }]);
    const preview = await be.previewCut({ bodies: [seed.id], curves: [line] });
    assert.equal(preview.length, 2);
    close(preview[0].volume + preview[1].volume, seed.volume, 1e-3);
    assert.equal(be.scene().length, 1, 'a preview changes nothing');
    const { ids } = await be.commitCut({ bodies: [seed.id], curves: [line] });
    assert.equal(ids.length, 2);
    assert.equal(ids[0], seed.id, 'the bigger piece keeps the id');
    const vols = be.scene().map(b => b.volume).sort((a, b) => b - a);
    close(vols[0], 50 * 30 * 50, 1e-3);
    close(vols[1], 30 * 30 * 50, 1e-3);
    be.undo();
    assert.equal(be.scene().length, 1);
    // A line off to the side cuts nothing.
    const { ids: [miss] } = await be.addCurves([{ origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'polyline', points: [[300, -100], [300, 100]], closed: false }]);
    await assert.rejects(async () => be.commitCut({ bodies: [seed.id], curves: [miss] }), /does not cut/);
});

test('imprint splits faces where curves cross them and keeps the body whole', async () => {
    const be = new LocalBackend();
    const seed = be.scene()[0];
    const faces = seed.faceRefs.length;
    const { ids: [line] } = await be.addCurves([{ origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'polyline', points: [[10, -100], [10, 100]], closed: false }]);
    const preview = await be.previewImprint({ body: seed.id, curves: [line] });
    assert.equal(preview.facePlanes.length, faces + 4, 'top, bottom, front and back are split');
    close(preview.volume, seed.volume, 1e-3);
    // One face, the knife's way: the curve is used up.
    const top = [...Array(faces).keys()].find(f => { try { be.imprintResult({ body: seed.id, faces: [f], curves: [line] }); return true; } catch { return false; } });
    const { id } = await be.commitImprint({ body: seed.id, faces: [top], curves: [line], consume: true });
    assert.equal(id, seed.id);
    assert.equal(be.scene().length, 1);
    assert.equal(be.scene()[0].faceRefs.length, faces + 1);
    assert.equal((await be.curves()).length, 0, 'the knife uses its curve up');
    be.undo();
    assert.equal(be.scene()[0].faceRefs.length, faces);
    assert.equal((await be.curves()).length, 1);
    const { ids: [miss] } = await be.addCurves([{ origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'polyline', points: [[300, -100], [300, 100]], closed: false }]);
    await assert.rejects(async () => be.commitImprint({ body: seed.id, curves: [miss] }), /do not cross/);
});

test('delete redundant topology merges the faces an imprint split, in one undo step', async () => {
    const be = new LocalBackend();
    const seed = be.scene()[0];
    const faces = seed.faceRefs.length;
    const { ids: [line] } = await be.addCurves([{ origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'polyline', points: [[10, -100], [10, 100]], closed: false }]);
    await be.commitImprint({ body: seed.id, curves: [line] });
    assert.equal(be.scene()[0].faceRefs.length, faces + 4);
    const r = await be.commitUnify({ bodies: [seed.id] });
    assert.deepEqual([r.faces, r.edges], [4, 8]);
    assert.equal(be.scene()[0].faceRefs.length, faces);
    close(be.scene()[0].volume, seed.volume, 1e-3);
    be.undo();
    assert.equal(be.scene()[0].faceRefs.length, faces + 4);
});

test('cut with a plane or another body\'s face, and imprint one body on another', async () => {
    const be = new LocalBackend();
    const seed = be.scene()[0]; // 80 × 30 × 50, x −40..40, y 0..30
    // A post standing through the top: x −10..10, y 20..40, z −10..10.
    const { id: post } = await be.commitPrimitive({ kind: 'box', frame: { origin: [-10, 20, 10], x: [1, 0, 0], normal: [0, 1, 0] }, width: 20, depth: 20, height: 20 });
    const vols = () => be.scene().filter(b => b.id !== post).map(b => b.volume).sort((a, b) => b - a);

    // The plane x = 10.
    await be.commitCut({ bodies: [seed.id], tools: { plane: { origin: [10, 0, 0], normal: [1, 0, 0] } } });
    close(vols()[0], 50 * 30 * 50, 1e-3);
    close(vols()[1], 30 * 30 * 50, 1e-3);
    be.undo();

    // A side of the post, grown into a plane, cuts the block in two.
    const faces = be.scene().find(b => b.id === post).facePlanes.length;
    const side = [...Array(faces).keys()].find(f => { try { return be.cutResult({ bodies: [seed.id], tools: { faces: [{ body: post, face: f }] } })[0][1].pieces.length === 2; } catch { return false; } });
    assert.ok(side !== undefined, 'a side of the post cuts the block');
    const { ids } = await be.commitCut({ bodies: [seed.id], tools: { faces: [{ body: post, face: side }] } });
    assert.equal(ids.length, 2);
    be.undo();

    // The post imprints its outline on the block's top; the block stays one body.
    const before = be.scene().find(b => b.id === seed.id).facePlanes.length;
    await be.commitImprint({ body: seed.id, tools: { bodies: [post] } });
    const after = be.scene().find(b => b.id === seed.id);
    assert.equal(after.facePlanes.length, before + 1);
    close(after.volume, seed.volume, 1e-3);
    await assert.rejects(async () => be.commitCut({ bodies: [seed.id] }), /cut with/);
});

test('draft face closes the sides of a block in along the pull, as one undo step', async () => {
    const be = new LocalBackend();
    const { id } = await be.commitPrimitive({ kind: 'box', frame: { origin: [100, 0, 10], x: [1, 0, 0], normal: [0, 1, 0] }, width: 20, depth: 20, height: 20 });
    const faces = be.scene().find(b => b.id === id).facePlanes;
    const sides = faces.map((p, i) => [p, i]).filter(([p]) => Math.abs(p.normal[1]) < 0.5).map(([, i]) => i);
    assert.equal(sides.length, 4);
    const angle = 5 * Math.PI / 180;
    await be.commitDraft({ body: id, faces: sides, pull: [0, 1, 0], origin: [0, 0, 0], angle });
    const t = 20 - 2 * 20 * Math.tan(angle);
    close(be.scene().find(b => b.id === id).volume, 20 / 3 * (400 + t * t + 20 * t), 1e-3);
    be.undo();
    close(be.scene().find(b => b.id === id).volume, 8000, 1e-3);
    await assert.rejects(async () => be.commitDraft({ body: id, faces: sides, pull: [0, 1, 0], origin: [0, 0, 0], angle: 0 }), /not be zero/);
});

test("Draft Face's Grow: an inner face drafted past the outer wall pushes it, stops at it or carries on", async () => {
    // A 13 x 20 x 10 step, its far 3 mm cut down to 5: the riser at x = 10 faces the outer wall at
    // x = 13 (as crates/w3d-kernel/tests/draft_grow.rs). Drafted 45 degrees about its foot it leans
    // out 5 mm at the top, 2 mm past the wall.
    const { boolean } = await import('../src/Kernel.js');
    const be = new LocalBackend();
    const step = boolean(box({ x: 0, y: 0, z: 0 }, { x: 13, y: 20, z: 10 }), box({ x: 10, y: -1, z: 5 }, { x: 14, y: 21, z: 11 }), 'difference');
    be.put(950, step);
    const riser = be.scene().find(b => b.id === 950).facePlanes.findIndex(p => p && p.normal[0] > 0.999 && Math.abs(p.origin[0] - 10) < 1e-9);
    assert.ok(riser >= 0);
    const req = (angle, grow) => ({ body: 950, faces: [riser], pull: [0, 0, 1], origin: [10, 0, 5], angle, grow });
    const vol = r => volume(be.draftResult(r).shape);
    const angle = [Math.PI / 4, -Math.PI / 4].find(a => { try { return vol(req(a, 'none')) > 2300 } catch { return false } });
    assert.ok(angle !== undefined, 'one way adds material');
    close(vol(req(angle, 'none')), 2550, 1e-3);
    close(vol(req(angle, 'fixed')), 2510, 1e-3);
    close(vol(req(angle, 'moving')), 2750, 1e-3);
});

test('Find Boundary Edges: a sheet\'s open sides, none on a solid or at a seam', () => {
    const sheet = planeSheet([0, 0, 0], [0, 1, 0], 20);
    assert.deepEqual(boundaryEdges(sheet), [0, 1, 2, 3]);
    assert.deepEqual(boundaryEdges(cube()), []);
    assert.deepEqual(boundaryEdges(primitive({ kind: 'cylinder', frame: ground, radius: 5, height: 10 })), []);
});

test('Reverse Sheet turns a sheet over as one undo step and refuses a solid', async () => {
    const be = new LocalBackend();
    const seed = be.scene()[0];
    const { ids: [sq] } = await be.addCurves([{ origin: [0, 50, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'polyline', points: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true }]);
    const { id } = await be.commitPatch({ curves: [sq] });
    const normal = () => be.scene().find(b => b.id === id).facePlanes[0].normal;
    // The triangles' winding follows the face, so the mesh turns over too.
    const winding = () => {
        const b = be.scene().find(s => s.id === id), p = i => new THREE.Vector3().fromArray(b.positions, 3 * b.indices[i]);
        return new THREE.Vector3().subVectors(p(1), p(0)).cross(new THREE.Vector3().subVectors(p(2), p(0))).normalize().toArray();
    };
    const [n0, w0] = [normal(), winding()];
    await be.commitReverseSheets({ bodies: [id] });
    n0.forEach((v, i) => close(normal()[i], -v));
    w0.forEach((v, i) => close(winding()[i], -v));
    await assert.rejects(be.commitReverseSheets({ bodies: [seed.id] }), /sheets/);
    be.undo();
    n0.forEach((v, i) => close(normal()[i], v));
});

test('a loft of closed splines shells (the arc join steps in where the sharp one gives up)', async () => {
    const { loft } = await import('../src/Forms.js');
    const oval = (z, w, h) => ({ origin: [0, 10, z], x: [1, 0, 0], normal: [0, 0, 1], kind: 'spline', closed: true,
        points: Array.from({ length: 8 }, (_, i) => [w / 2 * Math.cos(i * Math.PI / 4), h / 2 * Math.sin(i * Math.PI / 4)]) });
    const body = loft([oval(0, 60, 30), oval(40, 90, 50), oval(70, 70, 40)]);
    const door = numbered(body, 'TopAbs_FACE').findIndex(f => Math.abs(bounds(f).max.z) < 1e-3);
    assert.ok(door >= 0);
    const { shape } = shellFaces(body, [door], 2.5);
    assert.ok(count(shape, 'TopAbs_FACE') > count(body, 'TopAbs_FACE'));
    assert.ok(volume(shape) < 0.3 * volume(body), `${volume(shape)} of ${volume(body)}`);
});
