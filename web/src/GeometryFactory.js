// A port of Plasticity's GeometryFactory pattern (nkallen/plasticity src/command/GeometryFactory.ts).
//
// A factory takes parameters (a distance, a radius...) and has update(), commit() and cancel().
// update() computes a temporary preview; commit() computes the final geometry and writes it to the
// document. Because calculation is async and the user drags faster than geometry can be computed,
// the factory is a state machine: while one update is running, further requests are coalesced
// into a single "hasNext" flag so only the latest parameters are ever computed.

export class ValidationError extends Error { }
export class NoOpError extends ValidationError {
    constructor() { super("Operation has no effect") }
}

export class GeometryFactory {
    /** @param {import('./Document.js').Document} doc */
    constructor(doc) {
        this.doc = doc;
        this._state = { tag: 'none' };
        this.temps = [];
        this.phantoms = [];
        this.hidden = [];
        this.listeners = new Set();
    }

    get state() { return this._state }
    set state(state) {
        this._state = state;
        for (const l of this.listeners) l(state);
    }
    onChange(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener) }

    get done() { return this.state.tag === 'cancelled' || this.state.tag === 'committed' }

    // Subclasses implement these.
    /** @returns {Promise<{ shape: any, replaces?: string }[]>} */
    async calculate() { throw new Error("Implement calculate()") }
    /** @returns {Promise<{ shape: any, kind: "add"|"cut" }[]>} */
    async calculatePhantoms() { return [] }

    async update() {
        switch (this.state.tag) {
            case 'none':
            case 'failed':
            case 'updated': {
                const state = { tag: 'updating', hasNext: false };
                this.state = state;
                try {
                    await Promise.all([this.doPhantoms(), this.doUpdate()]);
                } catch (e) {
                    state.failed = e;
                }
                await this.continueUpdatingIfMoreWork();
                break;
            }
            case 'updating':
                // Drop the intermediate request; the latest parameters are picked up when the current job ends.
                this.state.hasNext = true;
                break;
            default:
                throw new Error('invalid state: ' + this.state.tag);
        }
    }

    async continueUpdatingIfMoreWork() {
        switch (this.state.tag) {
            case 'updating': {
                const { hasNext, failed } = this.state;
                if (failed) {
                    this.state = { tag: 'failed', error: failed };
                    if (hasNext) await this.update();
                    else this.notifyOfError(failed);
                } else {
                    this.state = { tag: 'updated' };
                    if (hasNext) await this.update();
                }
                break;
            }
            case 'cancelled':
            case 'committed':
                break;
            default:
                throw new Error('invalid state: ' + this.state.tag);
        }
    }

    notifyOfError(error) {
        for (const t of this.temps) t.visible = false;
        this.restoreHidden();
        if (!(error instanceof ValidationError)) throw error;
    }

    // Compute everything asynchronously, then swap previews synchronously to avoid flicker.
    // After every await, check whether the user cancelled or committed in the meantime.
    async doUpdate() {
        let results;
        try {
            results = await this.calculate();
        } catch (e) {
            if (e instanceof ValidationError) this.cleanupTemps();
            this.restoreHidden();
            throw e;
        }
        if (this.done) return [];

        this.restoreHidden();
        this.cleanupTemps();
        const temps = [];
        for (const { shape, replaces } of results) {
            if (replaces !== undefined) {
                const original = this.doc.get(replaces);
                if (original) { original.visible = false; this.hidden.push(original) }
            }
            temps.push(this.doc.addTemporary(shape));
        }
        return this.temps = temps;
    }

    async doPhantoms() {
        const infos = await this.calculatePhantoms();
        if (this.done) return [];
        this.cleanupPhantoms();
        return this.phantoms = infos.map(({ shape, kind }) => this.doc.addPhantom(shape, kind));
    }

    async commit() {
        switch (this.state.tag) {
            case 'none':
            case 'updated':
            case 'failed':
            case 'updating': {
                try {
                    const results = await this.calculate();
                    this.doc.checkpoint();
                    const ids = results.map(({ shape, replaces }) =>
                        replaces !== undefined ? this.doc.replaceItem(replaces, shape) : this.doc.addItem(shape));
                    this.state = { tag: 'committed' };
                    return ids;
                } catch (error) {
                    this.state = { tag: 'cancelled' };
                    throw error;
                } finally {
                    this.cleanup();
                }
            }
            default:
                throw new Error('invalid state: ' + this.state.tag);
        }
    }

    cancel() {
        if (this.state.tag === 'committed') throw new Error('invalid state: committed');
        this.cleanup();
        this.state = { tag: 'cancelled' };
    }

    cleanup() {
        this.cleanupTemps();
        this.cleanupPhantoms();
        this.restoreHidden();
    }
    cleanupTemps() { for (const t of this.temps) this.doc.removeTemporary(t); this.temps = [] }
    cleanupPhantoms() { for (const p of this.phantoms) this.doc.removeTemporary(p); this.phantoms = [] }
    restoreHidden() { for (const h of this.hidden) h.visible = true; this.hidden = [] }
}
