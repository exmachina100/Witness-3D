import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TOOLS, check, schema, tool, toolForKey, withDefaults } from '../src/app/tools.js';

test('every tool has a unique id and key and complete parameters', () => {
    assert.equal(new Set(TOOLS.map(t => t.id)).size, TOOLS.length);
    assert.equal(new Set(TOOLS.map(t => t.key)).size, TOOLS.length);
    for (const t of TOOLS) {
        assert.ok(['face', 'edge', 'solid'].includes(t.selects), t.id);
        for (const [name, p] of Object.entries(t.params)) {
            assert.ok(p.describe, `${t.id}.${name} needs a description`);
            assert.deepEqual(check(t.id, { [name]: p.default }), [], `${t.id}.${name} default must pass its own check`);
        }
    }
    assert.equal(toolForKey('f'), tool('fillet'));
});

test('arguments are checked the same way whoever sends them', () => {
    assert.deepEqual(check('fillet', { size: 4 }), []);
    assert.match(check('fillet', { size: 0 })[0], /greater than 0/);
    assert.match(check('fillet', { size: '4' })[0], /must be a number/);
    assert.match(check('fillet', { kind: 'blob' })[0], /one of fillet, chamfer/);
    assert.match(check('fillet', { radius: 4 })[0], /no setting called "radius"/);
    assert.match(check('move', { offset: [1, 2] })[0], /three numbers/);
    assert.match(check('explode', {})[0], /no tool called/);
    assert.deepEqual(withDefaults('fillet', { size: 4 }), { size: 4, kind: 'fillet' });
});

test('the schema lists only registered tools, with the selection as a required ref argument', () => {
    const s = schema();
    assert.deepEqual(s.map(t => t.name), TOOLS.map(t => t.id));
    const fillet = s.find(t => t.name === 'fillet');
    assert.deepEqual(fillet.input_schema.required, ['edges']);
    assert.equal(fillet.input_schema.properties.size.exclusiveMinimum, 0);
    assert.equal(fillet.input_schema.additionalProperties, false);
    assert.deepEqual(s.find(t => t.name === 'pushpull').input_schema.required, []);
    JSON.stringify(s); // plain data
});
