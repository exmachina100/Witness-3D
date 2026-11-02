// Plasticity's Units (Grid and Units › Length; mass in the Selection panel): the model is kept in
// millimetres and grams, and these turn values to and from the unit the user picked. Typed values
// take a unit after any number ("2in", "5 + 2in") and simple arithmetic (+ − × ÷ and brackets),
// as Plasticity's fields do since 2025.2. Pure, so it can be tested.

/** Millimetres in one of each length unit. */
export const LENGTH_UNITS = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };
/** Grams in one of each mass unit. */
export const MASS_UNITS = { g: 1, kg: 1000, oz: 28.349523125, lb: 453.59237 };

const ALIASES = { '"': 'in', inch: 'in', inches: 'in', "'": 'ft', foot: 'ft', feet: 'ft', millimeter: 'mm', millimeters: 'mm', centimeter: 'cm', centimeters: 'cm', meter: 'm', meters: 'm' };

/** Millimetres to `unit`. */
export const toUnit = (mm, unit = 'mm') => mm / (LENGTH_UNITS[unit] ?? 1);
/** `unit` to millimetres. */
export const fromUnit = (v, unit = 'mm') => v * (LENGTH_UNITS[unit] ?? 1);

/** A length in millimetres shown in `unit`, without trailing zeros past `digits` decimals. */
export function formatLength(mm, unit = 'mm', digits = 3) {
    const v = toUnit(mm, unit);
    return `${+v.toFixed(digits)}`;
}
/** A length with its unit, as readouts show it: "12.7 MM". */
export const showLength = (mm, unit = 'mm', digits = 3) => `${formatLength(mm, unit, digits)} ${unit.toUpperCase()}`;
/** A volume in mm³ shown in unit³. */
export const showVolume = (mm3, unit = 'mm', digits = 3) => `${+(mm3 / (LENGTH_UNITS[unit] ?? 1) ** 3).toFixed(digits)} ${unit.toUpperCase()}³`;
/** A mass in grams shown in `unit`. */
export function showMass(g, unit = 'g') {
    const v = g / (MASS_UNITS[unit] ?? 1);
    return `${+v.toFixed(v >= 100 ? 1 : 3)} ${unit.toUpperCase()}`;
}

/**
 * Typed text to millimetres: numbers in `unit` unless a unit follows them, with + − × ÷ (also
 * * and /) and brackets. Returns undefined for text that isn't a value.
 */
export function parseLength(text, unit = 'mm') {
    const src = String(text ?? '').trim().toLowerCase().replaceAll('−', '-').replaceAll('×', '*').replaceAll('÷', '/').replaceAll(',', '.');
    if (!src) return undefined;
    const toks = [];
    const re = /\s*(?:(\d*\.?\d+(?:e[-+]?\d+)?)\s*(mm|cm|m|in|ft|inches|inch|feet|foot|millimeters?|centimeters?|meters?|"|')?|([-+*/()]))/y;
    let at = 0;
    while (at < src.length) {
        re.lastIndex = at;
        const m = re.exec(src);
        if (!m || m[0].length === 0) { if (/^\s+$/.test(src.slice(at))) break; return undefined; }
        at = re.lastIndex;
        if (m[1] !== undefined) {
            const u = m[2] ? ALIASES[m[2]] ?? m[2] : unit;
            toks.push({ n: fromUnit(Number(m[1]), u), unitless: !m[2] });
        } else toks.push(m[3]);
    }
    let i = 0;
    // Products may multiply by plain numbers ("2 * 3in"): only one factor keeps a length.
    const factor = () => {
        const t = toks[i++];
        if (t === '-') { const v = factor(); return v && { n: -v.n, unitless: v.unitless }; }
        if (t === '+') return factor();
        if (t === '(') { const v = sum(); if (toks[i++] !== ')') return undefined; return v; }
        return typeof t === 'object' ? t : undefined;
    };
    const term = () => {
        let a = factor();
        while (a && (toks[i] === '*' || toks[i] === '/')) {
            const op = toks[i++], b = factor();
            if (!b) return undefined;
            // A plain number in a product is a ratio, not a length.
            const bn = b.unitless ? b.n / (LENGTH_UNITS[unit] ?? 1) : b.n;
            if (op === '*') a = { n: a.unitless ? (a.n / (LENGTH_UNITS[unit] ?? 1)) * b.n : a.n * bn, unitless: a.unitless && b.unitless };
            else a = { n: a.n / bn, unitless: a.unitless };
        }
        return a;
    };
    const sum = () => {
        let a = term();
        while (a && (toks[i] === '+' || toks[i] === '-')) {
            const op = toks[i++], b = term();
            if (!b) return undefined;
            a = { n: op === '+' ? a.n + b.n : a.n - b.n, unitless: a.unitless && b.unitless };
        }
        return a;
    };
    const v = sum();
    if (!v || i !== toks.length || !Number.isFinite(v.n)) return undefined;
    return v.n;
}
