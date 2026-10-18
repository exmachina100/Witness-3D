// Offset Edge on curved faces and across several faces in the browser build. The desktop's tests
// are crates/w3d-kernel/tests/offset_edges.rs.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as THREE from 'three';
import { boolean, box, count, loadKernel, numbered, numberedEdges, oc, primitive } from '../src/Kernel.js';
import { offsetEdgeFaces, offsetEdges } from '../src/edgeTube.js';

before(async () => { await loadKernel() });

/** Edges all of whose sample points pass `on`. */
function edgesWhere(shape, on) {
    const o = oc();
    return numberedEdges(shape).map((e, i) => [e, i]).filter(([e]) => {
        const { returnValue: g, First, Last } = o.BRep_Tool.Curve(e, 0, 0);
        if (!g) return false;
        return [0, 0.25, 0.5, 0.75, 1].every(k => { const p = g.Value(First + (Last - First) * k); return on(new THREE.Vector3(p.X(), p.Y(), p.Z())); });
    }).map(([, i]) => i);
}
const planeAt = (s, f) => {
    const o = oc(), ad = new o.BRepAdaptor_Surface(o.TopoDS.Face(numbered(s, 'TopAbs_FACE')[f]), true);
    return ad.GetType() === o.GeomAbs_SurfaceType.GeomAbs_Plane;
};

test('the rim of a dimple offsets down the ball and out across the top', () => {
    const b = box(new THREE.Vector3(0, 0, 0), new THREE.Vector3(100, 100, 50));
    const s = boolean(b, primitive({ kind: 'sphere', center: [50, 50, 50], radius: 20 }), 'difference');
    const centre = new THREE.Vector3(50, 50, 50);
    const [rim] = edgesWhere(s, p => Math.abs(p.z - 50) < 1e-6 && Math.abs(p.distanceTo(centre) - 20) < 1e-3);
    assert.ok(rim >= 0);
    const curved = [0, 1].find(side => offsetEdgeFaces(s, [rim], side).every(f => !planeAt(s, f)));
    const down = offsetEdges(s, [rim], 5, curved).shape;
    assert.equal(count(down, 'TopAbs_FACE'), count(s, 'TopAbs_FACE') + 1);
    assert.equal(edgesWhere(down, p => {
        const flat = Math.hypot(p.x - 50, p.y - 50);
        return Math.abs(p.distanceTo(centre) - 20) < 1e-3 && Math.abs(Math.hypot(flat - 20, p.z - 50) - 5) < 1e-3 && p.z < 50;
    }).length, 1);
    const out = offsetEdges(s, [rim], 5, 1 - curved).shape;
    assert.equal(edgesWhere(out, p => Math.abs(p.z - 50) < 1e-6 && Math.abs(Math.hypot(p.x - 50, p.y - 50) - 25) < 1e-3).length, 1);
});

test('a chain round a corner offsets on one side or the other', () => {
    const s = box(new THREE.Vector3(0, 0, 0), new THREE.Vector3(100, 80, 50));
    const [front] = edgesWhere(s, p => Math.abs(p.y) < 1e-9 && Math.abs(p.z - 50) < 1e-9);
    const [right] = edgesWhere(s, p => Math.abs(p.x - 100) < 1e-9 && Math.abs(p.z - 50) < 1e-9);
    const top = [0, 1].find(side => offsetEdgeFaces(s, [front, right], side).length === 1);
    const t = offsetEdges(s, [front, right], 10, top).shape;
    assert.equal(count(t, 'TopAbs_FACE'), 7);
    assert.equal(edgesWhere(t, p => Math.abs(p.y - 10) < 1e-6 && Math.abs(p.z - 50) < 1e-6).length, 1);
    assert.equal(edgesWhere(t, p => Math.abs(p.x - 90) < 1e-6 && Math.abs(p.z - 50) < 1e-6).length, 1);
    const sides = offsetEdges(s, [front, right], 10, 1 - top).shape;
    assert.equal(count(sides, 'TopAbs_FACE'), 8);
    assert.equal(edgesWhere(sides, p => Math.abs(p.z - 40) < 1e-6).length, 2);
    assert.equal(count(offsetEdges(s, [front, right], 10, 2).shape, 'TopAbs_FACE'), 9);
    // `away` picks the side without that face: the top's number keeps the offset off the top.
    const topFace = offsetEdgeFaces(s, [front, right], top)[0];
    assert.equal(count(offsetEdges(s, [front, right], 10, 0, topFace).shape, 'TopAbs_FACE'), 8);
});

test('edges round a corner on three sides are refused', () => {
    const s = box(new THREE.Vector3(0, 0, 0), new THREE.Vector3(100, 80, 50));
    const [a] = edgesWhere(s, p => Math.abs(p.y) < 1e-9 && Math.abs(p.z - 50) < 1e-9);
    const [b] = edgesWhere(s, p => Math.abs(p.x - 100) < 1e-9 && Math.abs(p.z - 50) < 1e-9);
    const [c] = edgesWhere(s, p => Math.abs(p.x - 100) < 1e-9 && Math.abs(p.y) < 1e-9);
    assert.throws(() => offsetEdgeFaces(s, [a, b, c], 0), /one side/);
});
