// The vertices of a mesh or scan file (OBJ, or STL ASCII or binary) for Class-A Fit, without
// repeats (an STL lists each corner once per triangle).

/** Vertices of `bytes` (a Uint8Array or ArrayBuffer) from a file named `name`: [[x, y, z], ...]. */
export function scanPoints(bytes, name = '') {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const text = () => new TextDecoder().decode(u8);
    let pts = [];
    if (/\.obj$/i.test(name)) {
        for (const line of text().split(/\r?\n/)) {
            const m = /^v\s+(\S+)\s+(\S+)\s+(\S+)/.exec(line);
            if (m) pts.push([+m[1], +m[2], +m[3]]);
        }
    } else if (/\.stl$/i.test(name)) {
        const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
        const count = u8.length >= 84 ? dv.getUint32(80, true) : -1;
        if (count >= 0 && 84 + count * 50 === u8.length) {
            for (let t = 0; t < count; t++) for (let k = 0; k < 3; k++) {
                const at = 84 + t * 50 + 12 + k * 12;
                pts.push([dv.getFloat32(at, true), dv.getFloat32(at + 4, true), dv.getFloat32(at + 8, true)]);
            }
        } else {
            for (const m of text().matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) pts.push([+m[1], +m[2], +m[3]]);
        }
    } else throw new Error('load an OBJ or STL mesh');
    pts = pts.filter(p => p.every(Number.isFinite));
    const seen = new Set(), out = [];
    for (const p of pts) {
        const key = p.map(v => v.toFixed(5)).join(',');
        if (!seen.has(key)) { seen.add(key); out.push(p); }
    }
    if (out.length < 64) throw new Error('that mesh has too few points to fit');
    return out;
}
