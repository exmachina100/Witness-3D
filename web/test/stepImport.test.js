import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as THREE from 'three';
import { box, count, exportSTEP, importSTEP, loadKernel, volume } from '../src/Kernel.js';

before(async () => { await loadKernel() });

test('a STEP file written out reads back as the same solid', () => {
    const b = box(new THREE.Vector3(-40, 0, -25), new THREE.Vector3(40, 30, 25));
    const back = importSTEP(exportSTEP(b));
    assert.equal(count(back, 'TopAbs_SOLID'), 1);
    assert.ok(Math.abs(volume(back) - 120000) < 1e-3, `${volume(back)}`);
});

test('text that is not STEP is refused with a reason', () => {
    assert.throws(() => importSTEP(new TextEncoder().encode('not a step file')), /could not be read|holds no shapes/);
});
