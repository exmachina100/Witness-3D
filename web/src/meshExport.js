// Mesh export (Plasticity's Export OBJ, and STL): text OBJ and binary STL from triangle meshes,
// shared by the browser and desktop builds. Meshes come from the backend at the chosen tolerance; this
// file only splits long edges (the "max width" option) and writes the bytes. Units are millimetres,
// in the user's axes (z up), so other programs see the model the right way up.

const toUser = (x, y, z) => [x, -z, y];

/**
 * Split triangles until no edge is longer than `maxEdge` (Plasticity's export-mesh max width).
 * `positions` are x, y, z per vertex; `indices` three per triangle. Returns new arrays.
 */
export function limitEdges(positions, indices, maxEdge) {
    if (!(maxEdge > 0) || !Number.isFinite(maxEdge)) return { positions: [...positions], indices: [...indices] };
    const pos = [...positions], out = [];
    const len = (a, b) => Math.hypot(pos[3 * a] - pos[3 * b], pos[3 * a + 1] - pos[3 * b + 1], pos[3 * a + 2] - pos[3 * b + 2]);
    const mids = new Map();
    const mid = (a, b) => {
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        if (!mids.has(key)) {
            mids.set(key, pos.length / 3);
            for (let k = 0; k < 3; k++) pos.push((pos[3 * a + k] + pos[3 * b + k]) / 2);
        }
        return mids.get(key);
    };
    const stack = [];
    for (let i = 0; i < indices.length; i += 3) stack.push([indices[i], indices[i + 1], indices[i + 2]]);
    let guard = 0;
    while (stack.length) {
        const [a, b, c] = stack.pop();
        const e = [len(a, b), len(b, c), len(c, a)], m = Math.max(...e);
        if (m <= maxEdge || ++guard > 2e6) { out.push(a, b, c); continue; }
        // Split the longest edge; the two halves keep the winding.
        if (m === e[0]) { const d = mid(a, b); stack.push([a, d, c], [d, b, c]); }
        else if (m === e[1]) { const d = mid(b, c); stack.push([a, b, d], [a, d, c]); }
        else { const d = mid(c, a); stack.push([a, b, d], [d, b, c]); }
    }
    return { positions: pos, indices: out };
}

/** OBJ text: one object per mesh, vertices and faces (1-based, counter-clockwise outward). */
export function toObj(meshes, comment = 'Witness 3D') {
    const lines = [`# ${comment}`, '# units: millimetres'];
    let base = 0;
    for (const m of meshes) {
        lines.push(`o ${m.name}`);
        for (let i = 0; i < m.positions.length; i += 3) {
            const [x, y, z] = toUser(m.positions[i], m.positions[i + 1], m.positions[i + 2]);
            lines.push(`v ${+x.toFixed(6)} ${+y.toFixed(6)} ${+z.toFixed(6)}`);
        }
        for (let i = 0; i < m.indices.length; i += 3) lines.push(`f ${m.indices[i] + 1 + base} ${m.indices[i + 1] + 1 + base} ${m.indices[i + 2] + 1 + base}`);
        base += m.positions.length / 3;
    }
    return lines.join('\n') + '\n';
}

/** Binary STL: an 80-byte header, the triangle count, then a normal and three vertices per triangle. */
export function toStl(meshes) {
    const count = meshes.reduce((n, m) => n + m.indices.length / 3, 0);
    const buf = new ArrayBuffer(84 + 50 * count), dv = new DataView(buf);
    const header = 'Witness 3D binary STL, millimetres';
    for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i));
    dv.setUint32(80, count, true);
    let o = 84;
    for (const m of meshes) {
        const p = i => toUser(m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]);
        for (let t = 0; t < m.indices.length; t += 3) {
            const [a, b, c] = [p(m.indices[t]), p(m.indices[t + 1]), p(m.indices[t + 2])];
            const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
            const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n) || 1;
            for (const x of [...n.map(q => q / l), ...a, ...b, ...c]) { dv.setFloat32(o, x, true); o += 4; }
            dv.setUint16(o, 0, true); o += 2;
        }
    }
    return new Uint8Array(buf);
}
