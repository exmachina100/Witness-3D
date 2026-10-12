import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { loadKernel } from '../src/Kernel.js';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { join } from '../src/curves.js';

before(async () => { await loadKernel() });

// The same numbers as crates/w3d-kernel/tests/round5.rs.
const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const ground = shape => ({ origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0], ...shape });
const line = (a, b) => ground({ kind: 'polyline', points: [a, b], closed: false });

test('an ellipse extrudes to π R r h whichever radius is longer', async () => {
    const be = new LocalBackend();
    const { ids: [wide, tall] } = await be.addCurves([ground({ kind: 'ellipse', center: [0, 0], major: [10, 0], minor: 4 }), ground({ kind: 'ellipse', center: [1, 2], major: [0, 3], minor: 6 })]);
    close((await be.preview({ region: wide, distance: 5, op: 'new' })).tool.volume, Math.PI * 200, 0.5);
    close((await be.preview({ region: tall, distance: 5, op: 'new' })).tool.volume, Math.PI * 90, 0.5);
    await assert.rejects(be.addCurves([ground({ kind: 'ellipse', center: [0, 0], major: [0, 0], minor: 1 })]));
});

test('J joins a line and an arc into a region, as one undo step', async () => {
    const be = new LocalBackend();
    const { ids } = await be.addCurves([line([0, -5], [0, 5]), ground({ kind: 'arc', start: [0, -5], mid: [5, 0], end: [0, 5] })]);
    const { ids: joined } = await be.joinCurves(ids);
    assert.equal(joined.length, 1);
    const c = be.curves().find(x => x.id === joined[0]);
    assert.equal(c.kind, 'contour');
    assert.ok(c.samples.length > 10);
    close((await be.preview({ region: joined[0], distance: 2, op: 'new' })).tool.volume, 25 * Math.PI, 0.1);
    be.undo();
    assert.deepEqual(be.curves().map(x => x.id), ids);
});

test('join makes one closed line from lines in any order and keeps separate runs apart', () => {
    const sq = join([line([10, 0], [10, 10]), line([0, 0], [10, 0]), line([0, 10], [0, 0]), line([0, 10], [10, 10])]);
    assert.equal(sq.length, 1);
    assert.equal(sq[0].kind, 'polyline');
    assert.ok(sq[0].closed);
    assert.equal(sq[0].points.length, 4);
    assert.equal(join([line([0, 0], [5, 0]), line([6, 0], [6, 5])]).length, 2);
    assert.throws(() => join([ground({ kind: 'circle', center: [0, 0], radius: 1 }), line([0, 0], [1, 0])]), /two ends/);
    assert.throws(() => join([line([0, 0], [5, 0]), { ...line([5, 0], [5, 5]), origin: [0, 1, 0] }]), /one plane/);
});

test('a face with a hole takes an angle and a thickness', async () => {
    const be = new LocalBackend();
    const { ids: [rod] } = await be.addCurves([{ origin: [0, -1, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'circle', center: [0, 0], radius: 5 }]);
    await be.commit({ target: 1, region: rod, distance: 40, op: 'difference' });
    const top = be.body(1, be.shapes.get(1)).facePlanes.findIndex(p => p && p.normal[1] > 0.99 && Math.abs(p.origin[1] - 30) < 1e-6);
    const walls = await be.preview({ target: 1, face: top, distance: 10, thickness: 1, op: 'new' });
    close(walls.tool.volume, (4000 - 78 * 48 + Math.PI * 11) * 10, 0.5);
    const lean = await be.preview({ target: 1, face: top, distance: 10, angle: Math.atan(0.1), op: 'new' });
    close(lean.tool.volume, 10 / 6 * (4000 + 4 * 79 * 49 + 78 * 48) - Math.PI * 10 / 3 * 91, 0.5);
});

test('Revolve takes a thickness', async () => {
    const be = new LocalBackend();
    const { ids: [r] } = await be.addCurves([ground({ kind: 'polyline', points: [[10, -5], [20, -5], [20, 5], [10, 5]], closed: true })]);
    const p = await be.previewForm({ regions: [r], kind: 'revolve', axisPoint: [0, 0, 0], axisDir: [0, 0, 1], angle: 2 * Math.PI, thickness: 1 });
    close(p.tool.volume, Math.PI * 3000 - Math.PI * 240 * 8, 2);
});

test('Boolean Shift+Q slices the target by each tool as one step', async () => {
    const be = new LocalBackend();
    const { ids: [copy] } = await be.duplicateBodies([1]);
    await be.commitMotion({ bodies: [copy], offset: [60, 0, 0] });
    const p = await be.previewBoolean({ target: 1, tools: [copy], op: 'slice' });
    close(p.volume, 90000, 0.01);
    close(p.pieces[0].volume, 30000, 0.01);
    const { scene } = await be.commitBoolean({ target: 1, tools: [copy], op: 'slice' });
    assert.equal(scene.length, 2);
    close(scene.reduce((a, b) => a + b.volume, 0), 120000, 0.01);
});
