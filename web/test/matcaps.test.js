import test from 'node:test';
import assert from 'node:assert/strict';
import { MATCAPS, matcapPixel, matcapById } from '../src/app/matcaps.js';

test('ALL MATCAPS: eight looks plus three Alias-style ones, each id unique', () => {
  assert.equal(MATCAPS.length, 11);
  assert.equal(new Set(MATCAPS.map(m => m.id)).size, 11);
  assert.equal(MATCAPS.filter(m => m.alias).length, 3);
  assert.ok(matcapById('alias-chrome'));
});

test('a matcap is lit from the upper left and empty off its sphere', () => {
  for (const m of MATCAPS) {
    assert.equal(matcapPixel(m, 0.9, 0.9), null);
    const sum = p => p[0] + p[1] + p[2];
    assert.ok(sum(matcapPixel(m, -0.4, 0.4)) > sum(matcapPixel(m, 0.4, -0.6)), m.id);
    for (const v of matcapPixel(m, 0, 0)) assert.ok(v >= 0 && v <= 255);
  }
});

test('the chrome reflects a bright sky above its horizon and a dark floor below', () => {
  const m = matcapById('alias-chrome'), sum = p => p[0] + p[1] + p[2];
  assert.ok(sum(matcapPixel(m, 0.6, 0.3)) > 3 * sum(matcapPixel(m, 0.6, -0.3)));
});
