// The tool registry: every command the app can run, described once. The toolbar, the keyboard,
// the inspector and (from stage C) the AI command box all read it, so a tool exists in exactly one
// place and the AI can only ask for what is listed here, with arguments checked the same way a
// typed value is.
//
// Every tool follows one lifecycle (see App.js): select what it acts on, choose the tool, adjust
// its parameters against a live preview, then confirm (Enter) or cancel (Escape). Nothing changes
// the document until confirm, and a confirm is one undo step.
//
// `selects` is what the tool acts on: 'face' (a point on a flat face, or the work plane), 'edge'
// (one or more edges of one body) or 'solid' (one body). Lengths are millimetres, angles degrees,
// and coordinates are the user's: x right, y back, z up (the viewport's own y is up).

export const TOOLS = [
    {
        id: 'pushpull', label: 'PUSH·PULL', key: 'p', group: 'shape', selects: 'face',
        summary: 'Sketch a square or circle on a flat face or the work plane, then pull it out into a boss or push it in to cut a pocket.',
        params: {
            distance: { type: 'number', unit: 'mm', default: 0, describe: 'how far to pull; positive joins, negative cuts' },
            profile: { type: 'enum', values: ['rect', 'circle'], default: 'rect', describe: 'the sketch shape' },
            size: { type: 'number', unit: 'mm', min: 0.5, default: 10, describe: 'side of the square, or diameter of the circle' },
            newBody: { type: 'boolean', default: false, describe: 'make a separate body instead of joining or cutting' },
        },
    },
    {
        id: 'fillet', label: 'FILLET', key: 'f', group: 'shape', selects: 'edge',
        summary: 'Round or bevel the selected edges of one body.',
        params: {
            size: { type: 'number', unit: 'mm', above: 0, default: 2, describe: 'radius of the round, or distance of the chamfer' },
            kind: { type: 'enum', values: ['fillet', 'chamfer'], default: 'fillet', describe: 'round or bevel' },
        },
    },
    {
        id: 'move', label: 'MOVE', key: 'g', group: 'organise', selects: 'solid',
        summary: 'Move the selected body.',
        params: {
            offset: { type: 'vector', unit: 'mm', default: [0, 0, 0], describe: 'how far to move along x, y and z (z is up)' },
        },
    },
    {
        id: 'rotate', label: 'ROTATE', key: 'r', group: 'organise', selects: 'solid',
        summary: 'Turn the selected body about an axis through its centre.',
        params: {
            axis: { type: 'enum', values: ['x', 'y', 'z'], default: 'z', describe: 'the axis to turn about; z is up' },
            angle: { type: 'number', unit: 'deg', default: 0, describe: 'how far to turn, counter-clockwise looking down the axis' },
        },
    },
];

export const tool = id => TOOLS.find(t => t.id === id);
export const toolForKey = key => TOOLS.find(t => t.key === key);

/** The tool's parameters with defaults filled in for anything `args` leaves out. */
export function withDefaults(id, args = {}) {
    const t = tool(id);
    if (!t) throw new Error(`no tool called ${id}`);
    const out = {};
    for (const [name, p] of Object.entries(t.params)) out[name] = args[name] ?? structuredClone(p.default);
    return out;
}

/** Problems with `args` for tool `id`, as sentences; empty when they are fine. Unknown names are problems. */
export function check(id, args = {}) {
    const t = tool(id);
    if (!t) return [`there is no tool called "${id}"`];
    const errors = [];
    for (const [name, v] of Object.entries(args)) {
        const p = t.params[name];
        if (!p) { errors.push(`${t.label.toLowerCase()} has no setting called "${name}"`); continue; }
        const what = `${name}${p.unit ? ` (${p.unit})` : ''}`;
        if (p.type === 'number') {
            if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`${what} must be a number`);
            else if (p.min !== undefined && v < p.min) errors.push(`${what} must be at least ${p.min}`);
            else if (p.above !== undefined && !(v > p.above)) errors.push(`${what} must be greater than ${p.above}`);
        } else if (p.type === 'enum') {
            if (!p.values.includes(v)) errors.push(`${name} must be one of ${p.values.join(', ')}`);
        } else if (p.type === 'boolean') {
            if (typeof v !== 'boolean') errors.push(`${name} must be true or false`);
        } else if (p.type === 'vector') {
            if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) errors.push(`${what} must be three numbers`);
        }
    }
    return errors;
}

const SELECTION_PARAM = {
    edge: ['edges', { type: 'array', items: { type: 'integer' }, minItems: 1, description: 'the edges to act on, by ref, all on one body' }],
    solid: ['body', { type: 'integer', description: 'the body to act on, by id' }],
    face: ['face', { type: 'integer', description: 'the flat face to sketch on, by ref; leave out to use the work plane' }],
};

/**
 * The tools as JSON Schema tool definitions ({ name, description, input_schema }), for a model
 * that may only call these. The selection the tool acts on is an argument, named by ref.
 */
export function schema() {
    return TOOLS.map(t => {
        const properties = {}, required = [];
        const [selName, selSchema] = SELECTION_PARAM[t.selects];
        properties[selName] = selSchema;
        if (t.selects !== 'face') required.push(selName);
        for (const [name, p] of Object.entries(t.params)) {
            const description = p.describe + (p.unit ? `, in ${p.unit}` : '');
            if (p.type === 'number') properties[name] = { type: 'number', description, ...(p.min !== undefined && { minimum: p.min }), ...(p.above !== undefined && { exclusiveMinimum: p.above }) };
            else if (p.type === 'enum') properties[name] = { type: 'string', enum: p.values, description };
            else if (p.type === 'boolean') properties[name] = { type: 'boolean', description };
            else if (p.type === 'vector') properties[name] = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description };
        }
        return { name: t.id, description: t.summary, input_schema: { type: 'object', properties, required, additionalProperties: false } };
    });
}
