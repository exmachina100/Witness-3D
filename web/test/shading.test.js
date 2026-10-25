import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ENVIRONMENTS, MATERIAL_LIBRARY, SHADERS, SHADER_OPTIONS, checkMaterial, formatMass, massOf, newMaterial, shader } from '../src/app/shading.js';
import { VIEWPORT, ACTIONS } from '../src/app/keymap.js';

test('the fourteen shader modes of the manual, in its order, each with its own mode number', () => {
    assert.deepEqual(SHADERS.map(s => s.name), ['Ceramic dark', 'Metal carpaint', 'Dark shiny', 'Gradient', 'Ceramic lightbulb', 'Color matcap',
        'Black silhouette', 'Color silhouette', 'Isophote / isoangle', 'Draft angle', 'Horizontal zebra', 'Vertical zebra', 'Topography', 'Face direction']);
    assert.deepEqual(SHADERS.map(s => s.mode), SHADERS.map((_, i) => i));
    for (const s of SHADERS) if (s.option) assert.ok(SHADER_OPTIONS[s.option], s.id);
    // The modes that show material colours, as the manual marks them.
    assert.deepEqual(SHADERS.filter(s => s.color).map(s => s.id), ['ceramic-light', 'color', 'color-silhouette']);
    assert.equal(shader('nope').id, 'ceramic-dark');
    assert.ok(ENVIRONMENTS.length >= 3);
});

test('materials carry the base parameters and are checked', () => {
    const m = newMaterial(3);
    assert.equal(m.name, 'MATERIAL 3');
    assert.deepEqual(checkMaterial(m), []);
    assert.equal(checkMaterial({ ...m, roughness: 1.5 }).length, 1);
    assert.equal(checkMaterial({ ...m, color: 'red', density: 0 }).length, 2);
    assert.equal(checkMaterial({ ...m, ior: 0.9 }).length, 1);
    // The advanced parameters start off and are checked too.
    for (const k of ['clearcoat', 'sheen', 'iridescence', 'transmission', 'thickness']) assert.equal(m[k], 0);
    assert.equal(checkMaterial({ ...m, clearcoat: 1, transmission: 0.5, sheenColor: '#ff8800' }).length, 0);
    assert.equal(checkMaterial({ ...m, sheen: 2, sheenColor: 'blue', thickness: -1 }).length, 3);
});

test('mass from volume in mm³ and density in g/cm³', () => {
    // A 60 × 40 × 50 mm steel block: 120 cm³ × 7.85 = 942 g.
    assert.equal(massOf(120000, 7.85), 942);
    assert.equal(formatMass(942), '942.00 G');
    assert.equal(formatMass(2400), '2.400 KG');
});

test('M sets a material; render and the viewport toggles are in the palette', () => {
    assert.equal(VIEWPORT.m, 'material:set');
    for (const a of ['material:set', 'material:remove', 'view:render', 'view:edges', 'view:faces', 'view:curves']) assert.ok(ACTIONS[a], a);
});

test('the material library presets are valid materials with their own names', () => {
    assert.ok(MATERIAL_LIBRARY.length >= 20);
    assert.equal(new Set(MATERIAL_LIBRARY.map(m => m.name)).size, MATERIAL_LIBRARY.length);
    for (const preset of MATERIAL_LIBRARY) assert.deepEqual(checkMaterial(newMaterial(1, { ...preset })), [], preset.name);
});
