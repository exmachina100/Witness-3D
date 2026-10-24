import { test } from 'node:test';
import assert from 'node:assert/strict';
import { constrainedSurface, fitPlane, splineSheetData, surfaceAt } from '../src/constrainedSurface.js';

// The largest distance from each point to the surface point at its parameters.
const miss = (fit, points) => Math.max(...points.map(p => { const q = surfaceAt(fit, ...fit.uv(p)); return Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]); }));

test('points on a plane give that plane', () => {
    const pts = [[0, 0, 0], [10, 0, 0], [0, 0, 10], [10, 0, 10], [4, 0, 7]].map(([x, y, z]) => [x, y + 0.5 * x, z]);
    const plane = fitPlane(pts);
    assert.ok(Math.abs(Math.abs(plane.N[1]) - 1 / Math.hypot(1, 0.5)) < 1e-9);
    const fit = constrainedSurface(pts);
    assert.ok(fit.met);
    assert.ok(fit.error < 1e-6, `error ${fit.error}`);
    assert.ok(fit.fold < 1e-6);
});

test('the surface passes through scattered points on a dome within tolerance', () => {
    const pts = [];
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
        const x = i * 5 + (j % 2), z = j * 5 - (i % 2);
        pts.push([x, 8 - 0.02 * ((x - 10) ** 2 + (z - 10) ** 2), z]);
    }
    for (const optimize of ['performance', 'smoothness']) {
        const fit = constrainedSurface(pts, { tolerance: 0.01, optimize });
        assert.ok(fit.met, `${optimize}: missed by ${fit.error}`);
        assert.ok(miss(fit, pts) < 0.0101, `${optimize}: sampled miss ${miss(fit, pts)}`);
    }
});

test('a lower angular tolerance keeps the net from folding to catch an outlier', () => {
    const pts = [[0, 0, 0], [20, 0, 0], [0, 0, 20], [20, 0, 20], [10, 0, 10], [5, 0, 15], [15, 0, 5], [10, 1, 11]];
    const loose = constrainedSurface(pts, { tolerance: 0.001, angular: 90 });
    const tight = constrainedSurface(pts, { tolerance: 0.001, angular: 5 });
    assert.ok(loose.met);
    assert.ok(tight.fold <= 5 + 1e-9);
    assert.ok(!tight.met && tight.error > loose.error);
});

test('the flat data lists degrees, counts, knots and poles', () => {
    const fit = constrainedSurface([[0, 0, 0], [10, 0, 0], [0, 0, 10], [10, 1, 10]]);
    const d = splineSheetData(fit);
    const [, , nu, nv, nku, nkv] = d;
    assert.equal(d.length, 6 + nku + nkv + nu * nv * 3);
    assert.equal(nku, nu + 4);
});

test('too few or collinear points are refused', () => {
    assert.throws(() => constrainedSurface([[0, 0, 0], [1, 0, 0]]), /three/);
    assert.throws(() => constrainedSurface([[0, 0, 0], [1, 0, 0], [2, 0, 0]]), /line/);
});

test('the browser kernel makes the fitted surface into one sheet through the points', async () => {
    const { loadKernel, count, oc } = await import('../src/Kernel.js');
    const { splineSheet } = await import('../src/splineSheet.js');
    await loadKernel();
    const pts = [[0, 0, 0], [20, 0, 0], [0, 0, 20], [20, 0, 20], [10, 4, 10], [5, 1, 15], [15, 1, 5]];
    const fit = constrainedSurface(pts, { tolerance: 0.01 });
    assert.ok(fit.met);
    const face = splineSheet(splineSheetData(fit));
    assert.equal(count(face, 'TopAbs_FACE'), 1);
    const o = oc();
    for (const p of pts) {
        const d = new o.BRepExtrema_DistShapeShape(new o.BRepBuilderAPI_MakeVertex(new o.gp_Pnt(...p)).Shape(), face);
        assert.ok(d.Value() < 0.0101, `point ${p} is ${d.Value()} away`);
    }
    assert.throws(() => splineSheet([3, 3, 4]), /short|add up/);
});
