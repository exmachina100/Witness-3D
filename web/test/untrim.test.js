// Untrim in the browser build. The desktop's tests are crates/w3d-kernel/tests/untrim.rs.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as THREE from 'three';
import { boolean, box, count, loadKernel, numbered, oc, primitive } from '../src/Kernel.js';
import { untrimFace } from '../src/untrim.js';

before(async () => { await loadKernel() });

const close = (a, b, eps) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b} (±${eps})`);
function area(s) {
    const o = oc(), g = new o.GProp_GProps();
    o.BRepGProp.SurfaceProperties(s, g, false, false);
    return g.Mass();
}
/** A 100 mm block with a ball of radius 20 sunk into the middle of its top. */
function dimpled() {
    const b = box(new THREE.Vector3(0, 0, 0), new THREE.Vector3(100, 100, 50));
    return boolean(b, primitive({ kind: 'sphere', center: [50, 50, 50], radius: 20 }), 'difference');
}
function faceOfType(s, type, z) {
    const o = oc();
    return numbered(s, 'TopAbs_FACE').findIndex(f => {
        const ad = new o.BRepAdaptor_Surface(o.TopoDS.Face(f), true);
        if (ad.GetType() !== o.GeomAbs_SurfaceType[type]) return false;
        return z === undefined || Math.abs(ad.Value(ad.FirstUParameter(), ad.FirstVParameter()).Z() - z) < 1e-9;
    });
}

test('a flat face loses its hole', () => {
    const s = dimpled();
    const top = faceOfType(s, 'GeomAbs_Plane', 50);
    const sheet = untrimFace(s, top);
    assert.equal(count(sheet, 'TopAbs_FACE'), 1);
    close(area(sheet), 10000, 1e-6);
});

test('keep edges imprints the hole', () => {
    const s = dimpled();
    const sheet = untrimFace(s, faceOfType(s, 'GeomAbs_Plane', 50), true);
    assert.equal(count(sheet, 'TopAbs_FACE'), 2);
    close(area(sheet), 10000, 1e-6);
});

test('a dimple becomes the whole ball', () => {
    const s = dimpled();
    const f = faceOfType(s, 'GeomAbs_Sphere');
    close(area(untrimFace(s, f)), 4 * Math.PI * 400, 1e-6);
    const kept = untrimFace(s, f, true);
    assert.equal(count(kept, 'TopAbs_FACE'), 2);
    close(area(kept), 4 * Math.PI * 400, 1e-6);
});

test('a missing face is refused', () => {
    assert.throws(() => untrimFace(dimpled(), 99), /no longer exists/);
});
