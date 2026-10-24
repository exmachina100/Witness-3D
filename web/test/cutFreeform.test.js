// Plasticity's Cut by a free-form face: the face's surface carried on past its sides, so a small
// curved sheet inside a block still cuts it in two (w3d_face_sheet on the desktop).
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { loadKernel, oc } from '../src/Kernel.js';

before(async () => { await loadKernel() });

/** A 10 × 10 Bezier sheet bulging in x, standing in the middle of the seed block. */
function bulge() {
    const o = oc();
    const poles = new o.NCollection_Array2_gp_Pnt(1, 4, 1, 4);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) poles.SetValue(i + 1, j + 1, new o.gp_Pnt([0, 2, 2, 0][j], 10 + 10 * i / 3, -5 + 10 * j / 3));
    const arr = (vals, Type) => { const a = new Type(1, vals.length); vals.forEach((v, i) => a.SetValue(i + 1, v)); return a; };
    const k = () => arr([0, 1], o.NCollection_Array1_double), m = () => arr([4, 4], o.NCollection_Array1_int);
    const s = new o.Geom_BSplineSurface(poles, k(), k(), m(), m(), 3, 3, false, false);
    return new o.BRepBuilderAPI_MakeFace(s, 1e-7).Face();
}

test('a curved face cuts by its extension', async () => {
    const be = new LocalBackend();
    const seed = be.scene()[0];
    be.shapes.set(999, bulge());
    const [[, r]] = be.cutResult({ bodies: [seed.id], tools: { faces: [{ body: 999, face: 0 }] } });
    assert.equal(r.pieces.length, 2, 'the extended sheet cuts the block in two');
});
