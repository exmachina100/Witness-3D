// The toolbar, grouped the way Plasticity groups its tools: one button per family (Rectangle,
// Circle, Arc, Box, …) showing the variant used last, with a strip of the family's other variants that
// opens from the ▾ next to it, by right-clicking the button, or by holding it down. Picking a variant
// runs it and makes it the family's face; the choice is remembered on this browser.

/**
 * The families, in toolbar order: the manual's Sketching and Primitive Tools, and nothing else. The
 * common commands live on the Command Bar at the bottom (App.js `BAR`); every other command is
 * reached the way Plasticity reaches it, by its key, the F palette or Shift+F suggestions.
 * `items` are command ids; the first is the default face.
 */
export const FAMILIES = [
    { id: 'line', items: ['line'] },
    { id: 'curve', label: 'CURVE', items: ['spline', 'cv'] },
    { id: 'rect', label: 'RECTANGLE', items: ['rect', 'center-rect', 'rect3'] },
    { id: 'circle', label: 'CIRCLE', items: ['circle', 'circle2', 'circle3', 'tangent-circle'] },
    { id: 'arc', label: 'ARC', items: ['arc3', 'arc', 'tangent-arc'] },
    { id: 'ellipse', label: 'ELLIPSE', items: ['ellipse', 'ellipse3'] },
    { id: 'polygon', label: 'POLYGON · SPIRAL', items: ['polygon', 'spiral'] },
    { id: 'box', label: 'BOX', items: ['box', 'center-box', 'box3'] },
    { id: 'cylinder', items: ['cylinder'] },
    { id: 'sphere', items: ['sphere'] },
    { id: 'measure', label: 'MEASURE', items: ['measure-distance', 'measure-radius', 'measure-continuity'] },
];

const HOLD_MS = 350;
const memory = {
    get(k) { try { return localStorage.getItem(`w3d.toolbar.${k}`) } catch { return null } },
    set(k, v) { try { localStorage.setItem(`w3d.toolbar.${k}`, v) } catch { /* private window: forget */ } },
};

export class Toolbar {
    /**
     * `nav` is the element to fill; `host` holds the floating strip. `meta(id)` gives { name, key, icon }
     * for a command, and `run(id)` starts it.
     */
    constructor(nav, host, meta, run) {
        this.meta = meta;
        this.run = run;
        this.face = {};
        for (const f of FAMILIES) {
            const saved = memory.get(f.id);
            this.face[f.id] = f.items.includes(saved) ? saved : f.items[0];
        }
        nav.innerHTML = FAMILIES.map(f => `<div class="family${f.items.length > 1 ? ' multi' : ''}" data-family="${f.id}">`
            + `<button class="tool" data-face aria-pressed="false"></button>`
            + (f.items.length > 1 ? `<button class="more" data-more aria-label="More ${(f.label ?? '').toLowerCase()} tools" aria-haspopup="menu" aria-expanded="false" title="${f.label}: more ways">▾</button>` : '')
            + '</div>').join('');
        this.strip = document.createElement('div');
        this.strip.className = 'flyout';
        this.strip.setAttribute('role', 'menu');
        this.strip.hidden = true;
        host.append(this.strip);
        this.nav = nav;
        for (const f of FAMILIES) this.paint(f.id);

        for (const el of nav.querySelectorAll('.family')) {
            const fam = FAMILIES.find(f => f.id === el.dataset.family), face = el.querySelector('[data-face]');
            let timer = null, held = false;
            face.addEventListener('pointerdown', e => {
                if (e.button !== 0 || fam.items.length < 2) return;
                held = false;
                timer = setTimeout(() => { held = true; this.open(fam, el); }, HOLD_MS);
            });
            const cancel = () => clearTimeout(timer);
            face.addEventListener('pointerup', cancel);
            face.addEventListener('pointerleave', cancel);
            face.addEventListener('click', e => { if (held) { e.preventDefault(); held = false; return; } this.close(); this.run(this.face[fam.id]); });
            face.addEventListener('contextmenu', e => { if (fam.items.length < 2) return; e.preventDefault(); this.open(fam, el); });
            el.querySelector('[data-more]')?.addEventListener('click', () => this.strip.hidden || this.openFor !== fam.id ? this.open(fam, el) : this.close());
        }
        this.strip.addEventListener('click', e => {
            const b = e.target.closest('[data-pick]');
            if (!b) return;
            const fam = FAMILIES.find(f => f.id === this.openFor);
            this.close();
            this.pick(fam.id, b.dataset.pick);
        });
        addEventListener('pointerdown', e => { if (!this.strip.hidden && !this.strip.contains(e.target) && !e.target.closest?.('[data-more]')) this.close(); }, true);
        addEventListener('keydown', e => { if (e.key === 'Escape' && !this.strip.hidden) { e.stopPropagation(); this.close(); } }, true);
    }

    /** Draw a family's button from its current face. */
    paint(famId) {
        const id = this.face[famId], m = this.meta(id), fam = FAMILIES.find(f => f.id === famId);
        const face = this.nav.querySelector(`[data-family="${famId}"] [data-face]`);
        face.dataset.tool = id;
        face.setAttribute('aria-label', m.name);
        face.title = `${m.name}${m.key ? ` (${m.key})` : ''}${fam.items.length > 1 ? ' · right-click or hold for more' : ''}`;
        face.innerHTML = `${m.icon}${m.key ? `<kbd>${m.key}</kbd>` : ''}<span class="lbl">${m.name}</span>`;
    }

    /** Make `id` the face of family `famId` and run it. */
    pick(famId, id) {
        this.face[famId] = id;
        memory.set(famId, id);
        this.paint(famId);
        this.run(id);
    }

    open(fam, el) {
        this.openFor = fam.id;
        this.strip.innerHTML = `<div class="flyout-title">${fam.label}</div>` + fam.items.map(id => {
            const m = this.meta(id);
            return `<button role="menuitem" data-pick="${id}" aria-current="${id === this.face[fam.id]}">${m.icon}<span>${m.name}</span><kbd>${m.key ?? ''}</kbd></button>`;
        }).join('');
        const r = el.getBoundingClientRect();
        this.strip.hidden = false;
        const w = this.strip.offsetWidth;
        this.strip.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
        this.strip.style.top = `${r.bottom + 4}px`;
        el.querySelector('[data-more]')?.setAttribute('aria-expanded', 'true');
        this.strip.querySelector('[aria-current="true"]')?.focus();
    }

    close() {
        this.strip.hidden = true;
        for (const b of this.nav.querySelectorAll('[data-more]')) b.setAttribute('aria-expanded', 'false');
        this.openFor = null;
    }

    /** Light up the family of the running command (whichever way it was started), and make it the face. */
    setActive(id) {
        for (const f of FAMILIES) {
            const on = !!id && f.items.includes(id);
            if (on && this.face[f.id] !== id) { this.face[f.id] = id; memory.set(f.id, id); this.paint(f.id); }
            this.nav.querySelector(`[data-family="${f.id}"] [data-face]`).setAttribute('aria-pressed', on);
        }
    }
}
