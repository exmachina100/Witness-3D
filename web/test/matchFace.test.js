// Match Face in the browser build. The desktop's tests are crates/w3d-kernel/tests/match_face.rs.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as THREE from 'three';
import { box, count, loadKernel, numbered, numberedEdges, oc, volume } from '../src/Kernel.js';
import { bridgeSurface } from '../src/BridgeSurface.js';
import { matchFaces } from '../src/matchFace.js';
import { patch } from '../src/Patch.js';

before(async () => { await loadKernel() });

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b} (±${eps})`);
function square(x0, y0, size, z) {
    const c = { origin: [0, 0, z], x: [1, 0, 0], normal: [0, 0, 1], kind: 'polyline', points: [[x0, y0], [x0 + size, y0], [x0 + size, y0 + size], [x0, y0 + size]], closed: true };
    return patch([c], []);
}
function edgeWhere(shape, on) {
    const o = oc();
    return numberedEdges(shape).findIndex(e => {
        const { returnValue: g, First, Last } = o.BRep_Tool.Curve(e, 0, 0);
        return [First, (First + Last) / 2, Last].every(t => { const p = g.Value(t); return on(new THREE.Vector3(p.X(), p.Y(), p.Z())); });
    });
}
/** The flat face of `s` lying at height `z`. */
function faceAt(s, z) {
    const o = oc();
    return numbered(s, 'TopAbs_FACE').findIndex(f => {
        const ad = new o.BRepAdaptor_Surface(o.TopoDS.Face(f), true);
        if (ad.GetType() !== o.GeomAbs_SurfaceType.GeomAbs_Plane) return false;
        const n = ad.Plane().Axis().Direction(), p = ad.Value(ad.FirstUParameter(), ad.FirstVParameter());
        return Math.abs(Math.abs(n.Z()) - 1) < 1e-9 && Math.abs(p.Z() - z) < 1e-9;
    });
}
const cube = () => box(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 10, 10));

test('a top face grows up to a sheet above it, even one smaller than the face', () => {
    const b = cube();
    const r = matchFaces(b, [faceAt(b, 10)], square(3, 3, 4, 15), 0);
    close(volume(r), 1500, 1e-4);
    assert.equal(count(r, 'TopAbs_FACE'), 6);
});

test('a face is cut back to a sheet inside the body, from either side', () => {
    const b = cube(), sheet = square(-5, -5, 20, 7);
    close(volume(matchFaces(b, [faceAt(b, 10)], sheet, 0)), 700, 1e-4);
    close(volume(matchFaces(b, [faceAt(b, 0)], sheet, 0)), 300, 1e-4);
});

test('a face takes the shape of a curved sheet', () => {
    const a = square(0, 0, 10, 0), c = square(20, 0, 10, 5);
    const bend = bridgeSurface({ shape: a, n: edgeWhere(a, p => Math.abs(p.x - 10) < 1e-9) }, { shape: c, n: edgeWhere(c, p => Math.abs(p.x - 20) < 1e-9) }, 1);
    const b = box(new THREE.Vector3(10, 0, -10), new THREE.Vector3(20, 10, -2));
    close(volume(matchFaces(b, [faceAt(b, -2)], bend, 0)), 1250, 0.5);
});

test('a surface along the face, or a sheet to match, is refused', () => {
    const b = cube();
    const o = oc();
    const side = numbered(b, 'TopAbs_FACE').findIndex(f => {
        const ad = new o.BRepAdaptor_Surface(o.TopoDS.Face(f), true);
        return Math.abs(Math.abs(ad.Plane().Axis().Direction().X()) - 1) < 1e-9;
    });
    assert.throws(() => matchFaces(b, [faceAt(b, 10)], b, side), /along/);
    assert.throws(() => matchFaces(square(0, 0, 10, 15), [0], b, faceAt(b, 10)), /solid/);
});
