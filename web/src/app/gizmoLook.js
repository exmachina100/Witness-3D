// Plasticity's transform gizmo look over three.js's TransformControls (behaviour unchanged): a
// smaller gizmo, each axis a thin line to a small ball on its positive side only, the plane
// handles small diamonds, and a white ring at the centre. Drawn from Plasticity's screenshots
// (2025.1 overview, Scale with a box selected); the shapes and sizes are ours.

import * as THREE from 'three';

const ball = new THREE.SphereGeometry(0.035, 16, 12);
const diamond = new THREE.CircleGeometry(0.035, 4);
const ring = new THREE.TorusGeometry(0.075, 0.006, 6, 48);
const none = new THREE.BufferGeometry();
/** Plane handle colours by the model plane they move in. */
const PLANE_COLORS = { XZ: 0xffd23f, YZ: 0x3fd0e0, XY: 0xb05cff };

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
                // The axis line stays; arrow heads and scale boxes become a ball on the plus side.
                const long = m.geometry.boundingBox.getSize(new THREE.Vector3())[k] > 0.3;
                if (!long && Math.abs(c[k]) > 0.2) m.geometry = c[k] * plus > 0 ? ball.clone().translate(c.x, c.y, c.z) : none;
            } else if (axis === 'XY' || axis === 'YZ' || axis === 'XZ') {
                // A circle of four sides is a diamond, laid in the handle's plane.
                const g = diamond.clone();
                if (axis === 'YZ') g.rotateY(Math.PI / 2);
                if (axis === 'XZ') g.rotateX(-Math.PI / 2);
                m.geometry = g.translate(c.x * 1.4, c.y * 1.4, c.z * 1.4);
                m.material = m.material.clone();
                m.material.side = THREE.DoubleSide;
                m.material.opacity = m.material._opacity = 1;
                // Plasticity's plane diamonds: yellow for the ground (the user's XY), cyan and
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
