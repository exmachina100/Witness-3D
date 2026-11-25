// Seam Check (LABS): known seams between two Bezier sheets, measured in the browser build's kernel.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { loadKernel, numberedEdges, oc } from '../src/Kernel.js';
import { edgeCurvature } from '../src/edgeCurvature.js';
import { edgeFaces } from '../src/edgeFaces.js';
import { checkSeam, levelOf, seamSummary } from '../src/seamCheck.js';

before(async () => { await loadKernel() });

/**
 * A cubic Bezier sheet over x in [x0, x1], y in [0, 100], z = c[0] + c[1] x + c[2] x² + c[3] x³:
 * exact, because the cubic's Bernstein poles come from its Taylor terms at x0.
 */
function sheet(x0, x1, c) {
    const o = oc(), L = x1 - x0;
    const d = [
        c[0] + c[1] * x0 + c[2] * x0 ** 2 + c[3] * x0 ** 3,
        (c[1] + 2 * c[2] * x0 + 3 * c[3] * x0 ** 2) * L,
        (c[2] + 3 * c[3] * x0) * L ** 2,
        c[3] * L ** 3,
    ];
    const z = [d[0], d[0] + d[1] / 3, d[0] + 2 * d[1] / 3 + d[2] / 3, d[0] + d[1] + d[2] + d[3]];
    const poles = new o.NCollection_Array2_gp_Pnt(1, 4, 1, 4);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) poles.SetValue(i + 1, j + 1, new o.gp_Pnt(x0 + L * i / 3, 100 * j / 3, z[i]));
    const arr = (vals, Type) => { const a = new Type(1, vals.length); vals.forEach((v, i) => a.SetValue(i + 1, v)); return a; };
    const k = () => arr([0, 1], o.NCollection_Array1_double), m = () => arr([4, 4], o.NCollection_Array1_int);
    return new o.BRepBuilderAPI_MakeFace(new o.Geom_BSplineSurface(poles, k(), k(), m(), m(), 3, 3, false, false), 1e-7).Face();
}
/** The edge of `shape` whose middle is at x = 0, y = 50. */
const seamEdge = shape => {
    const o = oc();
    return numberedEdges(shape).findIndex(e => {
        const c = new o.BRepAdaptor_Curve(e), p = c.Value((c.FirstParameter() + c.LastParameter()) / 2);
        return Math.abs(p.X()) < 1e-6 && Math.abs(p.Y() - 50) < 1e-6;
    });
};
/** A backend over plain shapes, numbered by body id. */
const backendOf = shapes => ({
    edgeCurvature: async ({ body, edge, n }) => edgeCurvature(shapes[body], edge, n),
    edgeFaces: async ({ body, edge, points }) => edgeFaces(shapes[body], edge, points),
});
const pair = async (ca, cb) => {
    const a = sheet(-100, 0, ca), b = sheet(0, 100, cb);
    return checkSeam(backendOf([a, b]), { body: 0, edge: seamEdge(a), other: { body: 1, edge: seamEdge(b) } });
};

test('one cubic on both sides is G3', async () => {
    const r = await pair([0, 0, 0.002, 0.00001], [0, 0, 0.002, 0.00001]);
    assert.ok(r.worst.gap < 1e-6, `gap ${r.worst.gap}`);
    assert.ok(r.worst.angle < 1e-4, `angle ${r.worst.angle}`);
    assert.ok(r.worst.g2 < 0.01, `g2 ${r.worst.g2}`);
    assert.ok(r.worst.g3 < 1, `g3 ${r.worst.g3}`);
    assert.equal(r.level, 'G3', seamSummary(r));
});

test('same up to the second derivative is G2, and G3 sees the jump', async () => {
    const r = await pair([0, 0, 0.002, 0], [0, 0, 0.002, 0.00003]);
    assert.ok(r.worst.g2 < 0.01, `g2 ${r.worst.g2}`);
    assert.ok(r.worst.g3 > 50, `g3 ${r.worst.g3}`);
    assert.equal(r.level, 'G2', seamSummary(r));
});

test('a flat sheet beside a parabola is G1 with a large G2 difference', async () => {
    const r = await pair([0, 0, 0, 0], [0, 0, 0.002, 0]);
    assert.ok(r.worst.angle < 1e-4, `angle ${r.worst.angle}`);
    assert.ok(r.worst.g2 > 99, `g2 ${r.worst.g2}`);
    assert.equal(r.level, 'G1', seamSummary(r));
});

test('a kink is G0 and the angle is measured', async () => {
    const r = await pair([0, 0, 0, 0], [0, 0.1, 0, 0]);
    assert.ok(Math.abs(r.worst.angle - Math.atan(0.1) * 180 / Math.PI) < 1e-3, `angle ${r.worst.angle}`);
    assert.equal(r.level, 'G0');
});

test('a gap is caught', async () => {
    const r = await pair([0, 0, 0, 0], [0.01, 0, 0, 0]);
    assert.ok(Math.abs(r.worst.gap - 0.01) < 1e-6, `gap ${r.worst.gap}`);
    assert.equal(r.level, 'none');
});

test('an edge two faces of one shell share is measured on its own', async () => {
    const o = oc();
    const sew = new o.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);
    sew.Add(sheet(-100, 0, [0, 0, 0.002, 0]));
    sew.Add(sheet(0, 100, [0, 0, 0, 0]));
    sew.Perform(new o.Message_ProgressRange());
    const shell = sew.SewedShape();
    const r = await checkSeam(backendOf([shell]), { body: 0, edge: seamEdge(shell) });
    assert.equal(r.faces.length, 2);
    assert.notEqual(r.faces[0], r.faces[1]);
    assert.equal(r.level, 'G1', seamSummary(r));
});

test('levelOf reads the targets in order', () => {
    assert.equal(levelOf({ gap: 0, angle: 0, g2: 0.1, g3: null }), 'G2');
    assert.equal(levelOf({ gap: 0, angle: 0.06, g2: 0, g3: 0 }), 'G0');
});
