// Patch › Method in the browser build: a target sheet trimmed to a base sheet's hole, or where it ends.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { box, loadKernel, numberedEdges, oc, planeSheet } from '../src/Kernel.js';

before(async () => { await loadKernel() });

const area = s => { const o = oc(), p = new o.GProp_GProps(); o.BRepGProp.SurfaceProperties(s, p, false, false); return p.Mass(); };
const cut = (a, b) => new (oc().BRepAlgoAPI_Cut)(a, b, new (oc().Message_ProgressRange)()).Shape();
const edgesWhere = (s, pick) => numberedEdges(s).map((e, n) => {
    const c = new (oc().BRepAdaptor_Curve)(e), p = c.Value((c.FirstParameter() + c.LastParameter()) / 2);
    return pick([p.X(), p.Y(), p.Z()]) ? n : -1;
}).filter(n => n >= 0);

test('Trim to hole keeps the target inside the hole, as one undo step', async () => {
    const be = new LocalBackend();
    const base = cut(planeSheet([0, 0, 0], [0, 0, 1], 10), box({ x: -3, y: -3, z: -1 }, { x: 3, y: 3, z: 1 }));
    be.put(100, base);
    be.put(101, planeSheet([0, 0, 1], [0, 0, 1], 10));
    const edges = edgesWhere(base, p => Math.max(Math.abs(p[0]), Math.abs(p[1])) < 3.5).map(edge => ({ body: 100, edge }));
    assert.equal(edges.length, 4);
    const { id } = await be.commitPatch({ edges, target: 101, method: 'hole' });
    assert.equal(id, 101);
    assert.ok(Math.abs(area(be.shapes.get(101)) - 36) < 1e-6);
    be.undo();
    assert.ok(Math.abs(area(be.shapes.get(101)) - 400) < 1e-6);
});

test('Trim to sheet keeps the target past where the base ends; edges must be on one sheet', async () => {
    const be = new LocalBackend();
    const half = cut(planeSheet([0, 0, 0], [0, 0, 1], 10), box({ x: 0, y: -11, z: -1 }, { x: 11, y: 11, z: 1 }));
    be.put(100, half);
    be.put(101, planeSheet([0, 0, 1], [0, 0, 1], 10));
    const [edge] = edgesWhere(half, p => Math.abs(p[0]) < 1e-6);
    const b = await be.previewPatch({ edges: [{ body: 100, edge }], target: 101, method: 'sheet' });
    assert.ok(b);
    assert.ok(Math.abs(area(be.patchResult({ edges: [{ body: 100, edge }], target: 101, method: 'sheet' })) - 200) < 1e-6);
    assert.throws(() => be.patchResult({ edges: [{ body: 100, edge }, { body: 101, edge: 0 }], target: 101, method: 'sheet' }), /one sheet/);
});
