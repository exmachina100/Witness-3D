// The tool rail, grouped the way Plasticity's manual groups its tools: one button per family (Curves
// and Lines, Circles, Arcs, …) showing the variant used last. Pressing a button and dragging onto a
// variant in the strip that opens beside it runs that variant on release; a plain click runs the
// family's last-used tool; right-click or the corner mark opens the strip too. The choice is
// remembered on this browser.

/**
 * The families, top to bottom: the manual's Sketching tools (Curves and Lines, Circles, Arcs,
 * Rectangles, Polygon and Spiral), its 3D Primitives and its Measurement tools. The common commands
 * live on the Command Bar at the bottom (App.js `BAR`); every other command is reached the way
 * Plasticity reaches it, by its key, the F palette or Shift+F suggestions. `items` are command ids;
 * the first is the default face.
 */
export const FAMILIES = [
    { id: 'curve', label: 'CURVES AND LINES', items: ['line', 'spline', 'cv', 'bridge', 'split', 'insert-knot', 'trim'] },
    { id: 'circle', label: 'CIRCLES', items: ['circle', 'circle2', 'circle3', 'tangent-circle', 'ellipse', 'ellipse3'] },
    { id: 'arc', label: 'ARCS', items: ['arc3', 'arc', 'tangent-arc'] },
    { id: 'rect', label: 'RECTANGLES', items: ['rect', 'center-rect', 'rect3'] },
    { id: 'polygon', label: 'POLYGON · SPIRAL', items: ['polygon', 'spiral', 'slot'] },
    { id: 'box', label: '3D PRIMITIVES', items: ['box', 'center-box', 'box3', 'cylinder', 'sphere'] },
    { id: 'measure', label: 'MEASUREMENT', items: ['measure-distance', 'measure-radius', 'measure-continuity', 'view-curvature'] },
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
            // Press and hold (or press and drag off the button) opens the strip; releasing over one of
            // its variants runs it, as Plasticity's tool buttons do.
            face.addEventListener('pointerdown', e => {
                if (e.button !== 0 || fam.items.length < 2) return;
                held = false;
                const openNow = () => { if (held) return; clearTimeout(timer); held = true; this.open(fam, el); this.dragging = true; };
                timer = setTimeout(openNow, HOLD_MS);
                const away = m => { if (Math.hypot(m.clientX - e.clientX, m.clientY - e.clientY) > 6) { removeEventListener('pointermove', away); openNow(); } };
                addEventListener('pointermove', away);
                addEventListener('pointerup', u => {
                    clearTimeout(timer);
                    removeEventListener('pointermove', away);
                    if (!this.dragging) return;
                    this.dragging = false;
                    const b = document.elementFromPoint(u.clientX, u.clientY)?.closest?.('[data-pick]');
                    if (b && this.strip.contains(b)) { this.close(); this.pick(fam.id, b.dataset.pick); }
                }, { once: true });
            });
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

    /** Draw every family's button again (after the keymap changes, so tooltips show the new keys). */
    repaint() { for (const f of FAMILIES) this.paint(f.id); }

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
        const h = this.strip.offsetHeight;
        this.strip.style.left = `${Math.max(8, Math.min(r.right + 4, innerWidth - w - 8))}px`;
        this.strip.style.top = `${Math.max(8, Math.min(r.top, innerHeight - h - 8))}px`;
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
