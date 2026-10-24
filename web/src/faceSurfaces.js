// Dimension's view of a body's faces in the browser build (dimension.js reads it; the desktop
// asks w3d_face_surfaces). Kept apart so the desktop UI, which bundles dimension.js, never pulls
// in the browser kernel.
import { numbered, oc } from './Kernel.js';

const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Per face (numbered order), what it lies on: { kind: 'plane', origin, normal } with the outward
 * normal, { kind: 'cylinder', origin, axis, radius, outward }, { kind: 'sphere', centre, radius,
 * outward }, { kind: 'round', radius } for a spline round of one radius, or { kind: 'other' }.
 * `outward` is false for a hole. Mirrors w3d_face_surfaces.
 */
export function faceSurfaces(shape) {
    const o = oc();
    return numbered(shape, 'TopAbs_FACE').map(f => {
        const face = o.TopoDS.Face(f), sa = new o.BRepAdaptor_Surface(face, true);
        const u = (sa.FirstUParameter() + sa.LastUParameter()) / 2, v = (sa.FirstVParameter() + sa.LastVParameter()) / 2;
        const p = new o.gp_Pnt(), n = new o.gp_Vec();
        new o.BRepGProp_Face(face, false).Normal(u, v, p, n);
        const P = [p.X(), p.Y(), p.Z()], N = [n.X(), n.Y(), n.Z()];
        const xyz = q => [q.X(), q.Y(), q.Z()];
        const type = sa.GetType();
        if (type === o.GeomAbs_SurfaceType.GeomAbs_Plane) {
            const len = Math.hypot(...N) || 1;
            return { kind: 'plane', origin: xyz(sa.Plane().Location()), normal: N.map(c => c / len) };
        }
        if (type === o.GeomAbs_SurfaceType.GeomAbs_Cylinder) {
            const cyl = sa.Cylinder(), origin = xyz(cyl.Location()), axis = xyz(cyl.Axis().Direction());
            const w = sub(P, origin), radial = sub(w, axis.map(c => c * dot(w, axis)));
            return { kind: 'cylinder', origin, axis, radius: cyl.Radius(), outward: dot(N, radial) >= 0 };
        }
        if (type === o.GeomAbs_SurfaceType.GeomAbs_Sphere) {
            const sph = sa.Sphere(), centre = xyz(sph.Location());
            return { kind: 'sphere', centre, radius: sph.Radius(), outward: dot(N, sub(P, centre)) >= 0 };
        }
        // A spline bent to one radius throughout (a round made as a B-spline).
        const ks = [];
        for (const a of [0.2, 0.5, 0.8]) for (const b of [0.2, 0.5, 0.8]) {
            ks.push(largestCurvature(sa, sa.FirstUParameter() + a * (sa.LastUParameter() - sa.FirstUParameter()), sa.FirstVParameter() + b * (sa.LastVParameter() - sa.FirstVParameter())));
        }
        const lo = Math.min(...ks), hi = Math.max(...ks);
        if (lo > 1e-9 && hi - lo <= 1e-3 * lo) return { kind: 'round', radius: 2 / (lo + hi) };
        return { kind: 'other' };
    });
}

/** The larger of the surface's principal curvatures at (u, v), by size; 0 where it degenerates. As w3d_largest_curvature. */
function largestCurvature(sa, u, v) {
    const o = oc(), p = new o.gp_Pnt();
    const [du, dv, duu, dvv, duv] = [0, 1, 2, 3, 4].map(() => new o.gp_Vec());
    sa.D2(u, v, p, du, dv, duu, dvv, duv);
    const x = w => [w.X(), w.Y(), w.Z()];
    const [Du, Dv, Duu, Dvv, Duv] = [du, dv, duu, dvv, duv].map(x);
    const c = [Du[1] * Dv[2] - Du[2] * Dv[1], Du[2] * Dv[0] - Du[0] * Dv[2], Du[0] * Dv[1] - Du[1] * Dv[0]];
    const len = Math.hypot(...c);
    if (len < 1e-12) return 0;
    const n = c.map(v => v / len);
    const E = dot(Du, Du), F = dot(Du, Dv), G = dot(Dv, Dv), L = dot(Duu, n), M = dot(Duv, n), N = dot(Dvv, n);
    const det = E * G - F * F;
    if (det < 1e-24) return 0;
    const K = (L * N - M * M) / det, H = (E * N - 2 * F * M + G * L) / (2 * det);
    const s = Math.sqrt(Math.max(0, H * H - K));
    return Math.max(Math.abs(H + s), Math.abs(H - s));
}
