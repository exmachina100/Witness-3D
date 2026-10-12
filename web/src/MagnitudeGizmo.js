import * as THREE from 'three';

// Plasticity's distance handle: a thin line from the anchor out to a yellow dot. Behaviour follows
// Plasticity's manual ("move the yellow dot to set the distance") and its gizmo state machine as
// documented by the open-source 0.6.30 (src/command/AbstractGizmo.ts):
//   - hover the dot to highlight it, drag it to change the value;
//   - or start it from the keyboard (activate): the value then follows the cursor with no button
//     held, and a click sets it;
//   - while dragging or following, typing digits, '.', '-' (a trailing '-' negates) enters the value
//     exactly, Backspace edits, Enter keeps it, Escape puts the old value back;
//   - Ctrl while dragging snaps to `step`.
// The value is a signed distance along `direction` from the anchor.

const YELLOW = 0xffd400, HOVER = 0xfff3b0;
const MIN_PX = 28; // the dot never sits closer than this to the anchor on screen, so it can be grabbed

export class MagnitudeGizmo extends THREE.Group {
    constructor(camera, dom, { step = 0.5, label = '' } = {}) {
        super();
        this.camera = camera;
        this.dom = dom;
        this.step = step;
        this.label = label;
        this.value = 0;
        this.state = 'none'; // none | hover | dragging | command
        this.text = '';
        this.onChange = () => { };
        this.onStart = () => { };
        this.onEnd = () => { };
        this.onText = () => { };

        this.mat = new THREE.MeshBasicMaterial({ color: YELLOW, depthTest: false, transparent: true });
        this.lineMat = new THREE.LineBasicMaterial({ color: YELLOW, depthTest: false, transparent: true });
        this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]), this.lineMat);
        this.knob = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), this.mat);
        this.grip = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
        this.knob.add(this.grip);
        this.add(this.line, this.knob);
        this.line.renderOrder = this.knob.renderOrder = 20;

        this.raycaster = new THREE.Raycaster();
        this._down = this.pointerDown.bind(this);
        this._move = this.pointerMove.bind(this);
        this._up = this.pointerUp.bind(this);
        this._hover = this.hover.bind(this);
        dom.addEventListener('pointerdown', this._down, true);
        dom.addEventListener('pointermove', this._hover);
    }

    dispose() {
        this.stopListening();
        this.dom.removeEventListener('pointerdown', this._down, true);
        this.dom.removeEventListener('pointermove', this._hover);
        this.removeFromParent();
    }

    /** Anchor point and direction of positive values. */
    setFrame(origin, direction) {
        this.position.copy(origin);
        this.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    }

    get direction() { return new THREE.Vector3(0, 1, 0).applyQuaternion(this.quaternion) }
    get busy() { return this.state === 'dragging' || this.state === 'command' }

    /** World units per screen pixel at the anchor. */
    unitsPerPixel() {
        const r = this.dom.getBoundingClientRect();
        if (this.camera.isOrthographicCamera) return (this.camera.top - this.camera.bottom) / this.camera.zoom / r.height;
        const d = this.camera.position.distanceTo(this.position);
        return 2 * d * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) / r.height;
    }

    /** Draw for the current value; call every frame so the dot keeps its screen size. */
    render(value = this.value) {
        this.value = value;
        const upp = this.unitsPerPixel();
        const min = MIN_PX * upp;
        const shown = Math.abs(value) < min ? (value < 0 ? -min : min) : value;
        this.knob.position.set(0, shown, 0);
        this.knob.scale.setScalar(4.5 * upp);
        const pos = this.line.geometry.attributes.position;
        pos.setXYZ(1, 0, shown, 0);
        pos.needsUpdate = true;
        this.line.geometry.computeBoundingSphere();
    }

    ray(event) {
        const r = this.dom.getBoundingClientRect();
        this.raycaster.setFromCamera(new THREE.Vector2(((event.clientX - r.left) / r.width) * 2 - 1, -((event.clientY - r.top) / r.height) * 2 + 1), this.camera);
        return this.raycaster.ray;
    }

    /** Distance along the axis of the point nearest the pointer ray. */
    axisParam(ray) {
        const o = this.getWorldPosition(new THREE.Vector3()), d = this.direction;
        const w0 = o.clone().sub(ray.origin);
        const b = d.dot(ray.direction), dd = d.dot(w0), e = ray.direction.dot(w0);
        const denom = 1 - b * b;
        if (Math.abs(denom) < 1e-6) return null;
        return (b * e - dd) / denom;
    }

    over(event) {
        this.updateMatrixWorld(true);
        this.ray(event);
        return this.raycaster.intersectObject(this.knob, true).length > 0;
    }

    hover(event) {
        if (this.busy || !this.visible) return;
        const on = this.over(event);
        if (on !== (this.state === 'hover')) {
            this.state = on ? 'hover' : 'none';
            this.mat.color.setHex(on ? HOVER : YELLOW);
            this.lineMat.color.setHex(on ? HOVER : YELLOW);
        }
    }

    pointerDown(event) {
        if (event.button !== 0 || !this.visible) return;
        if (this.state === 'command') { event.stopPropagation(); event.preventDefault(); return; }
        if (!this.over(event)) return;
        event.stopPropagation();
        event.preventDefault();
        this.begin('dragging', event);
    }

    /** Start following the cursor from the keyboard (Plasticity's D, C and the like). */
    activate(lastEvent) {
        if (this.busy) this.finish();
        this.begin('command', lastEvent);
    }

    begin(state, event) {
        this.state = state;
        this.text = '';
        this.original = this.value;
        const t = event ? this.axisParam(this.ray(event)) : null;
        this.grab = t === null ? null : t - this.value;
        this.onStart(state);
        window.addEventListener('pointermove', this._move);
        window.addEventListener('pointerup', this._up);
    }

    pointerMove(event) {
        if (!this.busy || this.text) return;
        if (this.state === 'dragging' && event.buttons === 0) return;
        const t = this.axisParam(this.ray(event));
        if (t === null) return;
        if (this.grab === null) this.grab = t - this.value;
        let v = t - this.grab;
        if (event.ctrlKey || event.metaKey) v = Math.round(v / this.step) * this.step;
        this.render(v);
        this.onChange(v);
    }

    pointerUp(event) {
        if (event.button !== 0) return;
        if (this.state === 'dragging' || this.state === 'command') this.finish();
    }

    /** Keys while dragging or following. Returns true when the key was used. */
    key(event) {
        if (!this.busy) return false;
        if (event.key === 'Escape') { this.render(this.original); this.onChange(this.original); this.finish(); return true; }
        if (event.key === 'Enter') { this.finish(); return true; }
        if (/^[0-9.\-]$/.test(event.key)) this.text += event.key;
        else if (event.key === 'Backspace') this.text = this.text.slice(0, -1);
        else return false;
        this.onText(this.text);
        const v = typed(this.text);
        if (v !== undefined) { this.render(v); this.onChange(v); }
        return true;
    }

    finish() {
        const was = this.state;
        this.stopListening();
        this.state = 'none';
        this.text = '';
        this.mat.color.setHex(YELLOW);
        this.lineMat.color.setHex(YELLOW);
        if (was === 'dragging' || was === 'command') this.onEnd();
    }

    stopListening() {
        window.removeEventListener('pointermove', this._move);
        window.removeEventListener('pointerup', this._up);
    }
}

/** A typed value: a number, where a trailing '-' negates ("4-" is -4), as in Plasticity. */
export function typed(text) {
    if (text === '' || text === '-' || text === '.') return undefined;
    const trailing = /^([0-9.]+)-$/.exec(text);
    const n = Number(trailing ? trailing[1] : text);
    if (Number.isNaN(n)) return undefined;
    return trailing ? -n : n;
}
