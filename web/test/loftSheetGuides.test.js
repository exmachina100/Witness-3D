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
