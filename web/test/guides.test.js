// Loft and Sweep guides and Sweep alignment in the browser build. The desktop's tests are
// crates/w3d-kernel/tests/guides.rs; these mirror them.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { LocalBackend } from '../src/app/LocalBackend.js';
import * as THREE from 'three';
import { loadKernel, tessellate, volume } from '../src/Kernel.js';

before(async () => { await loadKernel() });

/** The box round a fine tessellation (the B-rep box is loose round curved faces). */
function bounds(shape) {
    const { mesh } = tessellate(shape, { deflection: 0.001 });
    return new THREE.Box3().setFromBufferAttribute(mesh.getAttribute('position'));
}
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
/** A 10 × 10 square from (0, y, 0) to (10, y, 10), drawn on a plane square to Y (its y runs along -Z). */
const square = y => ({ origin: [0, y, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'polyline', points: [[0, 0], [10, 0], [10, -10], [0, -10]], closed: true });
/** An arc on the XY plane through three points. */
const arc = (start, mid, end) => ({ origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1], kind: 'arc', start, mid, end });
const line = (a, b) => ({ origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1], kind: 'polyline', points: [a, b], closed: false });

async function loftWith(guides) {
    const be = new LocalBackend();
    const { ids } = await be.addCurves([square(0), square(20), ...guides]);
    return { be, f: () => be.form({ kind: 'loft', regions: ids.slice(0, 2), guides: ids.slice(2) }) };
}

test('a loft along a straight guide is the plain loft', async () => {
    const { f } = await loftWith([line([0, 0], [0, 20])]);
    close(volume(f().tool), 2000, 0.5);
});

test('a loft bends out to its guide, and a second guide stretches it', async () => {
    let { f } = await loftWith([arc([0, 0], [-5, 10], [0, 20])]);
    let b = bounds(f().tool);
    close(b.min.x, -5, 0.01);
    close(b.min.y, 0, 0.01);
    close(b.max.y, 20, 0.01);
    ({ f } = await loftWith([line([0, 0], [0, 20]), arc([10, 0], [15, 10], [10, 20])]));
    // The second guide is on the squares' (10, y, 0) corner.
    b = bounds(f().tool);
    close(b.max.x, 15, 0.05);
    close(b.min.x, 0, 0.01);
});

test('guides that miss the profiles, or too many, are refused', async () => {
    let { f } = await loftWith([line([-3, 0], [-3, 20])]);
    assert.throws(f, /touch/);
    ({ f } = await loftWith([line([0, 0], [0, 20]), line([0, 0], [0, 20]), line([0, 0], [0, 20])]));
    assert.throws(f, /two guides/);
});

test('Point keeps the section on the guide; Chord does not scale it', async () => {
    const be = new LocalBackend();
    // A 10 × 10 square centred on the Y axis on the ground (y = 0), swept up Y with a guide from
    // its corner (5, 0, 5) out to (10, 20, 10).
    const { ids } = await be.addCurves([
        { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'polyline', points: [[-5, -5], [5, -5], [5, 5], [-5, 5]], closed: true },
        line([0, 0], [0, 20]),
    ]);
    // The guide is not on a drawing plane, so it is a curve drawn on the plane through it.
    const { ids: [guide] } = await be.addCurves([{ origin: [5, 0, -5], x: [5, 20, -5], normal: [1, 0, 1], kind: 'polyline', points: [[0, 0], [Math.hypot(5, 20, 5), 0]], closed: false }]);
    const sweep = method => be.form({ kind: 'sweep', regions: [ids[0]], path: ids[1], guides: [guide], method }).tool;
    const grown = sweep('point');
    // The square's (5, ·, -5) corner (its plane y runs along -Z) is where the guide starts.
    close(volume(grown), 20 / 3 * (100 + 400 + 200), 20 / 3 * 700 * 1e-3);
    close(bounds(grown).max.x, 10, 0.01);
    close(volume(sweep('chord')), 2000, 0.5);
});

test('Parallel keeps the section at its drawn angle', async () => {
    const be = new LocalBackend();
    const c = Math.SQRT1_2;
    // A 2 × 2 square on the ground, swept a quarter turn from the origin up to (10, 10, 0).
    const { ids } = await be.addCurves([
        { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'polyline', points: [[-1, -1], [1, -1], [1, 1], [-1, 1]], closed: true },
        arc([0, 0], [10 - 10 * c, 10 * c], [10, 10]),
    ]);
    const turned = be.form({ kind: 'sweep', regions: [ids[0]], path: ids[1] }).tool;
    close(bounds(turned).max.y, 11, 0.05);
    const flat = be.form({ kind: 'sweep', regions: [ids[0]], path: ids[1], align: 'parallel' }).tool;
    close(bounds(flat).max.y, 10, 0.01);
    assert.throws(() => be.form({ kind: 'sweep', regions: [ids[0]], path: ids[1], align: 'parallel', twist: 1 }), /twist/);
});
