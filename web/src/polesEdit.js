// Plasticity's Slide Surface CV, shared by both builds: a face's picked control points slide along
// its control net, in u or v (the line from the point before to the point after in that direction,
// one span at an edge, wrapping round a closed net) or across it (the net's normal there). The net
// is the face's rows of [x, y, z], u slowest, as Toggle Points shows it; points are numbered
// a * columns + c. Returns the moves as [[n, [dx, dy, dz]]] for the kernel to apply.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(...a);
const same = (a, b) => len(sub(a, b)) < 1e-9;

/** The direction along the net through point (a, c): in u (along a), or in v (along c). */
function along(rows, a, c, inU) {
    const n = inU ? rows.length : rows[0].length;
    const at = i => inU ? rows[i][c] : rows[a][i];
    const i = inU ? a : c;
    // A closed net repeats its first row (or column) as its last.
    const closed = n > 2 && same(at(0), at(n - 1));
    let before = i - 1, after = i + 1;
    if (closed) {
        if (before < 0) before = n - 2;
        if (after > n - 1) after = 1;
    }
    before = Math.max(0, before);
    after = Math.min(n - 1, after);
    return sub(at(after), at(before));
}

/** The moves that slide points `picked` of the net `rows` by `d` mm: dir 'u', '-u', 'v', '-v' or 'n'. */
export function slidePoles(rows, picked, d, dir = 'u') {
    if (!rows?.length || !rows[0]?.length) throw new Error('that face has no control points');
    if (!Number.isFinite(d)) throw new Error('the distance must be a number');
    const nv = rows[0].length, total = rows.length * nv;
    return picked.map(n => {
        if (!(n >= 0 && n < total)) throw new Error('that control point no longer exists');
        const a = Math.floor(n / nv), c = n % nv;
        let v;
        if (dir === 'n') v = cross(along(rows, a, c, true), along(rows, a, c, false));
        else v = along(rows, a, c, dir.endsWith('u'));
        const l = len(v);
        if (l < 1e-12) throw new Error('that control point has no direction to slide in there');
        const k = (dir.startsWith('-') ? -d : d) / l;
        return [n, [v[0] * k, v[1] * k, v[2] * k]];
    });
}
