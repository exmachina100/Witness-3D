// Plasticity's fillet Shape in the browser build. Chordal, as blend::blend does it on the desktop:
// the distance is the width across the round (its chord), so each edge's radius is the distance
// over 2 sin(θ/2), θ the angle between its faces' normals; edges at different angles keep their own
// radius as variable points. Full rounds a face away between two edges. Conic and G2 reshape the
// rounds a fillet made, as w3d_reshape_fillets (reshapeRounds).

import { numbered, numberedEdges, oc } from './Kernel.js';
import { assemble, refit, remade } from './rebuildFace.js';

/** The angle (radians) between the outward normals of the two faces at the middle of edge `index`, or -1. */
export function edgeTurn(shape, index) {
    const o = oc();
    const edge = numberedEdges(shape)[index];
    if (!edge) throw new Error('an edge in the selection is not on this body; select the edges again');
    const faces = numbered(shape, 'TopAbs_FACE').map(f => o.TopoDS.Face(f)).filter(f => numberedEdges(f).some(e => e.IsSame(edge)));
    if (faces.length !== 2) return -1;
    const c = new o.BRepAdaptor_Curve(edge), t = (c.FirstParameter() + c.LastParameter()) / 2;
    const [a, b] = faces.map(f => {
        const uv = new o.BRepAdaptor_Curve2d(edge, f).Value(t);
        const s = new o.BRepAdaptor_Surface(f, true), p = new o.gp_Pnt(), du = new o.gp_Vec(), dv = new o.gp_Vec();
        s.D1(uv.X(), uv.Y(), p, du, dv);
        const n = du.Crossed(dv);
        if (f.Orientation() === o.TopAbs_Orientation.TopAbs_REVERSED) n.Reverse();
        return n;
    });
    return a.Angle(b);
}

/** A chordal round's radius and, where the edges' angles differ, the variable points that hold each edge's own. */
export function chordal(shape, edges, size) {
    const o = oc();
    const radii = edges.map(e => {
        const turn = edgeTurn(shape, e);
        if (!(turn > 1e-6)) throw new Error('a chordal round needs faces that meet at an angle');
        return size / (2 * Math.sin(turn / 2));
    });
    const r = radii[0];
    if (radii.every(x => Math.abs(x - r) <= 1e-9 * r)) return { size: r, variable: [] };
    const all = numberedEdges(shape), variable = [];
    edges.forEach((e, i) => {
        const c = new o.BRepAdaptor_Curve(all[e]), t0 = c.FirstParameter(), t1 = c.LastParameter();
        for (const t of [t0, (t0 + t1) / 2, t1]) {
            const p = c.Value(t);
            variable.push({ edge: e, point: [p.X(), p.Y(), p.Z()], scale: radii[i] / r });
        }
    });
    return { size: r, variable };
}

/** The direction of the picked edges at `p` (along the nearest piece of each edge sampled), or null off them. */
function along(shape, edges, p) {
    const o = oc(), all = numberedEdges(shape);
    let best = Infinity, dir = null;
    for (const e of edges) {
        const c = new o.BRepAdaptor_Curve(all[e]), t0 = c.FirstParameter(), t1 = c.LastParameter(), n = 256;
        let prev = null;
        for (let i = 0; i <= n; i++) {
            const q = c.Value(t0 + (t1 - t0) * i / n), cur = [q.X(), q.Y(), q.Z()];
            if (prev) {
                const d = cur.map((v, k) => v - prev[k]), dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
                if (dd > 1e-24) {
                    const s = Math.min(1, Math.max(0, ((p[0] - prev[0]) * d[0] + (p[1] - prev[1]) * d[1] + (p[2] - prev[2]) * d[2]) / dd));
                    const gap = Math.hypot(...prev.map((v, k) => v + d[k] * s - p[k]));
                    if (gap < best) { best = gap; dir = d.map(v => v / Math.sqrt(dd)); }
                }
            }
            prev = cur;
        }
    }
    return best <= 1e-3 ? dir : null;
}

/**
 * Plasticity's limit points (L), as blend::limited on the desktop: `rounded` (`shape` with the
 * round) kept only between the planes square to the edges through the two `limits`, the round
 * ending flat there. Returns the result of `shape` minus what the round took off between them.
 */
export function limitRound(shape, rounded, edges, limits, booleanWithHistory) {
    const o = oc();
    if (limits.length !== 2) throw new Error('place two limit points, one at each end of the stretch to round');
    const [a, b] = limits;
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-6) throw new Error('the limit points are on top of each other');
    const ta = along(shape, edges, a), tb = along(shape, edges, b);
    if (!ta || !tb) throw new Error('a limit point is not on an edge being rounded');
    const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const ab = b.map((v, k) => v - a[k]);
    const na = dot(ta, ab) >= 0 ? ta : ta.map(v => -v), nb = dot(tb, ab) <= 0 ? tb : tb.map(v => -v);
    const step = (Op, x, y) => {
        const r = new Op(x, y, new o.Message_ProgressRange());
        if (!r.IsDone() || r.HasErrors()) throw new Error('the round could not be cut at a limit point');
        return r.Shape();
    };
    let piece = step(o.BRepAlgoAPI_Cut, shape, rounded);
    const box = new o.Bnd_Box();
    o.BRepBndLib.Add(shape, box, false);
    const size = Math.sqrt(box.SquareExtent()) * 4;
    for (const [p, n] of [[a, na], [b, nb]]) {
        const face = new o.BRepBuilderAPI_MakeFace(new o.gp_Pln(new o.gp_Pnt(...p), new o.gp_Dir(...n)), -size, size, -size, size).Face();
        const half = new o.BRepPrimAPI_MakeHalfSpace(face, new o.gp_Pnt(...p.map((v, k) => v + n[k] * size / 2))).Solid();
        piece = step(o.BRepAlgoAPI_Common, piece, half);
    }
    if (!numbered(piece, 'TopAbs_SOLID').length) throw new Error('the limit points leave nothing of the round');
    return booleanWithHistory(shape, piece, 'difference');
}

/**
 * Plasticity's fillet Shape Full, as blend::full_round on the desktop: two straight, parallel edges
 * of one flat face; the circle tangent to that face and the flat faces beside both edges, swept
 * along them, takes the place of the face. Returns `booleanWithHistory`'s result.
 */
export function fullRound(shape, edges, booleanWithHistory) {
    const o = oc();
    if (edges.length !== 2) throw new Error('a full round takes two edges of one face, one on each side of it');
    const all = numberedEdges(shape);
    const faces = numbered(shape, 'TopAbs_FACE').map(f => o.TopoDS.Face(f));
    const v = p => [p.X(), p.Y(), p.Z()];
    const sub = (a, b) => a.map((x, k) => x - b[k]), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const unit = a => { const l = Math.hypot(...a); return a.map(x => x / l); };
    // Each edge's ends and, for each face along it, the face and its outward normal at the middle.
    const sides = edges.map(i => {
        const edge = all[i];
        if (!edge) throw new Error('an edge in the selection is not on this body; select the edges again');
        const c = new o.BRepAdaptor_Curve(edge);
        if (c.GetType() !== o.GeomAbs_CurveType.GeomAbs_Line) throw new Error('a full round needs straight edges');
        const t0 = c.FirstParameter(), t1 = c.LastParameter(), tm = (t0 + t1) / 2;
        const along = faces.map((f, n) => ({ f, n })).filter(({ f }) => numberedEdges(f).some(e => e.IsSame(edge))).map(({ f, n }) => {
            const s = new o.BRepAdaptor_Surface(f, true);
            if (s.GetType() !== o.GeomAbs_SurfaceType.GeomAbs_Plane) return { n, normal: null };
            const uv = new o.BRepAdaptor_Curve2d(edge, f).Value(tm);
            const p = new o.gp_Pnt(), du = new o.gp_Vec(), dv = new o.gp_Vec();
            s.D1(uv.X(), uv.Y(), p, du, dv);
            const nn = du.Crossed(dv);
            if (f.Orientation() === o.TopAbs_Orientation.TopAbs_REVERSED) nn.Reverse();
            return { n, normal: unit([nn.X(), nn.Y(), nn.Z()]) };
        });
        return { a: v(c.Value(t0)), b: v(c.Value(t1)), along };
    });
    const [s1, s2] = sides;
    const dir = unit(sub(s1.b, s1.a));
    if (Math.abs(dot(dir, unit(sub(s2.b, s2.a)))) < 1 - 1e-6) throw new Error('a full round needs two parallel edges');
    const shared = s1.along.filter(x => s2.along.some(y => y.n === x.n));
    if (shared.length !== 1 || !shared[0].normal) throw new Error('a full round needs two edges of one flat face, one on each side of it');
    const m = shared[0];
    const other = s => { const r = s.along.filter(x => x.n !== m.n); if (r.length !== 1 || !r[0].normal) throw new Error('a full round needs flat faces beside both edges'); return r[0].normal; };
    const na = other(s1), nb = other(s2), nm = m.normal;
    if ([na, nb, nm].some(n => Math.abs(dot(n, dir)) > 1e-6)) throw new Error('a full round needs faces that run along the edges');
    // The cross-section square to the edges: x from the first edge to the second, y across.
    const origin = s1.a, d2 = sub(s2.a, origin);
    const across = sub(d2, dir.map(x => x * dot(d2, dir)));
    const width = Math.hypot(...across);
    if (width < 1e-9) throw new Error('the two edges are on top of each other');
    const x = across.map(c => c / width), y = cross(dir, x);
    const flat = n => [dot(n, x), dot(n, y)];
    // n·c + r = n·p for each face's line (n outward, p on it): the circle sits inside all three.
    const rows = [[...flat(na), 1, 0], [...flat(nb), 1, flat(nb)[0] * width], [...flat(nm), 1, 0]];
    const det = M => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    const M = rows.map(r => r.slice(0, 3)), d0 = det(M);
    if (Math.abs(d0) < 1e-12) throw new Error('no circle touches all three faces');
    const [cx, cy, r] = [0, 1, 2].map(col => det(M.map((row, i) => row.map((val, j) => j === col ? rows[i][3] : val))) / d0);
    if (!(r > 1e-9)) throw new Error('no circle touches all three faces from inside the body');
    const lo = Math.min(...[s1.a, s1.b, s2.a, s2.b].map(p => dot(sub(p, origin), dir)));
    const hi = Math.max(...[s1.a, s1.b, s2.a, s2.b].map(p => dot(sub(p, origin), dir)));
    const at = ([u, w]) => new o.gp_Pnt(...[0, 1, 2].map(k => origin[k] + dir[k] * lo + x[k] * u + y[k] * w));
    const push = (n, [u, w]) => { const [px, py] = flat(n.map((c, k) => c + nm[k])); return [u + 0.1 * r * px, w + 0.1 * r * py]; };
    const tangent = n => { const [fx, fy] = flat(n); return [cx + r * fx, cy + r * fy]; };
    const wire = new o.BRepBuilderAPI_MakeWire();
    const ring = [tangent(na), push(na, [0, 0]), push(nb, [width, 0]), tangent(nb)].map(at);
    ring.forEach((p, i) => wire.Add(new o.BRepBuilderAPI_MakeEdge(p, ring[(i + 1) % 4]).Edge()));
    const len = new o.gp_Vec(...dir.map(c => c * (hi - lo)));
    const corner = new o.BRepPrimAPI_MakePrism(new o.BRepBuilderAPI_MakeFace(wire.Wire(), true).Face(), len, false, true).Shape();
    const rod = new o.BRepPrimAPI_MakeCylinder(new o.gp_Ax2(at([cx, cy]), new o.gp_Dir(...dir), new o.gp_Dir(...x)), r, hi - lo).Shape();
    // The body less (corner less rod) is the body less the corner, with the rod's share put back.
    const waste = new o.BRepAlgoAPI_Cut(corner, rod, new o.Message_ProgressRange());
    if (!waste.IsDone() || waste.HasErrors()) throw new Error('the kernel could not build the full round');
    return booleanWithHistory(shape, waste.Shape(), 'difference');
}

/**
 * A point of a conic ('conic') or G2 ('g2') round's section from p0 to p1, whose sides would meet at
 * the corner c, at s in [0, 1], as w3d_round_section: the conic is a rational quadratic with rho
 * `tension`; the G2 section a quintic Bézier with three control points on each side's line.
 */
export function roundSection(p0, c, p1, kind, tension, s) {
    if (kind === 'conic') {
        const w = tension / (1 - tension), b0 = (1 - s) * (1 - s), b1 = 2 * s * (1 - s) * w, b2 = s * s;
        return [0, 1, 2].map(i => (p0[i] * b0 + c[i] * b1 + p1[i] * b2) / (b0 + b1 + b2));
    }
    const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
    let q = [p0, lerp(p0, c, tension / 2), lerp(p0, c, tension), lerp(p1, c, tension), lerp(p1, c, tension / 2), p1];
    while (q.length > 1) q = q.slice(1).map((b, i) => lerp(q[i], b, s));
    return q[0];
}

const CORNER = "conic and G2 rounds don't go round corners yet; round those edges with the round shape";

/**
 * Plasticity's Conic and G2 fillet shapes, as w3d_reshape_fillets: each of `rounds` (face numbers of
 * the rounds a fillet made) given the section of roundSection between the same spring lines, so it
 * meets its faces where it did, tangent to them; the flat faces its ends run into are made again
 * with the new end, and all faces sewn back. Ends must be square to the edge, on flat faces.
 */
export function reshapeRounds(shape, rounds, kind, tension) {
    const o = oc();
    if (kind !== 'conic' && kind !== 'g2') throw new Error('a fillet shape is conic or G2');
    if (!(tension >= 0.05 && tension <= 0.95)) throw new Error('the tension must be between 0.05 and 0.95');
    if (!rounds.length) throw new Error('no rounds to shape');
    const all = numbered(shape, 'TopAbs_FACE').map(f => o.TopoDS.Face(f));
    const mine = new Set(rounds);
    const faceEdges = all.map(f => numberedEdges(f));
    const otherFace = (n, e) => all.findIndex((g, m) => m !== n && faceEdges[m].some(x => x.IsSame(e)));
    const normalAt = (f, u, v) => {
        const s = new o.BRepAdaptor_Surface(f, true), p = new o.gp_Pnt(), du = new o.gp_Vec(), dv = new o.gp_Vec();
        s.D1(u, v, p, du, dv);
        const n = du.Crossed(dv);
        if (f.Orientation() === o.TopAbs_Orientation.TopAbs_REVERSED) n.Reverse();
        return n;
    };
    const replaced = new Map(), caps = new Map();
    for (const n of rounds) {
        const f = all[n];
        if (!f) throw new Error('that face no longer exists');
        const ad = new o.BRepAdaptor_Surface(f, true);
        const { UMin: u0, UMax: u1, VMin: v0, VMax: v1 } = o.BRepTools.UVBounds(f, 0, 0, 0, 0);
        const tu = 1e-6 * Math.max(1, u1 - u0), tv = 1e-6 * Math.max(1, v1 - v0);
        // The spring lines: edges to faces the round leaves tangent, along an isoline at the edge
        // of the face's parameters. Their direction is the round's across direction.
        const spring = [[false, false], [false, false]], ends = [];
        for (const e of faceEdges[n]) {
            if (o.BRep_Tool.Degenerated(e)) continue;
            const pc = new o.BRepAdaptor_Curve2d(e, f), a = pc.FirstParameter(), b = pc.LastParameter();
            const A = pc.Value(a), M = pc.Value((a + b) / 2), Z = pc.Value(b);
            const m = otherFace(n, e);
            let isSpring = false;
            if (m >= 0 && !mine.has(m)) {
                const gm = new o.BRepAdaptor_Curve2d(e, all[m]).Value((a + b) / 2);
                const nf = normalAt(f, M.X(), M.Y()), ng = normalAt(all[m], gm.X(), gm.Y());
                isSpring = nf.Magnitude() > 1e-12 && ng.Magnitude() > 1e-12 && nf.Angle(ng) < 1e-3;
            }
            for (let dir = 0; dir < 2 && isSpring; dir++) {
                const x = dir ? A.Y() : A.X(), t = dir ? tv : tu, lo = dir ? v0 : u0, hi = dir ? v1 : u1;
                if (Math.abs(x - (dir ? M.Y() : M.X())) > t || Math.abs(x - (dir ? Z.Y() : Z.X())) > t) continue;
                if (Math.abs(x - lo) <= t) spring[dir][0] = true;
                else if (Math.abs(x - hi) <= t) spring[dir][1] = true;
            }
            if (!isSpring) ends.push({ e, m, pc, a, b });
        }
        const across = spring[0][0] && spring[0][1] ? 0 : spring[1][0] && spring[1][1] ? 1 : -1;
        if (across < 0) throw new Error(CORNER);
        const a0 = across ? v0 : u0, a1 = across ? v1 : u1;
        const P = new o.gp_Pnt(), DU = new o.gp_Vec(), DV = new o.gp_Vec();
        const side = (u, v) => { ad.D1(u, v, P, DU, DV); const t = across ? DV : DU; return { p: [P.X(), P.Y(), P.Z()], t: [t.X(), t.Y(), t.Z()] }; };
        const dot = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
        // The new round at (u, v): the section across through the old round's spring points there.
        const at = (u, v) => {
            const a = across ? v : u, b = across ? u : v;
            const { p: p0, t: t0 } = across ? side(b, a0) : side(a0, b);
            const { p: p1, t: t1 } = across ? side(b, a1) : side(a1, b);
            // Where the round's sides, carried on along their tangents, come closest.
            const w = [0, 1, 2].map(i => p0[i] - p1[i]);
            const aa = dot(t0, t0), bb = dot(t0, t1), cc = dot(t1, t1), d = dot(t0, w), e = dot(t1, w), den = aa * cc - bb * bb;
            if (!(den > 1e-12 * aa * cc)) throw new Error('that round turns too far for a conic or G2 shape');
            const x = (bb * e - cc * d) / den, y = (aa * e - bb * d) / den;
            if (!(x > 0) || !(y < 0)) throw new Error('that round turns too far for a conic or G2 shape');
            const c = [0, 1, 2].map(i => (p0[i] + t0[i] * x + p1[i] + t1[i] * y) / 2);
            return roundSection(p0, c, p1, kind, tension, (a - a0) / (a1 - a0));
        };
        const bounds = [u0, u1, v0, v1];
        // Spans across and along grow in turn until the fit holds the new round within 1e-6 mm.
        let ka = 2, kb = 2, made = null, dev = Infinity;
        const deviation = (sf, nn = 24) => {
            let worst = 0;
            for (let i = 0; i <= nn; i++) for (let j = 0; j <= nn; j++) {
                const u = u0 + (u1 - u0) * i / nn, v = v0 + (v1 - v0) * j / nn, q = sf.Value(u, v), r = at(u, v);
                worst = Math.max(worst, Math.hypot(q.X() - r[0], q.Y() - r[1], q.Z() - r[2]));
            }
            return worst;
        };
        for (let round = 0; round < 10; round++) {
            made = refit(at, bounds, [3, 3], across ? [kb, ka] : [ka, kb]);
            dev = deviation(made);
            if (dev <= 1e-6) break;
            // Which way the fit is worse: across the round, or along it.
            const worst = alongAcross => {
                let w = 0;
                for (let i = 0; i <= 48; i++) {
                    const x = i / 48, byU = alongAcross === (across === 0);
                    const u = byU ? u0 + (u1 - u0) * x : (u0 + u1) / 2, v = byU ? (v0 + v1) / 2 : v0 + (v1 - v0) * x;
                    const q = made.Value(u, v), r = at(u, v);
                    w = Math.max(w, Math.hypot(q.X() - r[0], q.Y() - r[1], q.Z() - r[2]));
                }
                return w;
            };
            if (worst(true) >= worst(false)) ka = Math.min(32, ka * 2); else kb = Math.min(32, kb * 2);
            if (ka === 32 && kb === 32) break;
        }
        if (dev > 1e-3) throw new Error('the shaped round could not be fitted closely enough; try the round shape');
        const nf = remade(f, made, bounds);
        replaced.set(n, nf);
        // The round's ends: the flat faces they run into are made again with the new end edge.
        const newEdges = numberedEdges(nf);
        for (const { e, m, pc, a, b } of ends) {
            // Two rounds running on into each other (a tangent chain) meet where their sections do.
            if (m < 0 || mine.has(m)) continue;
            const g = all[m];
            if (new o.BRepAdaptor_Surface(g, true).GetType() !== o.GeomAbs_SurfaceType.GeomAbs_Plane) throw new Error('a conic or G2 round needs its ends on flat faces here; use the round shape, or the desktop app');
            const mid = pc.Value((a + b) / 2), want = at(mid.X(), mid.Y());
            let best = null, bestD = Infinity;
            for (const ne of newEdges) {
                const c = new o.BRepAdaptor_Curve(ne), q = c.Value((c.FirstParameter() + c.LastParameter()) / 2);
                const d = Math.hypot(q.X() - want[0], q.Y() - want[1], q.Z() - want[2]);
                if (d < bestD) { bestD = d; best = ne; }
            }
            if (!best || bestD > 1e-3) throw new Error('the end of a shaped round could not be made');
            const list = caps.get(m) ?? [];
            list.push([e, best]);
            caps.set(m, list);
        }
    }
    for (const [m, swaps] of caps) {
        const g = all[m], fwd = o.TopoDS.Face(g.Oriented(o.TopAbs_Orientation.TopAbs_FORWARD));
        const plane = o.BRep_Tool.Surface(fwd);
        let mk = null;
        for (const w of numbered(fwd, 'TopAbs_WIRE')) {
            const wire = new o.BRepBuilderAPI_MakeWire();
            for (const ex = new o.TopExp_Explorer(w, o.TopAbs_ShapeEnum.TopAbs_EDGE, o.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
                const e = o.TopoDS.Edge(ex.Current()), swap = swaps.find(([old]) => old.IsSame(e));
                wire.Add(swap ? swap[1] : e);
                if (!wire.IsDone()) throw new Error('the end of a shaped round could not be joined to its face');
            }
            if (!mk) mk = new o.BRepBuilderAPI_MakeFace(plane, wire.Wire(), true);
            else mk.Add(wire.Wire());
        }
        if (!mk?.IsDone()) throw new Error('the face at the end of a shaped round could not be made');
        let face = mk.Face();
        const fix = new o.ShapeFix_Face(face);
        fix.Perform(new o.Message_ProgressRange());
        face = fix.Face();
        if (g.Orientation() === o.TopAbs_Orientation.TopAbs_REVERSED) face.Reverse();
        replaced.set(m, face);
    }
    try { return assemble(shape, all, replaced, 1e-4, 'the shaped round', '; try the round shape'); }
    catch (e) { throw new Error(/closes the solid/.test(e.message) ? CORNER : e.message); }
}
