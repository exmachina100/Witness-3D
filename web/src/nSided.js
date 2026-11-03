// An N-sided fill (five sides or more, or any loop not split into four) as Plasticity's xNURBS
// makes one surface for: here the hole is split into N four-sided patches round a centre point,
// each fitted by Square's fitter (square.js). Each side is cut at its middle; the patch at each
// corner of the loop runs from that corner along half of each side meeting there to the two
// middles, and from those inward to the centre along inner curves shared with the neighbouring
// patches. Each inner curve carries one tangent plane along it (turning from the face's at the
// side's middle to the centre's), and both patches leave it along that plane, opposite ways, so
// they meet G1 to within the fit; with G1/G2 the patches also leave the faces along edge sides.
// Shared by both builds; pure.

import { byLength, halves, orderLoop, square, surfaceAt } from './square.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => { const l = len(a); return l > 1e-15 ? mul(a, 1 / l) : a; };
const dist = (a, b) => len(sub(a, b));
const flatOn = (v, n) => sub(v, mul(n, dot(v, n)));

/** The loop's best-fit plane normal (Newell's), from its points in order. */
function loopNormal(pts) {
    const n = [0, 0, 0];
    pts.forEach((p, i) => {
        const q = pts[(i + 1) % pts.length];
        n[0] += (p[1] - q[1]) * (p[2] + q[2]); n[1] += (p[2] - q[2]) * (p[0] + q[0]); n[2] += (p[0] - q[0]) * (p[1] + q[1]);
    });
    return unit(n);
}

/**
 * @param {number[][][]} sides polylines round one closed loop (any order or direction); an edge
 *   side may carry `out` (and for G2 `normal`, `kappa`) per point as square.js takes them
 * @param {object} options Square's options (degree, tolerance, continuity, tension, ...)
 * @returns {{ patches: object[], gap: number, turn: number, seam: number }} the fitted patches
 *   (square.js results), the largest miss along the loop, the largest turn to the faces along edge
 *   sides (G1/G2), and the largest angle between neighbouring patches along the inner curves
 */
export function nSidedFill(sides, options = {}) {
    const all = sides.flat(), size = Math.max(...all.map(p => dist(p, all[0]))) || 1;
    const loop = orderLoop(sides, Math.max(options.tolerance ?? 0.01, 1e-3 * size));
    const n = loop.length;
    if (n < 3) throw new Error('an N-sided fill needs three sides or more round the loop');
    const tangent = options.continuity === 'G1' || options.continuity === 'G2';
    const ring = loop.flatMap(s => s.slice(0, -1));
    const up = loopNormal(ring);
    // Each side's two halves and its middle, with the sheet's normal and its way in there.
    const parts = loop.map(side => {
        const [a, b] = halves(side), m = b[0], at = byLength(side);
        const t = unit(sub(at(0.51), at(0.49)));
        let inward, normal;
        const fromFace = !!(tangent && side.out);
        if (fromFace) {
            inward = unit(byLength(side, side.out)(0.5));
            normal = unit(cross(t, inward));
        } else {
            normal = up;
            inward = unit(cross(normal, t));
        }
        return { a, b, m, t, inward, normal, fromFace };
    });
    // Normals and ways in agree with the loop's own turning: a side running the other way round flips both.
    const centre0 = mul(ring.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / ring.length);
    for (const p of parts) {
        if (!p.fromFace && dot(p.inward, sub(centre0, p.m)) < 0) p.inward = mul(p.inward, -1);
        if (dot(p.normal, up) < 0) p.normal = mul(p.normal, -1);
    }
    // The centre: where the sides' ways in, carried halfway across, point to on average.
    const centre = mul(parts.reduce((s, p) => add(s, add(p.m, mul(p.inward, 0.5 * dist(p.m, centre0)))), [0, 0, 0]), 1 / n);
    const nc = unit(parts.reduce((s, p) => add(s, p.normal), [0, 0, 0]));
    // Inner curves from each side's middle to the centre (cubic Hermite), with the tangent plane
    // along them turning from the side's to the centre's, and the way across it in that plane.
    const K = 24;
    const inner = parts.map(p => {
        const chord = dist(p.m, centre);
        const t0 = mul(p.inward, chord), t1 = mul(unit(flatOn(sub(centre, p.m), nc)), chord);
        const pts = [], across = [];
        for (let k = 0; k <= K; k++) {
            const s = k / K, h00 = 2 * s ** 3 - 3 * s ** 2 + 1, h10 = s ** 3 - 2 * s ** 2 + s, h01 = -2 * s ** 3 + 3 * s ** 2, h11 = s ** 3 - s ** 2;
            pts.push(add(add(mul(p.m, h00), mul(t0, h10)), add(mul(centre, h01), mul(t1, h11))));
        }
        // Tangent along the curve by differences; the normal blends from the side's to the centre's.
        for (let k = 0; k <= K; k++) {
            const tk = unit(sub(pts[Math.min(K, k + 1)], pts[Math.max(0, k - 1)]));
            const nk = unit(add(mul(p.normal, 1 - k / K), mul(nc, k / K)));
            across.push(unit(cross(nk, tk)));
        }
        return { pts, across };
    });
    // One patch at each corner of the loop: corner = start of side i, between side i-1 and side i.
    const patches = [], turns = [];
    for (let i = 0; i < n; i++) {
        const prev = parts[(i - 1 + n) % n], here = parts[i];
        const cin = inner[i], cprev = inner[(i - 1 + n) % n];
        const sideA = here.a;                               // corner -> middle of side i
        const sideB = [...cin.pts];                          // middle of side i -> centre
        const sideC = [...cprev.pts].reverse();               // centre -> middle of side i-1
        const sideD = prev.b;                               // middle of side i-1 -> corner
        // The way into this patch across each inner curve: toward the corner's side of it, in the
        // curve's tangent plane, turning near the centre toward the patch's other inner curve there
        // (its corner at the centre has N patches round it, not four, so square across won't do).
        const into = (curve, toward, other) => {
            const sign = Math.sign(dot(curve.across[Math.floor(K / 2)], sub(toward, curve.pts[Math.floor(K / 2)]))) || 1;
            const there = unit(sub(other.pts[K - 1], other.pts[K]));
            return curve.across.map((v, k) => {
                const base = mul(v, sign), tk = unit(sub(curve.pts[Math.min(K, k + 1)], curve.pts[Math.max(0, k - 1)]));
                const goal = unit(add(mul(tk, dot(there, tk)), mul(v, dot(there, v))));
                const w = (k / K) ** 2;
                return unit(add(mul(base, 1 - w), mul(goal, w)));
            });
        };
        const corner = sideA[0];
        sideB.out = into(cin, corner, cprev);
        sideC.out = into(cprev, corner, cin).reverse();
        // The loop's halves keep their faces only for G1/G2; the inner curves always hold G1.
        if (!tangent) for (const side of [sideA, sideD]) { delete side.out; delete side.normal; delete side.kappa; }
        // Spans: as asked, else 8 each way. Where two faces meet at a corner of the loop the patch
        // can't leave both along them (their planes differ there), and that twist only shrinks
        // toward the corner as spans go up, so auto spans would run away chasing it.
        const fit = square([sideA, sideB, sideC, sideD], { ...options, spans: options.spans || 8, continuity: options.continuity === 'G2' ? 'G2' : 'G1' });
        if (tangent) for (const [side, flip] of [[sideA, false], [sideD, true]]) if (side.out) turns.push(faceTurn(fit, side, flip));
        patches.push(fit);
    }
    const gap = Math.max(...patches.map(p => p.gap));
    const turn = turns.length ? Math.max(...turns) : 0;
    return { patches, gap, turn, seam: seamAngle(patches, inner) };
}

/**
 * The largest angle (degrees) between the patch and the face along a half side, leaving out the
 * fifth nearest the loop's corner (where the two faces meeting there can't both be met); `flip`
 * when the half runs toward the corner rather than from it.
 */
function faceTurn(f, side, flip) {
    const along = byLength(side), out = byLength(side, side.out);
    let most = 0;
    for (let k = 0; k <= 16; k++) {
        const s = 0.2 + 0.8 * k / 16, at = flip ? 1 - s : s;
        const P = along(at), t = unit(sub(along(Math.min(1, at + 0.01)), along(Math.max(0, at - 0.01))));
        const face = unit(cross(t, unit(out(at)))), patch = nearestOnEdges(f, P).n;
        most = Math.max(most, Math.acos(Math.min(1, Math.abs(dot(face, patch)))) * 180 / Math.PI);
    }
    return most;
}

/** The largest angle (degrees) between the two patches either side of each inner curve. */
function seamAngle(patches, inner) {
    const n = patches.length;
    let most = 0;
    for (let i = 0; i < n; i++) {
        const a = patches[i], b = patches[(i + 1) % n];
        for (let k = 2; k < inner[i].pts.length - 2; k += 2) {
            const P = inner[i].pts[k], na = nearestOnEdges(a, P).n, nb = nearestOnEdges(b, P).n;
            most = Math.max(most, Math.acos(Math.min(1, Math.abs(dot(na, nb)))) * 180 / Math.PI);
        }
    }
    return most;
}

/** The point of the patch's boundary nearest P, with the patch's normal there. */
function nearestOnEdges(f, P) {
    let best = null;
    for (const [fu, fv] of [[s => s, () => 0], [() => 1, s => s], [s => s, () => 1], [() => 0, s => s]]) {
        for (let k = 0; k <= 96; k++) {
            const s = k / 96, u = fu(s), v = fv(s), q = surfaceAt(f, u, v), d = dist(q, P);
            if (!best || d < best.d) best = { u, v, d };
        }
    }
    const e = 1e-4, { u, v } = best;
    const du = sub(surfaceAt(f, Math.min(1, u + e), v), surfaceAt(f, Math.max(0, u - e), v));
    const dv = sub(surfaceAt(f, u, Math.min(1, v + e)), surfaceAt(f, u, Math.max(0, v - e)));
    return { n: unit(cross(du, dv)), d: best.d };
}
