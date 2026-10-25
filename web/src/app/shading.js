// Shader modes, render mode and materials, after Plasticity's manual (Shader Mode, Render Mode,
// Set / Fork / Remove Material). Plasticity's matcaps are images; these are drawn in the shader from
// the face normal instead, so nothing of theirs is used. The order and names follow the manual's
// list; `mode` is the number the face shader switches on (App.js), `swatch` a CSS look for the button.

export const SHADERS = [
    { id: 'ceramic-dark', name: 'Ceramic dark', use: 'Default appearance', mode: 0, swatch: 'radial-gradient(circle at 35% 30%, #77736a, #2a2926 70%)' },
    { id: 'metal-carpaint', name: 'Metal carpaint', use: 'Glossy', mode: 1, swatch: 'radial-gradient(circle at 35% 30%, #fff 0 6%, #6a7f99 14%, #1c2635 72%)' },
    { id: 'dark-shiny', name: 'Dark shiny', use: 'Glossy', mode: 2, swatch: 'radial-gradient(circle at 35% 30%, #fff 0 5%, #3a3a3a 12%, #0b0b0b 70%)' },
    { id: 'gradient', name: 'Gradient', use: 'Ambient gradient', mode: 3, swatch: 'linear-gradient(#d9d4c7, #4a4844)' },
    { id: 'ceramic-light', name: 'Ceramic lightbulb', use: 'Highlight checker; shows material colours', mode: 4, color: true, swatch: 'radial-gradient(circle at 35% 30%, #fff 0 8%, #d8d2c4 20%, #6b675e 75%)' },
    { id: 'color', name: 'Color matcap', use: 'Matte; shows material colours', mode: 5, color: true, swatch: 'radial-gradient(circle at 40% 35%, #c9c4b8, #5d5a53 80%)' },
    { id: 'silhouette', name: 'Black silhouette', use: 'Silhouette checker', mode: 6, swatch: '#000' },
    { id: 'color-silhouette', name: 'Color silhouette', use: 'Silhouette checker; shows material colours', mode: 7, color: true, swatch: '#9a968c' },
    { id: 'isophote', name: 'Isophote / isoangle', use: 'Surface continuity; follows the view', mode: 8, option: 'stripes', swatch: 'repeating-radial-gradient(circle at 50% 50%, #eee 0 3px, #222 3px 6px)' },
    { id: 'draft', name: 'Draft angle', use: 'Draft against the construction plane normal', mode: 9, option: 'draft', swatch: 'linear-gradient(#4db86b 0 40%, #ecad38 40% 60%, #db4c42 60%)' },
    { id: 'zebra-h', name: 'Horizontal zebra', use: 'Surface continuity', mode: 10, option: 'stripes', swatch: 'repeating-linear-gradient(#eee 0 3px, #111 3px 6px)' },
    { id: 'zebra-v', name: 'Vertical zebra', use: 'Surface continuity', mode: 11, option: 'stripes', swatch: 'repeating-linear-gradient(90deg, #eee 0 3px, #111 3px 6px)' },
    { id: 'topography', name: 'Topography', use: 'Height lines along the construction plane normal', mode: 12, option: 'spacing', swatch: 'repeating-linear-gradient(#2a2926 0 4px, #ff4d00 4px 5px)' },
    { id: 'face-direction', name: 'Face direction', use: 'Blue faces out, red faces in', mode: 13, swatch: 'linear-gradient(90deg, #3d6fd9 50%, #d94a3d 50%)' },
];
export const shader = id => SHADERS.find(s => s.id === id) ?? SHADERS[0];

/** Material Options: stripe count for zebra and isophotes, draft threshold in degrees, topography spacing in mm. */
export const SHADER_OPTIONS = {
    stripes: { label: 'STRIPES', value: 24, min: 4, max: 96, step: 4 },
    draft: { label: 'DRAFT °', value: 1, min: 0.25, max: 15, step: 0.25 },
    spacing: { label: 'SPACING', value: 2, min: 0.25, max: 50, step: 0.25 },
};

/** Render mode lighting, built in the viewport from simple scenes (no HDR files). */
export const ENVIRONMENTS = [
    { id: 'studio', name: 'Studio', use: 'Default appearance' },
    { id: 'three-point', name: 'Three point', use: 'Key, fill and rim lights' },
    { id: 'stripes', name: 'Vertical stripes', use: 'Highlight checker' },
    { id: 'sky', name: 'Sky', use: 'Ambient gradient, outdoors' },
];

/**
 * A new material with Plasticity's base parameters, and its advanced ones (clearcoat, sheen,
 * iridescence, transmission) off; density in g/cm³ (steel is 7.85), thickness in mm.
 */
export function newMaterial(n, base = {}) {
    return {
        id: n, name: `MATERIAL ${n}`, color: '#9a968c', roughness: 0.5, metalness: 0, ior: 1.5, opacity: 1, density: 1,
        clearcoat: 0, clearcoatRoughness: 0, sheen: 0, sheenRoughness: 1, sheenColor: '#ffffff', iridescence: 0, transmission: 0, thickness: 0,
        ...base,
    };
}

/** The advanced parameters as [key, label, low, high, step]; a colour where low is null. */
export const ADVANCED_MATERIAL = [
    ['clearcoat', 'CLEARCOAT', 0, 1, 0.05], ['clearcoatRoughness', 'COAT ROUGHNESS', 0, 1, 0.05],
    ['sheen', 'SHEEN', 0, 1, 0.05], ['sheenRoughness', 'SHEEN ROUGHNESS', 0, 1, 0.05], ['sheenColor', 'SHEEN COLOR', null],
    ['iridescence', 'IRIDESCENCE', 0, 1, 0.05], ['transmission', 'TRANSMISSION', 0, 1, 0.05], ['thickness', 'THICKNESS MM', 0, 1000, 0.5],
];
/** Material keys holding a colour. */
export const isColorKey = k => k === 'color' || k === 'sheenColor';

/** Checks a material's values; returns the problems, empty when it is fine. */
export function checkMaterial(m) {
    const out = [];
    for (const k of ['color', 'sheenColor']) if (!/^#[0-9a-f]{6}$/i.test(m[k])) out.push(`${k} must be #rrggbb`);
    const ranges = [['roughness', 0, 1], ['metalness', 0, 1], ['opacity', 0, 1], ['ior', 1, 2.333], ...ADVANCED_MATERIAL.filter(r => r[2] !== null).map(([k, , lo, hi]) => [k, lo, hi])];
    for (const [k, lo, hi] of ranges) if (!(m[k] >= lo && m[k] <= hi)) out.push(`${k} must be ${lo} to ${hi}`);
    if (!(m.density > 0)) out.push('density must be above 0');
    return out;
}

/** Mass in grams of `volume` mm³ at `density` g/cm³. */
export const massOf = (volume, density) => volume * density / 1000;
export const formatMass = g => g >= 1000 ? `${(g / 1000).toFixed(3)} KG` : `${g.toFixed(2)} G`;
