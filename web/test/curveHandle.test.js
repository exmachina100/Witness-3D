// Bridge Curve's 2026.2 gizmo handles: where along a curve the pointer is, and the point at a parameter.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { nearestAlong, pointAlong } from '../src/CurveHandle.js';

const line = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0), new THREE.Vector3(10, 30, 0)];

test('the point at a parameter goes by length along the polyline', () => {
    const { point, tangent } = pointAlong(line, 0.5);
    assert.ok(point.distanceTo(new THREE.Vector3(10, 10, 0)) < 1e-9);
    assert.ok(tangent.distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-9);
    assert.ok(pointAlong(line, -1).point.equals(line[0]));
    assert.ok(pointAlong(line, 2).point.equals(line[2]));
});

test('the pointer is taken to the nearest point along the curve on screen', () => {
    const screen = line.map(p => [p.x, p.y]);
    assert.ok(Math.abs(nearestAlong(screen, line, 5, -3) - 5 / 40) < 1e-9);
    assert.ok(Math.abs(nearestAlong(screen, line, 14, 20) - 30 / 40) < 1e-9);
    assert.equal(nearestAlong(screen, line, -5, 0), 0);
    assert.equal(nearestAlong([[0, 0]], [line[0]], 1, 1), undefined);
});
