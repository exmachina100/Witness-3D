// AI text commands: a sentence in, one registered tool call out, which the app starts as an
// ordinary command with its live preview for the user to adjust and finish (or abort). The model
// can only name tools from the registry (tools.js); its arguments are checked there like typed
// values; nothing it sends is run as code. Requests go to the Claude API through the official SDK,
// with the user's own key, which never goes into the repo or a document.

import { schema } from './tools.js';

export const MODEL = 'claude-opus-5-5';

const SYSTEM = `You turn a CAD user's request into one call to a Witness 3D modelling tool.

Witness 3D is a solid modeller with Plasticity's tools and keys. Units are millimetres. Coordinates are the user's: x right, y back, z up. Each request comes with the current model inside <model> tags: the bodies with their faces and edges (named by ref), the drawn curves, what is selected, and the construction plane.

Call exactly one tool. It does not change the model yet: it starts that command with a live preview, which the user adjusts or confirms, so pick the most likely reading rather than asking. Name edges and faces by their refs from <model>. "The outer edges" of a body are all its edges; "the top edges" are those whose points all have the body's highest z; "vertical edges" run along z. When the selection already holds what the request refers to, act on it.

If no tool can do what was asked, or the request is not about the model, do not call a tool; answer in one short sentence instead.`;

const r = v => Math.round(v * 100) / 100;

/**
 * The model as the AI sees it, in user coordinates (z up). `toUser` turns viewport points into
 * user ones. Large bodies list counts instead of every edge, so a request stays small.
 */
export function describe({ bodies, curves, hidden = [], context, toUser }) {
    const P = (a, i) => toUser([a[i], a[i + 1], a[i + 2]]).map(r);
    return {
        bodies: bodies.map(b => {
            const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
            for (let i = 0; i < b.positions.length; i += 3) P(b.positions, i).forEach((c, k) => { lo[k] = Math.min(lo[k], c); hi[k] = Math.max(hi[k], c); });
            const out = { id: b.id, hidden: hidden.includes(b.id), volume: r(b.volume), box: { min: lo, max: hi } };
            out.faces = b.facePlanes.map((p, n) => p
                ? { ref: b.faceRefs?.[n], normal: toUser(p.normal).map(r), point: toUser(p.origin).map(r) }
                : { ref: b.faceRefs?.[n], curved: true });
            if (b.edges.length <= 400) out.edges = b.edges.map((e, n) => {
                let length = 0;
                for (let i = 3; i < e.length; i += 3) length += Math.hypot(e[i] - e[i - 3], e[i + 1] - e[i - 2], e[i + 2] - e[i - 1]);
                const edge = { ref: b.edgeRefs?.[n], from: P(e, 0), to: P(e, e.length - 3), length: r(length) };
                if (e.length > 6) { edge.curved = true; edge.middle = P(e, Math.floor(e.length / 6) * 3); }
                return edge;
            });
            else out.edgeCount = b.edges.length;
            return out;
        }),
        curves: curves.map(c => ({ id: c.id, kind: c.kind, closed: c.kind === 'circle' || !!c.closed })),
        selection: context,
    };
}

/** The Messages API request for `prompt` against the model `described`. */
export function request(prompt, described) {
    return {
        model: MODEL,
        max_tokens: 16000,
        // A safety decline is re-run on a fallback model instead of coming back empty.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low' },
        system: SYSTEM,
        tools: schema(),
        tool_choice: { type: 'auto', disable_parallel_tool_use: true },
        messages: [{ role: 'user', content: `<model>${JSON.stringify(described)}</model>\n\n${prompt}` }],
    };
}

/** The tool call in a reply as { tool, args, text }, or { text } when there is none. */
export function reply(message) {
    if (message.stop_reason === 'refusal') return { text: 'The model declined that request.' };
    const text = message.content.filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
    const call = message.content.find(b => b.type === 'tool_use');
    if (call) return { tool: call.name, args: call.input ?? {}, text };
    if (message.stop_reason === 'max_tokens') return { text: 'The reply was cut off; try a shorter request.' };
    return { text: text || 'No command came back.' };
}

/** Send requests with the official SDK and the user's key. Loaded only when first used. */
export async function claude(apiKey) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    // The key is the user's own and stays on their machine; the app is the only client.
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    return body => client.beta.messages.create(body);
}
