// Cut Curve with faces as cutters: a face cuts a curve where the face crosses the curve's plane.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { loadKernel } from '../src/Kernel.js';
import { cutCurve, cuttersFor, samples } from '../src/curveEdit.js';

before(async () => { await loadKernel() });

test('a face cuts a curve where it crosses the curve\'s plane', async () => {
    const be = new LocalBackend();
    const seed = be.scene()[0]; // x −40..40, y 0..30
    // A line at half height, x −100..100, in the plane y = 15.
    const c = { origin: [0, 15, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'polyline', points: [[-100, 0], [100, 0]], closed: false };
    const right = seed.facePlanes.findIndex(p => p && p.normal[0] > 0.99);
    assert.ok(right >= 0);
    const cuts = await be.previewProject({ mode: 'section', body: seed.id, faces: [right], origin: c.origin, normal: c.normal });
    assert.equal(cuts.length, 1);
    const pieces = cutCurve(c, cuttersFor(c, cuts));
    assert.equal(pieces.length, 2);
    const ends = pieces.map(p => samples(p).points).map(p => [p[0][0], p.at(-1)[0]]);
    assert.ok(ends.some(([a, b]) => Math.abs(a - 40) < 1e-6 || Math.abs(b - 40) < 1e-6), JSON.stringify(ends));
    // The whole body: both sides cut it, three pieces.
    const all = await be.previewProject({ mode: 'section', body: seed.id, faces: [], origin: c.origin, normal: c.normal });
    assert.equal(cutCurve(c, cuttersFor(c, all)).length, 3);
    // A face the plane misses gives nothing.
    const top = seed.facePlanes.findIndex(p => p && p.normal[1] > 0.99);
    assert.deepEqual(await be.previewProject({ mode: 'section', body: seed.id, faces: [top], origin: c.origin, normal: c.normal }), []);
});
