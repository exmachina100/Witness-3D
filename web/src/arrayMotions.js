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
        for (const m of motions) if (m.scale !== undefined && !(m.scale > 0)) throw new Error('an array copy has no size');
        return motions.map(({ offset, pivot, axis, angle, scale = 1 }) => ({ offset, pivot, axis, angle, scale }));
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
export function radialSpec(pivot, axis, angle, count, mode = 'total', rings = null) {
    if (rings && rings.count > 1) return ringsSpec(pivot, axis, angle, count, mode, rings);
    if (mode !== 'spacing') return { kind: 'radial', pivot, axis, angle, count };
    if (![pivot, axis].every(v => Array.isArray(v) && v.length === 3 && finite(v)) || !Number.isFinite(angle)) throw new Error("the array's axis or angle is not a number");
    const len = Math.hypot(...axis);
    if (len < 1e-9) throw new Error("the array's axis has no direction");
    if (!Number.isInteger(count) || count < 1) throw new Error('the array count must be at least 1');
    const unit = axis.map(c => c / len);
    return { kind: 'motions', motions: Array.from({ length: Math.abs(angle) < 1e-9 ? 0 : count - 1 }, (_, i) => ({ offset: [0, 0, 0], pivot, axis: unit, angle: angle * (i + 1) })) };
}

/**
 * Plasticity's radial array rings (Number 1, Step 1): `rings.count` rings of the radial array, each
 * `rings.step` further out from the centre along `rings.out` (square to the axis, toward the
 * solids), every ring with the same copies round it. Motions turn about the centre, then move out.
 */
function ringsSpec(pivot, axis, angle, count, mode, { count: rn, step, out }) {
    if (!Number.isInteger(rn) || rn < 1) throw new Error('the ring count must be at least 1');
    if (!Number.isFinite(step)) throw new Error('the ring step must be a number');
    if (!Array.isArray(out) || out.length !== 3 || !finite(out)) throw new Error("the rings' direction is not a number");
    if (!Number.isInteger(count) || count < 1) throw new Error('the array count must be at least 1');
    if (count * rn > 1000) throw new Error('that array makes more than 1000 bodies');
    const len = Math.hypot(...axis);
    if (len < 1e-9) throw new Error("the array's axis has no direction");
    const k = axis.map(c => c / len);
    // `out` made square to the axis and of unit length.
    const along = out[0] * k[0] + out[1] * k[1] + out[2] * k[2];
    let o = out.map((v, i) => v - along * k[i]);
    const ol = Math.hypot(...o);
    if (ol < 1e-9) throw new Error("the rings need a direction out from the centre");
    o = o.map(v => v / ol);
    const full = Math.abs(Math.abs(angle) - 2 * Math.PI) < 1e-9;
    const turn = i => (mode === 'spacing' ? angle * i : count < 2 ? 0 : full ? angle / count * i : angle / (count - 1) * i);
    // Rodrigues: v turned by `a` about the unit axis k.
    const rot = (v, a) => {
        const c = Math.cos(a), s = Math.sin(a), d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
        const x = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
        return [0, 1, 2].map(i => v[i] * c + x[i] * s + k[i] * d * (1 - c));
    };
    const motions = [];
    for (let r = 0; r < rn; r++) for (let i = 0; i < count; i++) {
        if (r === 0 && i === 0) continue;
        if (Math.abs(angle) < 1e-9 && i > 0) continue;
        const a = turn(i), off = rot(o.map(v => v * step * r), a);
        motions.push({ offset: off, pivot, axis: k, angle: a });
    }
    return { kind: 'motions', motions };
}
