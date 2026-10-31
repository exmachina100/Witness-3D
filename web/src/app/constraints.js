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

    /** A bridge `out` between curves `a` (end `ea`) and `b` (end `eb`), with the options it was made with. */
    addBridge(out, a, ea, b, eb, options) {
        this.list.push({ kind: 'bridge', out: [out], ins: [[a], [b]], ea, eb, options });
    }

    /** Align: curve `out`'s end `endT` kept meeting curve `ref` at its end `endR`, with the options. */
    addAlign(out, endT, ref, endR, options) {
        this.list.push({ kind: 'align', out: [out], ins: [[ref]], endT, endR, options });
    }

    /** The newest id of a chain that `exists`, or null. */
    static head(chain, exists) {
        for (let i = chain.length - 1; i >= 0; i--) if (exists(chain[i])) return chain[i];
        return null;
    }

    /** The live constraints: those whose curves all exist, with their current ids. */
    live(exists) {
        return this.list.map(k => ({ k, ins: k.ins.map(c => Constraints.head(c, exists)), out: Constraints.head(k.out, exists) }))
            .filter(r => r.out !== null && r.ins.every(i => i !== null));
    }

    /**
     * Before curves `ids` are replaced by `list`: the constrained curves to remake with them.
     * `curveById` reads a curve; `rebuild(ins, k, out)` makes the constrained curve from its input
     * curves (and its current self) or throws. Returns { ids, list } to append to the replacement
     * and `done(newIds)` to call with the ids the whole replacement got.
     */
    plan(ids, list, curveById, rebuild) {
        const exists = id => !!curveById(id);
        const same = ids.length === list.length;
        const next = new Map(same ? ids.map((id, i) => [id, { ...list[i], id }]) : []);
        const extra = { ids: [], list: [] }, remade = [];
        const live = this.live(exists), heads = new Map(live.map(r => [r.k, r]));
        for (const r of live) {
            if (ids.includes(r.out)) { this.list = this.list.filter(k => k !== r.k); continue; }   // edited by hand
            if (!r.ins.some(i => ids.includes(i))) continue;
            if (!same) continue;   // a curve split or joined: the constrained curve stays as it is
            let made;
            try { made = rebuild(r.ins.map(i => next.get(i) ?? curveById(i)), r.k, curveById(r.out)); } catch { continue; }
            extra.ids.push(r.out);
            extra.list.push(made);
            remade.push({ k: r.k, at: ids.length + extra.ids.length - 1 });
        }
        const done = newIds => {
            if (!same) return;
            for (const k of this.list) k.ins.forEach((chain, j) => {
                const i = ids.indexOf(heads.get(k)?.ins[j]);
                if (i >= 0) chain.push(newIds[i]);
            });
            for (const { k, at } of remade) k.out.push(newIds[at]);
        };
        return { ...extra, done };
    }

    clear() { this.list = []; }
}
