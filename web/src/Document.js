import * as THREE from 'three';
import { tessellate } from './Kernel.js';

// The scene database the factories write to. Plays the role of Plasticity's GeometryDatabase
// (src/editor/GeometryDatabase.ts) plus History mementos (src/editor/History.ts): each body is an
// exact OpenCascade shape, shown through its tessellation and its true B-rep edges. Every commit
// takes a snapshot so undo/redo restore the whole document.

export const materials = {
    body: new THREE.MeshStandardMaterial({ color: 0xd9d6cf, roughness: 0.55, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
    temp: new THREE.MeshStandardMaterial({ color: 0xd9d6cf, roughness: 0.55, metalness: 0.05, emissive: 0x2a1405, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
    // Phantom colors follow Plasticity: blue for union/new, red for difference (BooleanFactory.ts:83-85).
    add: new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.18, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    cut: new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.22, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    edge: new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }),
};

function view(shape, material) {
    const { mesh: geometry, edges } = tessellate(shape);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.shape = shape;
    mesh.add(new THREE.LineSegments(edges, materials.edge));
    return mesh;
}

export class Document {
    constructor() {
        this.root = new THREE.Group();
        this.bodies = new THREE.Group();
        this.temporaries = new THREE.Group();
        this.root.add(this.bodies, this.temporaries);
        this.items = new Map();
        this.nextId = 1;
        this.undoStack = [];
        this.redoStack = [];
        this.listeners = new Set();
    }

    onChange(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
    emit() { for (const l of this.listeners) l() }

    get(id) { return this.items.get(id) }
    shape(id) { return this.items.get(id)?.userData.shape }
    get ids() { return [...this.items.keys()] }

    addItem(shape, id = `body-${this.nextId++}`) {
        const mesh = view(shape, materials.body);
        mesh.name = id;
        mesh.userData.id = id;
        this.items.set(id, mesh);
        this.bodies.add(mesh);
        this.emit();
        return id;
    }

    replaceItem(id, shape) {
        const old = this.items.get(id);
        if (!old) throw new Error(`No item ${id}`);
        this.bodies.remove(old);
        this.items.delete(id);
        return this.addItem(shape, id);
    }

    removeItem(id) {
        const mesh = this.items.get(id);
        if (!mesh) return;
        this.bodies.remove(mesh);
        this.items.delete(id);
        this.emit();
    }

    addTemporary(shape) {
        const mesh = view(shape, materials.temp);
        this.temporaries.add(mesh);
        return mesh;
    }

    addPhantom(shape, kind) {
        const { mesh: geometry } = tessellate(shape);
        const mesh = new THREE.Mesh(geometry, kind === 'cut' ? materials.cut : materials.add);
        mesh.renderOrder = 2;
        this.temporaries.add(mesh);
        return mesh;
    }

    removeTemporary(mesh) { this.temporaries.remove(mesh) }

    snapshot() {
        return { nextId: this.nextId, items: [...this.items].map(([id, m]) => [id, m.userData.shape]) };
    }

    restore({ nextId, items }) {
        for (const id of [...this.items.keys()]) this.removeItem(id);
        for (const [id, shape] of items) this.addItem(shape, id);
        this.nextId = nextId;
        this.emit();
    }

    checkpoint() {
        this.undoStack.push(this.snapshot());
        this.redoStack = [];
    }

    undo() {
        const memento = this.undoStack.pop();
        if (!memento) return false;
        this.redoStack.push(this.snapshot());
        this.restore(memento);
        return true;
    }

    redo() {
        const memento = this.redoStack.pop();
        if (!memento) return false;
        this.undoStack.push(this.snapshot());
        this.restore(memento);
        return true;
    }
}
