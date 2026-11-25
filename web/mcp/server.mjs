#!/usr/bin/env node
// Witness 3D LABS as an MCP server over stdio: one JSON-RPC message per line in, one per line out.
// Add it to Claude Desktop or Claude Code as a command: node <repo>/web/mcp/server.mjs
// (see docs/labs-mcp.md). Anything the kernel prints goes to stderr so stdout stays JSON.

import { createInterface } from 'node:readline';

const out = process.stdout.write.bind(process.stdout);
console.log = console.info = console.warn = console.debug = (...a) => process.stderr.write(a.join(' ') + '\n');
process.stdout.write = (chunk, ...rest) => process.stderr.write(chunk, ...rest);

const { createMcp } = await import('./labsMcp.js');
const mcp = createMcp();
let queue = Promise.resolve();
createInterface({ input: process.stdin }).on('line', line => {
    if (!line.trim()) return;
    queue = queue.then(async () => {
        let msg;
        try { msg = JSON.parse(line); } catch { return out(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'not JSON' } }) + '\n'); }
        const reply = await mcp.handle(msg).catch(e => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32603, message: String(e?.message ?? e) } }));
        if (reply) out(JSON.stringify(reply) + '\n');
    });
});
