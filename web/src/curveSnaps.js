// Plasticity's curve snaps (manual: Snap): the ends, middle, 1/4 and 3/4 points and centre of
// curves; where curves cross (Intersection); the point on a curve nearest the pointer (Closest);
// and, while drawing from a point, the foot of the perpendicular from it (Perpendicular) and the
// points where a line from it touches a curve (Tangent). Pure: curves are polylines of [x, y, z].

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The polyline's segments, closing it when `closed`. */
function segments(pts, closed) {
  const out = [];
  for (let i = 1; i < pts.length; i++) out.push([pts[i - 1], pts[i]]);
  if (closed && pts.length > 2) out.push([pts[pts.length - 1], pts[0]]);
  return out;
}

/** The point `f` of the way along the polyline by length. */
export function along(pts, f, closed = false) {
  const segs = segments(pts, closed);
  const total = segs.reduce((s, [a, b]) => s + dist(a, b), 0);
  let left = f * total;
  for (const [a, b] of segs) {
    const l = dist(a, b);
    if (left <= l || b === segs[segs.length - 1][1]) return l > 0 ? lerp(a, b, Math.min(1, left / l)) : a;
    left -= l;
  }
  return pts[0];
}

/**
 * A curve's fixed snaps: END at each end of an open curve, MIDDLE, 1/4 and 3/4 by length (a closed
 * curve's measured from its start), and CENTER when one is given (circles, arcs, ellipses).
 */
export function curvePointSnaps(pts, { closed = false, center = null } = {}) {
  if (pts.length < 2) return [];
  const out = [];
  if (!closed) out.push({ point: pts[0], kind: 'END' }, { point: pts[pts.length - 1], kind: 'END' });
  out.push({ point: along(pts, 0.5, closed), kind: 'MIDDLE' }, { point: along(pts, 0.25, closed), kind: '1/4' }, { point: along(pts, 0.75, closed), kind: '3/4' });
  if (center) out.push({ point: center, kind: 'CENTER' });
  return out;
}

/** Where segment ab comes within `tol` of segment cd: the midpoint of their closest points, or null. */
function meet(a, b, c, d, tol) {
  const u = sub(b, a), v = sub(d, c), w = sub(a, c);
  const A = dot(u, u), B = dot(u, v), C = dot(v, v), D = dot(u, w), E = dot(v, w);
  const den = A * C - B * B;
  if (den < 1e-14 * A * C || A < 1e-18 || C < 1e-18) return null;   // parallel: no single crossing
  let s = (B * E - C * D) / den, t = (A * E - B * D) / den;
  if (s < -1e-9 || s > 1 + 1e-9 || t < -1e-9 || t > 1 + 1e-9) return null;
  s = Math.min(1, Math.max(0, s)); t = Math.min(1, Math.max(0, t));
  const p = lerp(a, b, s), q = lerp(c, d, t);
  return dist(p, q) <= tol ? lerp(p, q, 0.5) : null;
}

/** INTERSECTION snaps where any two of the curves cross (within `tol`); ends meeting count once. */
export function intersections(curves, tol = 1e-3) {
  const out = [];
  const segs = curves.map(c => segments(c.pts, c.closed));
  for (let i = 0; i < curves.length; i++) for (let j = i + 1; j < curves.length; j++) {
    for (const [a, b] of segs[i]) for (const [c, d] of segs[j]) {
      const p = meet(a, b, c, d, tol);
      if (p && !out.some(q => dist(q.point, p) < tol * 10)) out.push({ point: p, kind: 'INTERSECTION' });
    }
  }
  return out;
}

/** Feet of perpendiculars from `from` onto the polyline: the points where the curve runs square to the line from `from`. */
export function perpendicularFeet(pts, from, closed = false) {
  const out = [];
  for (const [a, b] of segments(pts, closed)) {
    const d = sub(b, a), l2 = dot(d, d);
    if (l2 < 1e-18) continue;
    const t = dot(sub(from, a), d) / l2;
    if (t > 1e-9 && t < 1 - 1e-9) out.push({ point: lerp(a, b, t), kind: 'PERPENDICULAR' });
  }
  // A foot can fall on a corner between two segments, square to neither (nearest or farthest).
  const segs = segments(pts, closed);
  for (let i = 1; i < segs.length + (closed ? 1 : 0); i++) {
    const [a, q] = segs[i - 1], [, b] = segs[i % segs.length];
    const s1 = dot(sub(from, q), sub(q, a)), s2 = dot(sub(from, q), sub(b, q));
    const u = sub(q, a), v = sub(b, q), smooth = dot(u, v) > 0.98 * Math.hypot(...u) * Math.hypot(...v);   // a sampled curve, not a corner
    if (smooth && s1 * s2 < 0 && dist(from, q) > 1e-9) out.push({ point: q, kind: 'PERPENDICULAR' });
  }
  return out;
}

/** Points where a line from `from` touches the polyline, seen along `normal` (the drawing plane's). */
export function tangentPoints(pts, from, normal, closed = false) {
  const n = pts.length;
  if (n < 3) return [];
  const tan = i => closed ? sub(pts[(i + 1) % n], pts[(i - 1 + n) % n]) : sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]);
  const f = i => dot(normal, cross(sub(pts[i], from), tan(i)));
  const out = [];
  const last = closed ? n : n - 1;
  for (let i = 1; i <= last; i++) {
    const i0 = i - 1, i1 = i % n, f0 = f(i0), f1 = f(i1);
    if (f0 === 0 || f0 * f1 >= 0) continue;
    if (!closed && (i0 === 0 || i1 === n - 1)) continue;   // the end's tangent is one-sided
    const t = f0 / (f0 - f1), p = lerp(pts[i0], pts[i1], t);
    if (dist(p, from) > 1e-9) out.push({ point: p, kind: 'TANGENT' });
  }
  return out;
}

/** The point on a polyline nearest a screen point, given its points' screen positions: { point, d } in pixels, or null. */
export function closestOnScreen(pts, screen, q, closed = false) {
  let best = null;
  const n = pts.length;
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % n, a = screen[i], b = screen[j];
    if (a.behind || b.behind) continue;
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2)) : 0;
    const d = Math.hypot(a.x + dx * t - q.x, a.y + dy * t - q.y);
    if (!best || d < best.d) best = { point: lerp(pts[i], pts[j], t), d };
  }
  return best;
}

/** The exact points where lines from `from` touch the circle (centre, radius, plane normal), or [] from inside it. */
export function circleTangents(center, r, normal, from) {
  const d = sub(from, center);
  const h = dot(d, normal), p = sub(d, [normal[0] * h, normal[1] * h, normal[2] * h]);   // in the circle's plane
  const L = Math.hypot(...p);
  if (L <= r * (1 + 1e-9)) return [];
  const u = p.map(v => v / L), w = cross(normal, u);
  const c = r / L, s = Math.sqrt(1 - c * c);
  return [1, -1].map(k => ({ point: [0, 1, 2].map(i => center[i] + r * (c * u[i] + k * s * w[i])), kind: 'TANGENT' }));
}

/**
 * Tan/Tan: the lines touching both circles (centre, radius, in the plane with `normal`), as pairs
 * { a, b } of the touching points on the first and second circle: up to two outer and two crossing.
 */
export function commonTangents(c1, r1, c2, r2, normal) {
    const d = sub(c2, c1), h = dot(d, normal), p = sub(d, [normal[0] * h, normal[1] * h, normal[2] * h]);
    const L = Math.hypot(...p);
    if (L < 1e-9) return [];
    const u = p.map(v => v / L), w = cross(normal, u), out = [];
    const at = (c, r, m) => [0, 1, 2].map(i => c[i] + r * m[i]);
    for (const [k, sign2] of [[(r1 - r2) / L, 1], [(r1 + r2) / L, -1]]) {
        if (Math.abs(k) > 1 + 1e-12) continue;
        const s = Math.sqrt(Math.max(0, 1 - k * k));
        for (const side of s < 1e-12 ? [1] : [1, -1]) {
            const m = [0, 1, 2].map(i => u[i] * k + side * w[i] * s);
            out.push({ a: at(c1, r1, m), b: at(c2, sign2 * r2, m) });
        }
    }
    return out;
}
