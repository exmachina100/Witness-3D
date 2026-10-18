// The roadmap's three test workflows in the browser build, as crates/w3d-kernel/tests/workflows.rs
// runs them on the desktop: an enclosure, a wing-mirror housing and a grab handle, driven through
// LocalBackend as the app drives it. Every step must leave a valid solid of the expected volume; a
// step that cannot work must fail with a reason and leave the model as it was. Units are mm, Y up.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { loadKernel, oc } from '../src/Kernel.js';

before(async () => { await loadKernel() });

const close = (a, b, eps) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b} (±${eps})`);
const PI = Math.PI;

/** The body as the scene has it, checked valid; its volume. */
function step(be, name, id) {
    const o = oc();
    assert.ok(new o.BRepCheck_Analyzer(be.shapes.get(id), true, false, false).IsValid(), `${name}: the solid is not valid`);
    return be.bodies().find(b => b.id === id).volume;
}

/** A step that must fail: it says why and nothing changes. */
function refused(be, name, id, run) {
    const before = be.revision, v = be.bodies().find(b => b.id === id).volume;
    assert.throws(run, e => typeof e.message === 'string' && e.message.length > 0, `${name}: expected a refusal`);
    assert.equal(be.revision, before, `${name}: the document changed`);
    close(be.bodies().find(b => b.id === id).volume, v, 1e-9);
}

/** Numbers of the body's edges whose every point passes `keep`. */
function edgesWhere(be, id, keep) {
    const b = be.bodies().find(x => x.id === id);
    return b.edges.flatMap((flat, n) => {
        for (let i = 0; i < flat.length; i += 3) if (!keep(flat[i], flat[i + 1], flat[i + 2])) return [];
        return [n];
    });
}

/** Numbers of the body's flat faces facing `normal` through `point`. */
function facesFacing(be, id, point, normal) {
    const b = be.bodies().find(x => x.id === id);
    return b.facePlanes.flatMap((p, n) => p && p.normal.every((v, k) => Math.abs(v - normal[k]) < 1e-9)
        && Math.abs(p.origin.reduce((s, v, k) => s + (v - point[k]) * normal[k], 0)) < 1e-6 ? [n] : []);
}

const yCylinder = (at, down, radius, height) => ({ kind: 'cylinder', frame: { origin: at, x: [1, 0, 0], normal: [0, down ? -1 : 1, 0] }, radius, height });

test('enclosure: rounded box, shelled, ported, bossed and drilled', async () => {
    const be = new LocalBackend();
    // Width along x, depth along normal × x (−z), height along y: the box (−40, 0, −25)–(40, 30, 25).
    const { id: a } = await be.commitPrimitive({ kind: 'box', frame: { origin: [-40, 0, 25], x: [1, 0, 0], normal: [0, 1, 0] }, width: 80, depth: 50, height: 30, op: 'new' });
    close(step(be, 'box', a), 120000, 1e-6);

    const corners = edgesWhere(be, a, () => true).filter(n => {
        const e = be.bodies().find(b => b.id === a).edges[n];
        for (let i = 3; i < e.length; i += 3) if (Math.abs(e[i] - e[0]) > 1e-6 || Math.abs(e[i + 2] - e[2]) > 1e-6) return false;
        return true;
    });
    assert.equal(corners.length, 4);
    await be.commitBlend({ body: a, edges: corners, size: 8, kind: 'fillet' });
    close(step(be, 'corners r8', a), 120000 - 4 * (64 - PI * 16) * 30, 1e-3);

    const top = edgesWhere(be, a, (x, y) => Math.abs(y - 30) < 1e-6);
    assert.equal(top.length, 8);
    refused(be, 'top r40', a, () => be.blend({ body: a, edges: top, size: 40, kind: 'fillet' }, true));
    await be.commitBlend({ body: a, edges: top, size: 3, kind: 'fillet' });
    const rounded = step(be, 'top r3', a);

    const bottom = facesFacing(be, a, [0, 0, 0], [0, -1, 0]);
    assert.equal(bottom.length, 1);
    await be.commitShell({ body: a, faces: bottom, thickness: 2 });
    const shelled = step(be, 'shell 2 mm', a);
    assert.ok(shelled > 0.08 * rounded && shelled < 0.2 * rounded, `${shelled}`);

    await be.commitPrimitive({ kind: 'cylinder', frame: { origin: [0, 15, 30], x: [1, 0, 0], normal: [0, 0, -1] }, radius: 4, height: 10, target: a, op: 'difference' });
    const ported = step(be, 'port r4', a);
    close(ported, shelled - PI * 16 * 2, 1);

    const spots = [[-30, -15], [30, -15], [-30, 15], [30, 15]];
    for (const [x, z] of spots) await be.commitPrimitive({ ...yCylinder([x, 28, z], true, 3.5, 24), target: a, op: 'union' });
    const bossed = step(be, 'bosses', a);
    close(bossed, ported + 4 * PI * 3.5 * 3.5 * 24, 1);
    for (const [x, z] of spots) await be.commitPrimitive({ ...yCylinder([x, 0, z], false, 1.25, 20), target: a, op: 'difference' });
    close(step(be, 'drilled', a), bossed - 4 * PI * 1.25 * 1.25 * 16, 1);

    for (let i = 0; i < 12; i++) be.undo();
    close(be.bodies().find(b => b.id === a).volume, 120000, 1e-6);
});

const oval = (z, w, h) => ({ origin: [0, 10, z], x: [1, 0, 0], normal: [0, 0, 1], kind: 'spline', closed: true,
    points: Array.from({ length: 8 }, (_, i) => [w / 2 * Math.cos(i * PI / 4), h / 2 * Math.sin(i * PI / 4)]) });

test('mirror housing: lofted, shelled open at the door, cap rounded, mirrored', async () => {
    const be = new LocalBackend();
    const { ids: sections } = await be.addCurves([oval(0, 60, 30), oval(40, 90, 50), oval(70, 70, 40)]);
    const { id: a } = await be.commitForm({ kind: 'loft', regions: sections, op: 'new' });
    const lofted = step(be, 'loft', a);
    assert.ok(lofted > PI * 30 * 15 * 70 && lofted < PI * 45 * 25 * 70, `${lofted}`);

    const door = facesFacing(be, a, [0, 10, 0], [0, 0, -1]);
    assert.equal(door.length, 1);
    refused(be, 'shell 40 mm', a, () => be.shell({ body: a, faces: door, thickness: 40 }));
    await be.commitShell({ body: a, faces: door, thickness: 2.5 });
    const shelled = step(be, 'shell 2.5 mm', a);
    assert.ok(shelled < 0.3 * lofted, `${shelled}`);

    const cap = edgesWhere(be, a, (x, y, z) => Math.abs(z - 70) < 1e-6);
    assert.ok(cap.length > 0);
    await be.commitBlend({ body: a, edges: cap, size: 1.5, kind: 'fillet' });
    const rounded = step(be, 'cap r1.5', a);
    assert.ok(rounded < shelled);

    const { ids } = await be.commitMirror({ bodies: [a], origin: [-200, 0, 0], normal: [1, 0, 0], join: false });
    assert.equal(ids.length, 1);
    close(step(be, 'mirror', ids[0]), rounded, 1e-6 * rounded);
});

test('handle: a bar swept along an arch, joined to a plate, the seams rounded', async () => {
    const be = new LocalBackend();
    const { id: plate } = await be.commitPrimitive({ kind: 'box', frame: { origin: [-15, -8, 15], x: [1, 0, 0], normal: [0, 1, 0] }, width: 110, depth: 30, height: 8, op: 'new' });
    close(step(be, 'plate', plate), 26400, 1e-6);

    // The arch through (0, −6), (40, 25) and (80, −6); its centre is (40, c).
    const c = -(1600 + 36 - 625) / 62, r = Math.hypot(40, c + 6);
    const t = [-(c + 6), 40, 0].map(v => v / r);
    const { ids } = await be.addCurves([
        { origin: [0, -6, 0], x: [0, 0, 1], normal: t, kind: 'circle', center: [0, 0], radius: 6 },
        { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1], kind: 'arc', start: [0, -6], mid: [40, 25], end: [80, -6] },
    ]);
    const { id: h } = await be.commitForm({ kind: 'sweep', regions: [ids[0]], path: ids[1], op: 'new' });
    const swept = step(be, 'sweep', h);
    close(swept, PI * 36 * r * 2 * Math.atan2(40, -(c + 6)), 0.005 * swept);

    await be.commitBoolean({ target: plate, tools: [h], op: 'union', keepTools: false });
    const joined = step(be, 'join', plate);
    assert.ok(!be.bodies().some(b => b.id === h), 'the handle is consumed by the join');
    assert.ok(joined > 26400 + 0.8 * swept && joined < 26400 + swept, `${joined}`);

    const seams = edgesWhere(be, plate, (x, y, z) => Math.abs(y) < 1e-6 && (Math.hypot(x, z) < 12 || Math.hypot(x - 80, z) < 12));
    assert.ok(seams.length > 0);
    refused(be, 'seams r30', plate, () => be.blend({ body: plate, edges: seams, size: 30, kind: 'fillet' }, true));
    await be.commitBlend({ body: plate, edges: seams, size: 2, kind: 'fillet' });
    assert.ok(step(be, 'seams r2', plate) > joined);
});
