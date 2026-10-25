// Preferences (Plasticity: P-Menu › Preferences, Ctrl+,), kept per browser or app. Plasticity's
// window has Navigation, Appearance and Network sections among others; these are the settings this
// app has. The pure part lives here so it can be tested: defaults, reading a stored copy safely and
// what the viewport needs from them.

const HEX = /^#[0-9a-f]{6}$/i;

/** Every setting with its default, by section, in the order the window shows them. */
export const PREF_FIELDS = {
    navigation: [
        { key: 'zoomToCursor', label: 'ZOOM TO CURSOR', type: 'bool', value: true },
        { key: 'rotateAroundCursor', label: 'ROTATE AROUND CURSOR', type: 'bool', value: true },
        { key: 'invertZoom', label: 'INVERT ZOOM', type: 'bool', value: false },
        { key: 'zoomSpeed', label: 'ZOOM SPEED', type: 'number', value: 1, min: 0.1, max: 5 },
        { key: 'rotateSpeed', label: 'ROTATE SPEED', type: 'number', value: 1, min: 0.1, max: 5 },
        { key: 'panSpeed', label: 'PAN SPEED', type: 'number', value: 1, min: 0.1, max: 5 },
    ],
    appearance: [
        { key: 'accent', label: 'ACCENT', type: 'color', value: '#ff4d00', restart: true },
        { key: 'background', label: 'VIEWPORT BACKGROUND', type: 'color', value: '#0f0f11' },
        { key: 'grid', label: 'GRID', type: 'color', value: '#19191c' },
        { key: 'gridMajor', label: 'GRID MAJOR LINES', type: 'color', value: '#232327' },
        { key: 'edge', label: 'REGULAR EDGE', type: 'color', value: '#efebe0' },
        { key: 'pointSize', label: 'CONTROL POINT SIZE', type: 'number', value: 5, min: 2, max: 20 },
        { key: 'uiScale', label: 'ZOOM FACTOR', type: 'number', value: 1, min: 0.5, max: 2 },
    ],
    commands: [
        { key: 'autoInvoke', label: 'AUTO-INVOKE COMMANDS', type: 'bool', value: true },
        { key: 'autoExtrude', label: 'EXTRUDE', type: 'bool', value: true },
        { key: 'autoOffset', label: 'PUSH FACE', type: 'bool', value: true },
        { key: 'autoExtendSheet', label: 'EXTEND SHEET', type: 'bool', value: true },
        { key: 'autoFillet', label: 'FILLET', type: 'bool', value: true },
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

/** The orbit controls' settings: an inverted zoom is a negative zoom speed. */
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
