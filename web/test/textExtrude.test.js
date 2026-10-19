import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { LocalBackend } from '../src/app/LocalBackend.js';
import { loadKernel } from '../src/Kernel.js';
import { parseFont, textShapes } from '../src/text.js';
import { regionsToExtrude } from '../src/regions.js';
import { nurbsPoints } from '../src/curves.js';

before(async () => { await loadKernel() });

const frame = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 1, 0] };
const font = parseFont(readFileSync(new URL('../src/fonts/Outfit-Regular.ttf', import.meta.url)));

test('text extrudes with the counters cut out', async () => {
    const be = new LocalBackend();
    const curves = textShapes(font, 'Bob 80', 10).shapes.map(s => ({ ...frame, kind: 'nurbs', ...s }));
    const { ids } = await be.addCurves(curves);
    // Plane (x, y) is model (x, -z) here.
    const { first, more, holes } = regionsToExtrude(curves.map((c, i) => ({ id: ids[i], origin: frame.origin, normal: frame.normal, points: nurbsPoints(c).map(([x, y]) => [x, 0, -y]) })));
    assert.equal(holes.length, 7);
    const { scene } = await be.commit({ target: null, region: first, moreRegions: more, holes, distance: 2, op: 'new' });
    const cut = scene.at(-1).volume;
    // The counters filled in instead: more material.
    const { scene: filled } = await be.commit({ target: null, region: first, moreRegions: [...more, ...holes], distance: 2, op: 'new' });
    assert.ok(cut > 0 && filled.at(-1).volume > cut * 1.05, `${cut} ${filled.at(-1).volume}`);
});
