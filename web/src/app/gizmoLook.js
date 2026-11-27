// Plasticity's transform gizmo look over three.js's TransformControls (behaviour unchanged): a
// smaller gizmo, each axis a thin line to a small cube on its positive side only, the plane
// handles small see-through squares in each plane's positive quarter, and a wide white ring at
// the centre. Drawn from Plasticity's screenshots (2025.1 overview, Scale with a box selected):
// each axis ends in a small cube, the ring reaches about two fifths of the way along the axes and
// the three plane squares sit beside the axes at 0.6 of their length; the shapes are ours.

import * as THREE from 'three';

const cube = new THREE.BoxGeometry(0.05, 0.05, 0.05);
const ring = new THREE.TorusGeometry(0.19, 0.009, 6, 64);
/** Plane handle side and how far along each of its two axes it sits (the axes are 0.5 long). */
const PLANE_SIDE = 0.085, PLANE_AT = 0.3;
const none = new THREE.BufferGeometry();
/** Plane handle colours by the model plane they move in. */
const PLANE_COLORS = { XZ: 0xffd23f, YZ: 0x3fd0e0, XY: 0xb05cff };

/** A square in model plane `axis` ('XY', 'YZ' or 'XZ') in the user's positive quarter: the model's
 *  -Z is the user's +Y. `thick` gives a thin box (for picking) instead of a flat square. */
function planeSquare(axis, side, thick = 0) {
    const g = thick ? new THREE.BoxGeometry(side, side, thick) : new THREE.PlaneGeometry(side, side);
    if (axis === 'YZ') g.rotateY(Math.PI / 2);
    if (axis === 'XZ') g.rotateX(-Math.PI / 2);
    const at = { XY: [1, 1, 0], YZ: [0, 1, -1], XZ: [1, 0, -1] }[axis];
    return g.translate(at[0] * PLANE_AT, at[1] * PLANE_AT, at[2] * PLANE_AT);
}

/** Restyle `tc` (a TransformControls) in place; returns it. */
export function plasticityGizmo(tc, { size = 0.75 } = {}) {
    tc.size = size;
    // The model is y-up and the user's Z is up: the model's Y axis is the user's Z (blue) and its
    // Z the user's Y (green), as Plasticity colours them.
    tc.setColors?.(0xff3b3b, 0x3d7bff, 0x2fd35a, 0xffd23f);
    const gizmo = tc._gizmo?.gizmo;
    if (!gizmo) return tc;
    for (const mode of ['translate', 'scale']) {
        const group = gizmo[mode];
        if (!group) continue;
        for (const m of group.children) {
            if (!m.isMesh) continue;
            // three.js bakes each handle's place into its geometry: read it back from the bounds.
            m.geometry.computeBoundingBox();
            const c = m.geometry.boundingBox.getCenter(new THREE.Vector3()), axis = m.name;
            if (axis === 'X' || axis === 'Y' || axis === 'Z') {
                const k = { X: 'x', Y: 'y', Z: 'z' }[axis];
                // The user's +Y is the model's -Z: that axis is drawn on its minus side.
                const plus = axis === 'Z' ? -1 : 1;
                if (axis === 'Z') { m.geometry = m.geometry.clone().scale(1, 1, -1); m.geometry.computeBoundingBox(); }
                // The axis line stays; arrow heads and scale boxes become a cube on the plus side.
                const long = m.geometry.boundingBox.getSize(new THREE.Vector3())[k] > 0.3;
                if (!long && Math.abs(c[k]) > 0.2) m.geometry = c[k] * plus > 0 ? cube.clone().translate(c.x, c.y, c.z) : none;
            } else if (axis === 'XY' || axis === 'YZ' || axis === 'XZ') {
                m.geometry = planeSquare(axis, PLANE_SIDE);
                m.material = m.material.clone();
                m.material.side = THREE.DoubleSide;
                m.material.opacity = m.material._opacity = 0.75;
                // Plasticity's plane squares: yellow for the ground (the user's XY), cyan and
                // purple for the upright planes (which is which is inferred).
                m.material.color.set(PLANE_COLORS[axis]);
                m.material._color = m.material.color.clone();
            } else if (axis === 'XYZ') {
                m.geometry = ring;
                m.material = m.material.clone();
                m.material.color.set(0xffffff);
                m.material.opacity = m.material._opacity = 1;
                m.userData.billboard = true;
            }
        }
    }
    // The invisible pick targets follow the plane squares to their new places.
    for (const mode of ['translate', 'scale']) for (const m of tc._gizmo.picker?.[mode]?.children ?? []) {
        if (m.isMesh && (m.name === 'XY' || m.name === 'YZ' || m.name === 'XZ')) m.geometry = planeSquare(m.name, PLANE_SIDE * 1.5, 0.01);
    }
    // The centre ring faces the camera, as Plasticity's does.
    for (const group of [gizmo.translate, gizmo.scale]) for (const m of group?.children ?? []) {
        if (!m.userData.billboard) continue;
        m.onBeforeRender = (renderer, scene, camera) => {
            m.quaternion.copy(camera.quaternion);
            m.parent && m.quaternion.premultiply(m.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
            m.updateMatrixWorld(true);
        };
    }
    return tc;
}
