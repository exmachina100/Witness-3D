// Plasticity's Freestyle (F) for Move, Rotate and Scale: the transform is set by clicked points
// instead of the gizmo. Move goes from a start point to an end point; Rotate turns about the axis
// through two points by the angle from a reference point to a target point; Scale grows about an
// origin by the ratio of the target's distance to the reference's. Pure: points are [x, y, z].

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);

/** Move: the offset from `start` to `end`. */
export const freeMove = (start, end) => sub(end, start);

/**
 * Rotate: the unit axis from `a1` to `a2` and the signed angle (radians, right-handed about the
 * axis) turning `ref` onto `target`, both seen square to the axis. Null when the axis or either
 * point has no length off it.
 */
export function freeRotate(a1, a2, ref, target) {
  const d = sub(a2, a1), L = len(d);
  if (L < 1e-12) return null;
  const axis = d.map(v => v / L);
  const off = p => { const v = sub(p, a1), h = dot(v, axis); return [v[0] - axis[0] * h, v[1] - axis[1] * h, v[2] - axis[2] * h]; };
  const u = off(ref), w = off(target);
  if (len(u) < 1e-12 || len(w) < 1e-12) return null;
  return { axis, angle: Math.atan2(dot(cross(u, w), axis), dot(u, w)) };
}

/** Scale: target's distance from `origin` over the reference's, or null from a reference on the origin. */
export function freeScale(origin, ref, target) {
  const r = len(sub(ref, origin));
  if (r < 1e-12) return null;
  return Math.max(1e-3, len(sub(target, origin)) / r);
}

/** The clicks each Freestyle needs, and what the HUD asks for at each. */
export const FREE_STEPS = {
  move: ['CLICK THE START POINT', 'CLICK THE END POINT'],
  rotate: ['CLICK THE AXIS START', 'CLICK THE AXIS END', 'CLICK A REFERENCE POINT', 'CLICK WHERE IT TURNS TO'],
  scale: ['CLICK THE SCALE ORIGIN', 'CLICK A REFERENCE POINT', 'CLICK WHERE IT SCALES TO'],
};
