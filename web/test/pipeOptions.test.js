// Pipe's Angle, Scale and booleans (Q union, W difference) in the browser build.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { bounds, box, loadKernel, volume } from '../src/Kernel.js';

before(async () => { await loadKernel() });

const close = (a, b, eps) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
/** A straight line from z -10 to 10, drawn on the XZ plane. */
async function line(be) {
    const { ids: [id] } = await be.addCurves([{ origin: [0, 0, 0], x: [1, 0, 0], normal: [0, -1, 0], kind: 'polyline', points: [[0, -10], [0, 10]], closed: false }]);
    return id;
}

test('Angle turns a polygon section and Scale tapers the pipe', async () => {
    const be = new LocalBackend();
    const c = await line(be);
    const [bar] = be.pipeResult({ curves: [c], radius: 2, sides: 4, angle: Math.PI / 4 });
    close(volume(bar), 8 * 20, 1e-6);
    const b = bounds(bar);
    close(b.max.x - b.min.x, Math.sqrt(8), 1e-3);
    const [cone] = be.pipeResult({ curves: [c], radius: 2, scale: 0.5 });
    close(volume(cone), Math.PI * 20 / 3 * (4 + 2 + 1), 0.05);
    assert.throws(() => be.pipeResult({ curves: [c], radius: 2, scale: 0 }), /scale/);
});

test('Pipe cuts or joins a target body in one undo step, keeping the tube when asked', async () => {
    const be = new LocalBackend();
    const c = await line(be);
    const id = be.nextId++;
    be.put(id, box({ x: -5, y: -5, z: -5 }, { x: 5, y: 5, z: 5 }));
    let r = await be.commitPipe({ curves: [c], radius: 1, op: 'difference', target: id });
    assert.deepEqual(r.ids, [id]);
    close(volume(be.shapes.get(id)), 1000 - Math.PI * 10, 0.05);
    await be.undo();
    close(volume(be.shapes.get(id)), 1000, 1e-6);
    r = await be.commitPipe({ curves: [c], radius: 1, op: 'union', target: id, keepTools: true });
    assert.equal(r.ids.length, 2);
    close(volume(be.shapes.get(id)), 1000 + Math.PI * 10, 0.05);
});
