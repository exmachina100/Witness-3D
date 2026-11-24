// Plasticity's Snapping window: object snapping on or off as a whole, and the Object Snaps that
// may be offered, by kind. Shift+X while a snap is shown skips that kind for the rest of the
// command, so the next one under the pointer comes up (pressing it again skips that one too).
// Pure: the app keeps the state and asks `allowed`.

/** The kinds a user can switch, each with the snap names (as the tag shows them) it covers. */
export const SNAP_KINDS = [
    { id: 'end', label: 'END', names: ['END'] },
    { id: 'middle', label: 'MIDDLE', names: ['MIDDLE'] },
    { id: 'quarter', label: '1/4 · 3/4', names: ['1/4', '3/4'] },
    { id: 'center', label: 'CENTER', names: ['CENTER'] },
    { id: 'intersection', label: 'INTERSECTION', names: ['INTERSECTION'] },
    { id: 'closest', label: 'CLOSEST', names: ['ON CURVE'] },
    { id: 'perpendicular', label: 'PERPENDICULAR', names: ['PERPENDICULAR'] },
    { id: 'tangent', label: 'TANGENT', names: ['TANGENT'] },
    { id: 'tantan', label: 'TAN/TAN', names: ['TAN/TAN'] },
    { id: 'planes', label: 'YZ · XZ', names: ['YZ', 'XZ'] },
    { id: 'section', label: 'SECTION', names: ['SECTION'] },
];
/**
 * Plasticity's OBJECT SNAPS, in its order: what a snap may lie on. Control points (shown with
 * Toggle Points), body edges, curves, faces, and the world axes and planes (the YZ and XZ snaps).
 */
export const OBJECT_SNAPS = [
    { id: 'point', label: 'CONTROL POINT' },
    { id: 'edge', label: 'EDGE' },
    { id: 'curve', label: 'CURVE' },
    { id: 'face', label: 'FACE' },
    { id: 'axis', label: 'AXIS' },
];

const KIND_OF = new Map(SNAP_KINDS.flatMap(k => k.names.map(n => [n, k.id])));

/** The kind id a snap name belongs to (unknown names count as their own kind). */
export const kindOf = name => KIND_OF.get(name) ?? name;

/** The default state: object snapping on, every kind offered. */
export const defaultSnaps = () => ({ on: true, off: [], objOff: [] });

/** Read stored settings, keeping only known kinds; anything unreadable gives the defaults. */
export function parseSnaps(text) {
    try {
        const v = JSON.parse(text);
        if (!v || typeof v !== 'object') return defaultSnaps();
        return {
            on: v.on !== false,
            off: Array.isArray(v.off) ? v.off.filter(id => SNAP_KINDS.some(k => k.id === id)) : [],
            objOff: Array.isArray(v.objOff) ? v.objOff.filter(id => OBJECT_SNAPS.some(k => k.id === id)) : [],
        };
    } catch { return defaultSnaps(); }
}

/**
 * Whether a snap named `name`, lying on `source` (one of OBJECT_SNAPS, or none), may be offered,
 * given the settings and the kinds skipped with Shift+X.
 */
export function allowed(name, settings, skipped = [], source = null) {
    if (!settings.on) return false;
    const id = kindOf(name);
    if (source && settings.objOff?.includes(source)) return false;
    return !settings.off.includes(id) && !skipped.includes(id);
}
