// Several drawn regions extruded together (Plasticity extrudes every selected region at once): which
// lie inside others. A region inside an odd number of the others is a hole (the inside of an O),
// cut from the rest; inside an even number it is an island, joined. Shared by both builds.

/** Twice the signed area of a closed [x, y] loop. */
const area2 = loop => loop.reduce((t, [x, y], i) => { const [u, v] = loop[(i + 1) % loop.length]; return t + x * v - u * y; }, 0);

/** Whether [x, y] lies inside the closed loop (even-odd). */
export function inside([x, y], loop) {
    let hit = false;
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
        const [xi, yi] = loop[i], [xj, yj] = loop[j];
        if ((yi > y) !== (yj > y) && x < xi + (y - yi) * (xj - xi) / (yj - yi)) hit = !hit;
    }
    return hit;
}

/**
 * How many of the other loops each closed loop ([[x, y]], all in one plane) lies inside: a loop is
 * inside another when the other is larger and holds every one of its points.
 */
export function nestingDepths(loops) {
    const size = loops.map(l => Math.abs(area2(l)));
    return loops.map((l, i) => loops.filter((m, k) => k !== i && size[k] > size[i] && l.every(p => inside(p, m))).length);
}

/**
 * The regions to extrude, from curves given as { id, origin, normal, points: [[x, y, z]] } (points
 * in model space): the joined ones first, then the holes. Regions on different planes never nest.
 */
export function regionsToExtrude(regions, tol = 1e-6) {
    if (!regions.length) return { first: null, more: [], holes: [] };
    const [r0] = regions;
    const n = unit(r0.normal), o = r0.origin;
    const x = unit(Math.abs(n[0]) < 0.9 ? cross(n, [1, 0, 0]) : cross(n, [0, 1, 0])), y = cross(n, x);
    const flat = regions.every(r => Math.abs(dot(unit(r.normal), n)) > 1 - 1e-9 && r.points.every(p => Math.abs(dot(sub(p, o), n)) < tol * 10 + 1e-6));
    const depths = flat ? nestingDepths(regions.map(r => r.points.map(p => { const d = sub(p, o); return [dot(d, x), dot(d, y)]; }))) : regions.map(() => 0);
    const joined = regions.filter((_, i) => depths[i] % 2 === 0).map(r => r.id), holes = regions.filter((_, i) => depths[i] % 2 === 1).map(r => r.id);
    return { first: joined[0], more: joined.slice(1), holes };
}

const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => { const l = Math.hypot(...a); return a.map(v => v / l); };
