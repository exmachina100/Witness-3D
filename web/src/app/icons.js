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
    'cut-curve': `<path d="M3 15c4-6 8-6 12 0s4 3 6 1"/><path ${A} d="M12 3v18"/><path ${A} d="M12 10.5h0" stroke-width="3.5" stroke-linecap="round"/>`,
    'view-screen': `<rect x="3" y="5" width="18" height="12"/><path d="M9 21h6"/><path ${A} d="M12 8v6M9.5 11.5L12 14l2.5-2.5"/>`,
    trim: `<path d="M3 12h7M16 12h5M12 3v18"/><path ${A} d="M10 12h6" stroke-dasharray="2 2"/><path ${A} d="M8 8l8 8M16 8l-8 8"/>`,
    explode: `<path d="M5 5h5M14 5h5M19 10v4M5 10v4M5 19h5M14 19h5"/><path ${A} d="M12 12h0M10 10L8 8M14 10l2-2M10 14l-2 2M14 14l2 2"/>`,
    reverse: `<path d="M4 9h14"/><path ${A} d="M15 6l3 3-3 3"/><path d="M20 15H6"/><path ${A} d="M9 12l-3 3 3 3"/>`,
    split: `<path d="M3 17L10 10"/><path d="M14 7l7-4"/><path ${A} d="M12 8.5h0M10 6l4 5"/>`,
    measure: `<path d="M3 17L17 3l4 4L7 21z"/><path ${A} d="M7 13l2 2M10 10l2 2M13 7l2 2"/>`,
    extend: `<path d="M3 17L12 8"/><path ${A} d="M12 8l6-6" stroke-dasharray="2 2"/><path ${A} d="M15 2h3v3"/>`,
    bridge: `<path d="M2 18h6M16 6h6"/><path ${A} d="M8 18c5 0 3-12 8-12"/>`,
    // Two body corners with the curve between points on their edges.
    'align-curve': `<path d="M2 18c4 0 7-2 9-6"/><path ${A} d="M13 9c2-3 5-4 9-4"/><path d="M11 12h0" stroke-width="3.5" stroke-linecap="round"/><path ${A} d="M18 13l-4-2 1 4"/>`,
    'align-surface': `<path d="M2 20l4-8h7l-4 8z"/><path d="M15 6c2 0 3 3 7 3"/><path d="M13 12c1-3 1-6 2-6"/><path ${A} d="M18 15l-3-3m0 0v3m0-3h3"/>`,
    // A sheet bellied through three clicked points.
    'constrained-surface': `<path d="M2 17c3-5 6-7 10-7s7 2 10 7"/><path d="M2 17l3 4h14l3-4"/><path ${A} d="M6 13h0M12 10h0M18 13h0" stroke-width="3.5" stroke-linecap="round"/>`,
    // Four sides with the sheet's isoparms across them.
    square: `<path d="M3 6c6-3 12-3 18 0M3 6c-1 5 0 9 1 13M21 6c1 5 0 9-1 13M4 19c5 2 11 2 16 0"/><path ${A} d="M9 5v15M15 5v15M3.5 11h17" stroke-dasharray="2 2"/>`,
    'bridge-edge': `<path d="M2 21v-6l4-3h4v6l-4 3z"/><path d="M14 3h4l4 3v6h-4l-4-3z"/><path ${A} d="M10 15c3 0 1-9 4-9"/><path ${A} d="M10 15h0M14 6h0" stroke-width="3.5" stroke-linecap="round"/>`,
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
    'view-curves': `<path d="M3 17C6 7 10 7 12 12s6 5 9-5"/><circle cx="3" cy="17" r="1.2"/><circle ${A} cx="21" cy="7" r="1.2"/>`,
    'view-render': `<circle cx="12" cy="13" r="7"/><path ${A} d="M8.5 10.5a4 4 0 0 1 3.5-2"/><path d="M12 3v1.5M5 6l1 1M19 6l-1 1"/>`,
    // Section Analysis: a block sliced, its cut face showing.
    'view-section': `<path d="M4 9l6-4 10 4v8l-6 4-10-4z"/><path ${A} d="M12 4v17M8 6.5l8 3.2v8"/>`,
    'section-selection': `<path d="M4 8h16v10H4z"/><path ${A} d="M4 8l4-4h16l-4 4" /><path ${A} d="M12 10v6"/>`,
    'section-previous': `<path d="M5 12a7 7 0 1 0 2-5"/><path ${A} d="M4 4v4h4"/>`,
    'section-cplane': `<path d="M3 15l6-6h12l-6 6z"/><path ${A} d="M12 4v16"/>`,
    flip: `<path d="M12 3v18" stroke-dasharray="2 2"/><path ${A} d="M9 8l-5 4 5 4zM15 8l5 4-5 4z"/>`,
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
    instance: `<path d="M3 9l6-3 6 3v7l-6 3-6-3z" stroke-dasharray="2 2"/><path ${A} d="M9 7l6-3 6 3v7l-6 3-6-3zM9 7l6 3 6-3M15 10v7"/>`,
    'create-instance': `<path d="M3 9l6-3 6 3v7l-6 3-6-3z"/><path ${A} d="M11 7l5-2.5 5 2.5v6l-5 2.5-5-2.5z" stroke-dasharray="2 2"/>`,
    'realize-instance': `<path d="M3 9l6-3 6 3v7l-6 3-6-3z" stroke-dasharray="2 2"/><path ${A} d="M11 8l5-2.5 5 2.5v6l-5 2.5-5-2.5zM11 8l5 2.5 5-2.5M16 10.5v6"/>`,
    image: `<rect x="3" y="5" width="18" height="14"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle ${A} cx="16" cy="9" r="1.6"/>`,
    'depth-normal': `<rect x="4" y="8" width="10" height="10"/><path ${A} d="M10 4h10v10h-6"/>`,
    'depth-front': `<rect x="4" y="8" width="10" height="10"/><path ${A} d="M10 4h10v10H10z"/>`,
    'depth-behind': `<path ${A} d="M10 4h10v10h-6M10 4v4"/><rect x="4" y="8" width="10" height="10"/><path d="M5 9l8 8M9 9l4 4"/>`,
    'cull-front': `<path d="M4 6l10-2v16L4 18z"/><path ${A} d="M20 12h-4M18 10l-2 2 2 2"/>`,
    'cull-double': `<path d="M9 6l6-2v16l-6-2z"/><path ${A} d="M3 12h4M5 10l2 2-2 2M21 12h-4M19 10l-2 2 2 2"/>`,
    'deform-curve': `<path d="M3 20h8M3 20l8-6"/><path d="M13 15c3-6 5-8 8-9"/><path ${A} d="M4 18c2-1 4-1 6-2M14 12c2-2 4-3 6-4" stroke-dasharray="2 2"/>`,
    'swap-uv': `<path d="M6 4v12h12"/><path ${A} d="M15 4l3 3-3 3M18 7H11M9 20l-3-3 3-3M6 17h7"/>`,
    'complete-edge': `<path d="M3 4v16M21 4v16"/><path ${A} d="M8 12h8"/><path d="M4 12h4M16 12h4" stroke-dasharray="2 2"/>`,
    subdivide: `<path d="M3 18C7 6 17 6 21 18"/><path d="M3 18L7 8h10l4 10" stroke-dasharray="2 2"/><path ${A} d="M5 13h0M12 8h0M19 13h0" stroke-width="3" stroke-linecap="round"/>`,
    'raise-degree': `<path d="M3 18C8 6 14 6 21 18"/><path ${A} d="M3 14C8 2 14 2 21 14" stroke-dasharray="2 2"/><path ${A} d="M12 9V5M10 7l2-2 2 2"/>`,
    // Reverse Sheet: a sheet with its normal flipped over.
    'reverse-sheet': `<path d="M4 14l8-4 8 4"/><path ${A} d="M12 10V3M9.5 5.5L12 3l2.5 2.5M12 12v8M9.5 17.5L12 20l2.5-2.5" stroke-dasharray="0"/>`,
    // Find Boundary Edges: a sheet with its open sides lit.
    isoparam: `<path d="M4 18c3-8 13-12 16-12M4 18h16M20 6v12"/><path ${A} d="M4 12c5-4 11-6 16-6M10 18c1-6 4-10 10-12" stroke-dasharray="2 2"/>`,
    'iso-u': `<path d="M4 6h16v12H4z"/><path ${A} d="M4 12h16M16 9l4 3-4 3"/>`,
    'iso-v': `<path d="M4 6h16v12H4z"/><path ${A} d="M12 6v12M9 14l3 4 3-4"/>`,
    'both-sides': `<path d="M12 4v16"/><path ${A} d="M8 8v8M16 8v8"/><path d="M4 12h4M16 12h4"/>`,
    // Ambient occlusion: a corner darkened where its faces meet.
    'view-ao': `<path d="M4 20V8l8-4 8 4v12"/><path ${A} d="M12 12v8M4 8l8 4 8-4"/><path ${A} d="M9 18l3-3 3 3" stroke-dasharray="1.5 1.5"/>`,
    // A matcap: a lit sphere; loading one adds an arrow in.
    matcap: `<circle cx="12" cy="12" r="8"/><path ${A} d="M8.5 9.5a4 4 0 0 1 3-2.5"/>`,
    'matcap-load': `<circle cx="10" cy="13" r="7"/><path ${A} d="M7 11a3 3 0 0 1 2.5-2M19 3v7M16 7l3 3 3-3"/>`,
    // An HDR environment: a horizon with the sun over it; loading one adds an arrow in.
    hdr: `<path d="M3 15h18M3 19h18"/><circle cx="12" cy="10" r="3"/><path ${A} d="M12 3v2M6 6l1.5 1.5M18 6l-1.5 1.5"/>`,
    'hdr-load': `<path d="M3 17h13M3 21h13"/><circle cx="9" cy="12" r="3"/><path ${A} d="M19 3v7M16 7l3 3 3-3"/>`,
    // Project and Imprint methods: along each curve's own normal, or one direction for all.
    'proj-normal': `<path d="M4 16c4-6 12-6 16 0"/><path ${A} d="M8 12V5M6 7l2-2 2 2M16 12V5M14 7l2-2 2 2"/>`,
    'proj-vector': `<path d="M4 20h16"/><path ${A} d="M7 4v12M5 14l2 2 2-2M12 4v12M10 14l2 2 2-2M17 4v12M15 14l2 2 2-2"/>`,
    'proj-both': `<path d="M4 12h16" stroke-dasharray="2 2"/><path ${A} d="M12 3v18M9.5 5.5L12 3l2.5 2.5M9.5 18.5L12 21l2.5-2.5"/>`,
    'proj-hide': `<path d="M4 9h16"/><path d="M4 17h16" stroke-dasharray="2 2"/><path ${A} d="M12 2v7M10 7l2 2 2-2"/>`,
    // Completion: the imprinted edge left where it ends, or carried on to the face's edges.
    'completion-none': `<path d="M4 5h16v14H4z"/><path ${A} d="M9 12h6"/>`,
    'completion-edge': `<path d="M4 5h16v14H4z"/><path ${A} d="M4 12h16"/><path d="M9 12h6" stroke-width="3"/>`,
    'remove-fillets': `<path d="M4 20V10a6 6 0 0 1 6-6h10" stroke-dasharray="2 2"/><path d="M4 20V4h16"/><path ${A} d="M14 14l5 5M19 14l-5 5"/>`,
    'boundary-edges': `<path d="M4 8l8-4 8 4-8 4z" stroke-dasharray="2 2"/><path ${A} d="M4 8v8l8 4 8-4V8"/>`,
    unify: `<path d="M4 6h16v12H4z"/><path ${A} d="M12 6v12" stroke-dasharray="2 2"/><path ${A} d="M9 10l-2 2 2 2M15 10l2 2-2 2"/>`,
    'convert-vertex': `<path d="M3 18L12 5l9 13" stroke-dasharray="2 2"/><path ${A} d="M3 18C8 9 16 9 21 18"/><path ${A} d="M12 5h0" stroke-width="3" stroke-linecap="round"/>`,
    rebuild: `<path d="M3 17L7 6l6 9 4-8 4 2" stroke-dasharray="2 2"/><path ${A} d="M3 17C7 5 11 5 13 11s6 7 8-2"/>`,
    // Match Face: a block's top face taking the curve of a surface above it.
    // Deform's Reblend: a stretched round (dashed) made round again.
    reblend: `<path d="M4 20V12a10 7 0 0 1 10-7h6" stroke-dasharray="2 2"/><path ${A} d="M8 20v-5a6 6 0 0 1 6-6h6"/><path d="M4 20h4"/>`,
    'fillet-round': `<path d="M5 3v8M13 19h8"/><path ${A} d="M5 11a8 8 0 0 0 8 8"/>`,
    'fillet-chordal': `<path d="M5 3v8M13 19h8"/><path ${A} d="M5 11a8 8 0 0 0 8 8"/><path d="M5 11l8 8" stroke-dasharray="2 2"/>`,
    'fillet-conic': `<path d="M5 3v8M13 19h8"/><path ${A} d="M5 11Q5 19 13 19"/><circle cx="5" cy="19" r="1.2"/>`,
    'fillet-g2': `<path d="M5 3v6M15 19h6"/><path ${A} d="M5 9C5 16 8 19 15 19"/>`,
    'tangent-chain': `<path d="M3 17h7"/><path ${A} d="M10 17a6 6 0 0 0 6-6V4"/><path d="M16 4v-1M3 17H2" stroke-dasharray="1 2"/><circle cx="10" cy="17" r="1.2"/>`,
    'fillet-full': `<path d="M5 21V12M19 21V12"/><path ${A} d="M5 12a7 7 0 0 1 14 0"/><path d="M5 5h14" stroke-dasharray="2 2"/>`,
    // Offset Edge gap fill: an L corner and its offset, joined straight on, round or smoothly.
    'corner-linear': `<path d="M4 20V8h12"/><path ${A} d="M8 20V12h8"/>`,
    'corner-round': `<path d="M4 20V8h12"/><path ${A} d="M8 20v-4a4 4 0 0 1 4-4h4"/><circle cx="4" cy="8" r="1.2"/>`,
    'corner-natural': `<path d="M4 20V8h12"/><path ${A} d="M8 20C8 15 9 12 16 12"/>`,
    'limit-minimal': `<path d="M15 3v18"/><path ${A} d="M3 12h12"/><path ${A} d="M11 8l4 4-4 4"/>`,
    'limit-outside': `<path d="M9 3v18M15 3v18"/><path ${A} d="M3 12h18"/><path ${A} d="M17 8l4 4-4 4"/>`,
    untrim: `<path d="M3 5h18v14H3z" stroke-dasharray="2 2"/><path ${A} d="M7 9c3-2 7-2 10 0v6c-3 2-7 2-10 0z"/><path ${A} d="M14 12l5-5M19 7h-3M19 7v3"/>`,
    // Unwrap Face: a curved strip and the flat piece it lays out as.
    unwrap: `<path d="M4 9c4-5 12-5 16 0" /><path d="M4 9v3M20 9v3"/><path ${A} d="M3 17h18v4H3z"/><path ${A} d="M12 13v2M10.5 13.5L12 15l1.5-1.5"/>`,
    'keep-edges': `<path d="M3 5h18v14H3z"/><path ${A} d="M8 9h8v6H8z" stroke-dasharray="2 2"/><circle cx="8" cy="9" r="1.2"/><circle cx="16" cy="15" r="1.2"/>`,
    'match-face': `<path d="M4 20V12h16v8z"/><path d="M4 12l16 0" stroke-dasharray="2 2"/><path ${A} d="M3 9c5-5 13 2 18-3"/><path ${A} d="M12 11V8"/>`,
    // Rebuild Face: a curved patch with its new control net over it.
    'rebuild-face': `<path d="M3 17c4-6 14-6 18 0M3 9c4-6 14-6 18 0M3 9v8M21 9v8"/><path ${A} d="M3 13h18M12 5v12M7.5 6.5v10M16.5 6.5v10" stroke-dasharray="2 2"/>`,
    // Tolerance: the fitted curve held inside a band; Explicit: a set count of spans marked off.
    'rebuild-tolerance': `<path d="M3 9c5-5 13-5 18 0M3 17c5-5 13-5 18 0" stroke-dasharray="2 2"/><path ${A} d="M3 13c5-5 13-5 18 0"/>`,
    'rebuild-explicit': `<path d="M3 16c5-7 13-7 18 0"/><path ${A} d="M3 16h0M9 11h0M15 11h0M21 16h0" stroke-width="3" stroke-linecap="round"/>`,
    // Shrink: the outer net pulled in to the face's own edges.
    shrink: `<path d="M3 3h18v18H3z" stroke-dasharray="2 2"/><path ${A} d="M8 8h8v8H8z"/><path d="M4 4l3 3M20 4l-3 3M4 20l3-3M20 20l-3-3"/>`,
    'align-vertex': `<path d="M6 5h0M17 8h0M8 19h0" stroke-width="3" stroke-linecap="round"/><path ${A} d="M12 3v18"/><path ${A} d="M12 12h0" stroke-width="3" stroke-linecap="round"/>`,
    // Dimension: a size line with its ends over a block's side.
    dimension: `<rect x="4" y="11" width="16" height="9"/><path ${A} d="M4 4v5M20 4v5M4 6.5h16M7 4.5l-3 2 3 2M17 4.5l3 2-3 2"/>`,
    // Alternative Duplicate: a curve above copied straight down onto the plane.
    'alt-duplicate': `<path d="M3 20l4-4h14l-4 4z"/><path d="M8 6c2-3 6-3 8 0"/><path ${A} d="M9 17c2-2 4-2 6 0M12 8v6M10 12l2 2 2-2"/>`,
    // Create Outline: a block with its outline drawn round it.
    'create-outline': `<path d="M5 9l7-4 7 4v7l-7 4-7-4z" stroke-dasharray="2 2"/><path ${A} d="M5 9l7-4 7 4M5 9v7l7 4 7-4V9"/>`,
    // Toggle Points: a curve with its control net and points.
    'toggle-points': `<path d="M4 18C7 6 17 6 20 18"/><path ${A} d="M4 18L8 7l8 0 4 11" stroke-dasharray="2 2"/><path ${A} d="M4 18h0M8 7h0M16 7h0M20 18h0" stroke-width="3.5" stroke-linecap="round"/>`,
    // Place: a copy set down on a surface from a reference point.
    place: `<path d="M2 20h20"/><rect x="3" y="4" width="6" height="6"/><rect ${A} x="13" y="12" width="8" height="8"/><path ${A} d="M9 7c4 0 7 1 8 5"/>`,
    'place-normal': `<path d="M3 19h18"/><path ${A} d="M12 19V5M9 8l3-3 3 3"/>`,
    'axis-x': `<path d="M4 20h16"/><path ${A} d="M8 6l8 8M16 6l-8 8"/>`,
    'axis-y': `<path d="M4 20h16"/><path ${A} d="M8 5l4 5 4-5M12 10v7"/>`,
    'axis-z': `<path d="M4 20h16"/><path ${A} d="M8 6h8l-8 10h8"/>`,
    'extend-natural': `<path d="M3 19a10 10 0 0 1 8-9"/><path ${A} d="M11 10a10 10 0 0 1 9 2" stroke-dasharray="2 2"/>`,
    'extend-linear': `<path d="M3 19a10 10 0 0 1 8-9"/><path ${A} d="M11 10l9-4" stroke-dasharray="2 2"/>`,
    // Limit cleared: a sheet running up to a wall, the wall struck out.
    unlimit: `<path d="M3 16l10-4"/><path ${A} d="M17 5v14" stroke-dasharray="2 2"/><path ${A} d="M14 9l6 6M20 9l-6 6"/>`,
    // Soft: the bend eases out flat; Reflective: the bend turned through the edge into an S.
    'extend-soft': `<path d="M3 19a10 10 0 0 1 8-9"/><path ${A} d="M11 10c4-2 6-2.6 9-2.8" stroke-dasharray="2 2"/>`,
    'extend-reflective': `<path d="M3 19a10 10 0 0 1 8-9"/><path ${A} d="M11 10a10 10 0 0 0 8-9" stroke-dasharray="2 2"/><path d="M11 10h0" stroke-width="3" stroke-linecap="round"/>`,
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
    // Text: a letter T standing on its baseline; the fonts as an A drawn plain, with serifs, and monospaced.
    text: `<path d="M3 21h18"/><path ${A} d="M6 4h12M12 4v14"/>`,
    'font-0': `<path d="M5 20l7-16 7 16M8 14h8"/>`,
    'font-1': `<path d="M6 20l6-15 6 15M8.5 14h7"/><path ${A} d="M3.5 20h5M15.5 20h5M10 5h4"/>`,
    'font-2': `<path d="M6 20l6-15 6 15M8.5 14h7"/><path ${A} d="M4 20h4M16 20h4"/><path d="M4 3v2M20 3v2" stroke-dasharray="1 1"/>`,
    // Text alignment: lines lined up on the left, the middle or the right.
    'txalign-left': `<path d="M4 6h16M4 10h10M4 14h16M4 18h8"/><path ${A} d="M3 3v18"/>`,
    'txalign-center': `<path d="M4 6h16M7 10h10M4 14h16M8 18h8"/><path ${A} d="M12 3v18" stroke-dasharray="2 2"/>`,
    'txalign-right': `<path d="M4 6h16M10 10h10M4 14h16M12 18h8"/><path ${A} d="M21 3v18"/>`,
    // Slide Curve CV: a control point moved along its cage (U), back along it, or across it (N).
    slide: `<path d="M3 18L9 8l6 4 6-8" stroke-dasharray="2 2"/><path ${A} d="M9 8h0M5 10.5l8-5M11 4.5l2 1-1 2" stroke-width="2" stroke-linecap="round"/>`,
    'slide-u': `<path d="M4 16L20 8" stroke-dasharray="2 2"/><path ${A} d="M8 14l8-4M13 9l3 1-1 3"/>`,
    'slide-back': `<path d="M4 16L20 8" stroke-dasharray="2 2"/><path ${A} d="M16 10l-8 4M11 15l-3-1 1-3"/>`,
    'slide-v': `<path d="M8 4L16 20" stroke-dasharray="2 2"/><path ${A} d="M10 8l4 8M11 14l3 2 1-3"/>`,
    'slide-vback': `<path d="M8 4L16 20" stroke-dasharray="2 2"/><path ${A} d="M14 16l-4-8M13 10l-3-2-1 3"/>`,
    'slide-n': `<path d="M4 16L20 8" stroke-dasharray="2 2"/><path ${A} d="M12 12l-3-6M7 8l2-2 2 1"/>`,
    isolate: `<rect x="3" y="5" width="18" height="14" stroke-dasharray="2 2"/><rect ${A} x="8" y="8" width="8" height="8"/>`,
};

/** The icon for `name` as an inline SVG, or '' when there is none. */
export function icon(name) {
    const body = ICONS[name];
    return body ? `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>` : '';
}

export const iconNames = () => Object.keys(ICONS);
