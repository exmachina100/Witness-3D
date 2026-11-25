// Loft of curves with guides (Shift+click) in the browser build. The desktop's test is
// a_sheet_loft_of_curves_bends_out_to_its_guides in crates/w3d-kernel/tests/guides.rs.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { loadKernel } from '../src/Kernel.js';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { isSheet } from '../src/Patch.js';

before(async () => { await loadKernel() });

/** The lowest and highest z of a shape's mesh. */
const zRange = async (be, s) => {
    const { positions: p } = await be.body(0, s);
    let lo = Infinity, hi = -Infinity;
    for (let i = 2; i < p.length; i += 3) { lo = Math.min(lo, p[i]); hi = Math.max(hi, p[i]); }
    return [lo, hi];
};
/** A straight line along x at height y, drawn on the ground (normal z). */
const line = y => ({ origin: [0, y, 0], x: [1, 0, 0], normal: [0, 0, 1], kind: 'polyline', points: [[0, 0], [10, 0]], closed: false });
/** An arc from (x, 0, 0) up through (x, 10, 5) to (x, 20, 0). */
const arc = x => ({ origin: [x, 0, 0], x: [0, 1, 0], normal: [1, 0, 0], kind: 'arc', start: [0, 0], mid: [10, 5], end: [20, 0] });

test('a loft of two lines bows up to its guides; a loop or a profile as guide is refused', async () => {
    const be = new LocalBackend({ seed: 'enclosure' });
    const { ids: [a, b, g1, g2] } = await be.addCurves([line(0), line(20), arc(0), arc(10)]);
    const flat = be.loftSheetResult({ curves: [a, b], simplify: false });
    assert.ok(Math.abs((await zRange(be, flat))[1]) < 1e-6);
    for (const guides of [[g1], [g1, g2]]) {
        const s = be.loftSheetResult({ curves: [a, b], guides, simplify: false });
        assert.ok(isSheet(s));
        const [lo, hi] = await zRange(be, s);
        assert.ok(Math.abs(hi - 5) < 0.02 && Math.abs(lo) < 0.01, `z ${lo}..${hi}`);
    }
    const { id, scene } = await be.commitLoftSheet({ curves: [a, b], guides: [g1] });
    assert.ok(scene.some(x => x.id === id));
    assert.throws(() => be.loftSheetResult({ curves: [a, b], guides: [a] }), /both a profile and a guide/);
});

test('a loft of two faces is a solid between them', async () => {
    const { box, facePlane, volume } = await import('../src/Kernel.js');
    const THREE = await import('three');
    const be = new LocalBackend({ seed: 'enclosure' });
    const a = 101, b = 102;
    be.put(a, box(new THREE.Vector3(100, 0, 0), new THREE.Vector3(110, 10, 10)));
    be.put(b, box(new THREE.Vector3(100, 20, 0), new THREE.Vector3(110, 30, 10)));
    const facing = (id, y) => [0, 1, 2, 3, 4, 5].find(f => Math.abs((n => (n.y ?? n[1]))(facePlane(be.shapes.get(id), f).normal) - y) < 1e-9);
    const s = be.loftSheetResult({ faces: [[a, facing(a, 1)], [b, facing(b, -1)]] });
    assert.ok(Math.abs(volume(s) - 1000) < 1);
    assert.throws(() => be.loftSheetResult({ faces: [[a, 0]] }), /two faces/);
});

/** The x and y extent of a shape's mesh. */
const xyRange = async (be, s) => {
    const { positions: p } = await be.body(0, s);
    const r = [Infinity, -Infinity, Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) { r[0] = Math.min(r[0], p[i]); r[1] = Math.max(r[1], p[i]); r[2] = Math.min(r[2], p[i + 1]); r[3] = Math.max(r[3], p[i + 1]); }
    return r;
};
/** A straight line along x from x0 to x1 at y, and one along y from y0 to y1 at x. */
const xLine = (y, x0, x1) => ({ origin: [0, y, 0], x: [1, 0, 0], normal: [0, 0, 1], kind: 'polyline', points: [[x0, 0], [x1, 0]], closed: false });
const yLine = (x, y0, y1) => ({ origin: [x, 0, 0], x: [0, 1, 0], normal: [0, 0, 1], kind: 'polyline', points: [[y0, 0], [y1, 0]], closed: false });
const near = (a, b) => Math.abs(a - b) < 0.02;

test('Trim overlap: Guides cuts profiles running past the guides, Profiles off runs on to the guides\' ends', async () => {
    const be = new LocalBackend({ seed: 'enclosure' });
    // Profiles from x -5 to 15 at y 0 and 20; guides at x 0 and 10 from y -5 to 25.
    const { ids: [a, b, g1, g2] } = await be.addCurves([xLine(0, -5, 15), xLine(20, -5, 15), yLine(0, -5, 25), yLine(10, -5, 25)]);
    const req = { curves: [a, b], guides: [g1, g2], simplify: false };
    const [x0, x1, y0, y1] = await xyRange(be, be.loftSheetResult(req));
    assert.ok(near(x0, 0) && near(x1, 10) && near(y0, 0) && near(y1, 20), `trimmed ${[x0, x1, y0, y1]}`);
    const kept = await xyRange(be, be.loftSheetResult({ ...req, trimGuides: false }));
    assert.ok(near(kept[0], -5) && near(kept[1], 15) && near(kept[2], 0) && near(kept[3], 20), `profiles whole ${kept}`);
    const run = await xyRange(be, be.loftSheetResult({ ...req, trimProfiles: false }));
    assert.ok(near(run[0], 0) && near(run[1], 10) && near(run[2], -5) && near(run[3], 25), `run on ${run}`);
    const both = await xyRange(be, be.loftSheetResult({ ...req, trimGuides: false, trimProfiles: false }));
    assert.ok(near(both[0], -5) && near(both[1], 15) && near(both[2], -5) && near(both[3], 25), `neither ${both}`);
});
