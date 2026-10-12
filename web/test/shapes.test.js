import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { loadKernel } from '../src/Kernel.js';
import { LocalBackend } from '../src/app/LocalBackend.js';

before(async () => { await loadKernel() });

// The same numbers as crates/w3d-kernel/tests/shapes.rs.
const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const frustum = (a, b, h) => h / 3 * (a + b + Math.sqrt(a * b));
const on = (y, shape) => ({ origin: [0, y, 0], x: [1, 0, 0], normal: [0, 1, 0], ...shape });
const square = (s, y = 30) => on(y, { kind: 'polyline', points: [[-s / 2, -s / 2], [s / 2, -s / 2], [s / 2, s / 2], [-s / 2, s / 2]], closed: true });
const lean = Math.atan(1 / 5);

test('Extrude leans its sides with A, leaves walls with Shift+T and goes both ways with S', async () => {
    const be = new LocalBackend();
    const { ids: [sq] } = await be.addCurves([square(10, 100)]);
    const vol = async opts => (await be.preview({ region: sq, distance: 5, ...opts })).tool.volume;
    close(await vol({ angle: lean }), frustum(100, 64, 5));
    close(await vol({ thickness: 1 }), 180);
    close(await vol({ angle: lean, thickness: 1 }), frustum(100, 64, 5) - frustum(64, 36, 5));
    close(await vol({ back: 5 }), 1000);
    close(await vol({ back: 5, angle: lean }), 2 * frustum(100, 64, 5));
    close(await vol({ distance: -5, back: 2 }), 700);
    await assert.rejects(vol({ angle: Math.PI / 2 }), /90 degrees/);
    await assert.rejects(vol({ thickness: 6 }), /shrunk/);
});

test('a face extrudes with an angle', async () => {
    const be = new LocalBackend();
    const top = be.body(1, be.shapes.get(1)).facePlanes.findIndex(p => p && p.normal[1] > 0.99);
    const p = await be.preview({ target: 1, face: top, distance: 10, angle: Math.atan(0.1), op: 'new' });
    close(p.tool.volume, 10 / 6 * (4000 + 4 * 79 * 49 + 78 * 48), 0.05);
});

test('Shift+Q slices the body in two as one step', async () => {
    const be = new LocalBackend();
    const { ids: [r] } = await be.addCurves([on(30, { kind: 'polyline', points: [[-10, -5], [10, -5], [10, 5], [-10, 5]], closed: true })]);
    const p = await be.preview({ target: 1, region: r, distance: -30, op: 'slice' });
    assert.equal(p.outcome, 'slice');
    close(p.result.volume, 114000, 0.01);
    close(p.piece.volume, 6000, 0.01);
    const { scene } = await be.commit({ target: 1, region: r, distance: -30, op: 'slice' });
    assert.equal(scene.length, 2);
    assert.equal((await be.undo()).length, 1);
    await assert.rejects(be.preview({ target: 1, region: r, distance: 10, op: 'slice' }), /does not cut/);
});

test('splines and arcs are drawn, checked and used', async () => {
    const be = new LocalBackend();
    const blob = on(100, { kind: 'spline', points: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true });
    const arc = on(100, { kind: 'arc', start: [0, 0], mid: [5, 5], end: [10, 0] });
    const { ids: [b, a] } = await be.addCurves([blob, arc]);
    close((await be.preview({ region: b, distance: 5 })).tool.volume, 800.0146, 0.01);
    await assert.rejects(be.preview({ region: a, distance: 5 }), /closed curve/);
    for (const bad of [{ kind: 'arc', start: [0, 0], mid: [1, 0], end: [2, 0] }, { kind: 'spline', points: [[0, 0]], closed: false }, { kind: 'spline', points: [[0, 0], [0, 0], [1, 1]], closed: true }])
        await assert.rejects(be.addCurves([on(0, bad)]));
    // A ⌀4 rod swept half way round a circle of radius 20 (Pappus: area × the centre's path).
    const rod = { origin: [0, 0, 0], x: [0, 1, 0], normal: [1, 0, 0], kind: 'circle', center: [0, 0], radius: 2 };
    const half = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'arc', start: [0, 0], mid: [20, -20], end: [0, -40] };
    const { ids: [rd, hp] } = await be.addCurves([rod, half]);
    const s = await be.previewForm({ regions: [rd], kind: 'sweep', path: hp });
    close(s.tool.volume, Math.PI * 4 * Math.PI * 20, 0.05);
});
