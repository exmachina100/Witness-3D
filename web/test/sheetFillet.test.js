// Bridge Surface between two crossing sheets in the browser build (src/sheetFillet.js).
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { loadKernel, numbered, planeSheet } from '../src/Kernel.js';
import { sheetFillet, trimWalls } from '../src/sheetFillet.js';

before(async () => { await loadKernel() });

const faces = s => numbered(s, 'TopAbs_FACE').length;
// A 20 × 20 sheet in z = 0 crossed by one in x = 3: the larger piece of the first is 13 long.
const crossing = () => [planeSheet([0, 0, 0], [0, 0, 1], 10), planeSheet([3, 0, 0], [1, 0, 0], 10)];

test('a round or chamfer 2 wide where the sheets cross, the larger piece of each kept', () => {
    for (const shape of ['g2', 'chamfer']) {
        const [a, b] = crossing();
        const r = sheetFillet(a, b, { width: 2, shape });
        assert.equal(faces(r.bridge), 1);
        assert.ok(Math.abs(r.aArea - 11 * 20) < 1e-6 && Math.abs(r.bArea - 8 * 20) < 1e-6, `${r.aArea} ${r.bArea} (${shape})`);
        // Sense 1 keeps the first sheet's other, 7 long, piece.
        const s = sheetFillet(a, b, { width: 2, shape, sense: [true, false] });
        assert.ok(Math.abs(s.aArea - 5 * 20) < 1e-6, `${s.aArea}`);
    }
});

test('trim walls: both joins all, short and long trim one, none adds the bridge alone', () => {
    const [a, b] = crossing();
    const r = sheetFillet(a, b, { width: 2 });
    const both = trimWalls(a, b, r, 'both');
    assert.equal(faces(both.a), 3); assert.equal(both.b, null); assert.equal(both.bridge, null);
    const short = trimWalls(a, b, r, 'short');
    assert.equal(short.a, a); assert.equal(faces(short.b), 2);
    const long = trimWalls(a, b, r, 'long');
    assert.equal(faces(long.a), 2); assert.equal(long.b, b);
    const none = trimWalls(a, b, r, 'none');
    assert.equal(none.a, a); assert.equal(none.b, b); assert.equal(faces(none.bridge), 1);
});

test('sheets apart are refused, and the backend commits in one undo step', async () => {
    assert.throws(() => sheetFillet(planeSheet([0, 0, 0], [0, 0, 1], 10), planeSheet([30, 0, 0], [1, 0, 0], 10), { width: 2 }), /do not cross/);
    const be = new LocalBackend();
    const [a, b] = crossing();
    be.put(101, a); be.put(102, b);
    const before = be.shapes.size;
    const p = await be.previewSheetBridge({ a: 101, b: 102, width: 2, trim: 'none' });
    assert.ok(p.positions.length > 0);
    const { id } = await be.commitSheetBridge({ a: 101, b: 102, width: 2, trim: 'both' });
    assert.equal(id, 101);
    assert.equal(be.shapes.size, before - 1);
    await be.undo();
    assert.equal(be.shapes.size, before);
});
