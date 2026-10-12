import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { loadKernel } from '../src/Kernel.js';
import { LocalBackend } from '../src/app/LocalBackend.js';

before(async () => { await loadKernel() });

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

/** Edge numbers whose every point passes `keep`. */
const edgesWhere = (body, keep) => body.edges.flatMap((p, i) => {
    for (let j = 0; j < p.length; j += 3) if (!keep(p[j], p[j + 1], p[j + 2])) return [];
    return [i];
});
const topFront = b => edgesWhere(b, (x, y, z) => Math.abs(y - 30) < 1e-6 && Math.abs(z - 25) < 1e-6);
const vertical = b => b.edges.flatMap((p, i) => {
    for (let j = 3; j < p.length; j += 3) if (Math.abs(p[j] - p[0]) > 1e-6 || Math.abs(p[j + 2] - p[2]) > 1e-6) return [];
    return [i];
});
const withRef = (b, r) => b.edgeRefs.flatMap((x, i) => x === r ? [i] : []);

test('every body carries one ref per face and edge', () => {
    const [b] = new LocalBackend().scene();
    assert.equal(b.faceRefs.length, 6);
    assert.equal(b.edgeRefs.length, 12);
    assert.equal(new Set([...b.faceRefs, ...b.edgeRefs]).size, 18);
});

test('an edge keeps its ref through a boss joined elsewhere', async () => {
    const be = new LocalBackend();
    const [b] = be.scene();
    const r = b.edgeRefs[topFront(b)[0]];
    const { scene: [after] } = await be.commit({
        target: b.id, origin: [0, 30, 0], normal: [0, 1, 0], xAxis: [1, 0, 0],
        profile: { kind: 'circle', radius: 8 }, distance: 10, newBody: false,
    });
    assert.ok(after.revision > b.revision);
    assert.deepEqual(withRef(after, r), topFront(after));
    assert.equal(after.edgeRefs.length, after.edges.length);
});

test('a fillet keeps trimmed edges and gives its rounds new face refs; undo restores', async () => {
    const be = new LocalBackend();
    const [b] = be.scene();
    const r = b.edgeRefs[topFront(b)[0]];
    const { scene: [after] } = await be.commitBlend({ body: b.id, edges: vertical(b), size: 4, kind: 'fillet' });
    assert.deepEqual(withRef(after, r), topFront(after));
    assert.equal(after.faceRefs.filter(f => !b.faceRefs.includes(f)).length, 4);
    const [undone] = be.undo();
    assert.deepEqual(undone.edgeRefs, b.edgeRefs);
});

test('a move keeps refs and moves the geometry', async () => {
    const be = new LocalBackend();
    const [b] = be.scene();
    const { scene: [after] } = await be.commitMotion({ bodies: [b.id], offset: [10, 0, 0], angle: Math.PI / 2 });
    assert.deepEqual(after.edgeRefs, b.edgeRefs);
    const xs = [];
    for (let i = 0; i < after.positions.length; i += 3) xs.push(after.positions[i]);
    close(Math.min(...xs), -15, 1e-4);
    close(Math.max(...xs), 35, 1e-4);
    await assert.rejects(be.commitMotion({ bodies: [b.id] }), /nothing to do/);
    const { scene: [half] } = await be.commitMotion({ bodies: [b.id], scale: 0.5, pivot: [0, 0, 0] });
    close(half.volume, 120000 / 8, 1e-3);
    const d = await be.duplicateBodies([b.id]);
    assert.equal(d.scene.length, 2);
    assert.equal((await be.deleteBodies(d.ids)).length, 1);
});

test('faces merged after a boolean inherit from the faces merged into them', async () => {
    const { box, booleanWithHistory, count } = await import('../src/Kernel.js');
    const THREE = await import('three');
    const a = box(new THREE.Vector3(-40, 0, -25), new THREE.Vector3(40, 30, 25));
    const b = box(new THREE.Vector3(30, 0, -25), new THREE.Vector3(50, 30, 25));
    const { shape, history } = booleanWithHistory(a, b, 'union');
    // One longer box. The faces where they overlap are gone; the other five of `a` each land on
    // one face of the result, and four of them were merged with a face of `b`.
    assert.equal(count(shape, 'TopAbs_FACE'), 6);
    const fromA = new Map(history.faces[0]);
    assert.equal(fromA.size, 5);
    assert.equal(new Set(fromA.values()).size, 5);
    const shared = history.faces[1].filter(([, j]) => [...fromA.values()].includes(j));
    assert.equal(shared.length, 4);
});
