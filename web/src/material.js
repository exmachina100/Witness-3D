// Boolean's Target Material and Tool Material, as w3d_material does it on the desktop. Default takes
// a body as it is. Empty takes only its skin (a solid's faces as a sheet). Inside takes a sheet as
// solid behind its faces (against their normals); a closed sheet becomes the solid it bounds.
// Outside takes the space in front of a sheet's faces, or all the space outside a solid. A sheet's
// material reaches as far as the sheet does, so it should run right across the other body.

import { numbered, oc } from './Kernel.js';

export const MATERIALS = ['default', 'empty', 'inside', 'outside'];

/** `shape` taken as `kind`: { shape, unbounded }, unbounded when its material runs on without end. */
export function withMaterial(shape, kind = 'default') {
    const o = oc();
    if (!MATERIALS.includes(kind)) throw new Error(`no material called ${kind}`);
    const solid = numbered(shape, 'TopAbs_SOLID').length > 0;
    if (kind === 'default' || (kind === 'inside' && solid)) return { shape, unbounded: false };
    const shells = numbered(shape, 'TopAbs_SHELL').map(s => o.TopoDS.Shell(s));
    if (kind === 'empty') {
        if (!solid) return { shape, unbounded: false };
        if (shells.length === 1) return { shape: shells[0], unbounded: false };
        const b = new o.BRep_Builder(), c = new o.TopoDS_Compound();
        b.MakeCompound(c);
        for (const s of shells) b.Add(c, s);
        return { shape: c, unbounded: false };
    }
    if (shells.length > 1) throw new Error('that body has more than one skin; take it as Default or Empty');
    const faces = numbered(shape, 'TopAbs_FACE').map(f => o.TopoDS.Face(f));
    if (!faces.length) throw new Error('that body has no faces');
    // A point just off the first face, on the side the material is.
    const f = faces[0];
    const { UMin, UMax, VMin, VMax } = o.BRepTools.UVBounds(f, 0, 0, 0, 0);
    const gp = new o.BRepGProp_Face(f, false), p = new o.gp_Pnt(), n = new o.gp_Vec();
    gp.Normal((UMin + UMax) / 2, (VMin + VMax) / 2, p, n);
    if (n.Magnitude() < 1e-12) throw new Error("that body's face has no normal to tell its sides by");
    n.Normalize();
    const b = new o.Bnd_Box();
    o.BRepBndLib.Add(shape, b, false);
    const eps = 1e-4 * (1 + Math.sqrt(b.SquareExtent()));
    const out = kind === 'outside' ? 1 : -1;
    const ref = new o.gp_Pnt(p.X() + out * eps * n.X(), p.Y() + out * eps * n.Y(), p.Z() + out * eps * n.Z());
    const closed = shells.length === 1 && o.BRep_Tool.IsClosed(shells[0]);
    const half = new o.BRepPrimAPI_MakeHalfSpace(shells.length ? shells[0] : f, ref).Solid();
    return { shape: half, unbounded: kind === 'outside' || !closed };
}

/** Whether a boolean of `a` and `b` (as `withMaterial` gives them) leaves a solid without end. */
export function endless(op, a, b) {
    if (op === 'union') return a || b;
    if (op === 'intersection') return a && b;
    return a;
}
