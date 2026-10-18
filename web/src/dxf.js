// DXF import (Plasticity's File › Import reads DXF drawings as curves). The drawing's entities
// become this app's planar curves on the XY construction plane, in millimetres: lines, polylines
// (bulges become arcs), circles, arcs, ellipses and splines. Shared by both builds; the backends
// only store the curves. Written from the published DXF reference (group codes), not from any
// importer's code.

/** The XY construction plane in model coordinates (user Z is model Y). */
const XY = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0] };

/** Millimetres per drawing unit by $INSUNITS; unitless (0) and the rest are taken as millimetres. */
const UNITS = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 8: 25.4e-6, 9: 0.0254, 10: 914.4, 14: 100, 15: 10000 };
const UNIT_NAMES = { 1: 'IN', 2: 'FT', 4: 'MM', 5: 'CM', 6: 'M', 8: 'µIN', 9: 'MIL', 10: 'YD', 14: 'DM', 15: 'DAM' };

/** The file as [code, value] pairs. */
function pairs(text) {
    const lines = text.split(/\r\n|\r|\n/);
    const out = [];
    for (let i = 0; i + 1 < lines.length; i += 2) {
        const code = parseInt(lines[i].trim(), 10);
        if (Number.isNaN(code)) throw new Error('NOT A DXF FILE (A TEXT DXF IS NEEDED; BINARY DXF IS NOT READ)');
        out.push([code, lines[i + 1].trim()]);
        if (code === 0 && out.at(-1)[1] === 'EOF') break;
    }
    return out;
}

/** Entities as { type, codes: [[code, value]...] }, from the ENTITIES section, and the header's units. */
function read(text) {
    const all = pairs(text);
    if (!all.some(([k, v]) => k === 0 && v === 'SECTION')) throw new Error('NOT A DXF FILE (A TEXT DXF IS NEEDED; BINARY DXF IS NOT READ)');
    let section = null, units = 0;
    const entities = [];
    for (let i = 0; i < all.length; i++) {
        const [code, value] = all[i];
        if (code === 0 && value === 'SECTION') { section = all[i + 1]?.[1]; i++; continue; }
        if (code === 0 && value === 'ENDSEC') { section = null; continue; }
        if (section === 'HEADER' && code === 9 && value === '$INSUNITS') {
            const v = all[i + 1];
            if (v?.[0] === 70) units = parseInt(v[1], 10);
            continue;
        }
        if (section !== 'ENTITIES') continue;
        if (code === 0) entities.push({ type: value, codes: [] });
        else entities.at(-1)?.codes.push([code, value]);
    }
    return { entities, units };
}

const num = (codes, code, fallback = 0) => {
    const c = codes.find(([k]) => k === code);
    return c ? parseFloat(c[1]) : fallback;
};
const all = (codes, code) => codes.filter(([k]) => k === code).map(([, v]) => parseFloat(v));
/** Arbitrary-axis entities drawn with their extrusion pointing down are mirrored in x. */
const flip = codes => num(codes, 230, 1) < 0 ? -1 : 1;

const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9;

/** The arc's middle between `a` and `b` along a polyline segment with DXF bulge `bulge` (tan of a quarter of its angle, positive counter-clockwise). */
function bulgeMid(a, b, bulge) {
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    const s = bulge * len / 2;
    return [(a[0] + b[0]) / 2 + dy / len * s, (a[1] + b[1]) / 2 - dx / len * s];
}

/** Vertices with bulges as a polyline, or a contour of lines and arcs when any bulge bends. */
function polyline(points, bulges, closed) {
    if (points.length < 2) return null;
    const pts = [...points];
    // A closing vertex that repeats the first is the same as the closed flag.
    if (pts.length > 2 && near(pts[0], pts.at(-1))) { pts.pop(); closed = true; }
    const n = pts.length;
    const bends = bulges.slice(0, closed ? n : n - 1).some(b => Math.abs(b) > 1e-12);
    if (!bends) return { kind: 'polyline', points: pts, closed: closed && n >= 3 };
    const pieces = [];
    let run = null;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
        const a = pts[i], b = pts[(i + 1) % n], bulge = bulges[i] ?? 0;
        if (near(a, b)) continue;
        if (Math.abs(bulge) > 1e-12) {
            run = null;
            pieces.push({ kind: 'arc', start: a, mid: bulgeMid(a, b, bulge), end: b });
        } else if (run) run.points.push(b);
        else pieces.push(run = { kind: 'polyline', points: [a, b], closed: false });
    }
    if (pieces.length === 1 && pieces[0].kind === 'arc') return pieces[0];
    return { kind: 'contour', pieces };
}

/** Points along an ellipse's arc from `t0` to `t1` (radians), for the part of an ellipse the curve kinds can't hold. */
function ellipsePoints(c, major, ratio, t0, t1, n = 96) {
    const minor = [-major[1] * ratio, major[0] * ratio];
    return Array.from({ length: n + 1 }, (_, i) => {
        const t = t0 + (t1 - t0) * i / n;
        return [c[0] + major[0] * Math.cos(t) + minor[0] * Math.sin(t), c[1] + major[1] * Math.cos(t) + minor[1] * Math.sin(t)];
    });
}

/**
 * The drawing's curves, ready for addCurves, and what was left out: { curves, skipped: { TYPE: n },
 * approximated, units, scale }. Throws on a file that isn't a text DXF or has nothing to import.
 */
export function readDxf(text) {
    const { entities, units } = read(text);
    const scale = UNITS[units] ?? 1;
    const at = (x, y) => [x * scale, y * scale];
    const curves = [], skipped = {};
    let approximated = 0;
    const skip = type => { skipped[type] = (skipped[type] ?? 0) + 1; };
    // A curve with a number that didn't read (a damaged file) is left out rather than sent on.
    const finite = v => Array.isArray(v) ? v.every(finite) : typeof v !== 'number' || Number.isFinite(v);
    const add = shape => {
        if (!shape) return;
        if (!Object.values(shape).every(finite) || !(shape.pieces ?? []).every(p => Object.values(p).every(finite))) return skip('DAMAGED ENTITY');
        curves.push({ ...XY, ...shape });
    };
    for (let i = 0; i < entities.length; i++) {
        const { type, codes } = entities[i];
        const f = flip(codes);
        switch (type) {
        case 'LINE': {
            const a = at(num(codes, 10), num(codes, 20)), b = at(num(codes, 11), num(codes, 21));
            if (!near(a, b)) add({ kind: 'polyline', points: [a, b], closed: false });
            break;
        }
        case 'CIRCLE': {
            const r = num(codes, 40) * scale;
            if (r > 0) add({ kind: 'circle', center: at(f * num(codes, 10), num(codes, 20)), radius: r });
            break;
        }
        case 'ARC': {
            const c = [f * num(codes, 10), num(codes, 20)], r = num(codes, 40);
            let a0 = num(codes, 50) * Math.PI / 180, a1 = num(codes, 51) * Math.PI / 180;
            if (a1 <= a0) a1 += 2 * Math.PI;
            if (!(r > 0)) break;
            // Mirrored (extrusion down), the arc runs the other way round the mirrored centre.
            const q = a => at(c[0] + f * r * Math.cos(a), c[1] + r * Math.sin(a));
            add({ kind: 'arc', start: q(a0), mid: q((a0 + a1) / 2), end: q(a1) });
            break;
        }
        case 'LWPOLYLINE': {
            // Each vertex is a 10 then its 20; a bulge (42) belongs to the vertex before it.
            const pts = [], bulges = [];
            for (const [k, val] of codes) {
                if (k === 10) { pts.push([parseFloat(val), 0]); bulges.push(0); }
                if (k === 20 && pts.length) pts.at(-1)[1] = parseFloat(val);
                if (k === 42 && pts.length) bulges[bulges.length - 1] = f * parseFloat(val);
            }
            add(polyline(pts.map(([x, y]) => at(f * x, y)), bulges, (num(codes, 70) & 1) === 1));
            break;
        }
        case 'POLYLINE': {
            const flags = num(codes, 70);
            const pts = [], bulges = [];
            while (entities[i + 1]?.type === 'VERTEX') {
                const vc = entities[++i].codes;
                if (num(vc, 70) & 16) continue; // spline frame control points
                pts.push(at(f * num(vc, 10), num(vc, 20)));
                bulges.push(f * num(vc, 42));
            }
            if (entities[i + 1]?.type === 'SEQEND') i++;
            // 3D polylines and meshes (8, 16, 64) aren't drawings on a plane.
            if (flags & (8 | 16 | 64)) { skip('POLYLINE (3D)'); break; }
            add(polyline(pts, bulges, (flags & 1) === 1));
            break;
        }
        case 'ELLIPSE': {
            const c = at(num(codes, 10), num(codes, 20)), major = at(num(codes, 11), num(codes, 21)), ratio = num(codes, 40, 1);
            const t0 = num(codes, 41, 0), t1 = num(codes, 42, 2 * Math.PI);
            if (!(Math.hypot(...major) > 0) || !(ratio > 0)) break;
            if (Math.abs(t1 - t0 - 2 * Math.PI) < 1e-9 || Math.abs(t1 - t0) < 1e-12) {
                add({ kind: 'ellipse', center: c, major, minor: Math.hypot(...major) * ratio });
            } else {
                approximated++;
                add({ kind: 'spline', points: ellipsePoints(c, major, ratio, t0, t1 > t0 ? t1 : t1 + 2 * Math.PI), closed: false });
            }
            break;
        }
        case 'SPLINE': {
            const flags = num(codes, 70), degree = num(codes, 71, 3);
            const knots = all(codes, 40), xs = all(codes, 10), ys = all(codes, 20);
            const fx = all(codes, 11), fy = all(codes, 21);
            if (xs.length >= degree + 1 && knots.length === xs.length + degree + 1) {
                let weights = all(codes, 41);
                if (weights.length !== xs.length) weights = xs.map(() => 1);
                add({ kind: 'nurbs', degree, poles: xs.map((x, j) => [...at(x, ys[j]), 0]), weights, knots });
            } else if (fx.length >= 2) {
                add({ kind: 'spline', points: fx.map((x, j) => at(x, fy[j])), closed: (flags & 1) === 1 });
            } else skip('SPLINE (INCOMPLETE)');
            break;
        }
        case 'VERTEX': case 'SEQEND': break;
        default: skip(type);
        }
    }
    if (!curves.length) throw new Error(Object.keys(skipped).length ? `NO CURVES TO IMPORT (ONLY ${Object.keys(skipped).join(', ')})` : 'NO CURVES TO IMPORT IN THAT DXF');
    return { curves, skipped, approximated, units: UNIT_NAMES[units] ?? 'MM', scale };
}
