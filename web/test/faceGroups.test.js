// Smart clicks: related faces (Alt+click), parallel faces (Ctrl+Alt+click), curves on one plane.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { loadKernel } from '../src/Kernel.js';
import { topology } from '../src/app/edgeLoops.js';
import { parallelCylinders, parallelFlatFaces, relatedFaces, samePlane } from '../src/app/faceGroups.js';

before(async () => { await loadKernel() });

const mid = (b, n) => { const e = b.edges[n]; return [0, 1, 2].map(i => (e[i] + e[e.length - 3 + i]) / 2); };
const near = (a, b) => Math.abs(a - b) < 1e-6;

test('a plain box: each face is related to itself only; parallel faces come in pairs', () => {
    const b = new LocalBackend().scene()[0];
    const top = b.facePlanes.findIndex(p => p && p.normal[1] > 0.999);
    assert.deepEqual(relatedFaces(b, top, topology(b)), [top]);
    const par = parallelFlatFaces(b.facePlanes, top);
    assert.equal(par.length, 2);
    assert.ok(par.every(n => Math.abs(b.facePlanes[n].normal[1]) > 0.999));
});

test('a rounded edge: the fillet and the two faces it blends are related', async () => {
    const be = new LocalBackend(), b0 = be.scene()[0];
    const upright = b0.edges.findIndex((_, n) => near(mid(b0, n)[0], 40) && near(mid(b0, n)[2], 25));
    await be.commitBlend({ body: b0.id, edges: [upright], size: 5, kind: 'fillet' });
    const b = be.scene()[0];
    const round = b.facePlanes.findIndex(p => !p);
    const rel = relatedFaces(b, round, topology(b));
    assert.equal(rel.length, 3, `fillet + two sides, got ${rel}`);
    const top = b.facePlanes.findIndex(p => p && p.normal[1] > 0.999);
    assert.deepEqual(relatedFaces(b, top, topology(b)), [top]);
});

test('parallel cylinders by axis', () => {
    const s = [{ kind: 'plane' }, { kind: 'cylinder', axis: [0, 1, 0] }, { kind: 'cylinder', axis: [0, -1, 0] }, { kind: 'cylinder', axis: [1, 0, 0] }];
    assert.deepEqual(parallelCylinders(s, 1), [1, 2]);
});

test('same plane: coplanar either way round, not offset or tilted', () => {
    const a = { origin: [0, 0, 0], normal: [0, 0, 1] };
    assert.ok(samePlane(a, { origin: [5, 3, 0], normal: [0, 0, -1] }));
    assert.ok(!samePlane(a, { origin: [5, 3, 1], normal: [0, 0, 1] }));
    assert.ok(!samePlane(a, { origin: [0, 0, 0], normal: [0, 1, 1] }));
});
