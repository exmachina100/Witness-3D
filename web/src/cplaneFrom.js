// Plasticity's construction plane from a selection (manual: Construction Plane). Space takes the
// plane from whatever is selected:
//   a flat face                     the face's plane
//   a face and an edge              a plane through the edge, square to the face
//   two parallel flat faces         the plane midway between them
//   a planar curve or region        its plane
//   two points (or a lone edge)     a plane through them, turned as near the view as it can be
//   three points                    the plane through them
//   four or more points             the plane that fits them best
// Pure: vectors are [x, y, z] arrays. Returns { origin, normal, kind } or { error }.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => { const l = len(a); return l > 1e-12 ? mul(a, 1 / l) : null; };
const mean = ps => mul(ps.reduce(add, [0, 0, 0]), 1 / ps.length);

/** A unit vector square to `d`, the one nearest `want` when it can be. */
function squareTo(d, want) {
  const t = want && unit(sub(want, mul(d, dot(want, d))));
  if (t) return t;
  const any = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return unit(cross(d, any));
}

/** The normal of the plane fitting `ps` best (least squares), or null when they lie on a line. */
export function fitNormal(ps) {
  const c = mean(ps);
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (const p of ps) {
    const [x, y, z] = sub(p, c);
    xx += x * x; xy += x * y; xz += x * z; yy += y * y; yz += y * z; zz += z * z;
  }
  // The eigenvector of the smallest eigenvalue: the row of cofactors with the largest determinant.
  const dx = yy * zz - yz * yz, dy = xx * zz - xz * xz, dz = xx * yy - xy * xy;
  const m = Math.max(dx, dy, dz);
  const scale = (xx + yy + zz) ** 2;
  if (!(m > 1e-12 * scale) || scale < 1e-24) return null;
  const n = m === dx ? [dx, xz * yz - xy * zz, xy * yz - xz * yy]
    : m === dy ? [xz * yz - xy * zz, dy, xy * xz - yz * xx]
    : [xy * yz - xz * yy, xy * xz - yz * xx, dz];
  return unit(n);
}

/** Turn `n` toward `view` (the way from the model to the eye), when it is given. */
const facing = (n, view) => view && dot(n, view) < 0 ? mul(n, -1) : n;

/**
 * sel: { faces: [{ origin, normal } | { curved: true }], edges: [[x,y,z][] polylines],
 *        points: [x,y,z][], curves: [{ origin, normal }], view?: [x,y,z] }
 */
export function planeFrom(sel) {
  const faces = sel.faces ?? [], edges = (sel.edges ?? []).filter(e => e.length >= 2), points = sel.points ?? [], curves = sel.curves ?? [];
  const view = sel.view && unit(sel.view);
  if (faces.some(f => f.curved)) return { error: 'SELECT FLAT FACES FOR THE CONSTRUCTION PLANE' };

  if (faces.length === 1 && edges.length === 1 && !points.length && !curves.length) {
    const e = edges[0], d = unit(sub(e[e.length - 1], e[0]));
    const n = d && unit(cross(d, faces[0].normal));
    if (!n) return { error: 'THE EDGE IS SQUARE TO THE FACE; PICK ANOTHER EDGE' };
    return { origin: mean([e[0], e[e.length - 1]]), normal: facing(n, view), kind: 'FACE + EDGE' };
  }
  if (faces.length === 2 && !edges.length && !points.length && !curves.length) {
    const [a, b] = faces;
    if (Math.abs(dot(a.normal, b.normal)) < 1 - 1e-6) return { error: 'TWO FACES MAKE A MIDPLANE ONLY WHEN THEY ARE PARALLEL' };
    const d = dot(sub(b.origin, a.origin), a.normal);
    if (Math.abs(d) < 1e-9) return { origin: a.origin, normal: a.normal, kind: 'FACE' };
    return { origin: add(a.origin, mul(a.normal, d / 2)), normal: a.normal, kind: 'MIDPLANE' };
  }
  if (faces.length === 1 && !edges.length && !points.length && !curves.length) return { origin: faces[0].origin, normal: faces[0].normal, kind: 'FACE' };
  if (curves.length === 1 && !faces.length && !edges.length && !points.length) return { origin: curves[0].origin, normal: curves[0].normal, kind: 'CURVE' };
  if (faces.length) return { error: 'SELECT ONE FACE, A FACE AND AN EDGE, OR TWO PARALLEL FACES' };

  // Points, edges and curves together: every point they bring.
  const ps = [...points];
  for (const e of edges) ps.push(...e);
  if (curves.length) {
    if (curves.length > 1 && curves.every(c => Math.abs(dot(c.normal, curves[0].normal)) > 1 - 1e-6) && !edges.length && !points.length) {
      const n = curves[0].normal, o = curves[0].origin;
      if (curves.every(c => Math.abs(dot(sub(c.origin, o), n)) < 1e-6)) return { origin: mean(curves.map(c => c.origin)), normal: n, kind: 'CURVES' };
    }
    return { error: 'SELECT CURVES ON ONE PLANE, OR POINTS' };
  }
  const distinct = ps.filter((p, i) => ps.findIndex(q => len(sub(p, q)) < 1e-9) === i);
  if (distinct.length < 2) return { error: 'SELECT A FACE, A CURVE OR SOME POINTS FOR THE CONSTRUCTION PLANE' };
  const origin = mean(distinct);
  if (distinct.length === 2 || !fitNormal(distinct)) {
    // On a line: the plane through it that faces the view most.
    const far = distinct.reduce((b, p) => len(sub(p, distinct[0])) > len(sub(b, distinct[0])) ? p : b, distinct[1]);
    const d = unit(sub(far, distinct[0]));
    return { origin, normal: facing(squareTo(d, view), view), kind: 'LINE' };
  }
  if (distinct.length === 3) {
    const n = unit(cross(sub(distinct[1], distinct[0]), sub(distinct[2], distinct[0])));
    return { origin, normal: facing(n, view), kind: '3 POINTS' };
  }
  return { origin, normal: facing(fitNormal(distinct), view), kind: `${distinct.length} POINTS` };
}
