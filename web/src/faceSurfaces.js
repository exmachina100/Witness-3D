// Dimension's view of a body's faces in the browser build (dimension.js reads it; the desktop
// asks w3d_face_surfaces). Kept apart so the desktop UI, which bundles dimension.js, never pulls
// in the browser kernel.
import { numbered, oc } from './Kernel.js';

const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Per face (numbered order), what it lies on: { kind: 'plane', origin, normal } with the outward
 * normal, { kind: 'cylinder', origin, axis, radius, outward }, { kind: 'sphere', centre, radius,
 * outward }, or { kind: 'other' }. `outward` is false for a hole. Mirrors w3d_face_surfaces.
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
        return { kind: 'other' };
    });
}
