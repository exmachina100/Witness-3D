// Plasticity's array modes: Rectangular Spacing / Extent and Radial Total / Spacing.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arrayMotions, radialSpec, rectangularSpec } from '../src/arrayMotions.js';

test('Extent spreads the copies over the whole distance; Spacing steps by it', () => {
    const steps = [[30, 0, 0], [0, 30, 0], [0, 0, 30]], counts = [4, 1, 1];
    assert.deepEqual(arrayMotions(rectangularSpec(steps, counts)).map(m => m.offset[0]), [30, 60, 90]);
    assert.deepEqual(arrayMotions(rectangularSpec(steps, counts, 'extent')).map(m => m.offset[0]), [10, 20, 30]);
});

test('Radial Total spreads over the angle; Spacing turns each copy by it', () => {
    const total = arrayMotions(radialSpec([0, 0, 0], [0, 1, 0], Math.PI, 3));
    assert.deepEqual(total.map(m => m.angle), [Math.PI / 2, Math.PI]);
    const spaced = arrayMotions(radialSpec([0, 0, 0], [0, 2, 0], Math.PI / 2, 5, 'spacing'));
    assert.deepEqual(spaced.map(m => m.angle), [1, 2, 3, 4].map(k => k * Math.PI / 2));
    assert.deepEqual(spaced[0].axis, [0, 1, 0]);
    assert.equal(arrayMotions(radialSpec([0, 0, 0], [0, 1, 0], 0.5, 1, 'spacing')).length, 0);
});

test('radial rings: each ring further out along the way to the solids, every ring with all its copies', () => {
    const spec = radialSpec([0, 0, 0], [0, 1, 0], 2 * Math.PI, 4, 'total', { count: 3, step: 10, out: [1, 5, 0] });
    assert.equal(spec.kind, 'motions');
    const m = spec.motions;
    assert.equal(m.length, 3 * 4 - 1);
    // Ring 1, first copy: no turn, 10 out along x (the axis part of `out` dropped).
    const r1 = m[3];
    assert.ok(Math.abs(r1.angle) < 1e-12 && Math.abs(r1.offset[0] - 10) < 1e-9 && Math.abs(r1.offset[1]) < 1e-9);
    // Ring 2, second copy: a quarter turn about y, the 20 mm out turned with it.
    const r2 = m[3 + 4 + 0];
    assert.ok(Math.abs(r2.angle) < 1e-12 && Math.abs(r2.offset[0] - 20) < 1e-9);
    const q = m[3 + 4 + 1];
    assert.ok(Math.abs(q.angle - Math.PI / 2) < 1e-9 && Math.abs(Math.hypot(...q.offset) - 20) < 1e-9 && Math.abs(q.offset[0]) < 1e-9);
    assert.equal(radialSpec([0, 0, 0], [0, 1, 0], Math.PI, 4, 'total', { count: 1, step: 10, out: [1, 0, 0] }).kind, 'radial');
});
