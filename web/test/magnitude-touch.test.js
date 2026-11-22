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
