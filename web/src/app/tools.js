// The tool registry: every command the app can run, described once. The toolbar, the keyboard,
// the inspector and (from stage C) the AI command box all read it, so a tool exists in exactly one
// place and the AI can only ask for what is listed here, with arguments checked the same way a
// typed value is.
//
// Every tool follows Plasticity's lifecycle (see App.js): select what it acts on, start the tool by
// its key, adjust against a live preview with its handle, its keys or typed numbers, then finish
// (Enter, right-click or OK) or abort (Escape). Nothing changes the document until it finishes, and
// a finish is one undo step. Keys follow Plasticity's defaults (see keymap.js).
//
// `selects` is what the tool acts on: 'face' (a point on a flat face, or the work plane), 'faces'
// (faces of one body), 'edge' (one or more edges of one body), 'region' (one drawn region),
// 'regions' (several, in order), 'curves' (drawn curves, open or closed) or 'solid' (one body). `key` is '' where Plasticity binds none. Lengths are millimetres, angles degrees,
// and coordinates are the user's: x right, y back, z up (the viewport's own y is up).

export const TOOLS = [
    {
        id: 'pushpull', label: 'PUSH·PULL', key: 'p', group: 'shape', selects: 'face', toolbar: false,
        summary: 'Sketch a square or circle on a flat face or the work plane, then pull it out into a boss or push it in to cut a pocket.',
        params: {
            distance: { type: 'number', unit: 'mm', default: 0, describe: 'how far to pull; positive joins, negative cuts' },
            profile: { type: 'enum', values: ['rect', 'circle'], default: 'rect', describe: 'the sketch shape' },
            size: { type: 'number', unit: 'mm', min: 0.5, default: 10, describe: 'side of the square, or diameter of the circle' },
            newBody: { type: 'boolean', default: false, describe: 'make a separate body instead of joining or cutting' },
        },
    },
    {
        id: 'extrude', label: 'EXTRUDE', key: 'e', group: 'shape', selects: 'region',
        summary: 'Pull the region inside a closed curve, or a flat face, into a solid; it joins or cuts the body it sits on.',
        params: {
            distance: { type: 'number', unit: 'mm', nonzero: true, default: 10, describe: 'how far to extrude along the normal; negative goes the other way' },
            op: { type: 'enum', values: ['auto', 'union', 'difference', 'intersect', 'slice', 'new'], default: 'auto', describe: 'auto joins pulling out and cuts pushing in; or force a boolean, slice the body in two, or make a new body' },
            angle: { type: 'number', unit: 'deg', above: -90, below: 90, default: 0, describe: 'how far the sides lean in going away from the profile (draft); negative leans out' },
            thickness: { type: 'number', unit: 'mm', min: 0, default: 0, describe: 'leave walls this thick inside the outline instead of a filled solid; 0 for solid' },
            bothSides: { type: 'boolean', default: false, describe: 'extrude the same distance the other way too' },
        },
    },
    {
        id: 'boolean', label: 'BOOLEAN', key: 'q', group: 'shape', selects: 'solids',
        summary: 'Join, cut or intersect a target solid with tool solids.',
        params: {
            op: { type: 'enum', values: ['union', 'difference', 'intersect', 'slice'], default: 'union', describe: 'what to do with the tools; slice splits the target where each tool cuts it into separate bodies' },
            keepTools: { type: 'boolean', default: false, describe: 'keep the tool bodies afterwards' },
        },
    },
    {
        id: 'fillet', label: 'FILLET', key: 'b', group: 'shape', selects: 'edge',
        summary: 'Round the selected edges of one body, or bevel them with a negative distance.',
        params: {
            distance: { type: 'number', unit: 'mm', nonzero: true, default: 2, describe: 'radius of the round; a negative value makes a chamfer of that distance instead' },
            angle: { type: 'number', unit: 'deg', above: 0, below: 90, default: 45, describe: 'for a chamfer, its angle from the first face; 45 gives equal distances' },
        },
    },
    {
        id: 'offset', label: 'OFFSET FACE', key: '', group: 'shape', selects: 'faces', toolbar: false,
        summary: 'Move faces of one solid along their normals; the faces around them stretch to meet them. Selecting faces starts it.',
        params: {
            distance: { type: 'number', unit: 'mm', default: 1, describe: 'how far to move the faces; positive moves them outward' },
            angle: { type: 'number', unit: 'deg', above: -90, below: 90, default: 0, describe: 'Angle Adjacent: how far the faces around them lean; positive narrows the moved faces' },
        },
    },
    {
        id: 'revolve', label: 'REVOLVE', key: '', group: 'shape', selects: 'region', toolbar: false,
        summary: 'Turn the region inside a closed curve about an axis into a solid.',
        params: {
            axisPoint: { type: 'vector', unit: 'mm', default: [0, 0, 0], describe: 'a point on the axis' },
            axisDir: { type: 'vector', default: [0, 0, 1], describe: 'the direction of the axis' },
            angle: { type: 'number', unit: 'deg', nonzero: true, default: 360, describe: 'how far to turn' },
            thickness: { type: 'number', unit: 'mm', min: 0, default: 0, describe: 'leave walls this thick inside the outline instead of a filled solid; 0 for solid' },
            op: { type: 'enum', values: ['new', 'union', 'difference', 'intersect'], default: 'new', describe: 'a new body, or a boolean with the body the region lies on' },
        },
    },
    {
        id: 'loft', label: 'LOFT', key: 'l', group: 'shape', selects: 'regions', toolbar: false,
        summary: 'Pass a solid through two regions or more, in the order given.',
        params: {},
    },
    {
        id: 'sweep', label: 'SWEEP', key: 'shift-p', group: 'shape', selects: 'region', toolbar: false,
        summary: 'Sweep the region inside a closed curve along another curve into a solid.',
        params: {
            twist: { type: 'number', unit: 'deg', default: 0, describe: 'how far the far end turns about the profile' },
            scale: { type: 'number', above: 0, default: 1, describe: 'the far end\'s size relative to the profile' },
            op: { type: 'enum', values: ['new', 'union', 'difference', 'intersect'], default: 'new', describe: 'a new body, or a boolean with the body the region lies on' },
        },
    },
    // Round 6. Box, Cylinder and Sphere take a point on a face or the construction plane (click it);
    // Shell takes faces of one solid; Mirror and the arrays take the selected solids.
    {
        id: 'box', label: 'CORNER BOX', key: '', group: 'shape', selects: 'face', toolbar: false,
        summary: 'Make a box: click a corner, click the opposite corner, then move up for the height (C from the centre, S square, Tab to type).',
        params: {
            width: { type: 'number', unit: 'mm', nonzero: true, default: 20, describe: "size along the plane's first direction; negative goes the other way" },
            depth: { type: 'number', unit: 'mm', nonzero: true, default: 20, describe: "size along the plane's second direction; negative goes the other way" },
            height: { type: 'number', unit: 'mm', nonzero: true, default: 20, describe: 'height off the plane; negative goes below it' },
        },
    },
    {
        id: 'center-box', label: 'CENTER BOX', key: '', group: 'shape', selects: 'face', toolbar: false,
        summary: 'Make a box from the centre of its base: click the centre, a corner, then move up for the height.',
        params: {
            width: { type: 'number', unit: 'mm', above: 0, default: 20, describe: 'size along the plane\'s first direction' },
            depth: { type: 'number', unit: 'mm', above: 0, default: 20, describe: 'size along the plane\'s second direction' },
            height: { type: 'number', unit: 'mm', nonzero: true, default: 20, describe: 'height off the plane; negative goes below it' },
        },
    },
    {
        id: 'box3', label: 'THREE POINT BOX', key: '', group: 'shape', selects: 'face', toolbar: false,
        summary: 'Make a box at any angle: click a corner, a point along one side, the width, then move up for the height.',
        params: {
            width: { type: 'number', unit: 'mm', nonzero: true, default: 20, describe: 'length of the first side' },
            depth: { type: 'number', unit: 'mm', nonzero: true, default: 20, describe: 'length of the second side' },
            height: { type: 'number', unit: 'mm', nonzero: true, default: 20, describe: 'height off the plane; negative goes below it' },
        },
    },
    {
        id: 'cylinder', label: 'CYLINDER', key: '', group: 'shape', selects: 'face', toolbar: false,
        summary: 'Make a cylinder standing on a point of a face or the construction plane.',
        params: {
            radius: { type: 'number', unit: 'mm', above: 0, default: 10, describe: 'radius of the base circle' },
            height: { type: 'number', unit: 'mm', nonzero: true, default: 20, describe: 'height off the plane; negative goes below it' },
        },
    },
    {
        id: 'sphere', label: 'SPHERE', key: '', group: 'shape', selects: 'face', toolbar: false,
        summary: 'Make a sphere centred on a point of a face or the construction plane.',
        params: {
            radius: { type: 'number', unit: 'mm', above: 0, default: 10, describe: 'radius of the sphere' },
        },
    },
    {
        id: 'shell', label: 'SHELL', key: '', group: 'shape', selects: 'faces', toolbar: false,
        summary: 'Hollow a solid to walls of one thickness, leaving the selected faces open.',
        params: {
            thickness: { type: 'number', unit: 'mm', above: 0, default: 2, describe: 'wall thickness, measured inward from the outside' },
        },
    },
    {
        id: 'mirror', label: 'MIRROR', key: '', group: 'organise', selects: 'solid', toolbar: false,
        summary: 'Reflect the selected solids in a plane across an axis, as copies or joined to the originals.',
        params: {
            axis: { type: 'enum', values: ['x', 'y', 'z'], default: 'x', describe: 'the axis the plane is square to; x reflects left to right' },
            position: { type: 'number', unit: 'mm', default: 0, describe: 'where the plane crosses that axis' },
            join: { type: 'boolean', default: false, describe: 'fuse each reflection into its original instead of making a new body' },
        },
    },
    {
        id: 'rect-array', label: 'RECTANGULAR ARRAY', key: '', group: 'organise', selects: 'solid', toolbar: false,
        summary: 'Repeat the selected solids in a grid along x, y and z.',
        params: {
            counts: { type: 'vector', default: [3, 1, 1], describe: 'how many along x, y and z, the original included (whole numbers, at least 1)' },
            spacing: { type: 'vector', unit: 'mm', default: [30, 30, 30], describe: 'distance between neighbours along x, y and z' },
            join: { type: 'boolean', default: false, describe: 'fuse the copies into each original instead of making new bodies' },
        },
    },
    {
        id: 'radial-array', label: 'RADIAL ARRAY', key: '', group: 'organise', selects: 'solid', toolbar: false,
        summary: "Repeat the selected solids around an axis through the construction plane's origin.",
        params: {
            count: { type: 'number', min: 1, default: 6, describe: 'how many, the original included (a whole number)' },
            angle: { type: 'number', unit: 'deg', nonzero: true, default: 360, describe: 'how far round the copies spread; 360 spaces them evenly round a full turn' },
            axis: { type: 'enum', values: ['x', 'y', 'z'], default: 'z', describe: 'the axis to turn about; z is up' },
            join: { type: 'boolean', default: false, describe: 'fuse the copies into each original instead of making new bodies' },
        },
    },
    // Round 8: Hole is a round cut into a flat face, through Extrude's forced difference.
    {
        id: 'hole', label: 'HOLE', key: '', group: 'shape', selects: 'face', toolbar: false,
        summary: 'Drill a round hole into a flat face, to a depth or right through the body.',
        params: {
            diameter: { type: 'number', unit: 'mm', above: 0, default: 6, describe: 'the hole\'s diameter' },
            depth: { type: 'number', unit: 'mm', above: 0, default: 10, describe: 'how deep; ignored when through is on' },
            through: { type: 'boolean', default: false, describe: 'cut right through the body' },
        },
    },
    {
        id: 'remove-face', label: 'REMOVE FACE', key: '', group: 'shape', selects: 'faces', toolbar: false,
        summary: 'Delete the selected faces of a solid and let the faces around them grow to close the gap, such as a fillet, hole or boss.',
        params: {},
    },
    // Round 10: Plasticity's Cut, solids split by curves drawn across them.
    {
        id: 'cut', label: 'CUT', key: '', group: 'shape', selects: 'curves', toolbar: false,
        summary: 'Split the selected solids along curves drawn across them; each curve cuts straight through along the normal of its plane, and every piece becomes its own body.',
        params: {},
    },
    {
        id: 'imprint', label: 'IMPRINT', key: '', group: 'shape', selects: 'curves', toolbar: false,
        summary: 'Draw the selected curves onto faces of a solid, splitting the faces there without cutting the body; each curve is projected along the normal of its plane.',
        params: {},
    },
    // Round 7: curve editing. Trim and Explode are actions (a click, or none), not tools.
    {
        id: 'offset-curve', label: 'OFFSET CURVE', key: '', group: 'curve', selects: 'curves', toolbar: false,
        summary: 'Copy the selected curves a set distance away: closed curves grow or shrink, open ones move sideways.',
        params: {
            distance: { type: 'number', unit: 'mm', nonzero: true, default: 5, describe: 'how far; positive grows a closed curve or moves an open one to its left' },
        },
    },
    {
        id: 'fillet-curve', label: 'FILLET CURVE', key: '', group: 'curve', selects: 'curves', toolbar: false,
        summary: 'Round the corners of the selected lines, rectangles and polygons with arcs.',
        params: {
            radius: { type: 'number', unit: 'mm', above: 0, default: 2, describe: 'radius of the rounds' },
        },
    },
    {
        id: 'bridge', label: 'BRIDGE CURVES', key: '', group: 'curve', selects: 'curves', toolbar: false,
        summary: 'Join the nearest ends of two open curves with a smooth curve that leaves each along its own direction.',
        params: {
            tension: { type: 'number', above: 0, default: 1, describe: 'how long the bridge holds each end\'s direction; 1 is a natural blend' },
        },
    },
    {
        id: 'move', label: 'MOVE', key: 'g', group: 'organise', selects: 'solid',
        summary: 'Move the selected bodies.',
        params: {
            offset: { type: 'vector', unit: 'mm', default: [0, 0, 0], describe: 'how far to move along x, y and z (z is up)' },
        },
    },
    {
        id: 'rotate', label: 'ROTATE', key: 'r', group: 'organise', selects: 'solid',
        summary: 'Turn the selected bodies about an axis through the centre of their bounding box.',
        params: {
            axis: { type: 'enum', values: ['x', 'y', 'z'], default: 'z', describe: 'the axis to turn about; z is up' },
            angle: { type: 'number', unit: 'deg', default: 0, describe: 'how far to turn, counter-clockwise looking down the axis' },
        },
    },
    {
        id: 'scale', label: 'SCALE', key: 's', group: 'organise', selects: 'solid',
        summary: 'Scale the selected bodies evenly about the centre of their bounding box.',
        params: {
            factor: { type: 'number', above: 0, default: 1, describe: 'the scale factor; 2 doubles every length' },
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
            else if (p.below !== undefined && !(v < p.below)) errors.push(`${what} must be less than ${p.below}`);
            else if (p.nonzero && v === 0) errors.push(`${what} must not be zero`);
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
    region: ['region', { type: 'integer', description: 'the closed curve whose region to extrude, by id; or give face instead' }],
    solids: ['target', { type: 'integer', description: 'the body to change, by id' }],
    faces: ['faces', { type: 'array', items: { type: 'integer' }, minItems: 1, description: 'the faces to act on, by ref, all on one body' }],
    curves: ['curves', { type: 'array', items: { type: 'integer' }, minItems: 1, description: 'the curves to act on, by id' }],
    regions: ['regions', { type: 'array', items: { type: 'integer' }, minItems: 2, description: 'the closed curves whose regions to pass through, by id, in order' }],
};
const EXTRA_PARAMS = {
    extrude: { face: { type: 'integer', description: 'a flat face to extrude instead of a region, by ref' } },
    boolean: { tools: { type: 'array', items: { type: 'integer' }, minItems: 1, description: 'the tool bodies, by id' } },
    sweep: { path: { type: 'integer', description: 'the curve to sweep along, by id' } },
    cut: { bodies: { type: 'array', items: { type: 'integer' }, minItems: 1, description: 'the solids to cut, by id' } },
    imprint: {
        body: { type: 'integer', description: 'the body to imprint on, by id; every face it has unless faces are given' },
        faces: { type: 'array', items: { type: 'integer' }, minItems: 1, description: 'only these faces, by ref, all on one body' },
    },
};
const REQUIRED = { edge: true, solid: true, solids: true, faces: true, regions: true, curves: true };
const REQUIRED_EXTRA = { boolean: ['tools'], revolve: ['region'], sweep: ['region', 'path'], cut: ['bodies'] };

/**
 * The tools as JSON Schema tool definitions ({ name, description, input_schema }), for a model
 * that may only call these. The selection the tool acts on is an argument, named by ref.
 */
export function schema() {
    return TOOLS.map(t => {
        const properties = {}, required = [];
        const [selName, selSchema] = SELECTION_PARAM[t.selects];
        properties[selName] = selSchema;
        if (REQUIRED[t.selects]) required.push(selName);
        Object.assign(properties, EXTRA_PARAMS[t.id]);
        required.push(...(REQUIRED_EXTRA[t.id] ?? []));
        for (const [name, p] of Object.entries(t.params)) {
            const description = p.describe + (p.unit ? `, in ${p.unit}` : '');
            if (p.type === 'number') properties[name] = { type: 'number', description, ...(p.min !== undefined && { minimum: p.min }), ...(p.above !== undefined && { exclusiveMinimum: p.above }), ...(p.below !== undefined && { exclusiveMaximum: p.below }), ...(p.nonzero && { not: { const: 0 } }) };
            else if (p.type === 'enum') properties[name] = { type: 'string', enum: p.values, description };
            else if (p.type === 'boolean') properties[name] = { type: 'boolean', description };
            else if (p.type === 'vector') properties[name] = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description };
        }
        return { name: t.id, description: t.summary, input_schema: { type: 'object', properties, required, additionalProperties: false } };
    });
}
