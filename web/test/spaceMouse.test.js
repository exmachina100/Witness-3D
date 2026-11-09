import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readReport, spaceMouseStep, DEADZONE } from '../src/app/spaceMouse.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const report = (...vals) => { const d = new DataView(new ArrayBuffer(2 * vals.length)); vals.forEach((v, i) => d.setInt16(2 * i, v, true)); return d; };
const at = (t = [0, 0, 0], r = [0, 0, 0]) => ({ t, r });
const pos = V(0, 0, 100), target = V(0, 0, 0), up = V(0, 1, 0);

test('reports: 1 is translation (all six axes on newer devices), 2 rotation, others ignored', () => {
    const a = at();
    assert.ok(readReport(a, 1, report(10, -20, 30)));
    assert.deepEqual(a.t, [10, -20, 30]);
    assert.ok(readReport(a, 2, report(-1, 2, -3)));
    assert.deepEqual(a.r, [-1, 2, -3]);
    assert.ok(readReport(a, 1, report(1, 2, 3, 4, 5, 6)));
    assert.deepEqual([a.t, a.r], [[1, 2, 3], [4, 5, 6]]);
    assert.equal(readReport(a, 3, report(9, 9, 9)), false);
});

test('at rest, or inside the dead zone, the view stays', () => {
    assert.equal(spaceMouseStep(pos, target, up, at(), 0.016), null);
    assert.equal(spaceMouseStep(pos, target, up, at([DEADZONE - 1, 0, 0], [0, 0, -(DEADZONE - 1)]), 0.016), null);
});

test('pushing right pans the camera and its target right together', () => {
    const r = spaceMouseStep(pos, target, up, at([350, 0, 0]), 0.1);
    assert.ok(r.position.x > 9 && r.target.x > 9, `${r.position.x}`);
    assert.ok(Math.abs(r.position.x - r.target.x) < 1e-9 && Math.abs(r.position.z - 100) < 1e-9);
    const inv = spaceMouseStep(pos, target, up, at([350, 0, 0]), 0.1, { invertPan: true });
    assert.ok(inv.position.x < -9);
});

test('lifting the cap pans up; pushing it away zooms in, keeping the target', () => {
    const lift = spaceMouseStep(pos, target, up, at([0, 0, -350]), 0.1);
    assert.ok(lift.position.y > 9 && lift.target.y > 9);
    const zoom = spaceMouseStep(pos, target, up, at([0, 350, 0]), 0.1);
    assert.ok(zoom.position.distanceTo(target) < 95 && zoom.target.distanceTo(target) < 1e-9);
    const out = spaceMouseStep(pos, target, up, at([0, 350, 0]), 0.1, { invertZoom: true });
    assert.ok(out.position.distanceTo(target) > 105);
});

test('twisting orbits about the vertical through the target, keeping the distance', () => {
    const r = spaceMouseStep(pos, target, up, at([0, 0, 0], [0, 0, 350]), 0.1);
    assert.ok(Math.abs(r.position.length() - 100) < 1e-9 && Math.abs(r.position.y) < 1e-9);
    assert.ok(Math.abs(r.position.x) > 10, 'it turned');
    const tilt = spaceMouseStep(pos, target, up, at([0, 0, 0], [350, 0, 0]), 0.1);
    assert.ok(Math.abs(tilt.position.y) > 10 && Math.abs(tilt.position.length() - 100) < 1e-9, 'tilting turns the view up or down');
});
