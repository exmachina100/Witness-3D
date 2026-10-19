// Plasticity's Text: typed text as curves, in a chosen font and size, on the construction plane.
// A small reader for TrueType fonts (the glyf outlines, cmap, advances) turns each glyph's contours
// into closed degree-2 NURBS curves, exactly as the font draws them (TrueType contours are
// quadratic B-splines). Shared by both builds; the fonts ship with the app under the SIL Open Font
// License (src/fonts).

/** The fonts the Text command offers: [name, file]. */
export const FONTS = [['SANS', 'Outfit-Regular.ttf'], ['SERIF', 'Lora-Regular.ttf'], ['MONO', 'JetBrainsMono-Regular.ttf']];

/** A TrueType font from its bytes: { unitsPerEm, ascender, descender, lineGap, glyph(code) }. */
export function parseFont(buffer) {
    const v = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
    const tables = {};
    const n = v.getUint16(4);
    for (let i = 0; i < n; i++) {
        const at = 12 + 16 * i;
        const tag = String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));
        tables[tag] = v.getUint32(at + 8);
    }
    for (const t of ['head', 'hhea', 'hmtx', 'maxp', 'cmap', 'loca', 'glyf']) if (tables[t] === undefined) throw new Error(`that font has no ${t} table (only TrueType outlines are read)`);
    const unitsPerEm = v.getUint16(tables.head + 18), longLoca = v.getInt16(tables.head + 50) === 1;
    const numGlyphs = v.getUint16(tables.maxp + 4);
    const ascender = v.getInt16(tables.hhea + 4), descender = v.getInt16(tables.hhea + 6), lineGap = v.getInt16(tables.hhea + 8);
    const numHMetrics = v.getUint16(tables.hhea + 34);
    const advance = g => v.getUint16(tables.hmtx + 4 * Math.min(g, numHMetrics - 1));
    const loca = g => longLoca ? v.getUint32(tables.loca + 4 * g) : 2 * v.getUint16(tables.loca + 2 * g);
    const glyphIndex = cmapReader(v, tables.cmap);
    const cache = new Map();
    const outline = (g, depth = 0) => {
        if (g < 0 || g >= numGlyphs || depth > 8) return [];
        const start = loca(g), end = loca(g + 1);
        if (end <= start) return [];
        const at = tables.glyf + start, contours = v.getInt16(at);
        if (contours >= 0) return simpleGlyph(v, at, contours);
        return compositeGlyph(v, at + 10, sub => outline(sub, depth + 1));
    };
    return {
        unitsPerEm, ascender, descender, lineGap,
        /** A character's advance and contours ([[{ x, y, on }]]) in font units, y up. */
        glyph(code) {
            if (!cache.has(code)) { const g = glyphIndex(code); cache.set(code, { advance: advance(g), contours: outline(g) }); }
            return cache.get(code);
        },
    };
}

/** The character-to-glyph map: the Unicode subtable (format 4 or 12). */
function cmapReader(v, cmap) {
    const n = v.getUint16(cmap + 2);
    let best = null;
    for (let i = 0; i < n; i++) {
        const platform = v.getUint16(cmap + 4 + 8 * i), encoding = v.getUint16(cmap + 6 + 8 * i), off = cmap + v.getUint32(cmap + 8 + 8 * i);
        const format = v.getUint16(off);
        const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
        if (unicode && (format === 12 || (format === 4 && !best))) best = { format, off };
    }
    if (!best) throw new Error('that font has no Unicode character map');
    const { format, off } = best;
    if (format === 12) {
        const groups = v.getUint32(off + 12);
        return code => {
            for (let i = 0; i < groups; i++) {
                const g = off + 16 + 12 * i, a = v.getUint32(g), b = v.getUint32(g + 4);
                if (code >= a && code <= b) return v.getUint32(g + 8) + code - a;
            }
            return 0;
        };
    }
    const segs = v.getUint16(off + 6) / 2;
    const ends = off + 14, starts = ends + 2 * segs + 2, deltas = starts + 2 * segs, ranges = deltas + 2 * segs;
    return code => {
        for (let i = 0; i < segs; i++) {
            if (code > v.getUint16(ends + 2 * i)) continue;
            const s = v.getUint16(starts + 2 * i);
            if (code < s) return 0;
            const delta = v.getInt16(deltas + 2 * i), range = v.getUint16(ranges + 2 * i);
            if (!range) return (code + delta) & 0xffff;
            const g = v.getUint16(ranges + 2 * i + range + 2 * (code - s));
            return g ? (g + delta) & 0xffff : 0;
        }
        return 0;
    };
}

function simpleGlyph(v, at, contours) {
    const ends = Array.from({ length: contours }, (_, i) => v.getUint16(at + 10 + 2 * i));
    const count = contours ? ends.at(-1) + 1 : 0;
    let p = at + 10 + 2 * contours;
    p += 2 + v.getUint16(p);
    const flags = [];
    while (flags.length < count) {
        const f = v.getUint8(p++);
        flags.push(f);
        if (f & 8) { let r = v.getUint8(p++); while (r-- > 0) flags.push(f); }
    }
    const coords = (short, same) => {
        let c = 0;
        return flags.map(f => {
            if (f & short) { const d = v.getUint8(p++); c += f & same ? d : -d; }
            else if (!(f & same)) { c += v.getInt16(p); p += 2; }
            return c;
        });
    };
    const xs = coords(2, 16), ys = coords(4, 32);
    const out = [];
    let first = 0;
    for (const e of ends) {
        out.push(Array.from({ length: e - first + 1 }, (_, i) => ({ x: xs[first + i], y: ys[first + i], on: !!(flags[first + i] & 1) })));
        first = e + 1;
    }
    return out;
}

function compositeGlyph(v, p, outline) {
    const out = [];
    for (;;) {
        const flags = v.getUint16(p), g = v.getUint16(p + 2);
        p += 4;
        let dx, dy;
        if (flags & 1) { dx = v.getInt16(p); dy = v.getInt16(p + 2); p += 4; } else { dx = v.getInt8(p); dy = v.getInt8(p + 1); p += 2; }
        let a = 1, b = 0, c = 0, d = 1;
        const f2 = q => v.getInt16(q) / 16384;
        if (flags & 8) { a = d = f2(p); p += 2; }
        else if (flags & 0x40) { a = f2(p); d = f2(p + 2); p += 4; }
        else if (flags & 0x80) { a = f2(p); b = f2(p + 2); c = f2(p + 4); d = f2(p + 6); p += 8; }
        // Point-matched placement (args are point numbers) is rare in Latin fonts; placed unmoved.
        if (!(flags & 2)) dx = dy = 0;
        for (const contour of outline(g)) out.push(contour.map(q => ({ x: a * q.x + c * q.y + dx, y: b * q.x + d * q.y + dy, on: q.on })));
        if (!(flags & 0x20)) return out;
    }
}

/**
 * A TrueType contour ([{ x, y, on }], closed) as a closed degree-2 NURBS in the plane: on-curve points
 * and the control points between them (a straight piece gets its midpoint), knots doubled at each
 * on-curve point, so the curve is the font's exactly. `at(x, y)` places font units.
 */
export function contourNurbs(contour, at = (x, y) => [x, y]) {
    let pts = contour.map(q => ({ ...q }));
    if (pts.length < 2) return null;
    // Two off-curve points in a row have an on-curve point midway between them.
    const full = [];
    for (let i = 0; i < pts.length; i++) {
        const q = pts[i], r = pts[(i + 1) % pts.length];
        full.push(q);
        if (!q.on && !r.on) full.push({ x: (q.x + r.x) / 2, y: (q.y + r.y) / 2, on: true });
    }
    // Start on an on-curve point.
    const s = full.findIndex(q => q.on);
    pts = [...full.slice(s), ...full.slice(0, s)];
    // Poles run on-curve, control, on-curve, ...: a straight piece gets its midpoint as control.
    const poles = [], weights = [];
    const push = q => { poles.push([...at(q.x, q.y), 0]); weights.push(1); };
    for (let i = 0; i < pts.length; i++) {
        const q = pts[i], next = pts[(i + 1) % pts.length];
        push(q);
        if (q.on && next.on) push({ x: (q.x + next.x) / 2, y: (q.y + next.y) / 2 });
    }
    push(pts[0]);
    if (poles.length < 5) return null;
    // Poles alternate on, control, on, ...: (poles - 1) / 2 spans.
    const k = (poles.length - 1) / 2;
    const knots = [0, 0, 0];
    for (let i = 1; i < k; i++) knots.push(i / k, i / k);
    knots.push(1, 1, 1);
    return { degree: 2, poles, weights, knots };
}

/**
 * Text laid out in `font` at `size` (the em, in mm), lines downward from the first baseline at y = 0,
 * aligned left, centre or right on x = 0. Returns closed NURBS shapes ({ degree, poles: [[x, y, 0]],
 * weights, knots }) in plane coordinates, one per glyph contour, and the text's width and height.
 */
export function textShapes(font, text, size, align = 'left') {
    const s = size / font.unitsPerEm, line = (font.ascender - font.descender + font.lineGap) * s;
    const shapes = [];
    let width = 0;
    const lines = String(text).split('\n');
    lines.forEach((row, r) => {
        const chars = [...row].map(ch => font.glyph(ch.codePointAt(0)));
        const w = chars.reduce((t, g) => t + g.advance, 0) * s;
        width = Math.max(width, w);
        let x = align === 'center' ? -w / 2 : align === 'right' ? -w : 0;
        const y = -r * line;
        for (const g of chars) {
            const x0 = x;
            for (const c of g.contours) { const n = contourNurbs(c, (u, v) => [x0 + u * s, y + v * s]); if (n) shapes.push(n); }
            x += g.advance * s;
        }
    });
    return { shapes, width, height: lines.length ? (lines.length - 1) * line + font.ascender * s : 0 };
}
