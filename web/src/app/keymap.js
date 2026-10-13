// Keys, following Plasticity's defaults: its manual for v26.1 (doc.plasticity.xyz) and, where the
// manual is silent, the default keymap of the open-source 0.6.30 (nkallen/plasticity,
// src/startup/default-keymap.ts). Only the bindings are taken, as data. See
// /mnt/project-files/witness3d/plasticity-parity.md for what is and isn't matched yet.
//
// A key string is the modifiers in the order ctrl, alt, shift, then the key, joined by '-':
// 'shift-x', 'ctrl-numpad1', 'alt-z', 'space'. Digits and the numpad are read from the physical
// key, so Shift+1 is 'shift-1' on any layout. Cmd counts as Ctrl.

const CODES = {
    Space: 'space', Slash: '/', Escape: 'escape', Enter: 'enter', NumpadEnter: 'enter', Tab: 'tab',
    Delete: 'delete', Backspace: 'backspace', Minus: '-', NumpadSubtract: '-', Period: '.', NumpadDecimal: '.',
};

export function keyOf(e) {
    let key;
    if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
    else if (/^Numpad\d$/.test(e.code)) key = 'numpad' + e.code.slice(6);
    else if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3).toLowerCase();
    else key = CODES[e.code] ?? e.key?.toLowerCase();
    if (['control', 'alt', 'shift', 'meta'].includes(key)) return key === 'meta' ? 'ctrl' : key;
    return [(e.ctrlKey || e.metaKey) && 'ctrl', e.altKey && 'alt', e.shiftKey && 'shift', key].filter(Boolean).join('-');
}

/** Bindings that work whenever no handle is taking keys. Values are action names (see ACTIONS). */
export const VIEWPORT = {
    // Viewport (manual: Operating the 3D Viewport; 0.6.30 for focus and x-ray)
    numpad1: 'view:front', numpad3: 'view:right', numpad7: 'view:top',
    'ctrl-numpad1': 'view:back', 'ctrl-numpad3': 'view:left', 'ctrl-numpad7': 'view:bottom',
    numpad5: 'view:ortho', '/': 'view:focus', 'alt-z': 'view:xray',
    // Selection (manual: Selection Mode, Selecting Objects; 5 is "all" since 26.1)
    1: 'mode:point', 2: 'mode:edge', 3: 'mode:face', 4: 'mode:solid', 5: 'mode:all',
    'shift-1': 'mode-toggle:point', 'shift-2': 'mode-toggle:edge', 'shift-3': 'mode-toggle:face', 'shift-4': 'mode-toggle:solid',
    'ctrl-2': 'convert:edge', 'ctrl-3': 'convert:face', 'ctrl-4': 'convert:solid',
    a: 'select:all', escape: 'select:none', 'alt-a': 'select:invert',
    // Commands (manual: Command Bar, General Functions)
    f: 'palette', 'shift-f': 'suggest', 'shift-r': 'repeat',
    b: 'tool:fillet', g: 'tool:move', r: 'tool:rotate', s: 'tool:scale', p: 'tool:pushpull',
    e: 'tool:extrude', q: 'tool:boolean', l: 'tool:loft', 'shift-p': 'tool:sweep',
    // Sketching (manual: Line is Shift+A; 0.6.30 for the rectangle and circle, which 26.1 leaves unbound)
    'shift-q': 'draw:rect', 'shift-w': 'draw:circle', 'shift-a': 'draw:line',
    'shift-x': 'delete', 'shift-delete': 'delete', 'shift-backspace': 'delete',
    'shift-d': 'duplicate',
    // Curves (0.6.30's default keymap: J joins curves; 26.1 keeps it)
    j: 'join',
    // Witness 3D's own: a command asked for in words (ai.js); Plasticity has no equivalent
    'ctrl-k': 'ask',
    h: 'hide', 'shift-h': 'hide-others', 'alt-h': 'unhide-all',
    // Construction planes (manual: Construction Plane)
    space: 'plane:selection', 'shift-space': 'plane:selection-keep-view', 'ctrl-space': 'plane:view',
    // Files and history
    'ctrl-z': 'undo', 'ctrl-shift-z': 'redo', 'ctrl-n': 'file:new', 'ctrl-o': 'file:open', 'ctrl-s': 'file:save',
};

/** Keys inside a running command, by tool. Each names the value the cursor then sets (see App.js). */
export const COMMAND = {
    fillet: { d: 'distance', c: 'chamfer', a: 'angle' },
    move: { x: 'x', y: 'y', z: 'z', 'shift-x': 'yz', 'shift-y': 'xz', 'shift-z': 'xy', g: 'screen' },
    rotate: { x: 'x', y: 'y', z: 'z', r: 'screen' },
    scale: { s: 'uniform' },
    pushpull: { d: 'distance', q: 'join', w: 'cut', b: 'new', r: 'rect', c: 'circle' },
    // Extrude and Boolean (manual: Q union, W difference, Shift+E intersect, B new body, T keep tools)
    // (manual: A angle, Shift+T thickness, S lock both sides, Shift+Q slice)
    extrude: { d: 'distance', a: 'angle', 'shift-t': 'thickness', s: 'lock', q: 'union', w: 'difference', 'shift-e': 'intersect', 'shift-q': 'slice', b: 'new' },
    boolean: { q: 'union', w: 'difference', 'shift-e': 'intersect', 'shift-q': 'slice', t: 'keep' },
    // Offset Face (manual: D distance; its A angle and Tab grow modes are not here yet)
    offset: { d: 'distance', a: 'angle' },
    // Revolve and Sweep (manual: A angle, Shift+T thickness, D twist, Q W Shift+E B as in Extrude)
    revolve: { a: 'angle', 'shift-t': 'thickness', q: 'union', w: 'difference', 'shift-e': 'intersect', b: 'new' },
    sweep: { d: 'twist', q: 'union', w: 'difference', 'shift-e': 'intersect', b: 'new' },
    // Drawing (manual: Tab types dimensions, S square and C centre for rectangles, Ctrl+Z drops a line's last point)
    rect: { tab: 'typed', s: 'square', c: 'centre' },
    circle: { tab: 'typed', v: 'vertical' },
    line: { tab: 'typed', 'ctrl-z': 'back', x: 'axis-x', y: 'axis-y', z: 'axis-z' },
    // The other curve tools (manual: Tab types dimensions; Regular Polygon's arrows and C; Spline
    // Curve's Ctrl+Z). They have no default keys in Plasticity either; F finds them.
    'center-rect': { tab: 'typed', s: 'square' },
    rect3: { tab: 'typed' },
    circle2: { tab: 'typed' },
    circle3: { tab: 'typed' },
    arc3: { tab: 'typed' },
    arc: { tab: 'typed' },
    // V stands a circle or polygon up (0.6.30's gizmo:circle:mode and gizmo:polygon:mode).
    polygon: { tab: 'typed', arrowup: 'more', arrowdown: 'fewer', c: 'circumscribed', v: 'vertical' },
    spline: { 'ctrl-z': 'back', x: 'axis-x', y: 'axis-y', z: 'axis-z' },
    // Tangent Arc's D flips it; Spiral's A, D and R (manual), X/Y/Z while placing the axis end.
    'tangent-arc': { d: 'flip' },
    // Round 7: D types the distance or radius.
    'offset-curve': { d: 'distance' },
    'fillet-curve': { d: 'radius' },
    // Round 6: Shell's D types the thickness; Mirror and Radial Array take X/Y/Z for the axis and J to join.
    shell: { d: 'thickness' },
    mirror: { x: 'x', y: 'y', z: 'z', j: 'join' },
    'rect-array': { j: 'join' },
    'radial-array': { x: 'x', y: 'y', z: 'z', j: 'join' },
    spiral: { x: 'axis-x', y: 'axis-y', z: 'axis-z', a: 'angle', d: 'length', r: 'radius' },
    ellipse: {},
    ellipse3: {},
};

/** Everything the palette (F) lists, with its key for display. Tools come from tools.js. */
export const ACTIONS = {
    'view:front': 'View front', 'view:right': 'View right', 'view:top': 'View top',
    'view:back': 'View back', 'view:left': 'View left', 'view:bottom': 'View bottom',
    'view:ortho': 'Toggle orthographic', 'view:focus': 'Focus on selection', 'view:xray': 'Toggle x-ray',
    'mode:point': 'Selection mode: points', 'mode:edge': 'Selection mode: edges', 'mode:face': 'Selection mode: faces',
    'mode:solid': 'Selection mode: solids', 'mode:all': 'Selection mode: all',
    'convert:edge': 'Convert selection to edges', 'convert:face': 'Convert selection to faces', 'convert:solid': 'Convert selection to solids',
    'select:all': 'Select all', 'select:none': 'Deselect all', 'select:invert': 'Invert selection',
    'repeat': 'Repeat last command', 'ask': 'Ask for a command in words', 'delete': 'Delete', 'duplicate': 'Duplicate',
    'hide': 'Hide selected', 'hide-others': 'Hide unselected', 'unhide-all': 'Unhide all',
    'plane:selection': 'Construction plane from selection', 'plane:selection-keep-view': 'Construction plane from selection, keep view',
    'plane:view': 'Construction plane from view', 'plane:world': 'Construction plane: world XY',
    'draw:rect': 'Corner rectangle', 'draw:circle': 'Center circle', 'draw:line': 'Line',
    'draw:center-rect': 'Center rectangle', 'draw:rect3': 'Three point rectangle', 'draw:circle2': 'Two point circle',
    'draw:circle3': 'Three point circle', 'draw:arc3': 'Three point arc', 'draw:arc': 'Center point arc',
    'draw:polygon': 'Regular polygon', 'draw:spline': 'Spline curve', 'draw:ellipse': 'Center ellipse',
    'draw:ellipse3': 'Three point ellipse', 'draw:tangent-arc': 'Tangent arc', 'draw:spiral': 'Spiral', 'join': 'Join curves', 'trim': 'Trim curves', 'explode': 'Explode curve',
    'undo': 'Undo', 'redo': 'Redo', 'file:new': 'New', 'file:open': 'Open…', 'file:save': 'Save',
    'export:step': 'Export STEP', 'import:step': 'Import STEP',
};

/** The key bound to an action, for display ('SHIFT X'), or ''. */
export function keyFor(action) {
    const k = Object.keys(VIEWPORT).find(k => VIEWPORT[k] === action);
    return k ? k.toUpperCase().replaceAll('-', ' ') : '';
}
