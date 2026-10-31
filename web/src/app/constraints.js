// Plasticity's Constraint System (Create Constraints): a bridge made with the option on stays
// joined to the curves it bridges. When either of them is edited, the bridge is made again from
// them with the same ends, continuities and tensions, in the same undo step. As in Plasticity the
// constraints last for the session only. Editing the bridge itself, or splitting a curve it hangs
// on, lets the constraint go.
//
// Curves get new ids whenever they change, so each reference is a chain of ids, newest last; the
// newest one still present is the curve (undo brings older ones back, and the chain still finds them).

export class Constraints {
    constructor() { this.list = []; }

    /** A bridge between curves `a` (end `ea`) and `b` (end `eb`), with the options it was made with. */
    addBridge(bridge, a, ea, b, eb, options) {
        this.list.push({ kind: 'bridge', bridge: [bridge], a: [a], b: [b], ea, eb, options });
    }

    /** The newest id of a chain that `exists`, or null. */
    static head(chain, exists) {
        for (let i = chain.length - 1; i >= 0; i--) if (exists(chain[i])) return chain[i];
        return null;
    }

    /** The live constraints: those whose curves all exist, with their current ids. */
    live(exists) {
        return this.list.map(k => ({ k, a: Constraints.head(k.a, exists), b: Constraints.head(k.b, exists), bridge: Constraints.head(k.bridge, exists) }))
            .filter(r => r.a !== null && r.b !== null && r.bridge !== null);
    }

    /**
     * Before curves `ids` are replaced by `list`: the bridges to remake with them. `curveById` reads
     * a curve; `rebuild(a, b, k)` makes a bridge or throws. Returns { ids, list } to append to the
     * replacement and `done(newIds)` to call with the ids the whole replacement got.
     */
    plan(ids, list, curveById, rebuild) {
        const exists = id => !!curveById(id);
        const same = ids.length === list.length;
        const next = new Map(same ? ids.map((id, i) => [id, { ...list[i], id }]) : []);
        const extra = { ids: [], list: [] }, renames = [];
        const live = this.live(exists), heads = new Map(live.map(r => [r.k, r]));
        for (const r of live) {
            if (ids.includes(r.bridge)) { this.list = this.list.filter(k => k !== r.k); continue; }   // the bridge edited by hand
            const touched = ids.includes(r.a) || ids.includes(r.b);
            if (!touched) continue;
            if (!same) continue;   // a curve split or joined: the bridge stays as it is
            const a = next.get(r.a) ?? curveById(r.a), b = next.get(r.b) ?? curveById(r.b);
            let out;
            try { out = rebuild(a, b, r.k); } catch { continue; }
            extra.ids.push(r.bridge);
            extra.list.push(out);
            renames.push({ k: r.k, bridgeAt: ids.length + extra.ids.length - 1 });
        }
        const done = newIds => {
            if (!same) return;
            for (const k of this.list) for (const side of ['a', 'b']) {
                const i = ids.indexOf(heads.get(k)?.[side]);
                if (i >= 0) k[side].push(newIds[i]);
            }
            for (const { k, bridgeAt } of renames) k.bridge.push(newIds[bridgeAt]);
        };
        return { ...extra, done };
    }

    clear() { this.list = []; }
}
