// Patch (Plasticity's Patch) in the browser build: a sheet in a closed loop of curves and edges,
// flat when the loop is flat, smooth and through the loop otherwise. The desktop's tests are
// crates/w3d-kernel/tests/patch.rs.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as THREE from 'three';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { loadKernel } from '../src/Kernel.js';

before(async () => { await loadKernel() });

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
function area(b) {
    const p = i => new THREE.Vector3().fromArray(b.positions, 3 * i);
    let a = 0;
    for (let t = 0; t < b.indices.length; t += 3) {
        const [x, y, z] = [0, 1, 2].map(k => p(b.indices[t + k]));
        a += new THREE.Vector3().subVectors(y, x).cross(new THREE.Vector3().subVectors(z, x)).length() / 2;
    }
    return a;
}
const pts = b => Array.from({ length: b.positions.length / 3 }, (_, i) => new THREE.Vector3().fromArray(b.positions, 3 * i));
/** A line in model space as a drawn curve, on a plane through it. */
function line(a, b) {
    const x = new THREE.Vector3(...b).sub(new THREE.Vector3(...a));
    const len = x.length();
    x.normalize();
    const n = new THREE.Vector3().crossVectors(x, Math.abs(x.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
    return { origin: a, x: x.toArray(), normal: n.toArray(), kind: 'polyline', points: [[0, 0], [len, 0]], closed: false };
}

test('a flat loop of curves is filled with its plane, and kept as a sheet', async () => {
    const be = new LocalBackend();
    const { ids: [ring] } = await be.addCurves([{ origin: [0, 60, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'circle', center: [0, 0], radius: 5 }]);
    const shown = await be.previewPatch({ curves: [ring] });
    // The mesh is a polygon inside the circle: within its 0.05 mm deflection all round.
    close(area(shown), Math.PI * 25, 2 * Math.PI * 5 * 0.05);
    for (const p of pts(shown)) close(p.y, 60, 1e-9);
    const { id, scene } = await be.commitPatch({ curves: [ring] });
    const sheet = scene.find(b => b.id === id);
    assert.equal(sheet.sheet, true);
    assert.equal(sheet.volume, 0);
    assert.equal(scene.find(b => b.id !== id).sheet, false, 'the block stays a solid');
    assert.equal((await be.curves()).length, 1, 'the loop stays');
    await be.undo();
    assert.equal(be.bodies().length, 1);
});

test('a twisted loop gets a smooth sheet through it, an open one is refused', async () => {
    const be = new LocalBackend();
    const c = [[0, 60, 0], [10, 58, 0], [10, 60, 10], [0, 58, 10]];
    const sides = c.map((p, i) => line(p, c[(i + 1) % 4]));
    const { ids } = await be.addCurves(sides);
    const sheet = await be.previewPatch({ curves: ids });
    assert.ok(sheet.facePlanes.every(p => p === null), 'not flat');
    for (const p of pts(sheet)) assert.ok(p.y > 58 - 1e-3 && p.y < 60 + 1e-3, `${p.y} bulges past the corners`);
    await assert.rejects(async () => be.previewPatch({ curves: ids.slice(0, 3) }), /open|one loop/);
});

test("a body's rim closes flat; tangent to upright walls is refused", async () => {
    const be = new LocalBackend();
    const seed = be.scene()[0];
    // The seed block's top is at y = 30: its four top edges make a flat loop.
    const top = seed.edges.map((e, n) => ({ e, n })).filter(({ e }) => { for (let i = 1; i < e.length; i += 3) if (Math.abs(e[i] - 30) > 1e-9) return false; return true; }).map(({ n }) => n);
    assert.equal(top.length, 4);
    const lid = await be.previewPatch({ edges: top.map(edge => ({ body: seed.id, edge })) });
    close(area(lid), 80 * 50, 1e-6);
    // Tangent to the block's upright sides, a plate cannot turn that steeply: refused with the reason.
    await assert.rejects(async () => be.previewPatch({ edges: top.map(edge => ({ body: seed.id, edge, tangent: true })) }), /off tangent/);
});

test('an edge asks for curvature as well as tangency through continuity', async () => {
    const be = new LocalBackend();
    const seed = be.scene()[0];
    const top = seed.edges.map((e, n) => ({ e, n })).filter(({ e }) => { for (let i = 1; i < e.length; i += 3) if (Math.abs(e[i] - 30) > 1e-9) return false; return true; }).map(({ n }) => n);
    // Continuity 0 is the flat lid, as no continuity is; 1 and 2 ask the upright walls for tangency
    // and curvature, which a plate cannot give, so both are refused with the reason.
    const lid = await be.previewPatch({ edges: top.map(edge => ({ body: seed.id, edge, continuity: 0 })) });
    close(area(lid), 80 * 50, 1e-6);
    for (const continuity of [1, 2]) {
        await assert.rejects(async () => be.previewPatch({ edges: top.map(edge => ({ body: seed.id, edge, continuity })) }), /off tangent|cannot match the curvature/, `continuity ${continuity}`);
    }
});

test("Tolerance says how far apart the loop's pieces may be and still close", async () => {
    const be = new LocalBackend();
    // A twisted square whose last side stops 0.05 mm short of the first corner.
    const c = [[0, 60, 0], [10, 58, 0], [10, 60, 10], [0, 58, 10]];
    const sides = c.map((p, i) => line(p, i === 3 ? [0, 60, 0.05] : c[(i + 1) % 4]));
    const { ids } = await be.addCurves(sides);
    await assert.rejects(async () => be.previewPatch({ curves: ids }), /open|one loop/);
    const loose = await be.previewPatch({ curves: ids, tolerance: 0.1 });
    const { ids: closed } = await be.addCurves(c.map((p, i) => line(p, c[(i + 1) % 4])));
    const whole = await be.previewPatch({ curves: closed });
    close(area(loose), area(whole), 0.01 * area(whole));
});
