// Offset Face on curved faces in the browser build (src/offsetCurved.js): slabs joined or cut.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { booleanWithHistory, loadKernel, numbered, oc, volume } from '../src/Kernel.js';
import { offsetCurvedFaces } from '../src/offsetCurved.js';

before(async () => { await loadKernel() });

const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const cylFace = s => numbered(s, 'TopAbs_FACE').findIndex(f => new (oc().BRepAdaptor_Surface)(oc().TopoDS.Face(f), true).GetType() === oc().GeomAbs_SurfaceType.GeomAbs_Cylinder);

test("a cylinder's side offset out and in", () => {
    const cyl = new (oc().BRepPrimAPI_MakeCylinder)(5, 10).Shape();
    close(volume(offsetCurvedFaces(cyl, [cylFace(cyl)], 1).shape), Math.PI * 36 * 10);
    close(volume(offsetCurvedFaces(cyl, [cylFace(cyl)], -1).shape), Math.PI * 16 * 10);
});

test('a boss grows, and a hole shrinks or grows', () => {
    const o = oc();
    const box = new o.BRepPrimAPI_MakeBox(20, 20, 10).Shape();
    const boss = new o.BRepPrimAPI_MakeCylinder(new o.gp_Ax2(new o.gp_Pnt(10, 10, 10), new o.gp_Dir(0, 0, 1)), 4, 5).Shape();
    const bossed = booleanWithHistory(box, boss, 'union').shape;
    close(volume(offsetCurvedFaces(bossed, [cylFace(bossed)], 1).shape), 4000 + Math.PI * 25 * 5);
    const bore = new o.BRepPrimAPI_MakeCylinder(new o.gp_Ax2(new o.gp_Pnt(10, 10, -1), new o.gp_Dir(0, 0, 1)), 3, 12).Shape();
    const holed = booleanWithHistory(box, bore, 'difference').shape;
    // Out of the body is into the hole: the hole shrinks to radius 2; in, it grows to 4.
    close(volume(offsetCurvedFaces(holed, [cylFace(holed)], 1).shape), 4000 - Math.PI * 4 * 10);
    close(volume(offsetCurvedFaces(holed, [cylFace(holed)], -1).shape), 4000 - Math.PI * 16 * 10);
});

test('a fillet, which its neighbours run on from smoothly, is refused', () => {
    const o = oc();
    const box = new o.BRepPrimAPI_MakeBox(20, 20, 10).Shape();
    const mk = new o.BRepFilletAPI_MakeFillet(box, o.ChFi3d_FilletShape.ChFi3d_Rational);
    mk.Add(2, o.TopoDS.Edge(numbered(box, 'TopAbs_EDGE')[0]));
    const filleted = mk.Shape();
    assert.throws(() => offsetCurvedFaces(filleted, [cylFace(filleted)], 0.5), /square on/);
});

test('Offset Face in the browser backend takes a curved face', async () => {
    const { LocalBackend } = await import('../src/app/LocalBackend.js');
    const be = new LocalBackend();
    const cyl = new (oc().BRepPrimAPI_MakeCylinder)(5, 10).Shape();
    be.put(99, cyl);
    const b = await be.previewOffset({ body: 99, faces: [cylFace(cyl)], distance: 2 });
    close(b.volume, Math.PI * 49 * 10);
});
