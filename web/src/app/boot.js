// The loading screen, shown while the kernel starts (the browser build fetches OpenCascade first).
// The brand's W is drawn as its 13 pixels on a faint 5 × 5 construction grid; they fill in the
// accent one after another, as a toolpath would, and fade to start again. Below it, a thin line
// shows how far the download has got, or sweeps while that isn't known. All of it is CSS on plain
// elements, so nothing loads before it and it costs nothing once hidden.

// The W in Tiny5's pixels (the app icon): [column, row] in drawing order, down-left to up-right.
const W_CELLS = [[0, 0], [0, 1], [0, 2], [1, 3], [1, 4], [2, 2], [2, 1], [2, 0], [3, 3], [3, 4], [4, 2], [4, 1], [4, 0]];

/** The loading screen's markup: the W, a label and the progress line. */
export function bootHTML(label = 'LOADING KERNEL') {
  const grid = [];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) grid.push(`<i class="boot-cell" style="--c:${c};--r:${r}"></i>`);
  const px = W_CELLS.map(([c, r], k) => `<i class="boot-px" style="--c:${c};--r:${r};--k:${k}"></i>`).join('');
  return `<div class="boot" role="status" aria-live="polite">
    <div class="boot-mark" aria-hidden="true">${grid.join('')}${px}</div>
    <div class="boot-label"><span data-boot="label">${label}</span><span class="boot-cursor">_</span><span class="boot-pct" data-boot="pct"></span></div>
    <div class="boot-line" data-boot="line"><b data-boot="bar"></b></div>
  </div>`;
}

/**
 * How far the loading has got, 0 to 1, in every loading screen under `root`; null when unknown (the
 * line sweeps). `label` changes the words.
 */
export function bootProgress(root, f, label) {
  for (const el of root.querySelectorAll('.boot')) {
    const line = el.querySelector('[data-boot="line"]'), bar = el.querySelector('[data-boot="bar"]'), pct = el.querySelector('[data-boot="pct"]');
    const known = typeof f === 'number' && Number.isFinite(f);
    line.classList.toggle('known', known);
    bar.style.width = known ? `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%` : '';
    pct.textContent = known ? ` ${Math.round(Math.max(0, Math.min(1, f)) * 100)}%` : '';
    if (label) el.querySelector('[data-boot="label"]').textContent = label;
  }
}
