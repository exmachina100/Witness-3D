import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOUNDARY, byLength, orderLoop, square, surfaceAt } from '../src/square.js';

const arc = (f, n = 40) => Array.from({ length: n + 1 }, (_, i) => f(i / n));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// Four sides of a saddle-ish frame: straight bottom and top, bowed left and right.
const bottom = arc(t => [20 * t, 0, 0]);
const right = arc(t => [20 + 3 * Math.sin(Math.PI * t), 4 * Math.sin(Math.PI * t), 10 * t]);
const top = arc(t => [20 * (1 - t), 0, 10]);
const left = arc(t => [-3 * Math.sin(Math.PI * t), -4 * Math.sin(Math.PI * t), 10 * (1 - t)]);

test('sides given in any order and direction are put round the loop', () => {
    const loop = orderLoop([bottom, [...top].reverse(), left, right], 0.01);
    for (let i = 0; i < 4; i++) assert.ok(dist(loop[i].at(-1), loop[(i + 1) % 4][0]) < 1e-9);
    assert.throws(() => orderLoop([bottom, right, top, left.map(p => [p[0], p[1] + 1, p[2]])], 0.01), /meet|close/);
});

test('four sides fill with a sheet whose sides follow them within tolerance', () => {
    const s = square([right, bottom, left, [...top].reverse()], { tolerance: 0.01 });
    assert.ok(s.gap <= 0.01, `gap ${s.gap}`);
    // Every point of every side has the sheet near it.
    const grid = [];
    for (let i = 0; i <= 100; i++) for (const v of [0, 1]) { grid.push(surfaceAt(s, i / 100, v)); grid.push(surfaceAt(s, v, i / 100)); }
    for (const p of [...bottom, ...right, ...top, ...left]) assert.ok(Math.min(...grid.map(q => dist(p, q))) < 0.15);
});

test('chosen degree and spans are kept', () => {
    const s = square([bottom, right, top, left], { degree: 5, spans: [3, 2] });
    assert.deepEqual(s.spans, [3, 2]);
    assert.equal(s.poles.length, 8);
    assert.equal(s.poles[0].length, 7);
});

test('two sides loft straight between them', () => {
    const a = arc(t => [20 * t, 3 * Math.sin(Math.PI * t), 0]), b = arc(t => [20 * (1 - t), 0, 10]);
    const s = square([a, b], { tolerance: 0.01 });
    assert.ok(s.gap <= 0.01);
    const mid = surfaceAt(s, 0.5, 0.5);
    assert.ok(dist(mid, [10, 1.5, 5]) < 0.05, `mid ${mid}`);
});

test('a side of no length is refused', () => {
    assert.throws(() => byLength([[1, 1, 1], [1, 1, 1]]), /length/);
    assert.throws(() => square([bottom, right, top]), /don't close/);
    assert.throws(() => square([bottom]), /three or four sides/);
});

test('G1 turns the sheet to carry on the faces along edge sides', () => {
    // A floor ending at z = 0 (its way out +z) and a wall ending at y = 10 (its way out +y), with
    // quarter-round sides between them.
    const n = 40;
    const floor = Object.assign(arc(t => [20 * t, 0, 0], n), { out: Array.from({ length: n + 1 }, () => [0, 0, 1]) });
    const wall = Object.assign(arc(t => [20 * t, 10, 10], n), { out: Array.from({ length: n + 1 }, () => [0, 1, 0]) });
    const quarter = x => arc(t => [x, 10 - 10 * Math.cos(Math.PI / 2 * t), 10 * Math.sin(Math.PI / 2 * t)], n);
    const g0 = square([floor, quarter(20), wall, quarter(0)], { tolerance: 0.01 });
    const g1 = square([floor, quarter(20), wall, quarter(0)], { tolerance: 0.01, continuity: 'G1' });
    assert.ok(g1.turn <= 0.5, `G1 turn ${g1.turn}`);
    assert.ok(g1.gap <= 0.01, `G1 gap ${g1.gap}`);
    assert.ok(g0.turn === 0 && g1.spans[0] >= 1);
    // The middle bulges out like the quarter round it is meant to be, not flat between the sides.
    const mid = surfaceAt(g1, 0.5, 0.5);
    assert.ok(mid[2] > 6 && mid[1] < 4, `mid ${mid}`);
});

test('a G1 loft between two edges leaves each along its face', () => {
    // Two shelves facing each other across a drop: the upper one's way out is +z, the lower one's -z.
    const n = 40;
    const upper = Object.assign(arc(t => [20 * t, 10, 10], n), { out: Array.from({ length: n + 1 }, () => [0, 0, 1]) });
    const lower = Object.assign(arc(t => [20 * t, -5, 25], n), { out: Array.from({ length: n + 1 }, () => [0, 0, -1]) });
    const s = square([upper, lower], { continuity: 'G1' });
    assert.ok(s.turn <= 0.5 && s.gap <= 0.01, `turn ${s.turn} gap ${s.gap}`);
    assert.ok(s.spans[0] <= 8, `spans ${s.spans}`);
    // An S: a quarter of the way across it is still high, three quarters across already low.
    const q1 = surfaceAt(s, 0.5, 0.25), q3 = surfaceAt(s, 0.5, 0.75);
    assert.ok(q1[1] > 6 && q3[1] < -1, `${q1} ${q3}`);
});

test('G2 also bends the sheet across each edge side as its face bends', () => {
    const n = 40;
    const ones = v => Array.from({ length: n + 1 }, () => v);
    const shelf = (y, z, out, k) => Object.assign(arc(t => [20 * t, y, z], n), { out: ones(out), normal: ones([0, 1, 0]), kappa: ones([k, 0, 0]) });
    // The upper face curls up (curvature 0.05 toward +y), the lower one is flat.
    const sides = () => [shelf(10, 10, [0, 0, 1], 0.05), shelf(-5, 25, [0, 0, -1], 0)];
    const g2 = square(sides(), { continuity: 'G2' });
    assert.ok(g2.gap <= 0.01 && g2.turn <= 0.5, `gap ${g2.gap} turn ${g2.turn}`);
    assert.ok(g2.bend <= 5e-4, `bend ${g2.bend}`);
    // G1 alone leaves the curvature to chance.
    const g1 = square(sides(), { continuity: 'G1', spans: g2.spans });
    assert.ok(g1.bend === 0 && g1.turn <= 0.5);
    assert.throws(() => square(sides(), { continuity: 'G2', degree: 2 }), /degree 3/);
    assert.throws(() => square(sides(), { continuity: 'G2', spans: [1, 1] }), /6 control points/);
    assert.ok(square(sides(), { continuity: 'G2', spans: [1, 3] }).bend <= 5e-4);
});

test('G2 on four sides with two flat faces: no bend across those sides', () => {
    const n = 40, ones = v => Array.from({ length: n + 1 }, () => v);
    const floor = Object.assign(arc(t => [20 * t, 0, 0], n), { out: ones([0, 0, 1]), normal: ones([0, 1, 0]), kappa: ones([0, 0, 0]) });
    const wall = Object.assign(arc(t => [20 * t, 10, 10], n), { out: ones([0, 1, 0]), normal: ones([0, 0, 1]), kappa: ones([0, 0, 0]) });
    const quarter = x => arc(t => [x, 10 - 10 * Math.cos(Math.PI / 2 * t), 10 * Math.sin(Math.PI / 2 * t)], n);
    const g2 = square([floor, quarter(20), wall, quarter(0)], { continuity: 'G2' });
    assert.ok(g2.gap <= 0.01 && g2.turn <= 0.5, `gap ${g2.gap} turn ${g2.turn}`);
    assert.ok(g2.bend <= 1e-3, `bend ${g2.bend} at ${g2.spans}`);
});

test('three sides fill too: the longest is split at its middle', () => {
    // A triangle of arcs bulging up: two straight sides and a curved one.
    const a = arc(t => [20 * t, 0, 0]), b = arc(t => [20 - 20 * t, 20 * t, 4 * Math.sin(Math.PI * t)]), c = arc(t => [0, 20 - 20 * t, 0]);
    const s = square([a, b, c], { tolerance: 0.01 });
    assert.ok(s.gap <= 0.01, `gap ${s.gap}`);
    // Every side's points lie on the sheet's boundary, and the middle is inside the triangle.
    const mid = surfaceAt(s, 0.5, 0.5);
    assert.ok(mid[0] > 0 && mid[1] > 0 && mid[0] + mid[1] < 20, `${mid}`);
});

test('Free: one span each way, near the sides rather than on them, corners held', () => {
    const free = square([bottom, right, top, left], { continuity: 'FREE' });
    assert.deepEqual(free.spans, [1, 1]);
    assert.equal(free.poles.length * free.poles[0].length, 16);
    const g0 = square([bottom, right, top, left], { continuity: 'G0' });
    assert.ok(g0.gap <= 0.01 && free.gap > g0.gap && free.gap < 1, `${free.gap}`);
    for (const [u, v, p] of [[0, 0, [0, 0, 0]], [1, 0, [20, 0, 0]], [1, 1, [20, 0, 10]], [0, 1, [0, 0, 10]]]) assert.ok(dist(surfaceAt(free, u, v), p) < 1e-9);
    assert.deepEqual(square([bottom, right, top, left], { continuity: 'FREE', spans: [2, 3] }).spans, [2, 3]);
});

test('Flatness pulls the inner control points onto the plane of the boundary', () => {
    // A square frame 20 × 20 in z = 0 with one side bowed up 6: the fill bulges toward it.
    const frame = [arc(t => [20 * t, 0, 0]), arc(t => [20, 20 * t, 0]), arc(t => [20 - 20 * t, 20, 6 * Math.sin(Math.PI * t)]), arc(t => [0, 20 - 20 * t, 0])];
    const base = square(frame, { spans: [3, 3] }), flat = square(frame, { spans: [3, 3], flatness: 1 }), half = square(frame, { spans: [3, 3], flatness: 0.5 });
    // The sides stay where they were.
    assert.ok(Math.abs(flat.gap - base.gap) < 1e-9, `${flat.gap} ${base.gap}`);
    const lift = s => surfaceAt(s, 0.5, 0.5)[2];
    assert.ok(lift(flat) < lift(half) && lift(half) < lift(base), `${lift(flat)} ${lift(half)} ${lift(base)}`);
    // Flatness 1: every inner pole is on the boundary ring's plane (tilted, since one side is up).
    const inner = flat.poles.slice(1, -1).flatMap(r => r.slice(1, -1));
    const [a, b, c] = [inner[0], inner[3], inner[inner.length - 1]];
    const d1 = b.map((x, k) => x - a[k]), d2 = c.map((x, k) => x - a[k]);
    const n = [d1[1] * d2[2] - d1[2] * d2[1], d1[2] * d2[0] - d1[0] * d2[2], d1[0] * d2[1] - d1[1] * d2[0]], ln = Math.hypot(...n);
    for (const p of inner) assert.ok(Math.abs(p.reduce((t, x, k) => t + (x - a[k]) * n[k], 0) / ln) < 1e-9, `${p}`);
    assert.ok(Math.abs(n[0] / ln) < 1e-9, 'tilted only toward the raised side');
});

test('Boundary Normal turns the isocurves to leave free sides square; Adjacent leans them along the neighbours', () => {
    // A flat trapezoid: a straight bottom 0..40, slanted left and right sides, a shorter top.
    const frame = [arc(t => [40 * t, 0, 0]), arc(t => [40 - 10 * t, 20 * t, 0]), arc(t => [30 - 20 * t, 20, 0]), arc(t => [10 - 10 * t, 20 - 20 * t, 0])];
    const sq = boundary => square(frame, { spans: [4, 4], boundary });
    const leave = (s, i) => sub3(s.poles[i][1], s.poles[i][0]);
    const sub3 = (a, b) => a.map((v, k) => v - b[k]);
    const natural = sq('natural'), normal = sq('normal'), adjacent = sq('adjacent');
    // (The poles next to the corners are shared with the slanted sides, which pull them their way too.)
    for (let i = 2; i < 5; i++) assert.ok(Math.abs(leave(normal, i)[0]) < 1e-9, `${leave(normal, i)}`);
    assert.ok(Math.abs(leave(natural, 1)[0]) > 1e-3, 'Natural leans with the sides');
    // Adjacent: next to the left side the flow runs nearly along it ([10, 20] from the corner), turned by the right side's.
    const a = leave(adjacent, 1), l = Math.hypot(...a);
    assert.ok(a[0] / l > 0.2, `${a}`);
    // The sides themselves stay put.
    assert.ok(Math.abs(normal.gap - natural.gap) < 1e-9);
    assert.deepEqual(BOUNDARY, ['natural', 'normal', 'next', 'adjacent']);
    assert.throws(() => square(frame, { boundary: 'sideways' }), /Natural, Normal/);
});

test('Weight below 1 loosens the sides for a fairer sheet', () => {
    const wavy = [arc(t => [20 * t, 0, 1.5 * Math.sin(6 * Math.PI * t)]), arc(t => [20, 20 * t, 0]), arc(t => [20 - 20 * t, 20, 0]), arc(t => [0, 20 - 20 * t, 0])];
    const fair = s => { let e = 0; const P = s.poles; for (let i = 1; i < P.length - 1; i++) for (let j = 0; j < P[0].length; j++) for (let k = 0; k < 3; k++) e += (P[i - 1][j][k] - 2 * P[i][j][k] + P[i + 1][j][k]) ** 2; return e; };
    const full = square(wavy, { spans: [8, 4] }), loose = square(wavy, { spans: [8, 4], weight: 0.3 });
    assert.ok(fair(loose) < fair(full) * 0.8, `${fair(loose)} ${fair(full)}`);
    assert.ok(loose.gap > full.gap, `${loose.gap} ${full.gap}`);
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) assert.ok(dist(surfaceAt(loose, u, v), surfaceAt(full, u, v)) < 1e-9);
    assert.throws(() => square(wavy, { weight: 0 }), /weight/);
});
