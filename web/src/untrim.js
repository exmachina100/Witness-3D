// Plasticity's Untrim in the browser build, as w3d_untrim_face does it on the desktop: a sheet of
// the whole surface under a face, out to the surface's own bounds (a plane, or the open direction
// of a cylinder or cone, out to the face's extent). Keep edges imprints the face's edges on it.

import { numbered, numberedEdges, oc } from './Kernel.js';

/** A sheet of the whole surface under face `index` of `shape`, its edges imprinted when `keep`. */
export function untrimFace(shape, index, keep = false) {
    const o = oc();
    const face = numbered(shape, 'TopAbs_FACE')[index];
    if (!face) throw new Error('that face no longer exists');
    const f = o.TopoDS.Face(face);
    const { UMin, UMax, VMin, VMax } = o.BRepTools.UVBounds(f, 0, 0, 0, 0);
    const whole = new o.BRepAdaptor_Surface(f, false);
    const b = [whole.FirstUParameter(), whole.LastUParameter(), whole.FirstVParameter(), whole.LastVParameter()];
    if (!(Math.abs(b[0]) < 1e50 && Math.abs(b[1]) < 1e50)) { b[0] = UMin; b[1] = UMax; }
    if (!(Math.abs(b[2]) < 1e50 && Math.abs(b[3]) < 1e50)) { b[2] = VMin; b[3] = VMax; }
    const mk = new o.BRepBuilderAPI_MakeFace(o.BRep_Tool.Surface(f), b[0], b[1], b[2], b[3], 1e-7);
    if (!mk.IsDone()) throw new Error("the face's surface could not be made into a sheet");
    let sheet = mk.Face();
    sheet.Orientation(f.Orientation());
    if (!keep) return sheet;
    const tb = new o.TopoDS_Builder(), edges = new o.TopoDS_Compound();
    tb.MakeCompound(edges);
    for (const e of numberedEdges(f)) if (!o.BRep_Tool.Degenerated(e)) tb.Add(edges, e);
    const args = new o.NCollection_List_TopoDS_Shape(), tools = new o.NCollection_List_TopoDS_Shape();
    args.Append(sheet);
    tools.Append(edges);
    const split = new o.BRepAlgoAPI_Splitter();
    split.SetArguments(args);
    split.SetTools(tools);
    split.SetFuzzyValue(1e-6);
    split.Build(new o.Message_ProgressRange());
    if (!split.IsDone() || split.HasErrors()) throw new Error("the face's edges could not be imprinted on the sheet");
    const pieces = numbered(split.Shape(), 'TopAbs_FACE');
    if (pieces.length < 2) return sheet;
    const shell = new o.TopoDS_Shell();
    tb.MakeShell(shell);
    for (const p of pieces) tb.Add(shell, p);
    return shell;
}

/** Shapes as one, for a preview of several sheets. */
export function compound(shapes) {
    const o = oc(), tb = new o.TopoDS_Builder(), all = new o.TopoDS_Compound();
    tb.MakeCompound(all);
    for (const s of shapes) tb.Add(all, s);
    return all;
}
