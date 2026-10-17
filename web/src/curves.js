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

// --- Spiral and Tangent Arc ------------------------------------------------------------------------

/**
 * Points along a spiral (Plasticity's Spiral) as [u, v, h]: round the plane's origin in its
 * coordinates, `h` up its normal. `perTurn` points a turn.
 */
export function helixPoints(c, perTurn = 48) {
    const n = Math.max(2, Math.ceil(c.turns * perTurn)), s = c.left ? -1 : 1;
    return Array.from({ length: n + 1 }, (_, i) => {
        const f = i / n, t = 2 * Math.PI * c.turns * f;
        return [c.radius * Math.cos(s * t), c.radius * Math.sin(s * t), c.length * f];
    });
}

/** A spiral's pitch angle: how steeply it climbs, in radians (Plasticity's Angle, tied to Pitch). */
export const spiralAngle = c => Math.atan2(c.length / c.turns, 2 * Math.PI * c.radius);

/**
 * Tangent Arc: the arc leaving `a` along `t` (a direction) and ending at `q`, as { start, mid, end,
 * radius }, or null when `q` is straight ahead or behind.
 */
export function tangentArc(a, t, q) {
    const l = Math.hypot(...t), T = [t[0] / l, t[1] / l], N = [-T[1], T[0]];
    const d = [q[0] - a[0], q[1] - a[1]], across = d[0] * N[0] + d[1] * N[1];
    if (Math.abs(across) < 1e-9 * Math.max(1, Math.hypot(...d))) return null;
    const k = (d[0] * d[0] + d[1] * d[1]) / (2 * across), c = [a[0] + N[0] * k, a[1] + N[1] * k], r = Math.abs(k);
    const ang = p => Math.atan2(p[1] - c[1], p[0] - c[0]), turn = Math.sign(k);
    let sweep = ang(q) - ang(a);
    while (turn * sweep <= 0) sweep += turn * 2 * Math.PI;
    while (turn * sweep > 2 * Math.PI) sweep -= turn * 2 * Math.PI;
    const m = ang(a) + sweep / 2;
    return { start: a, mid: [c[0] + r * Math.cos(m), c[1] + r * Math.sin(m)], end: q, radius: r };
}

/**
 * Where an open curve ends and the way it leaves there, in its plane: `[point, direction]` for the
 * first end (`last` false, heading back out of the curve) or the last. Null for closed curves.
 */
export function endTangent(c, last) {
    if (c.kind === 'contour') return c.pieces.length ? endTangent(last ? c.pieces.at(-1) : c.pieces[0], last) : null;
    if (!ends(c)) return null;
    if (c.kind === 'arc') {
        const t = circleThrough(c.start, c.mid, c.end);
        if (!t) return null;
        const p = last ? c.end : c.start, r = [p[0] - t.center[0], p[1] - t.center[1]];
        const ccw = (c.start[0] - t.center[0]) * (c.mid[1] - t.center[1]) - (c.start[1] - t.center[1]) * (c.mid[0] - t.center[0]) > 0;
        const along = ccw ? [-r[1], r[0]] : [r[1], -r[0]];
        return [p, last ? along : [-along[0], -along[1]]];
    }
    const pts = c.samples ?? c.points;
    const [p, q] = last ? [pts.at(-1), pts.at(-2)] : [pts[0], pts[1]];
    return [c.points[last ? c.points.length - 1 : 0], [p[0] - q[0], p[1] - q[1]]];
}

// --- Control Point Curve (Plasticity's CV curve), as w3d_section's kind 8 ----------------------------

/** The curve's degree: cubic, or lower when there are too few control points for it. */
export const cvDegree = (n, closed) => Math.min(3, closed ? n - 1 : n - 1);

/**
 * `n + 1` points (`n` when closed) along the uniform B-spline with control points `points`: clamped
 * to its end points when open, periodic when closed. The same curve the kernels build.
 */
export function cvPoints(points, closed, n = 64) {
    const m = points.length, p = cvDegree(m, closed);
    if (m < 2 || p < 1) return points.map(q => [...q]);
    // Control points and knots of the equivalent non-periodic curve: a closed curve wraps p points.
    const P = closed ? [...points, ...points.slice(0, p)] : points;
    const count = P.length, knots = [];
    if (closed) for (let i = 0; i <= count + p; i++) knots.push(i);
    else {
        const inner = count - p;
        for (let i = 0; i <= p; i++) knots.push(0);
        for (let i = 1; i < inner; i++) knots.push(i / inner);
        for (let i = 0; i <= p; i++) knots.push(1);
    }
    const t0 = knots[p], t1 = knots[count];
    const at = t => {
        let k = p;
        while (k < count - 1 && t >= knots[k + 1]) k++;
        const d = Array.from({ length: p + 1 }, (_, j) => [...P[k - p + j]]);
        for (let r = 1; r <= p; r++) for (let j = p; j >= r; j--) {
            const i = k - p + j, a = (t - knots[i]) / (knots[i + p - r + 1] - knots[i]);
            d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1]];
        }
        return d[p];
    };
    const steps = closed ? n : n + 1;
    return Array.from({ length: steps }, (_, i) => at(i === n ? t1 - 1e-12 * (t1 - t0) : t0 + (t1 - t0) * i / n));
}

// --- NURBS curves (what Project makes), as w3d_section's kind 9 -----------------------------------

/**
 * Points along a NURBS curve shape ({ degree, poles: [[x, y, h]], weights, knots }, knots repeated as
 * often as they occur) as [x, y, h] in its plane, `perSpan` steps across each knot span so corners
 * between spans stay sharp.
 */
export function nurbsPoints(c, perSpan = 16) {
    const { degree: p, poles, weights, knots } = c;
    const out = [];
    const at = (t, k) => {
        // de Boor's algorithm in homogeneous coordinates, on span k (knots[k] <= t <= knots[k + 1]).
        const d = [];
        for (let j = 0; j <= p; j++) { const w = weights[k - p + j], q = poles[k - p + j]; d.push([q[0] * w, q[1] * w, q[2] * w, w]); }
        for (let r = 1; r <= p; r++) for (let j = p; j >= r; j--) {
            const i = k - p + j, span = knots[i + p - r + 1] - knots[i];
            const a = span > 0 ? (t - knots[i]) / span : 0;
            d[j] = d[j].map((v, m) => (1 - a) * d[j - 1][m] + a * v);
        }
        const [x, y, z, w] = d[p];
        return [x / w, y / w, z / w];
    };
    for (let k = p; k < poles.length; k++) {
        const t0 = knots[k], t1 = knots[k + 1];
        if (!(t1 > t0)) continue;
        for (let i = out.length ? 1 : 0; i <= perSpan; i++) out.push(at(t0 + (t1 - t0) * i / perSpan, k));
    }
    return out;
}

/** Whether a NURBS curve lies in its plane and closes up, so it bounds a region. */
export const nurbsLoop = c => c.poles.length >= 3 && c.poles.every(q => Math.abs(q[2]) < 1e-7)
    && Math.hypot(c.poles[0][0] - c.poles.at(-1)[0], c.poles[0][1] - c.poles.at(-1)[1]) < 1e-7;

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len3 = a => Math.hypot(...a);
const unit3 = a => { const l = len3(a); return a.map(v => v / l); };

/**
 * A NURBS curve in model space ({ degree, poles: [[x, y, z]], weights, knots }) as a drawn curve, as
 * the desktop's Curve::from_nurbs: in its own plane when it is flat (its normal facing back against
 * `dir`, the way it was projected), otherwise on a plane square to `dir`.
 */
export function curveFromNurbs(path, dir) {
    const { degree, poles, weights, knots } = path, first = poles[0];
    const size = Math.max(1, ...poles.map(p => len3(sub3(p, first))));
    const back = unit3(dir.map(v => -v));
    const far = poles.reduce((a, p) => len3(sub3(p, first)) > len3(sub3(a, first)) ? p : a, first);
    const side = poles.map(p => cross3(sub3(far, first), sub3(p, first))).reduce((a, b) => len3(b) > len3(a) ? b : a, [0, 0, 0]);
    let normal = back;
    if (len3(side) > 1e-12) {
        let n = unit3(side);
        if (poles.every(p => Math.abs(dot3(sub3(p, first), n)) < 1e-9 * size)) {
            if (dot3(n, back) < 0) n = n.map(v => -v);
            if (Math.abs(dot3(n, back)) > 1e-9) normal = n;
        }
    }
    let x = sub3(far, first);
    if (!(len3(x) > 1e-12) || len3(cross3(unit3(x), normal)) < 1e-6) x = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    x = unit3(sub3(x, normal.map(v => v * dot3(x, normal))));
    const y = cross3(normal, x);
    let local = poles.map(p => { const d = sub3(p, first); return [dot3(d, x), dot3(d, y), dot3(d, normal)]; });
    // Flat curves are flat exactly, so they bound regions.
    if (local.every(p => Math.abs(p[2]) < 1e-9 * size)) local = local.map(([u, v]) => [u, v, 0]);
    return { origin: [...first], x, normal, kind: 'nurbs', degree, poles: local, weights: [...weights], knots: [...knots] };
}
