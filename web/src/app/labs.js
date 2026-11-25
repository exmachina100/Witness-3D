// LABS: the AI surfacing tools (docs/ai-roadmap.md), kept apart from the Plasticity tools. They get
// their own family at the end of the tool rail and their own options in the command dialog; App.js
// only hands them what they need (createLabs) and sends their ids here (labs.start).
//
// Seam Check: the selected edges (or ones clicked while it runs) measured against the Class-A
// targets. An edge two faces of a body share is one seam; an edge with one face is paired with the
// nearest such edge of another body. Each seam's samples are drawn as dots along it, green where
// every target is met, orange where only G2/G3 miss and red where the gap or angle does.

import * as THREE from 'three';
import { CLASS_A, HIGHLIGHT_KINK, checkSeam, seamSummary } from '../seamCheck.js';
import { SOLVER_CONTINUITY, seamSolveRequest } from '../seamSolver.js';
import { g3Blend, nearestEdge } from '../g3Blend.js';
import { FIT_TOLERANCE, classAFitFace } from '../classAFit.js';

/** The LABS commands, by id: their dialog titles. */
export const LABS_NAMES = { 'seam-check': 'SEAM CHECK', 'seam-solver': 'SEAM SOLVER', 'g3-blend': 'G3 BLEND', 'class-a-fit': 'CLASS-A FIT' };

/** The LABS commands' keys, as KEYS lists them for the key strip. */
export const LABS_KEYS = {
    'seam-check': [['CLICK', 'ADD AN EDGE'], ['ENTER', 'DONE'], ['ESC', 'DONE']],
    'seam-solver': [['TAB', 'CONTINUITY'], ['ENTER', 'KEEP AND MEASURE'], ['ESC', 'CANCEL']],
    'g3-blend': [['TAB', 'CONTINUITY'], ['ENTER', 'KEEP AND MEASURE'], ['ESC', 'CANCEL']],
    'class-a-fit': [['ENTER', 'KEEP THE PATCH'], ['ESC', 'CANCEL']],
};

/** Their options in the command dialog. */
export const LABS_PANELS = `
    <div class="sec" data-panel="seam-check" hidden>
      <span class="hint" data-id="sc-hint">SELECT SEAM EDGES</span>
      <span class="label">TARGETS</span>
      <span class="hint" data-id="sc-targets" title="Class-A targets: gap, angle between the faces, curvature difference (G2) and its rate of change (G3) across the seam; how much highlight lines bend crossing it (6 studio lights)">GAP ${CLASS_A.g0} mm · ${CLASS_A.g1}° · G2 ${CLASS_A.g2}% · G3 ${CLASS_A.g3}% · HIGHLIGHT ${HIGHLIGHT_KINK}°</span>
      <ol class="sc-list" data-id="sc-list"></ol>
    </div>
    <div class="sec" data-panel="seam-solver" hidden>
      <span class="hint" data-id="ss-hint">SELECT THE SHEET EDGE TO MOVE, THEN THE EDGE TO MEET</span>
      <span class="label">CONTINUITY</span>
      <div class="seg" role="group" aria-label="Continuity">${SOLVER_CONTINUITY.map(c => `<button data-sscont="${c}" aria-pressed="${c === 'G3'}" title="Meet the other face in ${c} (Tab cycles)">${c}</button>`).join('')}</div>
      <span class="hint" data-id="ss-result" title="Seam Check's numbers after the last solve was kept">—</span>
    </div>
    <div class="sec" data-panel="g3-blend" hidden>
      <span class="hint" data-id="gb-hint">SELECT TWO EDGES TO BLEND BETWEEN</span>
      <span class="label">CONTINUITY</span>
      <div class="seg" role="group" aria-label="Continuity">${SOLVER_CONTINUITY.map(c => `<button data-gbcont="${c}" aria-pressed="${c === 'G3'}" title="Meet both faces in ${c} (Tab cycles)">${c}</button>`).join('')}</div>
      <div class="field" title="How far the blend runs along the first face before it turns"><label for="w3d-gb-t1">TENSION 1</label><input id="w3d-gb-t1" data-id="gb-t1" type="number" step="0.1" min="0.1" value="1"></div>
      <div class="field" title="How far the blend runs along the second face before it turns"><label for="w3d-gb-t2">TENSION 2</label><input id="w3d-gb-t2" data-id="gb-t2" type="number" step="0.1" min="0.1" value="1"></div>
    </div>
    <div class="sec" data-panel="class-a-fit" hidden>
      <span class="hint" data-id="cf-hint">SELECT A FACE TO REBUILD AS ONE CLASS-A PATCH</span>
      <div class="field" title="The furthest the patch may stand off the face"><label for="w3d-cf-tol">TOLERANCE</label><input id="w3d-cf-tol" data-id="cf-tol" type="number" step="0.01" min="0.001" value="${FIT_TOLERANCE}"></div>
      <div class="seg" role="group" aria-label="Fairing"><button data-cffair="on" aria-pressed="true" title="Fair the patch as far as the tolerance allows (irons out ripples and inflections)">FAIR</button><button data-cffair="off" aria-pressed="false" title="The closest fit, no fairing">CLOSEST</button></div>
      <span class="hint" data-id="cf-result" title="Degree, furthest distance from the face, inflections before and after">—</span>
    </div>`;

const COLOURS = { ok: new THREE.Color(0x2ec46b), soft: new THREE.Color(0xff8a1c), bad: new THREE.Color(0xe5484d) };

/**
 * `ctx`: { backend, sel, bodyOf, label, $, previewGroup, clearPreview, begin(c) (makes c the running
 * command and shows its dialog), current() (the running command), endCmd, setHud, setState, toast,
 * say, pickAt, livePreview, showPreviewBody, record, showScene }.
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
                if (j === i || used.has(j)) return;
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

    async function startSeamCheck(picked) {
        const c = { id: 'seam-check', edges: picked.map(e => ({ body: e.body, n: e.n })), results: [] };
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

    /**
     * Seam Solver: the first selected edge (along a side of a B-spline sheet) moved to meet the
     * second's face in G0 to G3 (seamSolver.js), shown live; Enter keeps it as one undo step and
     * measures the seam with Seam Check.
     */
    function startSeamSolver(edges) {
        if (edges.length !== 2) return ctx.toast('SELECT THE SHEET EDGE TO MOVE, THEN THE EDGE TO MEET');
        const [target, reference] = edges.map(e => ({ body: e.body, edge: e.n }));
        const c = { id: 'seam-solver', continuity: 'G3', req: null, sent: 0, shown: 0 };
        ctx.begin(c);
        ctx.setState('none');
        const buttons = () => { for (const b of document.querySelectorAll('[data-sscont]')) b.setAttribute('aria-pressed', String(b.dataset.sscont === c.continuity)); };
        c.preview = () => {
            buttons();
            $('ss-hint').textContent = `SOLVING ${c.continuity}…`;
            ctx.livePreview(c, async () => {
                const req = await seamSolveRequest(ctx.backend, { target, reference, continuity: c.continuity });
                if (ctx.current() !== c) return null;
                c.req = req;
                const g3 = req.g3 ? ` · G3 RATE ${Math.max(...req.g3.after.map((v, j) => Math.abs(v - req.g3.want[j]))).toExponential(1)} OFF` : '';
                $('ss-hint').textContent = `${c.continuity} PREVIEW · ${req.moves.length} CONTROL POINTS${g3} · ENTER KEEPS AND MEASURES`;
                return ctx.backend.previewMoveFacePoles({ body: req.body, moves: req.moves });
            }, b => ctx.showPreviewBody(b), 'ss-hint');
        };
        c.setContinuity = v => { c.continuity = v; c.preview(); };
        c.key = action => {
            if (action !== 'continuity' && action !== 'tab') return false;
            c.setContinuity(SOLVER_CONTINUITY[(SOLVER_CONTINUITY.indexOf(c.continuity) + 1) % SOLVER_CONTINUITY.length]);
            return true;
        };
        c.finish = async () => {
            if (!c.req) return ctx.toast($('ss-hint').textContent);
            try {
                const { id, scene } = await ctx.backend.commitMoveFacePoles({ body: c.req.body, moves: c.req.moves });
                ctx.endCmd('committed');
                ctx.record(`SEAM SOLVER ${c.continuity}`, id, `${c.req.moves.length} CONTROL POINTS`);
                await ctx.showScene(scene);
                const r = await checkSeam(ctx.backend, { ...target, other: reference });
                lastSolve = r;
                ctx.setHud(seamSummary(r));
                ctx.toast(`SEAM ${r.level}`);
            } catch (e) { ctx.setState('failed'); ctx.toast(ctx.say(e)); }
        };
        c.abort = () => ctx.endCmd('cancelled');
        c.cleanup = () => ctx.clearPreview();
        for (const b of document.querySelectorAll('[data-sscont]')) b.onclick = () => ctx.current() === c && c.setContinuity(b.dataset.sscont);
        c.preview();
    }
    /**
     * G3 Blend: a sheet from the first selected edge to the second, meeting both faces in G0 to G3
     * with a tension at each end (g3Blend.js), shown live; Enter keeps it and measures both seams.
     */
    function startG3Blend(edges) {
        if (edges.length !== 2) return ctx.toast('SELECT TWO EDGES TO BLEND BETWEEN');
        const [a, b] = edges.map(e => ({ body: e.body, edge: e.n }));
        const mids = edges.map(e => middle(e.body, e.n));
        const c = { id: 'g3-blend', continuity: 'G3', data: null, sent: 0, shown: 0 };
        ctx.begin(c);
        ctx.setState('none');
        const tension = () => ['gb-t1', 'gb-t2'].map(id => +$(id).value || 1);
        const buttons = () => { for (const btn of document.querySelectorAll('[data-gbcont]')) btn.setAttribute('aria-pressed', String(btn.dataset.gbcont === c.continuity)); };
        c.preview = () => {
            buttons();
            $('gb-hint').textContent = `BLENDING IN ${c.continuity}…`;
            ctx.livePreview(c, async () => {
                const r = await g3Blend(ctx.backend, a, b, { continuity: [c.continuity, c.continuity], tension: tension() });
                if (ctx.current() !== c) return null;
                c.data = r.data;
                $('gb-hint').textContent = `${c.continuity} PREVIEW · ENTER KEEPS AND MEASURES BOTH SEAMS`;
                return ctx.backend.previewSplineSheet({ data: r.data });
            }, sheet => ctx.showPreviewBody(sheet), 'gb-hint');
        };
        c.key = action => {
            if (action !== 'continuity' && action !== 'tab') return false;
            c.continuity = SOLVER_CONTINUITY[(SOLVER_CONTINUITY.indexOf(c.continuity) + 1) % SOLVER_CONTINUITY.length];
            c.preview();
            return true;
        };
        c.finish = async () => {
            if (!c.data) return ctx.toast($('gb-hint').textContent);
            try {
                const { ids: [id], scene } = await ctx.backend.commitSplineSheet({ data: c.data });
                ctx.endCmd('committed');
                ctx.record(`G3 BLEND ${c.continuity}`, id, 'BLEND SHEET');
                await ctx.showScene(scene);
                const seams = [];
                for (const [k, ref] of [a, b].entries()) {
                    const edge = nearestEdge(scene, id, mids[k]);
                    seams.push(await checkSeam(ctx.backend, { body: id, edge, other: ref }));
                }
                lastBlend = seams;
                ctx.setHud(seams.map((r, k) => `${k + 1}: ${seamSummary(r)}`).join('  |  '));
                ctx.toast(`BLEND ${seams.map(r => r.level).join(' / ')}`);
            } catch (e) { ctx.setState('failed'); ctx.toast(ctx.say(e)); }
        };
        c.abort = () => ctx.endCmd('cancelled');
        c.cleanup = () => ctx.clearPreview();
        for (const btn of document.querySelectorAll('[data-gbcont]')) btn.onclick = () => { if (ctx.current() === c) { c.continuity = btn.dataset.gbcont; c.preview(); } };
        for (const id of ['gb-t1', 'gb-t2']) $(id).oninput = () => ctx.current() === c && c.preview();
        c.preview();
    }
    /**
     * Class-A Fit: the selected face rebuilt as one single-span patch of degree 5 to 7 within the
     * tolerance, faired (classAFit.js), shown live; Enter keeps it as a new sheet beside the face.
     */
    function startClassAFit(faces) {
        if (faces.length !== 1) return ctx.toast('SELECT ONE FACE TO FIT');
        const target = { body: faces[0].body, face: faces[0].n };
        const c = { id: 'class-a-fit', fair: true, fit: null, sent: 0, shown: 0 };
        ctx.begin(c);
        ctx.setState('none');
        const buttons = () => { for (const btn of document.querySelectorAll('[data-cffair]')) btn.setAttribute('aria-pressed', String((btn.dataset.cffair === 'on') === c.fair)); };
        c.preview = () => {
            buttons();
            $('cf-hint').textContent = 'FITTING…';
            ctx.livePreview(c, async () => {
                const r = await classAFitFace(ctx.backend, target, { tolerance: +$('cf-tol').value || FIT_TOLERANCE, fair: c.fair });
                if (ctx.current() !== c) return null;
                c.fit = r;
                const text = `DEGREE ${r.degree} · ${r.deviation.toFixed(4)} mm OFF THE FACE · INFLECTIONS ${r.before} → ${r.inflections}`;
                $('cf-result').textContent = text;
                $('cf-hint').textContent = `${text} · ENTER KEEPS IT`;
                return ctx.backend.previewSplineSheet({ data: r.data });
            }, sheet => ctx.showPreviewBody(sheet), 'cf-hint');
        };
        c.finish = async () => {
            if (!c.fit) return ctx.toast($('cf-hint').textContent);
            try {
                const { ids: [id], scene } = await ctx.backend.commitSplineSheet({ data: c.fit.data });
                ctx.endCmd('committed');
                ctx.record(`CLASS-A FIT DEGREE ${c.fit.degree}`, id, `${c.fit.deviation.toFixed(4)} mm`);
                await ctx.showScene(scene);
                lastFit = { body: id, degree: c.fit.degree, deviation: c.fit.deviation, inflections: c.fit.inflections, before: c.fit.before };
                ctx.setHud(`CLASS-A FIT · DEGREE ${c.fit.degree} · ${c.fit.deviation.toFixed(4)} mm · INFLECTIONS ${c.fit.inflections}`);
            } catch (e) { ctx.setState('failed'); ctx.toast(ctx.say(e)); }
        };
        c.abort = () => ctx.endCmd('cancelled');
        c.cleanup = () => ctx.clearPreview();
        for (const btn of document.querySelectorAll('[data-cffair]')) btn.onclick = () => { if (ctx.current() === c) { c.fair = btn.dataset.cffair === 'on'; c.preview(); } };
        $('cf-tol').oninput = () => ctx.current() === c && c.preview();
        c.preview();
    }
    let lastSolve = null, lastBlend = null, lastFit = null;

    return {
        has: id => id in LABS_NAMES,
        /** The last Seam Solver result's Seam Check, for the agent. */
        lastSolve: () => lastSolve,
        /** The last G3 Blend's two Seam Checks, for the agent. */
        lastBlend: () => lastBlend,
        /** The last Class-A Fit kept, for the agent. */
        lastFit: () => lastFit,
        /** Start command `id` on `edges` (the edges selected when it was asked for). */
        start(id, edges = ctx.sel.list('edge'), faces = ctx.sel.list('face')) {
            if (id === 'seam-check') {
                if (!ctx.backend.edgeFaces || !ctx.backend.edgeCurvature) return ctx.toast('SEAM CHECK IS NOT IN THIS BUILD YET');
                return startSeamCheck(edges);
            }
            if (id === 'seam-solver') {
                if (!ctx.backend.edgeFaces || !ctx.backend.previewMoveFacePoles) return ctx.toast('SEAM SOLVER IS NOT IN THIS BUILD YET');
                return startSeamSolver(edges);
            }
            if (id === 'g3-blend') {
                if (!ctx.backend.edgeFaces || !ctx.backend.previewSplineSheet || !ctx.backend.undo) return ctx.toast('G3 BLEND IS NOT IN THIS BUILD YET');
                return startG3Blend(edges);
            }
            if (id === 'class-a-fit') {
                if (!ctx.backend.faceUvn || !ctx.backend.previewSplineSheet) return ctx.toast('CLASS-A FIT IS NOT IN THIS BUILD YET');
                return startClassAFit(faces);
            }
        },
        /** Seam numbers for the agent and MCP tools (no viewport). */
        measureEdges,
    };
}
