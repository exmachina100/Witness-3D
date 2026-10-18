// Plasticity's Unwrap Face in the browser build, as w3d_unwrap_face does it on the desktop: a face
// laid flat on the ground (the user's XY plane, the model's y = 0, as the model is y-up) as a new sheet, its outward side up and its centre under the face's
// centre. Planes only turn; cylinders and cones unroll exactly (lengths kept); other faces are
// flattened conformally (LSCM: small pieces keep their shape, the whole keeps its area).

import { numbered, oc } from './Kernel.js';

/**
 * A conformal flattening of the n × n grid `pts` (each [x, y, z], row-major in u then v) by least
 * squares, solved by conjugate gradients and scaled so the flat area equals the surface's.
 */
export function lscm(pts, n) {
    const V = n * n, sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const len = a => Math.sqrt(dot(a, a));
    // A row or column all at one point (a pole) is one point of the mesh, so it can't fold over.
    const rep = [...Array(V).keys()];
    for (let line = 0; line < n; line++)
        for (const across of [false, true]) {
            const at = m => across ? line * n + m : m * n + line;
            let pole = true;
            for (let m = 1; m < n && pole; m++) pole = len(sub(pts[at(0)], pts[at(m)])) < 1e-9;
            if (pole) for (let m = 1; m < n; m++) rep[at(m)] = rep[at(0)];
        }
    const rows = [];
    let area3 = 0;
    const tri = (a, b, c) => {
        [a, b, c] = [rep[a], rep[b], rep[c]];
        if (a === b || b === c || a === c) return;
        const e1 = sub(pts[b], pts[a]), e2 = sub(pts[c], pts[a]), nrm = cross(e1, e2);
        const A = len(nrm) / 2;
        if (A < 1e-14) return;
        area3 += A;
        const x = e1.map(v => v / len(e1)), yv = cross(nrm, e1), y = yv.map(v => v / len(yv));
        const p = [[0, 0], [len(e1), 0], [dot(e2, x), dot(e2, y)]], id = [a, b, c];
        const s = Math.sqrt(A), r1 = [], r2 = [];
        for (let i = 0; i < 3; i++) {
            const q = p[(i + 1) % 3], r = p[(i + 2) % 3];
            const gx = (q[1] - r[1]) / (2 * A), gy = (r[0] - q[0]) / (2 * A);
            // Cauchy-Riemann: x_u = y_v and x_v = -y_u, unknowns x at 2k, y at 2k + 1.
            r1.push([2 * id[i], s * gx], [2 * id[i] + 1, -s * gy]);
            r2.push([2 * id[i], s * gy], [2 * id[i] + 1, s * gx]);
        }
        rows.push(r1, r2);
    };
    for (let i = 0; i + 1 < n; i++)
        for (let j = 0; j + 1 < n; j++) {
            const a = i * n + j, b = (i + 1) * n + j, c = (i + 1) * n + j + 1, d = i * n + j + 1;
            tri(a, b, c);
            tri(a, c, d);
        }
    if (!rows.length) throw new Error('that face has no area to unwrap');
    // Pinned: the middle of the grid at the origin and the point farthest from it along x.
    const pa = Math.floor(n / 2) * n + Math.floor(n / 2);
    let pb = 0;
    for (let k = 0; k < V; k++) if (rep[k] === k && len(sub(pts[pa], pts[k])) > len(sub(pts[pa], pts[pb]))) pb = k;
    const fixed = new Float64Array(2 * V), pinned = new Uint8Array(2 * V);
    fixed[2 * pb] = len(sub(pts[pa], pts[pb])) || 1;
    for (const k of [2 * pa, 2 * pa + 1, 2 * pb, 2 * pb + 1]) pinned[k] = 1;
    const apply = (x, out) => {
        out.fill(0);
        for (const row of rows) {
            let v = 0;
            for (const [k, w] of row) if (!pinned[k]) v += w * x[k];
            for (const [k, w] of row) if (!pinned[k]) out[k] += w * v;
        }
    };
    const b = new Float64Array(2 * V);
    for (const row of rows) {
        let v = 0;
        for (const [k, w] of row) if (pinned[k]) v += w * fixed[k];
        for (const [k, w] of row) if (!pinned[k]) b[k] -= w * v;
    }
    const x = new Float64Array(2 * V), r = Float64Array.from(b), d = Float64Array.from(b), q = new Float64Array(2 * V);
    let rr = r.reduce((t, v) => t + v * v, 0);
    const bb = rr;
    for (let it = 0; it < 20 * V && rr > 1e-28 * Math.max(bb, 1e-30); it++) {
        apply(d, q);
        let dq = 0;
        for (let k = 0; k < 2 * V; k++) dq += d[k] * q[k];
        if (!(dq > 0)) break;
        const alpha = rr / dq;
        let nr = 0;
        for (let k = 0; k < 2 * V; k++) { x[k] += alpha * d[k]; r[k] -= alpha * q[k]; nr += r[k] * r[k]; }
        const beta = nr / rr;
        rr = nr;
        for (let k = 0; k < 2 * V; k++) d[k] = r[k] + beta * d[k];
    }
    const flat = [];
    for (let k = 0; k < V; k++) flat.push([pinned[2 * k] ? fixed[2 * k] : x[2 * k], pinned[2 * k + 1] ? fixed[2 * k + 1] : x[2 * k + 1]]);
    for (let k = 0; k < V; k++) flat[k] = flat[rep[k]];
    const area = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    let area2 = 0;
    for (let i = 0; i + 1 < n; i++)
        for (let j = 0; j + 1 < n; j++) {
            const a = flat[i * n + j], b2 = flat[(i + 1) * n + j], c = flat[(i + 1) * n + j + 1], e = flat[i * n + j + 1];
            area2 += area(a, b2, c) + area(a, c, e);
        }
    if (!(area2 > 1e-14)) throw new Error('that face could not be flattened');
    const s = Math.sqrt(area3 / area2);
    return flat.map(([u, v]) => [u * s, v * s]);
}

/** Face `index` of `shape` laid flat on the ground as a new sheet. */
export function unwrapFace(shape, index) {
    const o = oc();
    const found = numbered(shape, 'TopAbs_FACE')[index];
    if (!found) throw new Error('that face no longer exists');
    const face = o.TopoDS.Face(found);
    const reversed = face.Orientation() === o.TopAbs_Orientation.TopAbs_REVERSED;
    const ad = new o.BRepAdaptor_Surface(face, true);
    const { UMin: u0, UMax: u1, VMin: v0, VMax: v1 } = o.BRepTools.UVBounds(face, 0, 0, 0, 0);
    const g = new o.GProp_GProps();
    o.BRepGProp.SurfaceProperties(face, g, false, false);
    const centre = g.CentreOfMass();
    const type = ad.GetType(), T = o.GeomAbs_SurfaceType;
    if (type === T.GeomAbs_Plane) {
        // A flat face only turns: outward side up, centre over where it was, curves kept exact.
        const pln = ad.Plane();
        const up = pln.Axis().Direction();
        if (reversed) up.Reverse();
        const to = new o.gp_Trsf();
        to.SetDisplacement(new o.gp_Ax3(centre, up, pln.XAxis().Direction()),
            new o.gp_Ax3(new o.gp_Pnt(centre.X(), 0, centre.Z()), new o.gp_Dir(0, 1, 0), new o.gp_Dir(1, 0, 0)));
        return new o.BRepBuilderAPI_Transform(face, to, true, false).Shape();
    }
    const value = (u, v) => { const p = ad.Value(u, v); return [p.X(), p.Y(), p.Z()]; };
    const n = 33;
    let flat;
    if (type === T.GeomAbs_Cylinder) {
        const R = ad.Cylinder().Radius();
        flat = (u, v) => [R * u, v];
    } else if (type === T.GeomAbs_Cone) {
        const cone = ad.Cone(), apex = cone.Apex(), s = Math.sin(Math.abs(cone.SemiAngle()));
        flat = (u, v) => {
            const p = ad.Value(u, v), rho = apex.Distance(p), phi = u * s;
            return [rho * Math.cos(phi), rho * Math.sin(phi)];
        };
    } else {
        const pts = [];
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) pts.push(value(u0 + (u1 - u0) * i / (n - 1), v0 + (v1 - v0) * j / (n - 1)));
        const grid = lscm(pts, n);
        flat = (u, v) => {
            const a = Math.min(Math.max((u - u0) / (u1 - u0) * (n - 1), 0), n - 1), b = Math.min(Math.max((v - v0) / (v1 - v0) * (n - 1), 0), n - 1);
            const i = Math.min(Math.floor(a), n - 2), j = Math.min(Math.floor(b), n - 2), s = a - i, t = b - j;
            const w = [[i * n + j, (1 - s) * (1 - t)], [(i + 1) * n + j, s * (1 - t)], [(i + 1) * n + j + 1, s * t], [i * n + j + 1, (1 - s) * t]];
            return [w.reduce((x, [k, f]) => x + grid[k][0] * f, 0), w.reduce((y, [k, f]) => y + grid[k][1] * f, 0)];
        };
    }
    // Outward side up: mirror if the flattening turns it over.
    const um = (u0 + u1) / 2, vm = (v0 + v1) / 2, hu = (u1 - u0) * 1e-3, hv = (v1 - v0) * 1e-3;
    const [a1, b1] = flat(um + hu, vm), [a2, b2] = flat(um - hu, vm), [a3, b3] = flat(um, vm + hv), [a4, b4] = flat(um, vm - hv);
    const mirror = ((a1 - a2) * (b3 - b4) - (b1 - b2) * (a3 - a4) < 0) !== reversed;
    // Turned so the face's v direction runs the way it runs seen from above (a round along an edge
    // lies along the edge), when it isn't straight up; the user's y is the model's -z.
    const [p0, p1] = [value(um, vm - hv), value(um, vm + hv)];
    const dv = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], seen = [dv[0], -dv[2]];
    const laid = [(a3 - a4) * (mirror ? -1 : 1), b3 - b4];
    const turn = Math.hypot(...seen) > 1e-3 * Math.hypot(...dv) && Math.hypot(...laid) > 1e-12
        ? Math.atan2(seen[1], seen[0]) - Math.atan2(laid[1], laid[0]) : 0;
    const ct = Math.cos(turn), st = Math.sin(turn);
    const mid = flat(um, vm);
    const place = (u, v) => {
        const p = flat(u, v);
        const x = (p[0] - mid[0]) * (mirror ? -1 : 1), y = p[1] - mid[1];
        return new o.gp_Pnt(ct * x - st * y + centre.X(), 0, centre.Z() - (st * x + ct * y));
    };
    const verts = [];
    const vertexAt = p => {
        const v = verts.find(v => o.BRep_Tool.Pnt(v).Distance(p) < 1e-6);
        if (v) return v;
        verts.push(new o.BRepBuilderAPI_MakeVertex(p).Vertex());
        return verts.at(-1);
    };
    const fwd = o.TopoDS.Face(face.Oriented(o.TopAbs_Orientation.TopAbs_FORWARD));
    const outer = o.BRepTools.OuterWire(fwd);
    const wires = [];
    for (const w of numbered(fwd, 'TopAbs_WIRE')) {
        const edges = [];
        for (const ex = new o.TopExp_Explorer(w, o.TopAbs_ShapeEnum.TopAbs_EDGE, o.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
            const e = o.TopoDS.Edge(ex.Current());
            const degenerate = o.BRep_Tool.Degenerated(e);
            const pc = new o.BRepAdaptor_Curve2d(e, fwd), a = pc.FirstParameter(), b = pc.LastParameter();
            const m = 32, pts = [];
            for (let i = 0; i <= m; i++) { const q = pc.Value(a + (b - a) * i / m); pts.push(place(q.X(), q.Y())); }
            // A pole opens out into a line when laid flat; one that stays a point drops out.
            if (degenerate && pts[0].Distance(pts[m]) < 1e-6) continue;
            const chord = new o.gp_Vec(pts[0], pts[m]), c = chord.Magnitude();
            const straight = c > 1e-9 && pts.every(p => new o.gp_Vec(pts[0], p).Crossed(chord).Magnitude() / c < 1e-7);
            const rev = e.Orientation() === o.TopAbs_Orientation.TopAbs_REVERSED;
            const vf = vertexAt(rev ? pts[m] : pts[0]), vl = vertexAt(rev ? pts[0] : pts[m]);
            let edge;
            if (straight) edge = new o.BRepBuilderAPI_MakeEdge(vf, vl).Edge();
            else {
                if (rev) pts.reverse();
                const arr = new o.NCollection_Array1_gp_Pnt(1, pts.length);
                pts.forEach((p, i) => arr.SetValue(i + 1, p));
                const fit = new o.GeomAPI_PointsToBSpline(arr, 3, 8, o.GeomAbs_Shape.GeomAbs_C2, 1e-7);
                if (!fit.IsDone()) throw new Error('an edge of that face could not be laid flat');
                const me = new o.BRepBuilderAPI_MakeEdge(fit.Curve(), vf, vl);
                if (!me.IsDone()) throw new Error('an edge of that face could not be laid flat');
                edge = me.Edge();
            }
            edges.push({ edge, vf, vl });
        }
        // The edges come in any order here; chained end to start, each goes in after the one before.
        const mw = new o.BRepBuilderAPI_MakeWire();
        let at = edges.shift();
        while (at) {
            mw.Add(at.edge);
            if (!mw.IsDone()) throw new Error("the face's edges don't join up when laid flat");
            const i = edges.findIndex(e => e.vf.IsSame(at.vl));
            at = edges.splice(i < 0 ? 0 : i, 1)[0];
        }
        if (w.IsSame(outer)) wires.unshift(mw.Wire());
        else wires.push(mw.Wire());
    }
    if (!wires.length) throw new Error('that face has no edges to unwrap');
    const mf = new o.BRepBuilderAPI_MakeFace(new o.gp_Pln(new o.gp_Pnt(0, 0, 0), new o.gp_Dir(0, 1, 0)), wires[0], true);
    for (const w of wires.slice(1)) mf.Add(w);
    if (!mf.IsDone()) throw new Error('the flat face could not be made');
    const fix = new o.ShapeFix_Face(mf.Face());
    fix.FixOrientation();
    fix.Perform();
    return fix.Face();
}
