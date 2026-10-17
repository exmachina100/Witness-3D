// Plasticity's Join (for sheets) and Unjoin in the browser build, as w3d_join_sheets and w3d_unjoin
// do them on the desktop: sheets sewn where their open edges meet within the 0.01 mm gap bar, a
// closed result made solid; a body taken apart into its faces or its separate pieces.

import { numbered, oc } from './Kernel.js';
import { isSheet } from './Patch.js';

/** How far apart sheet edges may be and still be joined: the 0.01 mm gap bar. */
const TOL = 1e-2;

const valid = s => new (oc().BRepCheck_Analyzer)(s, true, false, false).IsValid();

/** The sheets in `shapes` sewn into one body; throws saying why when they do not make one. */
export function joinSheets(shapes) {
    const o = oc();
    if (shapes.some(s => !isSheet(s))) throw new Error('join sheets; use Boolean to join solids');
    const faces = shapes.flatMap(s => numbered(s, 'TopAbs_FACE'));
    if (shapes.length < 2 || faces.length < 2) throw new Error('select two or more sheets to join');
    const sew = new o.BRepBuilderAPI_Sewing(TOL, true, true, true, false);
    for (const f of faces) sew.Add(f);
    sew.Perform(new o.Message_ProgressRange());
    const sewn = sew.SewedShape();
    const shells = numbered(sewn, 'TopAbs_SHELL');
    const inShells = shells.flatMap(s => numbered(s, 'TopAbs_FACE'));
    if (shells.length !== 1 || numbered(sewn, 'TopAbs_FACE').length !== inShells.length) {
        throw new Error('the sheets must meet edge to edge, within 0.01 mm, to join into one');
    }
    const shell = o.TopoDS.Shell(shells[0]);
    if (o.BRep_Tool.IsClosed(shell)) {
        const mk = new o.BRepBuilderAPI_MakeSolid(shell);
        if (mk.IsDone()) {
            const solid = mk.Solid();
            o.BRepLib.OrientClosedSolid(solid);
            if (valid(solid)) return solid;
        }
    }
    if (!valid(shell)) throw new Error('the joined sheet is not valid');
    return shell;
}

/** `shape` taken apart: each face as a sheet (`faces`), or each separate solid, shell or loose face. */
export function unjoin(shape, faces) {
    const o = oc();
    let pieces;
    if (faces) pieces = numbered(shape, 'TopAbs_FACE');
    else {
        const solids = numbered(shape, 'TopAbs_SOLID');
        const inSolids = s => solids.some(so => numbered(so, 'TopAbs_SHELL').some(t => t.IsSame(s)));
        const shells = numbered(shape, 'TopAbs_SHELL').filter(s => !inSolids(s));
        const covered = [...solids, ...shells].flatMap(s => numbered(s, 'TopAbs_FACE'));
        const loose = numbered(shape, 'TopAbs_FACE').filter(f => !covered.some(c => c.IsSame(f)));
        pieces = [...solids, ...shells, ...loose];
    }
    if (pieces.length < 2) throw new Error(faces ? 'that body has only one face' : 'that body is all one piece; unjoin its faces instead');
    return pieces;
}
