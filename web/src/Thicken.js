// Plasticity's Thicken in the browser build, as w3d_thicken does it on the desktop: a sheet made
// solid, `front` along its faces' normals and `back` behind them. The sheet is first moved back,
// then grown by the whole thickness with ruled walls along its open edges (the simple offset).

import { numbered, oc } from './Kernel.js';
import { isSheet } from './Patch.js';

/** Sheet `shape` made solid; throws saying why when it cannot be. */
export function thicken(shape, front, back = 0) {
    const o = oc();
    if (!Number.isFinite(front) || !Number.isFinite(back)) throw new Error('the thickness is not a number');
    if (front < 0 || back < 0) throw new Error("the thicknesses can't be below zero; swap front and back instead");
    if (front + back < 1e-6) throw new Error('the sheet needs a thickness');
    if (!isSheet(shape)) throw new Error('thicken sheets; that body is already solid');
    if (!numbered(shape, 'TopAbs_FACE').length) throw new Error('that body has no faces to thicken');
    let base = shape;
    if (back > 0) {
        const off = new o.BRepOffsetAPI_MakeOffsetShape();
        off.PerformBySimple(shape, -back);
        if (!off.IsDone() || off.Shape().IsNull()) throw new Error('the sheet can\'t be moved that far back; try a thinner back');
        base = off.Shape();
    }
    const mk = new o.BRepOffsetAPI_MakeThickSolid();
    mk.MakeThickSolidBySimple(base, front + back);
    if (!mk.IsDone() || mk.Shape().IsNull()) throw new Error('the sheet can\'t be thickened; its open edges must form clean loops and its faces join edge to edge');
    const solids = numbered(mk.Shape(), 'TopAbs_SOLID');
    if (!solids.length) throw new Error('the thickened sheet does not close into a solid');
    const solid = o.TopoDS.Solid(solids[0]);
    o.BRepLib.OrientClosedSolid(solid);
    if (!new o.BRepCheck_Analyzer(solid, true, false, false).IsValid()) throw new Error('that thickness folds the sheet into itself; try a thinner one');
    return solid;
}
