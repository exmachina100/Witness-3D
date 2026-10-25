// Plasticity's Deform Solid and Sheet in the browser build, as w3d_deform does it on the desktop:
// each body wrapped from a reference face onto a target face, every point keeping its (s, t, n)
// coordinates (see faceUvn.js) after Scale, Offset and the flips move them. Each face is refitted
// as a cubic B-spline of the warped surface over its own parameters, so its edges' curves on it
// still bound it, and the faces are sewn up again.

import { blendEdges, numbered, numberedEdges, oc } from './Kernel.js';
import { filletFaces, removeFaces } from './removeFace.js';
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
    return warpBodies(bodies, deformWarp(bodies, ref, rface, target, tface, opts), tolerance);
}

/**
 * The warp Deform puts the bodies through: a point to where it goes, keeping its (s, t, n) over the
 * reference face onto the target face after Scale, Offset and the flips.
 */
export function deformWarp(bodies, ref, rface, target, tface, opts = {}) {
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
    return p => {
        const [s, t, n] = over(p);
        return to.at([cs + (s - cs) * scale[0] + du, ct + (t - ct) * scale[1] + dv, (normal ? -n : n) * scale[2] + offset[2]]);
    };
}

/** The bodies put through `warp`, each face refitted to within `tolerance` mm and sewn up again. */
export function warpBodies(bodies, warp, tolerance = 0.01) {
    const o = oc();
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

/**
 * Deform with Reblend, as w3d_unblend on the desktop: each body's fillets taken off (see
 * removeFace.js), the sharp bodies deformed, and the edges the fillets were on rounded again at
 * their old radii, so stretched rounds come out round rather than stretched.
 */
export function deformReblend(bodies, ref, rface, target, tface, opts = {}, tolerance = 0.01) {
    const o = oc();
    // Per body: the sharp body and its fresh edges' middles, each with the radius it had.
    const unblended = bodies.map(body => {
        const rounds = filletFaces(body);
        if (!rounds.length) return { sharp: body, marks: [] };
        const faces = numbered(body, 'TopAbs_FACE').map(f => o.TopoDS.Face(f));
        const sharp = removeFaces(body, rounds);
        const kept = numberedEdges(body);
        const marks = [];
        for (const e of numberedEdges(sharp)) {
            const c = new o.BRepAdaptor_Curve(e), p = c.Value((c.FirstParameter() + c.LastParameter()) / 2);
            const at = new o.BRepBuilderAPI_MakeVertex(p).Shape();
            const gap = s => { const d = new o.BRepExtrema_DistShapeShape(at, s); return d.IsDone() ? d.Value() : Infinity; };
            if (kept.some(k => gap(k) < 1e-6)) continue;
            // The radius of the round that was nearest this edge.
            let best = null, bestD = Infinity;
            for (const n of rounds) { const d = gap(faces[n]); if (d < bestD) { bestD = d; best = n; } }
            const r = roundRadius(faces[best]);
            if (!(r > 0)) throw new Error('Reblend needs rounds of one radius each; turn Reblend off for this body');
            marks.push({ at: [p.X(), p.Y(), p.Z()], radius: r });
        }
        return { sharp, marks };
    });
    const sharps = unblended.map(u => u.sharp);
    const warp = deformWarp(sharps, ref, rface, target, tface, opts);
    return warpBodies(sharps, warp, tolerance).map((made, i) => {
        // Round the warped edges again, one radius at a time, finding them afresh each time.
        const marks = unblended[i].marks.map(m => ({ at: warp(m.at), radius: m.radius }));
        for (const radius of [...new Set(marks.map(m => m.radius))].sort((a, b) => b - a)) {
            const edges = numberedEdges(made);
            const pick = marks.filter(m => m.radius === radius).map(m => {
                const at = new o.BRepBuilderAPI_MakeVertex(new o.gp_Pnt(...m.at)).Shape();
                let best = -1, bestD = Infinity;
                edges.forEach((e, n) => { const d = new o.BRepExtrema_DistShapeShape(at, e); if (d.IsDone() && d.Value() < bestD) { bestD = d.Value(); best = n; } });
                return best;
            });
            made = blendEdges(made, [...new Set(pick)], radius);
        }
        return made;
    });
}

/** The rolling radius of a round face, or -1 when its surface has no single one. */
function roundRadius(face) {
    const o = oc(), s = new o.BRepAdaptor_Surface(face, true), T = o.GeomAbs_SurfaceType;
    switch (s.GetType()) {
        case T.GeomAbs_Cylinder: return s.Cylinder().Radius();
        case T.GeomAbs_Sphere: return s.Sphere().Radius();
        case T.GeomAbs_Torus: return s.Torus().MinorRadius();
        default: return -1;
    }
}
