// Plasticity's instances: light copies of a solid, sheet or curve (`curve: true`) that share its
// geometry. Each keeps where it stands (a turn and a uniform scale about a pivot, then a move) and
// links back to its master, so an edit to the master shows in every instance. Instances are
// read-only: Realize Instance turns one into an ordinary body or curve.
//
// An instance takes a master point x to  position + q · (scale · (x − pivot)),  where pivot is the
// master's centre when the instance was made. That is the kernels' Motion with offset = position − pivot,
// so realizing is one Place of the master.

import * as THREE from 'three';

/** A new instance of body `master` standing on it, pivoting about `pivot` (the master's centre). */
export function newInstance(id, master, pivot) {
    return { id, master, pivot: [...pivot], position: [...pivot], quaternion: [0, 0, 0, 1], scale: 1, hidden: false };
}

/** What is wrong with a stored instance, so a file's bad entry is left out rather than drawn. */
export function checkInstance(m) {
    const bad = [];
    const nums = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
    if (!Number.isInteger(m?.id) || m.id < 1) bad.push('id');
    if (!Number.isInteger(m?.master) || m.master < 1) bad.push('master');
    if (!nums(m?.pivot, 3)) bad.push('pivot');
    if (!nums(m?.position, 3)) bad.push('position');
    if (!nums(m?.quaternion, 4) || Math.abs(Math.hypot(...m.quaternion) - 1) > 1e-6) bad.push('turn');
    if (!(m?.scale > 0) || !Number.isFinite(m.scale)) bad.push('scale');
    if (typeof m?.hidden !== 'boolean') bad.push('hidden');
    if (m?.curve !== undefined && typeof m.curve !== 'boolean') bad.push('curve');
    return bad;
}

/** The instance's placement as a matrix for the master's mesh. */
export function matrixOf(m) {
    const s = m.scale;
    return new THREE.Matrix4()
        .compose(new THREE.Vector3(...m.position), new THREE.Quaternion(...m.quaternion), new THREE.Vector3(s, s, s))
        .multiply(new THREE.Matrix4().makeTranslation(-m.pivot[0], -m.pivot[1], -m.pivot[2]));
}

/** The kernels' Motion that takes the master to where the instance stands. */
export function motionOf(m) {
    const q = new THREE.Quaternion(...m.quaternion).normalize();
    if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
    const angle = 2 * Math.acos(Math.min(1, q.w)), s = Math.sqrt(Math.max(0, 1 - q.w * q.w));
    const axis = s < 1e-9 ? [0, 1, 0] : [q.x / s, q.y / s, q.z / s];
    return { pivot: [...m.pivot], offset: m.position.map((v, i) => v - m.pivot[i]), axis, angle: s < 1e-9 ? 0 : angle, scale: m.scale };
}
