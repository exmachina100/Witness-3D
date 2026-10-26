// Plasticity's Thicken in the browser build, as w3d_thicken does it on the desktop: a sheet made
// solid, `front` along its faces' normals and `back` behind them. Faces meeting at an angle have
// their offsets joined where they meet (each side offset with its faces carried on to their
// intersection, then ruled walls between the two sides' open edges); a sheet of one face, or a
// join that fails, is moved back and grown by the whole thickness (the simple offset).

import { boolean, numbered, numberedEdges, oc } from './Kernel.js';
import { isSheet } from './Patch.js';

/** Sheet `shape` made solid; throws saying why when it cannot be. */
export function thicken(shape, front, back = 0) {
    const o = oc();
    if (!Number.isFinite(front) || !Number.isFinite(back)) throw new Error('the thickness is not a number');
    if (front < 0 || back < 0) throw new Error("the thicknesses can't be below zero; swap front and back instead");
    if (front + back < 1e-6) throw new Error('the sheet needs a thickness');
    if (!isSheet(shape)) throw new Error('thicken sheets; that body is already solid');
    if (!numbered(shape, 'TopAbs_FACE').length) throw new Error('that body has no faces to thicken');
    if (numbered(shape, 'TopAbs_FACE').length > 1) {
        try { return checked(joinedThicken(shape, front, back)); } catch { /* the simple offset then */ }
    }
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
    return checked(o.TopoDS.Solid(solids[0]));
}

function checked(solid) {
    const o = oc();
    o.BRepLib.OrientClosedSolid(solid);
    if (!new o.BRepCheck_Analyzer(solid, true, false, false).IsValid()) throw new Error('that thickness folds the sheet into itself; try a thinner one');
    return solid;
}

/** The sheet's two sides offset with their corners joined, closed by ruled walls along the open edges. */
function joinedThicken(shape, front, back) {
    const o = oc();
    const side = d => {
        if (d === 0) return { shape, image: e => e };
        const off = new o.BRepOffsetAPI_MakeOffsetShape();
        off.PerformByJoin(shape, d, 1e-6, o.BRepOffset_Mode.BRepOffset_Skin, false, false, o.GeomAbs_JoinType.GeomAbs_Intersection, false, new o.Message_ProgressRange());
        if (!off.IsDone() || off.Shape().IsNull()) throw new Error('no join');
        return { shape: off.Shape(), image: e => { const g = off.Generated(e); if (g.Extent() !== 1) throw new Error('no image'); return o.TopoDS.Edge(g.First()); } };
    };
    const top = side(front), bottom = side(-back);
    const faceEdges = numbered(shape, 'TopAbs_FACE').map(f => numberedEdges(f));
    const open = numberedEdges(shape).filter(e => faceEdges.filter(es => es.some(g => g.IsSame(e))).length === 1);
    const sew = new o.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);
    sew.Add(top.shape);
    sew.Add(bottom.shape);
    for (const e of open) {
        const wall = new o.BRepOffsetAPI_ThruSections(false, true, 1e-6);
        for (const s of [top, bottom]) wall.AddWire(new o.BRepBuilderAPI_MakeWire(s.image(o.TopoDS.Edge(e))).Wire());
        wall.Build(new o.Message_ProgressRange());
        if (!wall.IsDone()) throw new Error('no wall');
        sew.Add(wall.Shape());
    }
    sew.Perform(new o.Message_ProgressRange());
    const shells = numbered(sew.SewedShape(), 'TopAbs_SHELL');
    if (shells.length !== 1 || !o.BRep_Tool.IsClosed(shells[0])) throw new Error('not closed');
    const mk = new o.BRepBuilderAPI_MakeSolid();
    mk.Add(o.TopoDS.Shell(shells[0]));
    return mk.Solid();
}

/**
 * One side of Thicken Face on a solid, as w3d_face_wall does it: the solid hollowed with every face
 * but `keep` open, by `offset` (out of the body when positive), leaving a wall over just those faces.
 */
function faceWall(shape, all, keep, offset) {
    const o = oc();
    const open = new o.NCollection_List_TopoDS_Shape();
    all.forEach((f, i) => { if (!keep.has(i)) open.Append(f); });
    const mk = new o.BRepOffsetAPI_MakeThickSolid();
    try {
        mk.MakeThickSolidByJoin(shape, open, offset, 1e-6, o.BRepOffset_Mode.BRepOffset_Skin, true, false, o.GeomAbs_JoinType.GeomAbs_Intersection, false, new o.Message_ProgressRange());
    } catch { /* reported below */ }
    if (!mk.IsDone() || mk.Shape().IsNull()) throw new Error("those faces can't be thickened that far; try a thinner wall");
    const solids = numbered(mk.Shape(), 'TopAbs_SOLID');
    if (!solids.length) throw new Error('the thickened faces do not close into a solid');
    const solid = o.TopoDS.Solid(solids[0]);
    o.BRepLib.OrientClosedSolid(solid);
    if (!new o.BRepCheck_Analyzer(solid, true, false, false).IsValid()) throw new Error('that thickness folds the faces into themselves; try a thinner one');
    return solid;
}

/**
 * Plasticity's Thicken Face on a solid, as w3d_thicken_faces does it on the desktop: `faces` made a
 * solid of their own, `front` out of the body and `back` into it. The body is not changed.
 */
export function thickenFaces(shape, faces, front, back = 0) {
    if (!Number.isFinite(front) || !Number.isFinite(back)) throw new Error('the thickness is not a number');
    if (front < 0 || back < 0) throw new Error("the thicknesses can't be below zero; swap front and back instead");
    if (front + back < 1e-6) throw new Error('the faces need a thickness');
    if (!faces.length) throw new Error('select the faces to thicken');
    if (isSheet(shape)) throw new Error('thicken faces of a solid');
    const all = numbered(shape, 'TopAbs_FACE');
    const keep = new Set();
    for (const f of faces) {
        if (!Number.isInteger(f) || !all[f]) throw new Error('no such face');
        if (keep.has(f)) throw new Error('a face is picked twice');
        keep.add(f);
    }
    if (keep.size === all.length) throw new Error('leave at least one face unpicked; to thicken every face use Shell');
    const out = front > 1e-9 ? faceWall(shape, all, keep, front) : null;
    if (!(back > 1e-9)) return out;
    const inner = faceWall(shape, all, keep, -back);
    if (!out) return inner;
    const joined = numbered(boolean(out, inner, 'union'), 'TopAbs_SOLID');
    if (joined.length !== 1) throw new Error('the front and back of the faces could not be joined');
    return oc().TopoDS.Solid(joined[0]);
}
