// Organising bodies, after Plasticity's Outliner and Focus/Isolate (manual, doc.plasticity.xyz):
// groups are folders that nest (Ctrl+G groups the selection, Alt+G dissolves the group), a body can
// be hidden or locked (a locked body shows but can't be selected or changed), and Isolate (.) shows
// only the selection, in layers that . with nothing selected peels back one at a time (Alt+. all at once).
//
// Bodies are named by id, drawn curves by "c:<id>" (Plasticity's Hide, Isolate, Lock and Disable
// take curves and regions too). Ids that leave the scene drop out of everything on the next prune().

/** A drawn curve's key here, beside the bodies' numeric ids. */
export const curveKey = id => `c:${id}`;
const isCurveKey = k => typeof k === 'string' && /^c:\d+$/.test(k);

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
        this.names = new Map();   // object key -> the name given in the outliner (none: the default)
        this.order = [];          // outliner order set by dragging: object keys and "g:<id>" for groups; the rest follow as made
    }
    /** These keys (objects, or "g:<id>" groups) in their outliner order. */
    sorted(keys, key = k => k) {
        const at = new Map(this.order.map((k, i) => [k, i]));
        const rank = k => at.has(key(k)) ? at.get(key(k)) : 1e9;
        return [...keys].sort((a, b) => rank(a) - rank(b));
    }
    /**
     * Drag a row onto another (manual: drag and drop to reorder the Outliner): the dragged objects
     * and groups go just above `target` (an object key or "g:<id>"), into its group.
     */
    moveBefore(ids, groupIds, target) {
        const tg = typeof target === 'string' && target.startsWith('g:') ? this.group(+target.slice(2)) : null;
        const parent = tg ? tg.parent : this.groupOf.get(target) ?? null;
        const moving = [...ids.filter(id => id !== target), ...groupIds.filter(g => `g:${g}` !== target && !(parent !== null && this.within(parent, g)) && this.group(g)).map(g => `g:${g}`)];
        if (!moving.length) return false;
        for (const k of moving) {
            if (k.startsWith?.('g:')) this.group(+k.slice(2)).parent = parent;
            else if (parent === null) this.groupOf.delete(k);
            else this.groupOf.set(k, parent);
        }
        const gone = new Set(moving);
        // Everything not yet ordered keeps its place, after what was.
        const known = [...(this.knownOf?.body ?? []), ...(this.knownOf?.curve ?? []), ...this.groups.map(g => `g:${g.id}`)];
        const order = [...this.order, ...known.filter(k => !this.order.includes(k))].filter(k => !gone.has(k));
        if (!order.includes(target)) order.push(target);
        order.splice(order.indexOf(target), 0, ...moving);
        this.order = order;
        return true;
    }

    /**
     * Keep up with the scene: forget bodies that are gone (the empty groups stay; Plasticity dims
     * them), and show new ones made while isolated, so a command's result doesn't vanish.
     */
    prune(ids, kind = 'body') {
        // Bodies and curves load apart, so each prune only touches its own kind of key.
        const mine = k => kind === 'curve' ? isCurveKey(k) : typeof k === 'number';
        const live = new Set(ids);
        this.knownOf ??= {};
        const known = this.knownOf[kind];
        if (known) for (const id of ids) if (!known.has(id)) {
            for (const l of this.layers) l.add(id);
            if (this.active !== null && !this.groupOf.has(id)) this.groupOf.set(id, this.active);
        }
        this.knownOf[kind] = live;
        for (const s of [this.hidden, this.locked, this.disabled, ...this.layers]) for (const id of [...s]) if (mine(id) && !live.has(id)) s.delete(id);
        for (const id of [...this.groupOf.keys()]) if (mine(id) && !live.has(id)) this.groupOf.delete(id);
        for (const id of [...this.names.keys()]) if (mine(id) && !live.has(id)) this.names.delete(id);
        this.order = this.order.filter(k => !mine(k) || live.has(k));
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
    /** Which isolation layer is showing, for the "N ISOLATED" button (manual: 2 Isolated is the second layer); 0 when none. */
    get isolated() { return this.layers.length; }

    group(id) { return this.groups.find(g => g.id === id); }
    /** The groups inside a group (null for the top), in order made. */
    childGroups(parent) { return this.sorted(this.groups.filter(g => g.parent === parent), g => `g:${g.id}`); }
    /** The bodies directly in a group (null for the top), in the order given. */
    members(parent, ids) { return this.sorted(ids.filter(id => (this.groupOf.get(id) ?? null) === parent)); }
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
    makeGroup(ids, name, groupIds = []) {
        // Selected groups nest in the new one (Plasticity's groups are objects too), with what they hold.
        const nest = groupIds.filter(gid => this.group(gid));
        if (!ids.length && !nest.length) return null;
        const parents = new Set([...ids.map(id => this.groupOf.get(id) ?? null), ...nest.map(gid => this.group(gid).parent)]);
        const g = { id: this.nextGroup++, name: name ?? '', parent: parents.size === 1 ? [...parents][0] : null, open: true };
        g.name ||= `GROUP ${g.id}`;
        // A group can't go inside one of its own: the new group stands where none of the nested ones holds it.
        while (g.parent !== null && nest.some(gid => this.within(g.parent, gid))) g.parent = this.group(g.parent)?.parent ?? null;
        this.groups.push(g);
        for (const id of ids) this.groupOf.set(id, g.id);
        for (const gid of nest) this.group(gid).parent = g.id;
        return g;
    }
    /** Add to a group (its context menu): these items and groups move into it (never a group into itself). */
    addToGroup(gid, ids, groupIds = []) {
        if (!this.group(gid)) return;
        for (const id of ids) this.groupOf.set(id, gid);
        for (const x of groupIds) if (x !== gid && !this.within(gid, x) && this.group(x)) this.group(x).parent = gid;
    }
    /** Add to Isolation: these show in the current isolation layer too. */
    addToIsolation(ids) { if (this.layers.length) for (const id of ids) this.layers.at(-1).add(id); }
    /** Delete Recursively's last step: the group and every group inside it go (their members are already gone). */
    deleteGroup(gid) {
        const gone = new Set(this.groups.filter(g => this.within(g.id, gid)).map(g => g.id));
        this.groups = this.groups.filter(g => !gone.has(g.id));
        for (const [id, at] of [...this.groupOf]) if (gone.has(at)) this.groupOf.delete(id);
        if (gone.has(this.active)) this.active = null;
    }
    /** Delete empty groups: groups holding nothing (no objects of `ids` anywhere inside them) go. Returns how many. */
    deleteEmptyGroups(ids) {
        const empty = this.groups.filter(g => !this.allMembers(g.id, ids).length).map(g => g.id);
        for (const gid of empty) if (this.group(gid)) this.deleteGroup(gid);
        return empty.length;
    }
    /** True when group `gid` is `outer` or lies somewhere inside it. */
    within(gid, outer) {
        for (let g = this.group(gid); g; g = this.group(g.parent)) if (g.id === outer) return true;
        return false;
    }
    /**
     * Alt+G (manual: "removes the selected object from its group"): only these items leave their
     * groups, for the top (as Plasticity's OSS moves them to root); the groups and what else they
     * hold stay. Returns how many moved.
     */
    removeFromGroup(ids, groupIds = []) {
        let n = 0;
        for (const id of ids) if (this.groupOf.delete(id)) n++;
        for (const gid of groupIds) { const g = this.group(gid); if (g && g.parent !== null) { g.parent = null; n++; } }
        return n;
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
        return { groups: this.groups.map(g => ({ ...g })), groupOf: [...this.groupOf], hidden: [...this.hidden], locked: [...this.locked], disabled: [...this.disabled], active: this.active, nextGroup: this.nextGroup, names: [...this.names], order: [...this.order] };
    }
    /** Everything an undo step puts back: what toJSON() keeps and the isolation layers. */
    snapshot() { return { ...this.toJSON(), layers: this.layers.map(l => [...l]) }; }
    /** Back to a snapshot() (Ctrl+Z on an organising step). */
    restore(snap) {
        const o = Organise.from(snap);
        for (const k of ['hidden', 'locked', 'disabled', 'groups', 'groupOf', 'active', 'nextGroup', 'names', 'order']) this[k] = o[k];
        this.layers = (Array.isArray(snap?.layers) ? snap.layers : []).map(l => new Set(l));
    }
    /** Back from toJSON(); anything missing or malformed is left empty. */
    static from(data) {
        const o = new Organise();
        if (!data || typeof data !== 'object') return o;
        const ids = list => Array.isArray(list) ? list.filter(k => Number.isInteger(k) || isCurveKey(k)) : [];
        o.hidden = new Set(ids(data.hidden));
        o.locked = new Set(ids(data.locked));
        o.disabled = new Set(ids(data.disabled));
        o.groups = Array.isArray(data.groups) ? data.groups.filter(g => Number.isInteger(g?.id)).map(g => ({ id: g.id, name: String(g.name ?? `GROUP ${g.id}`), parent: Number.isInteger(g.parent) ? g.parent : null, open: g.open !== false })) : [];
        const known = new Set(o.groups.map(g => g.id));
        for (const g of o.groups) if (!known.has(g.parent)) g.parent = null;
        o.groupOf = new Map((Array.isArray(data.groupOf) ? data.groupOf : []).filter(([b, g]) => (Number.isInteger(b) || isCurveKey(b)) && known.has(g)));
        o.active = known.has(data.active) ? data.active : null;
        o.order = (Array.isArray(data.order) ? data.order : []).filter(k => Number.isInteger(k) || isCurveKey(k) || (typeof k === 'string' && /^g:\d+$/.test(k) && known.has(+k.slice(2))));
        o.names = new Map((Array.isArray(data.names) ? data.names : []).filter(e => Array.isArray(e) && (Number.isInteger(e[0]) || isCurveKey(e[0])) && typeof e[1] === 'string' && e[1].trim()));
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
            objects[id] = { path, hidden: !this.shows(id), ...(this.names.has(id) ? { name: this.names.get(id) } : {}) };
        }
        return objects;
    }

    /** Name an object (a body's id or a curve's key); an empty name goes back to the default. */
    renameObject(key, name) { const t = name.trim().toUpperCase(); t ? this.names.set(key, t) : this.names.delete(key); }
    rename(gid, name) { const g = this.group(gid); if (g && name.trim()) g.name = name.trim().toUpperCase(); }
}
