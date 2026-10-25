// Plasticity's Deform Solid and Sheet in the browser build, as w3d_deform does it on the desktop:
// each body wrapped from a reference face onto a target face, every point keeping its (s, t, n)
// coordinates (see faceUvn.js) after Scale, Offset and the flips move them. Each face is refitted
// as a cubic B-spline of the warped surface over its own parameters, so its edges' curves on it
// still bound it, and the faces are sewn up again.

import { numbered, numberedEdges, oc } from './Kernel.js';
import { faceMap } from './faceUvn.js';
import { assemble, refit, remade } from './rebuildFace.js';

const SPANS = [2, 4, 8, 12, 16, 24];
const far = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * `bodies` (shapes) deformed from face `rface` of `ref` onto face `tface` of `target`; `opts` as
 * DEFORM in deform.js: { scale: [u, v, n], offset: [u mm, v mm, n mm], mirror, swap, normal }.
 * The warped faces stay within `tolerance` mm of the exact warp. Returns the shapes in order.
 */
export function deformBodies(bodies, ref, rface, target, tface, opts = {}, tolerance = 0.01) {
    const o = oc();
    if (!bodies.length) throw new Error('select the solids or sheets to deform');
    const { scale = [1, 1, 1], offset = [0, 0, 0], mirror = false, swap = false, normal = false } = opts;
    const from = faceMap(ref, rface), to = faceMap(target, tface);
    const flip = c => {
        let [s, t, n] = c;
        if (swap) [s, t] = [t, s];
        if (mirror) s = 1 - s;
        return [s, t, n];
    };
    const over = p => {
        try { return flip(from.uvn(p)) } catch { throw new Error('a body does not lie over the reference face') }
    };
    // The middle of the bodies on the reference, from points along their edges.
    const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
    for (const body of bodies) for (const e of numberedEdges(body)) {
        if (o.BRep_Tool.Degenerated(e)) continue;
        const c = new o.BRepAdaptor_Curve(e), a = c.FirstParameter(), b = c.LastParameter();
        for (let i = 0; i <= 4; i++) {
            const q = c.Value(a + (b - a) * i / 4), st = over([q.X(), q.Y(), q.Z()]);
            for (const k of [0, 1]) { lo[k] = Math.min(lo[k], st[k]); hi[k] = Math.max(hi[k], st[k]); }
        }
    }
    if (!(lo[0] <= hi[0])) throw new Error('select the solids or sheets to deform');
    const cs = (lo[0] + hi[0]) / 2, ct = (lo[1] + hi[1]) / 2;
    const [lu, lv] = to.size;
    const du = lu > 1e-12 ? offset[0] / lu : 0, dv = lv > 1e-12 ? offset[1] / lv : 0;
    const warp = p => {
        const [s, t, n] = over(p);
        return to.at([cs + (s - cs) * scale[0] + du, ct + (t - ct) * scale[1] + dv, (normal ? -n : n) * scale[2] + offset[2]]);
    };
    return bodies.map(body => {
        const all = numbered(body, 'TopAbs_FACE').map(f => o.TopoDS.Face(f));
        const replaced = new Map();
        let gap = 1e-4;
        all.forEach((face, i) => {
            const ad = new o.BRepAdaptor_Surface(face, true);
            const { UMin, UMax, VMin, VMax } = o.BRepTools.UVBounds(face, 0, 0, 0, 0);
            const b = [UMin, UMax, VMin, VMax];
            if (!(b[1] - b[0] > 1e-12) || !(b[3] - b[2] > 1e-12)) throw new Error('a face of that body has no area');
            // The warp of the face's surface, cached: the fit and the check sample the same grid.
            const memo = new Map();
            const at = (u, v) => {
                const key = `${u},${v}`;
                let p = memo.get(key);
                if (!p) { const q = ad.Value(u, v); memo.set(key, p = warp([q.X(), q.Y(), q.Z()])); }
                return p;
            };
            let made, dev = Infinity;
            for (const k of SPANS) {
                made = refit(at, b, [3, 3], [k, k]);
                dev = 0;
                for (let x = 0; x <= 12; x++) for (let y = 0; y <= 12; y++) {
                    // Between the fitted samples, where the fit strays most.
                    const u = b[0] + (b[1] - b[0]) * (x + 0.5) / 13, v = b[2] + (b[3] - b[2]) * (y + 0.5) / 13;
                    const q = made.Value(u, v);
                    dev = Math.max(dev, far(at(u, v), [q.X(), q.Y(), q.Z()]));
                }
                if (dev <= tolerance) break;
            }
            if (dev > tolerance * 10) throw new Error('that body bends too far to follow the target; try a flatter target, or less Scale');
            gap = Math.max(gap, dev * 1.5 + 1e-4);
            replaced.set(i, remade(face, made, b));
        });
        // assemble turns a solid the right way out, which a mirror or a flipped normal turns over.
        return assemble(body, all, replaced, gap, 'the deformed body', '; try a flatter target, or Unwrap Face of the target as the reference');
    });
}
