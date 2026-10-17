// Bridge Surface (Plasticity's) in the browser build: a sheet between two edges, tangent to their
// faces. The desktop's tests are crates/w3d-kernel/tests/bridge_surface.rs.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as THREE from 'three';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { loadKernel } from '../src/Kernel.js';

before(async () => { await loadKernel() });

const pts = b => Array.from({ length: b.positions.length / 3 }, (_, i) => new THREE.Vector3().fromArray(b.positions, 3 * i));
function area(b) {
    const p = i => new THREE.Vector3().fromArray(b.positions, 3 * i);
    let a = 0;
    for (let t = 0; t < b.indices.length; t += 3) {
        const [x, y, z] = [0, 1, 2].map(k => p(b.indices[t + k]));
        a += new THREE.Vector3().subVectors(y, x).cross(new THREE.Vector3().subVectors(z, x)).length() / 2;
    }
    return a;
}

/** A 10 × 10 sheet at height `y` from x = `x0`, and the number of its edge at x = `x`. */
async function sheet(be, x0, y) {
    const { ids: [sq] } = await be.addCurves([{ origin: [x0, y, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'polyline', points: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true }]);
    const { id, scene } = await be.commitPatch({ curves: [sq] });
    const b = scene.find(s => s.id === id);
    const at = x => b.edges.findIndex(e => { for (let i = 0; i < e.length; i += 3) if (Math.abs(e[i] - x) > 1e-9) return false; return true; });
    return { id, at };
}

test('level sheets bridge flat; a step bridges with an S that leaves each level', async () => {
    const be = new LocalBackend();
    const a = await sheet(be, 0, 60), b = await sheet(be, 20, 60);
    const flat = await be.previewBridgeSurface({ a: { body: a.id, edge: a.at(10) }, b: { body: b.id, edge: b.at(20) } });
    for (const p of pts(flat)) assert.ok(Math.abs(p.y - 60) < 1e-6, `${p.y} off the plane`);
    assert.ok(Math.abs(area(flat) - 100) < 1e-3, `area ${area(flat)}`);

    const c = await sheet(be, 20, 65);
    const s = await be.previewBridgeSurface({ a: { body: a.id, edge: a.at(10) }, b: { body: c.id, edge: c.at(20) }, tension: 1 });
    for (const p of pts(s)) {
        assert.ok(p.y > 60 - 1e-6 && p.y < 65 + 1e-6, `${p.y} overshoots`);
        if (p.x > 10 && p.x < 10.3) assert.ok((p.y - 60) / (p.x - 10) < 0.07, `rises too fast off the first sheet at ${p.x}`);
    }
    const { id, scene } = await be.commitBridgeSurface({ a: { body: a.id, edge: a.at(10) }, b: { body: c.id, edge: c.at(20) } });
    assert.equal(scene.find(x => x.id === id).sheet, true);
});

test('loose or mismatched edges are refused', async () => {
    const be = new LocalBackend();
    const a = await sheet(be, 0, 60);
    await assert.rejects(async () => be.previewBridgeSurface({ a: { body: a.id, edge: 0 }, b: { body: a.id, edge: 0 } }), /two different edges/);
    const { ids: [ring] } = await be.addCurves([{ origin: [30, 60, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'circle', center: [0, 0], radius: 3 }]);
    const { id: disc } = await be.commitPatch({ curves: [ring] });
    await assert.rejects(async () => be.previewBridgeSurface({ a: { body: a.id, edge: 0 }, b: { body: disc, edge: 0 } }), /open edges or two closed/);
});

test('two rims bridge round', async () => {
    const be = new LocalBackend();
    const disc = async y => {
        const { ids: [ring] } = await be.addCurves([{ origin: [0, y, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'circle', center: [0, 0], radius: 5 }]);
        return (await be.commitPatch({ curves: [ring] })).id;
    };
    const [a, b] = [await disc(60), await disc(70)];
    const hoop = await be.previewBridgeSurface({ a: { body: a, edge: 0 }, b: { body: b, edge: 0 } });
    const waist = pts(hoop).filter(p => Math.abs(p.y - 65) < 0.3).map(p => Math.hypot(p.x, p.z));
    assert.ok(waist.length);
    assert.ok(Math.min(...waist) > 5.5, `the middle is at radius ${Math.min(...waist)}`);
    assert.ok(Math.max(...waist) - Math.min(...waist) < 0.1, 'uneven round');
});
