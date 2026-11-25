// Seam Solver (LABS): a sheet's side moved to meet another sheet in G2 and G3, then measured by Seam Check.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { loadKernel, numberedEdges, oc } from '../src/Kernel.js';
import { edgeCurvature } from '../src/edgeCurvature.js';
import { edgeFaces } from '../src/edgeFaces.js';
import { moveFacePoles } from '../src/movePoles.js';
import { checkSeam, seamSummary } from '../src/seamCheck.js';
import { basisDers, seamSolveRequest } from '../src/seamSolver.js';
import { basis } from '../src/alignSurface.js';

before(async () => { await loadKernel() });

/** A B-spline sheet over x in [x0, x1] (degree `p` across x, one span), y in [0, 100], z = f(x, y) at the poles. */
function sheet(x0, x1, f, p = 3) {
    const o = oc(), nu = p + 1;
    const poles = new o.NCollection_Array2_gp_Pnt(1, nu, 1, 4);
    for (let i = 0; i < nu; i++) for (let j = 0; j < 4; j++) {
        const x = x0 + (x1 - x0) * i / p, y = 100 * j / 3;
        poles.SetValue(i + 1, j + 1, new o.gp_Pnt(x, y, f(x, y)));
    }
    const arr = (vals, Type) => { const a = new Type(1, vals.length); vals.forEach((v, i) => a.SetValue(i + 1, v)); return a; };
    const k = () => arr([0, 1], o.NCollection_Array1_double);
    return new o.BRepBuilderAPI_MakeFace(new o.Geom_BSplineSurface(poles, k(), k(), arr([nu, nu], o.NCollection_Array1_int), arr([4, 4], o.NCollection_Array1_int), p, 3, false, false), 1e-7).Face();
}
const seamEdge = shape => {
    const o = oc();
    return numberedEdges(shape).findIndex(e => {
        const c = new o.BRepAdaptor_Curve(e), q = c.Value((c.FirstParameter() + c.LastParameter()) / 2);
        return Math.abs(q.X()) < 1e-6 && Math.abs(q.Y() - 50) < 1e-6;
    });
};
const backendOf = shapes => ({
    edgeCurvature: async ({ body, edge, n }) => edgeCurvature(shapes[body], edge, n),
    edgeFaces: async ({ body, edge, points }) => edgeFaces(shapes[body], edge, points),
});

async function solveAndCheck(continuity, p) {
    // The reference: a doubly curved cubic sheet (exact poles of z = 0.002 x² + 0.00002 x³ + 0.001 y² are not needed: poles
    // set on the function give a smooth sheet whose own derivatives are what is matched).
    const ref = sheet(0, 100, (x, y) => 0.002 * x * x + 0.00002 * x ** 3 + 0.001 * (y - 50) ** 2);
    // The target: a tilted, flat-ish sheet that only touches nothing in particular.
    const tgt = sheet(-100, 0, (x, y) => -0.05 * x + 2 + 0.0005 * (y - 50) ** 2, p);
    const shapes = [tgt, ref], backend = backendOf(shapes);
    const target = { body: 0, edge: seamEdge(tgt) }, reference = { body: 1, edge: seamEdge(ref) };
    const req = await seamSolveRequest(backend, { target, reference, continuity });
    shapes[0] = moveFacePoles(tgt, req.moves);
    return checkSeam(backend, { body: 0, edge: seamEdge(shapes[0]), other: { body: 1, edge: reference.edge } });
}

test('basisDers agrees with the plain basis and its derivative', () => {
    const t = [0, 0, 0, 0, 0.3, 0.7, 1, 1, 1, 1], x = 0.45;
    const { N, dN } = basis(t, 3, x), D = basisDers(t, 3, x, 2);
    N.forEach((v, i) => assert.ok(Math.abs(v - D[0][i]) < 1e-12));
    dN.forEach((v, i) => assert.ok(Math.abs(v - D[1][i]) < 1e-9));
    // The second derivative against a difference of first ones.
    const e = 1e-6, a = basis(t, 3, x + e).dN, b = basis(t, 3, x - e).dN;
    a.forEach((v, i) => assert.ok(Math.abs((v - b[i]) / (2 * e) - D[2][i]) < 1e-4));
});

test('G2 solve meets the reference in G2 on a degree 5 sheet', async () => {
    const r = await solveAndCheck('G2', 5);
    console.log('G2:', seamSummary(r));
    assert.ok(r.worst.gap < 0.01, seamSummary(r));
    assert.ok(r.worst.angle < 0.5, seamSummary(r));
});

test('G3 solve meets every Class-A target where G2 alone misses G3', async () => {
    const g2 = await solveAndCheck('G2', 5), g3 = await solveAndCheck('G3', 5);
    console.log('G3:', seamSummary(g3));
    assert.ok(g2.worst.g3 > 50, `G2 alone ${g2.worst.g3}`);
    assert.equal(g3.level, 'G3', seamSummary(g3));
    assert.ok(g3.worst.gap < 0.001 && g3.worst.angle < 0.05 && g3.worst.g2 < 0.5, seamSummary(g3));
});
