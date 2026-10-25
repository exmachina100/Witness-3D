import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { arcballAbout } from '../src/app/orbit.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

test('arcball turns about the screen axis square to the drag and carries the up with it', () => {
    const pos = V(0, 0, 10), target = V(0, 0, 0), up = V(0, 1, 0), right = V(1, 0, 0);
    // A drag straight down a quarter of the height: a quarter turn over the top, as orbit would start.
    const r = arcballAbout(pos, target, up, right, target, 0, 100, 400);
    assert.ok(r.position.distanceTo(V(0, 10, 0)) < 1e-9, `${r.position.toArray()}`);
    assert.ok(r.up.distanceTo(V(0, 0, -1)) < 1e-9);
    // Again: past the pole with no clamp, the view now looks from behind and upside down.
    const r2 = arcballAbout(r.position, r.target, r.up, right, target, 0, 100, 400);
    assert.ok(r2.position.distanceTo(V(0, 0, -10)) < 1e-9 && r2.up.distanceTo(V(0, -1, 0)) < 1e-9);
    // A sideways quarter-height drag: a quarter turn about the camera's up, through the pivot.
    const s = arcballAbout(pos, target, up, right, V(5, 0, 0), 100, 0, 400);
    assert.ok(s.position.distanceTo(V(-5, 0, -5)) < 1e-9, `${s.position.toArray()}`);
    assert.ok(s.target.distanceTo(V(5, 0, -5)) < 1e-9);
    assert.deepEqual(arcballAbout(pos, target, up, right, target, 0, 0, 400).position.toArray(), [0, 0, 10]);
});
