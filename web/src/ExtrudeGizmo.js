import * as THREE from 'three';

// A drag handle for the extrude distance, modeled on Plasticity's ExtrudeGizmo / DistanceGizmo
// (src/commands/extrude/ExtrudeGizmo.ts). The arrow sits on the sketch and points along its normal;
// dragging projects the pointer ray onto that axis, so the distance follows the cursor from any view.
// Holding Ctrl snaps to `step` increments, like Plasticity's gizmo snapping.

export class ExtrudeGizmo extends THREE.Group {
    constructor(camera, dom, { step = 0.25 } = {}) {
        super();
        this.camera = camera;
        this.dom = dom;
        this.step = step;
        this.value = 0;
        this.onChange = () => { };
        this.onDragStart = () => { };
        this.onDragEnd = () => { };

        const color = 0xff4d00;
        const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true });
        this.handle = new THREE.Group();
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 8).translate(0, 0.5, 0), mat);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.28, 20).translate(0, 1.1, 0), mat);
        const grip = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8).translate(0, 1.1, 0),
            new THREE.MeshBasicMaterial({ visible: false }));
        this.handle.add(shaft, tip, grip);
        this.picker = grip;
        this.add(this.handle);
        for (const o of [shaft, tip]) o.renderOrder = 10;

        this.raycaster = new THREE.Raycaster();
        this.dragging = false;
        this.grabOffset = 0;
        this._down = this.pointerDown.bind(this);
        this._move = this.pointerMove.bind(this);
        this._up = this.pointerUp.bind(this);
        dom.addEventListener('pointerdown', this._down, true);
    }

    dispose() {
        this.dom.removeEventListener('pointerdown', this._down, true);
        window.removeEventListener('pointermove', this._move);
        window.removeEventListener('pointerup', this._up);
        this.removeFromParent();
    }

    get axis() { return new THREE.Vector3(0, 1, 0).applyQuaternion(this.quaternion).normalize() }

    render(value) {
        this.value = value;
        // The arrow stays a fixed length above the extruded cap; it flips when cutting.
        const s = value >= 0 ? 1 : -1;
        this.handle.position.set(0, value / this.scale.y, 0);
        this.handle.scale.set(1, s, 1);
    }

    ray(event) {
        const r = this.dom.getBoundingClientRect();
        const ndc = new THREE.Vector2(((event.clientX - r.left) / r.width) * 2 - 1, -((event.clientY - r.top) / r.height) * 2 + 1);
        this.raycaster.setFromCamera(ndc, this.camera);
        return this.raycaster.ray;
    }

    // Parameter t along the gizmo axis of the point closest to the pointer ray.
    axisParam(ray) {
        const o = this.getWorldPosition(new THREE.Vector3());
        const d = this.axis;
        const w0 = o.clone().sub(ray.origin);
        const b = d.dot(ray.direction), dd = d.dot(w0), e = ray.direction.dot(w0);
        const denom = 1 - b * b;
        if (Math.abs(denom) < 1e-6) return this.value;
        return (b * e - dd) / denom;
    }

    pointerDown(event) {
        if (event.button !== 0) return;
        this.updateMatrixWorld(true);
        const hits = this.ray(event).clone();
        this.raycaster.ray.copy(hits);
        if (this.raycaster.intersectObject(this.handle, true).length === 0) return;
        event.stopPropagation();
        event.preventDefault();
        this.dragging = true;
        this.grabOffset = this.axisParam(hits) - this.value;
        this.onDragStart();
        window.addEventListener('pointermove', this._move);
        window.addEventListener('pointerup', this._up);
    }

    pointerMove(event) {
        if (!this.dragging) return;
        let value = this.axisParam(this.ray(event)) - this.grabOffset;
        if (event.ctrlKey || event.metaKey) value = Math.round(value / this.step) * this.step;
        this.render(value);
        this.onChange(value);
    }

    pointerUp() {
        this.dragging = false;
        window.removeEventListener('pointermove', this._move);
        window.removeEventListener('pointerup', this._up);
        this.onDragEnd();
    }
}
