// Plasticity's Ctrl+T / Ctrl+Shift+T: select the source objects of the last operation, then of
// the ones before it (and back again). Each history step keeps the selection its command began
// with; this picks which step a press lands on.

/**
 * The index of the next step with sources, going back (dir -1) or forward (dir +1) from `at`
 * (null: start from the newest), among the first `live` steps (undone ones left out); null at the end.
 */
export function stepSources(steps, live, at, dir) {
    let i = at === null || at === undefined ? (dir < 0 ? live : -1) : at;
    for (i += dir; i >= 0 && i < live; i += dir) if (steps[i]?.sources?.length) return i;
    return null;
}
