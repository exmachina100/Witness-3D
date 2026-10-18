// Toggle Surface Curvature in the browser build. The desktop's test is crates/w3d-kernel/tests/edge_curvature.rs.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as THREE from 'three';
import { boolean, box, loadKernel, numberedEdges, oc, primitive } from '../src/Kernel.js';
import { edgeCurvature } from '../src/edgeCurvature.js';

before(async () => { await loadKernel() });

function edgeWhere(shape, on) {
    const o = oc();
    return numberedEdges(shape).findIndex(e => {
        const { returnValue: g, First, Last } = o.BRep_Tool.Curve(e, 0, 0);
        return [First, (First + Last) / 3, Last].every(t => { const p = g.Value(t); return on(new THREE.Vector3(p.X(), p.Y(), p.Z())); });
    });
}

test('a round edge has even teeth pointing out, and a straight one none', () => {
    const b = box(new THREE.Vector3(0, 0, 0), new THREE.Vector3(100, 100, 50));
    const s = boolean(b, primitive({ kind: 'sphere', center: [50, 50, 50], radius: 20 }), 'difference');
    const centre = new THREE.Vector3(50, 50, 50);
    const rim = edgeWhere(s, p => Math.abs(p.z - 50) < 1e-6 && Math.abs(p.distanceTo(centre) - 20) < 1e-3);
    assert.ok(rim >= 0);
    const teeth = edgeCurvature(s, rim, 32);
    assert.equal(teeth.length, 33);
    for (const t of teeth) {
        assert.ok(Math.abs(t.k - 0.05) < 1e-9, `k ${t.k}`);
        const out = new THREE.Vector3(...t.at).sub(centre).normalize();
        assert.ok(new THREE.Vector3(...t.dir).dot(out) > 1 - 1e-9);
    }
    const line = edgeWhere(s, p => Math.abs(p.x) < 1e-9 && Math.abs(p.y) < 1e-9);
    assert.ok(edgeCurvature(s, line, 8).every(t => t.k === 0));
    assert.throws(() => edgeCurvature(s, 999), /no longer exists/);
});
