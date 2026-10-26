// Mesh export (Plasticity's Export OBJ, and STL, glTF and 3MF): text OBJ, binary STL, binary glTF
// (.glb) and 3MF from triangle meshes, shared by the browser and desktop builds. Meshes come from the backend at the chosen tolerance; this
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

/**
 * Merge the ends of edges shorter than `minEdge` (Plasticity's export-mesh min width), shortest
 * first, each vertex at most once a pass, so tiny fillets and slivers stop crowding the mesh.
 * Triangles that collapse are dropped. Returns new arrays.
 */
export function mergeShortEdges(positions, indices, minEdge) {
    if (!(minEdge > 0) || !Number.isFinite(minEdge)) return { positions: [...positions], indices: [...indices] };
    const pos = [...positions];
    let tris = [];
    for (let i = 0; i < indices.length; i += 3) tris.push([indices[i], indices[i + 1], indices[i + 2]]);
    const len = (a, b) => Math.hypot(pos[3 * a] - pos[3 * b], pos[3 * a + 1] - pos[3 * b + 1], pos[3 * a + 2] - pos[3 * b + 2]);
    for (let pass = 0; pass < 20; pass++) {
        const short = new Map();
        for (const t of tris) for (let k = 0; k < 3; k++) {
            const a = t[k], b = t[(k + 1) % 3], key = a < b ? `${a},${b}` : `${b},${a}`, l = len(a, b);
            if (l < minEdge && !short.has(key)) short.set(key, [l, Math.min(a, b), Math.max(a, b)]);
        }
        if (!short.size) break;
        const to = new Map(), used = new Set();
        for (const [, a, b] of [...short.values()].sort((x, y) => x[0] - y[0])) {
            if (used.has(a) || used.has(b)) continue;
            used.add(a); used.add(b);
            for (let k = 0; k < 3; k++) pos[3 * a + k] = (pos[3 * a + k] + pos[3 * b + k]) / 2;
            to.set(b, a);
        }
        tris = tris.map(t => t.map(v => to.get(v) ?? v)).filter(([a, b, c]) => a !== b && b !== c && c !== a);
    }
    // Only the vertices still used, renumbered.
    const keep = new Map(), out = [];
    const indicesOut = tris.flat().map(v => { if (!keep.has(v)) { keep.set(v, keep.size); out.push(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]); } return keep.get(v); });
    return { positions: out, indices: indicesOut };
}

/**
 * OBJ text: one object per mesh, vertices and faces (1-based, counter-clockwise outward). `scale`
 * multiplies every coordinate (Plasticity's Scale, for other programs' units) and `up` is 'z' (the
 * user's axes) or 'y' (y up, as most mesh programs have it).
 */
export function toObj(meshes, comment = 'Witness 3D', { scale = 1, up = 'z' } = {}) {
    const lines = [`# ${comment}`, scale === 1 ? '# units: millimetres' : `# units: millimetres × ${scale}`, `# up: ${up}`];
    let base = 0;
    for (const m of meshes) {
        lines.push(`o ${m.name}`);
        for (let i = 0; i < m.positions.length; i += 3) {
            const [x, y, z] = (up === 'y' ? [m.positions[i], m.positions[i + 1], m.positions[i + 2]] : toUser(m.positions[i], m.positions[i + 1], m.positions[i + 2])).map(c => c * scale);
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

const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const srgbToLinear = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

/**
 * Binary glTF 2.0 (.glb): one node and mesh per input mesh, in metres and glTF's own y-up axes (the
 * model's), with flat normals so creases stay sharp. A mesh's `color` (#rrggbb) and `metalness` /
 * `roughness` become its PBR material.
 */
export function toGlb(meshes) {
    const parts = [], bufferViews = [], accessors = [], gltfMeshes = [], nodes = [], materials = [];
    let length = 0;
    const view = (bytes, target) => {
        parts.push(bytes);
        bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.byteLength, target });
        length += bytes.byteLength;
        return bufferViews.length - 1;
    };
    for (const m of meshes) {
        // Unshared corners, each triangle with its own normal.
        const n = m.indices.length, pos = new Float32Array(3 * n), nor = new Float32Array(3 * n);
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (let t = 0; t < n; t += 3) {
            const q = [0, 1, 2].map(k => [0, 1, 2].map(j => m.positions[3 * m.indices[t + k] + j] / 1000));
            const u = q[1].map((x, j) => x - q[0][j]), v = q[2].map((x, j) => x - q[0][j]);
            const c = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...c) || 1;
            for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) {
                pos[3 * (t + k) + j] = q[k][j];
                nor[3 * (t + k) + j] = c[j] / l;
                lo[j] = Math.min(lo[j], q[k][j]); hi[j] = Math.max(hi[j], q[k][j]);
            }
        }
        if (!n) continue;
        const attributes = {
            POSITION: accessors.push({ bufferView: view(new Uint8Array(pos.buffer), 34962), componentType: 5126, count: n, type: 'VEC3', min: lo, max: hi }) - 1,
            NORMAL: accessors.push({ bufferView: view(new Uint8Array(nor.buffer), 34962), componentType: 5126, count: n, type: 'VEC3' }) - 1,
        };
        const [r, g, b] = hexRgb(m.color ?? '#9a968c').map(srgbToLinear);
        materials.push({ name: m.name, pbrMetallicRoughness: { baseColorFactor: [r, g, b, m.opacity ?? 1], metallicFactor: m.metalness ?? 0, roughnessFactor: m.roughness ?? 0.5 }, ...(m.opacity < 1 ? { alphaMode: 'BLEND' } : {}), doubleSided: !!m.sheet });
        gltfMeshes.push({ name: m.name, primitives: [{ attributes, material: materials.length - 1 }] });
        nodes.push({ name: m.name, mesh: gltfMeshes.length - 1 });
    }
    const json = {
        asset: { version: '2.0', generator: 'Witness 3D' },
        scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes: gltfMeshes, materials, accessors, bufferViews,
        buffers: [{ byteLength: length }],
    };
    if (!nodes.length) { delete json.buffers; delete json.bufferViews; delete json.accessors; }
    const pad = (bytes, fill) => { const out = new Uint8Array(Math.ceil(bytes.length / 4) * 4).fill(fill); out.set(bytes); return out; };
    const text = pad(new TextEncoder().encode(JSON.stringify(json)), 0x20);
    const bin = new Uint8Array(Math.ceil(length / 4) * 4);
    let o = 0;
    for (const p of parts) { bin.set(p, o); o += p.byteLength; }
    const total = 12 + 8 + text.length + (nodes.length ? 8 + bin.length : 0);
    const out = new Uint8Array(total), dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
    dv.setUint32(12, text.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(text, 20);
    if (nodes.length) {
        const at = 20 + text.length;
        dv.setUint32(at, bin.length, true); dv.setUint32(at + 4, 0x004e4942, true); out.set(bin, at + 8);
    }
    return out;
}

const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
})();
export function crc32(bytes) {
    let c = 0xffffffff;
    for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

/** A zip of stored (uncompressed) files, { name: Uint8Array | string } in order. */
export function zipStored(files) {
    const enc = new TextEncoder(), local = [], central = [];
    let offset = 0;
    for (const [name, data] of Object.entries(files)) {
        const nameBytes = enc.encode(name), body = typeof data === 'string' ? enc.encode(data) : data, crc = crc32(body);
        const head = new Uint8Array(30 + nameBytes.length), h = new DataView(head.buffer);
        h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 0, true);
        h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); // 1980-01-01, no clock
        h.setUint32(14, crc, true); h.setUint32(18, body.length, true); h.setUint32(22, body.length, true);
        h.setUint16(26, nameBytes.length, true); head.set(nameBytes, 30);
        const dir = new Uint8Array(46 + nameBytes.length), d = new DataView(dir.buffer);
        d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true);
        d.setUint16(12, 0, true); d.setUint16(14, 0x21, true);
        d.setUint32(16, crc, true); d.setUint32(20, body.length, true); d.setUint32(24, body.length, true);
        d.setUint16(28, nameBytes.length, true); d.setUint32(42, offset, true); dir.set(nameBytes, 46);
        local.push(head, body); central.push(dir);
        offset += head.length + body.length;
    }
    const size = central.reduce((n, c) => n + c.length, 0);
    const end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, central.length, true); e.setUint16(10, central.length, true);
    e.setUint32(12, size, true); e.setUint32(16, offset, true);
    const out = new Uint8Array(offset + size + 22);
    let o = 0;
    for (const p of [...local, ...central, end]) { out.set(p, o); o += p.length; }
    return out;
}

/** Corners at the same place (faces are meshed one by one) made one vertex, so the mesh is closed. */
export function weld({ positions, indices }, eps = 1e-6) {
    const at = new Map(), pos = [], map = [];
    for (let i = 0; i < positions.length; i += 3) {
        const key = [0, 1, 2].map(k => Math.round(positions[i + k] / eps)).join(',');
        if (!at.has(key)) { at.set(key, pos.length / 3); pos.push(positions[i], positions[i + 1], positions[i + 2]); }
        map.push(at.get(key));
    }
    const out = [];
    for (let t = 0; t < indices.length; t += 3) {
        const [a, b, c] = [map[indices[t]], map[indices[t + 1]], map[indices[t + 2]]];
        if (a !== b && b !== c && c !== a) out.push(a, b, c);
    }
    return { positions: pos, indices: out };
}

const xml = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

/**
 * 3MF (the 3D-printing package): one object per mesh in millimetres, z up, built where it stands, its
 * colour (#rrggbb) as a base material. Shared corners are kept, as 3MF meshes are meant to be closed.
 */
export function to3mf(meshes) {
    const colors = meshes.map(m => (m.color ?? '#9a968c').toUpperCase());
    const objects = meshes.map((raw, i) => {
        const m = weld(raw), v = [];
        for (let k = 0; k < m.positions.length; k += 3) {
            const [x, y, z] = toUser(m.positions[k], m.positions[k + 1], m.positions[k + 2]);
            v.push(`<vertex x="${+x.toFixed(6)}" y="${+y.toFixed(6)}" z="${+z.toFixed(6)}"/>`);
        }
        const t = [];
        for (let k = 0; k < m.indices.length; k += 3) t.push(`<triangle v1="${m.indices[k]}" v2="${m.indices[k + 1]}" v3="${m.indices[k + 2]}"/>`);
        return `<object id="${i + 2}" name="${xml(m.name)}" type="model" pid="1" pindex="${i}"><mesh><vertices>${v.join('')}</vertices><triangles>${t.join('')}</triangles></mesh></object>`;
    });
    const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Application">Witness 3D</metadata>
<resources><basematerials id="1">${meshes.map((m, i) => `<base name="${xml(m.name)}" displaycolor="${colors[i]}"/>`).join('')}</basematerials>
${objects.join('\n')}
</resources>
<build>${meshes.map((_, i) => `<item objectid="${i + 2}"/>`).join('')}</build>
</model>
`;
    return zipStored({
        '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`,
        '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`,
        '3D/3dmodel.model': model,
    });
}
