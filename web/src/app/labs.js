// LABS: the AI surfacing tools (docs/ai-roadmap.md), kept apart from the Plasticity tools. They get
// their own family at the end of the tool rail and their own options in the command dialog; App.js
// only hands them what they need (createLabs) and sends their ids here (labs.start).
//
// Seam Check: the selected edges (or ones clicked while it runs) measured against the Class-A
// targets. An edge two faces of a body share is one seam; an edge with one face is paired with the
// nearest such edge of another body. Each seam's samples are drawn as dots along it, green where
// every target is met, orange where only G2/G3 miss and red where the gap or angle does.

import * as THREE from 'three';
import { CLASS_A, checkSeam, seamSummary } from '../seamCheck.js';

/** The LABS commands, by id: their dialog titles. */
export const LABS_NAMES = { 'seam-check': 'SEAM CHECK' };

/** The LABS commands' keys, as KEYS lists them for the key strip. */
export const LABS_KEYS = {
    'seam-check': [['CLICK', 'ADD AN EDGE'], ['ENTER', 'DONE'], ['ESC', 'DONE']],
};

/** Their options in the command dialog. */
export const LABS_PANELS = `
    <div class="sec" data-panel="seam-check" hidden>
      <span class="hint" data-id="sc-hint">SELECT SEAM EDGES</span>
      <span class="label">TARGETS</span>
      <span class="hint" data-id="sc-targets" title="Class-A targets: gap, angle between the faces, curvature difference (G2) and its rate of change (G3) across the seam">GAP ${CLASS_A.g0} mm · ${CLASS_A.g1}° · G2 ${CLASS_A.g2}% · G3 ${CLASS_A.g3}%</span>
      <ol class="sc-list" data-id="sc-list"></ol>
    </div>`;

const COLOURS = { ok: new THREE.Color(0x2ec46b), soft: new THREE.Color(0xff8a1c), bad: new THREE.Color(0xe5484d) };

/**
 * `ctx`: { backend, sel, bodyOf, label, $, previewGroup, clearPreview, begin(c) (makes c the running
 * command and shows its dialog), endCmd, setHud, setState, toast, say, pickAt }.
 */
export function createLabs(ctx) {
    const { $ } = ctx;
    /** The middle of a body's edge in the viewport's mesh. */
    const middle = (body, n) => {
        const e = ctx.bodyOf(body)?.edges[n] ?? [];
        const i = Math.floor(e.length / 6) * 3;
        return e.length >= 3 ? [e[i], e[i + 1], e[i + 2]] : null;
    };
    const near = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : Infinity);

    /** Measure the edges: shared ones on their own, single-face ones paired across bodies. */
    async function measureEdges(edges) {
        const results = [], lone = [];
        for (const e of edges) {
            try { results.push({ edges: [e], r: await checkSeam(ctx.backend, { body: e.body, edge: e.n }) }); }
            catch (err) {
                if (/one face only/.test(err.message)) lone.push(e);
                else results.push({ edges: [e], error: err.message });
            }
        }
        // Each lone edge with the nearest lone edge of another body.
        const used = new Set();
        lone.forEach((e, i) => {
            if (used.has(i)) return;
            let best = -1, d = Infinity;
            lone.forEach((f, j) => {
                if (j === i || used.has(j) || f.body === e.body) return;
                const dd = near(middle(e.body, e.n), middle(f.body, f.n));
                if (dd < d) { d = dd; best = j; }
            });
            used.add(i);
            if (best < 0) { results.push({ edges: [e], error: 'one face only: select the matching edge of the other sheet too' }); return; }
            used.add(best);
            results.push({ edges: [e, lone[best]], pending: true });
        });
        for (const it of results.filter(x => x.pending)) {
            const [e, f] = it.edges;
            try { it.r = await checkSeam(ctx.backend, { body: e.body, edge: e.n, other: { body: f.body, edge: f.n } }); }
            catch (err) { it.error = err.message; }
            delete it.pending;
        }
        return results;
    }

    function draw(results) {
        ctx.clearPreview();
        const pts = [], cols = [];
        for (const { r } of results) {
            if (!r) continue;
            for (const s of r.samples) {
                const hard = !(s.gap <= CLASS_A.g0 && s.angle <= CLASS_A.g1);
                const soft = !hard && ((s.g2 !== null && s.g2 > CLASS_A.g2) || (s.g3 !== null && s.g3 > CLASS_A.g3));
                pts.push(new THREE.Vector3(...s.at));
                cols.push(hard ? COLOURS.bad : soft ? COLOURS.soft : COLOURS.ok);
            }
        }
        if (!pts.length) return;
        const g = new THREE.BufferGeometry().setFromPoints(pts);
        g.setAttribute('color', new THREE.Float32BufferAttribute(cols.flatMap(c => [c.r, c.g, c.b]), 3));
        const dots = new THREE.Points(g, new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, vertexColors: true, depthTest: false }));
        dots.renderOrder = 12;
        ctx.previewGroup.add(dots);
    }

    function list(results) {
        const ol = $('sc-list');
        ol.innerHTML = '';
        results.forEach((it, i) => {
            const li = document.createElement('li');
            const which = it.edges.map(e => `${ctx.label(e.body)} E${e.n}`).join(' + ');
            li.textContent = `SEAM ${i + 1} (${which}) · ${it.r ? seamSummary(it.r) : String(it.error).toUpperCase()}`;
            li.dataset.level = it.r?.level ?? 'error';
            ol.append(li);
        });
    }

    async function startSeamCheck() {
        const c = { id: 'seam-check', edges: ctx.sel.list('edge').map(e => ({ body: e.body, n: e.n })), results: [] };
        ctx.begin(c);
        ctx.setState('none');
        c.run = async () => {
            if (!c.edges.length) {
                $('sc-hint').textContent = 'SELECT OR CLICK THE EDGES OF THE SEAMS';
                ctx.setHud('CLICK A SEAM EDGE');
                list([]);
                return;
            }
            ctx.setState('updating');
            $('sc-hint').textContent = 'MEASURING…';
            try {
                c.results = await measureEdges(c.edges);
                list(c.results);
                draw(c.results);
                const ok = c.results.filter(x => x.r?.level === 'G3' || x.r?.level === 'G2').length;
                $('sc-hint').textContent = `${c.results.length} SEAM${c.results.length === 1 ? '' : 'S'} · ${ok} AT G2 OR BETTER`;
                ctx.setHud(c.results.length === 1 && c.results[0].r ? seamSummary(c.results[0].r) : $('sc-hint').textContent);
                ctx.setState('updated');
            } catch (err) { ctx.setHud(ctx.say(err)); ctx.setState('failed'); }
        };
        c.click = e => {
            const hit = ctx.pickAt(e);
            if (hit?.kind !== 'edge') { ctx.toast('CLICK AN EDGE OF A SEAM'); return true; }
            const at = c.edges.findIndex(x => x.body === hit.body && x.n === hit.n);
            if (at >= 0) c.edges.splice(at, 1); else c.edges.push({ body: hit.body, n: hit.n });
            c.run();
            return true;
        };
        c.finish = () => ctx.endCmd(null);
        c.abort = () => ctx.endCmd(null);
        c.cleanup = () => ctx.clearPreview();
        await c.run();
    }

    return {
        has: id => id in LABS_NAMES,
        start(id) {
            if (id === 'seam-check') {
                if (!ctx.backend.edgeFaces || !ctx.backend.edgeCurvature) return ctx.toast('SEAM CHECK IS NOT IN THIS BUILD YET');
                return startSeamCheck();
            }
        },
        /** Seam numbers for the agent and MCP tools (no viewport). */
        measureEdges,
    };
}
