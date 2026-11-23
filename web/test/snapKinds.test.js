import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowed, defaultSnaps, kindOf, parseSnaps } from '../src/app/snapKinds.js';

test('kinds group the snap names', () => {
    assert.equal(kindOf('3/4'), 'quarter');
    assert.equal(kindOf('ON CURVE'), 'closest');
    assert.equal(kindOf('XZ'), 'planes');
});

test('object snapping off offers nothing; switched-off and skipped kinds are left out', () => {
    const s = defaultSnaps();
    assert.ok(allowed('END', s));
    assert.ok(!allowed('END', { ...s, on: false }));
    assert.ok(!allowed('1/4', { on: true, off: ['quarter'] }));
    assert.ok(!allowed('MIDDLE', s, ['middle']));
    assert.ok(allowed('CENTER', s, ['middle']));
});

test('stored settings keep only known kinds', () => {
    assert.deepEqual(parseSnaps('{"on":false,"off":["end","bogus"]}'), { on: false, off: ['end'], objOff: [] });
    assert.deepEqual(parseSnaps('nonsense'), defaultSnaps());
    assert.deepEqual(parseSnaps(null), defaultSnaps());
});

test("Plasticity's Object snaps: a snap on a switched-off object is not offered", async () => {
  const { allowed, parseSnaps, OBJECT_SNAPS } = await import('../src/app/snapKinds.js');
  assert.deepEqual(OBJECT_SNAPS.map(o => o.id), ['point', 'edge', 'curve', 'face', 'axis']);
  const s = parseSnaps(JSON.stringify({ on: true, off: [], objOff: ['edge', 'bogus'] }));
  assert.deepEqual(s.objOff, ['edge']);
  assert.equal(allowed('END', s, [], 'edge'), false);
  assert.equal(allowed('END', s, [], 'curve'), true);
  assert.equal(allowed('END', s), true);
  assert.deepEqual(parseSnaps('{"on":true,"off":[]}').objOff, []);
});
