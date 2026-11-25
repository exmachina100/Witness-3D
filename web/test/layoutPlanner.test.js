// Patch Layout (LABS): a face with a character line gets cuts along it, and the patches meet exactly.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutPatches, planLayout } from '../src/layoutPlanner.js';
import { patchFrame } from '../src/classAFit.js';

/** A door-like panel 200 x 120 mm with a character line along y at x = 120 (a 6 mm wide step of 4 mm). */
const panel = (x, y) => 30 - 0.0006 * (x - 100) ** 2 - 0.001 * (y - 60) ** 2 + 4 * Math.tanh((x - 120) / 6);
const grid = (f, m = 97) => Array.from({ length: m }, (_, a) => Array.from({ length: m }, (_, b) => {
    const x = 200 * a / (m - 1), y = 120 * b / (m - 1);
    return [x, y, f(x, y)];
}));

test('a smooth face is one patch', () => {
    const plan = planLayout(grid((x, y) => 30 - 0.0006 * (x - 100) ** 2 - 0.001 * (y - 60) ** 2));
    assert.deepEqual([plan.cutsS.length, plan.cutsT.length], [2, 2]);
    assert.ok(plan.ok);
});

test('cuts fall along the character line, and every patch fits', () => {
    const Q = grid(panel), plan = planLayout(Q);
    console.log(`cuts s ${plan.cutsS.map(a => (200 * a / 96).toFixed(0)).join(', ')} mm · t ${plan.cutsT.join(', ')} · worst ${Math.max(...plan.cells.map(c => c.deviation)).toFixed(4)} mm`);
    assert.ok(plan.ok);
    assert.equal(plan.cutsT.length, 2, 'no cuts across the line: it runs along t');
    const inner = plan.cutsS.slice(1, -1).map(a => 200 * a / 96);
    assert.ok(inner.some(x => Math.abs(x - 120) < 15), `a cut near the line at 120 mm: ${inner}`);
});

test('the layout\'s patches meet exactly and stay within the tolerance', () => {
    const Q = grid(panel), plan = planLayout(Q), { patches } = layoutPatches(Q, plan);
    for (const p of patches) assert.ok(p.deviation <= 0.05, `deviation ${p.deviation}`);
    // Neighbours along s share their side point for point.
    for (let i = 0; i + 1 < patches.length; i++) {
        const A = patches[i].poles, B = patches[i + 1].poles;
        for (const t of [0, 0.3, 1]) {
            const gap = Math.hypot(...patchFrame(A, 5, 1, t).at.map((v, k) => v - patchFrame(B, 5, 0, t).at[k]));
            assert.ok(gap < 1e-9, `gap ${gap}`);
        }
    }
    // ...and in G1: the cross-derivatives either side of each shared side are parallel.
    for (let i = 0; i + 1 < patches.length; i++) {
        const A = patches[i].poles, B = patches[i + 1].poles;
        for (const t of [0.2, 0.5, 0.8]) {
            const a = patchFrame(A, 5, 1, t), b = patchFrame(B, 5, 0, t);
            const n1 = [a.su[1] * a.sv[2] - a.su[2] * a.sv[1], a.su[2] * a.sv[0] - a.su[0] * a.sv[2], a.su[0] * a.sv[1] - a.su[1] * a.sv[0]];
            const n2 = [b.su[1] * b.sv[2] - b.su[2] * b.sv[1], b.su[2] * b.sv[0] - b.su[0] * b.sv[2], b.su[0] * b.sv[1] - b.su[1] * b.sv[0]];
            const c = n1.reduce((s, v, k) => s + v * n2[k], 0) / Math.hypot(...n1) / Math.hypot(...n2);
            assert.ok(Math.acos(Math.min(1, c)) * 180 / Math.PI < 0.05, 'G1 across the cut');
        }
    }
    console.log(patches.map(p => `${p.deviation.toFixed(4)} mm / ${p.inflections} inflections`).join(' | '));
});
