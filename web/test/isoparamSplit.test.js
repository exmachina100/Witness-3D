// Isoparam's edges in the browser build (isoparamSplit.js).
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { box, count, loadKernel, volume } from '../src/Kernel.js';
import { facePoles } from '../src/facePoles.js';
import { isoparamSplit } from '../src/isoparamSplit.js';

before(async () => { await loadKernel() });

const topOf = shape => facePoles(shape).findIndex(rows => rows.length && rows.flat().every(p => Math.abs(p[2] - 10) < 1e-9));

test('a box top splits through a point and at set places', () => {
    const b = box({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 });
    const top = topOf(b);
    const one = isoparamSplit(b, top, true, [5, 3, 10]);
    assert.equal(count(one.shape, 'TopAbs_FACE'), 7);
    const three = isoparamSplit(b, top, false, [0, 0, 0], [0.25, 0.5, 0.75]);
    assert.equal(count(three.shape, 'TopAbs_FACE'), 9);
    assert.ok(Math.abs(volume(three.shape) - 1000) < 1e-6);
    assert.throws(() => isoparamSplit(b, top, true, [0, 0, 0], [1]), /between 0 and 1/);
    // The other faces keep their numbers' successors.
    assert.ok(three.history.faces[0].length > 0);
});

test('subdivide gives each piece its own control points, meeting along the cut', () => {
    const b = box({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 });
    const { shape } = isoparamSplit(b, topOf(b), true, [0, 0, 0], [0.3], true);
    assert.equal(count(shape, 'TopAbs_FACE'), 7);
    assert.ok(Math.abs(volume(shape) - 1000) < 1e-6, `${volume(shape)}`);
    const tops = facePoles(shape).filter(rows => rows.length && rows.flat().every(p => Math.abs(p[2] - 10) < 1e-9));
    assert.equal(tops.length, 2);
    const span = (rows, k) => { const v = rows.flat().map(p => p[k]); return [Math.min(...v), Math.max(...v)]; };
    const cut = k => {
        const [a, c] = [span(tops[0], k), span(tops[1], k)].sort((x, y) => x[0] - y[0]);
        return Math.abs(a[0]) < 1e-9 && Math.abs(a[1] - c[0]) < 1e-9 && Math.abs(c[1] - 10) < 1e-9 ? a[1] : null;
    };
    const at = cut(0) ?? cut(1);
    assert.ok(at !== null && (Math.abs(at - 3) < 1e-6 || Math.abs(at - 7) < 1e-6), JSON.stringify(tops.map(r => [span(r, 0), span(r, 1)])));
});
