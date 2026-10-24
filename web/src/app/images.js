// Plasticity's reference images: PNG or JPEG pictures standing on a plane in the viewport, for
// modelling over. Each keeps its picture (a data URL), where it stands, its size and how it shows:
// Depth (Normal: hidden by what is in front of it; Front: always seen, see-through; Behind: always
// behind the model), Opacity and Culling (seen from the front only, or from both sides).

export const DEPTHS = ['normal', 'front', 'behind'];
export const CULLING = ['front', 'double'];

/** A new image `width` mm wide (its height from the picture's `aspect`, height over width) on a plane. */
export function newImage(id, name, src, aspect, { origin = [0, 0, 0], quaternion = [0, 0, 0, 1], width = 100 } = {}) {
    return { id, name, src, aspect, origin: [...origin], quaternion: [...quaternion], width, opacity: 1, depth: 'normal', culling: 'double', hidden: false };
}

/** What is wrong with a stored image, so a file's bad entry is left out rather than drawn. */
export function checkImage(m) {
    const bad = [];
    const nums = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
    if (!Number.isInteger(m?.id) || m.id < 1) bad.push('id');
    if (typeof m?.src !== 'string' || !/^data:image\/(png|jpeg);base64,/.test(m.src)) bad.push('picture');
    if (!(m?.aspect > 0) || !Number.isFinite(m.aspect)) bad.push('aspect');
    if (!nums(m?.origin, 3)) bad.push('origin');
    if (!nums(m?.quaternion, 4)) bad.push('quaternion');
    if (!(m?.width > 0) || !Number.isFinite(m.width)) bad.push('width');
    if (!(m?.opacity >= 0 && m.opacity <= 1)) bad.push('opacity');
    if (!DEPTHS.includes(m?.depth)) bad.push('depth');
    if (!CULLING.includes(m?.culling)) bad.push('culling');
    return bad;
}

/**
 * How an image draws: the material's depth test and write, whether it blends, which sides show and
 * where it comes in the draw order (the model draws at 0).
 */
export function imageLook(m) {
    const see = m.opacity < 1;
    if (m.depth === 'front') return { depthTest: false, depthWrite: false, transparent: true, opacity: Math.min(m.opacity, 0.999), double: m.culling === 'double', order: 30 };
    if (m.depth === 'behind') return { depthTest: true, depthWrite: false, transparent: see, opacity: m.opacity, double: m.culling === 'double', order: -10 };
    return { depthTest: true, depthWrite: !see, transparent: see, opacity: m.opacity, double: m.culling === 'double', order: see ? 5 : 0 };
}
