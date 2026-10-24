// A sheet of one B-spline surface given as numbers, as w3d_spline_sheet makes it on the desktop:
// u and v degrees, pole counts, flat knot counts, the flat u then v knots, then the poles (x, y, z),
// rows along u. Constrained Surface fits these (constrainedSurface.js).

import { oc } from './Kernel.js';

export function splineSheet(data) {
    const o = oc();
    if (data.length < 6) throw new Error('the surface data is short');
    const [du, dv, nu, nv, nku, nkv] = data;
    if (du < 1 || dv < 1 || nu <= du || nv <= dv || nku !== nu + du + 1 || nkv !== nv + dv + 1 || data.length !== 6 + nku + nkv + 3 * nu * nv)
        throw new Error('the surface data does not add up');
    // Flat knots to distinct knots and multiplicities.
    const distinct = flat => {
        const ks = [], ms = [];
        for (const x of flat) if (ks.length && Math.abs(x - ks[ks.length - 1]) < 1e-12) ms[ms.length - 1]++; else { ks.push(x); ms.push(1); }
        return [ks, ms];
    };
    const arr = (vals, Type) => { const a = new Type(1, vals.length); vals.forEach((v, i) => a.SetValue(i + 1, v)); return a; };
    const [uk, um] = distinct(data.slice(6, 6 + nku)), [vk, vm] = distinct(data.slice(6 + nku, 6 + nku + nkv));
    const poles = new o.NCollection_Array2_gp_Pnt(1, nu, 1, nv), at = 6 + nku + nkv;
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
        const k = at + 3 * (i * nv + j);
        poles.SetValue(i + 1, j + 1, new o.gp_Pnt(data[k], data[k + 1], data[k + 2]));
    }
    const surface = new o.Geom_BSplineSurface(poles, arr(uk, o.NCollection_Array1_double), arr(vk, o.NCollection_Array1_double),
        arr(um, o.NCollection_Array1_int), arr(vm, o.NCollection_Array1_int), du, dv, false, false);
    const mk = new o.BRepBuilderAPI_MakeFace(surface, 1e-7);
    if (!mk.IsDone()) throw new Error('the surface could not be made into a sheet');
    return mk.Face();
}
