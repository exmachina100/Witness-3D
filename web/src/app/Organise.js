// Organising bodies, after Plasticity's Outliner and Focus/Isolate (manual, doc.plasticity.xyz):
// groups are folders that nest (Ctrl+G groups the selection, Alt+G dissolves the group), a body can
// be hidden or locked (a locked body shows but can't be selected or changed), and Isolate (.) shows
// only the selection, in layers that . with nothing selected peels back one at a time (Alt+. all at once).
//
// Bodies are named by id. Ids that leave the scene drop out of everything on the next prune().

export class Organise {
    constructor() {
        this.hidden = new Set();
        this.locked = new Set();
        this.disabled = new Set(); // Plasticity's Disable: off the viewport and out of every command
        this.active = null;        // the active collection: the group new bodies go into
        this.layers = [];        // isolation layers, outermost first: each the set of ids it shows
        this.groups = [];        // { id, name, parent (group id or null), open }
        this.groupOf = new Map(); // body id -> group id
        this.nextGroup = 1;
    }

    /**
     * Keep up with the scene: forget bodies that are gone (the empty groups stay; Plasticity dims
     * them), and show new ones made while isolated, so a command's result doesn't vanish.
     */
    prune(ids) {
        const live = new Set(ids);
        if (this.known) for (const id of ids) if (!this.known.has(id)) {
            for (const l of this.layers) l.add(id);
            if (this.active !== null && !this.groupOf.has(id)) this.groupOf.set(id, this.active);
        }
        this.known = live;
        for (const s of [this.hidden, this.locked, this.disabled, ...this.layers]) for (const id of [...s]) if (!live.has(id)) s.delete(id);
        for (const id of [...this.groupOf.keys()]) if (!live.has(id)) this.groupOf.delete(id);
        while (this.layers.length && !this.layers.at(-1).size) this.layers.pop();
    }

    /** Shown in the viewport: not hidden or disabled, and in the innermost isolation layer when there is one. */
    shows(id) { return !this.hidden.has(id) && !this.disabled.has(id) && (!this.layers.length || this.layers.at(-1).has(id)); }
    /** Can be picked: shown and not locked. */
    picks(id) { return this.shows(id) && !this.locked.has(id); }

    setHidden(ids, hide) { for (const id of ids) hide ? this.hidden.add(id) : this.hidden.delete(id); }
    /** Ctrl+H: what was hidden shows and what showed hides. */
    invertHidden(ids) { for (const id of ids) this.hidden.has(id) ? this.hidden.delete(id) : this.hidden.add(id); }
    /** Disable: unlike Hide, Unhide All and Invert Hidden leave disabled bodies alone. */
    setDisabled(ids, off) { for (const id of ids) off ? this.disabled.add(id) : this.disabled.delete(id); }
    /** Double-click a group: it becomes the active collection, or stops being it. */
    toggleActive(gid) { this.active = this.active === gid || !this.group(gid) ? null : gid; }
    setLocked(ids, lock) { for (const id of ids) lock ? this.locked.add(id) : this.locked.delete(id); }

    /** Isolate (.): a new layer showing only these; with none, step back out one layer. Returns the depth. */
    isolate(ids) {
        if (ids.length) this.layers.push(new Set(ids));
        else this.layers.pop();
        return this.layers.length;
    }
    unisolate() { this.layers = []; }
    /** How many bodies the innermost layer shows, for the "N ISOLATED" button; 0 when nothing is isolated. */
    get isolated() { return this.layers.length ? this.layers.at(-1).size : 0; }

    group(id) { return this.groups.find(g => g.id === id); }
    /** The groups inside a group (null for the top), in order made. */
    childGroups(parent) { return this.groups.filter(g => g.parent === parent); }
    /** The bodies directly in a group (null for the top), in the order given. */
    members(parent, ids) { return ids.filter(id => (this.groupOf.get(id) ?? null) === parent); }
    /** Every body in a group and the groups inside it. */
    allMembers(gid, ids) {
        const inside = new Set([gid]);
        for (let grew = true; grew;) { grew = false; for (const g of this.groups) if (inside.has(g.parent) && !inside.has(g.id)) { inside.add(g.id); grew = true; } }
        return ids.filter(id => inside.has(this.groupOf.get(id)));
    }

    /**
     * Ctrl+G: a new group around these bodies. It goes where they were when they all shared a group,
     * else at the top. Returns the group, or null with nothing to group.
     */
    makeGroup(ids, name) {
        if (!ids.length) return null;
        const parents = new Set(ids.map(id => this.groupOf.get(id) ?? null));
        const g = { id: this.nextGroup++, name: name ?? '', parent: parents.size === 1 ? [...parents][0] : null, open: true };
        g.name ||= `GROUP ${g.id}`;
        this.groups.push(g);
        for (const id of ids) this.groupOf.set(id, g.id);
        return g;
    }
    /** Alt+G: the groups holding these bodies dissolve; what they held moves up to their parent. Returns how many went. */
    ungroup(ids) {
        const gone = new Set(ids.map(id => this.groupOf.get(id)).filter(g => g !== undefined));
        for (const gid of gone) this.dissolve(gid);
        return gone.size;
    }
    dissolve(gid) {
        const g = this.group(gid);
        if (!g) return;
        for (const [id, at] of this.groupOf) if (at === gid) g.parent === null ? this.groupOf.delete(id) : this.groupOf.set(id, g.parent);
        for (const c of this.groups) if (c.parent === gid) c.parent = g.parent;
        this.groups = this.groups.filter(x => x !== g);
        if (this.active === gid) this.active = g.parent;
    }
    /** What is kept in the file: groups, the group of each body, hidden, locked and disabled, and the active collection. Isolation is a view and isn't kept. */
    toJSON() {
        return { groups: this.groups.map(g => ({ ...g })), groupOf: [...this.groupOf], hidden: [...this.hidden], locked: [...this.locked], disabled: [...this.disabled], active: this.active, nextGroup: this.nextGroup };
    }
    /** Back from toJSON(); anything missing or malformed is left empty. */
    static from(data) {
        const o = new Organise();
        if (!data || typeof data !== 'object') return o;
        const ids = list => Array.isArray(list) ? list.filter(Number.isInteger) : [];
        o.hidden = new Set(ids(data.hidden));
        o.locked = new Set(ids(data.locked));
        o.disabled = new Set(ids(data.disabled));
        o.groups = Array.isArray(data.groups) ? data.groups.filter(g => Number.isInteger(g?.id)).map(g => ({ id: g.id, name: String(g.name ?? `GROUP ${g.id}`), parent: Number.isInteger(g.parent) ? g.parent : null, open: g.open !== false })) : [];
        const known = new Set(o.groups.map(g => g.id));
        for (const g of o.groups) if (!known.has(g.parent)) g.parent = null;
        o.groupOf = new Map((Array.isArray(data.groupOf) ? data.groupOf : []).filter(([b, g]) => Number.isInteger(b) && known.has(g)));
        o.active = known.has(data.active) ? data.active : null;
        o.nextGroup = Math.max(Number.isInteger(data.nextGroup) ? data.nextGroup : 1, ...o.groups.map(g => g.id + 1));
        return o;
    }
    /**
     * What the bridges (Blender, Cinema 4D) need beside the meshes: each body's group path from the
     * top and whether it is hidden. Disabled bodies are out of every process, so they are left out.
     */
    outline(ids) {
        const objects = {};
        for (const id of ids) {
            if (this.disabled.has(id)) continue;
            const path = [];
            for (let g = this.group(this.groupOf.get(id) ?? null); g; g = this.group(g.parent)) path.unshift(g.name);
            objects[id] = { path, hidden: !this.shows(id) };
        }
        return objects;
    }

    rename(gid, name) { const g = this.group(gid); if (g && name.trim()) g.name = name.trim().toUpperCase(); }
}
