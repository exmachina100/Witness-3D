// Deform Solid and Sheet in the browser build (deformBody.js), as crates/w3d-kernel/tests/deform.rs.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { blendEdges, box, count, loadKernel, numberedEdges, primitive, tessellate, volume } from '../src/Kernel.js';
import { faceUvn } from '../src/faceUvn.js';
import { deformBodies, deformReblend } from '../src/deformBody.js';
import { LocalBackend } from '../src/app/LocalBackend.js';

before(async () => { await loadKernel() });

const plate = () => box({ x: -50, y: -50, z: -5 }, { x: 50, y: 50, z: 0 });
const block = () => box({ x: -5, y: -5, z: 0 }, { x: 5, y: 5, z: 4 });
/** The face of `s` whose middle is nearest `p`. */
const faceNear = (s, p) => {
    let best = -1, d = Infinity;
    for (let f = 0; f < count(s, 'TopAbs_FACE'); f++) {
        const q = faceUvn(s, f, true, [[0.5, 0.5, 0]]).points[0], e = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
        if (e < d) { d = e; best = f; }
    }
    return best;
};

test('a block on a plate wraps onto a ball', () => {
    const p = plate(), top = faceNear(p, [0, 0, 0]);
    const ball = primitive({ kind: 'sphere', center: [0, 0, 0], radius: 20 });
    const [b] = deformBodies([block()], p, top, ball, 0);
    assert.ok(volume(b) > 0, String(volume(b)));
    const pos = tessellate(b, { deflection: 0.01 }).mesh.getAttribute('position').array;
    for (let i = 0; i < pos.length; i += 3) {
        const r = Math.hypot(pos[i], pos[i + 1], pos[i + 2]);
        assert.ok(r > 20 - 1e-2 && r < 24 + 1e-2, `${r}`);
    }
});

test('mirrored bodies stay right way out', () => {
    const p = plate(), top = faceNear(p, [0, 0, 0]);
    const [b] = deformBodies([block()], p, top, p, top, { mirror: true });
    assert.ok(Math.abs(volume(b) - 400) < 1e-3, String(volume(b)));
});

test('scale stretches the block about its middle', () => {
    const p = plate(), top = faceNear(p, [0, 0, 0]);
    const [b] = deformBodies([block()], p, top, p, top, { scale: [2, 1, 1] });
    assert.ok(Math.abs(volume(b) - 800) < 1e-3, String(volume(b)));
});

test('the backend previews and commits a deform in place, or keeps the body', async () => {
    const be = new LocalBackend();
    be.put(1, plate());
    const id = be.nextId++;
    be.put(id, block());
    const top = faceNear(be.shapes.get(1), [0, 0, 0]);
    const req = { bodies: [id], reference: 1, rface: top, target: 1, tface: top, scale: [1, 1, 2], offset: [0, 0, 0], mirror: false, swap: false, normal: false, reblend: false, keep: false };
    const shown = await be.previewDeform(req);
    assert.equal(shown.length, 1);
    const { ids } = await be.commitDeform(req);
    assert.deepEqual(ids, [id]);
    assert.ok(Math.abs(volume(be.shapes.get(id)) - 800) < 1e-3);
    const kept = await be.commitDeform({ ...req, keep: true });
    assert.notEqual(kept.ids[0], id);
});

test('a cylinder deforms across its seam', () => {
    const p = plate(), top = faceNear(p, [0, 0, 0]);
    const cyl = primitive({ kind: 'cylinder', frame: { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] }, radius: 5, height: 4 });
    const [b] = deformBodies([cyl], p, top, p, top, { scale: [2, 1, 1] });
    assert.ok(Math.abs(volume(b) - 2 * Math.PI * 100) < 0.05, String(volume(b)));
});

test('Reblend makes stretched fillets round again, as crates/w3d-kernel/tests/deform.rs', async () => {
    const p = plate(), top = faceNear(p, [0, 0, 0]);
    const round = (a, b) => { const s = box(a, b); return blendEdges(s, numberedEdges(s).map((_, i) => i), 1); };
    // A 10 × 10 × 4 block, every edge rounded at 1 mm, stretched to twice its length along U.
    const block = round({ x: -5, y: -5, z: 0 }, { x: 5, y: 5, z: 4 });
    const o = { scale: [2, 1, 1] };
    const [plain] = deformBodies([block], p, top, p, top, o);
    const [again] = deformReblend([block], p, top, p, top, o);
    // Reblended, it is the 20 × 10 × 4 block rounded at 1 mm; stretched, its rounds are wider.
    const want = volume(round({ x: -10, y: -5, z: 0 }, { x: 10, y: 5, z: 4 }));
    assert.ok(Math.abs(volume(again) - want) < 0.05, `${volume(again)} ${want}`);
    assert.ok(volume(plain) < want - 0.5, `${volume(plain)} ${want}`);
    assert.equal(count(again, 'TopAbs_FACE'), count(block, 'TopAbs_FACE'));
    // A body with no fillets deforms as before.
    const [bare] = deformReblend([box({ x: -5, y: -5, z: 0 }, { x: 5, y: 5, z: 4 })], p, top, p, top, o);
    assert.ok(Math.abs(volume(bare) - 800) < 1e-3, String(volume(bare)));
    // The backend takes Reblend now.
    const be = new LocalBackend();
    be.put(1, plate());
    const id = be.nextId++;
    be.put(id, block);
    const shown = await be.previewDeform({ bodies: [id], reference: 1, rface: top, target: 1, tface: top, scale: [2, 1, 1], offset: [0, 0, 0], reblend: true });
    assert.ok(Math.abs(shown[0].volume - want) < 0.1);
});
