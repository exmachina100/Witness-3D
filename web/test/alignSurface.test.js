// Plasticity's Align Surface in the browser build: a flat sheet's side moved to meet a curved
// sheet's edge in G0, G1 and G2. The desktop's tests are crates/w3d-kernel/tests/align_surface.rs.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { loadKernel, numberedEdges, oc } from '../src/Kernel.js';
import { alignRequest, basis, normalCurvature, readEdgeFaces } from '../src/alignSurface.js';

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
