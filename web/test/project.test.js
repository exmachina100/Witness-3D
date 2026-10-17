// Project (Plasticity's Project Curve Body, Body Body and Curve Curve) in the browser build: the
// curves land on the faces they were projected onto. The desktop's tests are
// crates/w3d-kernel/tests/project.rs.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as THREE from 'three';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { loadKernel, oc, prism } from '../src/Kernel.js';
import { nurbsPoints } from '../src/curves.js';
import { regionFace } from '../src/Forms.js';

before(async () => { await loadKernel() });

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
/** How close a projected curve must lie to its surface: a hundredth of the 0.01 mm bar. */
const ON = 1e-4;

/** A curve's points in model space. */
function world(c) {
    const n = new THREE.Vector3(...c.normal).normalize(), x = new THREE.Vector3(...c.x), y = n.clone().cross(x), o = new THREE.Vector3(...c.origin);
    return nurbsPoints(c).map(([u, v, h]) => o.clone().addScaledVector(x, u).addScaledVector(y, v).addScaledVector(n, h));
}
/** A solid's volume integrated adaptively: the plain rule is off by a tenth of a percent on rational faces. */
function volume(shape) {
    const props = new (oc().GProp_GProps)();
    oc().BRepGProp.VolumePropertiesGK(shape, props, 1e-9, false, false, false, false, false);
    return props.Mass();
}
const length = pts => pts.slice(1).reduce((s, p, i) => s + p.distanceTo(pts[i]), 0);

// The seed block is 80 × 30 × 50: x −40..40, y 0..30. A line along x at height 50, over its middle.
const over = { origin: [0, 50, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'polyline', points: [[-100, 0], [100, 0]], closed: false };

test('a line projected down lands on the top, or all round without hiding', async () => {
    const be = new LocalBackend();
    const seed = be.scene()[0];
    const { ids: [line] } = await be.addCurves([over]);
    const seen = await be.previewProject({ mode: 'curve-body', body: seed.id, curves: [line], dir: [0, -1, 0], hide: true });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].kind, 'nurbs');
    const pts = world(seen[0]);
    for (const p of pts) { close(p.y, 30, ON); close(p.z, 0, ON); }
    close(length(pts), 80, 1e-3);
    // Flat on the top, the curve lies in the top's plane.
    close(seen[0].normal[1], 1, 1e-9);

    // Without hiding: the whole section, over the top, down the sides and under the bottom.
    const all = await be.previewProject({ mode: 'curve-body', body: seed.id, curves: [line], dir: [0, -1, 0] });
    assert.equal(all.length, 1);
    close(length(world(all[0])), 2 * (80 + 30), 1e-3);

    // Upwards it misses, unless both ways.
    await assert.rejects(async () => be.previewProject({ mode: 'curve-body', body: seed.id, curves: [line], dir: [0, 1, 0] }), /miss/);
    assert.equal((await be.previewProject({ mode: 'curve-body', body: seed.id, curves: [line], dir: [0, 1, 0], both: true })).length, 1);
});

test('a face half hidden keeps only the part seen', async () => {
    const be = new LocalBackend();
    const seed = be.scene()[0];
    // A slab over the left half (x −40..0, height 40..45) on a wall at the left end: with hide, the
    // block's top shows only where the slab does not cover it.
    const box = (origin, width, height) => ({ kind: 'box', frame: { origin, x: [1, 0, 0], normal: [0, 1, 0] }, width, depth: 50, height, target: seed.id, op: 'union' });
    await be.commitPrimitive(box([-40, 30, 25], 10, 10));
    const { id: body } = await be.commitPrimitive(box([-40, 40, 25], 40, 5));
    assert.equal(be.scene().length, 1);
    const { ids: [line] } = await be.addCurves([{ ...over, origin: [0, 60, 0] }]);
    const seen = await be.previewProject({ mode: 'curve-body', body, curves: [line], dir: [0, -1, 0], hide: true });
    const pts = seen.flatMap(world);
    const top = pts.filter(p => Math.abs(p.y - 30) < ON);
    assert.ok(top.length, 'the block shows right of the slab');
    close(Math.min(...top.map(p => p.x)), 0, 1e-3);
    assert.ok(pts.every(p => Math.abs(p.y - 45) < ON || Math.abs(p.y - 30) < ON || Math.abs(p.x) < 1e-3), 'nothing under the slab');
});

test('a circle projected onto the top is a region that extrudes', async () => {
    const be = new LocalBackend();
    const seed = be.scene()[0];
    const { ids: [ring] } = await be.addCurves([{ origin: [0, 50, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'circle', center: [0, 0], radius: 5 }]);
    const out = await be.previewProject({ mode: 'curve-body', body: seed.id, curves: [ring], dir: [0, -1, 0], hide: true });
    assert.equal(out.length, 1);
    const { ids: [made] } = await be.addCurves(out);
    const kept = (await be.curves()).find(c => c.id === made);
    assert.equal(kept.kind, 'nurbs');
    assert.equal((await be.curves()).length, 2, 'the projected curve stays');
    close(volume(prism(regionFace(kept), new THREE.Vector3(0, 4, 0))), Math.PI * 25 * 4, 1e-4);
});

test('two bodies meet in curves, and two curves where their sheets cross', async () => {
    const be = new LocalBackend();
    const seed = be.scene()[0];
    // A post up through the top: x −10..10, y 20..40, z −10..10. They meet in a square on the top.
    const { id: post } = await be.commitPrimitive({ kind: 'box', frame: { origin: [-10, 20, 10], x: [1, 0, 0], normal: [0, 1, 0] }, width: 20, depth: 20, height: 20 });
    const meet = await be.previewProject({ mode: 'body-body', bodies: [seed.id, post] });
    const pts = meet.flatMap(world);
    assert.ok(pts.length);
    for (const p of pts) close(p.y, 30, ON);
    close(meet.map(c => length(world(c))).reduce((a, b) => a + b), 80, 1e-3);

    // A circle on the ground (its sheet a tube up y) and a line in the plane z = 0 at height 3
    // (its sheet the plane y = 3) cross in a circle at height 3.
    const { ids: [ring, ledge] } = await be.addCurves([
        { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'circle', center: [0, 0], radius: 5 },
        { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1], kind: 'polyline', points: [[-20, 3], [20, 3]], closed: false },
    ]);
    const cross = await be.previewProject({ mode: 'curve-curve', curves: [ring, ledge] });
    assert.equal(cross.length, 1);
    for (const p of world(cross[0])) { close(p.y, 3, ON); close(Math.hypot(p.x, p.z), 5, ON); }
});
