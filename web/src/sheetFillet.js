// Plasticity's Bridge Surface between two crossing sheets, in the browser build (the desktop has
// w3d_sheet_fillet): each sheet is split where the other crosses it, one piece of each is kept
// (Sense 1 and 2 pick the other piece), the two pieces are sewn along the crossing and that edge is
// rounded (G2) or chamfered by Width. The walls come back trimmed to the bridge, with the bridge on
// its own, so Trim walls can choose which to keep (see trimWalls).

import { numbered, numberedEdges, oc } from './Kernel.js';
import { reshapeRounds } from './filletShape.js';

const area = f => { const o = oc(), p = new o.GProp_GProps(); o.BRepGProp.SurfaceProperties(f, p, false, false); return p.Mass(); };
const touches = (a, b, tol) => { const d = new (oc().BRepExtrema_DistShapeShape)(a, b); return d.IsDone() && d.Value() < tol; };

function run(algo, what) {
    if (!algo.IsDone() || algo.HasErrors()) throw new Error(what);
    return algo.Shape();
}

function sew(shapes) {
    const o = oc(), s = new o.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);
    for (const x of shapes) s.Add(x);
    s.Perform(new o.Message_ProgressRange());
    return s.SewedShape();
}

/** A shape's faces gathered as one compound (a sheet of loose faces). */
function compound(faces) {
    const o = oc(), b = new o.TopoDS_Builder(), c = new o.TopoDS_Compound();
    b.MakeCompound(c);
    for (const f of faces) b.Add(c, f);
    return c;
}

/**
 * The bridge between sheets `a` and `b` (one face each) where they cross: { a, b, bridge }, the
 * kept piece of each trimmed back to the bridge, and the bridge's faces. `sense` flips the piece
 * kept of each (by default the larger), `shape` is 'g2' or 'chamfer'.
 */
export function sheetFillet(a, b, { width, shape = 'g2', sense = [false, false] }) {
    const o = oc();
    if (!(width > 0)) throw new Error('the width must be above zero');
    const fa = numbered(a, 'TopAbs_FACE'), fb = numbered(b, 'TopAbs_FACE');
    if (fa.length !== 1 || fb.length !== 1) throw new Error('select two sheets of one face each that cross');
    const fuse = run(new o.BRepAlgoAPI_Fuse(a, b, new o.Message_ProgressRange()), 'the sheets could not be crossed');
    const pieces = numbered(fuse, 'TopAbs_FACE').map(f => o.TopoDS.Face(f));
    const size = Math.sqrt(area(o.TopoDS.Face(fa[0])) + area(o.TopoDS.Face(fb[0]))), tol = 1e-6 * Math.max(1, size);
    // Each piece belongs to the sheet whose surface it lies on (its middle on that sheet).
    const on = (f, s) => { const p = new o.GProp_GProps(); o.BRepGProp.SurfaceProperties(f, p, false, false); return touches(new o.BRepBuilderAPI_MakeVertex(p.CentreOfMass()).Vertex(), s, 1e-4 * Math.max(1, size)); };
    const ofA = pieces.filter(f => on(f, a) && !on(f, b)), ofB = pieces.filter(f => on(f, b) && !on(f, a));
    if (ofA.length < 2 || ofB.length < 2) throw new Error('the sheets do not cross; to bridge sheets apart, pick an edge of each');
    if (ofA.length > 2 || ofB.length > 2) throw new Error('the sheets cross more than once; trim them so they cross along one line');
    const pick = (two, flip) => { const [x, y] = [...two].sort((p, q) => area(q) - area(p)); return flip ? y : x; };
    const ka = pick(ofA, sense[0]), kb = pick(ofB, sense[1]);
    const shell = sew([ka, kb]);
    const ea = numberedEdges(ka), eb = numberedEdges(kb);
    const edges = numberedEdges(shell);
    const shared = edges.map((e, n) => [e, n]).filter(([e]) => ea.some(x => touches(x, e, tol) && sameRun(x, e, tol)) && eb.some(x => touches(x, e, tol) && sameRun(x, e, tol))).map(([, n]) => n);
    if (!shared.length) throw new Error('the kept pieces do not meet along the crossing');
    const mk = shape === 'chamfer' ? new o.BRepFilletAPI_MakeChamfer(shell) : new o.BRepFilletAPI_MakeFillet(shell, o.ChFi3d_FilletShape.ChFi3d_Rational);
    for (const n of shared) mk.Add(width, edges[n]);
    try { mk.Build(new o.Message_ProgressRange()); } catch { throw new Error('a bridge that wide does not fit between the sheets'); }
    if (!mk.IsDone()) throw new Error('a bridge that wide does not fit between the sheets');
    let out = mk.Shape();
    // The bridge's faces: those lying on neither sheet.
    const faces = () => numbered(out, 'TopAbs_FACE').map(f => o.TopoDS.Face(f));
    const bridgeOf = () => faces().map((f, n) => [f, n]).filter(([f]) => !on(f, a) && !on(f, b)).map(([, n]) => n);
    if (shape === 'g2') out = reshapeRounds(out, bridgeOf(), 'g2', 0.5);
    const all = faces(), rounds = new Set(bridgeOf());
    const part = keep => compound(all.filter((f, n) => keep(f, n)));
    return {
        a: part((f, n) => !rounds.has(n) && on(f, a)),
        b: part((f, n) => !rounds.has(n) && on(f, b)),
        bridge: part((_, n) => rounds.has(n)),
        aArea: all.filter((f, n) => !rounds.has(n) && on(f, a)).reduce((s, f) => s + area(f), 0),
        bArea: all.filter((f, n) => !rounds.has(n) && on(f, b)).reduce((s, f) => s + area(f), 0),
    };
}

/** Whether edges `x` and `e` run the same way along the same line (their middles meet). */
function sameRun(x, e, tol) {
    const o = oc(), mid = g => { const c = new o.BRepAdaptor_Curve(g); return c.Value((c.FirstParameter() + c.LastParameter()) / 2); };
    return touches(new o.BRepBuilderAPI_MakeVertex(mid(e)).Vertex(), x, tol * 10);
}

/**
 * Trim walls: what becomes of the two sheets. 'both' gives one body, both walls trimmed and the
 * bridge sewn between; 'short' or 'long' trims only the wall with the smaller or larger kept area,
 * sewn to the bridge, the other sheet staying whole; 'none' leaves both sheets and adds the bridge.
 * Returns { a, b, bridge }: the new shape for each sheet (null when it goes) and a new body or null.
 */
export function trimWalls(a, b, r, trim = 'both') {
    if (trim === 'both') return { a: sew([r.a, r.bridge, r.b]), b: null, bridge: null };
    if (trim === 'none') return { a, b, bridge: sew([r.bridge]) };
    const aShort = r.aArea <= r.bArea, trimA = trim === 'short' ? aShort : !aShort;
    return trimA ? { a: sew([r.a, r.bridge]), b, bridge: null } : { a, b: sew([r.b, r.bridge]), bridge: null };
}
