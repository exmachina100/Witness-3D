// Remove Face in the browser build (src/removeFace.js): gaps closed by the flat neighbours.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { blendEdges, boolean, box, loadKernel, numbered, numberedEdges, oc, primitive, volume } from '../src/Kernel.js';
import { removeFaces } from '../src/removeFace.js';

before(async () => { await loadKernel() });

const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const faces = s => numbered(s, 'TopAbs_FACE').map(f => oc().TopoDS.Face(f));
/** The faces that are not flat. */
const curved = s => faces(s).map((f, n) => [f, n]).filter(([f]) => new (oc().BRepAdaptor_Surface)(f, true).GetType() !== oc().GeomAbs_SurfaceType.GeomAbs_Plane).map(([, n]) => n);
/** The edges of `s` running along `axis` (0, 1, 2) through the point with the other two coordinates. */
function edgeAt(s, axis, at) {
    const o = oc();
    return numberedEdges(s).findIndex(e => {
        const c = new o.BRepAdaptor_Curve(e), p = c.Value((c.FirstParameter() + c.LastParameter()) / 2), q = [p.X(), p.Y(), p.Z()];
        return [0, 1, 2].every(k => k === axis || Math.abs(q[k] - at[k]) < 1e-6);
    });
}

test('a round on an outside edge goes and the corner comes back square', () => {
    const b = box({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 });
    const r = blendEdges(b, [edgeAt(b, 0, [0, 10, 10])], 2);
    assert.equal(curved(r).length, 1);
    const back = removeFaces(r, curved(r));
    close(volume(back), 1000);
    assert.equal(faces(back).length, 6);
});

test('two rounds and a chamfer go at once', () => {
    const b = box({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 });
    let r = blendEdges(b, [edgeAt(b, 0, [0, 10, 10]), edgeAt(b, 1, [0, 0, 0])], 2);
    r = blendEdges(r, [edgeAt(r, 2, [10, 0, 0])], 1, true);
    const flatBefore = faces(r).length - curved(r).length;
    // The chamfer is the flat face that is neither square to an axis.
    const o = oc();
    const chamfer = faces(r).findIndex(f => { const s = new o.BRepAdaptor_Surface(f, true); if (s.GetType() !== o.GeomAbs_SurfaceType.GeomAbs_Plane) return false; const d = s.Plane().Axis().Direction(); return Math.max(Math.abs(d.X()), Math.abs(d.Y()), Math.abs(d.Z())) < 0.99; });
    assert.ok(chamfer >= 0 && flatBefore === 7);
    const back = removeFaces(r, [...curved(r), chamfer]);
    close(volume(back), 1000);
    assert.equal(faces(back).length, 6);
});

test('a hole through a block fills', () => {
    const o = oc();
    const b = box({ x: 0, y: 0, z: 0 }, { x: 20, y: 10, z: 20 });
    const rod = new o.BRepPrimAPI_MakeCylinder(new o.gp_Ax2(new o.gp_Pnt(10, -1, 10), new o.gp_Dir(0, 1, 0)), 3, 12).Shape();
    const holed = boolean(b, rod, 'difference');
    const back = removeFaces(holed, curved(holed));
    close(volume(back), 4000);
    assert.equal(faces(back).length, 6);
});

test('a round in an inside corner goes and the corner comes back sharp', () => {
    // An L: 20 × 20 × 10 less its 10 × 10 upper right, rounded along the inside corner.
    const l = boolean(box({ x: 0, y: 0, z: 0 }, { x: 20, y: 20, z: 10 }), box({ x: 10, y: 10, z: -1 }, { x: 21, y: 21, z: 11 }), 'difference');
    const r = blendEdges(l, [edgeAt(l, 2, [10, 10, 5])], 3);
    assert.ok(volume(r) > 3000);
    const back = removeFaces(r, curved(r));
    close(volume(back), 3000);
    assert.equal(faces(back).length, 8);
});

test('a face of a plain box is refused: its neighbours do not close round it', () => {
    const b = box({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 });
    assert.throws(() => removeFaces(b, [0]), /do not close round them/);
});

test('curved neighbours are refused in the browser, and the whole body cannot go', () => {
    const c = primitive({ kind: 'cylinder', frame: { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] }, radius: 5, height: 10 });
    const top = faces(c).findIndex(f => new (oc().BRepAdaptor_Surface)(f, true).GetType() === oc().GeomAbs_SurfaceType.GeomAbs_Plane);
    assert.throws(() => removeFaces(c, [top]), /flat faces only/);
    assert.throws(() => removeFaces(c, faces(c).map((_, n) => n)), /whole body/);
});

test('fillet faces are found on a body and along a chain, and removed', async () => {
    const { filletFaces } = await import('../src/removeFace.js');
    const b = box({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 });
    // Three rounds meeting at a corner ball, and a separate one.
    const r = blendEdges(b, [edgeAt(b, 0, [0, 10, 10]), edgeAt(b, 1, [10, 0, 10]), edgeAt(b, 2, [10, 10, 0]), edgeAt(b, 2, [0, 0, 0])], 2);
    const found = filletFaces(r);
    assert.deepEqual(found, curved(r));
    assert.equal(found.length, 5);
    const lone = curved(r).find(n => filletFaces(r, [n]).length === 1);
    assert.ok(lone !== undefined);
    assert.equal(filletFaces(r, [found.find(n => n !== lone)]).length, 4);
    assert.deepEqual(filletFaces(b), []);
    // A cylinder's side is not a fillet.
    const c = primitive({ kind: 'cylinder', frame: { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] }, radius: 5, height: 10 });
    assert.deepEqual(filletFaces(c), []);
    // Lone round alone, flat neighbours only: the browser removes it.
    close(volume(removeFaces(r, [lone])) - volume(r), 4 * 10 - Math.PI * 10, 0.01);
    // All of them, the corner ball's chain included: the box again.
    const back = removeFaces(r, found);
    close(volume(back), 1000);
    assert.equal(faces(back).length, 6);
});

test('a fillet made again at a new radius', async () => {
    const { refilletFaces } = await import('../src/removeFace.js');
    const b = box({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 });
    const r = blendEdges(b, [edgeAt(b, 0, [0, 10, 10])], 2);
    const bigger = refilletFaces(r, curved(r), 4);
    close(volume(bigger), 1000 - (16 - Math.PI * 4) * 10, 0.01);
    assert.throws(() => refilletFaces(r, curved(r), 0), /radius/);
});

test('the browser backend removes faces, finds fillets and sizes them, each one undo step', async () => {
    const { LocalBackend } = await import('../src/app/LocalBackend.js');
    const be = new LocalBackend();
    const id = [...be.shapes.keys()][0];
    const b = be.shapes.get(id);
    const v0 = volume(b);
    const { scene } = await be.commitBlend({ body: id, edges: [0], size: 3, kind: 'fillet' });
    const rounded = be.shapes.get(id);
    const fillets = await be.filletFaces({ body: id });
    assert.deepEqual(fillets, curved(rounded));
    await assert.rejects(be.filletFaces({ body: id, faces: [fillets[0] === 0 ? 1 : 0] }), /not fillets/);
    const preview = await be.previewRefillet({ body: id, faces: fillets, radius: 5 });
    assert.ok(preview.volume < scene[0].volume);
    await be.commitRemoveFaces({ body: id, faces: fillets });
    close(volume(be.shapes.get(id)), v0);
    await be.undo();
    close(volume(be.shapes.get(id)), scene[0].volume);
});
