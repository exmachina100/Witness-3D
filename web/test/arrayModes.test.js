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
