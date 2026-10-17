// Pipe (Plasticity's Pipe) in the browser build: a tube along a curve, round or polygonal, solid
// or hollow. The desktop's tests are crates/w3d-kernel/tests/pipe.rs.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { bounds, loadKernel, volume } from '../src/Kernel.js';

before(async () => { await loadKernel() });

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
/** A straight line 10 long up the Z axis, drawn on the XZ plane. */
async function line(be) {
    const { ids: [id] } = await be.addCurves([{ origin: [0, 0, 0], x: [1, 0, 0], normal: [0, -1, 0], kind: 'polyline', points: [[0, 0], [0, 10]], closed: false }]);
    return id;
}

test('a straight pipe is a cylinder, solid or hollow', async () => {
    const be = new LocalBackend();
    const c = await line(be);
    const [solid] = be.pipeResult({ curves: [c], radius: 2 });
    close(volume(solid), Math.PI * 4 * 10, 1e-3);
    const [hollow] = be.pipeResult({ curves: [c], radius: 2, thickness: 0.5 });
    close(volume(hollow), Math.PI * (4 - 2.25) * 10, 1e-3);
    const b = bounds(solid);
    close(b.max.x - b.min.x, 4, 1e-3);
});

test('a four-sided pipe has its corners on the radius', async () => {
    const be = new LocalBackend();
    const c = await line(be);
    const [square] = be.pipeResult({ curves: [c], radius: 2, sides: 4 });
    // A square with corners 2 from the centre has side 2√2, so area 8.
    close(volume(square), 8 * 10, 1e-6);
});

test('a pipe round a circle is a torus', async () => {
    const be = new LocalBackend();
    const { ids: [ring] } = await be.addCurves([{ origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'circle', center: [0, 0], radius: 10 }]);
    const [torus] = be.pipeResult({ curves: [ring], radius: 1 });
    close(volume(torus), 2 * Math.PI ** 2 * 10 * 1, 0.05);
});

test('bad sizes are refused, and commit adds one body per curve in one undo step', async () => {
    const be = new LocalBackend();
    const c = await line(be);
    assert.throws(() => be.pipeResult({ curves: [c], radius: 0 }), /radius/);
    assert.throws(() => be.pipeResult({ curves: [c], radius: 2, thickness: 2 }), /thick/);
    assert.throws(() => be.pipeResult({ curves: [c], radius: 2, sides: 2 }), /sides/);
    const before = be.shapes.size;
    const { ids, scene } = await be.commitPipe({ curves: [c], radius: 1 });
    assert.equal(ids.length, 1);
    assert.ok(scene.find(b => b.id === ids[0]));
    assert.ok(be.curveMap.has(c));
    await be.undo();
    assert.equal(be.shapes.size, before);
});
