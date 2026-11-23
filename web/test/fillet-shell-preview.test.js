import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blendEdges, box, facePlane, filletShell, loadKernel, numberedEdges, oc, shellFaces, volume } from '../src/Kernel.js';
import { LocalBackend } from '../src/app/LocalBackend.js';

test('Fillet Shell preview forwards only the shape to the viewport body builder', async () => {
    const request = { body: 7 };
    const shape = {};
    const history = {};
    const preview = {};
    const backend = Object.create(LocalBackend.prototype);
    backend.latest = work => work();
    backend.filletShell = options => {
        assert.equal(options, request);
        return { shape, history };
    };
    backend.body = (id, result) => {
        assert.equal(id, request.body);
        assert.equal(result, shape);
        return preview;
    };

    assert.equal(await backend.previewFilletShell(request), preview);
});

test('Fillet Shell starts from the same validated open shell as Shell', async () => {
    await loadKernel();
    const solid = box({ x: 0, y: 0, z: 0 }, { x: 12, y: 12, z: 12 });
    const expected = shellFaces(solid, [0], 1);
    const result = filletShell(solid, [0], [], [], 1, 1);
    assert.ok(volume(result.shape) < volume(solid));
    assert.equal(volume(result.shape), volume(expected.shape));
    assert.deepEqual(result.history, expected.history);
    assert.throws(() => filletShell(solid, [99], [], [], 1, 1), /face in the selection/);
});

test('Fillet Shell builds a valid round at a three-edge outer corner', async () => {
    await loadKernel();
    const o = oc();
    const solid = box({ x: 0, y: 0, z: 0 }, { x: 12, y: 12, z: 12 });
    const opening = facePlane(solid, 0).normal;
    const corner = [opening.x > 0.5 ? 0 : 12, opening.y > 0.5 ? 0 : 12, opening.z > 0.5 ? 0 : 12];
    const shell = shellFaces(solid, [0], 1);
    const open = shell.shape;
    const atCorner = p => Math.hypot(p.X() - corner[0], p.Y() - corner[1], p.Z() - corner[2]) < 1e-6;
    const edges = numberedEdges(open).flatMap((edge, index) => {
        const curve = new o.BRepAdaptor_Curve(edge);
        return atCorner(curve.Value(curve.FirstParameter())) || atCorner(curve.Value(curve.LastParameter())) ? [index] : [];
    });
    assert.equal(edges.length, 3);
    const innerCorner = corner.map(v => v === 0 ? 1 : 11);
    const inner = numberedEdges(open).flatMap((edge, index) => {
        const curve = new o.BRepAdaptor_Curve(edge);
        const atInner = p => Math.hypot(p.X() - innerCorner[0], p.Y() - innerCorner[1], p.Z() - innerCorner[2]) < 1e-6;
        return atInner(curve.Value(curve.FirstParameter())) || atInner(curve.Value(curve.LastParameter())) ? [index] : [];
    });
    assert.equal(inner.length, 3);
    const mixed = filletShell(solid, [0], edges, inner, 1, 0.25);
    const blend = blendEdges(open, [...edges, ...inner], 0.25, false, true);
    for (const kind of ['faces', 'edges']) {
        const expected = shell.history[kind][0].flatMap(([original, intermediate]) =>
            blend.history[kind][0].filter(([from]) => from === intermediate)
                .map(([, final]) => [original, final]));
        assert.ok(expected.length > 0);
        assert.deepEqual(mixed.history[kind], [expected, []]);
    }
    assert.ok(new o.BRepCheck_Analyzer(mixed.shape, true, false, false).IsValid());
    for (const edge of [...edges, ...inner]) assert.ok(mixed.history.generatedFaces.some(([source]) => source === edge));
    const chordal = filletShell(solid, [0], edges, [], 1, 0.4, [], [], 'chordal');
    const equivalentRound = filletShell(solid, [0], edges, [], 1, 0.4 / Math.sqrt(2));
    assert.ok(Math.abs(volume(chordal.shape) - volume(equivalentRound.shape)) < 1e-6);
    const { shape, history } = filletShell(solid, [0], edges, [], 1, 0.4);
    assert.ok(new o.BRepCheck_Analyzer(shape, true, false, false).IsValid());
    assert.ok(volume(shape) < volume(open));
    for (const edge of edges) assert.ok(history.generatedFaces.some(([source]) => source === edge));
});

test('Fillet Shell fails explicitly for profiles that do not have a kernel implementation', () => {
    for (const profile of ['conic', 'g2']) {
        assert.throws(() => filletShell(null, [], [], [], 1, 1, [], [], profile), /supports round and chordal blends only/);
    }
});
