// Plasticity's Measure Distance and Measure Radius as measurements that stay (manual: Measure,
// Measure Radius): a distance along one construction-plane axis (picked by where the pointer
// sits), or straight between its points; a radius with a leader to where it was placed. Both are
// listed in the outliner under Measurements. Pure geometry here; App.js draws them.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => { const l = norm(a); return l > 1e-12 ? mul(a, 1 / l) : [0, 0, 0]; };

/**
 * Which of the plane's axes `frame` ({ u, v, n }, unit vectors) a distance from `a` to `b` is
 * measured along with the pointer at `p`: the pointer's offset from the middle picks the axis it
 * lies out along, and the measurement runs along whichever other axis the points differ most on
 * (as a drafting dimension: pulled up, it measures across; pulled sideways, it measures up).
 * Inferred from the manual's "move to an axis and click".
 */
export function measureAxis(a, b, p, frame) {
    const d = sub(b, a), o = sub(p, mul(add(a, b), 0.5));
    const names = ['u', 'v', 'n'];
    const out = names.reduce((m, k) => Math.abs(dot(o, frame[k])) > Math.abs(dot(o, frame[m])) ? k : m, 'u');
    const rest = names.filter(k => k !== out);
    const along = rest.reduce((m, k) => Math.abs(dot(d, frame[k])) > Math.abs(dot(d, frame[m])) ? k : m, rest[0]);
    return Math.abs(dot(d, frame[along])) > 1e-9 ? along : null;
}

/**
 * A distance measurement drawn through `p`: along `axis` of `frame` ('u', 'v' or 'n'), or straight
 * from `a` to `b` when `axis` is null. Returns { value, line: [A, B], ext: [[a, A], [b, B]], label }.
 */
export function distanceMeasure(a, b, p, frame, axis) {
    if (axis) {
        const k = frame[axis];
        const A = add(p, mul(k, dot(sub(a, p), k))), B = add(p, mul(k, dot(sub(b, p), k)));
        return { value: Math.abs(dot(sub(b, a), k)), line: [A, B], ext: [[a, A], [b, B]], label: mul(add(A, B), 0.5) };
    }
    const d = sub(b, a), dir = unit(d), w0 = sub(p, a), w = sub(w0, mul(dir, dot(w0, dir)));
    const A = add(a, w), B = add(b, w);
    return { value: norm(d), line: [A, B], ext: [[a, A], [b, B]], label: mul(add(A, B), 0.5) };
}

/** The circle through three points in space, as { centre, normal, radius }, or null on a line. */
export function circleOf3(a, b, c) {
    const ab = sub(b, a), ac = sub(c, a), n = cross(ab, ac), nn = dot(n, n);
    if (nn < 1e-18) return null;
    const t = add(mul(cross(n, ab), dot(ac, ac)), mul(cross(ac, n), dot(ab, ab)));
    const centre = add(a, mul(t, 1 / (2 * nn)));
    return { centre, normal: unit(n), radius: norm(sub(a, centre)) };
}

/**
 * A radius measurement on `circle` ({ centre, normal, radius }) placed at `p`: the leader runs from
 * the circle, on the side facing `p`, out to `p`. Returns { value, line: [at, p], label: p }.
 */
export function radiusMeasure(circle, p) {
    const { centre, normal, radius } = circle;
    const w0 = sub(p, centre);
    let w = sub(w0, mul(normal, dot(w0, normal)));
    if (norm(w) < 1e-9) w = cross(normal, Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
    const at = add(centre, mul(unit(w), radius));
    return { value: radius, line: [at, p], label: p };
}

/** A stored measurement is well formed (for files and app state). */
export function checkMeasure(m) {
    const pt = q => Array.isArray(q) && q.length === 3 && q.every(Number.isFinite);
    const bad = [];
    if (!Number.isInteger(m?.id)) bad.push('id');
    if (m?.kind === 'distance') {
        if (![m.a, m.b, m.p].every(pt)) bad.push('points');
        if (m.axis !== null && !pt(m.axis)) bad.push('axis');
    } else if (m?.kind === 'radius') {
        if (![m.centre, m.normal, m.p].every(pt) || !(m.radius > 0)) bad.push('circle');
    } else bad.push('kind');
    return bad;
}

/** The drawing of stored measurement `m`: { value, line, ext?, label }. */
export function measureShape(m) {
    if (m.kind === 'radius') return radiusMeasure({ centre: m.centre, normal: m.normal, radius: m.radius }, m.p);
    return distanceMeasure(m.a, m.b, m.p, { k: m.axis }, m.axis ? 'k' : null);
}

/** `m` moved by `d` (the G key on a measurement). */
export function moveMeasure(m, d) {
    const t = q => add(q, d);
    return m.kind === 'radius' ? { ...m, centre: t(m.centre), p: t(m.p) } : { ...m, a: t(m.a), b: t(m.b), p: t(m.p) };
}
