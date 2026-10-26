import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { loadKernel } from '../src/Kernel.js';
import { limitEdges, mergeShortEdges, toObj, toStl } from '../src/meshExport.js';

before(async () => { await loadKernel() });

// One right triangle in the viewport's x/z ground plane, facing up (+y).
const tri = { name: 'T', positions: [0, 0, 0, 0, 0, -10, 10, 0, 0], indices: [0, 2, 1] };

test('OBJ lists vertices in user axes and 1-based faces per object', () => {
    const obj = toObj([tri, { ...tri, name: 'U' }]);
    const lines = obj.trim().split('\n');
    assert.equal(lines.filter(l => l.startsWith('v ')).length, 6);
    assert.deepEqual(lines.filter(l => l.startsWith('f ')), ['f 1 3 2', 'f 4 6 5']);
    assert.ok(lines.includes('o T') && lines.includes('o U'));
    // Viewport (0, 0, -10) is the user's y = 10 (back), z up.
    assert.ok(lines.includes('v 0 10 0'));
});

test('binary STL has the header, count and an upward normal', () => {
    const b = toStl([tri]);
    assert.equal(b.length, 84 + 50);
    const dv = new DataView(b.buffer);
    assert.equal(dv.getUint32(80, true), 1);
    // The triangle faces viewport +y, which is the user's +z.
    assert.ok(Math.abs(dv.getFloat32(84 + 8, true) - 1) < 1e-6);
});

test('max width splits long edges, keeping the area', () => {
    const area = (p, ix) => { let s = 0; for (let i = 0; i < ix.length; i += 3) { const [a, b, c] = [ix[i], ix[i + 1], ix[i + 2]].map(k => p.slice(3 * k, 3 * k + 3)); const u = b.map((v, j) => v - a[j]), w = c.map((v, j) => v - a[j]); s += Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2; } return s; };
    const m = limitEdges(tri.positions, tri.indices, 3);
    assert.ok(m.indices.length / 3 > 8);
    for (let i = 0; i < m.indices.length; i += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
        const p = m.indices[i + a], q = m.indices[i + b];
        assert.ok(Math.hypot(m.positions[3 * p] - m.positions[3 * q], m.positions[3 * p + 1] - m.positions[3 * q + 1], m.positions[3 * p + 2] - m.positions[3 * q + 2]) <= 3 + 1e-9);
    }
    assert.ok(Math.abs(area(m.positions, m.indices) - 50) < 1e-9);
});

test('the backend meshes finer at a smaller tolerance', async () => {
    const be = new LocalBackend();
    await be.commitPrimitive({ kind: 'sphere', center: [0, 100, 0], radius: 10 });
    const id = be.scene().at(-1).id;
    const [coarse] = await be.meshBodies([id], { tolerance: 1, angle: 0.5 });
    const [fine] = await be.meshBodies([id], { tolerance: 0.01, angle: 0.1 });
    assert.ok(fine.indices.length > 4 * coarse.indices.length, `${fine.indices.length} vs ${coarse.indices.length}`);
    await assert.rejects(async () => be.meshBodies([999], { tolerance: 0.1 }), /no longer exists/);
});

test('OBJ Scale and Up Axis', () => {
    const lines = toObj([tri], undefined, { scale: 0.1, up: 'y' }).trim().split('\n');
    // Y up: the viewport's own axes, every coordinate a tenth.
    assert.ok(lines.includes('v 0 0 -1') && lines.includes('v 1 0 0'), lines.join('|'));
    assert.ok(toObj([tri], undefined, { scale: 2 }).includes('v 0 20 0'));
});

test('min width merges short edges and drops the triangles that collapse', () => {
    // A strip of two triangles whose right side is 0.05 long: merged, one triangle goes.
    const m = mergeShortEdges([0, 0, 0, 10, 0, 0, 10, 0.05, 0, 0, 10, 0], [0, 1, 2, 0, 2, 3], 0.1);
    assert.equal(m.indices.length, 3);
    assert.equal(m.positions.length, 9);
    const same = mergeShortEdges([0, 0, 0, 10, 0, 0, 10, 0.05, 0, 0, 10, 0], [0, 1, 2, 0, 2, 3], 0);
    assert.equal(same.indices.length, 6);
});
