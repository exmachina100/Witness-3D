// The ALL MATCAPS list of Plasticity's right panel: matcap images to shade with. Plasticity ships
// its matcaps as images; ours are drawn here from a few numbers per look (nothing of theirs, or of
// any other program's, is used): a lit sphere with its base colour, a soft key light, a sharp
// highlight, and for the reflective looks a horizon (sky above, floor below) bent round the sphere.
// The three "Alias style" looks are our own takes on the evaluation shaders surface modellers use
// in Autodesk Alias (a blue-grey clay, a studio chrome and a car paint); the colours are ours.

/** Each look: base colour (top light, shadow), key light, highlight, and an optional horizon. */
export const MATCAPS = [
    { id: 'studio-sky', name: 'Studio sky', light: [205, 215, 230], dark: [30, 38, 52], key: 0.55, spec: 0.9, shine: 60, horizon: { sky: [150, 185, 225], ground: [40, 36, 32], line: 0.3, mix: 0.5 } },
    { id: 'graphite', name: 'Graphite', light: [120, 118, 114], dark: [22, 22, 22], key: 0.7, spec: 0.5, shine: 30 },
    { id: 'silver', name: 'Silver', light: [235, 235, 235], dark: [60, 60, 62], key: 0.5, spec: 1, shine: 90, horizon: { sky: [245, 245, 245], ground: [70, 70, 72], line: 0.25, mix: 0.45 } },
    { id: 'white-clay', name: 'White clay', light: [250, 248, 244], dark: [150, 148, 144], key: 0.9, spec: 0.2, shine: 12 },
    { id: 'pearl', name: 'Pearl', light: [228, 228, 226], dark: [120, 120, 122], key: 0.75, spec: 0.7, shine: 40 },
    { id: 'gloss-white', name: 'Gloss white', light: [255, 255, 255], dark: [110, 110, 112], key: 0.6, spec: 1, shine: 120, horizon: { sky: [255, 255, 255], ground: [90, 90, 92], line: 0.2, mix: 0.25 } },
    { id: 'brass', name: 'Brass', light: [222, 182, 120], dark: [70, 48, 22], key: 0.7, spec: 0.8, shine: 50 },
    { id: 'ruby', name: 'Ruby', light: [190, 40, 34], dark: [40, 6, 6], key: 0.7, spec: 0.9, shine: 70 },
    // Alias-style evaluation looks.
    { id: 'alias-clay', name: 'Blue-grey clay (Alias style)', light: [176, 188, 200], dark: [62, 70, 82], key: 0.85, spec: 0.25, shine: 16, alias: true },
    { id: 'alias-chrome', name: 'Studio chrome (Alias style)', light: [250, 250, 250], dark: [20, 20, 22], key: 0.15, spec: 1, shine: 200, alias: true, horizon: { sky: [235, 240, 248], ground: [18, 18, 20], line: 0.06, mix: 0.9 } },
    { id: 'alias-carpaint', name: 'Car paint (Alias style)', light: [70, 100, 160], dark: [8, 14, 32], key: 0.6, spec: 1, shine: 150, alias: true, horizon: { sky: [190, 210, 240], ground: [10, 12, 18], line: 0.15, mix: 0.3 } },
];

export const matcapById = id => MATCAPS.find(m => m.id === id) ?? null;

const clamp = (v, a = 0, b = 255) => Math.min(b, Math.max(a, v));
const mixc = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);

/**
 * The colour of a look at (x, y) on its sphere, both -1..1 with y up; null off the sphere. The key
 * light comes from the upper left, the highlight sits beside it, and a horizon, when the look has
 * one, is reflected about the view: sky above the bend of the sphere, ground below.
 */
export function matcapPixel(m, x, y) {
    const r2 = x * x + y * y;
    if (r2 > 1) return null;
    const z = Math.sqrt(1 - r2);
    const L = [-0.45, 0.55, 0.7], ll = Math.hypot(...L);
    const nl = Math.max(0, (x * L[0] + y * L[1] + z * L[2]) / ll);
    const lit = Math.pow(nl, 1 + (1 - m.key) * 2) * m.key + (1 - m.key) * (0.5 + 0.5 * y);
    let c = mixc(m.dark, m.light, clamp(lit, 0, 1));
    // Reflected view ray: R = 2(N·V)N − V with V = (0,0,1).
    const ry = 2 * z * y;
    if (m.horizon) {
        const h = m.horizon, t = clamp((ry + h.line) / (2 * h.line), 0, 1);
        const env = mixc(h.ground, h.sky, t * t * (3 - 2 * t));
        c = mixc(c, env, h.mix);
    }
    // Highlight: Blinn about the half vector of the key light and the view.
    const H = [L[0] / ll, L[1] / ll, L[2] / ll + 1], hl = Math.hypot(...H);
    const nh = Math.max(0, (x * H[0] + y * H[1] + z * H[2]) / hl);
    const s = m.spec * Math.pow(nh, m.shine);
    c = c.map(v => v + (255 - v) * s);
    // A soft rim darkening, as a lit sphere has.
    const rim = 1 - 0.25 * Math.pow(1 - z, 3);
    return c.map(v => Math.round(clamp(v * rim)));
}

/** A look drawn into a square image of `size` pixels, as a data URL (browser only). */
export function matcapDataUrl(m, size = 256) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const g = canvas.getContext('2d'), img = g.createImageData(size, size);
    for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
            const x = (i + 0.5) / size * 2 - 1, y = 1 - (j + 0.5) / size * 2;
            // The edge pixels take the rim colour so the matcap has no black ring when sampled.
            const r = Math.hypot(x, y), p = matcapPixel(m, r > 0.999 ? x / r * 0.999 : x, r > 0.999 ? y / r * 0.999 : y);
            const k = (j * size + i) * 4;
            img.data[k] = p[0]; img.data[k + 1] = p[1]; img.data[k + 2] = p[2]; img.data[k + 3] = 255;
        }
    }
    g.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
}
