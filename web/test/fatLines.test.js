import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { segmentPairs, thickness, updateThickLines } from '../src/app/fatLines.js';

test('lines become segment pairs: strips joined, loops closed, segments as they are', () => {
    const p = [0, 0, 0, 1, 0, 0, 1, 1, 0];
    assert.deepEqual(segmentPairs(p, 'strip'), [0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0]);
    assert.deepEqual(segmentPairs(p, 'loop'), [0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 0, 0, 0]);
    assert.deepEqual([...segmentPairs(new Float32Array([...p, 2, 2, 0]), 'segments')], [...p, 2, 2, 0]);
    assert.deepEqual(segmentPairs(p, 'strip', 2), [0, 0, 0, 1, 0, 0]);
});

test('marked lines get a thick copy past 1 px and lose it at 1', () => {
    const scene = new THREE.Scene();
    const edges = thickness(new THREE.LineBasicMaterial({ color: 0xff0000, opacity: 0.5, transparent: true }), 'edge');
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0), new THREE.Vector3(1, 1, 0)]), edges);
    const other = new THREE.Line(line.geometry, new THREE.LineBasicMaterial());
    scene.add(line, other);
    const size = new THREE.Vector2(800, 600);
    updateThickLines(scene, { edge: 3, curve: 1 }, size);
    const copy = line.userData.thick;
    assert.ok(copy?.isLineSegments2);
    assert.equal(copy.material.linewidth, 3);
    assert.equal(copy.material.opacity, 0.5);
    assert.equal(copy.material.color.getHex(), 0xff0000);
    assert.equal(copy.geometry.instanceCount, 2);
    assert.equal(edges.visible, false, 'the thin line stops drawing');
    assert.equal(other.userData.thick, undefined, 'unmarked lines stay thin');
    // Raycasting the scene never hits the copy, so picking still finds the thin line.
    const hits = [];
    copy.raycast(new THREE.Raycaster(), hits);
    assert.equal(hits.length, 0);
    updateThickLines(scene, { edge: 1, curve: 1 }, size);
    assert.equal(line.userData.thick, undefined);
    assert.equal(line.children.length, 0);
    assert.equal(edges.visible, true);
});
