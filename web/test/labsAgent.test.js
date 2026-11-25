// The LABS agent loop and tools, driven by a scripted stand-in for the model (no key needed).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, test } from 'node:test';
import { loadKernel } from '../src/Kernel.js';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { clampedKnots } from '../src/g3Blend.js';
import { labsSchemas, labsSession, runLabsTool } from '../src/labsTools.js';
import { runAgent } from '../src/labsAgent.js';

before(async () => { await loadKernel() });

/** Two separate curved sheets with a 60 mm gap between them. */
async function twoSheets() {
    const be = new LocalBackend();
    const sheet = (x0, x1, f) => {
        const poles = [];
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const x = x0 + (x1 - x0) * i / 3, y = 100 * j / 3; poles.push(x, y, f(x, y)); }
        const k = clampedKnots(4, 3);
        return [3, 3, 4, 4, 8, 8, ...k, ...k, ...poles];
    };
    const a = await be.commitSplineSheet({ data: sheet(-100, -30, (x, y) => 0.002 * x * x + 0.0005 * y * y) });
    const b = await be.commitSplineSheet({ data: sheet(30, 100, (x, y) => 10 - 0.001 * x * x + 0.03 * x + 0.0008 * y * y) });
    return { be, scene: b.scene, A: a.ids[0], B: b.ids[0] };
}
const inner = (scene, id, x) => scene.find(b => b.id === id).edges.findIndex(e => { const k = Math.floor(e.length / 6) * 3; return Math.abs(e[k] - x) < 1e-6 && Math.abs(e[k + 1] - 50) < 1; });

test('every tool has a name, a description and an object schema', () => {
    for (const t of labsSchemas()) {
        assert.match(t.name, /^[a-z0-9_]+$/);
        assert.ok(t.description.length > 20);
        assert.equal(t.input_schema.type, 'object');
    }
});

test('tools report numbers, and a session rolls back only its own steps', async () => {
    const { be, scene, A, B } = await twoSheets();
    const s = labsSession(be, { scene });
    const d = await runLabsTool(s, 'describe_model');
    assert.ok(d.ok && d.result.bodies.length >= 2);
    const ea = inner(scene, A, -30), eb = inner(scene, B, 30);
    const blend = await runLabsTool(s, 'g3_blend', { a_body: A, a_edge: ea, b_body: B, b_edge: eb });
    assert.ok(blend.ok, blend.error);
    for (const seam of blend.result.seams) assert.equal(seam.level, 'G3');
    assert.equal(s.steps, 1);
    const count = be.bodies().length;
    await s.rollback();
    assert.equal(be.bodies().length, count - 1);
    assert.equal(s.steps, 0);
    const bad = await runLabsTool(s, 'seam_check', { body: 99, edge: 0 });
    assert.equal(bad.ok, false);
});

test('the agent loop runs the tools the model asks for and stops with its report', async () => {
    const { be, scene, A, B } = await twoSheets();
    const s = labsSession(be, { scene });
    const ea = inner(scene, A, -30), eb = inner(scene, B, 30);
    // A scripted model: describe, blend, then report.
    const script = [
        { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Looking at the model.' }, { type: 'tool_use', id: 't1', name: 'describe_model', input: {} }] },
        { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'g3_blend', input: { a_body: A, a_edge: ea, b_body: B, b_edge: eb } }] },
        { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Blended in G3; both seams meet every target.' }] },
    ];
    const sent = [], events = [];
    const send = async body => { sent.push(structuredClone(body)); return script.shift(); };
    const r = await runAgent({ send, session: s, prompt: 'blend these two sheets in G3', onEvent: e => events.push(e) });
    assert.equal(r.text, 'Blended in G3; both seams meet every target.');
    assert.equal(r.steps, 1);
    assert.equal(sent.length, 3);
    // The second request carries the describe_model result back.
    const back = sent[1].messages.at(-1).content[0];
    assert.equal(back.type, 'tool_result');
    assert.ok(JSON.parse(back.content).bodies.length >= 2);
    const blendResult = JSON.parse(sent[2].messages.at(-1).content[0].content);
    assert.deepEqual(blendResult.seams.map(x => x.level), ['G3', 'G3']);
    assert.ok(sent[0].tools.some(t => t.name === 'seam_solve'));
    assert.deepEqual(events.map(e => e.kind), ['text', 'tool', 'result', 'tool', 'result', 'text', 'done']);
});

test('a failing tool comes back to the model as an error, not a crash', async () => {
    const { be, scene } = await twoSheets();
    const s = labsSession(be, { scene });
    const script = [
        { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'seam_check', input: { body: 42, edge: 0 } }] },
        { stop_reason: 'end_turn', content: [{ type: 'text', text: 'That body does not exist.' }] },
    ];
    const sent = [];
    const r = await runAgent({ send: async body => { sent.push(structuredClone(body)); return script.shift(); }, session: s, prompt: 'check body 42' });
    assert.equal(sent[1].messages.at(-1).content[0].is_error, true);
    assert.equal(r.text, 'That body does not exist.');
});
