// The navigator in the viewport's top right, after Plasticity's (and Blender's) navigation gizmo:
// coloured balls for the axes turn with the camera; click one to look along it (click the one you
// already face to turn round), drag anywhere on the gizmo to orbit. Under it, buttons that drag to
// zoom or pan, and buttons that switch perspective and orthographic, frame the selection, and go
// home. Plain SVG and DOM, so it costs no second WebGL context.
//
// Axes are the user's: x right, y back, z up. The viewport's world has y up, so user y is world −z.

import * as THREE from 'three';
import { icon } from './icons.js';

const SIZE = 96, R = 34, BALL = 9;
const AXES = [
    { name: 'x', world: [1, 0, 0], view: ['right', 'left'] },
    { name: 'y', world: [0, 0, -1], view: ['back', 'front'] },
    { name: 'z', world: [0, 1, 0], view: ['top', 'bottom'] },
];

export class ViewGizmo {
    /**
     * `host` is the element to fill. `on` has view(name), orbit(dx, dy) in radians, pan(dx, dy) and
     * zoom(dy) in pixels, ortho(), focus() and home().
     */
    constructor(host, on) {
        this.on = on;
        host.innerHTML = `
          <div class="nav-ball" data-id="nav-ball" title="Drag to orbit · click an axis to look along it">
            <svg viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}" aria-label="View orientation">
              <circle class="nav-bg" cx="${SIZE / 2}" cy="${SIZE / 2}" r="${R + BALL + 2}"/>
              <g data-id="nav-axes"></g>
            </svg>
          </div>
          <div class="nav-buttons">
            <button data-nav="zoom" title="Drag up or down to zoom (wheel, Ctrl+middle-drag)">${icon('nav-zoom')}</button>
            <button data-nav="pan" title="Drag to pan (right-drag)">${icon('nav-pan')}</button>
            <button data-nav="ortho" aria-pressed="false" title="Perspective or orthographic (Numpad 5)">${icon('nav-persp')}</button>
            <button data-nav="focus" title="Frame the selection, or everything (/)">${icon('nav-focus')}</button>
            <button data-nav="home" title="Home: the starting view">${icon('nav-home')}</button>
          </div>`;
        this.axesEl = host.querySelector('[data-id="nav-axes"]');
        this.ball = host.querySelector('[data-id="nav-ball"]');
        this.orthoBtn = host.querySelector('[data-nav="ortho"]');
        this.facing = null;
        this.last = '';

        // Drag on the ball orbits; a press that doesn't move is a click on whatever ball is under it.
        this.dragFrom(this.ball, (dx, dy) => this.on.orbit(-dx * 0.012, -dy * 0.012), (e, moved) => {
            if (moved) return;
            const hit = e.target.closest('[data-view]');
            if (hit) this.on.view(hit.dataset.view === this.facing ? opposite(hit.dataset.view) : hit.dataset.view);
        });
        this.dragFrom(host.querySelector('[data-nav="zoom"]'), (dx, dy) => this.on.zoom(dy));
        this.dragFrom(host.querySelector('[data-nav="pan"]'), (dx, dy) => this.on.pan(dx, dy));
        this.orthoBtn.onclick = () => this.on.ortho();
        host.querySelector('[data-nav="focus"]').onclick = () => this.on.focus();
        host.querySelector('[data-nav="home"]').onclick = () => this.on.home();
    }

    /** Pointer drags on `el` call `move(dx, dy)` per step and `end(event, moved)` on release. */
    dragFrom(el, move, end) {
        el.addEventListener('pointerdown', e => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            el.setPointerCapture(e.pointerId);
            let x = e.clientX, y = e.clientY, moved = false;
            const onMove = m => {
                const dx = m.clientX - x, dy = m.clientY - y;
                if (!moved && Math.hypot(m.clientX - e.clientX, m.clientY - e.clientY) < 3) return;
                moved = true;
                x = m.clientX; y = m.clientY;
                move(dx, dy);
            };
            const onUp = u => {
                el.removeEventListener('pointermove', onMove);
                el.removeEventListener('pointerup', onUp);
                el.removeEventListener('pointercancel', onUp);
                end?.(e, moved);
                void u;
            };
            el.addEventListener('pointermove', onMove);
            el.addEventListener('pointerup', onUp);
            el.addEventListener('pointercancel', onUp);
        });
    }

    /** Turn the balls to match `camera`; cheap enough for every frame, and skipped when unchanged. */
    update(camera, ortho) {
        const q = camera.quaternion.clone().invert();
        const key = q.toArray().map(v => v.toFixed(4)).join() + ortho;
        if (key === this.last) return;
        this.last = key;
        this.orthoBtn.setAttribute('aria-pressed', ortho);
        this.orthoBtn.innerHTML = icon(ortho ? 'nav-ortho' : 'nav-persp');

        const c = SIZE / 2, balls = [];
        let best = -2;
        this.facing = null;
        for (const a of AXES) {
            for (const sign of [1, -1]) {
                const v = new THREE.Vector3(...a.world).multiplyScalar(sign).applyQuaternion(q);
                // Facing the viewer: the axis points out of the screen.
                if (v.z > best) { best = v.z; this.facing = a.view[sign > 0 ? 0 : 1]; }
                balls.push({ a, sign, x: c + v.x * R, y: c - v.y * R, z: v.z });
            }
        }
        balls.sort((p, r) => p.z - r.z);
        this.axesEl.innerHTML = balls.map(({ a, sign, x, y, z }) => {
            const view = a.view[sign > 0 ? 0 : 1];
            const dim = z < -0.2 ? ' far' : '';
            if (sign > 0) {
                return `<line class="nav-line ${a.name}${dim}" x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`
                    + `<g class="nav-axis ${a.name}${dim}" data-view="${view}"><title>${view.toUpperCase()} VIEW</title><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${BALL}"/>`
                    + `<text x="${x.toFixed(1)}" y="${(y + 3.5).toFixed(1)}">${a.name.toUpperCase()}</text></g>`;
            }
            return `<g class="nav-axis neg ${a.name}${dim}" data-view="${view}"><title>${view.toUpperCase()} VIEW</title><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${BALL - 2}"/></g>`;
        }).join('');
    }
}

const opposite = v => ({ right: 'left', left: 'right', back: 'front', front: 'back', top: 'bottom', bottom: 'top' })[v];
