// Boolean's Target and Tool Material in the browser build (material.js).
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { box, count, loadKernel, planeSheet, volume } from '../src/Kernel.js';
import { LocalBackend } from '../src/app/LocalBackend.js';

before(async () => { await loadKernel() });

const setup = () => {
    const be = new LocalBackend();
    const block = be.nextId++, sheet = be.nextId++, small = be.nextId++;
    be.put(block, box({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 }));
    be.put(sheet, planeSheet([5, 5, 3], [0, 0, 1], 20));
    be.put(small, box({ x: 5, y: 5, z: 5 }, { x: 15, y: 15, z: 15 }));
    return { be, block, sheet, small };
};
const v = s => Math.round(volume(s) * 1000) / 1000;

test('a sheet tool Inside cuts away what lies behind it, Outside what lies in front', () => {
    const { be, block, sheet } = setup();
    assert.equal(v(be.booleanResult({ target: block, tools: [sheet], op: 'difference', toolMaterial: 'inside' }).shape), 700);
    assert.equal(v(be.booleanResult({ target: block, tools: [sheet], op: 'difference', toolMaterial: 'outside' }).shape), 300);
    assert.equal(v(be.booleanResult({ target: block, tools: [sheet], op: 'intersect', toolMaterial: 'inside' }).shape), 300);
});

test('an Empty target keeps only its skin', () => {
    const { be, block, small } = setup();
    const r = be.booleanResult({ target: block, tools: [small], op: 'difference', targetMaterial: 'empty' }).shape;
    assert.equal(count(r, 'TopAbs_SOLID'), 0);
    // Three whole sides and three sides with a 5 x 5 corner gone.
    assert.ok(count(r, 'TopAbs_FACE') >= 6);
});

test('a solid tool Outside keeps only what is inside it; endless results are refused', () => {
    const { be, block, small } = setup();
    assert.equal(v(be.booleanResult({ target: block, tools: [small], op: 'difference', toolMaterial: 'outside' }).shape), 125);
    assert.throws(() => be.booleanResult({ target: block, tools: [small], op: 'union', toolMaterial: 'outside' }), /without end/);
});
