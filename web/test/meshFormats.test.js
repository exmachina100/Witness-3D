// glTF (.glb) and 3MF mesh export: the files' structure, units and axes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc32, to3mf, toGlb, weld, zipStored } from '../src/meshExport.js';

// A 10 mm cube in model axes (y up), meshed face by face so corners repeat, as the backends do.
function cube() {
    const positions = [], indices = [];
    const quad = (a, b, c, d) => { const o = positions.length / 3; positions.push(...a, ...b, ...c, ...d); indices.push(o, o + 1, o + 2, o, o + 2, o + 3); };
    const p = (x, y, z) => [x * 10, y * 10, z * 10];
    quad(p(0, 0, 0), p(0, 1, 0), p(1, 1, 0), p(1, 0, 0)); quad(p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1));
    quad(p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)); quad(p(0, 1, 0), p(0, 1, 1), p(1, 1, 1), p(1, 1, 0));
    quad(p(0, 0, 0), p(0, 0, 1), p(0, 1, 1), p(0, 1, 0)); quad(p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1));
    return { name: 'SOLID 1', positions, indices, color: '#ff4d00' };
}

test('the zip checksum is the standard CRC-32', () => {
    assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('a glb has its header, JSON and binary chunks, in metres', () => {
    const glb = toGlb([cube()]), dv = new DataView(glb.buffer);
    assert.equal(dv.getUint32(0, true), 0x46546c67);
    assert.equal(dv.getUint32(4, true), 2);
    assert.equal(dv.getUint32(8, true), glb.length);
    const jsonLength = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)));
    assert.equal(json.meshes.length, 1);
    const position = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
    assert.equal(position.count, 36);
    assert.deepEqual(position.max, [0.01, 0.01, 0.01]);
    assert.equal(dv.getUint32(20 + jsonLength + 4, true), 0x004e4942);
    assert.equal(dv.getUint32(20 + jsonLength, true), json.buffers[0].byteLength);
    // The orange, linear: 1, ~0.074, 0.
    const [r, g, b] = json.materials[0].pbrMetallicRoughness.baseColorFactor;
    assert.ok(r === 1 && Math.abs(g - 0.0742) < 1e-3 && b === 0);
});

test('a welded cube has eight corners and twelve triangles', () => {
    const w = weld(cube());
    assert.equal(w.positions.length, 24);
    assert.equal(w.indices.length, 36);
});

test('a 3mf is a zip with the model in millimetres, z up', () => {
    const bytes = to3mf([cube()]), dv = new DataView(bytes.buffer);
    assert.equal(dv.getUint32(0, true), 0x04034b50);
    const end = bytes.length - 22;
    assert.equal(dv.getUint32(end, true), 0x06054b50);
    assert.equal(dv.getUint16(end + 10, true), 3);
    const text = new TextDecoder().decode(bytes);
    assert.match(text, /unit="millimeter"/);
    assert.match(text, /displaycolor="#FF4D00"/);
    assert.equal((text.match(/<vertex /g) || []).length, 8);
    assert.equal((text.match(/<triangle /g) || []).length, 12);
    // Model y (up) is the file's z.
    assert.match(text, /<vertex x="0" y="0" z="10"\/>/);
    assert.ok(zipStored({ a: 'b' }).length === 22 + 30 + 1 + 1 + 46 + 1);
});
