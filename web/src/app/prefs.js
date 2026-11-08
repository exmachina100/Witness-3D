// Preferences (Plasticity: P-Menu › Preferences, Ctrl+,), kept per browser or app. Plasticity's
// window has Navigation, Appearance and Network sections among others; these are the settings this
// app has. The pure part lives here so it can be tested: defaults, reading a stored copy safely and
// what the viewport needs from them.

import { LANGUAGES } from './i18n.js';

const HEX = /^#[0-9a-f]{6}$/i;

/** Every setting with its default, by section, in the order the window shows them. */
export const PREF_FIELDS = {
    navigation: [
        // Navigation Presets: the same mouse controls as other 3D programs (navPresets.js).
        { key: 'preset', label: 'NAVIGATION PRESET', type: 'choice', value: 'plasticity', options: ['plasticity', 'blender', 'maya', 'rhino', 'fusion', 'solidworks'] },
        { key: 'zoomToCursor', label: 'ZOOM TO CURSOR', type: 'bool', value: true },
        { key: 'rotateAroundCursor', label: 'ROTATE AROUND CURSOR', type: 'bool', value: true },
        { key: 'arcball', label: 'ARCBALL ROTATION', type: 'bool', value: false },
        { key: 'zoomVertical', label: 'ZOOM VERTICAL (CTRL + MIDDLE-DRAG)', type: 'bool', value: true },
        { key: 'invertZoom', label: 'INVERT ZOOM', type: 'bool', value: false },
        { key: 'invertWheel', label: 'INVERT WHEEL DIRECTION', type: 'bool', value: false },
        { key: 'zoomSpeed', label: 'ZOOM SPEED', type: 'number', value: 1, min: 0.1, max: 5 },
        { key: 'rotateSpeed', label: 'ROTATE SPEED', type: 'number', value: 1, min: 0.1, max: 5 },
        { key: 'panSpeed', label: 'PAN SPEED', type: 'number', value: 1, min: 0.1, max: 5 },
        { key: 'fov', label: 'CAMERA FIELD OF VIEW (°)', type: 'number', value: 50, min: 10, max: 120, step: 1 },
    ],
    appearance: [
        // Plasticity's Language: the app's words laid over in that language (i18n.js).
        { key: 'language', label: 'LANGUAGE', type: 'choice', value: 'en', options: LANGUAGES },
        // Plasticity's Appearance colour groups: Accent, Supporting (secondary text and icons),
        // Neutral (menus and toolbars), Viewport (with preset swatches), Grid, edges, Measurement.
        { key: 'accent', label: 'ACCENT', type: 'color', value: '#ff4d00' },
        { key: 'supporting', label: 'SUPPORTING', type: 'color', value: '#8e949e' },
        { key: 'neutral', label: 'NEUTRAL (MENUS AND TOOLBARS)', type: 'color', value: '#141416' },
        { key: 'background', label: 'VIEWPORT BACKGROUND', type: 'color', value: '#0f0f11', presets: ['#0f0f11', '#1b1c20', '#2a2c31', '#3c3f45', '#5a5e66', '#c9c6bd'] },
        { key: 'grid', label: 'GRID', type: 'color', value: '#19191c' },
        { key: 'gridMajor', label: 'GRID MAJOR LINES', type: 'color', value: '#232327' },
        { key: 'edge', label: 'REGULAR EDGE', type: 'color', value: '#efebe0' },
        { key: 'instanceEdge', label: 'INSTANCE EDGE', type: 'color', value: '#b4b0a6' },
        { key: 'measurement', label: 'MEASUREMENT', type: 'color', value: '#6cbf5f' },
        // Edge and curve thickness in pixels (drawn as screen-space quads past 1).
        { key: 'edgeThickness', label: 'EDGE THICKNESS', type: 'number', value: 1, min: 1, max: 8, step: 0.5 },
        { key: 'curveThickness', label: 'CURVE THICKNESS', type: 'number', value: 1, min: 1, max: 8, step: 0.5 },
        { key: 'pointSize', label: 'CONTROL POINT SIZE', type: 'number', value: 5, min: 2, max: 20 },
        { key: 'vertexSize', label: 'VERTEX SIZE', type: 'number', value: 5, min: 2, max: 20 },
        { key: 'cubeSize', label: 'VIEWPORT GIZMO SIZE', type: 'number', value: 1, min: 0.5, max: 2 },
        { key: 'uiScale', label: 'ZOOM FACTOR', type: 'number', value: 1, min: 0.5, max: 2 },
        // Plasticity's UI standard spacing (inferred: the manual names it only): how much room the
        // outliner rows, panel sections and option buttons leave round themselves, 1 as drawn.
        { key: 'spacing', label: 'UI STANDARD SPACING', type: 'number', value: 1, min: 0.5, max: 1.5, step: 0.25 },
    ],
    commands: [
        { key: 'autoInvoke', label: 'AUTO-INVOKE COMMANDS', type: 'bool', value: true },
        { key: 'autoExtrude', label: 'EXTRUDE', type: 'bool', value: true },
        { key: 'autoOffset', label: 'PUSH FACE', type: 'bool', value: true },
        { key: 'autoExtendSheet', label: 'EXTEND SHEET', type: 'bool', value: true },
        { key: 'autoFillet', label: 'FILLET', type: 'bool', value: true },
        { key: 'autoMove', label: 'MOVE', type: 'bool', value: true },
    ],
    // Plasticity's Grid and Units › Length, and the mass shown for the selection.
    units: [
        { key: 'length', label: 'LENGTH', type: 'choice', value: 'mm', options: ['mm', 'cm', 'm', 'in', 'ft'] },
        { key: 'mass', label: 'MASS', type: 'choice', value: 'g', options: ['g', 'kg', 'oz', 'lb'] },
        // Plasticity's Grid and Units: the snap step (typed, not only stepped) and how many steps
        // apart the major lines are drawn.
        { key: 'gridSize', label: 'SNAP TO GRID SIZE (MM)', type: 'number', value: 2.5, min: 0.001, max: 1000, step: 0.5 },
        { key: 'lineEvery', label: 'LINE EVERY', type: 'number', value: 10, min: 1, max: 100, step: 1 },
    ],
    performance: [
        { key: 'renderQuality', label: 'GPU RENDERING QUALITY (PIXEL RATIO)', type: 'number', value: 2, min: 0.5, max: 2 },
        { key: 'facetQuality', label: 'CPU FACET QUALITY', type: 'number', value: 1, min: 0.25, max: 4 },
        { key: 'aoShader', label: 'AMBIENT OCCLUSION IN SHADER MODE', type: 'bool', value: false },
    ],
    // Plasticity's Backup: open documents are copied for emergencies and offered back after a crash.
    backup: [
        { key: 'enabled', label: 'BACK UP OPEN DOCUMENTS', type: 'bool', value: true, desktop: true },
        { key: 'minutes', label: 'EVERY (MINUTES)', type: 'number', value: 2, min: 1, max: 60, step: 1, desktop: true },
    ],
    network: [
        { key: 'bridge', label: 'BRIDGE ENABLE', type: 'bool', value: true, restart: true, desktop: true },
        { key: 'bridgePort', label: 'BRIDGE PORT', type: 'number', value: 8981, min: 1024, max: 65535, step: 1, restart: true, desktop: true },
    ],
};

/** The defaults as { section: { key: value } }. */
export function defaultPrefs() {
    return Object.fromEntries(Object.entries(PREF_FIELDS).map(([s, fs]) => [s, Object.fromEntries(fs.map(f => [f.key, f.value]))]));
}

/** One value checked against its field: the right type and in range, else the default. */
export function checkPref(field, v) {
    if (field.type === 'bool') return typeof v === 'boolean' ? v : field.value;
    if (field.type === 'choice') return field.options.includes(v) ? v : field.value;
    if (field.type === 'color') return typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : field.value;
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n)) return field.value;
    const c = Math.min(field.max, Math.max(field.min, n));
    return field.step === 1 ? Math.round(c) : c;
}

/** A stored copy (any shape, possibly from an older build) read over the defaults. */
export function readPrefs(stored) {
    const out = defaultPrefs();
    if (!stored || typeof stored !== 'object') return out;
    for (const [s, fs] of Object.entries(PREF_FIELDS)) {
        const have = stored[s];
        if (!have || typeof have !== 'object') continue;
        for (const f of fs) if (f.key in have) out[s][f.key] = checkPref(f, have[f.key]);
    }
    return out;
}

/** The prefs with one setting changed. */
export function setPref(prefs, section, key, v) {
    const f = PREF_FIELDS[section]?.find(x => x.key === key);
    if (!f) return prefs;
    return { ...prefs, [section]: { ...prefs[section], [key]: checkPref(f, v) } };
}

/** The settings that differ from their defaults, for storing. */
export function changedPrefs(prefs) {
    const d = defaultPrefs(), out = {};
    for (const [s, fs] of Object.entries(PREF_FIELDS)) {
        for (const f of fs) if (prefs[s][f.key] !== d[s][f.key]) (out[s] ??= {})[f.key] = prefs[s][f.key];
    }
    return out;
}

/**
 * The orbit controls' settings: an inverted zoom is a negative zoom speed. This is the drag's;
 * `wheel` gives the wheel's, which App.js swaps in as each wheel turn arrives.
 */
export const wheelSpeed = nav => nav.zoomSpeed * (nav.invertWheel ? -1 : 1);
export function controlSettings(nav) {
    return {
        zoomToCursor: nav.zoomToCursor,
        zoomSpeed: nav.zoomSpeed * (nav.invertZoom ? -1 : 1),
        rotateSpeed: nav.rotateSpeed,
        panSpeed: nav.panSpeed,
    };
}

/** The viewport colours as numbers, for three.js. */
export function viewColors(look) {
    const n = h => parseInt(h.slice(1), 16);
    return { accent: n(look.accent), ground: n(look.background), grid: n(look.grid), gridMajor: n(look.gridMajor) };
}
