// SpaceMouse (3Dconnexion) navigation, as Plasticity supports one: push and pull the cap to pan and
// zoom, tilt and twist it to orbit. Read through WebHID, which Chromium (and so the desktop app's
// webview) offers; the device's reports are six signed 16-bit axes. Preferences › SpaceMouse holds
// the speeds and which ways the axes go (their names inferred: the manual lists the section only).
import { orbitAbout } from './orbit.js';

/** 3Dconnexion's USB vendor ids (its own, and Logitech's for older devices). */
export const VENDORS = [0x256f, 0x046d];
/** Each axis runs to about ±350; below this the cap counts as at rest. */
export const DEADZONE = 12;
const FULL = 350;

/**
 * One input report into `axes` ({ t: [x, y, z], r: [rx, ry, rz] }, changed in place): report 1 is
 * translation (and rotation too on devices that send all six at once), report 2 rotation.
 * Returns whether it was an axis report.
 */
export function readReport(axes, reportId, data) {
    const at = i => data.getInt16(2 * i, true);
    if (reportId === 1 && data.byteLength >= 6) {
        axes.t = [at(0), at(1), at(2)];
        if (data.byteLength >= 12) axes.r = [at(3), at(4), at(5)];
        return true;
    }
    if (reportId === 2 && data.byteLength >= 6) {
        axes.r = [at(0), at(1), at(2)];
        return true;
    }
    return false;
}

const shaped = v => Math.abs(v) < DEADZONE ? 0 : Math.sign(v) * ((Math.abs(v) - DEADZONE) / (FULL - DEADZONE));

/**
 * The camera after `dt` seconds of the cap held at `axes`. The device's x is right, y away from the
 * user and z down: x and z pan, pushing away zooms in, tilting forward (rx) looks down and
 * twisting (rz) turns the view about the vertical. Returns null at rest.
 */
export function spaceMouseStep(position, target, up, axes, dt, opts = {}) {
    const { panSpeed = 1, rotateSpeed = 1, invertPan = false, invertRotate = false, invertZoom = false } = opts;
    const [tx, ty, tz] = axes.t.map(shaped), [rx, , rz] = axes.r.map(shaped);
    if (!tx && !ty && !tz && !rx && !rz) return null;
    const p = invertPan ? -1 : 1, r = invertRotate ? -1 : 1, z = invertZoom ? -1 : 1;
    const dir = target.clone().sub(position), dist = dir.length();
    const fwd = dir.clone().normalize(), right = fwd.clone().cross(up).normalize(), camUp = right.clone().cross(fwd);
    // Panning covers the view's distance in about a second at full push, so it feels the same close up and far off.
    const pan = right.multiplyScalar(tx * p).add(camUp.multiplyScalar(-tz * p)).multiplyScalar(dist * panSpeed * dt);
    let pos = position.clone().add(pan), tgt = target.clone().add(pan);
    // Zoom: the distance shrinks (or grows) by up to a factor of e a second.
    const k = Math.exp(-ty * z * panSpeed * dt);
    pos = tgt.clone().sub(tgt.clone().sub(pos).multiplyScalar(k));
    // Orbit about the target: half a turn a second at full tilt.
    const turn = Math.PI * rotateSpeed * dt * r;
    const o = orbitAbout(pos, tgt, tgt, -rz * turn, -rx * turn, up);
    return { position: o.position, target: o.target };
}

/**
 * Watch for a SpaceMouse: devices already allowed connect at once, `connect()` asks for one (it
 * needs a click or key press to ask). `onAxes` hears every report. Without WebHID it does nothing.
 */
export function spaceMouse(onAxes) {
    const hid = globalThis.navigator?.hid;
    const axes = { t: [0, 0, 0], r: [0, 0, 0] };
    const open = async device => {
        if (!device.opened) await device.open();
        device.oninputreport = e => { if (readReport(axes, e.reportId, e.data)) onAxes(axes); };
        return device;
    };
    const ours = d => VENDORS.includes(d.vendorId) && d.collections?.some(c => c.usagePage === 1 && c.usage === 8);
    if (hid) {
        hid.getDevices().then(ds => Promise.all(ds.filter(ours).map(open))).catch(() => {});
        hid.addEventListener?.('connect', e => { if (ours(e.device)) open(e.device).catch(() => {}); });
    }
    return {
        axes,
        supported: !!hid,
        async connect() {
            if (!hid) throw new Error('this browser cannot reach a SpaceMouse (no WebHID)');
            const [device] = await hid.requestDevice({ filters: VENDORS.map(vendorId => ({ vendorId, usagePage: 1, usage: 8 })) });
            if (!device) return null;
            await open(device);
            return device.productName || 'SpaceMouse';
        },
        /** At rest: what to use after a device goes away mid-push. */
        reset() { axes.t = [0, 0, 0]; axes.r = [0, 0, 0]; },
    };
}
