import * as THREE from 'three';

// Plasticity 2026.2's Bridge Curve gizmo has two kinds of handle (release notes: "Parameter
// handles: set the start and end points of the bridged curve"; "Sense Direction handle: controls
// the direction in which the bridged curve connects to each of the source curves"). How they look
// and move isn't documented; ours is inferred: a yellow dot that slides along its curve, and a
// white arrow at the bridge point, pointing the way the bridge leaves, that a click turns round.
// Both keep the screen size of MagnitudeGizmo's dot and answer the same state machine
// (none | hover | dragging), so the app's pointer handling treats them like its other gizmos.

const YELLOW = 0xffd400, HOVER = 0xfff3b0, WHITE = 0xf2f2f2;

/**
 * Where along a polyline (0 to 1 by length) lies the point nearest (x, y), measured on screen.
 * `screen` is the polyline's points on screen ([x, y] each), `world` the same points in space (for
 * lengths). Returns undefined for fewer than two points.
 */
export function nearestAlong(screen, world, x, y) {
    if (screen.length < 2 || world.length !== screen.length) return undefined;
    const lengths = [0];
    for (let i = 1; i < world.length; i++) lengths.push(lengths[i - 1] + world[i].distanceTo(world[i - 1]));
    const total = lengths[lengths.length - 1];
    if (!(total > 0)) return 0;
    let best = null;
    for (let i = 1; i < screen.length; i++) {
        const [ax, ay] = screen[i - 1], [bx, by] = screen[i];
        const dx = bx - ax, dy = by - ay, dd = dx * dx + dy * dy;
        const k = dd > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / dd)) : 0;
        const d = Math.hypot(ax + k * dx - x, ay + k * dy - y);
        if (!best || d < best.d) best = { d, along: lengths[i - 1] + k * (lengths[i] - lengths[i - 1]) };
    }
    return best.along / total;
}

/** The point at `t` (0 to 1 by length) along a polyline of Vector3s, and the way it runs there. */
export function pointAlong(world, t) {
    const lengths = [0];
    for (let i = 1; i < world.length; i++) lengths.push(lengths[i - 1] + world[i].distanceTo(world[i - 1]));
    const want = Math.min(1, Math.max(0, t)) * lengths[lengths.length - 1];
    let i = 1;
    while (i < world.length - 1 && lengths[i] < want) i++;
    const span = lengths[i] - lengths[i - 1], k = span > 0 ? (want - lengths[i - 1]) / span : 0;
    const tangent = world[i].clone().sub(world[i - 1]);
    return { point: world[i - 1].clone().lerp(world[i], k), tangent: tangent.lengthSq() > 0 ? tangent.normalize() : new THREE.Vector3(1, 0, 0) };
}

export class CurveHandle extends THREE.Group {
    /** `kind` 'parameter' (slides along `path`) or 'sense' (an arrow; a click calls onFlip). */
    constructor(camera, dom, { kind = 'parameter', label = '' } = {}) {
        super();
        this.camera = camera;
        this.dom = dom;
        this.kind = kind;
        this.label = label;
        this.path = [];
        this.value = 0;
        this.dir = new THREE.Vector3(1, 0, 0);
        this.state = 'none';
        this.onChange = () => { };
        this.onStart = () => { };
        this.onEnd = () => { };
        this.onFlip = () => { };
        this.color = kind === 'sense' ? WHITE : YELLOW;
        this.mat = new THREE.MeshBasicMaterial({ color: this.color, depthTest: false, transparent: true });
        if (kind === 'sense') {
            // An arrow: a short shaft and a cone, along +y, starting a little off the point.
            const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 6, 8).translate(0, 5, 0), this.mat);
            const head = new THREE.Mesh(new THREE.ConeGeometry(1.1, 3, 14).translate(0, 9.5, 0), this.mat);
            this.knob = new THREE.Group();
            this.knob.add(shaft, head);
            this.grip = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 10, 8).translate(0, 7, 0), new THREE.MeshBasicMaterial({ visible: false }));
        } else {
            this.knob = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), this.mat);
            this.grip = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
        }
        this.knob.add(this.grip);
        this.knob.traverse(o => { o.renderOrder = 21; });
        this.add(this.knob);
        this.raycaster = new THREE.Raycaster();
        this._down = this.pointerDown.bind(this);
        this._move = this.pointerMove.bind(this);
        this._up = this.pointerUp.bind(this);
        this._hover = e => { if (this.state !== 'dragging') this.setHover(e.pointerType !== 'touch' && this.over(e)); };
        this._leave = () => { if (this.state === 'hover') this.setHover(false); };
        dom.addEventListener('pointerdown', this._down, true);
        dom.addEventListener('pointermove', this._hover);
        dom.addEventListener('pointerleave', this._leave);
    }

    get busy() { return this.state === 'dragging' }

    dispose() {
        this.stopListening();
        this.dom.removeEventListener('pointerdown', this._down, true);
        this.dom.removeEventListener('pointermove', this._hover);
        this.dom.removeEventListener('pointerleave', this._leave);
        this.removeFromParent();
    }

    /** The curve it slides on (Vector3s, in order) and where along it (0 to 1 by length). */
    setPath(points, t = this.value) { this.path = points; this.render(t); }
    /** Sense: the point the arrow starts from and the way it points. */
    setArrow(point, dir) { this.position.copy(point); this.dir = dir.clone().normalize(); this.render(); }

    unitsPerPixel(at) {
        const r = this.dom.getBoundingClientRect();
        if (this.camera.isOrthographicCamera) return (this.camera.top - this.camera.bottom) / this.camera.zoom / r.height;
        return 2 * this.camera.position.distanceTo(at) * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) / r.height;
    }

    /** Draw for the value; called every frame so the handle keeps its screen size. */
    render(value = this.value) {
        this.value = value;
        if (this.kind === 'sense') {
            this.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.dir);
            this.knob.scale.setScalar(this.unitsPerPixel(this.position) * 2.6);
            return;
        }
        if (this.path.length < 2) return;
        const { point } = pointAlong(this.path, value);
        this.position.copy(point);
        this.knob.scale.setScalar(4.5 * this.unitsPerPixel(point));
    }

    screenOf(p) {
        const r = this.dom.getBoundingClientRect(), v = p.clone().project(this.camera);
        return [r.left + (v.x + 1) * r.width / 2, r.top + (1 - v.y) * r.height / 2];
    }

    over(event) {
        if (!this.visible) return false;
        this.updateMatrixWorld(true);
        if (event.pointerType !== 'touch') {
            const r = this.dom.getBoundingClientRect();
            this.raycaster.setFromCamera(new THREE.Vector2(((event.clientX - r.left) / r.width) * 2 - 1, -((event.clientY - r.top) / r.height) * 2 + 1), this.camera);
            return this.raycaster.intersectObject(this.knob, true).length > 0;
        }
        const [x, y] = this.screenOf(this.knob.getWorldPosition(new THREE.Vector3()));
        return Math.hypot(event.clientX - x, event.clientY - y) <= 18;
    }

    setHover(on) {
        if (on === (this.state === 'hover')) return;
        this.state = on ? 'hover' : 'none';
        this.mat.color.setHex(on ? HOVER : this.color);
    }

    pointerDown(event) {
        if (event.button !== 0 || !this.visible || this.state === 'dragging' || !this.over(event)) return;
        event.stopPropagation();
        event.preventDefault();
        this.state = 'dragging';
        this.dragPointer = event.pointerId;
        this.original = this.value;
        this.moved = false;
        this.onStart();
        window.addEventListener('pointermove', this._move);
        window.addEventListener('pointerup', this._up);
    }

    pointerMove(event) {
        if (this.state !== 'dragging' || event.pointerId !== this.dragPointer || this.kind === 'sense') return;
        const t = nearestAlong(this.path.map(p => this.screenOf(p)), this.path, event.clientX, event.clientY);
        if (t === undefined) return;
        this.moved = true;
        this.render(t);
        this.onChange(t);
    }

    pointerUp(event) {
        if (event.pointerId !== this.dragPointer || event.button !== 0) return;
        this.stopListening();
        this.state = 'none';
        this.mat.color.setHex(this.color);
        if (this.kind === 'sense' && this.over(event)) this.onFlip();
        this.onEnd();
    }

    stopListening() {
        window.removeEventListener('pointermove', this._move);
        window.removeEventListener('pointerup', this._up);
    }
}
