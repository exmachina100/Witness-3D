// Revolve, Loft and Sweep of drawn regions, Offset Face, and Extrude's angle, thickness and second
// side, on OpenCascade WebAssembly. They mirror the desktop kernel
// (vendor/opencascade-sys/include/w3d.hxx); Offset Face here is limited to flat faces, since this
// OpenCascade build leaves out the per-face offset algorithm.

import * as THREE from 'three';
import { arcPoints, cvDegree, cvPoints, ellipsePoints, helixPoints, loops, nurbsLoop, nurbsPoints } from './curves.js';
import { boolean, count, extrudeFace, facePlane, oc } from './Kernel.js';

const pnt = v => new (oc().gp_Pnt)(v.x, v.y, v.z);
const dir = v => new (oc().gp_Dir)(v.x, v.y, v.z);

/** A drawn curve's plane: origin, x, y and normal as vectors. */
function plane(c) {
    const o = new THREE.Vector3(...c.origin), n = new THREE.Vector3(...c.normal).normalize();
    const x = new THREE.Vector3(...c.x).projectOnPlane(n).normalize();
    return { o, x, y: n.clone().cross(x), n, at: ([u, v]) => o.clone().addScaledVector(x, u).addScaledVector(new THREE.Vector3().crossVectors(n, x), v) };
}

/** The smooth curve through the points (a closed one is periodic), as on the desktop. */
function interpolate(points, closed) {
    const o = oc();
    const a = new o.NCollection_Array1_gp_Pnt(1, points.length);
    points.forEach((q, i) => a.SetValue(i + 1, pnt(q)));
    const fit = new o.GeomAPI_Interpolate(new o.NCollection_HArray1_gp_Pnt(a), closed, 1e-7);
    fit.Perform();
    if (!fit.IsDone()) throw new Error('no smooth curve passes through those points');
    return fit.Curve();
}

/**
 * The curve in space: an exact circle, a smooth spline, an arc through three points, or a polyline.
 * Splines and arcs also carry sample points, which a sweep follows to carry its profile.
 */
function geometry(c) {
    const p = plane(c);
    if (c.kind === 'circle') return { circle: { center: p.at(c.center), normal: p.n, radius: c.radius, x: p.x, y: p.y } };
    if (c.kind === 'spline') {
        const curve = interpolate(c.points.map(q => p.at(q)), !!c.closed);
        const t0 = curve.FirstParameter(), t1 = curve.LastParameter(), n = 64;
        const pts = Array.from({ length: c.closed ? n : n + 1 }, (_, i) => { const v = curve.Value(t0 + (t1 - t0) * i / n); return new THREE.Vector3(v.X(), v.Y(), v.Z()); });
        return { spline: curve, points: pts, closed: !!c.closed };
    }
    if (c.kind === 'cv') {
        // A uniform B-spline on its control points, as w3d_section's kind 8.
        const o = oc(), n = c.points.length, deg = cvDegree(n, !!c.closed);
        if (n < 2 || (c.closed && n < 3)) throw new Error('a curve needs more control points');
        const poles = new o.NCollection_Array1_gp_Pnt(1, n);
        c.points.forEach((q, i) => poles.SetValue(i + 1, pnt(p.at(q))));
        const k = c.closed ? n + 1 : n - deg + 1;
        const knots = new o.NCollection_Array1_double(1, k), mults = new o.NCollection_Array1_int(1, k);
        for (let i = 1; i <= k; i++) {
            knots.SetValue(i, c.closed ? i - 1 : (i - 1) / (k - 1));
            mults.SetValue(i, !c.closed && (i === 1 || i === k) ? deg + 1 : 1);
        }
        const curve = new o.Geom_BSplineCurve(poles, knots, mults, deg, !!c.closed);
        return { spline: curve, points: cvPoints(c.points, !!c.closed, 64).map(q => p.at(q)), closed: !!c.closed };
    }
    if (c.kind === 'arc') {
        const pts = arcPoints(c.start, c.mid, c.end, 48);
        if (!pts) throw new Error('the three points of an arc must not lie on a line');
        return { arc: [c.start, c.mid, c.end].map(q => p.at(q)), points: pts.map(q => p.at(q)), closed: false };
    }
    if (c.kind === 'ellipse') {
        const r = Math.hypot(...c.major);
        if (!(r > 1e-9) || !(c.minor > 1e-9)) throw new Error('an ellipse needs two radii greater than zero');
        // OpenCascade wants the longer radius first.
        const major = p.at(c.major).sub(p.o), across = p.n.clone().cross(major).normalize();
        const [axis, R, rr] = r >= c.minor ? [major.clone().normalize(), r, c.minor] : [across, c.minor, r];
        return { ellipse: { center: p.at(c.center), normal: p.n, axis, R, r: rr }, points: ellipsePoints(c.center, c.major, c.minor, 64).map(q => p.at(q)), closed: true };
    }
    if (c.kind === 'spiral') {
        if (![c.radius, c.length, c.turns].every(v => Number.isFinite(v) && v > 1e-9)) throw new Error('a spiral needs a radius, a length and turns greater than zero');
        return { spiral: { o: p.o, n: p.n, x: p.x, radius: c.radius, length: c.length, turns: c.turns, left: !!c.left }, points: helixPoints(c, 32).map(([u, v, h]) => p.at([u, v]).addScaledVector(p.n, h)), closed: false };
    }
    if (c.kind === 'nurbs') {
        // As w3d_section's kind 9: poles in the plane's coordinates, with their height up its normal.
        const o = oc(), n = c.poles.length, deg = c.degree;
        if (!(deg >= 1) || n < deg + 1 || c.weights.length !== n || c.knots.length !== n + deg + 1) throw new Error("a NURBS curve's knots and weights do not match its poles");
        const at = q => p.at(q).addScaledVector(p.n, q[2]);
        const poles = new o.NCollection_Array1_gp_Pnt(1, n), weights = new o.NCollection_Array1_double(1, n);
        c.poles.forEach((q, i) => { poles.SetValue(i + 1, pnt(at(q))); weights.SetValue(i + 1, c.weights[i]); });
        const distinct = [], mult = [];
        for (const k of c.knots) { if (distinct.length && k - distinct.at(-1) < 1e-12) mult[mult.length - 1]++; else { distinct.push(k); mult.push(1); } }
        const knots = new o.NCollection_Array1_double(1, distinct.length), mults = new o.NCollection_Array1_int(1, distinct.length);
        distinct.forEach((k, i) => { knots.SetValue(i + 1, k); mults.SetValue(i + 1, mult[i]); });
        const curve = new o.Geom_BSplineCurve(poles, weights, knots, mults, deg, false, true);
        const closed = nurbsLoop(c), pts = nurbsPoints(c).map(at);
        return { spline: curve, points: closed ? pts.slice(0, -1) : pts, closed };
    }
    if (c.kind === 'contour') {
        const parts = c.pieces.map(q => geometry({ ...q, origin: c.origin, x: c.x, normal: c.normal }));
        return { pieces: parts, points: parts.flatMap((g, i) => i ? g.points.slice(1) : g.points), closed: loops(c.pieces) };
    }
    return { points: c.points.map(q => p.at(q)), closed: !!c.closed };
}

function wireOf(g) {
    const o = oc();
    const mk = new o.BRepBuilderAPI_MakeWire();
    if (g.pieces) {
        for (const part of g.pieces) {
            for (const ex = new o.TopExp_Explorer(wireOf(part).Wire(), o.TopAbs_ShapeEnum.TopAbs_EDGE, o.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
                mk.Add(o.TopoDS.Edge(ex.Current()));
                if (!mk.IsDone()) throw new Error('the curves do not meet end to end');
            }
        }
        return mk;
    }
    if (g.spiral) {
        // A straight line unrolled on the cylinder, as w3d_section's kind 7.
        const h = g.spiral, pitch = h.length / h.turns, u = (h.left ? -1 : 1) * 2 * Math.PI;
        const cyl = new o.Geom_CylindricalSurface(new o.gp_Ax3(pnt(h.o), dir(h.n), dir(h.x)), h.radius);
        const line = new o.Geom2d_Line(new o.gp_Pnt2d(0, 0), new o.gp_Dir2d(u, pitch));
        const e = new o.BRepBuilderAPI_MakeEdge(line, cyl, 0, h.turns * Math.hypot(u, pitch)).Edge();
        o.BRepLib.BuildCurves3d(e);
        mk.Add(e);
        return mk;
    }
    if (g.ellipse) {
        const e = g.ellipse;
        mk.Add(new o.BRepBuilderAPI_MakeEdge(new o.gp_Elips(new o.gp_Ax2(pnt(e.center), dir(e.normal), dir(e.axis)), e.R, e.r)).Edge());
        return mk;
    }
    if (g.circle) {
        mk.Add(new o.BRepBuilderAPI_MakeEdge(new o.gp_Circ(new o.gp_Ax2(pnt(g.circle.center), dir(g.circle.normal)), g.circle.radius)).Edge());
        return mk;
    }
    if (g.spline) { mk.Add(new o.BRepBuilderAPI_MakeEdge(g.spline).Edge()); return mk; }
    if (g.arc) {
        mk.Add(new o.BRepBuilderAPI_MakeEdge(new o.GC_MakeArcOfCircle(...g.arc.map(pnt)).Value()).Edge());
        return mk;
    }
    const pts = g.points, n = pts.length;
    for (let i = 0; i < (g.closed ? n : n - 1); i++) mk.Add(new o.BRepBuilderAPI_MakeEdge(pnt(pts[i]), pnt(pts[(i + 1) % n])).Edge());
    return mk;
}

/** A drawn curve as an OpenCascade wire in model space. */
export const curveWire = c => wireOf(geometry(c)).Wire();

/** Points along a drawn curve in model space, as the sheets of Cut and Project sweep it. */
export const curvePoints = c => geometry(c).points;

/** A closed curve's region as a wire, with its centre and normal. */
function section(c) {
    const g = geometry(c);
    if (!g.circle && (!g.closed || g.points.length < 3)) throw new Error('only a closed curve has a region');
    const centre = g.circle ? g.circle.center : g.ellipse ? g.ellipse.center : g.points.reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(g.points.length);
    return { wire: wireOf(g).Wire(), centre, normal: plane(c).n };
}

/** A spline's or a contour's points in its own plane, for drawing it. */
export function splineSamples(c) {
    const p = plane(c);
    return geometry(c).points.map(q => { const d = q.clone().sub(p.o); return [d.dot(p.x), d.dot(p.y)]; });
}

/** A closed curve's region as an exact face, for Extrude. */
export function regionFace(c) { return face(section(c).wire) }

const face = wire => new (oc().BRepBuilderAPI_MakeFace)(wire, true).Face();

/** The region turned about the axis; with a `thickness`, only walls that thick inside its outline (Shift+T). */
export function revolve(c, axisPoint, axisDir, angle, thickness = 0) {
    const o = oc();
    if (!Number.isFinite(angle) || Math.abs(angle) < 1e-9) return null;
    if (!Number.isFinite(thickness) || thickness < 0) throw new Error("the thickness can't be negative");
    const d = new THREE.Vector3(...axisDir);
    if (d.length() < 1e-9) throw new Error('pick two different points for the axis');
    const a = Math.max(-2 * Math.PI, Math.min(2 * Math.PI, angle));
    const ax = new o.gp_Ax1(pnt(new THREE.Vector3(...axisPoint)), dir(d.normalize()));
    const turned = w => {
        const mk = new o.BRepPrimAPI_MakeRevol(face(w), ax, a, true);
        if (!mk.IsDone()) throw new Error('the profile could not be revolved about that axis');
        return mk.Shape();
    };
    const w = section(c).wire, solid = turned(w);
    return thickness > 1e-12 ? boolean(solid, turned(grown(w, -thickness)), 'difference') : solid;
}

export function loft(cs) {
    const o = oc();
    if (cs.length < 2) throw new Error('select two regions or more to loft');
    const mk = new o.BRepOffsetAPI_ThruSections(true, false, 1e-6);
    for (const c of cs) mk.AddWire(section(c).wire);
    mk.Build(new o.Message_ProgressRange());
    if (!mk.IsDone()) throw new Error('no surface could be lofted through those profiles');
    return mk.Shape();
}

/** Point and tangent a fraction `f` along the path. */
function along(g, f) {
    if (g.circle) {
        const { center, radius, x, y } = g.circle, t = f * 2 * Math.PI;
        return { point: center.clone().addScaledVector(x, radius * Math.cos(t)).addScaledVector(y, radius * Math.sin(t)), tangent: x.clone().multiplyScalar(-Math.sin(t)).addScaledVector(y, Math.cos(t)) };
    }
    const pts = g.closed ? [...g.points, g.points[0]] : g.points;
    const lengths = pts.slice(1).map((p, i) => p.distanceTo(pts[i]));
    let s = f * lengths.reduce((a, b) => a + b, 0);
    for (let i = 0; i < lengths.length; i++) {
        if (s <= lengths[i] || i === lengths.length - 1) {
            const tangent = pts[i + 1].clone().sub(pts[i]).normalize();
            return { point: pts[i].clone().addScaledVector(tangent, Math.min(s, lengths[i])), tangent };
        }
        s -= lengths[i];
    }
}

export function sweep(c, path, twist = 0, scale = 1) {
    const o = oc();
    if (!Number.isFinite(twist) || !(scale > 0)) throw new Error('the end scale must be greater than zero');
    const prof = section(c), g = geometry(path);
    const plain = Math.abs(twist) < 1e-12 && Math.abs(scale - 1) < 1e-12;
    if (!plain && (g.circle || g.closed)) throw new Error('twist and scale need a path with two ends');
    // The profile a fraction `f` along: turned and scaled about its centre, then carried by the
    // path's own turn (parallel transport) and position, as on the desktop.
    const sectionAt = (f, steps) => {
        const t = new o.gp_Trsf();
        t.SetRotation(new o.gp_Ax1(pnt(prof.centre), dir(prof.normal)), twist * f);
        const grow = new o.gp_Trsf();
        grow.SetScale(pnt(prof.centre), 1 + (scale - 1) * f);
        const carry = new THREE.Quaternion();
        const start = along(g, 0);
        let prev = start.tangent;
        for (let i = 1; i <= steps; i++) {
            const tan = along(g, f * i / steps).tangent;
            carry.premultiply(new THREE.Quaternion().setFromUnitVectors(prev.clone().normalize(), tan.clone().normalize()));
            prev = tan;
        }
        const r = new o.gp_Trsf();
        const ax = new THREE.Vector3(carry.x, carry.y, carry.z);
        if (ax.length() > 1e-12) r.SetRotation(new o.gp_Ax1(pnt(start.point), dir(ax.normalize())), 2 * Math.acos(Math.min(1, Math.max(-1, carry.w))));
        const end = along(g, f).point;
        const move = new o.gp_Trsf();
        move.SetTranslation(pnt(start.point), pnt(end));
        const all = move.Multiplied(r).Multiplied(grow).Multiplied(t);
        return o.TopoDS.Wire(new o.BRepBuilderAPI_Transform(prof.wire, all, true, false).Shape());
    };
    if (Math.abs(twist) > 1e-12) {
        const n = Math.max(8, Math.ceil(Math.abs(twist) / (Math.PI / 12)));
        const mk = new o.BRepOffsetAPI_ThruSections(true, false, 1e-6);
        for (let i = 0; i <= n; i++) mk.AddWire(sectionAt(i / n, 4 * n));
        mk.CheckCompatibility(false);
        mk.Build(new o.Message_ProgressRange());
        if (!mk.IsDone()) throw new Error('the profile could not be twisted along that path');
        return mk.Shape();
    }
    const spine = wireOf(g);
    const mk = new o.BRepOffsetAPI_MakePipeShell(spine.Wire());
    // Along a spiral the profile follows the Frenet frame, so it stays upright to the axis.
    mk.SetMode(!!g.spiral);
    mk.SetTransitionMode(o.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner);
    mk.Add(prof.wire, false, false);
    if (!plain) mk.Add(sectionAt(1, 64), spine.Vertex(), false, false);
    mk.Build(new o.Message_ProgressRange());
    if (!mk.IsDone()) throw new Error('the profile could not be swept along that path');
    if (!mk.MakeSolid()) throw new Error('the sweep did not close into a solid');
    return mk.Shape();
}

const V3 = p => new THREE.Vector3(p.X(), p.Y(), p.Z());

/** A wire as a curve: its parameter range, points and tangents. */
function adaptor(wire) {
    const a = new (oc().BRepAdaptor_CompCurve)(wire, false), t0 = a.FirstParameter(), t1 = a.LastParameter();
    const at = t => V3(a.Value(Math.min(t1, Math.max(t0, t))));
    const h = (t1 - t0) * 1e-6;
    return { t0, t1, at, tangent: t => at(t + h).sub(at(t - h)).normalize() };
}

/** The nearest points of two shapes and the gap between them. */
function nearest(a, b) {
    const d = new (oc().BRepExtrema_DistShapeShape)(a, b);
    if (!d.IsDone()) throw new Error('the guide could not be measured against the profile');
    return { gap: d.Value(), on1: V3(d.PointOnShape1(1)), on2: V3(d.PointOnShape2(1)) };
}

/** A guide wire turned, if need be, to start nearer `from`; with its start point. */
function guideFrom(c, from) {
    const o = oc(), w = curveWire(c), g = adaptor(w);
    const vertex = p => new o.BRepBuilderAPI_MakeVertex(pnt(p)).Shape();
    const reversed = nearest(vertex(g.at(g.t1)), from).gap < nearest(vertex(g.at(g.t0)), from).gap - 1e-9;
    return reversed ? o.TopoDS.Wire(w.Reversed()) : w;
}

/** Where curve `g` crosses the plane through `p` square to `n`; the crossing nearest `near`. As w3d_crossing. */
function crossing(g, p, n, near) {
    const side = t => g.at(t).sub(p).dot(n), steps = 400;
    let best = null, prev = side(g.t0);
    for (let i = 1; i <= steps; i++) {
        let a = g.t0 + (g.t1 - g.t0) * (i - 1) / steps, b = g.t0 + (g.t1 - g.t0) * i / steps;
        const now = side(b);
        if (Math.abs(prev) < 1e-12 || prev * now <= 0) {
            let sa = prev;
            for (let k = 0; k < 80; k++) { const m = (a + b) / 2, sm = side(m); if (sa * sm <= 0) b = m; else { a = m; sa = sm; } }
            const q = g.at((a + b) / 2);
            if (!best || q.distanceTo(near) < best.distanceTo(near)) best = q;
        }
        prev = now;
    }
    if (!best) throw new Error('the guide does not run beside the path all the way; it must reach as far as the path does');
    return best;
}

/** Turn about `axis` through `pivot` taking `from` toward `to`, scaled to reach it when `grow`. As w3d_onto. */
function onto(pivot, axis, from, to, grow) {
    const o = oc(), n = axis.clone().normalize();
    const u = from.clone().sub(pivot), v = to.clone().sub(pivot);
    u.addScaledVector(n, -u.dot(n));
    v.addScaledVector(n, -v.dot(n));
    if (u.length() < 1e-7) throw new Error('the guide must touch the profile away from the path');
    if (v.length() < 1e-7) throw new Error('the guide crosses the path; keep it to one side');
    const angle = Math.atan2(u.clone().cross(v).dot(n), u.dot(v));
    const turn = new o.gp_Trsf(), scale = new o.gp_Trsf();
    turn.SetRotation(new o.gp_Ax1(pnt(pivot), dir(n)), angle);
    if (grow) scale.SetScale(pnt(pivot), v.length() / u.length());
    return scale.Multiplied(turn);
}

/**
 * Plasticity's Sweep with a guide (`method` 'point' scales the section to keep touching it,
 * 'chord' and 'curve' only turn it) or, without one, `align` 'parallel' to keep the section at its
 * drawn angle. As w3d_sweep_guided.
 */
export function sweepGuided(c, path, guide, method = 'point', align = 'normal') {
    const o = oc(), prof = section(c), g = geometry(path), spine = wireOf(g).Wire();
    if (!guide) {
        const mk = new o.BRepOffsetAPI_MakePipeShell(spine);
        if (align === 'parallel') mk.SetMode(new o.gp_Ax2());
        else mk.SetMode(!!g.spiral);
        mk.SetTransitionMode(o.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner);
        mk.Add(prof.wire, false, false);
        mk.Build(new o.Message_ProgressRange());
        if (!mk.IsDone()) throw new Error('the profile could not be swept along that path');
        if (!mk.MakeSolid()) throw new Error('the sweep did not close into a solid');
        return mk.Shape();
    }
    if (!['point', 'chord', 'curve'].includes(method)) throw new Error('the guide method is Point, Chord or Curve');
    if (g.circle || g.closed) throw new Error('a guide needs a path with two ends');
    const gw = guideFrom(guide, prof.wire);
    const along = adaptor(spine), rail = adaptor(gw);
    const touch = nearest(new o.BRepBuilderAPI_MakeVertex(pnt(rail.at(rail.t0))).Shape(), prof.wire);
    if (touch.gap > 0.01) throw new Error('the guide does not touch the profile; snap its end onto it');
    const contact = touch.on2;
    // The guide's length to each of many samples, for Curve.
    const samples = 2000, lengths = [0];
    for (let i = 1; i <= samples; i++) lengths.push(lengths[i - 1] + rail.at(rail.t0 + (rail.t1 - rail.t0) * i / samples).distanceTo(rail.at(rail.t0 + (rail.t1 - rail.t0) * (i - 1) / samples)));
    const byLength = f => {
        const want = f * lengths[samples];
        let i = lengths.findIndex(l => l >= want);
        if (i <= 0) return rail.at(i < 0 ? rail.t1 : rail.t0);
        const k = (want - lengths[i - 1]) / Math.max(1e-12, lengths[i] - lengths[i - 1]);
        return rail.at(rail.t0 + (rail.t1 - rail.t0) * (i - 1 + k) / samples);
    };
    const stations = 32, sub = 8, start = along.at(along.t0);
    const mk = new o.BRepOffsetAPI_ThruSections(true, false, 1e-6);
    const carry = new THREE.Quaternion();
    let prev = along.tangent(along.t0), lastG = contact;
    for (let i = 0; i <= stations; i++) {
        if (i > 0) for (let k = 1; k <= sub; k++) {
            const tan = along.tangent(along.t0 + (along.t1 - along.t0) * ((i - 1) * sub + k) / (stations * sub));
            carry.premultiply(new THREE.Quaternion().setFromUnitVectors(prev, tan));
            prev = tan;
        }
        const t = along.t0 + (along.t1 - along.t0) * i / stations, p = along.at(t), tan = along.tangent(t);
        const r = new o.gp_Trsf(), move = new o.gp_Trsf();
        const ax = new THREE.Vector3(carry.x, carry.y, carry.z);
        if (ax.length() > 1e-12) r.SetRotation(new o.gp_Ax1(pnt(start), dir(ax.clone().normalize())), 2 * Math.acos(Math.min(1, Math.max(-1, carry.w))));
        move.SetTranslation(pnt(start), pnt(p));
        const place = move.Multiplied(r);
        const cNow = contact.clone().sub(start).applyQuaternion(carry).add(p);
        const target = method === 'curve' ? byLength(i / stations) : i === 0 ? contact : i === stations ? rail.at(rail.t1) : crossing(rail, p, tan, lastG);
        lastG = target;
        const all = onto(p, tan, cNow, target, method === 'point').Multiplied(place);
        mk.AddWire(o.TopoDS.Wire(new o.BRepBuilderAPI_Transform(prof.wire, all, true, false).Shape()));
    }
    mk.CheckCompatibility(false);
    mk.Build(new o.Message_ProgressRange());
    if (!mk.IsDone()) throw new Error('the profile could not follow that guide; check it runs beside the path all along');
    return mk.Shape();
}

/** A region's area centre and the normal of its plane. */
function planeOf(c) {
    const o = oc(), f = face(section(c).wire), g = new o.GProp_GProps();
    o.BRepGProp.SurfaceProperties(f, g, false, false);
    return { centre: V3(g.CentreOfMass()), normal: plane(c).n.clone().normalize() };
}

/** Section edges joined into wires. */
function wiresOf(edges) {
    const o = oc(), wires = [];
    let left = [...edges];
    while (left.length) {
        const mk = new o.BRepBuilderAPI_MakeWire();
        mk.Add(left.shift());
        for (let added = true; added && left.length;) {
            added = false;
            for (let i = 0; i < left.length; i++) {
                mk.Add(left[i]);
                if (mk.IsDone() && mk.Error() === o.BRepBuilderAPI_WireError.BRepBuilderAPI_WireDone) { left.splice(i, 1); added = true; break; }
            }
        }
        wires.push(mk.Wire());
    }
    return wires;
}

/**
 * Plasticity's Loft with guides: the plain loft cut at stations between each pair of regions, each
 * cut moved onto the one guide, or turned and scaled in its plane onto the two, and the regions and
 * cuts lofted. As w3d_loft_guided.
 */
export function loftGuided(cs, guides) {
    const o = oc();
    if (cs.length < 2) throw new Error('select two regions or more to loft');
    if (!guides.length) throw new Error('select the guide curves');
    if (guides.length > 2) throw new Error('this build follows up to two guides; select fewer');
    const profiles = cs.map(c => section(c).wire);
    const rails = guides.map(g => guideFrom(g, profiles[0]));
    const curves = rails.map(adaptor);
    const touch = rails.map(r => profiles.map(w => {
        const d = nearest(r, w);
        if (d.gap > 0.01) throw new Error('a guide does not touch every profile; snap it onto each one');
        return d.on2;
    }));
    const plain = loft(cs), planes = cs.map(planeOf);
    const stations = 16;
    const mk = new o.BRepOffsetAPI_ThruSections(true, false, 1e-6);
    mk.AddWire(profiles[0]);
    for (let i = 0; i + 1 < cs.length; i++) {
        const { centre: ca } = planes[i], { centre: cb } = planes[i + 1];
        const span = cb.clone().sub(ca);
        const na = planes[i].normal.clone(), nb = planes[i + 1].normal.clone();
        if (na.dot(span) < 0) na.negate();
        if (nb.dot(span) < 0) nb.negate();
        for (let k = 1; k < stations; k++) {
            const s = k / stations, at = ca.clone().lerp(cb, s), n = na.clone().multiplyScalar(1 - s).addScaledVector(nb, s);
            if (n.length() < 1e-9) throw new Error('the profiles face opposite ways');
            n.normalize();
            const cutter = new o.BRepBuilderAPI_MakeFace(new o.gp_Pln(pnt(at), dir(n)), -1e5, 1e5, -1e5, 1e5).Face();
            const cut = new o.BRepAlgoAPI_Section(plain, cutter, false);
            cut.Approximation(true);
            cut.Build(new o.Message_ProgressRange());
            if (!cut.IsDone()) throw new Error('the loft could not be cut between its profiles');
            const edges = [];
            for (const ex = new o.TopExp_Explorer(cut.Shape(), o.TopAbs_ShapeEnum.TopAbs_EDGE, o.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) edges.push(o.TopoDS.Edge(ex.Current()));
            const ws = wiresOf(edges);
            if (ws.length !== 1) throw new Error('the loft between those profiles folds over; guides need a simple loft');
            const w = ws[0], r = [], gs = [];
            curves.forEach((g, j) => {
                const guess = touch[j][i].clone().lerp(touch[j][i + 1], s);
                gs.push(crossing(g, at, n, guess));
                r.push(nearest(new o.BRepBuilderAPI_MakeVertex(pnt(guess)).Shape(), w).on2);
            });
            let t = new o.gp_Trsf();
            if (curves.length === 1) t.SetTranslation(pnt(r[0]), pnt(gs[0]));
            else {
                const move = new o.gp_Trsf();
                move.SetTranslation(pnt(r[0]), pnt(gs[0]));
                t = move.Multiplied(onto(r[0], n, r[1], r[0].clone().add(gs[1].clone().sub(gs[0])), true));
            }
            mk.AddWire(o.TopoDS.Wire(new o.BRepBuilderAPI_Transform(w, t, true, false).Shape()));
        }
        mk.AddWire(profiles[i + 1]);
    }
    mk.Build(new o.Message_ProgressRange());
    if (!mk.IsDone()) throw new Error('no surface could be lofted along those guides; check they run from the first profile to the last');
    return mk.Shape();
}

/**
 * Plasticity's Pipe: a tube of `radius` along `path`, its section a circle (`sides` 0) or a regular
 * polygon with corners on the radius; with a `thickness` the middle is hollow. As form.rs's pipe.
 */
export function pipe(path, radius, thickness = 0, sides = 0) {
    const o = oc();
    if (!Number.isFinite(radius) || radius <= 1e-6) throw new Error('the radius must be greater than zero');
    if (!Number.isFinite(thickness) || thickness < 0) throw new Error("the thickness can't be negative");
    if (thickness >= radius - 1e-6) throw new Error('the wall is as thick as the pipe; use a thinner wall or leave it solid');
    if (!Number.isInteger(sides) || sides === 1 || sides === 2 || sides < 0 || sides > 256) throw new Error("a pipe's section is round (0 sides) or has 3 to 256 sides");
    const g = geometry(path), start = along(g, 0);
    const n = start.tangent.clone().normalize();
    if (!(n.length() > 0.5)) throw new Error('the path is too short');
    const x = (Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).addScaledVector(n, -(Math.abs(n.x) < 0.9 ? n.x : n.y)).normalize();
    const y = n.clone().cross(x);
    const section = r => {
        const mk = new o.BRepBuilderAPI_MakeWire();
        if (sides === 0) mk.Add(new o.BRepBuilderAPI_MakeEdge(new o.gp_Circ(new o.gp_Ax2(pnt(start.point), dir(n), dir(x)), r)).Edge());
        else {
            const at = i => { const a = 2 * Math.PI * (i % sides) / sides; return start.point.clone().addScaledVector(x, r * Math.cos(a)).addScaledVector(y, r * Math.sin(a)); };
            for (let i = 0; i < sides; i++) mk.Add(new o.BRepBuilderAPI_MakeEdge(pnt(at(i)), pnt(at(i + 1))).Edge());
        }
        return mk.Wire();
    };
    const tube = r => {
        const mk = new o.BRepOffsetAPI_MakePipeShell(wireOf(g).Wire());
        mk.SetMode(!!g.spiral);
        mk.SetTransitionMode(o.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner);
        mk.Add(section(r), false, false);
        mk.Build(new o.Message_ProgressRange());
        if (!mk.IsDone()) throw new Error('the pipe could not follow that curve; use a smaller radius');
        if (!mk.MakeSolid()) throw new Error('the pipe did not close into a solid');
        return mk.Shape();
    };
    const outer = tube(radius);
    return thickness > 1e-9 ? boolean(outer, tube(radius - thickness), 'difference') : outer;
}

/**
 * Flat faces pushed out (positive) or in; each face's slab is joined or cut. Pushed out past the
 * body's outer wall beyond it, `grow` (Offset Face's Tab, as document.rs) stops the slab at the wall
 * ('fixed'), lets it carry on ('none'), or pushes the wall's faces out with it ('moving').
 */
export function offsetFlatFaces(shape, faces, distance, booleanWithHistory, chain, grow = 'moving') {
    const o = oc();
    let s = shape, history = null;
    const points = [];
    for (const ex = new o.TopExp_Explorer(shape, o.TopAbs_ShapeEnum.TopAbs_VERTEX, o.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
        const p = o.BRep_Tool.Pnt(o.TopoDS.Vertex(ex.Current()));
        points.push(new THREE.Vector3(p.X(), p.Y(), p.Z()));
    }
    const planes = Array.from({ length: count(shape, 'TopAbs_FACE') }, (_, j) => facePlane(shape, j));
    // Later faces keep their numbers only until the first boolean, so take their slabs up front.
    const slabs = [];
    for (const f of faces) {
        const p = planes[f];
        const wall = distance > 0 ? Math.max(0, ...points.map(q => q.clone().sub(p.origin).dot(p.normal))) : 0;
        const past = wall > 1e-6 && distance >= wall - 1e-6;
        slabs.push(extrudeFace(shape, f, past && grow === 'fixed' ? wall : distance));
        if (past && grow === 'moving' && distance > wall + 1e-6) {
            planes.forEach((q, g) => {
                if (q && q.normal.dot(p.normal) > 1 - 1e-9 && Math.abs(q.origin.clone().sub(p.origin).dot(p.normal) - wall) < 1e-5) slabs.push(extrudeFace(shape, g, distance - wall));
            });
        }
    }
    for (const slab of slabs) {
        const r = booleanWithHistory(s, slab, distance > 0 ? 'union' : 'difference');
        history = history ? chain(history, r.history) : r.history;
        s = r.shape;
    }
    // A pushed face ends up as the slab's far face; it stays the face that was picked, as on the
    // desktop, so it keeps its ref.
    const moved = [];
    for (const f of faces) {
        const p = planes[f], at = p.origin.clone().addScaledVector(p.normal, distance);
        for (let j = 0; j < count(s, 'TopAbs_FACE'); j++) {
            const q = facePlane(s, j);
            if (q && q.normal.dot(p.normal) > 1 - 1e-9 && Math.abs(q.origin.clone().sub(at).dot(p.normal)) < 1e-6) moved.push([f, j]);
        }
    }
    history.faces[0] = [...moved, ...history.faces[0].filter(([, j]) => !moved.some(([, k]) => k === j))];
    return { shape: s, history };
}

// --- Extrude with an angle, a wall thickness and a second side ----------------------------------
// As on the desktop: A leans the sides in by `angle` radians going away from the profile, Shift+T
// leaves walls `thickness` thick inside the outline, and `back` extrudes the other way as well.

/** The planar wire grown outwards by `d` (shrunk when negative), with sharp corners. */
function offsetWire(w, d) {
    const o = oc();
    if (Math.abs(d) < 1e-12) return w;
    const mk = new o.BRepOffsetAPI_MakeOffset(face(w), o.GeomAbs_JoinType.GeomAbs_Intersection, false);
    mk.Perform(d, 0);
    if (!mk.IsDone()) throw new Error('the outline cannot be shrunk that far');
    const wires = [];
    for (const ex = new o.TopExp_Explorer(mk.Shape(), o.TopAbs_ShapeEnum.TopAbs_WIRE, o.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) wires.push(o.TopoDS.Wire(ex.Current()));
    if (wires.length !== 1) throw new Error('the outline cannot be shrunk that far');
    return wires[0];
}

function moved(shape, v) {
    const o = oc(), t = new o.gp_Trsf();
    t.SetTranslation(new o.gp_Vec(v.x, v.y, v.z));
    return new o.BRepBuilderAPI_Transform(shape, t, true, false).Shape();
}

/** The area a closed planar wire encloses. */
function enclosed(w) {
    const o = oc(), g = new o.GProp_GProps();
    o.BRepGProp.SurfaceProperties(face(w), g, false, false);
    return Math.abs(g.Mass());
}

/** The wire grown by `d` (shrunk when negative) whichever way round it runs, as a hole's runs the other way. */
function grown(w, d) {
    if (Math.abs(d) < 1e-12) return w;
    const r = offsetWire(w, d);
    return (enclosed(r) > enclosed(w)) === (d > 0) ? r : offsetWire(w, -d);
}

/**
 * The outline swept along unit `n` from `back` behind to `d` ahead; at height h it is grown by
 * `grow + slope * |h|`, so a slope of -tan(angle) leans the sides in by `angle`.
 */
function stack(w, n, d, back, grow, slope) {
    const o = oc(), sign = d < 0 ? -1 : 1;
    if (Math.abs(slope) < 1e-12) {
        const base = o.TopoDS.Face(moved(face(grown(w, grow)), n.clone().multiplyScalar(-sign * back)));
        const v = n.clone().multiplyScalar(d + sign * back);
        return new o.BRepPrimAPI_MakePrism(base, new o.gp_Vec(v.x, v.y, v.z), false, true).Shape();
    }
    const mk = new o.BRepOffsetAPI_ThruSections(true, true, 1e-6);
    for (const h of [...(back > 1e-12 ? [-sign * back] : []), 0, d]) mk.AddWire(o.TopoDS.Wire(moved(grown(w, grow + Math.abs(h) * slope), n.clone().multiplyScalar(h))));
    mk.Build(new o.Message_ProgressRange());
    if (!mk.IsDone()) throw new Error('the sides cannot lean that far');
    return mk.Shape();
}

/** The face's region swept by `stack`, its outline grown by `grow` and its holes shrunk to match. */
function regionStack(base, n, d, back, angle, grow) {
    const o = oc(), k = Math.tan(angle), outer = o.BRepTools.OuterWire(base);
    let solid = stack(outer, n, d, back, grow, -k);
    for (const ex = new o.TopExp_Explorer(base, o.TopAbs_ShapeEnum.TopAbs_WIRE, o.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
        const hole = o.TopoDS.Wire(ex.Current());
        if (hole.IsSame(outer)) continue;
        solid = boolean(solid, stack(hole, n, d, back, -grow, k), 'difference');
    }
    return solid;
}

/** `base` (a planar face, holes and all) extruded along unit `n`, with Plasticity's Extrude options. */
export function shapedExtrude(base, n, d, back = 0, angle = 0, thickness = 0) {
    const o = oc();
    if (![d, back, angle, thickness].every(Number.isFinite)) throw new Error('a distance is not a number');
    if (back < 0 || thickness < 0) throw new Error("the far side and the thickness can't be negative");
    if (Math.abs(angle) >= Math.PI / 2 - 1e-6) throw new Error('the angle must be less than 90 degrees');
    if (Math.abs(angle) < 1e-12 && thickness < 1e-12) {
        const sign = d < 0 ? -1 : 1, f = o.TopoDS.Face(moved(base, n.clone().multiplyScalar(-sign * back))), v = n.clone().multiplyScalar(d + sign * back);
        return new o.BRepPrimAPI_MakePrism(f, new o.gp_Vec(v.x, v.y, v.z), false, true).Shape();
    }
    const solid = regionStack(base, n, d, back, angle, 0);
    if (thickness < 1e-12) return solid;
    return boolean(solid, regionStack(base, n, d, back, angle, -thickness), 'difference');
}

/** The numbered face of `shape` as a face to extrude, with its outward normal. */
export function faceBase(shape, index) {
    const o = oc(), p = facePlane(shape, index);
    if (!p) throw new Error('only flat faces can be extruded here yet');
    let i = 0;
    for (const ex = new o.TopExp_Explorer(shape, o.TopAbs_ShapeEnum.TopAbs_FACE, o.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next(), i++) {
        if (i !== index) continue;
        const f = o.TopoDS.Face(ex.Current());
        return { face: o.TopoDS.Face(f.Oriented(o.TopAbs_Orientation.TopAbs_FORWARD)), normal: p.normal };
    }
    throw new Error('that face no longer exists');
}

/**
 * Plasticity's Cut with curves: each curve as a cutting sheet, its wire extruded `length` mm both
 * ways along its plane's normal, so it passes right through whatever it is drawn over.
 */
export function cutSheets(curves, length) {
    const o = oc();
    if (!(length > 0)) throw new Error('nothing to cut');
    return curves.map(c => {
        const n = plane(c).n, wire = wireOf(geometry(c)).Wire();
        const back = new o.gp_Trsf();
        back.SetTranslation(new o.gp_Vec(-n.x * length, -n.y * length, -n.z * length));
        const start = new o.BRepBuilderAPI_Transform(wire, back, true, false).Shape();
        return new o.BRepPrimAPI_MakePrism(start, new o.gp_Vec(2 * n.x * length, 2 * n.y * length, 2 * n.z * length), false, true).Shape();
    });
}
