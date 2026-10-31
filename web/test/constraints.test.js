import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Constraints } from '../src/app/constraints.js';

const store = () => {
    const m = new Map([[1, { x: 0 }], [2, { x: 10 }], [3, { bridge: true }]]);
    let next = 4;
    const replace = (ids, list) => { for (const id of ids) m.delete(id); return list.map(c => { const id = next++; m.set(id, c); return id; }); };
    return { m, get: id => m.get(id), replace };
};
const rebuild = (a, b) => ({ bridge: true, from: a.x, to: b.x });

test('moving a bridged curve remakes the bridge in the same replacement', () => {
    const s = store(), k = new Constraints();
    k.addBridge(3, 1, 1, 2, 0, {});
    const p = k.plan([1], [{ x: 5 }], s.get, rebuild);
    assert.deepEqual(p.ids, [3]);
    assert.deepEqual(p.list, [{ bridge: true, from: 5, to: 10 }]);
    const made = s.replace([1, ...p.ids], [{ x: 5 }, ...p.list]);
    p.done(made);
    // A second move follows the new ids.
    const q = k.plan([2], [{ x: 20 }], s.get, rebuild);
    assert.deepEqual(q.list, [{ bridge: true, from: 5, to: 20 }]);
    assert.deepEqual(q.ids, [made[1]]);
});

test('editing the bridge itself lets the constraint go; a split leaves the bridge alone', () => {
    const s = store(), k = new Constraints();
    k.addBridge(3, 1, 1, 2, 0, {});
    assert.equal(k.plan([1, 2], [{ x: 1 }], s.get, rebuild).ids.length, 0);
    assert.equal(k.list.length, 1);
    k.plan([3], [{ bridge: 'moved' }], s.get, rebuild);
    assert.equal(k.list.length, 0);
});

test('undo brings the older ids back and the chain still finds them', () => {
    const s = store(), k = new Constraints();
    k.addBridge(3, 1, 1, 2, 0, {});
    const p = k.plan([1], [{ x: 5 }], s.get, rebuild);
    p.done(s.replace([1, 3], [{ x: 5 }, p.list[0]]));
    // Undo: the new curves go, the old come back.
    s.m.clear(); s.m.set(1, { x: 0 }); s.m.set(2, { x: 10 }); s.m.set(3, { bridge: true });
    assert.deepEqual(k.live(id => s.m.has(id)).map(r => [r.a, r.b, r.bridge]), [[1, 2, 3]]);
    // Moving again from there still follows.
    const q = k.plan([2], [{ x: 30 }], s.get, rebuild);
    assert.deepEqual(q.list, [{ bridge: true, from: 0, to: 30 }]);
    const made = s.replace([2, 3], [{ x: 30 }, q.list[0]]);
    q.done(made);
    assert.deepEqual(k.live(id => s.m.has(id)).map(r => [r.a, r.b, r.bridge]), [[1, made[0], made[1]]]);
});
