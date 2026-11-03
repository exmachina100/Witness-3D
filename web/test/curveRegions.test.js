// Plasticity's regions from every coplanar curve together, in the browser build. The desktop's
// tests are crates/w3d-kernel/tests/regions.rs; these mirror them.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { curveRegions } from '../src/Forms.js';
import { loadKernel, tessellate } from '../src/Kernel.js';

before(async () => { await loadKernel() });

const ground = c => ({ origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1], ...c });
const poly = (points, closed) => ground({ kind: 'polyline', points, closed });
function area(face) {
    const { mesh } = tessellate(face, { deflection: 0.001 });
    const p = mesh.getAttribute('position'), idx = mesh.getIndex();
    let a = 0;
    const v = i => [p.getX(i), p.getY(i), p.getZ(i)];
    for (let t = 0; t < idx.count; t += 3) {
        const [A, B, C] = [v(idx.getX(t)), v(idx.getX(t + 1)), v(idx.getX(t + 2))];
        const u = B.map((x, k) => x - A[k]), w = C.map((x, k) => x - A[k]);
        a += Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2;
    }
    return a;
}
const areas = cs => curveRegions(cs).map(area).sort((a, b) => a - b);
const close = (a, b, eps) => { assert.equal(a.length, b.length, `${a} vs ${b}`); a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) < eps, `${a} vs ${b}`)); };

test('a line across a rectangle makes two regions', () => {
    close(areas([poly([[0, 0], [20, 0], [20, 10], [0, 10]], true), poly([[5, -5], [5, 15]], false)]), [50, 150], 1e-6);
});

test('overlapping circles make three regions', () => {
    const lens = 2 * 100 * (Math.PI / 3 - Math.sqrt(3) / 4);
    close(areas([ground({ kind: 'circle', center: [0, 0], radius: 10 }), ground({ kind: 'circle', center: [10, 0], radius: 10 })]), [lens, 100 * Math.PI - lens, 100 * Math.PI - lens], 0.05);
});

test('an inner loop makes the outer region a ring', () => {
    close(areas([poly([[0, 0], [20, 0], [20, 20], [0, 20]], true), poly([[5, 5], [15, 5], [15, 15], [5, 15]], true)]), [100, 300], 1e-6);
});

test('lines meeting end to end close a region', () => {
    close(areas([poly([[0, 0], [10, 0]], false), poly([[10, 0], [10, 10]], false), poly([[10, 10], [0, 10], [0, 0]], false), poly([[20, 0], [30, 0]], false)]), [100], 1e-6);
});

test('a region of crossing curves extrudes', async () => {
    const { LocalBackend } = await import('../src/app/LocalBackend.js');
    const { volume } = await import('../src/Kernel.js');
    const be = new LocalBackend({ seed: 'enclosure' });
    be.shapes.clear();
    const { ids } = await be.addCurves([poly([[0, 0], [20, 0], [20, 10], [0, 10]], true), poly([[5, -5], [5, 15]], false)]);
    const shown = await be.curveRegions({ curves: ids });
    assert.equal(shown.length, 2);
    const small = shown.findIndex(b => b.positions.length && Math.max(...b.positions.filter((_, i) => i % 3 === 0)) < 5.5);
    const { id } = await be.commit({ arrangement: ids, pieces: [small], distance: 4, op: 'new' });
    assert.ok(Math.abs(volume(be.shapes.get(id)) - 200) < 1e-6);
});
