import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { orbitAbout, dragAngles } from '../src/app/orbit.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const near = (a, b, msg) => assert.ok(a.distanceTo(b) < 1e-9, `${msg}: ${a.toArray()} vs ${b.toArray()}`);

test('turning about a pivot keeps distances to it and the view direction relative', () => {
    const pos = V(0, 50, 200), target = V(0, 0, 0), pivot = V(40, 10, 0);
    const r = orbitAbout(pos, target, pivot, 0.4, 0.2);
    assert.ok(Math.abs(r.position.distanceTo(pivot) - pos.distanceTo(pivot)) < 1e-9);
    assert.ok(Math.abs(r.target.distanceTo(pivot) - target.distanceTo(pivot)) < 1e-9);
    assert.ok(Math.abs(r.position.distanceTo(r.target) - pos.distanceTo(target)) < 1e-9);
    // The pivot stays where it was on screen: its offset in the camera's frame is unchanged.
    const frame = (p, t) => { const m = new THREE.Matrix4().lookAt(p, t, V(0, 1, 0)); return pivot.clone().sub(p).applyMatrix4(m.clone().invert()); };
    near(frame(r.position, r.target), frame(pos, target), 'pivot in view');
});

test('azimuth alone turns about the vertical through the pivot', () => {
    const r = orbitAbout(V(0, 0, 100), V(0, 0, 0), V(0, 0, 50), Math.PI, 0);
    near(r.position, V(0, 0, 0), 'position');
    near(r.target, V(0, 0, 100), 'target');
});

test('elevation stops short of looking straight down', () => {
    const pos = V(0, 0, 100), target = V(0, 0, 0);
    const r = orbitAbout(pos, target, target, 0, Math.PI);
    const polar = r.target.clone().sub(r.position).angleTo(V(0, 1, 0));
    assert.ok(polar > 0.009 && polar < 0.011 || polar > Math.PI - 0.011 && polar < Math.PI - 0.009, String(polar));
    assert.ok(Math.abs(r.position.length() - 100) < 1e-9);
    const d = dragAngles(100, -50, 400, 2);
    assert.ok(Math.abs(d.azimuth + Math.PI) < 1e-12 && Math.abs(d.elevation - Math.PI / 2) < 1e-12);
});
