// Unwrap Face in the browser build. The desktop's tests are crates/w3d-kernel/tests/unwrap.rs.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as THREE from 'three';
import { boolean, box, bounds, loadKernel, numbered, oc, primitive } from '../src/Kernel.js';
import { unwrapFace } from '../src/unwrap.js';

before(async () => { await loadKernel() });

const close = (a, b, eps) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b} (±${eps})`);
function area(s) {
    const o = oc(), g = new o.GProp_GProps();
    o.BRepGProp.SurfaceProperties(s, g, false, false);
    return g.Mass();
}
const valid = s => new (oc().BRepCheck_Analyzer)(s, true, false).IsValid();
/** A 100 × 100 × 50 block with a ball of radius 20 sunk into the middle of its top. */
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
/** The sheet's extent across the ground and off it: [x, z, y] (the model is y-up). */
function extent(s) {
    const size = bounds(s).getSize(new THREE.Vector3());
    return [size.x, size.z, size.y];
}

test('a flat face lies down with its hole', () => {
    const s = dimpled();
    const flat = unwrapFace(s, faceOfType(s, 'GeomAbs_Plane', 50));
    assert.ok(valid(flat));
    const [w, d, h] = extent(flat);
    close(w, 100, 1e-6); close(d, 100, 1e-6); close(h, 0, 1e-6);
    close(area(flat), 10000 - 400 * Math.PI, 1e-6);
});

test('a side face stands up and lies flat', () => {
    const s = box(new THREE.Vector3(0, 0, 0), new THREE.Vector3(40, 30, 20));
    // A face standing up: its centre halfway up the block.
    const side = numbered(s, 'TopAbs_FACE').findIndex(f => {
        const o = oc(), g = new o.GProp_GProps();
        o.BRepGProp.SurfaceProperties(f, g, false, false);
        return Math.abs(g.CentreOfMass().Z() - 10) < 1e-9;
    });
    const flat = unwrapFace(s, side);
    close(extent(flat)[2], 0, 1e-6);
    close(area(flat), area(numbered(s, 'TopAbs_FACE')[side]), 1e-6);
});

test('a cylinder unrolls to its true size', () => {
    const s = primitive({ kind: 'cylinder', frame: { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] }, radius: 10, height: 30 });
    const flat = unwrapFace(s, faceOfType(s, 'GeomAbs_Cylinder'));
    assert.ok(valid(flat));
    const [w, d, h] = extent(flat);
    close(Math.min(w, d), 30, 1e-6); close(Math.max(w, d), 20 * Math.PI, 1e-6); close(h, 0, 1e-6);
    close(area(flat), 600 * Math.PI, 1e-6);
});

test('a ball flattens keeping its area', () => {
    const s = dimpled();
    const flat = unwrapFace(s, faceOfType(s, 'GeomAbs_Sphere'));
    assert.ok(valid(flat));
    const [w, d, h] = extent(flat);
    close(h, 0, 1e-6);
    // Half a ball (2πr²) can't lie flat without stretching; its area is kept to within a percent.
    close(area(flat) / (800 * Math.PI), 1, 0.01);
    assert.ok(Math.max(w, d) / Math.min(w, d) < 1.25, `${w} x ${d}`);
});

test('a missing face is refused', () => {
    assert.throws(() => unwrapFace(dimpled(), 99), /no longer exists/);
});
