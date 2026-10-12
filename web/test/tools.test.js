import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TOOLS, check, schema, tool, toolForKey, withDefaults } from '../src/app/tools.js';

test('every tool has a unique id and key and complete parameters', () => {
    assert.equal(new Set(TOOLS.map(t => t.id)).size, TOOLS.length);
    assert.equal(new Set(TOOLS.map(t => t.key)).size, TOOLS.length);
    for (const t of TOOLS) {
        assert.ok(['face', 'edge', 'solid', 'region', 'solids'].includes(t.selects), t.id);
        for (const [name, p] of Object.entries(t.params)) {
            assert.ok(p.describe, `${t.id}.${name} needs a description`);
            assert.deepEqual(check(t.id, { [name]: p.default }), [], `${t.id}.${name} default must pass its own check`);
        }
    }
    assert.equal(toolForKey('b'), tool('fillet'));
});

test('arguments are checked the same way whoever sends them', () => {
    assert.deepEqual(check('fillet', { distance: 4 }), []);
    assert.deepEqual(check('fillet', { distance: -2, angle: 30 }), []);
    assert.match(check('fillet', { distance: 0 })[0], /must not be zero/);
    assert.match(check('fillet', { distance: '4' })[0], /must be a number/);
    assert.match(check('fillet', { angle: 90 })[0], /less than 90/);
    assert.match(check('rotate', { axis: 'w' })[0], /one of x, y, z/);
    assert.match(check('fillet', { radius: 4 })[0], /no setting called "radius"/);
    assert.match(check('move', { offset: [1, 2] })[0], /three numbers/);
    assert.match(check('explode', {})[0], /no tool called/);
    assert.deepEqual(withDefaults('fillet', { distance: 4 }), { distance: 4, angle: 45 });
});

test('the schema lists only registered tools, with the selection as a required ref argument', () => {
    const s = schema();
    assert.deepEqual(s.map(t => t.name), TOOLS.map(t => t.id));
    const fillet = s.find(t => t.name === 'fillet');
    assert.deepEqual(fillet.input_schema.required, ['edges']);
    assert.equal(fillet.input_schema.properties.angle.exclusiveMaximum, 90);
    assert.equal(fillet.input_schema.additionalProperties, false);
    assert.deepEqual(s.find(t => t.name === 'pushpull').input_schema.required, []);
    assert.deepEqual(s.find(t => t.name === 'boolean').input_schema.required, ['target', 'tools']);
    assert.ok(s.find(t => t.name === 'extrude').input_schema.properties.face);
    JSON.stringify(s); // plain data
});
