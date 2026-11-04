import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navAction, orbitMode, NAV_PRESET_IDS } from '../src/navPresets.js';

test('Plasticity: middle orbits, Shift+middle and right pan, Ctrl+middle zooms, left selects', () => {
    assert.equal(navAction('plasticity', 1), 'orbit');
    assert.equal(navAction('plasticity', 1, { shift: true }), 'pan');
    assert.equal(navAction('plasticity', 1, { ctrl: true }), 'zoom');
    assert.equal(navAction('plasticity', 2), 'pan');
    assert.equal(navAction('plasticity', 0), null);
});

test('Maya and Rhino', () => {
    assert.deepEqual([0, 1, 2].map(b => navAction('maya', b, { alt: true })), ['orbit', 'pan', 'zoom']);
    assert.equal(navAction('maya', 0), null);
    assert.equal(navAction('rhino', 2), 'orbit');
    assert.equal(navAction('rhino', 2, { shift: true }), 'pan');
    assert.equal(navAction('unknown', 1), 'orbit');
    assert.ok(NAV_PRESET_IDS.includes('blender'));
});

test('orbit modes undo OrbitControls swapping rotate and pan under a modifier', () => {
    assert.equal(orbitMode('orbit'), 0);
    assert.equal(orbitMode('pan'), 2);
    assert.equal(orbitMode('pan', { shift: true }), 0);
    assert.equal(orbitMode('orbit', { shift: true }), 2);
    assert.equal(orbitMode('zoom', { ctrl: true }), 1);
    assert.equal(orbitMode(null), null);
});

test('hints name each preset\'s orbit and pan', async () => {
    const { navHints } = await import('../src/navPresets.js');
    assert.deepEqual(navHints('plasticity'), [['MMB', 'ORBIT'], ['RMB', 'PAN']]);
    assert.deepEqual(navHints('maya'), [['ALT LMB', 'ORBIT'], ['MMB', 'PAN']]);
});
