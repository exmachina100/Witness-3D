// Offset Face's Dependent offset (Plasticity: while offsetting, pick a second face to match): the
// distance that carries the offset face onto the picked face, measured from the offset face's centre
// along its normal to where that line meets the picked face. A face parallel to a flat offset face
// is matched exactly; any other is met at the centre.

/**
 * The signed distance along unit `dir` from `origin` to face `n` of display body `b` (its
 * positions, indices and faceIds), the nearest hit forward or back, or null when the line misses it.
 */
export function distanceToFace(b, n, origin, dir) {
    const { positions: p, indices: ix, faceIds } = b;
    const [ox, oy, oz] = origin, [dx, dy, dz] = dir;
    let best = null;
    for (let t = 0; t < faceIds.length; t++) {
        if (faceIds[t] !== n) continue;
        const [i, j, k] = [ix[3 * t] * 3, ix[3 * t + 1] * 3, ix[3 * t + 2] * 3];
        // Möller–Trumbore, both ways along the line.
        const e1 = [p[j] - p[i], p[j + 1] - p[i + 1], p[j + 2] - p[i + 2]];
        const e2 = [p[k] - p[i], p[k + 1] - p[i + 1], p[k + 2] - p[i + 2]];
        const h = [dy * e2[2] - dz * e2[1], dz * e2[0] - dx * e2[2], dx * e2[1] - dy * e2[0]];
        const a = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
        if (Math.abs(a) < 1e-12) continue;
        const s = [ox - p[i], oy - p[i + 1], oz - p[i + 2]];
        const u = (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]) / a;
        if (u < -1e-9 || u > 1 + 1e-9) continue;
        const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
        const v = (dx * q[0] + dy * q[1] + dz * q[2]) / a;
        if (v < -1e-9 || u + v > 1 + 1e-9) continue;
        const d = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / a;
        if (best === null || Math.abs(d) < Math.abs(best)) best = d;
    }
    return best;
}
