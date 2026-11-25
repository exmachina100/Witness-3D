// G3 Blend (LABS): a sheet between two separate sheets meeting each in G3, measured by Seam Check.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { loadKernel } from '../src/Kernel.js';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { clampedKnots, firstSheet, g3Blend, movePoles, nearestEdge } from '../src/g3Blend.js';
import { CLASS_A, checkSeam, seamSummary } from '../src/seamCheck.js';

before(async () => { await loadKernel() });

/** A cubic-by-cubic sheet over x in [x0, x1], y in [0, 100], poles on z = f(x, y). */
const data = (x0, x1, f) => {
    const poles = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const x = x0 + (x1 - x0) * i / 3, y = 100 * j / 3;
        poles.push(x, y, f(x, y));
    }
    const k = clampedKnots(4, 3);
    return [3, 3, 4, 4, 8, 8, ...k, ...k, ...poles];
};

test('clamped knots and pole moves keep the sheet layout', () => {
    assert.deepEqual(clampedKnots(5, 3), [0, 0, 0, 0, 0.5, 1, 1, 1, 1]);
    const d = data(0, 10, () => 0), m = movePoles(d, [[5, [0, 0, 2]]]);
    assert.equal(m[6 + 16 + 3 * 5 + 2], d[6 + 16 + 3 * 5 + 2] + 2);
    assert.throws(() => movePoles(d, [[16, [0, 0, 1]]]), /does not have/);
});

test('the first sheet lies on both edges, leaves each along its face and runs B the way A runs', () => {
    const line = (x, out, back = false) => {
        const ys = [0, 2.5, 5, 7.5, 10];
        return { at: (back ? [...ys].reverse() : ys).map(y => [x, y, 0]), out: ys.map(() => out) };
    };
    const d = firstSheet(line(0, [1, 0, 0]), line(70, [-1, 0, 0], true));
    const [, , nu, nv, nku, nkv] = d, at = 6 + nku + nkv, pole = (i, j) => d.slice(at + 3 * (i * nv + j), at + 3 * (i * nv + j) + 3);
    assert.equal(nu, 8);
    assert.equal(nv, 5);
    const near = (p, q) => p.every((v, k) => Math.abs(v - q[k]) < 1e-9);
    assert.ok(near(pole(0, 0), [0, 0, 0]));
    assert.ok(near(pole(7, 0), [70, 0, 0]), 'B turned round to run with A');
    assert.ok(near(pole(1, nv - 1), [10, 10, 0]));
    assert.ok(near(pole(6, nv - 1), [60, 10, 0]));
});

test('G3 blend meets both sheets within every Class-A target and leaves nothing behind', async () => {
    const be = new LocalBackend();
    const a = await be.commitSplineSheet({ data: data(-100, -30, (x, y) => 0.002 * x * x + 0.0005 * y * y) });
    const b = await be.commitSplineSheet({ data: data(30, 100, (x, y) => 10 - 0.001 * x * x + 0.03 * x + 0.0008 * y * y) });
    const scene = b.scene, idA = a.ids[0], idB = b.ids[0];
    const ea = nearestEdge(scene, idA, [-30, 50, 0.002 * 900 + 1.25]);
    const eb = nearestEdge(scene, idB, [30, 50, 10 - 0.9 + 0.9 + 2]);
    const count = scene.length;
    const r = await g3Blend(be, { body: idA, edge: ea }, { body: idB, edge: eb });
    assert.equal(be.bodies().length, count, 'the trial sheet is taken back');
    const made = await be.commitSplineSheet({ data: r.data });
    const list = made.scene;
    const toA = nearestEdge(list, made.ids[0], [-30, 50, 3]), toB = nearestEdge(list, made.ids[0], [30, 50, 10]);
    for (const [edge, ref] of [[toA, { body: idA, edge: ea }], [toB, { body: idB, edge: eb }]]) {
        const c = await checkSeam(be, { body: made.ids[0], edge, other: ref });
        console.log(seamSummary(c));
        for (const k of ['g0', 'g1', 'g2', 'g3', 'highlight']) assert.equal(c.ok[k], true, `${k}: ${seamSummary(c)}`);
    }
});
