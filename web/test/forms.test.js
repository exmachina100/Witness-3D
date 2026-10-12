import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { loadKernel } from '../src/Kernel.js';
import { LocalBackend } from '../src/app/LocalBackend.js';

before(async () => { await loadKernel() });

const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
/** A square drawn on the enclosure's top face (y = 30), and a line from its centre straight up. */
const square = (s, y = 30) => ({ origin: [0, y, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'polyline', points: [[-s / 2, -s / 2], [s / 2, -s / 2], [s / 2, s / 2], [-s / 2, s / 2]], closed: true });
const up = { origin: [0, 30, 0], x: [1, 0, 0], normal: [0, 0, 1], kind: 'polyline', points: [[0, 0], [0, 20]], closed: false };

test('sweep joins a boss along a path, and is a new body unless asked', async () => {
    const be = new LocalBackend();
    const { ids: [sq, path] } = await be.addCurves([square(10), up]);
    const fresh = await be.previewForm({ target: 1, regions: [sq], kind: 'sweep', path });
    assert.equal(fresh.outcome, 'new');
    close(fresh.tool.volume, 2000, 0.5);
    const { id, scene } = await be.commitForm({ target: 1, regions: [sq], kind: 'sweep', path, op: 'union' });
    assert.equal(id, 1);
    close(scene[0].volume, 122000, 0.5);
    // A twisted sweep keeps area × length; a tapered one makes a frustum.
    close((await be.previewForm({ regions: [sq], kind: 'sweep', path, twist: Math.PI / 4 })).tool.volume, 2000, 20);
    close((await be.previewForm({ regions: [sq], kind: 'sweep', path, scale: 0.5 })).tool.volume, 20 / 3 * (100 + 25 + 50), 2);
    await assert.rejects(be.previewForm({ regions: [sq], kind: 'sweep', path: sq }), /other than the profile/);
});

test('revolve cuts a half drum and loft builds a frustum', async () => {
    const be = new LocalBackend();
    const { ids: [sq, top] } = await be.addCurves([square(10), square(5, 50)]);
    const cut = await be.previewForm({ target: 1, regions: [sq], kind: 'revolve', axisPoint: [5, 30, 0], axisDir: [0, 0, 1], angle: Math.PI, op: 'difference' });
    assert.equal(cut.outcome, 'cut');
    close(cut.result.volume, 120000 - Math.PI * 100 * 10 / 2, 1);
    const l = await be.previewForm({ regions: [sq, top], kind: 'loft' });
    close(l.tool.volume, 20 / 3 * (100 + 25 + 50), 1);
    await assert.rejects(be.previewForm({ regions: [sq], kind: 'loft' }), /two regions/);
});

test('offset face pushes the flat top up and keeps its ref', async () => {
    const be = new LocalBackend();
    const [b] = be.bodies();
    const top = b.facePlanes.findIndex(p => p && p.normal[1] > 0.99);
    const ref = b.faceRefs[top];
    close((await be.previewOffset({ body: 1, faces: [top], distance: -5 })).volume, 100000);
    const { scene } = await be.commitOffset({ body: 1, faces: [top], distance: 5 });
    close(scene[0].volume, 140000);
    const moved = scene[0].facePlanes.findIndex(p => p && p.normal[1] > 0.99 && Math.abs(p.origin[1] - 35) < 1e-6);
    assert.equal(scene[0].faceRefs[moved], ref);
});
