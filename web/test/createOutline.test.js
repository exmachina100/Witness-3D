// Create Outline (createOutline.js): the flat outline lifted back onto the body.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { liftPiece, liftPoint, meshSilhouette, nearestOver } from '../src/createOutline.js';

const up = [0, 1, 0];
const round = a => JSON.parse(JSON.stringify(a, (k, v) => typeof v === 'number' ? +v.toFixed(6) + 0 : v));
// A flat line piece on the ground from a to b (as Project Outline returns: a degree-1 NURBS).
const line = (a, b) => ({ origin: a, x: [b[0] - a[0], 0, b[2] - a[2]], normal: up, kind: 'nurbs', degree: 1, poles: [[0, 0, 0], [Math.hypot(b[0] - a[0], b[2] - a[2]), 0, 0]], weights: [1, 1], knots: [0, 0, 1, 1] });

test('a point under an edge lifts onto the highest edge above it', () => {
    const edges = [[[0, 0, 0], [10, 0, 0]], [[0, 30, 0], [10, 30, 0]]];
    assert.deepEqual(round(liftPoint([4, 0, 0], { normal: up, edges, tol: 1e-3 })), [4, 30, 0]);
    assert.equal(liftPoint([4, 0, 5], { normal: up, edges, tol: 1e-3 }), null);
});

test("a box's outline piece comes back as its top edge", () => {
    const edges = [[[-40, 0, 25], [40, 0, 25]], [[-40, 30, 25], [40, 30, 25]]];
    const [c] = liftPiece(line([-40, 0, 25], [40, 0, 25]), { normal: up, edges, tol: 1e-3 });
    assert.equal(c.kind, 'polyline');
    assert.ok(Math.abs(c.origin[1] - 30) < 1e-9);
    assert.ok(Math.abs(Math.abs(c.points[1][0] - c.points[0][0]) - 80) < 1e-9);
    assert.equal(c.points.length, 2);
});

test('a silhouette off the edges is found by the ray cast, in 3D when it is not flat', () => {
    // A surface whose height rises along the outline: y = x / 2 over z <= 0.
    const cast = (from, dir) => from[2] <= 1e-9 ? [from[0], from[0] / 2, from[2]] : null;
    const [c] = liftPiece(line([0, 0, 0], [10, 0, 0]), { normal: up, edges: [], cast, tol: 1e-3 });
    assert.equal(c.kind, 'polyline');
    // Flat in its own (tilted) plane, from (0,0,0) to (10,5,0).
    assert.ok(Math.abs(Math.abs(c.points[1][0] - c.points[0][0]) - Math.hypot(10, 5)) < 1e-6);
    // A wavy rise over a straight outline stands in the upright plane: a spline.
    const wave = from => from[2] <= 1e-9 ? [from[0], Math.sin(from[0]), from[2]] : null;
    const [w] = liftPiece(line([0, 0, 0], [10, 0, 0]), { normal: up, edges: [], cast: wave, tol: 1e-3 });
    assert.equal(w.kind, 'spline');
    // A rise round a bend is not flat: a 3D polyline.
    const bend = Array.from({ length: 33 }, (_, i) => { const t = i / 32 * Math.PI / 2; return [10 * Math.cos(t), -10 * Math.sin(t), 0]; });
    const piece = { origin: [0, 0, 0], x: [1, 0, 0], normal: up, kind: 'nurbs', degree: 1, poles: bend, weights: bend.map(() => 1), knots: [0, ...bend.map((_, i) => i / 32), 1] };
    const rise = from => [from[0], Math.atan2(from[2], from[0]) * 5, from[2]];
    const [h] = liftPiece(piece, { normal: up, edges: [], cast: rise, tol: 1e-3 });
    assert.equal(h.kind, 'nurbs');
    assert.equal(h.degree, 1);
    assert.ok(h.poles.length > 2);
    // Heights that only wobble (a mesh's facets) within `loose` come back level, a flat curve.
    const wobble = from => [from[0], 3 + 0.01 * Math.sin(40 * from[0]), from[2]];
    const [l] = liftPiece(piece, { normal: up, edges: [], cast: wobble, tol: 1e-3, loose: 0.05 });
    assert.equal(l.kind, 'spline');
    assert.deepEqual(l.normal, up);
    assert.ok(Math.abs(l.origin[1] - 3) < 0.011);
});

test("a box's whole outline loop comes back as its top rectangle, corners kept", () => {
    // The flat loop on the ground round the box (-40..40, -25..25), as one degree-1 NURBS.
    const loop = [[-40, 25], [40, 25], [40, -25], [-40, -25], [-40, 25]];
    const poles = loop.map(([x, z]) => [x + 40, -(z - 25), 0]);
    const t = [0, 0.3, 0.5, 0.8, 1];
    const piece = { origin: [-40, 0, 25], x: [1, 0, 0], normal: up, kind: 'nurbs', degree: 1, poles, weights: poles.map(() => 1), knots: [0, ...t, 1] };
    const box = [[-40, 25], [40, 25], [40, -25], [-40, -25]];
    const edges = box.flatMap(([x, z], i) => { const [x2, z2] = box[(i + 1) % 4]; return [[[x, 0, z], [x2, 0, z2]], [[x, 30, z], [x2, 30, z2]]]; });
    const out = liftPiece(piece, { normal: up, edges, tol: 1e-3 });
    assert.equal(out.length, 1);
    assert.equal(out[0].kind, 'polyline');
    assert.equal(out[0].closed, true);
    assert.equal(out[0].points.length, 4);
    assert.ok(Math.abs(out[0].origin[1] - 30) < 1e-9);
});

test("a mesh's silhouette is where its triangles turn from facing up to facing down", () => {
    // A ridge from (0,1,0) to (1,1,0): one triangle behind it facing up, one in front facing down.
    const tris = [0, 1, 0, 1, 1, 0, 0, 1, -1, /* down */ 0, 1, 0, 1, 1, 0, 0, 0, 1];
    const rim = meshSilhouette(tris, up);
    assert.ok(rim.length >= 1);
    // The ridge from (0,1,0) to (1,1,0) is shared by an up and a down triangle.
    assert.ok(rim.some(([a, b]) => a[1] === 1 && b[1] === 1 && a[2] === 0 && b[2] === 0));
    // Over (0.5, 0, 0) the nearest silhouette is the ridge, at height 1.
    const q = nearestOver([0.5, 0, 0], rim.filter(([a, b]) => a[2] === 0 && b[2] === 0), up, 1e-3);
    assert.deepEqual(round(q), [0.5, 1, 0]);
});
