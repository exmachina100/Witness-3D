// Rotate around cursor (Plasticity's Preferences › Navigation, on by default): a middle-drag turns
// the view about the point under the cursor rather than the view's centre. The camera and its
// target both swing about that point, so the view turns as an orbit would and nothing jumps.
import * as THREE from 'three';

const EPS = 0.01;

/**
 * The camera position and target after turning by `azimuth` about the world up through `pivot`
 * and by `elevation` about the camera's right through it. Elevation stops short of looking
 * straight up or down, as OrbitControls does.
 */
export function orbitAbout(position, target, pivot, azimuth, elevation, up = new THREE.Vector3(0, 1, 0)) {
    const turn = new THREE.Quaternion().setFromAxisAngle(up, azimuth);
    const dir = target.clone().sub(position);
    const right = dir.clone().cross(up);
    if (right.lengthSq() > 1e-12) {
        // Turning about the right axis moves the view's angle from up by the same amount, one way.
        right.normalize();
        const a0 = dir.angleTo(up);
        const s = Math.sign(dir.clone().applyAxisAngle(right, 1e-3).angleTo(up) - a0) || 1;
        const a1 = Math.min(Math.PI - EPS, Math.max(EPS, a0 + s * elevation));
        turn.multiply(new THREE.Quaternion().setFromAxisAngle(right, (a1 - a0) * s));
    }
    const swing = p => p.clone().sub(pivot).applyQuaternion(turn).add(pivot);
    return { position: swing(position), target: swing(target) };
}

/** Pixels dragged to angles, at OrbitControls' rate: a full turn per canvas height. */
export function dragAngles(dx, dy, height, speed = 1) {
    const k = 2 * Math.PI / (height || 1) * speed;
    return { azimuth: -dx * k, elevation: -dy * k };
}
