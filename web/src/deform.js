// Plasticity's Deform Curve, the part both builds share: the curves' points in the reference face's
// (s, t, n) coordinates (see faceUvn.js and w3d_face_uvn) moved by the command's Scale, Offset and
// Flip options, and the points carried onto the target face joined up as a smooth curve.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => { const l = len(a); return l > 1e-15 ? a.map(v => v / l) : [0, 0, 0]; };
const along = (p, d, k) => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];

/**
 * About `per` points evenly along a curve (model space, `points` along it), more where its pieces
 * need them; its corners (turns of more than 30°) are kept, so they stay corners.
 */
export function densify(points, closed, per = 32) {
    const pts = closed ? [...points, points[0]] : [...points];
    const turn = i => {
        const a = unit(sub(pts[i], pts[i - 1 < 0 ? pts.length - 2 : i - 1])), b = unit(sub(pts[i + 1 >= pts.length ? 1 : i + 1], pts[i]));
        return Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
    };
    // The curve is cut at its corners into runs, and each run gets points evenly along it.
    const cuts = [0];
    for (let i = 1; i < pts.length - 1; i++) if (turn(i) > Math.PI / 6) cuts.push(i);
    cuts.push(pts.length - 1);
    const lengths = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) { const l = len(sub(pts[i], pts[i - 1])); lengths.push(l); total += l; }
    if (!(total > 1e-12)) throw new Error('that curve has no length');
    const out = [pts[0]];
    for (let r = 0; r + 1 < cuts.length; r++) {
        const a = cuts[r], b = cuts[r + 1];
        let run = 0;
        for (let i = a; i < b; i++) run += lengths[i];
        const k = b - a === 1 ? Math.max(1, Math.ceil(per * run / total - 1e-9)) : Math.max(2, Math.round(per * run / total));
        let i = a, done = 0;
        for (let j = 1; j < k; j++) {
            const want = run * j / k;
            while (i < b - 1 && done + lengths[i] < want) done += lengths[i++];
            out.push(along(pts[i], sub(pts[i + 1], pts[i]), lengths[i] > 0 ? (want - done) / lengths[i] : 0));
        }
        out.push(pts[b]);
    }
    if (closed) out.pop();
    return out;
}

/** The default options: no scaling, no offset, nothing flipped, the curves themselves not kept. */
export const DEFORM = { scale: [1, 1, 1], offset: [0, 0, 0], mirror: false, swap: false, normal: false, keep: false };

/**
 * The curves' (s, t, n) coordinates (`curves`, a list of lists) moved by the options: UV swaps s
 * and t, Mirror runs s the other way, Scale grows them about the middle of all the curves (N scales
 * their heights), Normal turns their heights over and Offset moves them on, U and V in mm along a
 * target face `size` ([along u, along v] mm) long.
 */
export function placeOnFace(curves, size, opts = {}) {
    const { scale, offset, mirror, swap, normal } = { ...DEFORM, ...opts };
    const moved = curves.map(c => c.map(([s, t, n]) => {
        if (swap) [s, t] = [t, s];
        if (mirror) s = 1 - s;
        return [s, t, n];
    }));
    const all = moved.flat();
    if (!all.length) return moved;
    const mid = k => (Math.min(...all.map(p => p[k])) + Math.max(...all.map(p => p[k]))) / 2;
    const cs = mid(0), ct = mid(1);
    const du = size[0] > 1e-12 ? offset[0] / size[0] : 0, dv = size[1] > 1e-12 ? offset[1] / size[1] : 0;
    return moved.map(c => c.map(([s, t, n]) => [
        cs + (s - cs) * scale[0] + du,
        ct + (t - ct) * scale[1] + dv,
        (normal ? -n : n) * scale[2] + offset[2],
    ]));
}

/**
 * A smooth cubic NURBS curve through `points` (model space): one Bezier span between each pair,
 * tangent through the points but for corners (a turn of more than `corner` radians), where each side
 * keeps its own direction. Returns { degree, poles, weights, knots }.
 */
export function smoothThrough(points, closed, corner = Math.PI / 6) {
    const pts = closed ? [...points, points[0]] : [...points];
    const m = pts.length - 1;
    if (m < 1) throw new Error('that curve has no length');
    const at = i => closed ? pts[((i % m) + m) % m] : pts[Math.max(0, Math.min(m, i))];
    // Each point's tangent going in and coming out.
    const ins = [], outs = [];
    for (let i = 0; i <= m; i++) {
        const a = unit(sub(at(i), at(i - 1))), b = unit(sub(at(i + 1), at(i)));
        const first = !closed && i === 0, last = !closed && i === m;
        const turn = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
        if (first) { ins.push(b); outs.push(b); }
        else if (last) { ins.push(a); outs.push(a); }
        else if (turn > corner || !len(a) || !len(b)) { ins.push(a); outs.push(b); }
        else { const t = unit(sub(at(i + 1), at(i - 1))); ins.push(t); outs.push(t); }
    }
    const poles = [[...pts[0]]], knots = [0, 0, 0, 0];
    for (let i = 0; i < m; i++) {
        const p = pts[i], q = pts[i + 1], l = len(sub(q, p)) / 3;
        poles.push(along(p, outs[i], l), along(q, ins[i + 1], -l), [...q]);
        knots.push(...Array(i === m - 1 ? 4 : 3).fill((i + 1) / m));
    }
    return { degree: 3, poles, weights: poles.map(() => 1), knots };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * Deform Curve with a curve as the reference or target: a frame along a curve (`points` along it in
 * model space, `up` its plane's normal). `project` gives a point's (s, t, n): s how far along the
 * curve its foot is (0 to 1, past the ends along the end tangents), t its distance across the curve
 * in its plane, n its height off the plane. `place` turns (s, t, n) back into a point.
 */
export function curveFrameAlong(points, closed, up) {
    const pts = closed ? [...points, points[0]] : [...points];
    if (pts.length < 2) throw new Error('that curve has no length');
    const acc = [0];
    for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + len(sub(pts[i], pts[i - 1])));
    const L = acc.at(-1);
    if (!(L > 1e-12)) throw new Error('that curve has no length');
    const B = unit(up), m = pts.length - 1;
    const segT = i => unit(sub(pts[i + 1], pts[i]));
    // Tangents at the points, the mean of the spans either side, so the frame turns smoothly.
    const tan = pts.map((_, i) => {
        const a = i > 0 ? segT(i - 1) : closed ? segT(m - 1) : null, b = i < m ? segT(i) : closed ? segT(0) : null;
        return unit(a && b ? [a[0] + b[0], a[1] + b[1], a[2] + b[2]] : a ?? b);
    });
    const frame = (i, u) => {
        const T = unit(tan[i].map((v, k) => v * (1 - u) + tan[i + 1][k] * u));
        return { T, N: unit(cross(B, T)) };
    };
    const at = s => {
        const d = s * L;
        if (!closed && d <= 0) return { p: along(pts[0], tan[0], d), ...frame(0, 0) };
        if (!closed && d >= L) return { p: along(pts[m], tan[m], d - L), ...frame(m - 1, 1) };
        const dd = closed ? ((d % L) + L) % L : d;
        let i = 0;
        while (i < m - 1 && acc[i + 1] < dd) i++;
        const span = acc[i + 1] - acc[i], u = span > 0 ? (dd - acc[i]) / span : 0;
        return { p: along(pts[i], sub(pts[i + 1], pts[i]), u), ...frame(i, u) };
    };
    const project = q => {
        let best = null;
        for (let i = 0; i < m; i++) {
            const ab = sub(pts[i + 1], pts[i]), l2 = dot(ab, ab);
            let u = l2 > 0 ? dot(sub(q, pts[i]), ab) / l2 : 0;
            // Past an open curve's ends the foot runs on along the end spans.
            if (!(closed || (i === 0 && u < 0) || (i === m - 1 && u > 1))) u = Math.max(0, Math.min(1, u));
            else if (closed) u = Math.max(0, Math.min(1, u));
            const foot = along(pts[i], ab, u), d = len(sub(q, foot));
            if (!best || d < best.d - 1e-12) best = { d, s: (acc[i] + u * Math.sqrt(l2)) / L };
        }
        const f = at(best.s), r = sub(q, f.p);
        return [best.s, dot(r, f.N), dot(r, B)];
    };
    const place = ([s, t, n]) => { const f = at(s); return along(along(f.p, f.N, t), B, n); };
    return { length: L, project, place };
}
