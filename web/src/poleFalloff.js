// Proportional move and Mirror for face control points.
//
// A face's net is rows × columns of points; a point's place in it is (row, column), the u and v
// counts along the hull. With Proportional set, points near the picked ones follow them, less the
// further they are: a picked point moves fully, a point Falloff U rows (or Falloff V columns) away
// not at all, with a smooth step between.
//   NONE      only the picked points move.
//   ALL       every point of the picked points' faces moves, by its distance to the nearest pick.
//   SELECTED  only the picked points move, the middle of the picks fully, the outer ones less.
// Mirror moves the point opposite each moved one across the middle of the net (U: the rows
// mirrored, V: the columns), its move reflected so the face stays symmetric.

/** 1 at r = 0, 0 from r = 1 on, smooth in between. */
export const falloff = r => r >= 1 ? 0 : 1 - r * r * (3 - 2 * r);

/**
 * The points that move and how much: [{ face, n, w }] for `picked` ([{ face, n }]) in `nets`
 * (each face's rows of points). `opts`: { mode: 'none'|'all'|'selected', fu, fv }.
 */
export function weights(nets, picked, { mode = 'none', fu = 2, fv = 2 } = {}) {
  const out = [], seen = new Set(), add = (face, n, w) => {
    const key = `${face}:${n}`;
    if (seen.has(key) || !(w > 1e-9)) return;
    seen.add(key);
    out.push({ face, n, w });
  };
  const byFace = new Map();
  for (const p of picked) (byFace.get(p.face) ?? byFace.set(p.face, []).get(p.face)).push(p.n);
  for (const [face, ns] of byFace) {
    const nv = nets[face]?.[0]?.length ?? 1, nu = nets[face]?.length ?? 1;
    const at = n => [Math.floor(n / nv), n % nv];
    const dist = ([i, j], [a, b]) => Math.hypot((i - a) / Math.max(fu, 1e-9), (j - b) / Math.max(fv, 1e-9));
    if (mode === 'all') {
      const picks = ns.map(at);
      for (const n of ns) add(face, n, 1);
      for (let n = 0; n < nu * nv; n++) add(face, n, Math.max(...picks.map(p => falloff(dist(at(n), p)))));
    } else if (mode === 'selected' && ns.length > 2) {
      const picks = ns.map(at), mid = [0, 1].map(k => picks.reduce((s, p) => s + p[k], 0) / picks.length);
      const reach = Math.max(...picks.map(p => dist(p, mid))) + Math.hypot(1 / fu, 1 / fv);
      ns.forEach((n, k) => add(face, n, falloff(dist(picks[k], mid) / reach)));
    } else for (const n of ns) add(face, n, 1);
  }
  return out;
}

/** The point across the net from point `n` of a rows × columns net: 'u' mirrors rows, 'v' columns. */
export function mirrorOf(nu, nv, n, mirror) {
  const i = Math.floor(n / nv), j = n % nv;
  const m = mirror === 'u' ? (nu - 1 - i) * nv + j : mirror === 'v' ? i * nv + (nv - 1 - j) : n;
  return m === n ? null : m;
}

/**
 * The moves [[face, n, by]] of `picked` in `nets`, `by(q)` giving a point's full move from where
 * it is, with Proportional and Mirror (`opts.mirror`: 'none'|'u'|'v') applied.
 */
export function poleMoves(nets, picked, by, opts = {}) {
  const pt = (face, n) => nets[face]?.flat()[n];
  const list = weights(nets, picked, opts), moves = new Map();
  const put = (face, n, d) => moves.has(`${face}:${n}`) || moves.set(`${face}:${n}`, [face, n, d]);
  for (const { face, n, w } of list) put(face, n, by(pt(face, n)).map(x => x * w));
  if (opts.mirror === 'u' || opts.mirror === 'v') {
    for (const { face, n, w } of list) {
      const rows = nets[face], m = mirrorOf(rows.length, rows[0].length, n, opts.mirror);
      if (m == null || moves.has(`${face}:${m}`)) continue;
      const p = pt(face, n), q = pt(face, m), d = by(p).map(x => x * w);
      // Reflect the move in the plane half way between the two points.
      const ax = [0, 1, 2].map(k => q[k] - p[k]), len = Math.hypot(...ax);
      if (len < 1e-9) continue;
      const u = ax.map(x => x / len), dot = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
      put(face, m, d.map((x, k) => x - 2 * dot * u[k]));
    }
  }
  return [...moves.values()];
}
