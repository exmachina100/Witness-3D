// Drawing export (Plasticity's SVG export, and DXF): a 2D drawing of the model seen from the camera,
// shared by the browser and desktop builds. The backend's hidden-line removal gives the bodies' lines
// in the view's own x, y (visible, or hidden behind a face); drawn curves are laid flat here. This file
// writes the text. Units are millimetres at 1:1.

/** A view: `origin`, `toward` the viewer and `x` to the right (THREE.Vector3s or [x, y, z]). */
function axes({ origin, toward, x }) {
    const v = a => Array.isArray(a) ? a : [a.x, a.y, a.z];
    const n = norm(v(toward)), o = v(origin);
    const xs = v(x), d = dot(xs, n), xx = norm(xs.map((c, i) => c - n[i] * d));
    return { o, x: xx, y: cross(n, xx) };
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a); return a.map(c => c / l); };

/** Model-space points (arrays or THREE.Vector3s) as [x0, y0, x1, y1, ...] in the view's x, y. */
export function flatten(points, view) {
    const { o, x, y } = axes(view);
    return points.flatMap(p => {
        const d = Array.isArray(p) ? [p[0] - o[0], p[1] - o[1], p[2] - o[2]] : [p.x - o[0], p.y - o[1], p.z - o[2]];
        return [dot(d, x), dot(d, y)];
    });
}

/** The drawing's extent over every line: [x0, y0, x1, y1], or null when there is nothing. */
export function extent(lines) {
    let b = null;
    for (const l of lines) for (let i = 0; i < l.points.length; i += 2) {
        const [x, y] = [l.points[i], l.points[i + 1]];
        b = b ? [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)] : [x, y, x, y];
    }
    return b;
}

const f = v => +v.toFixed(4);
const LAYER = l => l.curve ? 'curves' : l.hidden ? 'hidden' : 'visible';

/**
 * SVG text. `lines` are { points: [x, y, ...], hidden?, curve? }; hidden lines are left out unless
 * `hidden`. The page is the drawing's extent plus `margin` mm, y up as in the view.
 */
export function toSvg(lines, { hidden = true, margin = 5 } = {}) {
    const kept = lines.filter(l => l.points.length >= 4 && (hidden || !l.hidden));
    const b = extent(kept) ?? [0, 0, 0, 0];
    const w = b[2] - b[0] + 2 * margin, h = b[3] - b[1] + 2 * margin;
    const X = x => f(x - b[0] + margin), Y = y => f(b[3] - y + margin);
    const style = {
        visible: 'stroke="#000" stroke-width="0.35"',
        hidden: 'stroke="#777" stroke-width="0.25" stroke-dasharray="1.5 1"',
        curves: 'stroke="#000" stroke-width="0.25"',
    };
    const out = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<svg xmlns="http://www.w3.org/2000/svg" width="${f(w)}mm" height="${f(h)}mm" viewBox="0 0 ${f(w)} ${f(h)}">`,
        '<title>Witness 3D drawing</title>',
    ];
    for (const layer of ['hidden', 'visible', 'curves']) {
        const ls = kept.filter(l => LAYER(l) === layer);
        if (!ls.length) continue;
        out.push(`<g id="${layer}" fill="none" ${style[layer]} stroke-linecap="round" stroke-linejoin="round">`);
        for (const l of ls) {
            const pts = [];
            for (let i = 0; i < l.points.length; i += 2) pts.push(`${X(l.points[i])},${Y(l.points[i + 1])}`);
            out.push(`<polyline points="${pts.join(' ')}"/>`);
        }
        out.push('</g>');
    }
    out.push('</svg>');
    return out.join('\n') + '\n';
}

/**
 * DXF text (R12, which every CAD program reads): layers VISIBLE, HIDDEN (dashed) and CURVES; a line
 * of two points is a LINE, longer ones a POLYLINE. Coordinates are the view's x, y in mm.
 */
export function toDxf(lines, { hidden = true } = {}) {
    const kept = lines.filter(l => l.points.length >= 4 && (hidden || !l.hidden));
    const o = [];
    const g = (code, value) => o.push(String(code), String(value));
    const b = extent(kept) ?? [0, 0, 0, 0];
    g(0, 'SECTION'); g(2, 'HEADER');
    g(9, '$ACADVER'); g(1, 'AC1009');
    g(9, '$INSUNITS'); g(70, 4);
    g(9, '$EXTMIN'); g(10, f(b[0])); g(20, f(b[1])); g(30, 0);
    g(9, '$EXTMAX'); g(10, f(b[2])); g(20, f(b[3])); g(30, 0);
    g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'TABLES');
    g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 2);
    g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0);
    g(0, 'LTYPE'); g(2, 'DASHED'); g(70, 0); g(3, '__ __ __'); g(72, 65); g(73, 2); g(40, 2.5); g(49, 1.5); g(49, -1);
    g(0, 'ENDTAB');
    g(0, 'TABLE'); g(2, 'LAYER'); g(70, 3);
    for (const [name, color, type] of [['VISIBLE', 7, 'CONTINUOUS'], ['HIDDEN', 8, 'DASHED'], ['CURVES', 5, 'CONTINUOUS']]) {
        g(0, 'LAYER'); g(2, name); g(70, 0); g(62, color); g(6, type);
    }
    g(0, 'ENDTAB');
    g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'ENTITIES');
    for (const l of kept) {
        const layer = LAYER(l).toUpperCase(), p = l.points;
        if (p.length === 4) {
            g(0, 'LINE'); g(8, layer);
            g(10, f(p[0])); g(20, f(p[1])); g(30, 0);
            g(11, f(p[2])); g(21, f(p[3])); g(31, 0);
            continue;
        }
        const closed = Math.hypot(p[0] - p.at(-2), p[1] - p.at(-1)) < 1e-9;
        const n = closed ? p.length - 2 : p.length;
        g(0, 'POLYLINE'); g(8, layer); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, closed ? 1 : 0);
        for (let i = 0; i < n; i += 2) { g(0, 'VERTEX'); g(8, layer); g(10, f(p[i])); g(20, f(p[i + 1])); g(30, 0); }
        g(0, 'SEQEND'); g(8, layer);
    }
    g(0, 'ENDSEC');
    g(0, 'EOF');
    return o.join('\n') + '\n';
}
