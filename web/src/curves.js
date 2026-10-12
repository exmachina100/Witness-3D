// Curve geometry the viewport needs without a kernel: shared by the browser and desktop builds.

/** `n + 1` points along the arc from `a` through `b` to `c` (plane coordinates), or null on a line. */
export function arcPoints(a, b, c, n) {
    const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
    if (Math.abs(d) < 1e-12) return null;
    const sq = q => q[0] * q[0] + q[1] * q[1];
    const ux = (sq(a) * (b[1] - c[1]) + sq(b) * (c[1] - a[1]) + sq(c) * (a[1] - b[1])) / d;
    const uy = (sq(a) * (c[0] - b[0]) + sq(b) * (a[0] - c[0]) + sq(c) * (b[0] - a[0])) / d;
    const r = Math.hypot(a[0] - ux, a[1] - uy), ang = q => Math.atan2(q[1] - uy, q[0] - ux);
    const tau = 2 * Math.PI, norm = x => ((x % tau) + tau) % tau;
    // Counter-clockwise from a, the way that passes b.
    let sweep = norm(ang(c) - ang(a));
    if (norm(ang(b) - ang(a)) > sweep) sweep -= tau;
    return Array.from({ length: n + 1 }, (_, i) => { const t = ang(a) + sweep * i / n; return [ux + r * Math.cos(t), uy + r * Math.sin(t)]; });
}

/** The circle through three points, as { center, radius }, or null when they lie on a line. */
export function circleThrough(a, b, c) {
    const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
    if (Math.abs(d) < 1e-12) return null;
    const sq = q => q[0] * q[0] + q[1] * q[1];
    const center = [
        (sq(a) * (b[1] - c[1]) + sq(b) * (c[1] - a[1]) + sq(c) * (a[1] - b[1])) / d,
        (sq(a) * (c[0] - b[0]) + sq(b) * (a[0] - c[0]) + sq(c) * (b[0] - a[0])) / d,
    ];
    return { center, radius: Math.hypot(a[0] - center[0], a[1] - center[1]) };
}

/**
 * The corners of a regular polygon around `center`, sized and turned by `at`: a corner lies there,
 * or with `circumscribed` the middle of a side does (Plasticity's Regular Polygon and its C).
 */
export function polygonCorners(center, at, sides, circumscribed = false) {
    const r = Math.hypot(at[0] - center[0], at[1] - center[1]), t0 = Math.atan2(at[1] - center[1], at[0] - center[0]);
    const R = circumscribed ? r / Math.cos(Math.PI / sides) : r, shift = circumscribed ? Math.PI / sides : 0;
    return Array.from({ length: sides }, (_, k) => { const t = t0 + shift + 2 * Math.PI * k / sides; return [center[0] + R * Math.cos(t), center[1] + R * Math.sin(t)]; });
}

/** `n` points round the ellipse around `center` with radius `|major|` along `major` and `minor` across. */
export function ellipsePoints(center, major, minor, n) {
    const r = Math.hypot(...major), u = [major[0] / r, major[1] / r], v = [-u[1], u[0]];
    return Array.from({ length: n }, (_, i) => {
        const t = 2 * Math.PI * i / n, a = r * Math.cos(t), b = minor * Math.sin(t);
        return [center[0] + a * u[0] + b * v[0], center[1] + a * u[1] + b * v[1]];
    });
}

// --- Join Curves (Plasticity's J), as crates/w3d-kernel/src/join.rs --------------------------------

/** How close two ends must be to count as meeting, in millimetres. */
export const MEET = 1e-4;
const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= MEET;

/** The two ends of an open piece, or null for a closed curve. */
export function ends(p) {
    if ((p.kind === 'polyline' || p.kind === 'spline') && !p.closed && p.points?.length) return [p.points[0], p.points[p.points.length - 1]];
    if (p.kind === 'arc') return [p.start, p.end];
    return null;
}

/** Whether contour pieces close into a loop. */
export function loops(pieces) {
    if (!pieces?.length) return false;
    const a = ends(pieces[0]), b = ends(pieces[pieces.length - 1]);
    return !!a && !!b && near(a[0], b[1]) && !(pieces.length === 1 && pieces[0].kind === 'arc');
}

const mapPiece = (p, f) => p.kind === 'arc' ? { ...p, start: f(p.start), mid: f(p.mid), end: f(p.end) } : { ...p, points: p.points.map(f) };
const reversed = p => p.kind === 'arc' ? { ...p, start: p.end, end: p.start } : { ...p, points: [...p.points].reverse() };
function snapped(p, first, to) {
    if (p.kind === 'arc') return { ...p, [first ? 'start' : 'end']: to };
    const points = [...p.points];
    points[first ? 0 : points.length - 1] = to;
    return { ...p, points };
}

const sub = (a, b) => a.map((v, i) => v - b[i]), dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => { const l = Math.hypot(...a); return a.map(v => v / l); };
function axes(c) {
    const n = unit(c.normal), x = unit(sub(c.x, n.map(v => v * dot(c.x, n))));
    return { o: c.origin, x, y: cross(n, x), n };
}

/**
 * The selected curves joined: one curve per run of pieces that meet end to end, in the plane of the
 * first. Runs made only of lines become one line (closed when it loops); others a contour.
 */
export function join(curves) {
    if (curves.length < 2) throw new Error('select two curves or more to join');
    const f0 = axes(curves[0]), pieces = [];
    for (const c of curves) {
        const f = axes(c);
        if (Math.hypot(...cross(f.n, f0.n)) > 1e-6 || Math.abs(dot(sub(f.o, f0.o), f0.n)) > MEET) throw new Error('only curves in one plane can be joined');
        const toFirst = ([u, v]) => { const d = sub(f.o.map((o, i) => o + f.x[i] * u + f.y[i] * v), f0.o); return [dot(d, f0.x), dot(d, f0.y)]; };
        for (const p of c.kind === 'contour' ? c.pieces : [c]) {
            if (!ends(p)) throw new Error('only curves with two ends can be joined');
            const { origin, x, normal, id, samples, ...shape } = p;
            pieces.push(mapPiece(shape, toFirst));
        }
    }
    const used = pieces.map(() => false), out = [];
    for (let seed = 0; seed < pieces.length; seed++) {
        if (used[seed]) continue;
        used[seed] = true;
        const run = [pieces[seed]];
        for (;;) {
            const head = ends(run[0])[0], tail = ends(run[run.length - 1])[1];
            if (run.length > 1 && near(head, tail)) break;
            let next = null;
            for (let i = 0; i < pieces.length && !next; i++) {
                if (used[i]) continue;
                const [a, b] = ends(pieces[i]);
                if (near(a, tail)) next = [i, snapped(pieces[i], true, tail), false];
                else if (near(b, tail)) next = [i, snapped(reversed(pieces[i]), true, tail), false];
                else if (near(b, head)) next = [i, snapped(pieces[i], false, head), true];
                else if (near(a, head)) next = [i, snapped(reversed(pieces[i]), false, head), true];
            }
            if (!next) break;
            used[next[0]] = true;
            if (next[2]) run.unshift(next[1]); else run.push(next[1]);
        }
        const closed = run.length > 1 && near(ends(run[0])[0], ends(run[run.length - 1])[1]);
        if (closed) run[run.length - 1] = snapped(run[run.length - 1], false, ends(run[0])[0]);
        let shape;
        if (run.every(p => p.kind === 'polyline')) {
            const points = [];
            for (const p of run) for (const q of p.points) if (!points.length || !near(points[points.length - 1], q)) points.push(q);
            if (closed && points.length > 1 && near(points[0], points[points.length - 1])) points.pop();
            shape = { kind: 'polyline', points, closed };
        } else shape = run.length === 1 ? run[0] : { kind: 'contour', pieces: run };
        out.push({ origin: [...curves[0].origin], x: [...curves[0].x], normal: [...curves[0].normal], ...shape });
    }
    return out;
}
