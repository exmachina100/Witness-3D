// The LABS tools as an MCP server (Model Context Protocol, stdio): Claude Desktop, Claude Code or
// any MCP client drives the same tools the in-app agent uses (labsTools.js), on a model opened from
// a STEP file and run headless on the browser build's kernel (LocalBackend in node). The client
// brings its own model access, so no API key is needed here.
//
// `createMcp()` answers one JSON-RPC message at a time (tested in test/labsMcp.test.js); server.mjs
// wires it to stdin and stdout.

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LABS_TOOLS, labsSchemas, labsSession, runLabsTool } from '../src/labsTools.js';
import { exportSTEP, loadKernel } from '../src/Kernel.js';
import { compound } from '../src/untrim.js';

export const SERVER_INFO = { name: 'witness-3d-labs', version: '0.1.0' };
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

/** File tools only the server has: the in-app agent works on the open model instead. */
export const FILE_TOOLS = [
    {
        name: 'open_step',
        description: 'Open a STEP file (absolute path) as the model, replacing what is open. Separate sheets and solids in the file become separate bodies. Returns the bodies as describe_model does.',
        input_schema: { type: 'object', properties: { path: { type: 'string' }, separate: { type: 'boolean', description: 'split the file into its separate pieces (default true)' } }, required: ['path'] },
        async run(s, a) {
            const { LocalBackend } = await import('../src/app/LocalBackend.js');
            const backend = new LocalBackend({ seed: 'empty' });
            let { id, scene } = await backend.importStepData(new Uint8Array(await readFile(resolve(a.path))));
            if (a.separate !== false) {
                try { ({ scene } = await backend.commitUnjoin({ body: id, faces: false })); } catch { /* one piece */ }
            }
            // A fresh model: nothing before this can be undone, the session starts over.
            backend.undoStack = [];
            backend.redoStack = [];
            s.backend = backend;
            s.steps = 0;
            s.log = [];
            s.scene = [];
            s.show(scene.length ? scene : backend.bodies());
            return LABS_TOOLS.find(t => t.name === 'describe_model').run(s, {});
        },
    },
    {
        name: 'save_step',
        description: 'Save the model (every body, or just `body`) to a STEP file at an absolute path.',
        input_schema: { type: 'object', properties: { path: { type: 'string' }, body: { type: 'integer' } }, required: ['path'] },
        async run(s, a) {
            const shapes = a.body !== undefined ? [s.backend.shapes.get(a.body)] : [...s.backend.shapes.values()];
            if (!shapes.length || shapes.some(x => !x)) throw new Error(a.body !== undefined ? `there is no body ${a.body}` : 'the model is empty; open a STEP file first');
            const path = resolve(a.path);
            await writeFile(path, exportSTEP(shapes.length === 1 ? shapes[0] : compound(shapes)));
            return { saved: path, bodies: shapes.length };
        },
    },
];

/**
 * A server: `handle(message)` returns the reply (or null for a notification). `backend` defaults to
 * an empty LocalBackend once the kernel has loaded.
 */
export function createMcp({ backend = null } = {}) {
    let session = null;
    const ready = (async () => {
        await loadKernel();
        if (!backend) { const { LocalBackend } = await import('../src/app/LocalBackend.js'); backend = new LocalBackend({ seed: 'empty' }); }
        session = labsSession(backend, { scene: backend.bodies?.() ?? [] });
    })();
    const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
    const fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

    async function handle(msg) {
        const { id, method, params = {} } = msg ?? {};
        const note = id === undefined || id === null;
        if (method === 'initialize') {
            const asked = params.protocolVersion;
            return ok(id, {
                protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
                capabilities: { tools: { listChanged: false } },
                serverInfo: SERVER_INFO,
                instructions: 'Witness 3D surfacing tools. open_step a model, describe_model to find edge and face numbers, seam_check before and after any change, save_step to write the result. Targets: gap 0.001 mm, angle 0.05 deg, G2 0.5 %, fit 0.05 mm.',
            });
        }
        if (note) return null;   // notifications/initialized and the like
        if (method === 'ping') return ok(id, {});
        if (method === 'tools/list') {
            return ok(id, { tools: labsSchemas(FILE_TOOLS).map(t => ({ name: t.name, description: t.description, inputSchema: t.input_schema })) });
        }
        if (method === 'tools/call') {
            await ready;
            const r = await runLabsTool(session, params.name, params.arguments ?? {}, FILE_TOOLS);
            if (!r.ok && /^no tool called/.test(r.error)) return fail(id, -32602, r.error);
            return ok(id, { content: [{ type: 'text', text: r.ok ? JSON.stringify(r.result) : r.error }], isError: !r.ok });
        }
        return fail(id, -32601, `no method ${method}`);
    }
    return { handle, ready, session: () => session };
}
