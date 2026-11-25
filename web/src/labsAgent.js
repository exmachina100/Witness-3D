// The LABS agent: Claude works through a surfacing request step by step with the LABS tools
// (labsTools.js): it looks at the model, measures, changes, measures again and stops with a short
// report. A manual tool-use loop over the Messages API; `send` posts one request (ai.js claude()
// with the user's own key in the app, a scripted stand-in in tests). Every change it makes is an
// undo step of the session, so the user keeps all of them or rolls all of them back.

import { MODEL } from './app/ai.js';
import { labsSchemas, runLabsTool } from './labsTools.js';

export const AGENT_SYSTEM = `You are the surfacing assistant in Witness 3D, a CAD modeller. You work on the user's model with the LABS tools: measure seams, solve seams to G0-G3, blend between edges, fit Class-A patches, lay faces out in patches.

Rules:
- Geometry comes only from the tools. Never invent coordinates or claim a result you did not measure.
- Start with describe_model, then measure (seam_check) before you change anything, and measure again after.
- Class-A targets: gap <= 0.001 mm, angle <= 0.05 deg, G2 <= 0.5 %, G3 <= 5 %, highlight kink <= 1 deg, fit <= 0.05 mm. Report the numbers against them.
- If a step makes things worse, call undo_last and try another option. Make at most a few attempts.
- Everything you change is a preview: the user keeps it or discards it afterwards. Don't ask for permission mid-way; pick the most likely reading.
- Finish with a short plain report: what you did, the measured numbers before and after, and anything that still misses a target.`;

/** A view capture tool for the app (the agent sees the viewport, e.g. in zebra). */
export const captureTool = capture => ({
    name: 'capture_view',
    description: 'Take a picture of the viewport as the user sees it (use the zebra or curvature shader to judge surface quality).',
    input_schema: { type: 'object', properties: {} },
    image: true,
    async run() { return capture(); },
});

/**
 * Run the agent on `prompt` in `session`. `send(body)` returns a Messages API reply. `capture()`
 * (optional) returns a PNG as base64. `onEvent({ kind: 'text'|'tool'|'result'|'error'|'done', ... })`
 * reports progress. Returns { text, steps, turns }.
 */
export async function runAgent({ send, session, prompt, capture = null, maxTurns = 16, onEvent = () => {}, model = MODEL }) {
    const extra = capture ? [captureTool(capture)] : [];
    const messages = [{ role: 'user', content: prompt }];
    let text = '';
    for (let turn = 1; turn <= maxTurns; turn++) {
        const reply = await send({
            model,
            max_tokens: 16000,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            output_config: { effort: 'medium' },
            system: AGENT_SYSTEM,
            tools: labsSchemas(extra),
            messages,
        });
        messages.push({ role: 'assistant', content: reply.content });
        for (const b of reply.content) if (b.type === 'text' && b.text.trim()) { text = b.text.trim(); onEvent({ kind: 'text', text }); }
        if (reply.stop_reason === 'refusal') { onEvent({ kind: 'error', error: 'The model declined that request.' }); return { text: 'The model declined that request.', steps: session.steps, turns: turn }; }
        if (reply.stop_reason !== 'tool_use') {
            if (reply.stop_reason === 'max_tokens') text ||= 'The reply was cut off.';
            onEvent({ kind: 'done', text });
            return { text, steps: session.steps, turns: turn };
        }
        const results = [];
        for (const call of reply.content.filter(b => b.type === 'tool_use')) {
            onEvent({ kind: 'tool', name: call.name, args: call.input });
            const tool = extra.find(t => t.name === call.name);
            if (tool?.image) {
                try {
                    const png = await tool.run();
                    results.push({ type: 'tool_result', tool_use_id: call.id, content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } }] });
                    onEvent({ kind: 'result', name: call.name, result: 'image' });
                } catch (e) {
                    results.push({ type: 'tool_result', tool_use_id: call.id, is_error: true, content: String(e?.message ?? e) });
                }
                continue;
            }
            const r = await runLabsTool(session, call.name, call.input, extra);
            onEvent({ kind: 'result', name: call.name, result: r.ok ? r.result : { error: r.error } });
            results.push(r.ok
                ? { type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(r.result) }
                : { type: 'tool_result', tool_use_id: call.id, is_error: true, content: r.error });
        }
        messages.push({ role: 'user', content: results });
    }
    text = `${text ? `${text}\n` : ''}Stopped after ${maxTurns} turns.`;
    onEvent({ kind: 'done', text });
    return { text, steps: session.steps, turns: maxTurns };
}
