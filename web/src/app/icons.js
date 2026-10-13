// Witness 3D's own tool icons, shared by the browser and desktop builds. Each is a 24 × 24 line
// drawing in the current text colour, thin square-ended strokes as in the mockups, with the orange
// accent marking what the tool acts on or makes. They show the same idea Plasticity's toolbar
// shows for each tool (a face pushed up for Extrude, a rounded corner for Fillet), drawn fresh.

const A = 'class="ac"'; // the accent stroke

const ICONS = {
    search: `<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/>`,
    rect: `<rect x="4" y="6" width="16" height="12"/><path ${A} d="M4 6h0M20 18h0"/>`,
    'center-rect': `<rect x="4" y="6" width="16" height="12"/><path ${A} d="M12 12h0M12 12l8 6"/>`,
    rect3: `<path d="M4 15l10-9 6 7-10 9z"/><path ${A} d="M4 15l10-9"/>`,
    circle: `<circle cx="12" cy="12" r="8"/><path ${A} d="M12 12h0M12 12h8"/>`,
    circle2: `<circle cx="12" cy="12" r="8"/><path ${A} d="M4 12h16"/>`,
    circle3: `<circle cx="12" cy="12" r="8"/><path ${A} d="M4.5 9h0M15 4.6h0M17 18.2h0"/>`,
    line: `<path d="M4 18L20 6"/><path ${A} d="M4 18h0M20 6h0"/>`,
    arc3: `<path d="M4 17a9 9 0 0 1 16 0"/><path ${A} d="M4 17h0M12 9h0M20 17h0"/>`,
    arc: `<path d="M20 12a8 8 0 0 1-8 8"/><path ${A} d="M12 12h0M12 12h8M12 12v8"/>`,
    'tangent-arc': `<path d="M3 16h8"/><path ${A} d="M11 16a5 5 0 0 0 5-5V6"/>`,
    polygon: `<path d="M12 4l7 4v8l-7 4-7-4V8z"/><path ${A} d="M12 12h0M12 12V4"/>`,
    spline: `<path d="M3 16c3-9 6-9 9-4s6 5 9-4"/><path ${A} d="M3 16h0M12 12h0M21 8h0"/>`,
    ellipse: `<ellipse cx="12" cy="12" rx="9" ry="5"/><path ${A} d="M12 12h0M12 12h9"/>`,
    ellipse3: `<ellipse cx="12" cy="12" rx="9" ry="5"/><path ${A} d="M3 12h18"/>`,
    spiral: `<path d="M6 19c0 1.5 12 1.5 12 0s-12-2-12-4 12-2.5 12-4-12-2-12-4 12-2.5 12-4"/><path ${A} d="M12 21V3"/>`,
    join: `<path d="M3 16l7-7"/><path d="M10 9c4-3 8-1 10 4"/><path ${A} d="M10 9h0"/>`,
    extrude: `<path d="M4 17l6 3 10-4-6-3z"/><path ${A} d="M12 15V4M8.5 7.5L12 4l3.5 3.5"/>`,
    boolean: `<rect x="3" y="3" width="11" height="11"/><rect ${A} x="10" y="10" width="11" height="11"/>`,
    fillet: `<path d="M4 20V10a6 6 0 0 1 6-6h10"/><path ${A} d="M4 10a6 6 0 0 1 6-6"/>`,
    move: `<path d="M12 3v18M3 12h18"/><path ${A} d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>`,
    rotate: `<path d="M19 12a7 7 0 1 1-2.1-5"/><path ${A} d="M17 2.5V7h-4.5"/>`,
    scale: `<rect x="3" y="11" width="10" height="10"/><path d="M3 3h18v18" stroke-dasharray="2 2"/><path ${A} d="M10 14l9-9M14 5h5v5"/>`,
    duplicate: `<rect x="3" y="8" width="13" height="13"/><rect ${A} x="8" y="3" width="13" height="13"/>`,
    delete: `<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/><path ${A} d="M10 11v6M14 11v6"/>`,
    offset: `<path d="M3 15l7-3 11 3-7 4z"/><path d="M3 15v4l11 4 7-4v-4" stroke-dasharray="2 2"/><path ${A} d="M12 13V3M9 6l3-3 3 3"/>`,
    revolve: `<path d="M12 2v20" stroke-dasharray="2 2"/><path d="M12 6h5v8h-5"/><path ${A} d="M7 9a6 3 0 1 0 2-1.5M9 5v2.5H6.5"/>`,
    loft: `<ellipse cx="12" cy="5" rx="5" ry="2"/><rect x="4" y="16" width="16" height="5"/><path ${A} d="M7 5l-3 11M17 5l3 11"/>`,
    sweep: `<circle cx="5" cy="17" r="3"/><path ${A} d="M5 14c3-9 9-11 15-8"/>`,
    undo: `<path d="M9 5L4 10l5 5"/><path ${A} d="M4 10h10a6 6 0 0 1 0 12h-3"/>`,
    redo: `<path d="M15 5l5 5-5 5"/><path ${A} d="M20 10H10a6 6 0 0 0 0 12h3"/>`,
    ask: `<path ${A} d="M12 3l2 7 7 2-7 2-2 7-2-7-7-2 7-2z"/>`,
    import: `<path d="M4 15v5h16v-5"/><path ${A} d="M12 3v12M8 11l4 4 4-4"/>`,
    export: `<path d="M4 15v5h16v-5"/><path ${A} d="M12 15V3M8 7l4-4 4 4"/>`,
    'file-new': `<path d="M5 3h9l5 5v13H5z"/><path ${A} d="M12 11v6M9 14h6"/>`,
    'file-open': `<path d="M3 6h6l2 2h10v12H3z"/><path ${A} d="M3 11h18"/>`,
    'file-save': `<path d="M4 4h13l3 3v13H4z"/><path d="M8 4v5h7V4"/><path ${A} d="M8 20v-6h8v6"/>`,
    // Panel options.
    square: `<rect x="5" y="5" width="14" height="14"/><path ${A} d="M5 19L19 5"/>`,
    centre: `<rect x="4" y="6" width="16" height="12"/><path ${A} d="M12 9v6M9 12h6"/>`,
    vertical: `<path d="M3 18l9-4 9 4"/><path ${A} d="M12 14V3M8 6h8"/>`,
    circumscribed: `<circle cx="12" cy="12" r="6.5"/><path ${A} d="M12 3.5l7.4 4.25v8.5L12 20.5l-7.4-4.25v-8.5z"/>`,
    fewer: `<path ${A} d="M6 9l6 6 6-6"/>`,
    more: `<path ${A} d="M6 15l6-6 6 6"/>`,
    union: `<path ${A} d="M3 3h11v7h7v11H10v-7H3z"/>`,
    difference: `<path d="M10 10h11v11H10z" stroke-dasharray="2 2"/><path ${A} d="M3 3h11v7h-4v4H3z"/>`,
    intersect: `<path d="M3 3h11v11H3zM10 10h11v11H10z" stroke-dasharray="2 2"/><path ${A} d="M10 10h4v4h-4z"/>`,
    slice: `<path d="M3 3h11v11H3z"/><path ${A} d="M10 10h11v11H10z"/><path d="M10 14h4v-4"/>`,
    new: `<rect x="5" y="5" width="14" height="14"/><path ${A} d="M12 9v6M9 12h6"/>`,
    keep: `<rect x="3" y="3" width="11" height="11"/><rect x="10" y="10" width="11" height="11" stroke-dasharray="2 2"/><path ${A} d="M13 17l2 2 4-4"/>`,
    lock: `<path d="M12 3v18"/><path ${A} d="M8 7l4-4 4 4M8 17l4 4 4-4"/>`,
    left: `<path d="M6 19c0 1.5 12 1.5 12 0s-12-2-12-4 12-2.5 12-4"/><path ${A} d="M10 6l-4 3 4 3"/>`,
};

/** The icon for `name` as an inline SVG, or '' when there is none. */
export function icon(name) {
    const body = ICONS[name];
    return body ? `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>` : '';
}

export const iconNames = () => Object.keys(ICONS);
