// Curve Array (Plasticity's): copies spread evenly by length along a curve, turned with it.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { curveArrayMotions, placesAlong } from '../src/curveArray.js';
import { loadKernel } from '../src/Kernel.js';

before(async () => { await loadKernel() });

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const ground = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0] };

test('places are even by length, start included, and a closed curve stops short of its start', () => {
    const line = { ...ground, kind: 'polyline', points: [[0, 0], [30, 0], [30, 30]], closed: false };
    const at = placesAlong(line, 4).map(p => p.at);
    [[0, 0], [20, 0], [30, 10], [30, 30]].forEach((q, i) => { close(at[i][0], q[0]); close(at[i][1], q[1]); });
    const ring = { ...ground, kind: 'circle', center: [0, 0], radius: 10 };
    const r = placesAlong(ring, 4);
    for (const p of r) close(Math.hypot(...p.at), 10, 1e-3);
    close(Math.hypot(r[2].at[0] - r[0].at[0], r[2].at[1] - r[0].at[1]), 20, 0.01);
});

test('copies turn with the tangent about the curve normal, or keep square', () => {
    const ring = { ...ground, kind: 'circle', center: [0, 0], radius: 10 };
    const m = curveArrayMotions(ring, 4);
    assert.equal(m.length, 3);
    m.forEach((q, i) => close(Math.abs(q.angle), Math.PI / 2 * (i + 1) > Math.PI ? 2 * Math.PI - Math.PI / 2 * (i + 1) : Math.PI / 2 * (i + 1), 0.02));
    assert.deepEqual(m[0].axis, [0, 1, 0]);
    assert.ok(curveArrayMotions(ring, 4, false).every(q => q.angle === 0));
    assert.deepEqual(curveArrayMotions(ring, 1), []);
    assert.throws(() => curveArrayMotions(ring, 0), /at least 1/);
});

test('the browser build places a copy of a body at each spot along the curve', async () => {
    const be = new LocalBackend();
    const seed = be.scene()[0]; // 80 × 30 × 50, centred on x = 0
    const line = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'polyline', points: [[0, 0], [300, 0]], closed: false };
    const { ids: made, scene } = await be.commitArray({ bodies: [seed.id], spec: { kind: 'motions', motions: curveArrayMotions(line, 4) } });
    assert.equal(made.length, 3);
    const xs = made.map(id => { const b = scene.find(s => s.id === id); let lo = Infinity; for (let i = 0; i < b.positions.length; i += 3) lo = Math.min(lo, b.positions[i]); return lo; });
    xs.forEach((x, i) => close(x, -40 + 100 * (i + 1), 1e-6));
});
