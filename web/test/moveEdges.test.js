// Move Edge in the browser build (src/moveEdges.js): the faces at the moved corners tilt to them.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { box, loadKernel, numbered, numberedEdges, oc, volume } from '../src/Kernel.js';
import { moveEdges } from '../src/moveEdges.js';

before(async () => { await loadKernel() });

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
/** The edge of `s` running along `axis` (0, 1, 2) through the point with the other two coordinates. */
function edgeAt(s, axis, at) {
    const o = oc();
    return numberedEdges(s).findIndex(e => {
        const c = new o.BRepAdaptor_Curve(e), p = c.Value((c.FirstParameter() + c.LastParameter()) / 2), q = [p.X(), p.Y(), p.Z()];
        return [0, 1, 2].every(k => k === axis || Math.abs(q[k] - at[k]) < 1e-6);
    });
}

test("a block's top edge lifted makes a gable: the top tilts, the sides stretch", () => {
    const b = box({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 });
    const r = moveEdges(b, [edgeAt(b, 0, [5, 10, 10])], { offset: [0, 5, 0] });
    close(volume(r), 1000 + 10 * 5 * 10 / 2);
    assert.equal(numbered(r, 'TopAbs_FACE').length, 6);
});

test('an edge pushed out across one face leans that face only', () => {
    const b = box({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 });
    const r = moveEdges(b, [edgeAt(b, 0, [5, 10, 10])], { offset: [0, 0, 4] });
    close(volume(r), 1000 + 10 * 4 * 10 / 2);
});

test('an edge turned about its far side', () => {
    const b = box({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 });
    // The top front edge turned 0.2 rad about the top back edge: the top and front faces lean.
    const r = moveEdges(b, [edgeAt(b, 0, [5, 10, 10])], { pivot: [0, 10, 0], axis: [1, 0, 0], angle: 0.2 });
    // Its section across x: (0,0) (10,0) the turned edge (0,10), in (y, z).
    const e = [10 - 10 * Math.sin(0.2), 10 * Math.cos(0.2)];
    const area = Math.abs([[0, 0], [10, 0], e, [0, 10]].reduce((t, [a, b], i, l) => { const [c, d] = l[(i + 1) % 4]; return t + a * d - c * b; }, 0)) / 2;
    close(volume(r), 10 * area);
});

test('an edge moved along itself, and edges on a round body, are refused', () => {
    const b = box({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 });
    assert.throws(() => moveEdges(b, [edgeAt(b, 0, [5, 10, 10])], { offset: [3, 0, 0] }), /bend/);
    const cyl = new (oc().BRepPrimAPI_MakeCylinder)(5, 10).Shape();
    assert.throws(() => moveEdges(cyl, [0], { offset: [0, 1, 0] }), /desktop/);
});

/** A 10 mm block with a round hole of radius 2 bored along `axis` through `at`. */
function holed(at, dir) {
    const o = oc();
    const b = box({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 });
    const cyl = new o.BRepPrimAPI_MakeCylinder(new o.gp_Ax2(new o.gp_Pnt(...at), new o.gp_Dir(...dir)), 2, 12).Shape();
    const cut = new o.BRepAlgoAPI_Cut(b, cyl, new o.Message_ProgressRange());
    return cut.Shape();
}

test('faces with round holes beside the edges keep their holes', () => {
    // Bored along x: the ends take the gable shape round their holes.
    const a = holed([-1, 4, 5], [1, 0, 0]);
    const r = moveEdges(a, [edgeAt(a, 0, [5, 10, 10])], { offset: [0, 5, 0] });
    close(volume(r), 1000 + 250 - Math.PI * 4 * 10, 1e-3);
    // Bored down through the top: the top stays flat with its hole while its front edge is pushed out.
    const b = holed([5, -1, 5], [0, 1, 0]);
    const s = moveEdges(b, [edgeAt(b, 0, [5, 10, 10])], { offset: [0, 0, 4] });
    close(volume(s), 1000 + 200 - Math.PI * 4 * 10, 1e-3);
    // But a top with a hole can't tilt in the browser.
    assert.throws(() => moveEdges(b, [edgeAt(b, 0, [5, 10, 10])], { offset: [0, 5, 0] }), /hole/);
});

import { moveFlatFaces } from '../src/moveEdges.js';

/** The face of `s` whose centre lies at `at`. */
function faceAt(s, at) {
    const o = oc();
    return numbered(s, 'TopAbs_FACE').findIndex(f => {
        const p = new o.GProp_GProps();
        o.BRepGProp.SurfaceProperties(f, p, false, false);
        const c = p.CentreOfMass();
        return Math.hypot(c.X() - at[0], c.Y() - at[1], c.Z() - at[2]) < 1e-6;
    });
}

test('several flat faces moved at once, each only across itself', () => {
    const b = box({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 });
    const r = moveFlatFaces(b, [faceAt(b, [5, 10, 5]), faceAt(b, [10, 5, 5])], { offset: [2, 5, 0] });
    close(volume(r), 12 * 15 * 10);
});

test('several flat faces turned at once: their neighbours meet them where the planes cross', () => {
    const b = box({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 });
    const r = moveFlatFaces(b, [faceAt(b, [5, 10, 5]), faceAt(b, [5, 0, 5])], { pivot: [5, 5, 5], axis: [0, 0, 1], angle: 0.1 });
    close(volume(r), 1000 / Math.cos(0.1));
    assert.equal(numbered(r, 'TopAbs_FACE').length, 6);
});

test('a face moved along itself changes nothing, and round bodies are refused', () => {
    const b = box({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 });
    assert.equal(moveFlatFaces(b, [faceAt(b, [5, 10, 5])], { offset: [3, 0, 0] }), null);
    const cyl = new (oc().BRepPrimAPI_MakeCylinder)(5, 10).Shape();
    assert.throws(() => moveFlatFaces(cyl, [0], { offset: [0, 1, 0] }), /desktop/);
});
