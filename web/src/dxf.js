// DXF import (Plasticity's File › Import reads DXF drawings as curves). The drawing's entities
// become this app's planar curves on the XY construction plane, in millimetres: lines, polylines
// (bulges become arcs), circles, arcs, ellipses and splines, blocks where INSERT places them, and
// TEXT and MTEXT drawn as outlines in a given font. Shared by both builds; the backends
// only store the curves. Written from the published DXF reference (group codes), not from any
// importer's code.

import { textShapes } from './text.js';
import { nurbsPoints } from './curves.js';

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

/**
 * Entities as { type, codes: [[code, value]...] }, from the ENTITIES section, the blocks INSERT
 * places (name -> { base, entities }), and the header's units.
 */
function read(text) {
    const all = pairs(text);
    if (!all.some(([k, v]) => k === 0 && v === 'SECTION')) throw new Error('NOT A DXF FILE (A TEXT DXF IS NEEDED; BINARY DXF IS NOT READ)');
    let section = null, units = 0, block = null;
    const entities = [], blocks = new Map();
    for (let i = 0; i < all.length; i++) {
        const [code, value] = all[i];
        if (code === 0 && value === 'SECTION') { section = all[i + 1]?.[1]; i++; continue; }
        if (code === 0 && value === 'ENDSEC') { section = null; continue; }
        if (section === 'HEADER' && code === 9 && value === '$INSUNITS') {
            const v = all[i + 1];
            if (v?.[0] === 70) units = parseInt(v[1], 10);
            continue;
        }
        if (section === 'BLOCKS') {
            // BLOCK opens a definition (its own codes: 2 the name, 10/20 the base point), ENDBLK closes it.
            if (code === 0 && value === 'BLOCK') { block = { head: [], entities: [] }; continue; }
            if (code === 0 && value === 'ENDBLK') {
                const name = block?.head.find(([k]) => k === 2)?.[1];
                if (name !== undefined) blocks.set(name, { base: [num(block.head, 10), num(block.head, 20)], entities: block.entities });
                block = null;
                continue;
            }
            if (!block) continue;
            if (code === 0) block.entities.push({ type: value, codes: [] });
            else if (block.entities.length) block.entities.at(-1).codes.push([code, value]);
            else block.head.push([code, value]);
            continue;
        }
        if (section !== 'ENTITIES') continue;
        if (code === 0) entities.push({ type: value, codes: [] });
        else entities.at(-1)?.codes.push([code, value]);
    }
    return { entities, blocks, units };
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
 * approximated, inserted, texts, units, scale }. With a `font` (text.js parseFont), TEXT and MTEXT
 * come in as the outlines of their letters in it; without one they are skipped. Throws on a file
 * that isn't a text DXF or has nothing to import.
 */
export function readDxf(text, { font = null } = {}) {
    const { entities, blocks, units } = read(text);
    const scale = UNITS[units] ?? 1;
    const at = (x, y) => [x * scale, y * scale];
    const curves = [], skipped = {};
    let approximated = 0;
    const skip = type => { skipped[type] = (skipped[type] ?? 0) + 1; };
    // A curve with a number that didn't read (a damaged file) is left out rather than sent on.
    const finite = v => Array.isArray(v) ? v.every(finite) : typeof v !== 'number' || Number.isFinite(v);
    const put = shape => {
        if (!Object.values(shape).every(finite) || !(shape.pieces ?? []).every(p => Object.values(p).every(finite))) return skip('DAMAGED ENTITY');
        curves.push({ ...XY, ...shape });
    };
    let inserted = 0, texts = 0, hatches = 0, dimensions = 0;
    // `place` carries a block's curves to where an INSERT puts them (identity at the top level).
    const convert = (entities, place, depth) => {
    const add = shape => {
        if (!shape) return;
        const placed = place(shape);
        if (placed.approximated) approximated++;
        put(placed.shape);
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
        case 'INSERT': {
            // A block placed: its curves moved from its base point, scaled, turned, and repeated in
            // columns and rows (MINSERT). Nested blocks are followed a few levels deep.
            const block = blocks.get(codes.find(([k]) => k === 2)?.[1]);
            if (!block) { skip('INSERT (MISSING BLOCK)'); break; }
            if (depth > 8) { skip('INSERT (NESTED TOO DEEP)'); break; }
            const sx = f * num(codes, 41, 1), sy = num(codes, 42, 1), rot = f * num(codes, 50) * Math.PI / 180;
            const cols = Math.max(1, num(codes, 70, 1)), rows = Math.max(1, num(codes, 71, 1)), dc = num(codes, 44) * scale, dr = num(codes, 45) * scale;
            const base = at(...block.base), ins = at(f * num(codes, 10), num(codes, 20));
            const c = Math.cos(rot), s = Math.sin(rot);
            for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
                // The grid steps along the block's own turned x and y.
                const o = [ins[0] + c * k * dc - s * r * dr, ins[1] + s * k * dc + c * r * dr];
                const m = { a: c * sx, b: -s * sy, c: s * sx, d: c * sy, e: o[0] - (c * sx * base[0] - s * sy * base[1]), f: o[1] - (s * sx * base[0] + c * sy * base[1]) };
                convert(block.entities, shape => { const t = transformShape(shape, m), p = place(t.shape); return { shape: p.shape, approximated: t.approximated || p.approximated }; }, depth + 1);
            }
            inserted++;
            break;
        }
        case 'TEXT': case 'MTEXT': {
            if (!font) { skip(type); break; }
            const t = type === 'TEXT' ? textOf(codes) : mtextOf(codes);
            if (!t || !t.string.trim()) break;
            const placed = lettering(font, t, f, scale);
            if (!placed) { skip(`${type} (EMPTY)`); break; }
            for (const sh of placed) add(sh);
            texts++;
            break;
        }
        case 'HATCH': {
            // A hatch's boundary loops come in as closed curves (this app draws no fill patterns).
            // Loops tied to entities already in the drawing (associative) would only repeat them.
            const { loops, linked } = hatchLoops(codes);
            for (const lp of loops) {
                if (lp.approximated) approximated++;
                add(mapShape(lp.shape, p => at(f * p[0], p[1])));
            }
            if (loops.length) hatches++;
            else if (linked) skip('HATCH (BOUNDARY ALREADY DRAWN)');
            else skip('HATCH (NO BOUNDARY)');
            break;
        }
        case 'DIMENSION': {
            // A dimension is drawn by its own block (lines, arrowheads, text) already where it stands.
            const block = blocks.get(codes.find(([k]) => k === 2)?.[1]);
            if (!block || depth > 8) { skip('DIMENSION (NOT DRAWN)'); break; }
            convert(block.entities, place, depth + 1);
            dimensions++;
            break;
        }
        case 'SOLID': case 'TRACE': {
            // A filled triangle or quad (arrowheads): its outline. The fourth corner comes before the third.
            const q = [[10, 20], [11, 21], [13, 23], [12, 22]].map(([x, y]) => at(f * num(codes, x), num(codes, y)));
            const pts = q.filter((pt, j) => !q.slice(0, j).some(r => near(r, pt)));
            if (pts.length >= 3) add({ kind: 'polyline', points: pts, closed: true });
            break;
        }
        case 'VERTEX': case 'SEQEND': break;
        default: skip(type);
        }
    }
    };
    convert(entities, shape => ({ shape }), 0);
    if (!curves.length) throw new Error(Object.keys(skipped).length ? `NO CURVES TO IMPORT (ONLY ${Object.keys(skipped).join(', ')})` : 'NO CURVES TO IMPORT IN THAT DXF');
    return { curves, skipped, approximated, inserted, texts, hatches, dimensions, units: UNIT_NAMES[units] ?? 'MM', scale };
}

/** A shape with every point (in drawing units) carried by `P`; arcs keep their three points. */
function mapShape(sh, P) {
    switch (sh.kind) {
    case 'polyline': case 'spline': return { ...sh, points: sh.points.map(P) };
    case 'nurbs': return { ...sh, poles: sh.poles.map(([x, y, z]) => [...P([x, y]), z]) };
    case 'arc': return { kind: 'arc', start: P(sh.start), mid: P(sh.mid), end: P(sh.end) };
    case 'circle': { const c = P(sh.center), e = P([sh.center[0] + sh.radius, sh.center[1]]); return { kind: 'circle', center: c, radius: Math.hypot(e[0] - c[0], e[1] - c[1]) }; }
    case 'ellipse': { const c = P(sh.center), e = P([sh.center[0] + sh.major[0], sh.center[1] + sh.major[1]]), k = Math.hypot(e[0] - c[0], e[1] - c[1]) / Math.hypot(...sh.major); return { kind: 'ellipse', center: c, major: [e[0] - c[0], e[1] - c[1]], minor: sh.minor * k }; }
    case 'contour': return { kind: 'contour', pieces: sh.pieces.map(q => mapShape(q, P)) };
    default: return sh;
    }
}

/**
 * A HATCH entity's boundary loops as curve shapes in drawing units: { loops: [{ shape, approximated }],
 * linked } where `linked` counts loops left out because entities in the drawing already draw them.
 * The boundary data is read in its order (91 loops; each a 92 type, then a polyline or 93 edges, then
 * 97 source entities), so the pattern's own codes that follow are never taken for points.
 */
function hatchLoops(codes) {
    let i = codes.findIndex(([k]) => k === 91);
    if (i < 0) return { loops: [], linked: 0 };
    const count = parseInt(codes[i++][1], 10) || 0;
    const at = k => codes[i]?.[0] === k;
    // The value of the next code `k`, skipping codes it doesn't know on the way.
    const next = k => { while (i < codes.length && codes[i][0] !== k) i++; return i < codes.length ? parseFloat(codes[i++][1]) : NaN; };
    const loops = [];
    let linked = 0;
    for (let n = 0; n < count && i < codes.length; n++) {
        const type = next(92);
        let shape = null, approximated = false;
        if (type & 2) {
            const bulged = next(72), closed = next(73), m = next(93);
            const pts = [], bulges = [];
            for (let j = 0; j < m; j++) {
                pts.push([next(10), next(20)]);
                bulges.push(bulged && at(42) ? parseFloat(codes[i++][1]) : 0);
            }
            shape = polyline(pts, bulges, closed !== 0 || pts.length > 2);
        } else {
            const m = next(93), pieces = [];
            for (let j = 0; j < m; j++) {
                const kind = next(72);
                if (kind === 1) {
                    const a = [next(10), next(20)], b = [next(11), next(21)];
                    if (!near(a, b)) pieces.push({ kind: 'polyline', points: [a, b], closed: false });
                } else if (kind === 2) {
                    const c = [next(10), next(20)], r = next(40), s0 = next(50), s1 = next(51), ccw = next(73);
                    pieces.push(arcEdge(c, r, s0, s1, ccw));
                } else if (kind === 3) {
                    const c = [next(10), next(20)], major = [next(11), next(21)], ratio = next(40), s0 = next(50), s1 = next(51), ccw = next(73);
                    const sh = ellipseEdge(c, major, ratio, s0, s1, ccw);
                    if (sh.kind === 'spline') approximated = true;
                    pieces.push(sh);
                } else if (kind === 4) {
                    const degree = next(94), rational = next(73); next(74);
                    const nk = next(95), np = next(96);
                    const knots = Array.from({ length: nk }, () => next(40));
                    const poles = Array.from({ length: np }, () => [next(10), next(20), 0]);
                    const weights = rational && at(42) ? Array.from({ length: np }, () => next(42)) : poles.map(() => 1);
                    // Newer files add fit points (97 then 11/21) and end tangents (12/22, 13/23); a 97
                    // after the last edge is the fit count only when fit data follows it.
                    if (at(97) && (j < m - 1 || codes[i + 1]?.[0] === 11 || (codes[i][1].trim() === '0' && codes[i + 1]?.[0] === 97))) {
                        const fits = parseInt(codes[i++][1], 10) || 0;
                        for (let q = 0; q < fits; q++) { next(11); next(21); }
                        if (at(12)) { next(12); next(22); }
                        if (at(13)) { next(13); next(23); }
                    }
                    if (np >= degree + 1 && knots.length === np + degree + 1) pieces.push({ kind: 'nurbs', degree, poles, weights, knots });
                }
            }
            // A contour holds lines, arcs and splines through points: a NURBS edge among other
            // edges goes as the points along it (a straight one as a line).
            const joined = pieces.length > 1 ? pieces.map(q => {
                if (q.kind !== 'nurbs') return q;
                approximated = true;
                const pts = nurbsPoints(q).map(([x, y]) => [x, y]);
                return { kind: q.degree === 1 ? 'polyline' : 'spline', points: pts, closed: false };
            }) : pieces;
            shape = joined.length === 1 ? joined[0] : joined.length ? { kind: 'contour', pieces: joined } : null;
        }
        const sources = at(97) ? parseInt(codes[i++][1], 10) || 0 : 0;
        for (let q = 0; q < sources && at(330); q++) i++;
        if (sources > 0) { linked++; continue; }
        if (shape) loops.push({ shape, approximated });
    }
    return { loops, linked };
}

/** A hatch's arc edge (angles in degrees; a clockwise edge's angles are measured clockwise). */
function arcEdge(c, r, s0, s1, ccw) {
    const rad = Math.PI / 180, sg = ccw ? 1 : -1;
    let a0 = s0 * rad, a1 = s1 * rad;
    if (a1 <= a0) a1 += 2 * Math.PI;
    if (a1 - a0 >= 2 * Math.PI - 1e-9) return { kind: 'circle', center: c, radius: r };
    const q = a => [c[0] + r * Math.cos(sg * a), c[1] + r * Math.sin(sg * a)];
    return { kind: 'arc', start: q(a0), mid: q((a0 + a1) / 2), end: q(a1) };
}

/** A hatch's elliptic arc edge, a whole ellipse or points along the part of one. */
function ellipseEdge(c, major, ratio, s0, s1, ccw) {
    const rad = Math.PI / 180, sg = ccw ? 1 : -1;
    let t0 = s0 * rad, t1 = s1 * rad;
    if (t1 <= t0) t1 += 2 * Math.PI;
    if (t1 - t0 >= 2 * Math.PI - 1e-9) return { kind: 'ellipse', center: c, major, minor: Math.hypot(...major) * ratio };
    const pts = ellipsePoints(c, major, ratio, sg * t0, sg * t1);
    return { kind: 'spline', points: pts, closed: false };
}

/** Special characters in DXF text: %%c diameter, %%d degree, %%p plus-minus, %%% percent. */
const special = s => s.replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%%/g, '%').replace(/%%[uUoO]/g, '');

/** A TEXT entity: its string, where it stands, height, turn, and how it is aligned there. */
function textOf(codes) {
    const str = codes.find(([k]) => k === 1)?.[1] ?? '';
    const h = num(codes, 72), v = num(codes, 73);
    // Aligned text (72 or 73 set) stands on its second point; Aligned and Fit (3, 5) are taken as left.
    const aligned = (h !== 0 || v !== 0) && codes.some(([k]) => k === 11);
    const at = aligned ? [num(codes, 11), num(codes, 21)] : [num(codes, 10), num(codes, 20)];
    return {
        string: special(str), at, height: num(codes, 40, 1), angle: num(codes, 50) * Math.PI / 180,
        align: { 1: 'center', 2: 'right', 4: 'center' }[h] ?? 'left',
        vertical: h === 4 ? 'middle' : { 1: 'bottom', 2: 'middle', 3: 'top' }[v] ?? 'baseline',
    };
}

/** An MTEXT entity, its formatting codes stripped: paragraphs (\P) become lines. */
function mtextOf(codes) {
    const raw = codes.filter(([k]) => k === 3).map(([, v]) => v).join('') + (codes.find(([k]) => k === 1)?.[1] ?? '');
    const string = special(raw)
        .replace(/\\P/g, '\n').replace(/\\[~]/g, ' ')
        .replace(/\\S([^;]*?)[#^/]([^;]*?);/g, '$1/$2')
        .replace(/\\[LlOoKk]/g, '').replace(/\\[A-Za-z][^;\\{}]*;/g, '')
        .replace(/\\([{}\\])/g, '$1').replace(/[{}]/g, '');
    const p = Math.max(1, Math.min(9, num(codes, 71, 1))) - 1;
    const dx = num(codes, 11, NaN), dy = num(codes, 21, NaN);
    const angle = Number.isFinite(dx) && Number.isFinite(dy) && Math.hypot(dx, dy) > 0 ? Math.atan2(dy, dx) : num(codes, 50) * Math.PI / 180;
    return {
        string, at: [num(codes, 10), num(codes, 20)], height: num(codes, 40, 1), angle,
        align: ['left', 'center', 'right'][p % 3], vertical: ['top', 'middle', 'bottom'][Math.floor(p / 3)],
    };
}

/**
 * The text's letters as curve shapes on the XY plane: laid out in `font` with its capital letters
 * `height` tall (as DXF text heights go), placed and turned where the entity says.
 */
function lettering(font, t, flipX, scale) {
    // The font's cap height, from the outline of H; a font without one uses 0.7 of the em.
    const H = font.glyph('H'.codePointAt(0)).contours.flat();
    const cap = H.length ? Math.max(...H.map(q => q.y)) / font.unitsPerEm : 0.7;
    const size = t.height / (cap > 0 ? cap : 0.7);
    const { shapes } = textShapes(font, t.string, size, t.align);
    if (!shapes.length) return null;
    const lines = t.string.split('\n').length, line = (font.ascender - font.descender + font.lineGap) * size / font.unitsPerEm;
    const capH = cap * size, block = (lines - 1) * line + capH;
    const dy = { baseline: 0, bottom: -font.descender * size / font.unitsPerEm, top: -capH, middle: -capH + block / 2 }[t.vertical];
    const c = Math.cos(t.angle), s = Math.sin(t.angle), k = scale;
    const ox = flipX * t.at[0] * k, oy = t.at[1] * k;
    // Turned about the insertion point, scaled to millimetres, mirrored with the entity when it is.
    const m = { a: flipX * c * k, b: -flipX * s * k, c: s * k, d: c * k, e: ox - flipX * s * dy * k, f: oy + c * dy * k };
    return shapes.map(sh => transformShape({ kind: 'nurbs', ...sh }, m).shape);
}

/**
 * A curve shape carried by the affine map p -> (a x + b y + e, c x + d y + f). Points, poles and arcs'
 * three points map exactly under any such map (an arc stays an arc while the map keeps shapes, a
 * turn, a mirror or an even scale); a circle or ellipse under an uneven scale becomes an ellipse when
 * its axes stay square, otherwise it, and an arc, go as smooth curves through points along them.
 */
export function transformShape(shape, m) {
    const P = ([x, y]) => [m.a * x + m.b * y + m.e, m.c * x + m.d * y + m.f];
    const L = ([x, y]) => [m.a * x + m.b * y, m.c * x + m.d * y];
    const len = v => Math.hypot(v[0], v[1]);
    // A similarity: columns square to each other and the same length.
    const lx = len([m.a, m.c]), ly = len([m.b, m.d]);
    const similar = Math.abs(m.a * m.b + m.c * m.d) < 1e-12 * (lx * ly + 1) && Math.abs(lx - ly) < 1e-12 * (lx + ly);
    let approximated = false;
    const one = sh => {
        switch (sh.kind) {
        case 'polyline': case 'spline': case 'cv': return { ...sh, points: sh.points.map(P) };
        case 'nurbs': return { ...sh, poles: sh.poles.map(([x, y, z]) => [...P([x, y]), z]) };
        case 'arc': {
            if (similar) return { kind: 'arc', start: P(sh.start), mid: P(sh.mid), end: P(sh.end) };
            approximated = true;
            return { kind: 'spline', points: arcPoints(sh).map(P), closed: false };
        }
        case 'circle': {
            if (similar) return { kind: 'circle', center: P(sh.center), radius: sh.radius * lx };
            const u = L([sh.radius, 0]), v = L([0, sh.radius]);
            if (Math.abs(u[0] * v[0] + u[1] * v[1]) < 1e-9 * (len(u) * len(v))) {
                const [major, minor] = len(u) >= len(v) ? [u, len(v)] : [v, len(u)];
                return { kind: 'ellipse', center: P(sh.center), major, minor };
            }
            approximated = true;
            return { kind: 'spline', points: Array.from({ length: 96 }, (_, i) => { const t = 2 * Math.PI * i / 96; return P([sh.center[0] + sh.radius * Math.cos(t), sh.center[1] + sh.radius * Math.sin(t)]); }), closed: true };
        }
        case 'ellipse': {
            const minorDir = [-sh.major[1], sh.major[0]].map(x => x / len(sh.major) * sh.minor);
            const u = L(sh.major), v = L(minorDir);
            if (Math.abs(u[0] * v[0] + u[1] * v[1]) < 1e-9 * (len(u) * len(v) + 1e-30)) {
                const [major, minor] = len(u) >= len(v) ? [u, len(v)] : [v, len(u)];
                return { kind: 'ellipse', center: P(sh.center), major, minor };
            }
            approximated = true;
            return { kind: 'spline', points: Array.from({ length: 96 }, (_, i) => { const t = 2 * Math.PI * i / 96; return P([sh.center[0] + sh.major[0] * Math.cos(t) + minorDir[0] * Math.sin(t), sh.center[1] + sh.major[1] * Math.cos(t) + minorDir[1] * Math.sin(t)]); }), closed: true };
        }
        case 'contour': return { kind: 'contour', pieces: sh.pieces.map(one) };
        default: return sh;
        }
    };
    return { shape: one(shape), approximated };
}

/** Points along an arc given by its start, middle and end, for an arc that can't stay an arc. */
function arcPoints({ start: a, mid: b, end: c }, n = 48) {
    const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
    if (Math.abs(d) < 1e-15) return [a, c];
    const q = p => p[0] * p[0] + p[1] * p[1];
    const o = [(q(a) * (b[1] - c[1]) + q(b) * (c[1] - a[1]) + q(c) * (a[1] - b[1])) / d, (q(a) * (c[0] - b[0]) + q(b) * (a[0] - c[0]) + q(c) * (b[0] - a[0])) / d];
    const ang = p => Math.atan2(p[1] - o[1], p[0] - o[0]), r = Math.hypot(a[0] - o[0], a[1] - o[1]);
    const t0 = ang(a), tm = ang(b);
    let t1 = ang(c);
    // Sweep from a through b to c: counter-clockwise when b lies on the way going that way.
    const ccw = ((tm - t0 + 4 * Math.PI) % (2 * Math.PI)) < ((t1 - t0 + 4 * Math.PI) % (2 * Math.PI));
    let sweep = ((t1 - t0 + 4 * Math.PI) % (2 * Math.PI));
    if (!ccw) sweep -= 2 * Math.PI;
    return Array.from({ length: n + 1 }, (_, i) => { const t = t0 + sweep * i / n; return [o[0] + r * Math.cos(t), o[1] + r * Math.sin(t)]; });
}
