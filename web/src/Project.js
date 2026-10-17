// Plasticity's Project in the browser build: Curve Body, Body Body and Curve Curve, as w3d_project,
// w3d_meet_curves and w3d_project_curve_curve do it on the desktop. The curves come out as NURBS in
// model space ({ degree, poles: [[x, y, z]], weights, knots }); curveFromNurbs (curves.js) makes
// drawn curves of them.
//
// The browser's OpenCascade lacks the desktop's ray-face intersector and curve joiner, so Hide
// Occluded casts rays against the body's mesh (the desktop hits the exact faces) and chains are
// joined here.

import * as THREE from 'three';
import { numbered, oc, tessellate } from './Kernel.js';
import { curveWire } from './Forms.js';

const LINK = 1e-5;

/** The wire swept along `dir`: `length` forwards, and as far backwards too when `both`. */
function curtain(wire, dir, length, both) {
    const o = oc();
    let start = wire;
    if (both) {
        const back = new o.gp_Trsf();
        back.SetTranslation(new o.gp_Vec(-dir.x * length, -dir.y * length, -dir.z * length));
        start = new o.BRepBuilderAPI_Transform(wire, back, true, false).Shape();
    }
    const d = both ? 2 * length : length;
    return new o.BRepPrimAPI_MakePrism(start, new o.gp_Vec(dir.x * d, dir.y * d, dir.z * d), false, true).Shape();
}

/** The edges where `a` and `b` meet, with approximated 3D curves. */
function meet(a, b) {
    const o = oc();
    const sec = new o.BRepAlgoAPI_Section(a, b, false);
    sec.Approximation(true);
    sec.Build(new o.Message_ProgressRange());
    return sec.IsDone() ? numbered(sec.Shape(), 'TopAbs_EDGE').map(e => o.TopoDS.Edge(e)) : [];
}

/** An edge's curve between `t0` and `t1` as a B-spline. */
export function bspline(edge, t0, t1) {
    const o = oc();
    const { returnValue: curve, First, Last } = o.BRep_Tool.Curve(edge, 0, 0);
    if (!curve) return null;
    const a = t0 ?? First, b = t1 ?? Last;
    if (!(b - a > 1e-12)) return null;
    return o.GeomConvert.CurveToBSplineCurve(new o.Geom_TrimmedCurve(curve, a, b, true, true));
}

const ends = b => { const p = b.Pole(1), q = b.Pole(b.NbPoles()); return [new THREE.Vector3(p.X(), p.Y(), p.Z()), new THREE.Vector3(q.X(), q.Y(), q.Z())]; };

/** A B-spline's numbers: poles, weights and flat knots, reversed when `flip`. */
function numbers(b, flip) {
    const n = b.NbPoles(), poles = [], weights = [], knots = [];
    for (let i = 1; i <= n; i++) { const p = b.Pole(i); poles.push([p.X(), p.Y(), p.Z()]); weights.push(b.Weight(i)); }
    for (let i = 1; i <= b.NbKnots(); i++) for (let m = 0; m < b.Multiplicity(i); m++) knots.push(b.Knot(i));
    if (!flip) return { degree: b.Degree(), poles, weights, knots };
    const sum = knots[0] + knots.at(-1);
    return { degree: b.Degree(), poles: poles.reverse(), weights: weights.reverse(), knots: knots.reverse().map(k => sum - k) };
}

/** Two clamped NURBS of one degree, the second starting where the first ends, as one. */
function append(a, b) {
    const p = a.degree, shift = a.knots.at(-1) - b.knots[0], scale = a.weights.at(-1) / b.weights[0];
    return {
        degree: p,
        poles: [...a.poles, ...b.poles.slice(1)],
        weights: [...a.weights, ...b.weights.slice(1).map(w => w * scale)],
        knots: [...a.knots.slice(0, -1), ...b.knots.slice(p + 1).map(k => k + shift)],
    };
}

/** The B-splines joined end to end into chains, each chain one NURBS curve. */
export function chains(splines) {
    const items = splines.filter(Boolean).map(b => ({ b, ends: ends(b) }));
    const used = items.map(() => false), out = [];
    for (let s = 0; s < items.length; s++) {
        if (used[s]) continue;
        used[s] = true;
        const run = [{ ...items[s], flip: false }];
        const head = () => run[0].flip ? run[0].ends[1] : run[0].ends[0];
        const tail = () => run.at(-1).flip ? run.at(-1).ends[0] : run.at(-1).ends[1];
        for (let grew = true; grew;) {
            grew = false;
            if (run.length > 1 && head().distanceTo(tail()) < LINK) break;
            for (let i = 0; i < items.length; i++) {
                if (used[i]) continue;
                const [a, b] = items[i].ends;
                if (a.distanceTo(tail()) < LINK) run.push({ ...items[i], flip: false });
                else if (b.distanceTo(tail()) < LINK) run.push({ ...items[i], flip: true });
                else if (b.distanceTo(head()) < LINK) run.unshift({ ...items[i], flip: false });
                else if (a.distanceTo(head()) < LINK) run.unshift({ ...items[i], flip: true });
                else continue;
                used[i] = grew = true;
                break;
            }
        }
        const degree = Math.max(...run.map(r => r.b.Degree()));
        for (const r of run) r.b.IncreaseDegree(degree);
        out.push(run.map(r => numbers(r.b, r.flip)).reduce(append));
    }
    return out;
}

/** Points along a wire's edges, densely enough to find where a projected point came from. */
function samples(wire, per = 256) {
    const o = oc(), out = [];
    for (const e of numbered(wire, 'TopAbs_EDGE')) {
        const { returnValue: g, First, Last } = o.BRep_Tool.Curve(o.TopoDS.Edge(e), 0, 0);
        if (!g) continue;
        for (let i = 0; i <= per; i++) { const p = g.Value(First + (Last - First) * i / per); out.push(new THREE.Vector3(p.X(), p.Y(), p.Z())); }
    }
    return out;
}

/** The triangles of `shape`'s faces, for casting rays. */
export function triangles(shape) {
    const { mesh } = tessellate(shape, { deflection: 0.001, angle: 0.1 });
    const pos = mesh.getAttribute('position'), idx = mesh.getIndex().array, out = [];
    const v = i => new THREE.Vector3().fromBufferAttribute(pos, i);
    for (let i = 0; i < idx.length; i += 3) {
        const [a, b, c] = [v(idx[i]), v(idx[i + 1]), v(idx[i + 2])];
        const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
        if (n.lengthSq() > 0) out.push({ a, b, c, n: n.normalize() });
    }
    return out;
}

/** Whether a triangle not met edge-on lies along the ray from `from` along `d`, within `far`. */
function blocked(tris, from, d, far) {
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), h = new THREE.Vector3(), s = new THREE.Vector3(), q = new THREE.Vector3();
    for (const t of tris) {
        if (Math.abs(t.n.dot(d)) < 1e-3) continue;
        e1.subVectors(t.b, t.a); e2.subVectors(t.c, t.a);
        h.crossVectors(d, e2);
        const det = e1.dot(h);
        if (Math.abs(det) < 1e-14) continue;
        s.subVectors(from, t.a);
        const u = s.dot(h) / det;
        if (u < 0 || u > 1) continue;
        q.crossVectors(s, e1);
        const v = d.dot(q) / det;
        if (v < 0 || u + v > 1) continue;
        const dist = e2.dot(q) / det;
        if (dist > 0 && dist < far) return true;
    }
    return false;
}

/**
 * Plasticity's Project Curve Body: the drawn curves carried along `dir` (a unit THREE.Vector3)
 * onto `faces` of `shape` (all when empty), forwards only unless `both`; with `hide`, only what is
 * seen looking along `dir` from the curve. Returns NURBS in model space. Throws when nothing lands.
 */
export function projectCurves(shape, faces, curves, dir, { length, both = false, hide = false }) {
    const o = oc();
    const all = numbered(shape, 'TopAbs_FACE');
    for (const f of faces) if (!all[f]) throw new Error('that face no longer exists');
    const targets = faces.length ? faces.map(i => all[i]) : all;
    const tris = hide ? triangles(shape) : null;
    // The mesh lies within its deflection of the faces, so rays start a little off them, and a
    // piece no longer than that start is the rim of a face seen edge-on, not a curve.
    const skip = 1e-2, splines = [];
    for (const c of curves) {
        const wire = curveWire(c);
        const sheet = curtain(wire, dir, length, both);
        const edges = targets.flatMap(f => meet(f, sheet));
        if (!hide) { splines.push(...edges.map(e => bspline(e))); continue; }
        const source = samples(wire);
        // Seen when no face crosses the way back from the point to the curve it came from.
        const seen = p => {
            let s = source[0], best = Infinity;
            for (const q of source) { const off = q.clone().sub(p).cross(dir).length(); if (off < best) { best = off; s = q; } }
            const far = Math.abs(p.clone().sub(s).dot(dir));
            const back = p.clone().sub(s).dot(dir) >= 0 ? dir.clone().negate() : dir.clone();
            return !blocked(tris, p.clone().addScaledVector(back, skip), back, far - 2 * skip);
        };
        for (const e of edges) {
            const { returnValue: g, First: t0, Last: t1 } = o.BRep_Tool.Curve(e, 0, 0);
            if (!g) continue;
            const at = t => { const p = g.Value(t); return seen(new THREE.Vector3(p.X(), p.Y(), p.Z())); };
            const N = 16, vis = Array.from({ length: N + 1 }, (_, i) => at(t0 + (t1 - t0) * i / N));
            const edge = (a, b, ia) => { let lo = a, hi = b; for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (at(m) === ia) lo = m; else hi = m; } return (lo + hi) / 2; };
            for (let i = 0; i <= N;) {
                if (!vis[i]) { i++; continue; }
                let j = i;
                while (j < N && vis[j + 1]) j++;
                const a = i === 0 ? t0 : edge(t0 + (t1 - t0) * (i - 1) / N, t0 + (t1 - t0) * i / N, false);
                const b = j === N ? t1 : edge(t0 + (t1 - t0) * j / N, t0 + (t1 - t0) * (j + 1) / N, true);
                const [p, m, q] = [a, (a + b) / 2, b].map(t => g.Value(t));
                if (p.Distance(m) + m.Distance(q) > 2 * skip) splines.push(bspline(e, a, b));
                i = j + 1;
            }
        }
    }
    const out = chains(splines);
    if (!out.length) throw new Error(hide ? 'the curves miss what can be seen of the body along that direction' : 'the curves miss the body along that direction');
    return out;
}

/** Plasticity's Project Body Body: the curves where two shapes meet. */
export function meetCurves(a, b) {
    const out = chains(meet(a, b).map(e => bspline(e)));
    if (!out.length) throw new Error('the two bodies do not meet');
    return out;
}

/** Plasticity's Project Curve Curve: where the two curves' sheets, each swept both ways along its own normal, meet. */
export function projectCurveCurve(a, b, length) {
    const sheet = c => curtain(curveWire(c), new THREE.Vector3(...c.normal).normalize(), length, true);
    const out = chains(meet(sheet(a), sheet(b)).map(e => bspline(e)));
    if (!out.length) throw new Error("the two curves' sheets do not meet; check that their directions cross");
    return out;
}
