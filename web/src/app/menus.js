// The P-Menu (Plasticity's file menu, top left), radial menus and keys of the user's own choosing,
// after the manual (Plasticity Interface › P-Menu, Radial Menu, Command Palette). Entries name
// actions (keymap.js), so a menu, a radial slice, a key and the palette all run the same thing.

/** The P-Menu, in the manual's order; entries the build can't do yet are left out by App.js. */
export const P_MENU = [
    { action: 'file:recent', label: 'RECENT FILES' },
    { action: 'file:new', label: 'NEW FILE' },
    { action: 'file:open', label: 'OPEN' },
    { action: 'import:step', label: 'IMPORT' },
    { action: 'file:save', label: 'SAVE' },
    { action: 'file:save-as', label: 'SAVE AS' },
    { action: 'file:save-startup', label: 'SAVE AS STARTUP SCENE' },
    { action: 'file:export', label: 'EXPORT' },
    { action: 'file:save-version', label: 'QUICK SAVE VERSION' },
    { action: 'app:preferences', label: 'PREFERENCES' },
    { action: 'app:version', label: 'CURRENT VERSION' },
    { action: 'app:quit', label: 'QUIT' },
];

/**
 * The two radial menus Plasticity ships, as data in its file shape ({ name, command, items:
 * [{ command, icon?, label }] }). Its selection menu has these four; its viewport menu is only shown
 * as a picture, so ours holds the viewport toggles this app has.
 */
export const RADIALS = [
    {
        name: 'Selection mode', command: 'selection-mode', items: [
            { command: 'mode:point', icon: 'mode-point', label: 'CONTROL POINT' },
            { command: 'mode:solid', icon: 'mode-solid', label: 'SOLID' },
            { command: 'mode:edge', icon: 'mode-edge', label: 'EDGE' },
            { command: 'mode:face', icon: 'mode-face', label: 'FACE' },
        ],
    },
    {
        name: 'Viewport settings', command: 'viewport-settings', items: [
            { command: 'view:ortho', label: 'ORTHOGRAPHIC' },
            { command: 'view:xray', label: 'X-RAY' },
            { command: 'view:edges', label: 'EDGES' },
            { command: 'view:faces', label: 'FACES' },
            { command: 'view:curves', label: 'CURVES' },
            { command: 'view:render', icon: 'material', label: 'RENDER' },
            { command: 'view:zebra', label: 'ZEBRA' },
            { command: 'view:focus', label: 'FOCUS' },
        ],
    },
];

/**
 * A radial menu file read and checked: returns { menu } or { error }. Commands are this app's action
 * names; `view:radial:<command>` opens another menu, as in Plasticity.
 */
export function parseRadial(text, known = () => true) {
    let m;
    try { m = JSON.parse(text); } catch { return { error: 'NOT A JSON FILE' }; }
    if (!m || typeof m.name !== 'string' || !m.name.trim()) return { error: 'A RADIAL MENU NEEDS A NAME' };
    if (typeof m.command !== 'string' || !/^[\w-]+$/.test(m.command)) return { error: 'A RADIAL MENU NEEDS A COMMAND ID (LETTERS, DIGITS, - OR _)' };
    if (!Array.isArray(m.items) || !m.items.length || m.items.length > 12) return { error: 'A RADIAL MENU HOLDS 1 TO 12 ITEMS' };
    const items = [];
    for (const it of m.items) {
        if (!it || typeof it.command !== 'string') return { error: 'EVERY ITEM NEEDS A COMMAND' };
        if (!it.command.startsWith('view:radial:') && !known(it.command)) return { error: `UNKNOWN COMMAND ${it.command.toUpperCase()}` };
        items.push({ command: it.command, icon: typeof it.icon === 'string' ? it.icon : undefined, label: String(it.label ?? it.command).toUpperCase().slice(0, 24) });
    }
    return { menu: { name: m.name.trim(), command: m.command, items } };
}

/** What an item shows in the middle with no icon: its label's first two characters, as in Plasticity. */
export const shortLabel = item => item.label.replace(/\s+/g, '').slice(0, 2);

/** Where item i of n sits around the centre, in screen pixels (y down), the first straight up, going clockwise. */
export function slicePosition(i, n, radius) {
    const a = 2 * Math.PI * i / n;
    return [radius * Math.sin(a), -radius * Math.cos(a)];
}

/** The item a pointer offset from the centre points at, or -1 inside the dead zone. */
export function sliceAt(dx, dy, n, dead = 18) {
    if (Math.hypot(dx, dy) < dead) return -1;
    const a = (Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI);
    return Math.round(a / (2 * Math.PI / n)) % n;
}

/**
 * Keys the user bound in the palette (right-click an entry), over the defaults: { key: action }.
 * A key the user binds takes over from its default; '' as an action unbinds that key.
 */
export function mergeKeys(defaults, custom) {
    const out = { ...defaults };
    for (const [k, a] of Object.entries(custom ?? {})) { if (a) out[k] = a; else delete out[k]; }
    return out;
}

/** A key's display form ('CTRL SHIFT S'), for the palette and menus. */
export const showKey = k => k ? k.toUpperCase().replaceAll('-', ' ') : '';
