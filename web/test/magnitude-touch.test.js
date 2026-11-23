import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { MagnitudeGizmo } from '../src/MagnitudeGizmo.js';

for (const Camera of [PerspectiveCamera, OrthographicCamera]) {
    test(`magnitude touch target stays in screen pixels with ${Camera.name}`, () => {
        const camera = Camera === PerspectiveCamera
            ? new Camera(45, 1, 0.1, 100)
            : new Camera(-10, 10, 10, -10, 0.1, 100);
        camera.position.z = 20;
        camera.updateMatrixWorld();
        const dom = new EventTarget();
        dom.getBoundingClientRect = () => ({ left: 30, top: 40, width: 400, height: 400 });
        const gizmo = new MagnitudeGizmo(camera, dom);
        gizmo.render(3);
        const point = gizmo.knob.getWorldPosition(new Vector3()).project(camera);
        const hit = (offset, pointerType) => gizmo.over({
            clientX: 30 + 200 * (1 + point.x) + offset,
            clientY: 40 + 200 * (1 - point.y),
            pointerType,
        });

        assert.equal(hit(0, 'mouse'), true);
        assert.equal(hit(14, 'mouse'), false);
        assert.equal(hit(14, 'touch'), true);
        assert.equal(hit(24, 'touch'), false);
        gizmo.visible = false;
        assert.equal(hit(0, 'touch'), false);
    });
}

test('a cancelled drag restores the original value only for its owning pointer', () => {
    const values = [];
    const gizmo = Object.assign(Object.create(MagnitudeGizmo.prototype), {
        state: 'dragging',
        original: 2,
        dragPointer: 7,
        render(value) { this.value = value; },
        onChange(value) { values.push(value); },
        finish() { this.state = 'none'; },
    });
    gizmo.pointerUp({ button: 0, pointerId: 8 });
    gizmo.pointerCancel({ pointerId: 8 });
    assert.equal(gizmo.state, 'dragging');
    assert.deepEqual(values, []);

    gizmo.pointerCancel({ pointerId: 7 });
    assert.equal(gizmo.state, 'none');
    assert.equal(gizmo.value, 2);
    assert.deepEqual(values, [2]);
});

function makeGizmo() {
    const camera = new PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.z = 20;
    camera.updateMatrixWorld();
    const dom = new EventTarget();
    dom.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400 });
    const gizmo = new MagnitudeGizmo(camera, dom);
    gizmo.render(3);
    const point = gizmo.knob.getWorldPosition(new Vector3()).project(camera);
    return { gizmo, dom, center: { clientX: 200 * (1 + point.x), clientY: 200 * (1 - point.y) } };
}

test('touch movement clears mouse hover without creating a persistent highlight', () => {
    const { gizmo, center } = makeGizmo();
    gizmo.hover({ ...center, pointerType: 'mouse' });
    assert.equal(gizmo.state, 'hover');
    gizmo.hover({ ...center, pointerType: 'touch' });
    assert.equal(gizmo.state, 'none');
});

test('touch cannot grab a handle in a collapsed viewport', () => {
    const { gizmo, dom } = makeGizmo();
    dom.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 });
    assert.equal(gizmo.over({ clientX: 0, clientY: 0, pointerType: 'touch' }), false);
});

test('pen still uses precise ray picking', () => {
    const { gizmo, center } = makeGizmo();
    assert.equal(gizmo.over({ ...center, pointerType: 'pen' }), true);
    assert.equal(gizmo.over({ ...center, clientX: center.clientX + 14, pointerType: 'pen' }), false);
});

test('unseen handles behind the camera cannot capture touch', () => {
    const { gizmo, center } = makeGizmo();
    gizmo.position.z = 30;
    assert.equal(gizmo.over({ ...center, pointerType: 'touch' }), false);
});

test('movement from a second pointer leaves the active drag value unchanged', () => {
    const { gizmo, center } = makeGizmo();
    Object.assign(gizmo, { state: 'dragging', dragPointer: 7, grab: 0 });
    gizmo.pointerMove({ ...center, pointerId: 8, buttons: 1 });
    assert.equal(gizmo.value, 3);
});

test('release from the active pointer finishes without rolling back', () => {
    const { gizmo } = makeGizmo();
    Object.assign(gizmo, { state: 'dragging', dragPointer: 7, original: 1 });
    gizmo.stopListening = () => {};
    gizmo.pointerUp({ pointerId: 7, button: 0 });
    assert.equal(gizmo.state, 'none');
    assert.equal(gizmo.value, 3);
});

test('Escape rolls back keyboard entry and ends the gesture', () => {
    const { gizmo } = makeGizmo();
    Object.assign(gizmo, { state: 'command', original: 3 });
    gizmo.stopListening = () => {};
    assert.equal(gizmo.key({ key: '8' }), true);
    assert.equal(gizmo.value, 8);
    assert.equal(gizmo.key({ key: 'Escape' }), true);
    assert.equal(gizmo.value, 3);
    assert.equal(gizmo.state, 'none');
});
