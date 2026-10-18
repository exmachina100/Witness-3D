// Plasticity's Isoparam in the browser build: a face's u or v curve through a point, cut to the face.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { loadKernel, numbered, oc, primitive } from '../src/Kernel.js';
import { isoparam } from '../src/Project.js';

before(async () => { await loadKernel() });

const ground = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0] };

test('on a cylinder side: the ring round it and the line along it, both cut to the face', () => {
    const o = oc();
    const cyl = primitive({ kind: 'cylinder', frame: ground, radius: 5, height: 10 });
    const side = numbered(cyl, 'TopAbs_FACE').findIndex(f => new o.BRepAdaptor_Surface(o.TopoDS.Face(f), true).GetType() === o.GeomAbs_SurfaceType.GeomAbs_Cylinder);
    assert.ok(side >= 0);
    const at = [5, 4, 0];
    const [ring, line] = [true, false].map(u => isoparam(cyl, side, at, u));
    // One of the two runs round the cylinder at the point's height; the other runs its full height.
    const heights = c => c.poles.map(p => p[1]);
    const round = [ring, line].find(c => heights(c).every(h => Math.abs(h - 4) < 1e-6));
    const along = [ring, line].find(c => c !== round);
    assert.ok(round, 'a ring at the point height');
    for (const p of round.poles) assert.ok(Math.hypot(p[0], p[2]) > 5 - 1e-6, `${p}`);
    const ys = heights(along);
    assert.ok(Math.abs(Math.min(...ys)) < 1e-6 && Math.abs(Math.max(...ys) - 10) < 1e-6, `${ys}`);
    for (const p of along.poles) assert.ok(Math.abs(p[0] - 5) < 1e-6 && Math.abs(p[2]) < 1e-6, `${p}`);
    assert.throws(() => isoparam(cyl, 99, at, true), /no longer exists/);
});
