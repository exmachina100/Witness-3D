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

/**
 * Plasticity's Unjoin Faces: only the `picked` faces (numbers) of `shape` come away. The rest stays
 * one sheet (first), and the picked faces become sheets, faces that touch sewn together. With every
 * face picked, each face is a sheet of its own (as desktop's Document::preview_unjoin_faces).
 */
export function unjoinFaces(shape, picked) {
    if (!picked?.length) throw new Error('select the faces to unjoin');
    const faces = unjoin(shape, true);
    if (picked.some(n => n < 0 || n >= faces.length)) throw new Error('that face no longer exists');
    const away = faces.filter((_, i) => picked.includes(i)), rest = faces.filter((_, i) => !picked.includes(i));
    if (!rest.length) return away;
    return [...sewTouching(rest), ...sewTouching(away)];
}

/** Plasticity's Duplicate of faces: copies of the `picked` faces of `shape` as sheets, touching ones sewn together. */
export function copyFaces(shape, picked) {
    if (!picked?.length) throw new Error('select the faces to duplicate');
    const faces = numbered(shape, 'TopAbs_FACE');
    if (picked.some(n => n < 0 || n >= faces.length)) throw new Error('that face no longer exists');
    const o = oc(), copy = f => new o.BRepBuilderAPI_Transform(f, new o.gp_Trsf(), true, false).Shape();
    return sewTouching(picked.map(n => copy(faces[n])));
}

/** Face sheets sewn into as few sheets as they make: one per group of faces that touch. */
function sewTouching(faces) {
    if (faces.length < 2) return faces;
    const tryJoin = list => { try { return joinSheets(list) } catch { return null } };
    const one = tryJoin(faces);
    if (one) return [one];
    const left = [...faces], out = [];
    while (left.length) {
        const group = [left.shift()];
        for (let grew = true; grew;) {
            grew = false;
            for (let i = 0; i < left.length;) {
                if (tryJoin([...group, left[i]])) { group.push(...left.splice(i, 1)); grew = true } else i++;
            }
        }
        out.push(...(group.length === 1 ? group : [tryJoin(group) ?? group].flat()));
    }
    return out;
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
