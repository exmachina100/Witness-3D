// Plasticity's instances: light copies of a solid, sheet or curve (`curve: true`) that share its
// geometry. Each keeps where it stands (a turn and a uniform scale about a pivot, then a move) and
// links back to its master, so an edit to the master shows in every instance. Instances are
// read-only: Realize Instance turns one into an ordinary body or curve.
//
// An instance takes a master point x to  position + q · (scale · (x − pivot)),  where pivot is the
// master's centre when the instance was made. That is the kernels' Motion with offset = position − pivot,
// so realizing is one Place of the master. A mirrored instance (Mirror with I) first reflects x in its
// `mirror` plane { origin, normal }, and its pivot is the reflected centre.

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
    if (m?.mirror !== undefined && !(nums(m.mirror?.origin, 3) && nums(m.mirror?.normal, 3) && Math.hypot(...m.mirror.normal) > 1e-9)) bad.push('mirror');
    return bad;
}

/** The reflection in plane { origin, normal }, as a matrix. */
export function reflection({ origin, normal }) {
    const n = new THREE.Vector3(...normal).normalize(), o = new THREE.Vector3(...origin), d = n.dot(o);
    const { x, y, z } = n;
    return new THREE.Matrix4().set(
        1 - 2 * x * x, -2 * x * y, -2 * x * z, 2 * d * x,
        -2 * x * y, 1 - 2 * y * y, -2 * y * z, 2 * d * y,
        -2 * x * z, -2 * y * z, 1 - 2 * z * z, 2 * d * z,
        0, 0, 0, 1);
}

/** The instance's placement as a matrix for the master's mesh. */
export function matrixOf(m) {
    const s = m.scale;
    const at = new THREE.Matrix4()
        .compose(new THREE.Vector3(...m.position), new THREE.Quaternion(...m.quaternion), new THREE.Vector3(s, s, s))
        .multiply(new THREE.Matrix4().makeTranslation(-m.pivot[0], -m.pivot[1], -m.pivot[2]));
    return m.mirror ? at.multiply(reflection(m.mirror)) : at;
}

/** A mirrored instance of body `master`: its reflection in `mirror` ({ origin, normal }), standing
 * where Mirror would put the copy; `centre` is the master's centre. */
export function mirroredInstance(id, master, mirror, centre) {
    const pivot = new THREE.Vector3(...centre).applyMatrix4(reflection(mirror)).toArray();
    return { ...newInstance(id, master, pivot), mirror: { origin: [...mirror.origin], normal: [...mirror.normal] } };
}

/** The kernels' Motion that takes the master to where the instance stands. */
export function motionOf(m) {
    const q = new THREE.Quaternion(...m.quaternion).normalize();
    if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
    const angle = 2 * Math.acos(Math.min(1, q.w)), s = Math.sqrt(Math.max(0, 1 - q.w * q.w));
    const axis = s < 1e-9 ? [0, 1, 0] : [q.x / s, q.y / s, q.z / s];
    return { pivot: [...m.pivot], offset: m.position.map((v, i) => v - m.pivot[i]), axis, angle: s < 1e-9 ? 0 : angle, scale: m.scale };
}

/**
 * An instance of body `master` standing where an array's motion (arrayMotions.js) would put a copy:
 * turned by `angle` about `axis` through `pivot`, then moved by `offset`. A motion without a turn
 * pivots about `centre`, the master's centre.
 */
export function instanceFromMotion(id, master, motion, centre) {
    const pivot = motion.pivot ?? centre;
    const q = motion.axis && motion.angle
        ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...motion.axis).normalize(), motion.angle)
        : new THREE.Quaternion();
    return { ...newInstance(id, master, pivot), position: pivot.map((v, i) => v + (motion.offset?.[i] ?? 0)), quaternion: q.toArray() };
}
