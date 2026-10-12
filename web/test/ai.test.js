import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { loadKernel } from '../src/Kernel.js';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { MODEL, describe, reply, request } from '../src/app/ai.js';
import { TOOLS } from '../src/app/tools.js';

before(async () => { await loadKernel() });
const toUser = ([x, y, z]) => [x, -z, y];

test('the model sees the enclosure in user coordinates, edges by ref', () => {
    const be = new LocalBackend();
    const d = describe({ bodies: be.scene(), curves: [], context: { edges: null }, toUser });
    const b = d.bodies[0];
    assert.deepEqual(b.box, { min: [-40, -25, 0], max: [40, 25, 30] });
    assert.equal(b.edges.length, 12);
    assert.deepEqual(new Set(b.edges.map(e => e.ref)).size, 12);
    // Four edges lie at the top, z = 30.
    assert.equal(b.edges.filter(e => e.from[2] === 30 && e.to[2] === 30).length, 4);
    assert.ok(b.faces.every(f => f.normal && f.ref !== undefined));
});

test('a request offers only the registered tools and leaves the choice to the model', () => {
    const req = request('round the top edges by 4 mm', { bodies: [] });
    assert.equal(req.model, MODEL);
    assert.deepEqual(req.tools.map(t => t.name), TOOLS.map(t => t.id));
    assert.equal(req.tool_choice.type, 'auto');
    assert.equal(req.fallbacks, 'default');
    assert.match(req.messages[0].content, /^<model>\{.*\}<\/model>\n\nround the top edges by 4 mm$/s);
});

test('a reply becomes one tool call, a sentence, or a decline', () => {
    const call = reply({ stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Rounding.' }, { type: 'tool_use', id: 't', name: 'fillet', input: { edges: [3], distance: 4 } }] });
    assert.deepEqual(call, { tool: 'fillet', args: { edges: [3], distance: 4 }, text: 'Rounding.' });
    assert.deepEqual(reply({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'There is no hole tool yet.' }] }), { text: 'There is no hole tool yet.' });
    assert.match(reply({ stop_reason: 'refusal', content: [] }).text, /declined/);
});
