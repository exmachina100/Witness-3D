// The LABS MCP server: JSON-RPC in, the same tools as the in-app agent out, on a STEP file opened
// from disk; and the stdio server answering a client line by line.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { exportSTEP, loadKernel } from '../src/Kernel.js';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { clampedKnots } from '../src/g3Blend.js';
import { compound } from '../src/untrim.js';
import { createMcp } from '../mcp/labsMcp.js';

const sheet = (x0, x1, f) => {
    const poles = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const x = x0 + (x1 - x0) * i / 3, y = 100 * j / 3; poles.push(x, y, f(x, y)); }
    const k = clampedKnots(4, 3);
    return [3, 3, 4, 4, 8, 8, ...k, ...k, ...poles];
};
let dir, file;
before(async () => {
    await loadKernel();
    const be = new LocalBackend({ seed: 'empty' });
    await be.commitSplineSheet({ data: sheet(-100, -30, (x, y) => 0.002 * x * x + 0.0005 * y * y) });
    await be.commitSplineSheet({ data: sheet(30, 100, (x, y) => 10 - 0.001 * x * x + 0.03 * x + 0.0008 * y * y) });
    dir = await mkdtemp(join(tmpdir(), 'w3d-mcp-'));
    file = join(dir, 'two-sheets.step');
    await writeFile(file, exportSTEP(compound([...be.shapes.values()])));
});

const call = async (mcp, id, name, args = {}) => {
    const r = await mcp.handle({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
    return { ...r.result, data: r.result?.isError ? r.result.content[0].text : JSON.parse(r.result.content[0].text) };
};
const middle = e => e.middle;

test('initialize, list the tools, open a STEP, blend, measure, undo and save', async () => {
    const mcp = createMcp();
    const init = await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.ok(init.result.capabilities.tools);
    assert.equal(await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
    const list = await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = list.result.tools.map(t => t.name);
    for (const n of ['describe_model', 'seam_check', 'seam_solve', 'g3_blend', 'class_a_fit', 'patch_layout', 'undo_last', 'open_step', 'save_step']) assert.ok(names.includes(n), n);
    for (const t of list.result.tools) assert.equal(t.inputSchema.type, 'object');

    const opened = await call(mcp, 3, 'open_step', { path: file });
    assert.equal(opened.isError, false, opened.data);
    assert.equal(opened.data.bodies.length, 2, 'the two sheets come in as two bodies');
    const [A, B] = opened.data.bodies;
    // The facing edges: A's edge at x = -30, B's at x = 30.
    const ea = A.edges.reduce((b, e) => (Math.abs(middle(e)[0] + 30) < Math.abs(middle(b)[0] + 30) ? e : b)).edge;
    const eb = B.edges.reduce((b, e) => (Math.abs(middle(e)[0] - 30) < Math.abs(middle(b)[0] - 30) ? e : b)).edge;

    const blend = await call(mcp, 4, 'g3_blend', { a_body: A.id, a_edge: ea, b_body: B.id, b_edge: eb });
    assert.equal(blend.isError, false, blend.data);
    for (const s of blend.data.seams) {
        assert.ok(s.gap_mm <= 0.001, `gap ${s.gap_mm}`);
        assert.ok(s.angle_deg <= 0.05, `angle ${s.angle_deg}`);
        assert.ok(s.g2_pct <= 0.5, `G2 ${s.g2_pct}`);
    }
    const out = join(dir, 'blended.step');
    const saved = await call(mcp, 5, 'save_step', { path: out });
    assert.equal(saved.data.bodies, 3);
    assert.match(new TextDecoder().decode(await readFile(out)).slice(0, 40), /ISO-10303-21/);

    assert.equal((await call(mcp, 6, 'undo_last')).data.undone, 'g3_blend G3');
    assert.equal((await call(mcp, 7, 'describe_model')).data.bodies.length, 2);
    assert.equal((await call(mcp, 8, 'undo_last')).data.undone, false, 'opening the file is not the session\'s to undo');
});

test('bad calls come back as errors the client can read', async () => {
    const mcp = createMcp();
    assert.equal((await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'no_such' } })).error.code, -32602);
    assert.equal((await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'resources/list' })).error.code, -32601);
    const r = await call(mcp, 3, 'seam_check', { body: 99, edge: 0 });
    assert.equal(r.isError, true);
    const s = await call(mcp, 4, 'save_step', { path: join(dir, 'x.step') });
    assert.equal(s.isError, true);
    assert.match(s.data, /empty/);
});

test('the stdio server answers line by line and keeps stdout to JSON', async () => {
    const server = spawn(process.execPath, [fileURLToPath(new URL('../mcp/server.mjs', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = [];
    let buf = '';
    const got = new Promise((done, failed) => {
        server.stdout.on('data', d => {
            buf += d;
            for (let i; (i = buf.indexOf('\n')) >= 0;) { lines.push(buf.slice(0, i)); buf = buf.slice(i + 1); }
            if (lines.length >= 3) done();
        });
        server.on('exit', c => failed(new Error(`server exited ${c}`)));
    });
    for (const m of [
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'open_step', arguments: { path: file } } },
    ]) server.stdin.write(JSON.stringify(m) + '\n');
    await got;
    server.kill();
    const replies = lines.map(l => JSON.parse(l));
    assert.deepEqual(replies.map(r => r.id), [1, 2, 3]);
    assert.equal(replies[0].result.protocolVersion, '2024-11-05');
    assert.equal(JSON.parse(replies[2].result.content[0].text).bodies.length, 2);
});
