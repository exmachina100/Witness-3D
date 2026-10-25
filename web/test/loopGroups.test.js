import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { closesUp, groupLoops } from '../src/loopGroups.js';

const v = (x, y) => new THREE.Vector3(x, y, 0);
const seg = (a, b) => ({ closed: false, ends: [v(...a), v(...b)] });

test('pieces sort into the loops they make', () => {
    const square = [seg([0, 0], [1, 0]), seg([1, 0], [1, 1]), seg([1, 1], [0, 1]), seg([0, 1], [0, 0])];
    const circle = { closed: true, ends: [] };
    const open = [seg([5, 5], [6, 5]), seg([6, 5], [6, 6])];
    const groups = groupLoops([square[0], circle, open[0], square[2], square[1], open[1], square[3]]);
    assert.deepEqual(groups.map(g => g.length), [4, 1, 2]);
    assert.deepEqual(groups.map(g => closesUp(g)), [true, true, false]);
});
