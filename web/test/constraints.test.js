import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Constraints } from '../src/app/constraints.js';

const store = () => {
    const m = new Map([[1, { x: 0 }], [2, { x: 10 }], [3, { bridge: true }]]);
    let next = 4;
    const replace = (ids, list) => { for (const id of ids) m.delete(id); return list.map(c => { const id = next++; m.set(id, c); return id; }); };
    return { m, get: id => m.get(id), replace };
};
const rebuild = ([a, b]) => ({ bridge: true, from: a.x, to: b.x });

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
    assert.deepEqual(k.live(id => s.m.has(id)).map(r => [...r.ins, r.out]), [[1, 2, 3]]);
    // Moving again from there still follows.
    const q = k.plan([2], [{ x: 30 }], s.get, rebuild);
    assert.deepEqual(q.list, [{ bridge: true, from: 0, to: 30 }]);
    const made = s.replace([2, 3], [{ x: 30 }, q.list[0]]);
    q.done(made);
    assert.deepEqual(k.live(id => s.m.has(id)).map(r => [...r.ins, r.out]), [[1, made[0], made[1]]]);
});

test('an aligned curve follows its reference', () => {
    const s = store(), k = new Constraints();
    k.addAlign(1, 1, 2, 0, { continuity: 'G1' });
    const p = k.plan([2], [{ x: 7 }], s.get, ([ref], kk, out) => ({ x: out.x, meets: ref.x, g: kk.options.continuity }));
    assert.deepEqual(p.ids, [1]);
    assert.deepEqual(p.list, [{ x: 0, meets: 7, g: 'G1' }]);
});

test('a Square sheet follows its curves, and lets them go when one is split', () => {
    const k = new Constraints(), live = new Set([1, 2, 5]);
    k.addSheet(9, [1, 2], { degree: 3 });
    assert.equal(k.count, 1);
    // Curve 5 is no side of the sheet: nothing to fit.
    assert.deepEqual(k.sheetsOn([5], id => live.has(id)), []);
    const hits = k.sheetsOn([2], id => live.has(id));
    assert.equal(hits.length, 1);
    const again = k.moveSheets(hits, [2], [7]);
    assert.deepEqual(again.map(r => [r.k.sheet, r.curves]), [[9, [1, 7]]]);
    live.delete(2); live.add(7);
    // Split: two curves for one, and the sheet stays as it is.
    const split = k.sheetsOn([7], id => live.has(id));
    assert.deepEqual(k.moveSheets(split, [7], [11, 12]), []);
    assert.equal(k.count, 0);
});

test('an aligned sheet follows its reference body and lets go when edited itself', () => {
    const k = new Constraints();
    k.addSurface(5, 7, [0, 0, 0], [1, 0, 0], { continuity: 'G1' });
    assert.equal(k.count, 1);
    assert.deepEqual(k.bodyEdited(9), []);
    const due = k.bodyEdited(7);
    assert.equal(due.length, 1);
    assert.equal(due[0].target, 5);
    assert.equal(due[0].options.continuity, 'G1');
    assert.deepEqual(k.bodyEdited(5), []);   // the sheet itself edited: constraint gone
    assert.equal(k.count, 0);
});

test('a sheet side follows one reference, and a failed align drops it', () => {
    const k = new Constraints();
    k.addSurface(5, 7, [0, 0, 0], [1, 0, 0], {});
    k.addSurface(5, 8, [0, 0, 0], [2, 0, 0], {});
    assert.equal(k.count, 1);
    assert.deepEqual(k.bodyEdited(7), []);
    const [c] = k.bodyEdited(8);
    k.dropSurface(c);
    assert.equal(k.count, 0);
    k.addSurface(5, 7, [0, 0, 0], [1, 0, 0], {});
    k.clear();
    assert.equal(k.count, 0);
});
