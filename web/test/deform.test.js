// Plasticity's Deform Curve: face coordinates (faceUvn.js) and the shared moves and fit (deform.js).
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { box, loadKernel, primitive } from '../src/Kernel.js';
import { faceUvn } from '../src/faceUvn.js';
import { densify, placeOnFace, smoothThrough } from '../src/deform.js';
import { nurbsPoints } from '../src/curves.js';

before(async () => { await loadKernel() });

const near = (a, b, e = 1e-7) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < e;

test('densify keeps the corners and fills the sides', () => {
    const pts = densify([[0, 0, 0], [10, 0, 0], [10, 10, 0]], false, 20);
    assert.ok(pts.length >= 21);
    assert.ok(pts.some(p => near(p, [10, 0, 0])));
    assert.ok(near(pts.at(-1), [10, 10, 0]));
});

test('the fit goes through every point and keeps a corner sharp', () => {
    const pts = [[0, 0, 0], [5, 0, 0], [10, 0, 0], [10, 5, 0], [10, 10, 0]];
    const c = smoothThrough(pts, false);
    assert.equal(c.poles.length, 3 * 4 + 1);
    const along = nurbsPoints(c, 8);
    for (const p of pts) assert.ok(along.some(q => near(p, q)), JSON.stringify(p));
    // The side before the corner stays on y = 0, the side after on x = 10.
    for (const q of along) assert.ok(Math.abs(q[1]) < 1e-9 || Math.abs(q[0] - 10) < 1e-9, JSON.stringify(q));
});

test('a closed fit comes back to its start', () => {
    const c = smoothThrough([[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]], true);
    assert.ok(near(c.poles[0], c.poles.at(-1)));
});

test('the options move the face coordinates', () => {
    const curves = [[[0.25, 0.5, 1], [0.75, 0.5, 1]]];
    assert.deepEqual(placeOnFace(curves, [100, 50]), curves);
    assert.deepEqual(placeOnFace(curves, [100, 50], { swap: true }), [[[0.5, 0.25, 1], [0.5, 0.75, 1]]]);
    assert.deepEqual(placeOnFace(curves, [100, 50], { mirror: true }), [[[0.75, 0.5, 1], [0.25, 0.5, 1]]]);
    assert.deepEqual(placeOnFace(curves, [100, 50], { normal: true, offset: [10, 5, 2] }), [[[0.35, 0.6, 1], [0.85, 0.6, 1]]]);
    const big = placeOnFace(curves, [100, 50], { scale: [2, 1, 3] });
    assert.deepEqual(big, [[[0, 0.5, 3], [1, 0.5, 3]]]);
});

test('points on a block face go to its unit square and back', () => {
    const b = box({ x: 0, y: 0, z: 0 }, { x: 10, y: 20, z: 30 });
    const pts = [[5, 20, 15], [2, 23, 3]];
    let found = false;
    for (let f = 0; f < 6; f++) {
        const { size, points } = faceUvn(b, f, false, pts);
        if (Math.abs(points[0][2]) > 1e-9 || Math.abs(points[1][2] - 3) > 1e-9) continue;
        found = true;
        assert.deepEqual([...size].sort((x, y) => x - y).map(v => Math.round(v * 1e6) / 1e6), [10, 30]);
        const back = faceUvn(b, f, true, points).points;
        back.forEach((p, i) => assert.ok(near(p, pts[i]), JSON.stringify(p)));
    }
    assert.ok(found, 'the top face');
});

test('a ball maps heights along its outward normal', () => {
    const s = primitive({ kind: 'sphere', center: [0, 0, 0], radius: 10 });
    assert.ok(Math.abs(faceUvn(s, 0, false, [[12, 0, 0]]).points[0][2] - 2) < 1e-6);
    const [p] = faceUvn(s, 0, true, [[0.3, 0.6, 1]]).points;
    assert.ok(Math.abs(Math.hypot(...p) - 11) < 1e-6, JSON.stringify(p));
    assert.throws(() => faceUvn(s, 7, false, [[0, 0, 0]]), /no longer exists/);
});

test('a curve frame carries points from one curve to another by length along, across and up', async () => {
    const { curveFrameAlong, densify } = await import('../src/deform.js');
    const ref = curveFrameAlong(densify([[0, 0, 0], [100, 0, 0]], false, 200), false, [0, 1, 0]);
    const arc = Array.from({ length: 201 }, (_, i) => { const a = Math.PI * i / 200; return [50 - 50 * Math.cos(a), 0, 50 * Math.sin(a)]; });
    const to = curveFrameAlong(arc, false, [0, 1, 0]);
    const near = (a, b, tol = 0.05) => assert.ok(a.every((v, i) => Math.abs(v - b[i]) < tol), `${a} != ${b}`);
    // The middle of the line goes to the top of the arc, 10 above it to 10 further out.
    near(to.place(ref.project([50, 0, 10])), [50, 0, 60]);
    near(to.place(ref.project([0, 0, 0])), [0, 0, 0]);
    near(to.place(ref.project([100, 0, 0])), [100, 0, 0]);
    // Off the plane stays off it; past the end runs on along the end tangent.
    near(to.place(ref.project([50, 4, 0])), [50, 4, 50]);
    near(ref.project([110, 0, 0]), [1.1, 0, 0], 1e-9);
    assert.ok(Math.abs(to.length - 50 * Math.PI) < 0.01);
});
