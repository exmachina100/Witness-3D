/**
 * Navigation presets (Plasticity: Preferences › Navigation › Navigation Presets, "the same controls
 * as other 3D software"). The manual names no presets, so these follow each program's own default
 * mouse controls. Buttons: 0 left, 1 middle, 2 right. Returns 'orbit', 'pan', 'zoom' or null (the
 * button does what it does in Witness 3D: select, finish, or nothing).
 */
export const NAV_PRESETS = {
    // Witness 3D's own (Plasticity's): middle orbits, Shift+middle or right pans, Ctrl+middle zooms.
    plasticity: { label: 'PLASTICITY', map: { 1: 'orbit', 'shift-1': 'pan', 'ctrl-1': 'zoom', 2: 'pan' } },
    blender: { label: 'BLENDER', map: { 1: 'orbit', 'shift-1': 'pan', 'ctrl-1': 'zoom' } },
    maya: { label: 'MAYA', map: { 'alt-0': 'orbit', 'alt-1': 'pan', 'alt-2': 'zoom', 1: 'pan' } },
    rhino: { label: 'RHINO', map: { 2: 'orbit', 'shift-2': 'pan', 'ctrl-2': 'zoom', 1: 'pan' } },
    fusion: { label: 'FUSION 360', map: { 'shift-1': 'orbit', 1: 'pan' } },
    solidworks: { label: 'SOLIDWORKS', map: { 1: 'orbit', 'ctrl-1': 'pan', 'shift-1': 'zoom' } },
};

export const NAV_PRESET_IDS = Object.keys(NAV_PRESETS);

/** What a press of `button` with these modifiers does under `preset`. */
export function navAction(preset, button, { shift = false, ctrl = false, alt = false } = {}) {
    const map = (NAV_PRESETS[preset] ?? NAV_PRESETS.plasticity).map;
    const mod = alt ? 'alt-' : ctrl ? 'ctrl-' : shift ? 'shift-' : '';
    return map[`${mod}${button}`] ?? null;
}

/**
 * The OrbitControls mode to give the pressed button so it does `action`. OrbitControls itself
 * swaps rotate and pan while Shift, Ctrl or Cmd is held, so with one of those down the other mode
 * is handed over. Modes are three.js MOUSE values: 0 rotate, 1 dolly, 2 pan.
 */
export function orbitMode(action, { shift = false, ctrl = false } = {}) {
    const swapped = shift || ctrl;
    if (action === 'zoom') return 1;
    if (action === 'orbit') return swapped ? 2 : 0;
    if (action === 'pan') return swapped ? 0 : 2;
    return null;
}

/** The key hints for orbit and pan under `preset`: [['MMB', 'ORBIT'], ['RMB', 'PAN']]. */
export function navHints(preset) {
    const map = (NAV_PRESETS[preset] ?? NAV_PRESETS.plasticity).map;
    const name = k => {
        const [mod, b] = String(k).includes('-') ? String(k).split('-') : ['', k];
        return `${{ alt: 'ALT ', ctrl: 'CTRL ', shift: '⇧ ', '': '' }[mod]}${['LMB', 'MMB', 'RMB'][b]}`;
    };
    const first = what => Object.keys(map).find(k => map[k] === what);
    return ['orbit', 'pan'].filter(first).map(w => [name(first(w)), w.toUpperCase()]);
}
