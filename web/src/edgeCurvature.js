// Plasticity's Toggle Surface Curvature in the browser build, as w3d_edge_curvature does it on the
// desktop: comb teeth along a body's edge, each standing away from the centre of the bend and as
// long as the curvature (1 / radius) is strong. Straight stretches have none.

import { numberedEdges, oc } from './Kernel.js';

/** `n + 1` teeth { at, dir, k } along edge `index` of `shape`. */
export function edgeCurvature(shape, index, n = 160) {
    const o = oc();
    const e = numberedEdges(shape)[index];
    if (!e) throw new Error('that edge no longer exists');
    if (o.BRep_Tool.Degenerated(e)) throw new Error('that edge is a single point');
    n = Math.max(1, Math.round(n));
    const c = new o.BRepAdaptor_Curve(e), t0 = c.FirstParameter(), t1 = c.LastParameter();
    const p = new o.gp_Pnt(), d1 = new o.gp_Vec(), d2 = new o.gp_Vec();
    const out = [];
    for (let i = 0; i <= n; i++) {
        c.D2(t0 + (t1 - t0) * i / n, p, d1, d2);
        const b = d1.Crossed(d2), s = d1.Magnitude();
        let k = 0, dir = [0, 0, 0];
        if (s > 1e-12 && b.Magnitude() > 1e-12 * s ** 3) {
            k = b.Magnitude() / s ** 3;
            // The principal normal points at the centre; the teeth stand on the other side.
            const away = d1.Crossed(b);
            const m = away.Magnitude();
            dir = [away.X() / m, away.Y() / m, away.Z() / m];
        }
        out.push({ at: [p.X(), p.Y(), p.Z()], dir, k });
    }
    return out;
}
