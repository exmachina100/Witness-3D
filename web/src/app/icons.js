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
    'tangent-circle': `<path d="M2 20h20M4 4l16 0"/><circle ${A} cx="12" cy="12" r="8"/>`,
    circle3: `<circle cx="12" cy="12" r="8"/><path ${A} d="M4.5 9h0M15 4.6h0M17 18.2h0"/>`,
    line: `<path d="M4 18L20 6"/><path ${A} d="M4 18h0M20 6h0"/>`,
    arc3: `<path d="M4 17a9 9 0 0 1 16 0"/><path ${A} d="M4 17h0M12 9h0M20 17h0"/>`,
    arc: `<path d="M20 12a8 8 0 0 1-8 8"/><path ${A} d="M12 12h0M12 12h8M12 12v8"/>`,
    'tangent-arc': `<path d="M3 16h8"/><path ${A} d="M11 16a5 5 0 0 0 5-5V6"/>`,
    polygon: `<path d="M12 4l7 4v8l-7 4-7-4V8z"/><path ${A} d="M12 12h0M12 12V4"/>`,
    cv: `<path d="M3 18L8 5l8 14 5-12" stroke-dasharray="2 2"/><path ${A} d="M3 18c3-8 6-9 9-6s6 3 9-5"/>`,
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
    // Round 6 solids and patterns: the accent is the base point, the opening, or the copies made.
    box: `<path d="M4 8l8-4 8 4v9l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v9"/><path ${A} d="M4 17h0"/>`,
    'center-box': `<path d="M4 8l8-4 8 4v9l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v9"/><path ${A} d="M12 8h0M10 7l4 2"/>`,
    box3: `<path d="M4 8l8-4 8 4v9l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v9"/><path ${A} d="M4 17h0M12 21h0M20 17h0"/>`,
    cylinder: `<ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6"/><path ${A} d="M12 18h0M12 18h7"/>`,
    sphere: `<circle cx="12" cy="12" r="8"/><ellipse cx="12" cy="12" rx="8" ry="3"/><path ${A} d="M12 12h0"/>`,
    shell: `<path d="M4 8l8-4 8 4v9l-8 4-8-4z"/><path d="M7 9.5v6l5 2.5 5-2.5v-6"/><path ${A} d="M4 8l8 4 8-4-8-4z"/>`,
    mirror: `<path d="M12 2v20" stroke-dasharray="2 2"/><path d="M9 6L3 9v8l6 2z"/><path ${A} d="M15 6l6 3v8l-6 2z"/>`,
    'rect-array': `<rect x="3" y="3" width="7" height="7"/><rect ${A} x="14" y="3" width="7" height="7"/><rect ${A} x="3" y="14" width="7" height="7"/><rect ${A} x="14" y="14" width="7" height="7"/>`,
    // Curve Array: copies strung along a curve.
    'curve-array': `<path d="M3 18c4-10 14-10 18 0"/><rect ${A} x="2" y="15" width="4" height="4"/><rect ${A} x="10" y="7" width="4" height="4"/><rect ${A} x="18" y="15" width="4" height="4"/>`,
    'radial-array': `<circle cx="12" cy="12" r="1" /><rect x="10" y="2" width="4" height="5"/><path ${A} d="M17 10h5v4h-5zM10 17h4v5h-4zM2 10h5v4H2z"/>`,
    // Navigation (the viewport's top-right column).
    'nav-zoom': `<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5L20 20"/><path ${A} d="M10 7v6M7 10h6"/>`,
    'nav-pan': `<path d="M12 3v18M3 12h18"/><path ${A} d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>`,
    'nav-persp': `<path d="M8 6h8l4 12H4z"/><path ${A} d="M12 6v12"/>`,
    'nav-ortho': `<path d="M5 6h14v12H5z"/><path ${A} d="M12 6v12"/>`,
    'nav-focus': `<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><path ${A} d="M9 9h6v6H9z"/>`,
    'nav-home': `<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/><path ${A} d="M10 20v-6h4v6"/>`,
    // Round 7 curve editing: the accent is the curve made, or the piece cut away.
    'offset-curve': `<path d="M4 18V9a5 5 0 0 1 5-5h11"/><path ${A} d="M8 20v-9a3 3 0 0 1 3-3h9"/>`,
    'fillet-curve': `<path d="M4 20V4h16" stroke-dasharray="2 2"/><path ${A} d="M4 20v-9a7 7 0 0 1 7-7h9"/>`,
    trim: `<path d="M3 12h7M16 12h5M12 3v18"/><path ${A} d="M10 12h6" stroke-dasharray="2 2"/><path ${A} d="M8 8l8 8M16 8l-8 8"/>`,
    explode: `<path d="M5 5h5M14 5h5M19 10v4M5 10v4M5 19h5M14 19h5"/><path ${A} d="M12 12h0M10 10L8 8M14 10l2-2M10 14l-2 2M14 14l2 2"/>`,
    reverse: `<path d="M4 9h14"/><path ${A} d="M15 6l3 3-3 3"/><path d="M20 15H6"/><path ${A} d="M9 12l-3 3 3 3"/>`,
    split: `<path d="M3 17L10 10"/><path d="M14 7l7-4"/><path ${A} d="M12 8.5h0M10 6l4 5"/>`,
    measure: `<path d="M3 17L17 3l4 4L7 21z"/><path ${A} d="M7 13l2 2M10 10l2 2M13 7l2 2"/>`,
    extend: `<path d="M3 17L12 8"/><path ${A} d="M12 8l6-6" stroke-dasharray="2 2"/><path ${A} d="M15 2h3v3"/>`,
    bridge: `<path d="M2 18h6M16 6h6"/><path ${A} d="M8 18c5 0 3-12 8-12"/>`,
    hole: `<path d="M3 9l9-4 9 4-9 4z"/><path d="M3 9v8l9 4 9-4V9"/><ellipse ${A} cx="12" cy="9" rx="3" ry="1.4"/><path ${A} d="M9 9v6M15 9v6" stroke-dasharray="2 2"/>`,
    through: `<path d="M12 2v20" stroke-dasharray="2 2"/><path ${A} d="M8 8h8v8H8z"/>`,
    cut: `<path d="M3 9l6-3 6 3v9l-6 3-6-3z"/><path d="M3 9l6 3 6-3M9 12v9"/><path ${A} d="M17 10l4 2v8l-4 2"/><path ${A} d="M16 2v20" stroke-dasharray="2 2"/>`,
    project: `<path d="M3 15l9 4 9-4-9-4z"/><path d="M6 3c2 2 4 2 6 0s4-2 6 0"/><path d="M9 5v6M15 5v6" stroke-dasharray="2 2"/><path ${A} d="M6 14.4c2 1.6 4 1.6 6 0s4-1.6 6 0"/>`,
    // Two sheets with the bridge between them in the accent.
    'bridge-surface': `<path d="M2 16l6-3M16 13l6 3"/><path d="M2 12l6-3M16 9l6 3"/><path ${A} d="M8 13c3-2 5-2 8 0M8 9c3-2 5-2 8 0"/>`,
    // A sheet with its edge carried on past it in the accent, dashed where it is new.
    'extend-sheet': `<path d="M3 17l4-10h8l-4 10z"/><path ${A} d="M15 7h5l-4 10h-5" stroke-dasharray="2 2"/><path ${A} d="M17 12h4M19.5 10.5L21 12l-1.5 1.5"/>`,
    // A curved path, and the tube that runs along it in the accent.
    pipe: `<path d="M4 18c3 0 4-12 9-12s5 6 7 6" stroke-dasharray="1.5 1.5"/><path ${A} d="M3 15.5c3 0 4-12 9-12s6 6 9 6M5 20.5c3 0 4-12 9-12s4 6 6 6"/><ellipse ${A} cx="4" cy="18" rx="1" ry="2.5"/>`,
    // A curved sheet, and below it the slab it thickens into in the accent.
    thicken: `<path d="M3 8c4-3 14-3 18 0"/><path ${A} d="M3 13c4-3 14-3 18 0v4c-4-3-14-3-18 0z"/><path d="M12 6.5v4" stroke-dasharray="1.5 1.5"/>`,
    // A loop of curves with the sheet filling it, the sheet in the accent.
    patch: `<path d="M4 16c2-6 5-10 9-10s7 3 7 6-4 7-9 7-7-1-7-3z"/><path ${A} d="M7 15c2-4 4-6 6.5-6s4 2 4 3.5-2.5 4-5.5 4-5-.5-5-1.5z" style="fill: var(--accent); fill-opacity: .35"/>`,
    imprint: `<path d="M4 8l8-4 8 4v9l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v9"/><path ${A} d="M8 6l8 4"/>`,
    draft: `<path d="M3 21h18"/><path d="M6 21V7h12v14" stroke-dasharray="2 2"/><path ${A} d="M6 21l2-14h8l2 14"/><path d="M12 3v3"/>`,
    'remove-face': `<path d="M4 8l8-4 8 4v9l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v9"/><path ${A} d="M14 14l4 4M18 14l-4 4"/>`,
    suggest: `<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle ${A} cx="19" cy="12" r="1.5"/>`,
    // Selection modes (1–5): a cube with what each mode picks in the accent.
    'mode-point': `<path d="M4 8l8-4 8 4v9l-8 4-8-4z M4 8l8 4 8-4M12 12v9"/><circle ${A} cx="12" cy="12" r="2.6" style="fill: var(--accent)"/>`,
    'mode-edge': `<path d="M4 8l8-4 8 4v9l-8 4-8-4z M4 8l8 4 8-4M12 12v9"/><path ${A} d="M12 12v9"/>`,
    'mode-face': `<path d="M4 8l8-4 8 4v9l-8 4-8-4z M4 8l8 4 8-4M12 12v9"/><path ${A} d="M4 8l8-4 8 4-8 4z"/>`,
    'mode-solid': `<path ${A} d="M4 8l8-4 8 4v9l-8 4-8-4z M4 8l8 4 8-4M12 12v9"/>`,
    'mode-all': `<path d="M4 8l8-4 8 4v9l-8 4-8-4z M4 8l8 4 8-4M12 12v9"/><path ${A} d="M4 8l8-4 8 4-8 4zM12 12v9"/><circle ${A} cx="12" cy="21" r="1.4"/>`,
    undo: `<path d="M9 5L4 10l5 5"/><path ${A} d="M4 10h10a6 6 0 0 1 0 12h-3"/>`,
    redo: `<path d="M15 5l5 5-5 5"/><path ${A} d="M20 10H10a6 6 0 0 0 0 12h3"/>`,
    ask: `<path ${A} d="M12 3l2 7 7 2-7 2-2 7-2-7-7-2 7-2z"/>`,
    import: `<path d="M4 15v5h16v-5"/><path ${A} d="M12 3v12M8 11l4 4 4-4"/>`,
    export: `<path d="M4 15v5h16v-5"/><path ${A} d="M12 15V3M8 7l4-4 4 4"/>`,
    // A page with a box drawn on it, its far edges dashed.
    'export-drawing': `<path d="M5 3h10l4 4v14H5z"/><path ${A} d="M8 11l3-2h5v6l-3 2H8zM8 11h5v6M13 11l3-2"/>`,
    'hidden-lines': `<path d="M5 9h9v10H5z"/><path ${A} stroke-dasharray="2 2" d="M10 5h9v10h-5"/>`,
    'drawing-curves': `<path d="M4 18h16"/><path ${A} d="M4 15c4-10 8 4 16-8"/>`,
    'file-new': `<path d="M5 3h9l5 5v13H5z"/><path ${A} d="M12 11v6M9 14h6"/>`,
    'file-open': `<path d="M3 6h6l2 2h10v12H3z"/><path ${A} d="M3 11h18"/>`,
    'file-save': `<path d="M4 4h13l3 3v13H4z"/><path d="M8 4v5h7V4"/><path ${A} d="M8 20v-6h8v6"/>`,
    // Panel options.
    square: `<rect x="5" y="5" width="14" height="14"/><path ${A} d="M5 19L19 5"/>`,
    centre: `<rect x="4" y="6" width="16" height="12"/><path ${A} d="M12 9v6M9 12h6"/>`,
    knife: `<path d="M3 21L15 9l3 3L6 21z"/><path ${A} d="M15 9l4-4 2 2-3 5"/>`,
    // The VIEW chips: what each shows, with the accent on what the toggle adds.
    'view-edges': `<path d="M4 8l8-4 8 4v9l-8 4-8-4z"/><path ${A} d="M4 8l8 4 8-4M12 12v9"/>`,
    'view-faces': `<path d="M4 8l8-4 8 4v9l-8 4-8-4z"/><path ${A} d="M12 12l8-4v9l-8 4zM4 8l8 4v9l-8-4z"/>`,
    'view-xray': `<path d="M4 8l8-4 8 4v9l-8 4-8-4z"/><path ${A} d="M4 17l8-4 8 4M12 4v9" stroke-dasharray="2 2"/>`,
    'view-snap': `<path d="M6 4v8a6 6 0 0 0 12 0V4"/><path d="M6 4h4M14 4h4"/><path ${A} d="M6 8h4M14 8h4"/>`,
    'view-curvature': `<path d="M3 18c4-10 10-12 18-10"/><path ${A} d="M6 13l-2-3M9 10l-1-4M13 8.5l0-4M17 8l1-4"/>`,
    'view-draft': `<path d="M3 21h18"/><path d="M7 21l3-14h4l3 14"/><path ${A} d="M12 3v6M9.5 5.5L12 3l2.5 2.5"/>`,
    'view-zebra': `<circle cx="12" cy="12" r="9"/><path ${A} d="M5 7.5c4 1.5 10 1.5 14 0M3.2 12c5 2 12.6 2 17.6 0M5 16.5c4 1.5 10 1.5 14 0"/>`,
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
    // A slab leaning off its base along a dashed free direction, ending in a picked point.
    freestyle: `<path d="M2 20h10"/><path ${A} d="M2 20l7-11h10l-7 11"/><circle ${A} cx="19" cy="9" r="1.5"/>`,
    // A crosshair where the handle goes, and the handle's stem.
    pivot: `<circle cx="12" cy="12" r="6"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle ${A} cx="12" cy="12" r="2"/>`,
    // Two faces at an angle, each pushed along its own normal.
    individual: `<path d="M3 20l8-4V6L3 10z"/><path d="M11 6l10 4v10l-10-4"/><path ${A} d="M7 13l-4-2M16 13l4-6"/>`,
    // Sweep guide methods: the section touching the guide (point), a chord to it, a curve along it.
    'guide-point': `<path d="M4 20C8 12 14 8 20 4" stroke-dasharray="1.5 1.5"/><rect x="5" y="9" width="8" height="8"/><circle ${A} cx="13" cy="9" r="2"/>`,
    'guide-chord': `<path d="M4 20C8 12 14 8 20 4" stroke-dasharray="1.5 1.5"/><rect x="5" y="9" width="8" height="8"/><path ${A} d="M9 13l7-7"/>`,
    'guide-curve': `<path d="M4 20C8 12 14 8 20 4"/><path ${A} d="M4 16C7 10 12 6 17 3"/>`,
    // Alignment: the section turning with the path, or keeping its angle.
    'align-normal': `<path d="M4 20C4 10 10 4 20 4" stroke-dasharray="1.5 1.5"/><path ${A} d="M1 14h6M10 5l4 4"/>`,
    'align-parallel': `<path d="M4 20C4 10 10 4 20 4" stroke-dasharray="1.5 1.5"/><path ${A} d="M1 14h6M9 7h6"/>`,
    left: `<path d="M6 19c0 1.5 12 1.5 12 0s-12-2-12-4 12-2.5 12-4"/><path ${A} d="M10 6l-4 3 4 3"/>`,
    // Organising: a folder for groups, a padlock for locked bodies (shut and open), isolation as one
    // body lit inside a dashed frame of the others.
    folder: `<path d="M3 6h7l2 2h9v11H3z"/><path ${A} d="M3 11h18"/>`,
    group: `<rect x="3" y="3" width="18" height="18" stroke-dasharray="2 2"/><rect x="6" y="6" width="5" height="5"/><rect ${A} x="13" y="13" width="5" height="5"/>`,
    ungroup: `<rect x="3" y="3" width="8" height="8"/><rect ${A} x="13" y="13" width="8" height="8"/><path d="M14 4l6 6M20 4l-6 6"/>`,
    // Offset Face grow modes: a step side on, the block's wall pushed out past the ledge's end.
    // Align Vertex: scattered points brought onto one accent line.
    'insert-knot': `<path d="M3 17C7 5 11 5 13 11s6 7 8-2"/><path ${A} d="M12 4v4M10 6h4"/><path ${A} d="M12.4 10h0" stroke-width="3" stroke-linecap="round"/>`,
    'raise-degree': `<path d="M3 18C8 6 14 6 21 18"/><path ${A} d="M3 14C8 2 14 2 21 14" stroke-dasharray="2 2"/><path ${A} d="M12 9V5M10 7l2-2 2 2"/>`,
    // Reverse Sheet: a sheet with its normal flipped over.
    'reverse-sheet': `<path d="M4 14l8-4 8 4"/><path ${A} d="M12 10V3M9.5 5.5L12 3l2.5 2.5M12 12v8M9.5 17.5L12 20l2.5-2.5" stroke-dasharray="0"/>`,
    // Find Boundary Edges: a sheet with its open sides lit.
    'boundary-edges': `<path d="M4 8l8-4 8 4-8 4z" stroke-dasharray="2 2"/><path ${A} d="M4 8v8l8 4 8-4V8"/>`,
    unify: `<path d="M4 6h16v12H4z"/><path ${A} d="M12 6v12" stroke-dasharray="2 2"/><path ${A} d="M9 10l-2 2 2 2M15 10l2 2-2 2"/>`,
    'convert-vertex': `<path d="M3 18L12 5l9 13" stroke-dasharray="2 2"/><path ${A} d="M3 18C8 9 16 9 21 18"/><path ${A} d="M12 5h0" stroke-width="3" stroke-linecap="round"/>`,
    rebuild: `<path d="M3 17L7 6l6 9 4-8 4 2" stroke-dasharray="2 2"/><path ${A} d="M3 17C7 5 11 5 13 11s6 7 8-2"/>`,
    'align-vertex': `<path d="M6 5h0M17 8h0M8 19h0" stroke-width="3" stroke-linecap="round"/><path ${A} d="M12 3v18"/><path ${A} d="M12 12h0" stroke-width="3" stroke-linecap="round"/>`,
    'axis-x': `<path d="M4 20h16"/><path ${A} d="M8 6l8 8M16 6l-8 8"/>`,
    'axis-y': `<path d="M4 20h16"/><path ${A} d="M8 5l4 5 4-5M12 10v7"/>`,
    'axis-z': `<path d="M4 20h16"/><path ${A} d="M8 6h8l-8 10h8"/>`,
    'extend-natural': `<path d="M3 19a10 10 0 0 1 8-9"/><path ${A} d="M11 10a10 10 0 0 1 9 2" stroke-dasharray="2 2"/>`,
    'extend-linear': `<path d="M3 19a10 10 0 0 1 8-9"/><path ${A} d="M11 10l9-4" stroke-dasharray="2 2"/>`,
    // Offset Region combined: two overlapping outlines merged into one.
    combine: `<path d="M9 15a6 6 0 1 1 6-6" stroke-dasharray="2 2"/><path ${A} d="M9 15a6 6 0 0 1 6-6a6 6 0 1 1-6 6z"/><path ${A} d="M15 9a6 6 0 1 0-6 6"/>`,
    // Offset Region slot: a stadium round a line.
    slot: `<path d="M8 12h8"/><path ${A} d="M8 7h8a5 5 0 0 1 0 10H8a5 5 0 0 1 0-10z"/>`,
    'grow-moving': `<path d="M3 20V5h6v10h9v5z"/><path ${A} d="M9 5h12v15h-3M14 9l2 1.5-2 1.5"/>`,
    'grow-fixed': `<path d="M3 20V5h6v10h9v5z"/><path ${A} d="M9 5h9v10M20 4v16"/>`,
    'grow-none': `<path d="M3 20V5h6v10h9v5z"/><path ${A} d="M9 5h12v10h-3M14 9l2 1.5-2 1.5"/>`,
    padlock: `<rect x="5" y="11" width="14" height="10"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/><path ${A} d="M12 15v2"/>`,
    unlock: `<rect x="5" y="11" width="14" height="10"/><path d="M8 11V7a4 4 0 0 1 8 0"/><path ${A} d="M12 15v2"/>`,
    // Materials: a shaded ball, split in two for Fork, struck through for Remove.
    material: `<circle cx="12" cy="12" r="8"/><path ${A} d="M8 9a5 5 0 0 1 4-2"/>`,
    'fork-material': `<circle cx="8" cy="12" r="5"/><circle ${A} cx="16" cy="12" r="5"/>`,
    'remove-material': `<circle cx="12" cy="12" r="8"/><path ${A} d="M5 19L19 5"/>`,
    isolate: `<rect x="3" y="5" width="18" height="14" stroke-dasharray="2 2"/><rect ${A} x="8" y="8" width="8" height="8"/>`,
};

/** The icon for `name` as an inline SVG, or '' when there is none. */
export function icon(name) {
    const body = ICONS[name];
    return body ? `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>` : '';
}

export const iconNames = () => Object.keys(ICONS);
