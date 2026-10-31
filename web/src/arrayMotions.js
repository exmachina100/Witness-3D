// The motions of an array's copies, shared by the browser kernel (which moves the copies) and the
// app (which places instances at them). Pure: no kernel here, so the desktop bundle can import it.

const SMALL = 1e-6;
const finite = a => a.every(Number.isFinite);

/**
 * The motions of an array's copies, the original excluded, as `transform` arguments. `spec` is
 * { kind: 'rectangular', steps: [v, v, v], counts: [a, b, c] } or { kind: 'radial', pivot, axis,
 * angle (radians), count }. Counts include the original; a full turn doesn't repeat the first.
 */
export function arrayMotions(spec) {
    const MAX = 1000;
    if (spec.kind === 'rectangular') {
        const { steps, counts } = spec;
        if (steps?.length !== 3 || !steps.every(s => Array.isArray(s) && s.length === 3 && finite(s))) throw new Error('an array step is not a number');
        if (counts?.length !== 3 || !counts.every(c => Number.isInteger(c) && c >= 1)) throw new Error('each array count must be at least 1');
        const total = counts[0] * counts[1] * counts[2];
        if (total > MAX) throw new Error('that array makes more than 1000 bodies');
        if (total < 2) return [];
        if (counts.some((c, i) => c > 1 && Math.hypot(...steps[i]) < SMALL)) throw new Error('an array direction with more than one copy needs a spacing');
        const out = [];
        for (let a = 0; a < counts[0]; a++) for (let b = 0; b < counts[1]; b++) for (let c = 0; c < counts[2]; c++) {
            if (a + b + c === 0) continue;
            out.push({ offset: [0, 1, 2].map(k => steps[0][k] * a + steps[1][k] * b + steps[2][k] * c) });
        }
        return out;
    }
    if (spec.kind === 'radial') {
        const { pivot, axis, angle, count: n } = spec;
        if (![pivot, axis].every(v => Array.isArray(v) && v.length === 3 && finite(v)) || !Number.isFinite(angle)) throw new Error("the array's axis or angle is not a number");
        if (Math.hypot(...axis) < 1e-9) throw new Error("the array's axis has no direction");
        if (!Number.isInteger(n) || n < 1) throw new Error('the array count must be at least 1');
        if (n > MAX) throw new Error('that array makes more than 1000 bodies');
        if (n < 2 || Math.abs(angle) < 1e-9) return [];
        const full = Math.abs(Math.abs(angle) - 2 * Math.PI) < 1e-9;
        const step = full ? angle / n : angle / (n - 1);
        const len = Math.hypot(...axis), unit = axis.map(c => c / len);
        return Array.from({ length: n - 1 }, (_, i) => ({ pivot, axis: unit, angle: step * (i + 1) }));
    }
    if (spec.kind === 'motions') {
        // Curve Array: the motions worked out from the curve (curveArray.js).
        const { motions } = spec;
        if (!Array.isArray(motions) || motions.length > MAX) throw new Error('that array makes more than 1000 bodies');
        for (const m of motions) if (![m.offset, m.pivot, m.axis].every(v => Array.isArray(v) && v.length === 3 && finite(v)) || !Number.isFinite(m.angle)) throw new Error('an array copy is not placed at a number');
        return motions.map(({ offset, pivot, axis, angle }) => ({ offset, pivot, axis, angle }));
    }
    throw new Error('an array is rectangular, radial or along a curve');
}

/**
 * Plasticity's array Mode. Rectangular Spacing (the default) takes each direction's step as given;
 * Extent takes the whole distance from the first copy to the last, so a count of n spreads over it
 * evenly. Radial Total spreads the copies over the angle (a full turn not repeating the first);
 * Spacing takes the angle between neighbouring copies, which may run past a full turn.
 */
export function rectangularSpec(steps, counts, mode = 'spacing') {
    return { kind: 'rectangular', counts, steps: mode === 'extent' ? steps.map((s, i) => s.map(v => counts[i] > 1 ? v / (counts[i] - 1) : v)) : steps };
}
export function radialSpec(pivot, axis, angle, count, mode = 'total') {
    if (mode !== 'spacing') return { kind: 'radial', pivot, axis, angle, count };
    if (![pivot, axis].every(v => Array.isArray(v) && v.length === 3 && finite(v)) || !Number.isFinite(angle)) throw new Error("the array's axis or angle is not a number");
    const len = Math.hypot(...axis);
    if (len < 1e-9) throw new Error("the array's axis has no direction");
    if (!Number.isInteger(count) || count < 1) throw new Error('the array count must be at least 1');
    const unit = axis.map(c => c / len);
    return { kind: 'motions', motions: Array.from({ length: Math.abs(angle) < 1e-9 ? 0 : count - 1 }, (_, i) => ({ offset: [0, 0, 0], pivot, axis: unit, angle: angle * (i + 1) })) };
}
