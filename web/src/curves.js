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
