// Edge loops (Alt+click), rings (Ctrl+Alt+click) and Select Adjacent on bodies as the app shows them.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { loadKernel } from '../src/Kernel.js';
import { adjacent, edgeLoop, edgeRing, topology } from '../src/app/edgeLoops.js';

before(async () => { await loadKernel() });

// The seed block: x −40..40, y 0..30, z −25..25.
const mid = (b, n) => { const e = b.edges[n], k = Math.floor(e.length / 6) * 3; return [0, 1, 2].map(i => (e[i] + e[e.length - 3 + i]) / 2); };
const find = (b, pick) => b.edges.findIndex((_, n) => pick(mid(b, n)));
const near = (a, b) => Math.abs(a - b) < 1e-6;

test('a box: each edge is its own loop, and its ring is the four edges parallel to it', () => {
    const be = new LocalBackend(), b = be.scene()[0];
    const e = find(b, p => near(p[1], 30) && near(p[2], 25));
    assert.ok(e >= 0);
    assert.deepEqual(edgeLoop(b, e), [e]);
    const ring = edgeRing(b, e);
    assert.equal(ring.length, 4);
    assert.ok(ring.every(n => near(Math.abs(mid(b, n)[0]), 0)), 'all run along x');
    assert.equal(topology(b).info.filter(i => i.faces.length === 2).length, 12);
});

test('a box with one upright edge rounded: a top edge\'s loop runs on round the arc to the next edge', async () => {
    const be = new LocalBackend(), b0 = be.scene()[0];
    const upright = find(b0, p => near(p[0], 40) && near(p[2], 25));
    await be.commitBlend({ body: b0.id, edges: [upright], size: 5, kind: 'fillet' });
    const b = be.scene()[0];
    assert.ok(topology(b).info.every(i => i.faces.length === 2), 'every edge between two faces');
    const e = find(b, p => near(p[1], 30) && near(p[2], 25));
    const loop = edgeLoop(b, e);
    assert.equal(loop.length, 3, 'the front top edge, the arc and the side top edge');
    assert.ok(loop.every(n => near(mid(b, n)[1], 30)));
});

test('Select Adjacent: a face gains the faces beside it, an edge the edges at its corners', () => {
    const be = new LocalBackend(), b = be.scene()[0];
    const top = b.facePlanes.findIndex(p => p && p.normal[1] > 0.999);
    assert.equal(adjacent(b, 'face', [top]).length, 5);
    const e = find(b, p => near(p[1], 30) && near(p[2], 25));
    assert.equal(adjacent(b, 'edge', [e]).length, 5);
});
