/**
 * Remove Fillets' options (Plasticity: Max Radius and Convexity Any / Convex / Concave): which of the
 * fillet faces found go. `surfaces` is faceSurfaces' list for the body (cylinder and sphere faces say
 * whether they bulge out; a spline round only gives its radius, so it counts as neither convex nor
 * concave and goes only with Any). A max radius of 0 or less is no limit.
 */
export function filterFillets(faces, surfaces, { maxRadius = 0, convexity = 'any' } = {}) {
    return faces.filter(n => {
        const s = surfaces?.[n];
        const r = s?.radius;
        if (maxRadius > 0 && Number.isFinite(r) && r > maxRadius + 1e-9) return false;
        if (convexity === 'any') return true;
        if (typeof s?.outward !== 'boolean') return false;
        return convexity === 'convex' ? s.outward : !s.outward;
    });
}
