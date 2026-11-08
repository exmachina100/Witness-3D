// Edge and curve thickness (Plasticity: Preferences › Appearance). WebGL draws lines one pixel
// wide, so a line thicker than that is drawn again as screen-space quads (three's LineSegments2)
// on a child of the line. The thin line stays for picking and keeps its material swaps (hover,
// selection, the curve's own colour); only its drawing is switched off while the thick copy shows,
// and the copy takes the line's colour, opacity and depth test every frame.

import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

/**
 * A line's points as segment pairs (x0 y0 z0 x1 y1 z1 ...): a LineSegments' as they are, a Line's
 * as each point to the next, and a LineLoop's closed back to its first.
 */
export function segmentPairs(positions, kind, count = positions.length / 3) {
    if (kind === 'segments') return positions.slice(0, 3 * count);
    const out = [];
    const n = kind === 'loop' && count > 2 ? count : count - 1;
    for (let i = 0; i < n; i++) {
        const a = 3 * i, b = 3 * ((i + 1) % count);
        out.push(positions[a], positions[a + 1], positions[a + 2], positions[b], positions[b + 1], positions[b + 2]);
    }
    return out;
}

const kindOf = line => line.isLineSegments ? 'segments' : line.isLineLoop ? 'loop' : 'strip';
const noPick = () => {};

/** Marks a line material as an edge's or a curve's, so its lines follow that thickness. */
export function thickness(material, which) {
    material.userData.thickness = which;
    return material;
}

/**
 * Before a render: every line whose material is marked gets (or loses) its thick copy for the
 * current `widths` ({ edge, curve } in pixels); `size` is the drawing size in CSS pixels.
 */
export function updateThickLines(scene, widths, size) {
    const marked = new Set();
    scene.traverse(o => {
        if (!o.isLine || o.userData.thickCopy) return;
        const which = o.material?.userData?.thickness;
        const copy = o.userData.thick;
        const width = which ? widths[which] ?? 1 : 1;
        if (which) marked.add(o.material);
        if (width <= 1) {
            if (copy) { o.remove(copy); copy.geometry.dispose(); copy.material.dispose(); delete o.userData.thick; }
            return;
        }
        const pos = o.geometry.attributes.position;
        if (!pos) return;
        const count = Math.min(pos.count, o.geometry.drawRange.count);
        let line = copy;
        if (!line) {
            // The quads are triangles, so a depth offset keeps them clear of the faces they edge.
            line = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ linewidth: width, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 }));
            line.userData.thickCopy = true;
            line.raycast = noPick;
            o.add(line);
            o.userData.thick = line;
        }
        if (line.userData.source !== pos || line.userData.version !== pos.version || line.userData.count !== count) {
            line.geometry.dispose();
            line.geometry = new LineSegmentsGeometry().setPositions(segmentPairs(pos.array, kindOf(o), count));
            Object.assign(line.userData, { source: pos, version: pos.version, count });
        }
        const m = line.material, src = o.material;
        m.color.copy(src.color);
        m.opacity = src.opacity;
        m.transparent = src.transparent;
        m.depthTest = src.depthTest;
        m.linewidth = width;
        m.resolution.set(size.x, size.y);
        line.renderOrder = o.renderOrder;
    });
    // The thin lines draw only when no thick copy stands in for them.
    for (const m of marked) m.visible = (widths[m.userData.thickness] ?? 1) <= 1;
}
