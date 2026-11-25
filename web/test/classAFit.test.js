// Class-A Fit (LABS): a rippled many-span face rebuilt as one faired Bézier patch within 0.05 mm.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { loadKernel } from '../src/Kernel.js';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { bernstein, classAFit, classAFitFace, fitPatch, inflections, patchDeviation, patchFrame } from '../src/classAFit.js';
import { clampedKnots } from '../src/g3Blend.js';

before(async () => { await loadKernel() });

/** A hood-like shape: gently domed, 200 x 120 mm. */
const hood = (x, y) => 40 - 0.0009 * (x - 100) ** 2 - 0.0016 * (y - 60) ** 2 + 0.00001 * x * y;

test('Bernstein basis sums to one and its derivatives to zero', () => {
    for (const t of [0, 0.3, 1]) {
        const [b0, b1, b2] = bernstein(6, t);
        assert.ok(Math.abs(b0.reduce((s, v) => s + v, 0) - 1) < 1e-12);
        assert.ok(Math.abs(b1.reduce((s, v) => s + v, 0)) < 1e-9);
        assert.ok(Math.abs(b2.reduce((s, v) => s + v, 0)) < 1e-9);
    }
});

test('an exact degree-5 patch is fitted back exactly', () => {
    const P = Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => [i * 20, j * 12, Math.sin(i + j) * 3]));
    const Q = Array.from({ length: 17 }, (_, a) => Array.from({ length: 17 }, (_, b) => patchFrame(P, 5, a / 16, b / 16).at));
    const F = fitPatch(Q, 5);
    assert.ok(patchDeviation(Q, F, 5).worst < 1e-8);
});

test('a rippled face fits one faired degree-5 patch within 0.05 mm with no inflections', () => {
    // 25 x 25 points of a nearly flat roof panel with 0.02 mm ripples at 40 mm pitch, like a scanned
    // or many-span patch: the ripples bend more than the panel does, so the face bends both ways.
    const Q = Array.from({ length: 25 }, (_, a) => Array.from({ length: 25 }, (_, b) => {
        const x = 200 * a / 24, y = 120 * b / 24;
        return [x, y, 40 - 0.00005 * (x - 100) ** 2 - 0.00008 * (y - 60) ** 2 + 0.02 * Math.sin(x / 40 * 2 * Math.PI) * Math.cos(y / 40 * 2 * Math.PI)];
    }));
    const r = classAFit(Q);
    assert.equal(r.degree, 5);
    assert.ok(r.deviation <= 0.05, `deviation ${r.deviation}`);
    assert.ok(r.lambda > 0, 'faired');
    assert.ok(r.before > 0, 'the ripples bend the face both ways');
    console.log(`roof: degree ${r.degree} · ${r.deviation.toFixed(4)} mm · inflections ${r.before} -> ${r.inflections}`);
    assert.equal(r.inflections, 0);
});

test('a face no single patch can follow is refused with the closest fit named', () => {
    const Q = Array.from({ length: 25 }, (_, a) => Array.from({ length: 25 }, (_, b) => [a * 10, b * 10, 5 * Math.sin(a / 2)]));
    assert.throws(() => classAFit(Q), /closest is degree 7 at/);
});

test('Class-A Fit of a kernel face: a 12 x 12 span face becomes one degree-5 patch', async () => {
    const be = new LocalBackend();
    const n = 15, poles = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const x = 200 * i / (n - 1), y = 120 * j / (n - 1);
        poles.push(x, y, hood(x, y) + ((i * 7 + j * 3) % 5 - 2) * 0.004);
    }
    const k = clampedKnots(n, 3);
    const made = await be.commitSplineSheet({ data: [3, 3, n, n, k.length, k.length, ...k, ...k, ...poles] });
    const r = await classAFitFace(be, { body: made.ids[0], face: 0 });
    console.log(`degree ${r.degree} · deviation ${r.deviation.toFixed(4)} mm · inflections ${r.before} -> ${r.inflections} · λ ${r.lambda.toExponential(1)}`);
    assert.equal(r.degree, 5);
    assert.ok(r.deviation <= 0.05);
    assert.equal(r.inflections, 0);
    const sheet = await be.commitSplineSheet({ data: r.data });
    assert.equal(sheet.scene.length, made.scene.length + 1);
});

test('a noisy scan (OBJ) of a roof panel fits one faired patch within 0.05 mm', async () => {
    const { scanPoints } = await import('../src/scanPoints.js');
    const { classAFitPoints } = await import('../src/classAFit.js');
    // A tilted scan: 2000 scattered points with ±0.015 mm noise, as an OBJ.
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const lines = [];
    for (let i = 0; i < 2000; i++) {
        const x = 200 * rand(), y = 120 * rand(), z = 40 - 0.0009 * (x - 100) ** 2 - 0.0016 * (y - 60) ** 2 + 0.03 * (rand() - 0.5);
        lines.push(`v ${x} ${0.8 * y - 0.6 * z} ${0.6 * y + 0.8 * z}`);
    }
    const pts = scanPoints(new TextEncoder().encode(lines.join('\n')), 'roof.obj');
    const r = classAFitPoints(pts);
    console.log(`scan: degree ${r.degree} · ${r.deviation.toFixed(4)} mm over ${r.points} points · inflections ${r.inflections}`);
    assert.equal(r.degree, 5);
    assert.ok(r.deviation <= 0.05);
    assert.equal(r.inflections, 0);
});

test('binary STL vertices are read once each', async () => {
    const { scanPoints } = await import('../src/scanPoints.js');
    const tris = [];
    for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) tris.push([[i, j, 0], [i + 1, j, 0], [i, j + 1, 0]]);
    const buf = new ArrayBuffer(84 + tris.length * 50), dv = new DataView(buf);
    dv.setUint32(80, tris.length, true);
    tris.forEach((t, k) => t.forEach((p, c) => p.forEach((v, x) => dv.setFloat32(84 + k * 50 + 12 + c * 12 + x * 4, v, true))));
    assert.equal(scanPoints(new Uint8Array(buf), 'grid.stl').length, 120);
});
