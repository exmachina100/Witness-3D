// Conic and G2 fillet shapes in the browser build (filletShape.js reshapeRounds); the desktop's
// tests are crates/w3d-kernel/tests/fillet_shapes.rs and these mirror them.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { boolean, box, loadKernel, numberedEdges, oc, volume } from '../src/Kernel.js';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { roundSection } from '../src/filletShape.js';

before(async () => { await loadKernel() });

const FULL = 40 * 30 * 20;

/** A 40 × 30 × 20 block in a backend, and the numbers of its edges along y at z = 0 (x = 0 and x = 40). */
function block() {
    const o = oc(), be = new LocalBackend(), b = box({ x: 0, y: 0, z: 0 }, { x: 40, y: 30, z: 20 });
    be.put(1, b);
    const at = x => numberedEdges(b).findIndex(e => {
        const c = new o.BRepAdaptor_Curve(e);
        return [c.FirstParameter(), c.LastParameter()].every(t => { const p = c.Value(t); return Math.abs(p.X() - x) < 1e-6 && Math.abs(p.Z()) < 1e-6; });
    });
    return { be, e: at(0), f: at(40) };
}

/** The area a section cuts off a right-angled corner whose spring points are `r` from it. */
function cornerArea(r, kind, tension) {
    const n = 4000, ring = [[0, 0, 0]];
    for (let i = 0; i <= n; i++) ring.push(roundSection([r, 0, 0], [0, 0, 0], [0, r, 0], kind, tension, i / n));
    let a = 0;
    for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p[0] * q[1] - p[1] * q[0]; }
    return Math.abs(a) / 2;
}

const fillet = (be, edges, shape, tension) => be.blend({ body: 1, edges, size: 5, kind: 'fillet', shape, tension });

test('conic keeps the spring lines and follows rho', () => {
    const { be, e } = block();
    for (const rho of [0.3, 0.5, 0.7]) {
        const out = fillet(be, [e], 'conic', rho);
        const want = FULL - 30 * cornerArea(5, 'conic', rho);
        assert.ok(Math.abs(volume(out) - want) < 0.01, `rho ${rho}: ${volume(out)} against ${want}`);
    }
});

test('G2 rounds two edges', () => {
    const { be, e, f } = block();
    const out = fillet(be, [e, f], 'g2', 0.5);
    const want = FULL - 2 * 30 * cornerArea(5, 'g2', 0.5);
    assert.ok(Math.abs(volume(out) - want) < 0.01, `${volume(out)} against ${want}`);
});

test('a bad tension is refused', () => {
    const { be, e } = block();
    assert.throws(() => fillet(be, [e], 'conic', 0.99), /tension/);
});

test('a round rim takes the shapes', () => {
    const o = oc(), be = new LocalBackend();
    // A block with a bowl cut into its top: the rim joins a flat face to a ball.
    const slab = box({ x: 0, y: 0, z: 0 }, { x: 100, y: 100, z: 50 });
    const ball = new o.BRepPrimAPI_MakeSphere(new o.gp_Pnt(50, 50, 80), 40).Shape();
    const s = boolean(slab, ball, 'difference');
    be.put(1, s);
    const rim = numberedEdges(s).findIndex(e => {
        const c = new o.BRepAdaptor_Curve(e);
        return c.GetType() === o.GeomAbs_CurveType.GeomAbs_Circle && Math.abs(c.Value(c.FirstParameter()).Z() - 50) < 1e-6;
    });
    assert.ok(rim >= 0);
    const round = volume(be.blend({ body: 1, edges: [rim], size: 4, kind: 'fillet' }));
    for (const shape of ['conic', 'g2']) {
        const out = be.blend({ body: 1, edges: [rim], size: 4, kind: 'fillet', shape, tension: 0.5 });
        assert.ok(Math.abs(volume(out) - round) < 20, `${shape}: ${volume(out)} against ${round}`);
    }
});
