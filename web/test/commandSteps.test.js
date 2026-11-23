import test from 'node:test';
import assert from 'node:assert/strict';
import { stepCount } from '../src/app/App.js';

test("a selection step says what it holds Plasticity's way, and nothing while empty", () => {
    assert.equal(stepCount('B-01 B-02', 'body', 'bodies'), '2 bodies');
    assert.equal(stepCount('B-01', 'body', 'bodies'), '1 body');
    assert.equal(stepCount('3', 'cutter', 'cutters'), '3 cutters');
    for (const empty of ['—', '0', 'NEW BODY', '']) assert.equal(stepCount(empty, 'body', 'bodies'), '');
    assert.equal(stepCount('4 REGIONS'), '4 REGIONS');
});
