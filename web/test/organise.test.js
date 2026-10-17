import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Organise } from '../src/app/Organise.js';
import { VIEWPORT, ACTIONS } from '../src/app/keymap.js';

test('isolate shows only the selection, in layers that step back one at a time', () => {
    const o = new Organise();
    o.prune([1, 2, 3, 4]);
    assert.equal(o.isolate([1, 2, 3]), 1);
    assert.equal(o.isolate([2]), 2);
    assert.deepEqual([1, 2, 3, 4].filter(id => o.shows(id)), [2]);
    assert.equal(o.isolated, 1);
    assert.equal(o.isolate([]), 1);   // . with nothing selected
    assert.deepEqual([1, 2, 3, 4].filter(id => o.shows(id)), [1, 2, 3]);
    o.isolate([1]);
    o.unisolate();                     // Alt+. reveals everything
    assert.equal(o.isolated, 0);
    assert.deepEqual([1, 2, 3, 4].filter(id => o.shows(id)), [1, 2, 3, 4]);
});

test('a body made while isolated shows; a layer whose bodies are all gone closes', () => {
    const o = new Organise();
    o.prune([1, 2]);
    o.isolate([1]);
    o.prune([1, 2, 5]);
    assert.ok(o.shows(5) && o.shows(1) && !o.shows(2));
    o.isolate([5]);
    o.prune([1, 2]);
    assert.equal(o.layers.length, 1);
});

test('hidden and locked: Ctrl+H inverts what is hidden, locked bodies show but do not pick', () => {
    const o = new Organise();
    o.prune([1, 2, 3]);
    o.setHidden([1], true);
    o.invertHidden([1, 2, 3]);
    assert.deepEqual([1, 2, 3].filter(id => o.shows(id)), [1]);
    o.invertHidden([1, 2, 3]);
    o.setLocked([2], true);
    assert.ok(o.shows(2) && !o.picks(2) && o.picks(3));
    o.setLocked([2], false);
    assert.ok(o.picks(2));
});

test('groups nest, dissolve into their parent and keep empty folders', () => {
    const o = new Organise();
    const ids = [1, 2, 3, 4];
    o.prune(ids);
    const outer = o.makeGroup([1, 2, 3]);
    assert.equal(outer.name, 'GROUP 1');
    const inner = o.makeGroup([2, 3]);   // all in GROUP 1, so it nests there
    assert.equal(inner.parent, outer.id);
    assert.deepEqual(o.members(outer.id, ids), [1]);
    assert.deepEqual(o.allMembers(outer.id, ids), [1, 2, 3]);
    assert.deepEqual(o.members(null, ids), [4]);
    assert.equal(o.makeGroup([1, 4]).parent, null); // from different places: at the top
    o.rename(inner.id, ' handles ');
    assert.equal(o.group(inner.id).name, 'HANDLES');
    assert.equal(o.ungroup([2]), 1);    // Alt+G: HANDLES dissolves into GROUP 1
    assert.equal(o.group(inner.id), undefined);
    assert.deepEqual(o.members(outer.id, ids).sort(), [2, 3]);
    o.prune([2, 3]);
    assert.deepEqual(o.allMembers(3, [2, 3]), []);
    assert.ok(o.group(3), 'an emptied group stays');
    assert.equal(o.ungroup([]), 0);
    assert.equal(o.makeGroup([]), null);
});

test('the keys follow the manual', () => {
    assert.equal(VIEWPORT['.'], 'isolate');
    assert.equal(VIEWPORT['alt-.'], 'unisolate');
    assert.equal(VIEWPORT['ctrl-g'], 'group');
    assert.equal(VIEWPORT['alt-g'], 'ungroup');
    assert.equal(VIEWPORT['ctrl-h'], 'invert-hidden');
    for (const a of ['lock', 'unlock-all', 'isolate', 'unisolate', 'group', 'ungroup', 'invert-hidden']) assert.ok(ACTIONS[a], a);
});

test('groups, hidden and locked go through the file; isolation does not', () => {
    const o = new Organise();
    o.prune([1, 2, 3]);
    const g = o.makeGroup([1, 2]);
    o.makeGroup([2]);
    o.rename(g.id, 'base');
    o.setHidden([3], true);
    o.setLocked([1], true);
    o.isolate([1]);
    const back = Organise.from(JSON.parse(JSON.stringify(o.toJSON())));
    assert.deepEqual(back.allMembers(g.id, [1, 2, 3]), [1, 2]);
    assert.equal(back.group(g.id).name, 'BASE');
    assert.equal(back.group(2).parent, g.id);
    assert.ok(back.hidden.has(3) && back.locked.has(1));
    assert.equal(back.layers.length, 0);
    assert.equal(back.makeGroup([3]).id, 3);
    // Damaged or missing state opens empty rather than failing.
    for (const bad of [null, 7, { groups: [{ id: 'x' }], groupOf: [[1, 99]], hidden: ['a'] }]) {
        const e = Organise.from(bad);
        assert.equal(e.groups.length + e.groupOf.size + e.hidden.size, 0);
    }
});
