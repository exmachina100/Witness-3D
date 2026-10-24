// Reference images (web/src/app/images.js).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkImage, imageLook, newImage } from '../src/app/images.js';

const png = 'data:image/png;base64,iVBORw0KGgo=';

test('a new image is whole and drawn as an ordinary face', () => {
    const m = newImage(1, 'front.png', png, 0.5, { origin: [1, 2, 3] });
    assert.deepEqual(checkImage(m), []);
    assert.equal(m.width, 100);
    assert.deepEqual(imageLook(m), { depthTest: true, depthWrite: true, transparent: false, opacity: 1, double: true, order: 0 });
});

test('bad stored images are caught', () => {
    const m = newImage(2, 'x', png, 1);
    assert.deepEqual(checkImage({ ...m, src: 'javascript:alert(1)' }), ['picture']);
    assert.deepEqual(checkImage({ ...m, opacity: 2, depth: 'top' }), ['opacity', 'depth']);
    assert.deepEqual(checkImage(null).length > 0, true);
});

test('Front always shows and sees through; Behind stays behind the model', () => {
    const m = newImage(3, 'x', png, 1);
    const front = imageLook({ ...m, depth: 'front' });
    assert.equal(front.depthTest, false);
    assert.ok(front.opacity < 1 && front.order > 0);
    const behind = imageLook({ ...m, depth: 'behind', culling: 'front' });
    assert.equal(behind.depthWrite, false);
    assert.ok(behind.order < 0);
    assert.equal(behind.double, false);
    const faint = imageLook({ ...m, opacity: 0.4 });
    assert.equal(faint.transparent, true);
    assert.equal(faint.depthWrite, false);
});
