// Loft of curves in the browser build (Forms.js loftSheet, LocalBackend): a sheet through the
// curves in order, and Loop back to the first.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { boundaryEdges, count, loadKernel } from '../src/Kernel.js';
import { LocalBackend } from '../src/app/LocalBackend.js';

before(async () => { await loadKernel() });

/** A line along x, 10 long, at height `z` and depth `y` (drawn on the plane facing up). */
const line = (y, z) => ({ origin: [0, y, z], x: [1, 0, 0], normal: [0, 1, 0], kind: 'polyline', points: [[0, 0], [10, 0]], closed: false });
const circle = (z) => ({ origin: [0, 0, z], x: [1, 0, 0], normal: [0, 0, 1], kind: 'circle', center: [0, 0], radius: 5 });

test('two lines make a sheet, two circles an open tube, as a new body in one undo step', async () => {
    const be = new LocalBackend();
    const { ids } = await be.addCurves([line(0, 0), line(5, 0)]);
    const s = be.loftSheetResult({ curves: ids });
    assert.equal(count(s, 'TopAbs_SOLID'), 0);
    assert.equal(count(s, 'TopAbs_FACE'), 1);
    assert.equal(boundaryEdges(s).length, 4);
    const before = be.bodies().length;
    const { id, scene } = await be.commitLoftSheet({ curves: ids });
    assert.equal(scene.length, before + 1);
    assert.ok(be.shapes.has(id));
    const { ids: rings } = await be.addCurves([circle(0), circle(20)]);
    assert.equal(count(be.loftSheetResult({ curves: rings }), 'TopAbs_SOLID'), 0);
});

test('Loop runs the sheet back to the first curve, and needs three', async () => {
    const be = new LocalBackend();
    const { ids } = await be.addCurves([line(0, 0), line(10, 0), line(5, 8)]);
    const open = be.loftSheetResult({ curves: ids }), looped = be.loftSheetResult({ curves: ids, loop: true });
    assert.ok(boundaryEdges(looped).length < boundaryEdges(open).length);
    assert.throws(() => be.loftSheetResult({ curves: ids.slice(0, 2), loop: true }), /three curves/);
});

test('a profile can be a curve given whole, as a body edge is sent', async () => {
    const be = new LocalBackend();
    const { ids: [a] } = await be.addCurves([line(0, 0)]);
    const s = be.loftSheetResult({ curves: [a, line(5, 3)] });
    assert.equal(count(s, 'TopAbs_FACE'), 1);
    assert.equal(boundaryEdges(s).length, 4);
});

test('Simplify makes a flat loft a trimmed plane; off keeps the lofted surface', async () => {
    const { facePlane } = await import('../src/Kernel.js');
    const be = new LocalBackend();
    // An arc and a line side by side in one plane: the loft lies flat, but as a B-spline surface.
    const arc = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0], kind: 'arc', start: [0, 0], mid: [5, 2], end: [10, 0] };
    const { ids } = await be.addCurves([arc, line(0, -8)]);
    assert.ok(facePlane(be.loftSheetResult({ curves: ids }), 0));
    assert.equal(facePlane(be.loftSheetResult({ curves: ids, simplify: false }), 0), undefined);
    const { ids: up } = await be.addCurves([line(0, 0), line(5, 3)]);
    assert.equal(count(be.loftSheetResult({ curves: up }), 'TopAbs_FACE'), 1);
});
