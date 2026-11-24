import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { box, loadKernel, volume } from '../src/Kernel.js';
import { facePoles } from '../src/facePoles.js';
import { moveFacePoles } from '../src/movePoles.js';
import { rebuildFaces } from '../src/rebuildFace.js';
before(async () => { await loadKernel() });
// Faces of different degrees sharing an edge (Rebuild Face on each): a point on the edge moves and the
// neighbour follows, as on the desktop (tests/api.rs).
test('a shared-edge point moves between faces of different degrees', () => {
  for (const sideHow of [null, [1, 1], [2, 2], [3, 4], [5, 1]]) {
    let b = box({ x: 0, y: 0, z: 0 }, { x: 50, y: 50, z: 50 });
    const nets0 = facePoles(b);
    const faceWhere = (nets, test) => nets.findIndex(r => r.flat().length && r.flat().every(test));
    let topN = faceWhere(nets0, p => Math.abs(p[2] - 50) < 1e-6);
    b = rebuildFaces(b, [topN], { explicit: true, degree: [3, 3], spans: [4, 4] }).shape;
    if (sideHow) { const nets = facePoles(b); const s = faceWhere(nets, p => Math.abs(p[0] - 50) < 1e-6); b = rebuildFaces(b, [s], { explicit: true, degree: [sideHow[0], sideHow[0]], spans: [sideHow[1], sideHow[1]] }).shape; }
    const nets = facePoles(b);
    topN = nets.findIndex(r => r.length === 7 && r.flat().every(p => Math.abs(p[2] - 50) < 1e-6));
    const flat = nets[topN].flat();
    const edge = flat.map((p, i) => [p, i]).filter(([p]) => Math.abs(p[0] - 50) < 1e-6).map(([, i]) => i);
    const mid = edge[edge.length >> 1];
    const m = moveFacePoles(b, [[topN, mid, [0, 0, 10]]]);
    assert.ok(volume(m) > 125000 + 100, `side ${sideHow}: ${volume(m)}`);
  }
});
