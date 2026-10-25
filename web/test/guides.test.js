// Loft and Sweep guides and Sweep alignment in the browser build. The desktop's tests are
// crates/w3d-kernel/tests/guides.rs; these mirror them.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { LocalBackend } from '../src/app/LocalBackend.js';
import * as THREE from 'three';
import { loadKernel, oc, tessellate, volume } from '../src/Kernel.js';

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

test('guides that miss the profiles are refused', async () => {
    const { f } = await loftWith([line([-3, 0], [-3, 20])]);
    assert.throws(f, /touch/);
});

test('a third guide bends the sections onto it too', async () => {
    // On the x = 10 plane, (u, v) is (10, v, -u): the squares' (10, y, 10) corner bowed out to z = 14.
    const third = { origin: [10, 0, 0], x: [0, 0, -1], normal: [1, 0, 0], kind: 'arc', start: [-10, 0], mid: [-14, 10], end: [-10, 20] };
    const { f } = await loftWith([line([0, 0], [0, 20]), arc([10, 0], [15, 10], [10, 20]), third]);
    const tool = f().tool, o = oc();
    close(bounds(tool).max.x, 15, 0.1);
    // Points along the third guide lie on the loft.
    // The arc has radius 14.5 about (y, z) = (10, -0.5).
    const end = Math.asin(10 / 14.5);
    for (const t of [-0.5, 0, 0.5]) {
        const a = end * t, y = 10 + 14.5 * Math.sin(a), z = -0.5 + 14.5 * Math.cos(a);
        const d = new o.BRepExtrema_DistShapeShape(new o.BRepBuilderAPI_MakeVertex(new o.gp_Pnt(10, y, z)).Shape(), tool);
        assert.ok(d.Value() < 0.05, `${d.Value()} mm off the third guide at ${t}`);
    }
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

test('a second guide scales the section to touch both', async () => {
    const be = new LocalBackend();
    const { ids } = await be.addCurves([
        { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'polyline', points: [[-5, -5], [5, -5], [5, 5], [-5, 5]], closed: true },
        line([0, 0], [0, 20]),
    ]);
    // The (5, ·, -5) corner runs out to (10, 20, -10); the (-5, ·, 5) corner goes straight up, so
    // the section grows to 15 × 15: a frustum, whatever the method.
    const { ids: guides } = await be.addCurves([
        { origin: [5, 0, -5], x: [5, 20, -5], normal: [1, 0, 1], kind: 'polyline', points: [[0, 0], [Math.hypot(5, 20, 5), 0]], closed: false },
        { origin: [-5, 0, 5], x: [0, 1, 0], normal: [1, 0, 0], kind: 'polyline', points: [[0, 0], [20, 0]], closed: false },
    ]);
    const frustum = 20 / 3 * (100 + 225 + 150);
    for (const method of ['point', 'chord', 'curve']) {
        const tool = be.form({ kind: 'sweep', regions: [ids[0]], path: ids[1], guides, method }).tool;
        close(volume(tool), frustum, frustum * 1e-3);
        const b = bounds(tool);
        close(b.max.x, 10, 0.01);
        close(b.min.x, -5, 0.01);
    }
    assert.throws(() => be.form({ kind: 'sweep', regions: [ids[0]], path: ids[1], guides: [...guides, guides[0]] }), /one or two guides/);
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

test('Round corners round the section about the path corner', async () => {
    const be = new LocalBackend();
    // A 2 × 2 square swept up 10 and then along +X 10, as crates/w3d-kernel/tests/guides.rs.
    const { ids } = await be.addCurves([
        { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'polyline', points: [[-1, -1], [1, -1], [1, 1], [-1, 1]], closed: true },
        { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1], kind: 'polyline', points: [[0, 0], [0, 10], [10, 10]], closed: false },
    ]);
    const sweep = corner => be.form({ kind: 'sweep', regions: [ids[0]], path: ids[1], corner }).tool;
    close(volume(sweep('mitre')), 80, 1e-6);
    close(volume(sweep('round')), 80 - 2 + Math.PI / 2, 0.05);
});

test('a body edge serves as a guide, given as a curve through points along it', async () => {
    const { be, f } = await loftWith([arc([0, 0], [-5, 10], [0, 20])]);
    const { id } = await be.commitForm({ kind: 'loft', regions: [1, 2], guides: [3] });
    // The bowed edge of that loft, read as Loft and Sweep read a picked edge.
    const { numberedEdges } = await import('../src/Kernel.js');
    const { smoothThrough } = await import('../src/deform.js');
    const { curveFromNurbs } = await import('../src/curves.js');
    let edge = null;
    for (let n = 0; n < numberedEdges(be.shapes.get(id)).length; n++) {
        const teeth = await be.edgeCurvature({ body: id, edge: n, n: 64 });
        if (Math.min(...teeth.map(t => t.at[0])) < -4.9) { edge = teeth; break; }
    }
    assert.ok(edge, 'the bowed edge');
    const guide = curveFromNurbs(smoothThrough(edge.map(t => t.at), false), [0, -1, 0]);
    const b = bounds(be.form({ kind: 'loft', regions: [1, 2], guides: [guide] }).tool);
    close(b.min.x, -5, 0.01);
    close(bounds(f().tool).min.x, b.min.x, 0.01);
});

test('a curve replaced by an edited copy of itself is listed under its new id, and lofts', async () => {
    const be = new LocalBackend();
    await be.addCurves([square(0), square(5)]);
    // A move hands back the listed curve spread with new points: it still carries id 2 and samples.
    const listed = be.curves().find(c => c.id === 2);
    const { ids: [moved] } = await be.replaceCurves([2], [{ ...listed, origin: [0, 20, 0] }]);
    assert.deepEqual(be.curves().map(c => c.id), [1, moved]);
    close(volume(be.form({ kind: 'loft', regions: [1, moved] }).tool), 2000, 0.5);
});
