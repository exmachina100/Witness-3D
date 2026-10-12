import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { loadKernel } from '../src/Kernel.js';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { endTangent, helixPoints, spiralAngle, tangentArc } from '../src/curves.js';

before(async () => { await loadKernel() });

// The same numbers as crates/w3d-kernel/tests/round6.rs.
const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const frustum = (a, b, d, h) => h / 6 * (a * b + (a - 2 * d) * (b - 2 * d) + 4 * (a - d) * (b - d));

test("offset face's adjacent angle leans the sides about their far edges", async () => {
    const be = new LocalBackend();
    const [b] = be.bodies();
    const top = b.facePlanes.findIndex(p => p && p.normal[1] > 0.99);
    const refs = [...b.faceRefs], lean = Math.atan(5 / 30);
    close((await be.previewOffset({ body: 1, faces: [top], distance: 0, angle: lean })).volume, frustum(80, 50, 5, 30), 0.5);
    close((await be.previewOffset({ body: 1, faces: [top], distance: 0, angle: -lean })).volume, frustum(80, 50, -5, 30), 0.5);
    const { scene } = await be.commitOffset({ body: 1, faces: [top], distance: 5, angle: lean });
    close(scene[0].volume, frustum(80, 50, 35 * 5 / 30, 35), 0.5);
    assert.equal(scene[0].facePlanes.length, 6);
    for (const r of refs) assert.ok(scene[0].faceRefs.includes(r), 'every face keeps its ref');
    await assert.rejects(be.commitOffset({ body: 1, faces: [top], distance: 0, angle: Math.PI / 2 }));
});

test('a circle swept along a spiral makes a spring', async () => {
    const be = new LocalBackend();
    const pitch = 10, tangent = [0, pitch / (2 * Math.PI), -10], l = Math.hypot(...tangent);
    const { ids: [ring, spring] } = await be.addCurves([
        { origin: [10, 0, 0], x: [1, 0, 0], normal: tangent.map(v => v / l), kind: 'circle', center: [0, 0], radius: 1 },
        { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'spiral', radius: 10, length: 20, turns: 2 },
    ]);
    const length = 2 * Math.hypot(2 * Math.PI * 10, 10);
    const f = await be.previewForm({ regions: [ring], kind: 'sweep', path: spring });
    close(f.tool.volume, Math.PI * length, Math.PI * length * 0.01);
    await assert.rejects(be.addCurves([{ origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'spiral', radius: 10, length: 20, turns: 0 }]));
});

test('spiral points climb its length over its turns, and its angle is the climb', () => {
    const c = { radius: 10, length: 20, turns: 2 };
    const p = helixPoints(c, 4);
    assert.deepEqual(p[0], [10, 0, 0]);
    close(p.at(-1)[2], 20);
    close(p[1][1], 10);
    close(helixPoints({ ...c, left: true }, 4)[1][1], -10);
    close(Math.tan(spiralAngle(c)), 10 / (2 * Math.PI * 10));
});

test('a tangent arc leaves the end of a line along it', () => {
    const [p, dir] = endTangent({ kind: 'polyline', points: [[0, 0], [5, 0]], closed: false }, true);
    assert.deepEqual(p, [5, 0]);
    const arc = tangentArc(p, dir, [5, 10]);
    close(arc.radius, 5);
    assert.deepEqual(arc.mid.map(v => +v.toFixed(9)), [10, 5]);
    assert.equal(tangentArc(p, dir, [9, 0]), null);
    assert.equal(endTangent({ kind: 'circle', center: [0, 0], radius: 1 }, true), null);
});
