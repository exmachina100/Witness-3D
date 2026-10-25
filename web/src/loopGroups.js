// Pieces of loops (curves, edges) sorted into the loops they make, by where their ends meet. Each
// piece is { closed, ends: [a, b] } with a and b points ({ distanceTo }, as THREE.Vector3); a closed
// piece is a loop of its own.

/** The pieces in groups that touch end to end, in the order first met. */
export function groupLoops(pieces, tol = 1e-4) {
    const parent = pieces.map((_, i) => i);
    const root = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
    for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
        if (pieces[i].ends.some(a => pieces[j].ends.some(b => a.distanceTo(b) < tol))) parent[root(i)] = root(j);
    }
    const groups = new Map();
    pieces.forEach((p, i) => { const r = root(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p); });
    return [...groups.values()];
}

/** Whether a group closes: one closed piece, or open pieces whose every end meets exactly one other. */
export function closesUp(group, tol = 1e-4) {
    if (group.length === 1 && group[0].closed) return true;
    if (group.some(p => p.closed)) return false;
    const ends = group.flatMap(p => p.ends);
    return ends.every((a, i) => ends.filter((b, j) => j !== i && a.distanceTo(b) < tol).length === 1);
}
