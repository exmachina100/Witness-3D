// Rebuild Face (Plasticity's Rebuild on faces) in the browser build. The desktop's tests are
// crates/w3d-kernel/tests/rebuild_face.rs.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as THREE from 'three';
import { blendEdges, boolean, box, count, loadKernel, numbered, numberedEdges, oc, primitive, volume } from '../src/Kernel.js';
import { bridgeSurface } from '../src/BridgeSurface.js';
import { patch } from '../src/Patch.js';
import { raiseFaces, rebuildFaces } from '../src/rebuildFace.js';

before(async () => { await loadKernel() });

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b} (±${eps})`);
const ground = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] };

function square(x0, z) {
    const c = { origin: [0, 0, z], x: [1, 0, 0], normal: [0, 0, 1], kind: 'polyline', points: [[x0, 0], [x0 + 10, 0], [x0 + 10, 10], [x0, 10]], closed: true };
    return patch([c], []);
}
function edgeWhere(shape, on) {
    const o = oc();
    return numberedEdges(shape).findIndex(e => {
        const { returnValue: g, First, Last } = o.BRep_Tool.Curve(e, 0, 0);
        return [First, (First + Last) / 2, Last].every(t => { const p = g.Value(t); return on(new THREE.Vector3(p.X(), p.Y(), p.Z())); });
    });
}
/** The S-bend sheet bridging two squares: one B-spline face. */
function bridge() {
    const a = square(0, 0), b = square(20, 5);
    return bridgeSurface({ shape: a, n: edgeWhere(a, p => Math.abs(p.x - 10) < 1e-9) }, { shape: b, n: edgeWhere(b, p => Math.abs(p.x - 20) < 1e-9) }, 1);
}
function area(shape) {
    const o = oc(), props = new o.GProp_GProps();
    o.BRepGProp.SurfaceProperties(shape, props, false, false);
    return props.Mass();
}
const curved = s => numbered(s, 'TopAbs_FACE').map((f, i) => [new (oc().BRepAdaptor_Surface)(oc().TopoDS.Face(f), true).GetType(), i])
    .filter(([t]) => t !== oc().GeomAbs_SurfaceType.GeomAbs_Plane).map(([, i]) => i);

test('explicit control sets the degree and spans', () => {
    const s = bridge();
    const { shape, rebuilt } = rebuildFaces(s, [0], { explicit: true, degree: [3, 2], spans: [4, 3] });
    assert.deepEqual(rebuilt[0].degree, [3, 2]);
    assert.deepEqual(rebuilt[0].poles, [7, 5]);
    assert.ok(rebuilt[0].deviation < 0.05, `deviation ${rebuilt[0].deviation}`);
    close(area(shape), area(s), 0.001 * area(s));
    const flat = rebuildFaces(s, [0], { explicit: true, degree: [1, 1], spans: [1, 1] }).rebuilt[0];
    assert.deepEqual(flat.poles, [2, 2]);
    assert.ok(flat.deviation > 0.1, 'a bilinear sheet cannot follow the S-bend');
});

test('tolerance adds spans until the face is within it', () => {
    const s = bridge();
    const coarse = rebuildFaces(s, [0], { tolerance: 0.1 }).rebuilt[0];
    const fine = rebuildFaces(s, [0], { tolerance: 1e-5 }).rebuilt[0];
    assert.ok(coarse.deviation <= 0.1 && fine.deviation <= 1e-5, JSON.stringify([coarse, fine]));
    assert.ok(fine.poles[0] >= coarse.poles[0]);
    assert.deepEqual(fine.degree, [3, 3]);
});

test('a cylinder wall rebuilds across its seam and the solid stays closed', () => {
    const c = primitive({ kind: 'cylinder', frame: ground, radius: 5, height: 10 });
    const wall = curved(c);
    assert.equal(wall.length, 1);
    const { shape, rebuilt } = rebuildFaces(c, wall, { tolerance: 0.001 });
    assert.ok(rebuilt[0].deviation <= 0.001, JSON.stringify(rebuilt));
    assert.equal(count(shape, 'TopAbs_SOLID'), 1);
    close(volume(shape), Math.PI * 250, 0.5);
});

test('a sphere rebuilds through its poles', () => {
    const s = primitive({ kind: 'sphere', center: [0, 0, 0], radius: 5 });
    const { shape, rebuilt } = rebuildFaces(s, [0], { tolerance: 0.005 });
    assert.ok(rebuilt[0].deviation <= 0.005, JSON.stringify(rebuilt));
    close(volume(shape), 4 / 3 * Math.PI * 125, 1);
});

test('extend grows the surface but not the face', () => {
    const s = bridge();
    const { shape, rebuilt } = rebuildFaces(s, [0], { explicit: true, degree: [3, 3], spans: [4, 2], extend: [2, 1] });
    close(area(shape), area(s), 0.001 * area(s));
    assert.ok(rebuilt[0].deviation < 0.05, JSON.stringify(rebuilt));
    assert.ok(rebuilt[0].poles[0] > 7 || rebuilt[0].poles[1] > 5, 'extension adds CVs');
});

test('a fillet round rebuilds, shrunk to the face or over its whole surface', () => {
    const b = box(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 10, 10));
    const e = edgeWhere(b, p => Math.abs(p.x) < 1e-9 && Math.abs(p.y) < 1e-9);
    const f = blendEdges(b, [e], 2);
    const round = curved(f);
    assert.equal(round.length, 1);
    for (const shrink of [true, false]) {
        const { shape, rebuilt } = rebuildFaces(f, round, { tolerance: 0.001, shrink });
        assert.ok(rebuilt[0].deviation <= 0.001, JSON.stringify(rebuilt));
        close(volume(shape), 1000 - (4 - Math.PI) * 10, 0.05);
    }
});

test('a face with a hole keeps its hole', () => {
    const b = box(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 10, 10));
    const hole = primitive({ kind: 'cylinder', frame: { origin: [5, 5, 5], x: [1, 0, 0], normal: [0, 0, 1] }, radius: 2, height: 10 });
    const s = boolean(b, hole, 'difference');
    const o = oc();
    const top = numbered(s, 'TopAbs_FACE').findIndex(f => {
        const ad = new o.BRepAdaptor_Surface(o.TopoDS.Face(f), true);
        return ad.GetType() === o.GeomAbs_SurfaceType.GeomAbs_Plane && Math.abs(ad.Value(ad.FirstUParameter(), ad.FirstVParameter()).Z() - 10) < 1e-9;
    });
    assert.ok(top >= 0);
    const { shape, rebuilt } = rebuildFaces(s, [top], { tolerance: 0.001 });
    assert.ok(rebuilt[0].deviation <= 0.001);
    assert.equal(count(shape, 'TopAbs_FACE'), count(s, 'TopAbs_FACE'));
    close(volume(shape), volume(s), 0.01);
});

test('bad settings are refused', () => {
    const s = bridge();
    assert.throws(() => rebuildFaces(s, [0], { explicit: true, degree: [0, 3] }), /degree/);
    assert.throws(() => rebuildFaces(s, [0], { explicit: true, spans: [0, 4] }), /spans/);
    assert.throws(() => rebuildFaces(s, [0], { tolerance: 0 }), /tolerance/);
    assert.throws(() => rebuildFaces(s, [5], {}), /no longer exists/);
    assert.throws(() => rebuildFaces(s, [], {}), /select/);
});

test('raise degree adds control points without moving the face', () => {
    const s = rebuildFaces(bridge(), [0], { explicit: true, degree: [3, 3], spans: [2, 2] }).shape;
    const { shape, rebuilt } = raiseFaces(s, [0]);
    assert.deepEqual(rebuilt[0].degree, [4, 4]);
    assert.ok(rebuilt[0].poles[0] > 5 && rebuilt[0].poles[1] > 5, JSON.stringify(rebuilt));
    assert.ok(rebuilt[0].deviation < 1e-9, JSON.stringify(rebuilt));
    close(area(shape), area(s), 1e-6);
});

test('raise degree on a whole solid fits its flat and round faces first', () => {
    const c = primitive({ kind: 'cylinder', frame: ground, radius: 5, height: 10 });
    const { shape, rebuilt } = raiseFaces(c);
    assert.equal(rebuilt.length, count(c, 'TopAbs_FACE'));
    assert.ok(rebuilt.every(f => f.degree[0] === 4 && f.deviation <= 1e-3), JSON.stringify(rebuilt));
    assert.equal(count(shape, 'TopAbs_SOLID'), 1);
    close(volume(shape), Math.PI * 250, 0.5);
});
