// Dimension's sizes and edits (dimension.js), on the browser kernel.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as THREE from 'three';
import { boolean, box, loadKernel, primitive, volume } from '../src/Kernel.js';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { curveDimensions, faceDimensions, filletDimensions, solidDimensions } from '../src/dimension.js';
import { faceSurfaces } from '../src/faceSurfaces.js';

before(async () => { await loadKernel() });
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("a block's three sides, and a new width", async () => {
    const be = new LocalBackend();
    const id = be.scene()[0].id;
    const dims = solidDimensions(id, await be.faceSurfaces({ body: id }));
    assert.deepEqual(dims.map(d => [d.label, +d.value.toFixed(6)]), [['WIDTH', 80], ['LENGTH', 50], ['HEIGHT', 30]]);
    const edit = dims[0].edit(100);
    assert.equal(edit.op, 'offset');
    await be.commitOffset(edit);
    close(volume(be.shapes.get(id)), 100 * 50 * 30, 1e-3);
    const again = solidDimensions(id, await be.faceSurfaces({ body: id }));
    close(again[0].value, 100);
});

test('a hole, a ball and the gap between two faces', () => {
    const block = box(new THREE.Vector3(0, 0, 0), new THREE.Vector3(100, 40, 100));
    const post = primitive({ kind: 'cylinder', frame: { origin: [50, 0, 50], x: [1, 0, 0], normal: [0, 1, 0] }, radius: 10, height: 40 });
    const s = faceSurfaces(boolean(block, post, 'difference'));
    const hole = s.findIndex(f => f.kind === 'cylinder');
    assert.equal(s[hole].outward, false);
    const [dia] = faceDimensions(7, [hole], s);
    close(dia.value, 20);
    // Wider by 4 mm: the wall moves 2 mm away from the axis, against its normal.
    assert.deepEqual(dia.edit(24), { op: 'offset', body: 7, faces: [hole], distance: -2 });
    const top = s.findIndex(f => f.kind === 'plane' && f.normal[1] > 0.99), bottom = s.findIndex(f => f.kind === 'plane' && f.normal[1] < -0.99);
    const [gap] = faceDimensions(7, [bottom, top], s);
    close(gap.value, 40);
    assert.deepEqual(gap.edit(45), { op: 'offset', body: 7, faces: [top], distance: 5 });
    const ball = faceSurfaces(primitive({ kind: 'sphere', center: [1, 2, 3], radius: 5 }));
    const [d] = solidDimensions(3, ball);
    close(d.value, 10);
    const e = d.edit(15);
    assert.equal(e.op, 'scale'); close(e.scale, 1.5); assert.deepEqual(e.pivot.map(v => +v.toFixed(9)), [1, 2, 3]);
});

test("curves: a circle's diameter, an arc's, a rectangle's sides", () => {
    const base = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0] };
    const [c] = curveDimensions({ ...base, kind: 'circle', center: [0, 0], radius: 4 });
    close(c.value, 8); assert.equal(c.edit(10).curve.radius, 5);
    const [a] = curveDimensions({ ...base, kind: 'arc', start: [10, 0], mid: [0, 10], end: [-10, 0] });
    close(a.value, 20);
    const arc = a.edit(40).curve;
    assert.deepEqual(arc.mid.map(v => +v.toFixed(9)), [0, 20]);
    const [w, l] = curveDimensions({ ...base, kind: 'polyline', closed: true, points: [[0, 0], [30, 0], [30, 10], [0, 10]] });
    close(w.value, 30); close(l.value, 10);
    assert.deepEqual(w.edit(40).curve.points, [[0, 0], [40, 0], [40, 10], [0, 10]]);
    assert.equal(curveDimensions({ ...base, kind: 'polyline', closed: true, points: [[0, 0], [30, 0], [20, 10], [0, 10]] }).length, 0);
});

test('a fillet shows its radius and makes its whole chain again', () => {
    const surfaces = [{ kind: 'plane' }, { kind: 'cylinder', radius: 2, outward: true }, { kind: 'sphere', radius: 2, outward: true }];
    const [d] = filletDimensions(7, [2, 1], surfaces);
    assert.equal(d.label, 'RADIUS');
    assert.equal(d.value, 2);
    assert.deepEqual(d.edit(3), { op: 'refillet', body: 7, faces: [2, 1], radius: 3 });
    assert.deepEqual(filletDimensions(7, [0], surfaces), []);
});

test('a round on a circular edge, a torus rather than a cylinder, still reads as its radius', async () => {
    const { blendEdges, numberedEdges, oc } = await import('../src/Kernel.js');
    const o = oc();
    const cyl = new o.BRepPrimAPI_MakeCylinder(new o.gp_Ax2(new o.gp_Pnt(0, 0, 0), new o.gp_Dir(0, 0, 1), new o.gp_Dir(1, 0, 0)), 10, 20).Shape();
    const top = numberedEdges(cyl).findIndex(e => { const c = new o.BRepAdaptor_Curve(e); return c.GetType() === o.GeomAbs_CurveType.GeomAbs_Circle && Math.abs(c.Value(0).Z() - 20) < 1e-9; });
    const rounded = blendEdges(cyl, [top], 3);
    const rounds = faceSurfaces(rounded).filter(f => f.kind === 'round');
    assert.equal(rounds.length, 1);
    close(rounds[0].radius, 3, 1e-6);
    // A flat or straight-sided face is not a round.
    assert.ok(faceSurfaces(cyl).every(f => f.kind !== 'round'));
});
