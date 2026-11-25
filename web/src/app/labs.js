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
import { FIT_TOLERANCE, classAFitFace, classAFitPoints } from '../classAFit.js';
import { scanPoints } from '../scanPoints.js';
import { planFaceLayout } from '../layoutPlanner.js';
import { labsSession } from '../labsTools.js';
import { runAgent } from '../labsAgent.js';

/** The LABS commands, by id: their dialog titles. */
export const LABS_NAMES = { 'seam-check': 'SEAM CHECK', 'seam-solver': 'SEAM SOLVER', 'g3-blend': 'G3 BLEND', 'class-a-fit': 'CLASS-A FIT', 'patch-layout': 'PATCH LAYOUT', 'labs-agent': 'SURFACING AGENT' };

/** The LABS commands' keys, as KEYS lists them for the key strip. */
export const LABS_KEYS = {
    'seam-check': [['CLICK', 'ADD AN EDGE'], ['ENTER', 'DONE'], ['ESC', 'DONE']],
    'seam-solver': [['TAB', 'CONTINUITY'], ['ENTER', 'KEEP AND MEASURE'], ['ESC', 'CANCEL']],
    'g3-blend': [['TAB', 'CONTINUITY'], ['ENTER', 'KEEP AND MEASURE'], ['ESC', 'CANCEL']],
    'class-a-fit': [['ENTER', 'KEEP THE PATCH'], ['ESC', 'CANCEL']],
    'patch-layout': [['ENTER', 'KEEP THE PATCHES'], ['ESC', 'CANCEL']],
    'labs-agent': [['CTRL+ENTER', 'RUN'], ['ENTER', 'KEEP ALL CHANGES'], ['ESC', 'DISCARD ALL CHANGES']],
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
      <button data-id="cf-load" title="Fit one patch to the points of a mesh or scan (OBJ or STL) instead of a face">LOAD SCAN…</button>
      <input data-id="cf-scan" type="file" accept=".obj,.stl" hidden>
      <span class="hint" data-id="cf-result" title="Degree, furthest distance from the face, inflections before and after">—</span>
    </div>
    <div class="sec" data-panel="patch-layout" hidden>
      <span class="hint" data-id="pl-hint">SELECT A FACE TO LAY OUT IN PATCHES</span>
      <div class="field" title="The furthest any patch may stand off the face"><label for="w3d-pl-tol">TOLERANCE</label><input id="w3d-pl-tol" data-id="pl-tol" type="number" step="0.01" min="0.001" value="0.05"></div>
      <div class="field" title="Cuts across the face's first direction, in % of the way along it (edit to move, add or remove cuts)"><label for="w3d-pl-s">CUTS U %</label><input id="w3d-pl-s" data-id="pl-s" type="text" value=""></div>
      <div class="field" title="Cuts across the face's second direction, in % of the way along it"><label for="w3d-pl-t">CUTS V %</label><input id="w3d-pl-t" data-id="pl-t" type="text" value=""></div>
      <button data-id="pl-auto" title="Plan the cuts again from the face's feature lines">PROPOSE AGAIN</button>
      <span class="hint" data-id="pl-result" title="Each patch: furthest distance from the face, inflections">—</span>
    </div>
    <div class="sec" data-panel="labs-agent" hidden>
      <span class="hint" data-id="ag-hint">SAY WHAT TO DO WITH THE SURFACES</span>
      <div class="ag-key" data-id="ag-keyrow" hidden>
        <span class="hint" data-id="ag-keynote">YOUR ANTHROPIC API KEY</span>
        <input data-id="ag-key" type="password" autocomplete="off" spellcheck="false" placeholder="PASTE YOUR ANTHROPIC API KEY" title="Your own key: kept on this computer (desktop) or in this tab only (browser), never in the file">
        <button data-id="ag-savekey" title="Keep the key and go on">SAVE KEY</button>
      </div>
      <textarea data-id="ag-prompt" rows="3" spellcheck="false" placeholder="E.G. MAKE THE SEAM BETWEEN THE TWO SHEETS G3 AND REPORT THE NUMBERS" title="What the agent should do; it measures with Seam Check before and after (Ctrl+Enter runs)"></textarea>
      <div class="seg" role="group" aria-label="Agent">
        <button data-id="ag-run" title="Run the agent on this request (Ctrl+Enter)">RUN</button>
        <button data-id="ag-stop" title="Stop after the step it is on" disabled>STOP</button>
        <button data-id="ag-keep" title="Keep every change the agent made (Enter)">KEEP</button>
        <button data-id="ag-discard" title="Undo every change the agent made (Escape)">DISCARD</button>
      </div>
      <div class="ag-sum" data-id="ag-sum" hidden></div>
      <details data-id="ag-logbox"><summary title="Every step the agent took and what it measured">STEP LOG</summary><ol class="ag-log" data-id="ag-log"></ol></details>
      <span class="hint" data-id="ag-steps" title="Changes the agent made in this session; each is one undo step">0 CHANGES</span>
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
        if (faces.length > 1) return ctx.toast('SELECT ONE FACE TO FIT');
        const target = faces.length ? { body: faces[0].body, face: faces[0].n } : null;
        const c = { id: 'class-a-fit', fair: true, fit: null, scan: null, sent: 0, shown: 0 };
        ctx.begin(c);
        ctx.setState('none');
        const buttons = () => { for (const btn of document.querySelectorAll('[data-cffair]')) btn.setAttribute('aria-pressed', String((btn.dataset.cffair === 'on') === c.fair)); };
        c.preview = () => {
            buttons();
            if (!target && !c.scan) { $('cf-hint').textContent = 'SELECT ONE FACE, OR LOAD A SCAN (OBJ OR STL)'; return; }
            $('cf-hint').textContent = 'FITTING…';
            ctx.livePreview(c, async () => {
                const options = { tolerance: +$('cf-tol').value || FIT_TOLERANCE, fair: c.fair };
                const r = c.scan ? classAFitPoints(c.scan.points, options) : await classAFitFace(ctx.backend, target, options);
                if (ctx.current() !== c) return null;
                c.fit = r;
                const what = c.scan ? `OFF ${r.points} SCAN POINTS` : 'OFF THE FACE';
                const text = `DEGREE ${r.degree} · ${r.deviation.toFixed(4)} mm ${what} · INFLECTIONS ${r.before ?? '—'} → ${r.inflections}`;
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
        $('cf-load').onclick = () => ctx.current() === c && $('cf-scan').click();
        $('cf-scan').onchange = async e => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file || ctx.current() !== c) return;
            try {
                c.scan = { name: file.name, points: scanPoints(new Uint8Array(await file.arrayBuffer()), file.name) };
                c.preview();
            } catch (err) { ctx.toast(ctx.say(err)); }
        };
        c.preview();
    }
    /**
     * Patch Layout: cuts proposed along the selected face's feature lines until every patch fits one
     * Class-A patch (layoutPlanner.js); the cuts are editable as percentages. Enter keeps the
     * patches as one sheet and measures the seams between them.
     */
    function startPatchLayout(faces) {
        if (faces.length !== 1) return ctx.toast('SELECT ONE FACE TO LAY OUT');
        const target = { body: faces[0].body, face: faces[0].n };
        const c = { id: 'patch-layout', cuts: null, made: null, sent: 0, shown: 0 };
        ctx.begin(c);
        ctx.setState('none');
        const pct = list => list.map(f => +(f * 100).toFixed(1)).join(', ');
        const parse = text => text.split(/[,\s]+/).filter(Boolean).map(Number).filter(v => v > 0 && v < 100).map(v => v / 100);
        c.preview = () => {
            $('pl-hint').textContent = c.cuts ? 'FITTING YOUR CUTS…' : 'PROPOSING CUTS ALONG THE FEATURE LINES…';
            ctx.livePreview(c, async () => {
                const r = await planFaceLayout(ctx.backend, target, { tolerance: +$('pl-tol').value || 0.05, ...(c.cuts ? { cuts: c.cuts } : {}) });
                if (ctx.current() !== c) return null;
                c.made = r;
                if (!c.cuts) { $('pl-s').value = pct(r.fractions[0]); $('pl-t').value = pct(r.fractions[1]); }
                const worst = Math.max(...r.patches.map(p => p.deviation));
                $('pl-result').textContent = r.patches.map((p, i) => `${i + 1}: ${p.deviation.toFixed(3)} mm${p.inflections ? ` · ${p.inflections} INFL` : ''}`).join(' · ');
                $('pl-hint').textContent = `${r.patches.length} PATCH${r.patches.length > 1 ? 'ES' : ''} · WORST ${worst.toFixed(4)} mm ${r.plan.ok ? '✓' : '✗ (ADD A CUT OR RAISE THE TOLERANCE)'} · ENTER KEEPS THEM`;
                const [first, ...more] = r.data;
                return ctx.backend.previewSplineSheet({ data: first, more });
            }, sheet => ctx.showPreviewBody(sheet), 'pl-hint');
        };
        c.finish = async () => {
            if (!c.made) return ctx.toast($('pl-hint').textContent);
            try {
                const [first, ...more] = c.made.data;
                const { ids: [id], scene } = await ctx.backend.commitSplineSheet({ data: first, more });
                ctx.endCmd('committed');
                ctx.record(`PATCH LAYOUT ${c.made.patches.length} PATCHES`, id, `WORST ${Math.max(...c.made.patches.map(p => p.deviation)).toFixed(4)} mm`);
                await ctx.showScene(scene);
                // The seams between the patches: the body's edges two of its faces share.
                const seams = [];
                const edges = scene.find(b => b.id === id)?.edges ?? [];
                for (let n = 0; n < edges.length; n++) {
                    try { seams.push(await checkSeam(ctx.backend, { body: id, edge: n }, { g3: false })); } catch { /* a free edge */ }
                }
                const worstAngle = seams.reduce((w, r) => Math.max(w, r.worst.angle), 0), worstGap = seams.reduce((w, r) => Math.max(w, r.worst.gap), 0);
                lastLayout = { body: id, patches: c.made.patches.map(p => ({ deviation: p.deviation, inflections: p.inflections })), seams: seams.map(r => r.worst) };
                ctx.setHud(`PATCH LAYOUT · ${c.made.patches.length} PATCHES · ${seams.length} SEAMS · WORST GAP ${worstGap.toFixed(4)} mm · WORST ANGLE ${worstAngle.toFixed(3)}°`);
            } catch (e) { ctx.setState('failed'); ctx.toast(ctx.say(e)); }
        };
        c.abort = () => ctx.endCmd('cancelled');
        c.cleanup = () => ctx.clearPreview();
        const edited = () => { if (ctx.current() !== c) return; c.cuts = [parse($('pl-s').value), parse($('pl-t').value)]; c.preview(); };
        $('pl-s').onchange = edited;
        $('pl-t').onchange = edited;
        $('pl-tol').onchange = () => ctx.current() === c && c.preview();
        $('pl-auto').onclick = () => { if (ctx.current() === c) { c.cuts = null; c.preview(); } };
        $('pl-s').value = '';
        $('pl-t').value = '';
        c.preview();
    }
    /**
     * The surfacing agent (labsAgent.js): Claude works through a request with the LABS tools on this
     * model, with the user's own key. Every change is an undo step of its session: KEEP leaves them,
     * DISCARD (or Escape) undoes all of them.
     */
    /** A tool's result in one short line for the transcript (the model gets the whole JSON). */
    const brief = r => {
        if (typeof r === 'string') return r;
        if (r?.error) return `ERROR · ${r.error}`;
        const seam = x => `${x.level} · GAP ${x.gap_mm} mm · ${x.angle_deg}° · G2 ${x.g2_pct ?? '—'}% · G3 ${x.g3_pct ?? '—'}%`;
        if (r?.bodies) return `${r.bodies.length} BOD${r.bodies.length === 1 ? 'Y' : 'IES'}`;
        if (r?.level) return seam(r);
        if (r?.seams) return `BODY ${r.body} · ${r.seams.map(seam).join(' | ')}`;
        if (r?.after) return `MOVED ${r.moved_points} POINTS · BEFORE ${seam(r.before)} → AFTER ${seam(r.after)}`;
        if (r?.degree) return `BODY ${r.body} · DEGREE ${r.degree} · ${r.deviation_mm} mm · INFLECTIONS ${r.inflections_before ?? '—'} → ${r.inflections_after}`;
        if (r?.patches) return `BODY ${r.body} · ${r.patches.length} PATCHES · WORST ${Math.max(...r.patches.map(x => x.deviation_mm))} mm`;
        const t = JSON.stringify(r);
        return t.length > 160 ? `${t.slice(0, 160)}…` : t;
    };
    /** Tool names as the user knows the commands. */
    const TOOL_LABEL = { describe_model: 'LOOKING AT THE MODEL', seam_check: 'SEAM CHECK', seam_solve: 'SEAM SOLVER', g3_blend: 'G3 BLEND', class_a_fit: 'CLASS-A FIT', patch_layout: 'PATCH LAYOUT', undo_last: 'UNDOING ITS LAST STEP', capture_view: 'LOOKING AT THE VIEW' };
    const TARGET_CHIPS = [['g0', 'GAP'], ['g1', 'ANGLE'], ['g2', 'G2'], ['g3', 'G3'], ['highlight', 'HIGHLIGHT']];
    /** Seam results inside a tool result, with the edges they belong to (for the viewport and the summary). */
    function seamsOf(name, args, r) {
        if (!r || r.error) return [];
        if (name === 'seam_check' && r.level) return [{ label: `B${args.body} E${args.edge}`, edges: [[args.body, args.edge], ...(args.other_body !== undefined ? [[args.other_body, args.other_edge]] : [])], after: r }];
        if (name === 'seam_solve' && r.after) return [{ label: `B${args.target_body} E${args.target_edge}`, edges: [[args.target_body, args.target_edge], [args.reference_body, args.reference_edge]], before: r.before, after: r.after }];
        if (name === 'g3_blend' && r.seams) return r.seams.map((x, k) => { const e = k ? [args.b_body, args.b_edge] : [args.a_body, args.a_edge]; return { label: `${k ? 'END B' : 'END A'} B${e[0]} E${e[1]}`, edges: [e], after: x }; });
        return [];
    }
    /** The seams' edges lit on the model: green when every target is met, orange G2/G3 misses, red gap or angle. */
    function lightSeams(seams) {
        ctx.clearPreview();
        for (const sm of seams) {
            const ok = sm.after.ok ?? {}, colour = ok.g0 && ok.g1 ? (ok.g2 && ok.g3 !== false ? COLOURS.ok : COLOURS.soft) : COLOURS.bad;
            for (const [body, n] of sm.edges) {
                const e = ctx.bodyOf(body)?.edges[n];
                if (!e || e.length < 6) continue;
                // Dots along the edge, as Seam Check draws its samples: they read at any line width.
                const pts = [];
                const step = Math.max(3, Math.floor(e.length / 3 / 80) * 3);
                for (let i = 0; i < e.length; i += step) pts.push(e[i], e[i + 1], e[i + 2]);
                const g = new THREE.BufferGeometry();
                g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
                const dots = new THREE.Points(g, new THREE.PointsMaterial({ color: colour, size: 6, sizeAttenuation: false, depthTest: false }));
                dots.renderOrder = 12;
                ctx.previewGroup.add(dots);
            }
        }
    }
    /** The status strip over the viewport: the step it is on, a bar, and the last seam's targets. */
    function strip({ now = '', progress = 0, busy = false, seam = null } = {}) {
        const el = $('ag-strip');
        if (!el) return;
        if (now === null) { el.hidden = true; return; }
        el.hidden = false;
        el.toggleAttribute('data-busy', busy);
        const chips = TARGET_CHIPS.map(([k, l]) => `<span class="ag-chip" data-ok="${seam ? String(seam.ok?.[k] ?? 'none') : 'none'}">${l}</span>`).join('');
        el.innerHTML = `<div class="row"><span>AGENT</span><span class="now"></span>${chips}</div><div class="bar"><i style="width:${Math.round(progress * 100)}%"></i></div>`;
        el.querySelector('.now').textContent = now;
    }
    /** The card at the end: each seam before and after, against every target, and one verdict. */
    function summary(seams, fits) {
        const el = $('ag-sum');
        const last = new Map();
        for (const sm of seams) { const was = last.get(sm.label); last.set(sm.label, { ...sm, before: sm.before ?? was?.before ?? was?.after ?? null }); }
        const rows = [...last.values()];
        if (!rows.length && !fits.length) { el.hidden = true; return; }
        const cell = (v, ok, unit) => `<td data-ok="${ok}">${v ?? '—'}${v === null || v === undefined ? '' : unit}</td>`;
        const all = rows.every(r => Object.values(r.after.ok ?? {}).every(Boolean)) && fits.every(f => f.ok);
        el.hidden = false;
        el.innerHTML = `<div class="verdict" data-ok="${all}">${all ? 'EVERY TARGET MET' : 'SOME TARGETS MISSED'}</div>
          ${rows.length ? `<table><tr><th>SEAM</th><th>GAP mm</th><th>ANGLE °</th><th>G2 %</th><th>G3 %</th><th>BEFORE</th></tr>${rows.map(r => `<tr><td></td>${cell(r.after.gap_mm, r.after.ok?.g0, '')}${cell(r.after.angle_deg, r.after.ok?.g1, '')}${cell(r.after.g2_pct, r.after.ok?.g2, '')}${cell(r.after.g3_pct, r.after.ok?.g3, '')}<td>${r.before ? `${r.before.level} ${r.before.gap_mm}/${r.before.angle_deg}°` : 'NEW'}</td></tr>`).join('')}</table>` : ''}
          ${fits.map(f => `<div data-ok="${f.ok}">${f.text}</div>`).join('')}`;
        el.querySelectorAll('tr td:first-child').forEach((td, i) => { td.textContent = rows[i].label; });
    }
    async function startAgent() {
        const c = { id: 'labs-agent', running: false, stop: false, session: null, seams: [], fits: [], calls: 0 };
        ctx.begin(c);
        ctx.setState('none');
        const log = (kind, text) => {
            const li = document.createElement('li');
            li.dataset.kind = kind;
            li.textContent = text;
            $('ag-log').append(li);
            li.scrollIntoView?.({ block: 'nearest' });
        };
        const steps = () => {
            const n = c.session?.steps ?? 0;
            $('ag-steps').textContent = `${n} CHANGE${n === 1 ? '' : 'S'}${n ? ' · ' + c.session.log.join(' · ').toUpperCase() : ''}`;
        };
        const buttons = () => {
            $('ag-run').disabled = c.running;
            $('ag-stop').disabled = !c.running;
            $('ag-keep').disabled = $('ag-discard').disabled = c.running;
        };
        const keyRow = async () => {
            const has = await ctx.ai.hasKey();
            $('ag-keyrow').hidden = has;
            $('ag-keynote').textContent = ctx.ai.keyNote();
            return has;
        };
        c.session = labsSession(ctx.backend, {
            scene: ctx.scene(),
            onScene: list => ctx.showScene(list),
            onCommit: (what, id) => { ctx.record(`AGENT · ${what.toUpperCase().replace(/_/g, ' ')}`, id ?? undefined); steps(); },
            onUndo: () => { ctx.dropStep(); steps(); },
        });
        c.run = async () => {
            const prompt = $('ag-prompt').value.trim();
            if (c.running || !prompt) return;
            let done;
            c.finished = new Promise(r => { done = r; });
            if (!(await keyRow())) { $('ag-hint').textContent = 'ADD YOUR API KEY FIRST'; return $('ag-key').focus(); }
            c.running = true; c.stop = false; buttons();
            ctx.setState('updating');
            $('ag-hint').textContent = 'WORKING…';
            log('you', prompt);
            c.seams = []; c.fits = []; c.calls = 0;
            $('ag-sum').hidden = true;
            strip({ now: 'THINKING…', busy: true, progress: 0.05 });
            let lastSeam = null, pending = null;
            try {
                const send = await ctx.ai.sender();
                const stoppable = body => { if (c.stop) throw new Error('stopped'); return send(body); };
                c.session.scene = ctx.scene();
                const r = await runAgent({
                    send: stoppable, session: c.session, prompt, capture: ctx.capture,
                    onEvent: ev => {
                        if (ctx.current() !== c) return;
                        if (ev.kind === 'tool') {
                            log('tool', `${ev.name.toUpperCase().replace(/_/g, ' ')} ${JSON.stringify(ev.args ?? {})}`);
                            pending = ev;
                            c.calls++;
                            strip({ now: `STEP ${c.calls} · ${TOOL_LABEL[ev.name] ?? ev.name.toUpperCase()}…`, busy: true, progress: Math.min(0.95, 0.1 + c.calls / 10), seam: lastSeam });
                        } else if (ev.kind === 'result') {
                            log('result', brief(ev.result));
                            const found = seamsOf(ev.name, pending?.args ?? {}, ev.result);
                            if (found.length) { c.seams.push(...found); lastSeam = found[found.length - 1].after; lightSeams(found); }
                            if (ev.name === 'class_a_fit' && ev.result?.degree) c.fits.push({ ok: ev.result.deviation_mm <= FIT_TOLERANCE, text: `CLASS-A FIT · BODY ${ev.result.body} · DEGREE ${ev.result.degree} · ${ev.result.deviation_mm} mm · INFLECTIONS ${ev.result.inflections_before ?? '—'} → ${ev.result.inflections_after}` });
                            if (ev.name === 'patch_layout' && ev.result?.patches) c.fits.push({ ok: !!ev.result.ok, text: `PATCH LAYOUT · BODY ${ev.result.body} · ${ev.result.patches.length} PATCHES · WORST ${Math.max(...ev.result.patches.map(x => x.deviation_mm))} mm` });
                            if ((ev.name === 'class_a_fit' || ev.name === 'patch_layout') && ev.result?.body !== undefined) {
                                const edges = ctx.bodyOf(ev.result.body)?.edges ?? [];
                                lightSeams([{ edges: edges.map((_, n) => [ev.result.body, n]), after: { ok: { g0: c.fits.at(-1)?.ok, g1: c.fits.at(-1)?.ok, g2: true } } }]);
                            }
                            if (ev.name === 'undo_last') { c.seams.pop(); ctx.clearPreview(); }
                            strip({ now: `STEP ${c.calls} · ${brief(ev.result)}`, busy: true, progress: Math.min(0.95, 0.1 + c.calls / 10), seam: lastSeam });
                        }
                        else if (ev.kind === 'text' || ev.kind === 'error') log(ev.kind, ev.text ?? ev.error);
                    },
                });
                $('ag-hint').textContent = `DONE IN ${r.turns} TURN${r.turns === 1 ? '' : 'S'} · ENTER KEEPS, ESC DISCARDS`;
                summary(c.seams, c.fits);
                strip({ now: `DONE · ${c.session.steps} CHANGE${c.session.steps === 1 ? '' : 'S'} · ${c.calls} STEPS · ENTER KEEPS, ESC DISCARDS`, progress: 1, seam: lastSeam });
                ctx.setState('updated');
            } catch (e) {
                if (e?.status === 401) { await ctx.ai.forgetKey(); await keyRow(); $('ag-hint').textContent = 'THAT KEY WAS NOT ACCEPTED'; }
                else $('ag-hint').textContent = e?.message === 'stopped' ? 'STOPPED · ENTER KEEPS, ESC DISCARDS' : ctx.say(e);
                ctx.setState(e?.message === 'stopped' ? 'updated' : 'failed');
                if (e?.message !== 'stopped') log('error', $('ag-hint').textContent);
                summary(c.seams, c.fits);
                strip({ now: $('ag-hint').textContent, progress: 1, seam: lastSeam });
            } finally { c.running = false; done(); if (ctx.current() === c) { buttons(); steps(); } }
        };
        c.finish = () => {
            if (c.running) return ctx.toast('THE AGENT IS STILL WORKING; STOP IT FIRST');
            c.session.keep();
            ctx.endCmd(null);
        };
        c.abort = async () => {
            c.stop = true;
            // A step in flight goes in first, so the rollback takes it back too.
            if (c.running) await c.finished;
            const undo = c.session.steps;
            await c.session.rollback();
            ctx.endCmd(null);
            if (undo) ctx.toast(`DISCARDED ${undo} AGENT CHANGE${undo === 1 ? '' : 'S'}`);
        };
        c.cleanup = () => { ctx.clearPreview(); strip({ now: null }); };
        $('ag-log').innerHTML = '';
        $('ag-sum').hidden = true;
        $('ag-run').onclick = () => ctx.current() === c && c.run();
        $('ag-stop').onclick = () => { if (ctx.current() === c) { c.stop = true; $('ag-hint').textContent = 'STOPPING AFTER THIS STEP…'; } };
        $('ag-keep').onclick = () => ctx.current() === c && c.finish();
        $('ag-discard').onclick = () => ctx.current() === c && c.abort();
        $('ag-prompt').onkeydown = e => {
            e.stopPropagation();
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); c.run(); }
            else if (e.key === 'Escape') { e.preventDefault(); $('ag-prompt').blur(); }
        };
        const save = async () => {
            const k = $('ag-key').value.trim();
            if (!k) return;
            await ctx.ai.saveKey(k);
            $('ag-key').value = '';
            await keyRow();
            $('ag-hint').textContent = 'KEY SAVED · SAY WHAT TO DO';
            $('ag-prompt').focus();
        };
        $('ag-savekey').onclick = () => ctx.current() === c && save();
        $('ag-key').onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); save(); } };
        buttons(); steps();
        await keyRow();
        $('ag-prompt').focus();
    }
    let lastSolve = null, lastBlend = null, lastFit = null, lastLayout = null;

    return {
        has: id => id in LABS_NAMES,
        /** The last Seam Solver result's Seam Check, for the agent. */
        lastSolve: () => lastSolve,
        /** The last G3 Blend's two Seam Checks, for the agent. */
        lastBlend: () => lastBlend,
        /** The last Class-A Fit kept, for the agent. */
        lastFit: () => lastFit,
        /** The last Patch Layout kept: patches and the seams between them, for the agent. */
        lastLayout: () => lastLayout,
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
            if (id === 'patch-layout') {
                if (!ctx.backend.faceUvn || !ctx.backend.previewSplineSheet) return ctx.toast('PATCH LAYOUT IS NOT IN THIS BUILD YET');
                return startPatchLayout(faces);
            }
            if (id === 'labs-agent') {
                if (!ctx.ai || !ctx.backend.undo) return ctx.toast('THE AGENT IS NOT IN THIS BUILD YET');
                return startAgent();
            }
        },
        /** Seam numbers for the agent and MCP tools (no viewport). */
        measureEdges,
    };
}
