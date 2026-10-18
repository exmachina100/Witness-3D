// Fillet Chordal in the browser build. The desktop's tests are crates/w3d-kernel/tests/fillet_shapes.rs.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as THREE from 'three';
import { blendEdges, box, loadKernel, numberedEdges, oc } from '../src/Kernel.js';
import { chordal, edgeTurn } from '../src/filletShape.js';

before(async () => { await loadKernel() });

function vol(s) {
    const o = oc(), g = new o.GProp_GProps();
    o.BRepGProp.VolumeProperties(s, g, false, false, false);
    return g.Mass();
}
function edgeWhere(shape, on) {
    const o = oc();
    return numberedEdges(shape).findIndex(e => {
        const c = new o.BRepAdaptor_Curve(e);
        return [c.FirstParameter(), c.LastParameter()].every(t => { const p = c.Value(t); return on(new THREE.Vector3(p.X(), p.Y(), p.Z())); });
    });
}

test('a chordal round spans the distance across it', () => {
    const b = box(new THREE.Vector3(0, 0, 0), new THREE.Vector3(40, 30, 20));
    const e = edgeWhere(b, p => Math.abs(p.x) < 1e-6 && Math.abs(p.z) < 1e-6);
    assert.ok(Math.abs(edgeTurn(b, e) - Math.PI / 2) < 1e-9);
    const c = chordal(b, [e], 6);
    const r = 6 / Math.SQRT2;
    assert.ok(Math.abs(c.size - r) < 1e-9 && c.variable.length === 0);
    const out = blendEdges(b, [e], c.size);
    const want = 24000 - 30 * r * r * (1 - Math.PI / 4);
    assert.ok(Math.abs(vol(out) - want) < 0.01, `${vol(out)} against ${want}`);
});

test('limit points keep the round between them, ending flat', async () => {
    const { limitRound } = await import('../src/filletShape.js');
    const { booleanWithHistory, count } = await import('../src/Kernel.js');
    const b = box(new THREE.Vector3(0, 0, 0), new THREE.Vector3(40, 30, 20));
    const e = edgeWhere(b, p => Math.abs(p.x) < 1e-6 && Math.abs(p.z) < 1e-6);
    const rounded = blendEdges(b, [e], 4);
    const { shape } = limitRound(b, rounded, [e], [[0, 25, 0], [0, 10, 0]], booleanWithHistory);
    const want = 24000 - 15 * 16 * (1 - Math.PI / 4);
    assert.ok(Math.abs(vol(shape) - want) < 0.01, `${vol(shape)} against ${want}`);
    assert.equal(count(shape, 'TopAbs_FACE'), 9);
    assert.throws(() => limitRound(b, rounded, [e], [[0, 25, 0]], booleanWithHistory), /two limit points/);
    assert.throws(() => limitRound(b, rounded, [e], [[5, 5, 5], [0, 10, 0]], booleanWithHistory), /not on an edge/);
});
