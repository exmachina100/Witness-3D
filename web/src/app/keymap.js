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
    Delete: 'delete', Backspace: 'backspace', Minus: '-', Equal: '=', NumpadSubtract: '-', Period: '.', NumpadDecimal: '.',
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
    // Project (manual: I; Curve Body, Body Body or Curve Curve by what is selected)
    i: 'tool:project',
    // Offset Curve, Offset Vertex, Offset Edge and Offset Face Loop by what is selected (manual: O)
    o: 'tool:offset-curve',
    // Sketching (manual: Line is Shift+A; 0.6.30 for the rectangle and circle, which 26.1 leaves unbound)
    'shift-q': 'draw:rect', 'shift-w': 'draw:circle', 'shift-a': 'draw:line',
    'shift-x': 'delete', 'shift-delete': 'delete', 'shift-backspace': 'delete',
    'shift-d': 'duplicate', 'alt-d': 'alt-duplicate', 'shift-g': 'slide',
    // Place (manual: Ctrl+D)
    'ctrl-d': 'place',
    // Dimension (manual: =)
    '=': 'dimension',
    // Curves (0.6.30's default keymap: J joins curves; 26.1 keeps it)
    j: 'join',
    // Raise Degree (manual: Raise Surface Degree is Shift+S; curves by what is selected)
    'shift-s': 'raise-degree',
    // Untrim (manual: Alt+T)
    'alt-t': 'untrim',
    // Witness 3D's own: a command asked for in words (ai.js); Plasticity has no equivalent
    'ctrl-k': 'ask',
    h: 'hide', 'shift-h': 'hide-others', 'alt-h': 'unhide-all', 'ctrl-h': 'invert-hidden',
    // Organising (manual: Outliner; Focus and Isolate). Lock Selected and Unlock All have no key there either.
    '.': 'isolate', 'alt-.': 'unisolate', 'ctrl-g': 'group', 'alt-g': 'ungroup',
    // Materials (manual: Set Material is M)
    m: 'material:set',
    // Construction planes (manual: Construction Plane)
    space: 'plane:selection', 'shift-space': 'plane:selection-keep-view', 'ctrl-space': 'plane:view',
    // Files and history
    // P-Menu (manual: Plasticity Interface › P-Menu)
    'ctrl-z': 'undo', 'ctrl-shift-z': 'redo', 'ctrl-n': 'file:new', 'ctrl-o': 'file:open', 'ctrl-s': 'file:save',
    'ctrl-shift-o': 'import:step', 'ctrl-shift-s': 'file:save-as', 'ctrl-shift-e': 'file:export', 'ctrl-q': 'app:quit',
};

/** Keys inside a running command, by tool. Each names the value the cursor then sets (see App.js). */
export const COMMAND = {
    // Fillet (manual: V adds a variable point)
    fillet: { d: 'distance', c: 'chamfer', a: 'angle', v: 'variable', l: 'limit' },
    move: { x: 'x', y: 'y', z: 'z', 'shift-x': 'yz', 'shift-y': 'xz', 'shift-z': 'xy', g: 'screen' },
    rotate: { x: 'x', y: 'y', z: 'z', r: 'screen' },
    scale: { s: 'uniform' },
    pushpull: { d: 'distance', q: 'join', w: 'cut', b: 'new', r: 'rect', c: 'circle' },
    // Extrude and Boolean (manual: Q union, W difference, Shift+E intersect, B new body, T keep tools)
    // (manual: A angle, Shift+T thickness, S lock both sides, Shift+Q slice)
    extrude: { f: 'freestyle', v: 'pivot', i: 'individual', d: 'distance', a: 'angle', 'shift-t': 'thickness', s: 'lock', q: 'union', w: 'difference', 'shift-e': 'intersect', 'shift-q': 'slice', b: 'new' },
    boolean: { q: 'union', w: 'difference', 'shift-e': 'intersect', 'shift-q': 'slice', t: 'keep' },
    // Offset Face (manual: D distance, A angle adjacent, Tab grow mode)
    offset: { d: 'distance', a: 'angle', tab: 'grow' },
    // Revolve and Sweep (manual: A angle, Shift+T thickness, D twist, Q W Shift+E B as in Extrude)
    revolve: { a: 'angle', 'shift-t': 'thickness', q: 'union', w: 'difference', 'shift-e': 'intersect', b: 'new' },
    sweep: { m: 'method', n: 'align', d: 'twist', q: 'union', w: 'difference', 'shift-e': 'intersect', b: 'new' },
    // Drawing (manual: Tab types dimensions, S square and C centre for rectangles, Ctrl+Z drops a line's last point)
    rect: { tab: 'typed', s: 'square', c: 'centre' },
    circle: { tab: 'typed', v: 'vertical', x: 'axis-x', y: 'axis-y' },
    line: { tab: 'typed', 'ctrl-z': 'back', x: 'axis-x', y: 'axis-y', z: 'axis-z' },
    // The other curve tools (manual: Tab types dimensions; Regular Polygon's arrows and C; Spline
    // Curve's Ctrl+Z). They have no default keys in Plasticity either; F finds them.
    'center-rect': { tab: 'typed', s: 'square' },
    rect3: { tab: 'typed', x: 'axis-x', y: 'axis-y', z: 'axis-z' },
    circle2: { tab: 'typed' },
    circle3: { tab: 'typed' },
    arc3: { tab: 'typed' },
    arc: { tab: 'typed' },
    // V stands a circle or polygon up (0.6.30's gizmo:circle:mode and gizmo:polygon:mode).
    polygon: { tab: 'typed', arrowup: 'more', arrowdown: 'fewer', c: 'circumscribed', v: 'vertical' },
    // Tab swaps Spline Curve and Control Point Curve, keeping the points (manual: Control / Through-point).
    spline: { 'ctrl-z': 'back', tab: 'switch', x: 'axis-x', y: 'axis-y', z: 'axis-z' },
    cv: { 'ctrl-z': 'back', tab: 'switch', x: 'axis-x', y: 'axis-y', z: 'axis-z' },
    // Tangent Arc's D flips it; Spiral's A, D and R (manual), X/Y/Z while placing the axis end.
    'tangent-arc': { d: 'flip' },
    // Primitives (manual: Corner / Center / Three Point Box, Cylinder, Sphere). Tab types sizes; C and S
    // shape a box's base; H, F and D hand the cursor to the height, radius or diameter; V stands a
    // cylinder up; X, Y and Z hold the base to an axis; Q W Shift+E Shift+Q B pick the boolean.
    box: { tab: 'typed', c: 'centre', s: 'square', h: 'height', x: 'axis-x', y: 'axis-y', z: 'axis-z', q: 'union', w: 'difference', 'shift-e': 'intersect', 'shift-q': 'slice', b: 'new' },
    'center-box': { tab: 'typed', c: 'centre', s: 'square', h: 'height', x: 'axis-x', y: 'axis-y', z: 'axis-z', q: 'union', w: 'difference', 'shift-e': 'intersect', 'shift-q': 'slice', b: 'new' },
    box3: { tab: 'typed', h: 'height', x: 'axis-x', y: 'axis-y', z: 'axis-z', q: 'union', w: 'difference', 'shift-e': 'intersect', 'shift-q': 'slice', b: 'new' },
    cylinder: { tab: 'typed', v: 'vertical', f: 'radius', d: 'height', x: 'axis-x', y: 'axis-y', z: 'axis-z', q: 'union', w: 'difference', 'shift-e': 'intersect', 'shift-q': 'slice', b: 'new' },
    sphere: { tab: 'typed', d: 'radius', x: 'axis-x', y: 'axis-y', z: 'axis-z', q: 'union', w: 'difference', 'shift-e': 'intersect', 'shift-q': 'slice', b: 'new' },
    // Round 7: D types the distance or radius.
    // Offset Curve (manual: D distance, V gap fill, S lock distances, F freestyle; C kept for the gap fill)
    'offset-curve': { d: 'distance', c: 'corner', v: 'corner', s: 'lock', f: 'freestyle', o: 'slot', i: 'combine' },
    'offset-vertex': { d: 'distance' },
    // Slide Curve CV (manual: U positive U, Shift+U negative U, N normal)
    slide: { d: 'distance', u: 'u', 'shift-u': '-u', v: 'v', 'shift-v': '-v', n: 'n' },
    // Offset Edge / Offset Face Loop (manual: D distance, V gap fill)
    'offset-edge': { d: 'distance', v: 'corner', s: 'both' },
    isoparam: { tab: 'direction', u: 'u', v: 'v' },
    'fillet-vertex': { d: 'distance', c: 'chamfer' },
    'align-vertex': { x: 'x', y: 'y', z: 'z', v: 'value' },
    extend: { s: 'shape' },
    rebuild: { c: 'count', d: 'degree' },
    // Rebuild Face: M method, T tolerance, D degree, S spans, E extend, H shrink.
    untrim: { tab: 'keep-edges' },
    // Section Analysis (manual): D distance, F flip.
    section: { d: 'distance', f: 'flip' },
    'match-face': { tab: 'grow' },
    'deform-curve': { m: 'mirror', u: 'u', n: 'normal', k: 'keep', r: 'reblend' },
    image: { delete: 'delete', backspace: 'delete' },
    // Cut Curve (manual: Tab extends the cutters, S cuts along the view)
    'cut-curve': { tab: 'extend', s: 'screen' },
    // Bridge Edge (manual: Tab continuity, D tension)
    'bridge-edge': { d: 'tension', tab: 'continuity' },
    'align-surface': { d: 'tension', tab: 'continuity' },
    // Instance (manual: Create Solid and Sheet Instance; moved, turned and scaled like a body)
    instance: { g: 'move', r: 'rotate', s: 'scale', 'shift-d': 'duplicate', delete: 'delete', backspace: 'delete' },
    'rebuild-face': { m: 'method', t: 'tolerance', d: 'degree', s: 'spans', e: 'extend', h: 'shrink' },
    'fillet-curve': { d: 'radius' },
    // Bridge Curve / Bridge Vertex (manual: Tab continuity, D tension)
    bridge: { t: 'tension', d: 'tension', tab: 'continuity', q: 'trim' },
    hole: { t: 'through' },
    // Cut: P cuts with the construction plane as well.
    cut: { p: 'plane' },
    // Project (manual): S projects along the view (screen space); X, Y and Z pick a vector axis, again flips it.
    project: { s: 'screen', x: 'axis-x', y: 'axis-y', z: 'axis-z' },
    // Bridge Surface: T types the tension.
    'bridge-surface': { t: 'tension' },
    // Patch: T leaves the edges tangent to their faces.
    patch: { t: 'tangent' },
    thicken: { d: 'front', b: 'back' },
    // Pipe: R radius, T wall thickness, V sides.
    pipe: { r: 'radius', t: 'thickness', v: 'sides' },
    'extend-sheet': { d: 'distance', tab: 'shape' },
    // Export drawing: H leaves hidden lines out (or back in), C the curves.
    'export-drawing': { h: 'hidden', c: 'curves' },
    // Draft Face: A types the angle.
    draft: { a: 'angle' },
    // Tangent Circle (manual): F freezes the circle, Tab types its radius.
    'tangent-circle': { f: 'freeze', tab: 'typed' },
    // Round 6: Shell's D types the thickness; Mirror and Radial Array take X/Y/Z for the axis and J to join.
    shell: { d: 'thickness' },
    mirror: { x: 'x', y: 'y', z: 'z', j: 'join' },
    'rect-array': { j: 'join', i: 'instance' },
    'radial-array': { x: 'x', y: 'y', z: 'z', j: 'join', i: 'instance' },
    'curve-array': { a: 'align', j: 'join', i: 'instance' },
    // Place (manual: S scale, A angle, D offset, F flip, X/Y/Z axis, Q W Shift+E Shift+Q B boolean)
    // Dimension (manual: Tab types the next size)
    dimension: { tab: 'typed' },
    place: { s: 'scale', a: 'angle', d: 'offset', f: 'flip', i: 'instance', x: 'axis-x', y: 'axis-y', z: 'axis-z', q: 'union', w: 'difference', 'shift-e': 'intersect', 'shift-q': 'slice', b: 'new' },
    spiral: { x: 'axis-x', y: 'axis-y', z: 'axis-z', a: 'angle', d: 'length', r: 'radius' },
    ellipse: {},
    ellipse3: {},
};
// Knife (manual: K while drawing): the finished curve imprints the face it was drawn on and is used up.
for (const id of ['rect', 'circle', 'line', 'center-rect', 'rect3', 'circle2', 'circle3', 'arc3', 'arc', 'polygon', 'spline', 'cv', 'tangent-arc', 'ellipse', 'ellipse3']) COMMAND[id].k ??= 'knife';

/** Everything the palette (F) lists, with its key for display. Tools come from tools.js. */
export const ACTIONS = {
    'view:front': 'View front', 'view:right': 'View right', 'view:top': 'View top',
    'view:back': 'View back', 'view:left': 'View left', 'view:bottom': 'View bottom',
    'view:ortho': 'Toggle orthographic', 'view:focus': 'Focus on selection', 'view:xray': 'Toggle x-ray',
    'mode:point': 'Selection mode: points', 'mode:edge': 'Selection mode: edges', 'mode:face': 'Selection mode: faces',
    'mode:solid': 'Selection mode: solids', 'mode:all': 'Selection mode: all',
    'convert:edge': 'Convert selection to edges', 'convert:face': 'Convert selection to faces', 'convert:solid': 'Convert selection to solids',
    'select:all': 'Select all', 'select:none': 'Deselect all', 'select:invert': 'Invert selection',
    'repeat': 'Repeat last command', 'ask': 'Ask for a command in words', 'delete': 'Delete', 'duplicate': 'Duplicate', 'alt-duplicate': 'Alternative duplicate onto the plane', 'create-outline': 'Create outline', 'toggle-points': 'Toggle points',
    'hide': 'Hide selected', 'hide-others': 'Hide unselected', 'unhide-all': 'Unhide all', 'invert-hidden': 'Invert hidden',
    'isolate': 'Isolate selected', 'unisolate': 'Unisolate', 'group': 'Group selected', 'ungroup': 'Ungroup',
    'lock': 'Lock selected', 'unlock-all': 'Unlock all',
    'material:set': 'Set material', 'material:remove': 'Remove material', 'view:render': 'Toggle render mode',
    'view:edges': 'Viewport: toggle edges', 'view:faces': 'Viewport: toggle faces', 'view:curves': 'Viewport: toggle curves',
    'plane:selection': 'Construction plane from selection', 'plane:selection-keep-view': 'Construction plane from selection, keep view',
    'plane:view': 'Construction plane from view', 'plane:world': 'Construction plane: world XY',
    'draw:rect': 'Corner rectangle', 'draw:circle': 'Center circle', 'draw:line': 'Line',
    'draw:center-rect': 'Center rectangle', 'draw:rect3': 'Three point rectangle', 'draw:circle2': 'Two point circle',
    'draw:circle3': 'Three point circle', 'draw:arc3': 'Three point arc', 'draw:arc': 'Center point arc',
    'draw:polygon': 'Regular polygon', 'draw:spline': 'Spline curve', 'draw:ellipse': 'Center ellipse',
    'draw:ellipse3': 'Three point ellipse', 'draw:tangent-arc': 'Tangent arc', 'draw:spiral': 'Spiral', 'draw:cv': 'Control point curve', 'draw:tangent-circle': 'Tangent circle', 'split': 'Split segment (split curve at point)', 'cut-curve': 'Cut curve', 'bridge-edge': 'Bridge edge', 'align-surface': 'Align surface', 'measure:distance': 'Measure distance', 'measure:radius': 'Measure radius', 'measure:continuity': 'Measure continuity', 'view:curvature': 'Toggle curvature', 'view:surface-curvature': 'Toggle surface curvature', 'view:zebra': 'Shader: vertical zebra', 'view:draft': 'Shader: draft angle', 'join': 'Join curves or sheets', 'unjoin:faces': 'Unjoin faces', 'unjoin:pieces': 'Unjoin shells', 'trim': 'Trim curves', 'explode': 'Explode curve', 'reverse': 'Reverse curve', 'rebuild': 'Rebuild curve or face', 'insert-knot': 'Insert knot', 'raise-degree': 'Raise curve or surface degree', 'subdivide': 'Subdivide curve or surface', 'complete-edge': 'Complete edge', 'deform-curve': 'Deform', 'create-instance': 'Create instance', 'realize-instance': 'Realize instance', 'convert-vertex': 'Convert vertex', 'unify': 'Delete redundant topology', 'slot': 'Slot', 'boundary-edges': 'Find boundary edges', 'remove-fillets': 'Remove fillets', 'isoparam': 'Isoparam', 'match-face': 'Match face', 'untrim': 'Untrim', 'unwrap': 'Unwrap face', 'section': 'Section analysis', 'place': 'Place', 'dimension': 'Dimension', 'text': 'Text', 'slide': 'Slide curve or surface CV', 'reverse-sheet': 'Reverse sheet', 'align-vertex': 'Align vertex', 'extend': 'Extend curve',
    'undo': 'Undo', 'redo': 'Redo', 'file:new': 'New', 'file:open': 'Open…', 'file:save': 'Save',
    'file:save-as': 'Save as…', 'file:save-version': 'Quick save version', 'file:export': 'Export…', 'file:recent': 'Recent files', 'app:quit': 'Quit', 'app:menu': 'File menu (P-Menu)',
    'radial:selection-mode': 'Radial menu: selection mode', 'radial:viewport-settings': 'Radial menu: viewport settings',
    'export:step': 'Export STEP', 'export:mesh': 'Export mesh (OBJ, STL)', 'export:drawing': 'Export drawing (SVG, DXF)', 'import:step': 'Import (STEP, IGES, DXF)',
};

/** The key bound to an action, for display ('SHIFT X'), or ''. */
export function keyFor(action) {
    const k = Object.keys(VIEWPORT).find(k => VIEWPORT[k] === action);
    return k ? k.toUpperCase().replaceAll('-', ' ') : '';
}
