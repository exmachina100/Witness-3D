// Plasticity's Align Surface in the browser build: a flat sheet's side moved to meet a curved
// sheet's edge in G0, G1 and G2. The desktop's tests are crates/w3d-kernel/tests/align_surface.rs.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { loadKernel, numberedEdges, oc } from '../src/Kernel.js';
import { alignAnalysis, alignRequest, basis, normalCurvature, readEdgeFaces } from '../src/alignSurface.js';

before(async () => { await loadKernel() });

/** A Bezier sheet (degree 3 each way) through pole function f(i, j). */
function sheet(f) {
    const o = oc();
    const poles = new o.NCollection_Array2_gp_Pnt(1, 4, 1, 4);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) poles.SetValue(i + 1, j + 1, new o.gp_Pnt(...f(i, j)));
    const arr = (vals, Type) => { const a = new Type(1, vals.length); vals.forEach((v, i) => a.SetValue(i + 1, v)); return a; };
    const k = () => arr([0, 1], o.NCollection_Array1_double), m = () => arr([4, 4], o.NCollection_Array1_int);
    return new o.BRepBuilderAPI_MakeFace(new o.Geom_BSplineSurface(poles, k(), k(), m(), m(), 3, 3, false, false), 1e-7).Face();
}
const edgeNear = (shape, q) => {
    const o = oc();
    return numberedEdges(shape).findIndex(e => {
        const c = new o.BRepAdaptor_Curve(e), p = c.Value((c.FirstParameter() + c.LastParameter()) / 2);
        return Math.hypot(p.X() - q[0], p.Y() - q[1], p.Z() - q[2]) < 1e-6;
    });
};
const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => { const l = Math.hypot(...a); return a.map(v => v / l); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

test('basis functions add up to one and their derivatives to zero', () => {
    const t = [0, 0, 0, 0, 0.3, 0.6, 1, 1, 1, 1];
    for (const x of [0, 0.1, 0.3, 0.45, 0.99, 1]) {
        const { N, dN } = basis(t, 3, x);
        assert.ok(Math.abs(N.reduce((a, b) => a + b) - 1) < 1e-12);
        assert.ok(Math.abs(dN.reduce((a, b) => a + b)) < 1e-9);
    }
});

for (const continuity of ['G0', 'G1', 'G2']) test(`a sheet's side meets a curved edge in ${continuity}`, async () => {
    const be = new LocalBackend();
    // Reference: x 0..20, curling up to z = 6 at x = 20. Target: a flat sheet at z = 8 from x = 21 to 35.
    const ref = sheet((i, j) => [20 * i / 3, 20 * j / 3, [0, 0, 2, 6][i]]);
    const tgt = sheet((i, j) => [21 + 14 * i / 3, 20 * j / 3, 8]);
    be.shapes.set(901, ref);
    be.shapes.set(902, tgt);
    const reference = { body: 901, edge: edgeNear(ref, [20, 10, 6]) }, target = { body: 902, edge: edgeNear(tgt, [21, 10, 8]) };
    assert.ok(reference.edge >= 0 && target.edge >= 0);
    const { body, moves } = await alignRequest(be, { target, reference, continuity });
    assert.equal(body, 902);
    be.shapes.set(902, be.movePolesResult({ body, moves }));
    // Both faces at points along the edge.
    const pts = [0, 0.13, 0.5, 0.77, 1].map(t => [20, 20 * t, 6]);
    const [r] = readEdgeFaces(await be.edgeFaces({ body: 901, edge: reference.edge, points: pts }), pts.length);
    const after = be.shapes.get(902), edge = edgeNear(after, [20, 10, 6]);
    assert.ok(edge >= 0, 'the side lies on the reference edge');
    const [t] = readEdgeFaces(await be.edgeFaces({ body: 902, edge, points: pts }), pts.length);
    pts.forEach((p, k) => {
        assert.ok(Math.hypot(...sub(t.frames[k].at, p)) < 1e-6, 'G0');
        if (continuity === 'G0') return;
        const nr = unit(cross(r.frames[k].su, r.frames[k].sv)), nt = unit(cross(t.frames[k].su, t.frames[k].sv));
        const angle = Math.acos(Math.min(1, Math.abs(dot(nr, nt)))) * 180 / Math.PI;
        assert.ok(angle < 1e-4, `G1: ${angle}°`);
        if (continuity === 'G1') return;
        // Across the edge (along x), both bend the same.
        const kr = normalCurvature(r.frames[k], nr, unit(r.frames[k].su)), kt = normalCurvature(t.frames[k], nr, unit(t.frames[k].su));
        assert.ok(Math.abs(kr - kt) < 1e-6 * Math.max(1, Math.abs(kr)), `G2: ${kr} vs ${kt}`);
    });
});

test('blend extra rows carry the aligned row on, less and less', async () => {
    const { sideOf, alignPoints, alignMoves } = await import('../src/alignSurface.js');
    // A 6-row sheet (degree 3, two knot spans across) as plain data, its side at x = 21 meeting a flat reference at z = 0.
    const spline = { du: 3, dv: 3, uk: [0, 0, 0, 0, 1 / 3, 2 / 3, 1, 1, 1, 1], vk: [0, 0, 0, 0, 1, 1, 1, 1], rational: false,
        poles: Array.from({ length: 6 }, (_, i) => Array.from({ length: 4 }, (_, j) => [21 + 3 * i, 20 * j / 3, 8])) };
    const side = sideOf(spline, [[21, 0, 8], [21, 10, 8], [21, 20, 8]]);
    const plan = alignPoints(side, Array.from({ length: 41 }, (_, k) => [20, 20 * k / 40, 0]));
    const flat = { at: [0, 0, 0], su: [1, 0, 0], sv: [0, 1, 0], suu: [0, 0, 0], suv: [0, 0, 0], svv: [0, 0, 0], sign: 1 };
    const frames = plan.points.map(() => flat);
    const rowOf = pole => Math.floor(pole / 4);
    const plain = alignMoves(side, plan, frames, { continuity: 'G1' });
    assert.deepEqual([...new Set(plain.map(([p]) => rowOf(p)))].sort(), [0, 1]);
    const blended = alignMoves(side, plan, frames, { continuity: 'G1', blend: 2 });
    const dz = row => blended.filter(([p]) => rowOf(p) === row).map(([, by]) => by[2]);
    assert.deepEqual([...new Set(blended.map(([p]) => rowOf(p)))].sort(), [0, 1, 2, 3]);
    for (const z of dz(2)) assert.ok(Math.abs(z - -8 * 2 / 3) < 1e-9, `row 2 follows two thirds: ${z}`);
    for (const z of dz(3)) assert.ok(Math.abs(z - -8 / 3) < 1e-9, `row 3 follows a third: ${z}`);
    const held = alignMoves(side, plan, frames, { continuity: 'G1', blend: 2, influence: 0.5 });
    for (const [p, by] of held) if (rowOf(p) === 3) assert.ok(Math.abs(by[2] - -8 / 6) < 1e-9);
});

test('partial alignment eases out to the side\'s ends', async () => {
    const { sideOf, alignPoints, alignMoves } = await import('../src/alignSurface.js');
    const spline = { du: 3, dv: 3, uk: [0, 0, 0, 0, 1, 1, 1, 1], vk: [0, 0, 0, 0, 0.25, 0.5, 0.75, 1, 1, 1, 1], rational: false,
        poles: Array.from({ length: 4 }, (_, i) => Array.from({ length: 7 }, (_, j) => [21 + 3 * i, 20 * j / 6, 8])) };
    const side = sideOf(spline, [[21, 0, 8], [21, 10, 8], [21, 20, 8]]);
    const plan = alignPoints(side, Array.from({ length: 41 }, (_, k) => [20, 20 * k / 40, 0]));
    const flat = { at: [0, 0, 0], su: [1, 0, 0], sv: [0, 1, 0], suu: [0, 0, 0], suv: [0, 0, 0], svv: [0, 0, 0], sign: 1 };
    const moves = alignMoves(side, plan, plan.points.map(() => flat), { continuity: 'G0', partial: [0.3, 0.7] });
    const dz = new Map(moves.map(([p, by]) => [p, by[2]]));
    assert.equal(dz.get(0) ?? 0, 0, 'the first corner stays');
    assert.equal(dz.get(6) ?? 0, 0, 'the last corner stays');
    assert.ok(Math.abs(dz.get(3) - -8) < 1e-9, 'the middle is aligned in full');
    assert.ok(dz.get(1) > -8 && dz.get(1) < 0, 'between, it eases');
    assert.throws(() => alignMoves(side, plan, [], { partial: [0.8, 0.2] }), /start before end/);
});

for (const continuity of ['G0', 'G1']) test(`Symmetric: both sides move to meet halfway in ${continuity}, one undo step`, async () => {
    const be = new LocalBackend();
    const ref = sheet((i, j) => [20 * i / 3, 20 * j / 3, [0, 0, 2, 6][i]]);
    const tgt = sheet((i, j) => [21 + 14 * i / 3, 20 * j / 3, 8]);
    be.put(901, ref);
    be.put(902, tgt);
    const reference = { body: 901, edge: edgeNear(ref, [20, 10, 6]) }, target = { body: 902, edge: edgeNear(tgt, [21, 10, 8]) };
    const req = await alignRequest(be, { target, reference, continuity, symmetric: true });
    assert.equal(req.body, 902);
    assert.equal(req.more.length, 1);
    assert.equal(req.more[0].body, 901);
    await be.commitMoveFacePoles(req);
    // Both edges now lie on the curve halfway between: x 20.5, z 7.
    const pts = [0, 0.13, 0.5, 0.77, 1].map(t => [20.5, 20 * t, 7]);
    const frames = [];
    for (const body of [901, 902]) {
        const s = be.shapes.get(body), edge = edgeNear(s, [20.5, 10, 7]);
        assert.ok(edge >= 0, `B-${body}'s side lies halfway`);
        const [f] = readEdgeFaces(await be.edgeFaces({ body, edge, points: pts }), pts.length);
        pts.forEach((p, k) => assert.ok(Math.hypot(...sub(f.frames[k].at, p)) < 1e-6, 'G0'));
        frames.push(f.frames);
    }
    if (continuity === 'G1') pts.forEach((_, k) => {
        const [a, b] = frames.map(f => unit(cross(f[k].su, f[k].sv)));
        const angle = Math.acos(Math.min(1, Math.abs(dot(a, b)))) * 180 / Math.PI;
        assert.ok(angle < 1e-4, `G1: ${angle}°`);
    });
    // One step undoes both.
    be.undo();
    assert.ok(edgeNear(be.shapes.get(901), [20, 10, 6]) >= 0 && edgeNear(be.shapes.get(902), [21, 10, 8]) >= 0);
});

test('Symmetric refuses G2', async () => {
    const be = new LocalBackend();
    be.shapes.set(901, sheet((i, j) => [20 * i / 3, 20 * j / 3, 0]));
    be.shapes.set(902, sheet((i, j) => [21 + 14 * i / 3, 20 * j / 3, 1]));
    const target = { body: 902, edge: edgeNear(be.shapes.get(902), [21, 10, 1]) }, reference = { body: 901, edge: edgeNear(be.shapes.get(901), [20, 10, 0]) };
    await assert.rejects(alignRequest(be, { target, reference, continuity: 'G2', symmetric: true }), /G0 or G1/);
});

test('Analysis passes each continuity up to the one aligned, and fails the next', async () => {
    const be = new LocalBackend();
    const ref = sheet((i, j) => [20 * i / 3, 20 * j / 3, [0, 0, 2, 6][i]]);
    const tgt = sheet((i, j) => [21 + 14 * i / 3, 20 * j / 3, 8]);
    be.shapes.set(901, ref);
    be.shapes.set(902, tgt);
    const reference = { body: 901, edge: edgeNear(ref, [20, 10, 6]) }, target = { body: 902, edge: edgeNear(tgt, [21, 10, 8]) };
    const result = {};
    for (const continuity of ['G0', 'G1', 'G2']) result[continuity] = await alignAnalysis(be, await alignRequest(be, { target, reference, continuity }));
    for (const g of ['G0', 'G1', 'G2']) assert.ok(result[g].gap < 1e-6, `${g} gap ${result[g].gap}`);
    assert.equal(result.G0.ok.g1, false, `G0 leaves a crease: ${result.G0.angle}°`);
    assert.ok(result.G1.angle < 1e-4 && result.G2.angle < 1e-4);
    assert.equal(result.G1.ok.g2, false, `G1 bends differently: ${result.G1.bend}%`);
    assert.ok(result.G2.bend < 1e-3, `G2: ${result.G2.bend}%`);
    // Symmetric has nothing to check against.
    await assert.rejects(alignAnalysis(be, await alignRequest(be, { target, reference, continuity: 'G1', symmetric: true })), /Symmetric/);
});
