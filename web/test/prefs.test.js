import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultPrefs, readPrefs, setPref, changedPrefs, controlSettings, viewColors, PREF_FIELDS } from '../src/app/prefs.js';

test('defaults cover every field', () => {
    const d = defaultPrefs();
    for (const [s, fs] of Object.entries(PREF_FIELDS)) for (const f of fs) assert.equal(d[s][f.key], f.value);
    assert.equal(d.navigation.zoomToCursor, true);
    assert.equal(d.network.bridgePort, 8981);
});

test('a stored copy is read safely over the defaults', () => {
    const p = readPrefs({ navigation: { invertZoom: true, zoomSpeed: 99, panSpeed: 'x' }, appearance: { accent: '#00FF00', grid: 'red' }, network: { bridgePort: '5000.4' }, junk: 1 });
    assert.equal(p.navigation.invertZoom, true);
    assert.equal(p.navigation.zoomSpeed, 5);
    assert.equal(p.navigation.panSpeed, 1);
    assert.equal(p.appearance.accent, '#00ff00');
    assert.equal(p.appearance.grid, '#19191c');
    assert.equal(p.network.bridgePort, 5000);
    assert.deepEqual(readPrefs(null), defaultPrefs());
    assert.deepEqual(readPrefs('nope'), defaultPrefs());
});

test('only changed settings are stored', () => {
    let p = setPref(defaultPrefs(), 'appearance', 'pointSize', 8);
    p = setPref(p, 'navigation', 'invertZoom', true);
    p = setPref(p, 'nope', 'x', 1);
    assert.deepEqual(changedPrefs(p), { appearance: { pointSize: 8 }, navigation: { invertZoom: true } });
    assert.deepEqual(readPrefs(changedPrefs(p)), p);
});

test('inverted zoom is a negative zoom speed; colours are numbers', () => {
    const c = controlSettings({ zoomToCursor: false, invertZoom: true, zoomSpeed: 2, rotateSpeed: 1, panSpeed: 1 });
    assert.equal(c.zoomSpeed, -2);
    assert.equal(c.zoomToCursor, false);
    assert.deepEqual(viewColors(defaultPrefs().appearance), { accent: 0xff4d00, ground: 0x0f0f11, grid: 0x19191c, gridMajor: 0x232327 });
});
