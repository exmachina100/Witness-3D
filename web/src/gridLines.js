/**
 * The ground grid (Plasticity: Grid and Units): a line at every snap step, every `every`-th one a
 * major line, on a square of half-width `half` round the origin. When the step is so small the
 * lines would crowd past `max` a side, only every k-th step is drawn (k a whole number, so the drawn
 * lines still sit on snap points) and majors stay on multiples of `every` steps where they can.
 * Returns flat x, z segment ends (y = 0) and, per line, whether it is major.
 */
export function gridLines(step, every = 10, half = 200, max = 400) {
    step = Number.isFinite(step) && step > 0 ? step : 1;
    every = Math.max(1, Math.round(every) || 1);
    let k = 1;
    while (half / (step * k) > max) k++;
    const d = step * k, n = Math.floor(half / d), ext = n * d;
    const pos = [], major = [];
    for (let i = -n; i <= n; i++) {
        const t = i * d, isMajor = (i * k) % every === 0;
        pos.push(t, 0, -ext, t, 0, ext);
        major.push(isMajor);
        pos.push(-ext, 0, t, ext, 0, t);
        major.push(isMajor);
    }
    return { positions: new Float32Array(pos), major, spacing: d };
}
