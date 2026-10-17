import assert from 'node:assert/strict';
import { test } from 'node:test';
import { P_MENU, RADIALS, mergeKeys, parseRadial, shortLabel, showKey, sliceAt, slicePosition } from '../src/app/menus.js';
import { ACTIONS, VIEWPORT } from '../src/app/keymap.js';

test('the P-Menu follows the manual, with its keys', () => {
    assert.deepEqual(P_MENU.map(e => e.label), ['RECENT FILES', 'NEW FILE', 'OPEN', 'IMPORT', 'SAVE', 'SAVE AS', 'EXPORT', 'QUICK SAVE VERSION', 'CURRENT VERSION', 'QUIT']);
    for (const [k, a] of [['ctrl-n', 'file:new'], ['ctrl-o', 'file:open'], ['ctrl-shift-o', 'import:step'], ['ctrl-s', 'file:save'], ['ctrl-shift-s', 'file:save-as'], ['ctrl-shift-e', 'file:export'], ['ctrl-q', 'app:quit']]) assert.equal(VIEWPORT[k], a, k);
    for (const e of P_MENU) if (e.action !== 'app:version') assert.ok(ACTIONS[e.action], e.action);
});

test('the default radial menus run known actions; Plasticity gives them no key', () => {
    assert.deepEqual(RADIALS[0].items.map(i => i.label), ['CONTROL POINT', 'SOLID', 'EDGE', 'FACE']);
    for (const m of RADIALS) {
        assert.ok(ACTIONS[`radial:${m.command}`]);
        assert.ok(!Object.values(VIEWPORT).includes(`radial:${m.command}`));
        for (const it of m.items) assert.ok(ACTIONS[it.command], it.command);
    }
});

test('radial files are checked', () => {
    const known = a => a in ACTIONS;
    const ok = parseRadial(JSON.stringify({ name: 'Mine', command: 'p-mine', items: [{ command: 'view:ortho', label: 'Ortho' }, { command: 'view:radial:selection-mode', label: 'more' }] }), known);
    assert.equal(ok.menu.items[0].label, 'ORTHO');
    assert.equal(shortLabel(ok.menu.items[1]), 'MO');
    assert.match(parseRadial('{', known).error, /JSON/);
    assert.match(parseRadial(JSON.stringify({ name: 'x', command: 'a b', items: [] }), known).error, /COMMAND ID/);
    assert.match(parseRadial(JSON.stringify({ name: 'x', command: 'x', items: [{ command: 'rm:rf' }] }), known).error, /UNKNOWN COMMAND RM:RF/);
});

test('slices go clockwise from the top and the pointer picks the nearest', () => {
    const [x0, y0] = slicePosition(0, 4, 100), [x1, y1] = slicePosition(1, 4, 100);
    assert.ok(Math.abs(x0) < 1e-9 && Math.abs(y0 + 100) < 1e-9);
    assert.ok(Math.abs(x1 - 100) < 1e-9 && Math.abs(y1) < 1e-9);
    assert.equal(sliceAt(0, -50, 4), 0);
    assert.equal(sliceAt(50, 5, 4), 1);
    assert.equal(sliceAt(-3, 60, 4), 2);
    assert.equal(sliceAt(-60, -20, 4), 3);
    assert.equal(sliceAt(3, 3, 4), -1);
    assert.equal(sliceAt(-10, -60, 8), 0);   // just left of the top is still the top
});

test('keys set by the user sit over the defaults', () => {
    const k = mergeKeys({ a: 'select:all', b: 'tool:fillet' }, { a: '', q: 'radial:selection-mode', b: 'tool:boolean' });
    assert.deepEqual(k, { b: 'tool:boolean', q: 'radial:selection-mode' });
    assert.equal(showKey('ctrl-shift-s'), 'CTRL SHIFT S');
});
