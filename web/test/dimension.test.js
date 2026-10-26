// Dimension's sizes and edits (dimension.js), on the browser kernel.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as THREE from 'three';
import { blendEdges, boolean, box, loadKernel, numbered, numberedEdges, oc, primitive, volume } from '../src/Kernel.js';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { chamferDimensions, curveDimensions, faceDimensions, filletDimensions, solidDimensions } from '../src/dimension.js';
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

test("a chamfer's distance, and a new one", async () => {
    const o = oc();
    const be = new LocalBackend();
    const id = be.scene()[0].id;
    const block = be.shapes.get(id);
    be.shapes.set(id, blendEdges(block, [0], 3, true));
    // The chamfer face and the faces beside it with the edges they share, as the viewport's mesh gives them.
    const measure = async () => {
        const shape = be.shapes.get(id), surfaces = await be.faceSurfaces({ body: id });
        const face = surfaces.findIndex(f => f.kind === 'plane' && f.normal.filter(x => Math.abs(x) > 1e-6).length === 2);
        const faces = numbered(shape, 'TopAbs_FACE').map(f => o.TopoDS.Face(f));
        const ends = e => { const c = new o.BRepAdaptor_Curve(e); return [c.FirstParameter(), c.LastParameter()].map(t => { const p = c.Value(t); return [p.X(), p.Y(), p.Z()]; }); };
        const near = [];
        faces.forEach((f, g) => { if (g !== face) for (const e of numberedEdges(f)) if (numberedEdges(faces[face]).some(x => x.IsSame(e))) near.push({ face: g, points: ends(e) }); });
        return chamferDimensions(id, face, surfaces, near);
    };
    const [d] = await measure();
    assert.equal(d.label, 'DISTANCE');
    close(d.value, 3);
    // The block is 50 long along the chamfer: 4.5 mm² of section off at 3 mm, 12.5 at 5, 2 at 2.
    close(volume(be.shapes.get(id)), volume(block) - 4.5 * 50, 1e-3);
    await be.commitOffset({ ...d.edit(5), angle: 0, grow: 'moving' });
    close(volume(be.shapes.get(id)), volume(block) - 12.5 * 50, 1e-3);
    const [d5] = await measure();
    close(d5.value, 5);
    await be.commitOffset({ ...d5.edit(2), angle: 0, grow: 'moving' });
    close(volume(be.shapes.get(id)), volume(block) - 2 * 50, 1e-3);
    assert.equal(numbered(be.shapes.get(id), 'TopAbs_FACE').length, 7);
    // A flat face with no corner beside it to set back from is not a chamfer.
    const surfaces = await be.faceSurfaces({ body: id });
    assert.equal(chamferDimensions(id, surfaces.findIndex(f => f.kind === 'plane' && f.normal[1] > 0.99), surfaces, []).length, 0);
});

test("an unequal chamfer's two distances, each turning the face about its other edge", async () => {
    const o = oc();
    const be = new LocalBackend();
    const id = be.scene()[0].id;
    const block = be.shapes.get(id);
    // 3 mm on one side and 6 on the other.
    be.shapes.set(id, blendEdges(block, [0], 3, true, false, Math.atan(2)));
    const measure = async () => {
        const shape = be.shapes.get(id), surfaces = await be.faceSurfaces({ body: id });
        const face = surfaces.findIndex(f => f.kind === 'plane' && f.normal.filter(x => Math.abs(x) > 1e-6).length === 2);
        const faces = numbered(shape, 'TopAbs_FACE').map(f => o.TopoDS.Face(f));
        const ends = e => { const c = new o.BRepAdaptor_Curve(e); return [c.FirstParameter(), c.LastParameter()].map(t => { const p = c.Value(t); return [p.X(), p.Y(), p.Z()]; }); };
        const near = [];
        faces.forEach((f, g) => { if (g !== face) for (const e of numberedEdges(f)) if (numberedEdges(faces[face]).some(x => x.IsSame(e))) near.push({ face: g, points: ends(e) }); });
        return chamferDimensions(id, face, surfaces, near);
    };
    const dims = await measure();
    assert.deepEqual(dims.map(d => d.label), ['DISTANCE 1', 'DISTANCE 2']);
    const [a, b] = dims.map(d => d.value);
    close(a * b, 18, 1e-6);
    close(volume(be.shapes.get(id)), volume(block) - 9 * 50, 1e-3);
    // The turn lands the face's edge on side 1 at the new setback: the corner of the turned face
    // lies on the line from the pivot to it (what the desktop's Move Face gets).
    const e = dims[0].edit(4);
    assert.equal(e.op, 'turn');
    const rot = (p, axis, t) => { const [x, y, z] = axis, c = Math.cos(t), s = Math.sin(t), d = p[0] * x + p[1] * y + p[2] * z; return [0, 1, 2].map(k => p[k] * c + [y * p[2] - z * p[1], z * p[0] - x * p[2], x * p[1] - y * p[0]][k] * s + axis[k] * d * (1 - c)); };
    const { corner, sides, size } = e.chamfer;
    const from = corner.map((c, k) => c + sides[0][k] * size[0] - e.pivot[k]), want = corner.map((c, k) => c + sides[0][k] * 4 - e.pivot[k]);
    const got = rot(from, e.axis, e.angle), cr = [got[1] * want[2] - got[2] * want[1], got[2] * want[0] - got[0] * want[2], got[0] * want[1] - got[1] * want[0]];
    assert.ok(Math.hypot(...cr) < 1e-9 && got.reduce((s, v, k) => s + v * want[k], 0) > 0);
    await be.commitMoveFaces(e);
    close(volume(be.shapes.get(id)), volume(block) - 0.5 * 4 * b * 50, 1e-3);
    const after = await measure();
    close(after[0].value, 4); close(after[1].value, b);
    // Made equal again, DISTANCE is back.
    await be.commitMoveFaces(after[1].edit(4));
    const even = await measure();
    assert.deepEqual(even.map(d => d.label), ['DISTANCE', 'DISTANCE 1', 'DISTANCE 2']);
    close(even[0].value, 4);
    close(volume(be.shapes.get(id)), volume(block) - 8 * 50, 1e-3);
});
