// Control Point Curve: the shared B-spline sampler and the curve through the web kernel.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { cvDegree, cvPoints } from '../src/curves.js';
import { loadKernel } from '../src/Kernel.js';

before(async () => { await loadKernel() });

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('an open control-point curve starts and ends on its end points, not on the others', () => {
    const pts = [[0, 0], [10, 20], [20, -20], [30, 0]];
    assert.equal(cvDegree(4, false), 3);
    const s = cvPoints(pts, false, 40);
    assert.equal(s.length, 41);
    close(s[0][0], 0); close(s[0][1], 0);
    close(s[40][0], 30, 1e-6); close(s[40][1], 0, 1e-6);
    // A cubic with one span is a Bézier: its middle is the average weighted 1 3 3 1.
    close(s[20][0], (0 + 3 * 10 + 3 * 20 + 30) / 8, 1e-9);
    close(s[20][1], (0 + 3 * 20 - 3 * 20 + 0) / 8, 1e-9);
    assert.ok(!s.some(p => Math.abs(p[1] - 20) < 1e-6), 'it does not pass through the inner control points');
});

test('a closed control-point curve is a smooth loop inside its control polygon', () => {
    const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const s = cvPoints(square, true, 64);
    assert.equal(s.length, 64);
    for (const [x, y] of s) assert.ok(x > 0 && x < 10 && y > 0 && y < 10, 'strictly inside the square');
    // Symmetric: the loop's centre is the square's centre.
    close(s.reduce((a, p) => a + p[0], 0) / s.length, 5, 1e-6);
    close(s.reduce((a, p) => a + p[1], 0) / s.length, 5, 1e-6);
});

test('a closed control-point curve bounds a region the kernel extrudes', async () => {
    const be = new LocalBackend();
    const plane = { origin: [0, 100, 0], x: [1, 0, 0], normal: [0, 1, 0] };
    const { ids: [id] } = await be.addCurves([{ ...plane, kind: 'cv', points: [[0, 0], [20, 0], [20, 20], [0, 20]], closed: true }]);
    const { id: made, scene } = await be.commit({ region: id, distance: 5, op: 'new' });
    const v = scene.find(b => b.id === made).volume;
    // Smaller than the 20 × 20 control square, larger than the inscribed circle of the inner square.
    assert.ok(v > 5 * Math.PI * 25 && v < 5 * 400, `volume ${v}`);
    await assert.rejects(async () => be.addCurves([{ ...plane, kind: 'cv', points: [[0, 0]], closed: false }]), /two control points/);
});
