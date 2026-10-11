import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as THREE from 'three';
import { Document } from '../src/Document.js';
import { ExtrudeFactory } from '../src/ExtrudeFactory.js';
import { NoOpError } from '../src/GeometryFactory.js';
import { box, count, exportSTEP, loadKernel, volume } from '../src/Kernel.js';

before(async () => { await loadKernel() });

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

function setup() {
    const doc = new Document();
    const id = doc.addItem(box(new THREE.Vector3(-2, -2, -2), new THREE.Vector3(2, 2, 2)));
    const f = new ExtrudeFactory(doc);
    f.profile = new THREE.Shape().moveTo(-0.5, -0.5).lineTo(0.5, -0.5).lineTo(0.5, 0.5).lineTo(-0.5, 0.5).closePath();
    f.origin.set(0, 0, 2); // top face of the box
    f.normal.set(0, 0, 1);
    f.target = id;
    return { doc, f, id };
}

test('positive distance on a face joins into one exact solid', async () => {
    const { doc, f, id } = setup();
    f.distance = 1;
    await f.update();
    assert.equal(f.state.tag, 'updated');
    assert.equal(f.isOverlapping, true);
    assert.equal(f.operationType, 'union');
    assert.equal(f.temps.length, 1);
    assert.equal(doc.get(id).visible, false, 'original is hidden while previewing');
    await f.commit();
    assert.equal(doc.get(id).visible, true);
    assert.equal(doc.ids.length, 1);
    close(volume(doc.shape(id)), 64 + 1);
    assert.equal(count(doc.shape(id), 'TopAbs_SOLID'), 1);
    assert.equal(count(doc.shape(id), 'TopAbs_FACE'), 6 + 5, 'coplanar top faces merged');
});

test('negative distance cuts an exact pocket', async () => {
    const { doc, f, id } = setup();
    f.distance = -1.5;
    await f.commit();
    assert.equal(f.state.tag, 'committed');
    close(volume(doc.shape(id)), 64 - 1.5);
    assert.equal(doc.temporaries.children.length, 0, 'previews cleaned up');
});

test('a circular profile cuts a true cylinder, not a polygon', async () => {
    const { doc, f, id } = setup();
    f.profile = new THREE.Shape().absarc(0, 0, 0.6, 0, Math.PI * 2, false);
    f.distance = -1;
    await f.commit();
    close(volume(doc.shape(id)), 64 - Math.PI * 0.36);
});

test('extruding away from any body makes a new body', async () => {
    const { doc, f } = setup();
    f.origin.set(10, 0, 0);
    f.distance = 2;
    await f.commit();
    assert.equal(doc.ids.length, 2);
    assert.equal(f.isOverlapping, false);
});

test('rapid updates are coalesced into one follow-up job', async () => {
    const { f } = setup();
    let calls = 0;
    const calc = f.calculate.bind(f);
    f.calculate = async () => { calls++; await new Promise(r => setTimeout(r, 5)); return calc() };
    f.distance = 0.5;
    const first = f.update();
    for (const d of [0.6, 0.7, 0.8, 0.9]) { f.distance = d; f.update() }
    await first;
    assert.equal(calls, 2, 'one in-flight job plus one for the latest value');
    assert.equal(f.state.tag, 'updated');
});

test('zero distance is a no-op failure, cancel restores the body', async () => {
    const { doc, f, id } = setup();
    f.distance = 1;
    await f.update();
    f.distance = 0;
    await f.update();
    assert.equal(f.state.tag, 'failed');
    assert.ok(f.state.error instanceof NoOpError);
    f.cancel();
    assert.equal(f.state.tag, 'cancelled');
    assert.equal(doc.get(id).visible, true);
    assert.equal(doc.temporaries.children.length, 0);
});

test('undo and redo restore committed solids', async () => {
    const { doc, f, id } = setup();
    f.distance = -1;
    await f.commit();
    close(volume(doc.shape(id)), 63);
    doc.undo();
    close(volume(doc.shape(id)), 64);
    doc.redo();
    close(volume(doc.shape(id)), 63);
});

test('edges come from the B-rep, not the triangles', () => {
    const { doc, id } = setup();
    const edges = doc.get(id).children[0].geometry.attributes.position.count / 2;
    assert.equal(edges, 12, 'a box has exactly 12 edges');
});

test('bodies export as STEP', async () => {
    const { doc, f, id } = setup();
    f.distance = -1;
    await f.commit();
    const text = new TextDecoder().decode(exportSTEP(doc.shape(id)));
    assert.ok(text.startsWith('ISO-10303-21;'));
    assert.match(text, /MANIFOLD_SOLID_BREP/);
});
