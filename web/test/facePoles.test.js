// Toggle Points in the browser build (facePoles.js): each face's control points.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { box, loadKernel, primitive } from '../src/Kernel.js';
import { facePoles } from '../src/facePoles.js';

before(async () => { await loadKernel() });

test('a block face has its four corners', () => {
    const faces = facePoles(box([0, 0, 0], [10, 20, 30]));
    assert.equal(faces.length, 6);
    for (const rows of faces) {
        assert.deepEqual([rows.length, rows[0].length], [2, 2]);
    }
});

test('a ball gets a grid of points round it', () => {
    const faces = facePoles(primitive({ kind: 'sphere', center: [0, 0, 0], radius: 10 }));
    assert.equal(faces.length, 1);
    assert.ok(faces[0].length >= 4 && faces[0][0].length >= 4);
});
