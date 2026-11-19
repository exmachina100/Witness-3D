# Witness 3D — UI/UX Parity Plan with Plasticity 26.2.7

_Last updated: 2026-11-19_

Based on REA analysis of Plasticity 26.2.7 binaries and startup state, this plan documents all UI/UX gaps and a phased approach to achieve 100% parity.

---

## Executive Summary

**Current Parity**: ~75% — Core toolbars, radial menus, command palette, keymap, viewport controls, outliner, and shader system are implemented. Missing: modal dialogs for complex operations, inspector panel, construction plane UI, advanced snapping/constraint UI, and several interaction behaviors.

**Strategy**: Phase by functional area, prioritizing high-impact modal dialogs and inspector panel first (these are the most visible UX gaps).

---

## Plasticity UI Architecture (from REA)

### Core UI Components Identified

| Component | Plasticity Implementation | Witness-3D Status |
|-----------|---------------------------|-------------------|
| **Tool Rail** | Left vertical, family buttons with flyout strips | ✅ Implemented (`Toolbar.js`) |
| **Command Bar** | Bottom center, fixed 9 slots | ✅ Implemented (`App.js:BAR`) |
| **P-Menu** | Top-left, file/document actions | ✅ Implemented (`menus.js:P_MENU`) |
| **Radial Menus** | Selection mode + Viewport settings (customizable) | ✅ Implemented (`menus.js:RADIALS`) |
| **Command Palette** | F-key, fuzzy search, key binding via right-click | ✅ Implemented (`App.js`) |
| **Viewport Header** | Ortho/X-ray/Edges/Faces/Curves/Render/AO/Section/Shader | ✅ Implemented (`App.js:vhead`) |
| **Shader Popover** | Environment, comb scale, shader options, matcap import | ✅ Implemented (`App.js:vpop`) |
| **Outliner** | Left sidebar with tabs (Outliner/History), search, stats | ✅ Implemented (`App.js:left aside`) |
| **Inspector/Properties** | Right sidebar, context-sensitive property panels | ❌ **Missing** |
| **Construction Plane UI** | Plane pill in VTL, plane list in Inspector | ⚠️ Partial (pill only) |
| **Modal Dialogs** | Fillet, Loft, Sweep, Pipe, Patch, Match Face, etc. | ⚠️ Partial (inline panels only) |
| **HUD/Key Hints** | Bottom-left, context-sensitive | ✅ Implemented (`App.js:hud`) |
| **View Cube/Gizmo** | Top-right, click faces/edges/corners to orient | ✅ Implemented (`ViewGizmo.js`) |
| **Magnitude Gizmo** | Yellow dot + numeric input for distance/angle | ✅ Implemented (`MagnitudeGizmo.js`) |
| **Snap/Constraint UI** | Visual feedback, constraint chips, inference lines | ⚠️ Partial |

---

## Gap Analysis by Category

### 1. Inspector Panel (Right Sidebar) — **HIGH PRIORITY**

**Plasticity Behavior**:
- Context-sensitive panel on right side
- Shows properties for: selected objects, active tool, construction planes, materials, scenes
- Collapsible sections with inline editors (numeric fields, dropdowns, color pickers)
- "Pinned" state persists across commands

**Witness-3D Gap**: No right sidebar exists. All tool parameters live in bottom HUD or floating strips.

**Required Implementation**:
```
Right Sidebar (aside.right)
├── Header: "INSPECTOR" + pin/close buttons
├── Sections (collapsible):
│   ├── SELECTION PROPERTIES (when objects selected)
│   │   ├── Transform: Position/Rotation/Scale (editable)
│   │   ├── Geometry: Type, Face/Edge/Vertex counts, Volume
│   │   ├── Material: Dropdown + edit button
│   │   └── Visibility/Display toggles
│   ├── TOOL PROPERTIES (when command active)
│   │   ├── All current HUD controls moved here
│   │   ├── Numeric inputs with unit parsing
│   │   ├── Continuity dropdowns (G0/G1/G2/G3)
│   │   ├── Profile selectors (for Pipe/Sweep)
│   │   └── Boolean operation radios
│   ├── CONSTRUCTION PLANES
│   │   ├── List of saved planes with activate/delete
│   │   ├── "New Plane" button (opens modal)
│   │   └── World planes (XY/YZ/ZX) always shown
│   ├── MATERIALS
│   │   ├── Library browser (thumbnails)
│   │   ├── Current material editor
│   │   └── "New Material" button
│   └── SCENE SETTINGS
│       ├── Units, Grid, Snap settings
│       ├── Render settings (AO, tone mapping)
│       └── Viewport defaults
```

**Files to Create/Modify**:
- `web/src/app/Inspector.js` — new component
- `web/src/app/App.js` — integrate into shell, wire up selection/tool events
- `web/src/app/styles.css` — right sidebar layout

---

### 2. Modal Dialogs for Complex Operations — **HIGH PRIORITY**

**Plasticity Behavior**:
- Tools like Fillet, Loft, Sweep, Pipe, Patch, Match Face, Thicken, Shell open **modal dialogs**
- Dialogs are centered, semi-transparent backdrop, ESC to cancel, Enter/OK to commit
- Contain: parameter controls, preview options, help text, sometimes mini-viewport
- "Apply" button commits without closing; "OK" commits and closes; "Cancel" reverts

**Witness-3D Gap**: All tools use inline bottom panels (HUD) or floating strips. No true modal dialogs.

**Required Dialogs** (priority order):

| Dialog | Tool(s) | Key Controls |
|--------|---------|--------------|
| **Fillet/Chamfer** | `fillet` | Radius (variable points), Type (Fillet/Chamfer/Full Round), Angle (chamfer), Limit Points, Tangent Edges toggle, Copy Radius |
| **Loft** | `loft`, `loft-faces`, `loft-sheet` | Profiles list (add/remove/reorder), Guides, Limit Points, Continuity per edge, Tension, Degree |
| **Sweep** | `sweep` | Path curve, Guide curves, Guide Method, Alignment, Twist (mouse + numeric), Profile |
| **Pipe** | `pipe` | Curves list, Radius (variable), Thickness, Sides, Profile, Keep Tools, Cap options |
| **Patch** | `patch` | Curves/Edges list, Tangent to faces toggle, Quad-sided toggle, Continuity analysis |
| **Match Face** | `match-face` | Target face picker, Source faces (multi-select), Grow toggle, **Solver (Constrained/xNURBS)**, **Skew (-1 to 1)** |
| **Thicken** | `thicken` | Sheet/Face selector, Front/Back distances, Lock distances, Cap options |
| **Shell** | `shell` | Thickness, Faces to remove (multi-select), Direction (in/out/both) |
| **Offset Face/Edge** | `offset`, `offset-edge` | Distance, Grow mode, Angle adjacent, Gap fill, Both sides |
| **Bridge Surface** | `bridge-surface` | Edge/Sheet pairs, Tension, Wall pairs, Continuity |
| **Extend Sheet** | `extend-sheet` | Edges, Distance, Type (Natural/Linear/Soft/Reflective), Limit to body |
| **Draft Face** | `draft` | Angle, Offset, Grow mode, Curve taper, Pull direction |
| **Constrained Surface** | `constrained-surface` | Points list, Performance/Smoothness slider |
| **Square** | `square` | Sides (curves/edges), Continuity, Tension, Degree |
| **Project Align** | `project-align` | Continuity, Projection mode, Tension |
| **Align Surface** | `align-surface` | Continuity, Tension |
| **Rebuild Face** | `rebuild-face` | Method, Tolerance, Degree, Spans, Extend, Shrink |
| **Untrim** | `untrim` | Keep edges toggle, Face multi-select |
| **Unwrap Face** | `unwrap` | Face multi-select |
| **Section Analysis** | `section` | Distance, Flip |
| **Dimension** | `dimension` | Type cycler, Value input |
| **Text** | `text` | Text input (multiline), Font, Size, Alignment |
| **Place** | `place` | From/To points, Scale, Angle, Offset, Flip, Instance toggle, Boolean ops |
| **Export Mesh** | `export-mesh` | Format, Options (binary/ASCII, units, selection only) |
| **Export Drawing** | `export-drawing` | View/Hidden/Curves toggles, Scale, Paper size |
| **Preferences** | `app:preferences` | All settings categories |

**Implementation Pattern**:
```javascript
// web/src/app/Modal.js
export class Modal {
  constructor(title, content, actions = [{label: 'OK', primary: true}, {label: 'Cancel'}]) {
    this.el = document.createElement('div');
    this.el.className = 'modal';
    this.el.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header><h2 id="modal-title">${title}</h2><button class="modal-close" aria-label="Close">&times;</button></header>
        <div class="modal-content">${content}</div>
        <footer class="modal-actions">${actions.map(a => `<button class="${a.primary ? 'primary' : ''}">${a.label}</button>`).join('')}</footer>
      </div>
    `;
    // Trap focus, handle ESC, handle backdrop click
  }
  open() { document.body.append(this.el); this.el.querySelector('button').focus(); }
  close() { this.el.remove(); }
  onAction(callback) { /* wire up buttons */ }
}
```

**Files to Create/Modify**:
- `web/src/app/Modal.js` — base modal class
- `web/src/app/ToolDialogs.js` — factory functions for each tool's dialog content
- `web/src/app/App.js` — replace inline panel logic with modal opens
- `web/src/app/styles.css` — modal styles (centered, backdrop, animations)

---

### 3. Construction Plane UI — **MEDIUM PRIORITY**

**Plasticity Behavior**:
- Plane pill in VTL shows active plane (click to save)
- Inspector has Construction Planes section with list
- "New Plane" opens modal: 3-point, Line+Angle, Face, View, Offset, Tangent, Curve
- Planes can be renamed, set as default, deleted
- Active plane highlighted, used for sketching and operations

**Witness-3D Gap**: Plane pill exists but no plane list, no "New Plane" modal, no plane management.

**Required**:
- Add Construction Planes section to Inspector
- Create "New Plane" modal with all plane types
- Plane persistence in document (.w3d format)
- Active plane indicator in viewport (grid overlay)

---

### 4. Advanced Snapping & Constraint UI — **MEDIUM PRIORITY**

**Plasticity Behavior**:
- Visual inference lines (dashed) during drag
- Constraint chips appear near cursor (Horizontal, Vertical, Tangent, Perpendicular, Midpoint, Center, Intersection, On Curve, On Face)
- Snap tooltip shows snap type and target
- "Snap to Grid" / "Snap to Objects" toggles in Viewport menu
- Constraint keys (Shift for ortho, Ctrl for snap, Alt for no-snap) shown in HUD

**Witness-3D Gap**: `snapKinds.js` and `constraints.js` exist but visual feedback is minimal.

**Required**:
- Inference line renderer (Three.js lines, dashed material)
- Constraint chip component (small pill near cursor with icon + label)
- Snap tooltip (follows cursor, shows "Endpoint", "Midpoint", "On Face", etc.)
- Snap/Object toggles in Viewport radial menu (already partially there)

---

### 5. Selection & Interaction Behaviors — **MEDIUM PRIORITY**

**Plasticity Behaviors to Match**:

| Behavior | Plasticity | Witness-3D | Gap |
|----------|------------|------------|-----|
| **Box Select** | Left drag → box, direction matters (L→R = enclosed, R→L = crossing) | ✅ | — |
| **Add/Remove** | Shift+Click add, Ctrl+Click remove, Ctrl+Shift+Click pick from list | ✅ | — |
| **Selection Filter** | Mode buttons (Vertex/Edge/Face/Solid) + filter in outliner | ✅ | — |
| **Pre-highlight** | Hover highlights face/edge/vertex before click | ⚠️ Partial | Needs better hover feedback |
| **Drag-to-rotate-view** | MMB drag orbits, Shift+MMB pans | ✅ | — |
| **Context Menu** | RMB on empty space → radial; RMB on selection → context actions | ⚠️ Partial | Context menu missing |
| **Command Chaining** | Start new command → finishes previous, preserves selection | ✅ | — |
| **Numeric Input** | Type numbers during any tool → magnitude gizmo updates | ✅ | — |
| **Unit Parsing** | "25mm", "1in", "2.5cm", "1/2", "3*4" all work | ⚠️ Partial | Need full unit parser |
| **Mathematical Expressions** | "25+10", "50/2", "3*25.4" in numeric fields | ❌ | Missing |
| **Tab Navigation** | Tab cycles through fields in dialogs/panels | ❌ | Missing |
| **Escape Behavior** | ESC cancels tool, closes dialog, clears selection (progressive) | ⚠️ Partial | Progressive ESC missing |

---

### 6. Viewport & Visual Polish — **LOW PRIORITY**

| Feature | Plasticity | Witness-3D | Notes |
|---------|------------|------------|-------|
| **Grid** | Adaptive, major/minor lines, origin highlight, unit label | ✅ | `gridLines.js` |
| **Floor/Shadow** | Ground plane with contact shadow | ❌ | Add `GTAOPass` + floor mesh |
| **Selection Highlight** | Yellow wireframe + face tint | ⚠️ | Improve material |
| **Pre-selection Highlight** | Cyan wireframe on hover | ❌ | Add hover render pass |
| **Gizmo Quality** | Transform gizmo with axis labels, plane handles | ✅ | `TransformControls` |
| **Magnitude Gizmo** | Yellow dot + line + numeric display | ✅ | `MagnitudeGizmo.js` |
| **Curvature Combs** | On curves/edges, configurable scale | ✅ | `shading.js` |
| **Zebra/Isophotes** | 3 reflection modes | ✅ | Recently added |
| **Draft Angle** | Color-coded face display | ✅ | `shading.js` |
| **Section View** | Plane slider, capping, multiple sections | ⚠️ | Basic only |
| **Measurement Overlay** | Persistent distance/radius/angle labels | ❌ | Add measurement entities |
| **Reference Images** | Image planes with opacity/scale/position | ✅ | `images.js` |

---

### 7. Keyboard & Accessibility — **LOW PRIORITY**

| Feature | Plasticity | Witness-3D |
|---------|------------|------------|
| **Full Keymap** | 100+ bindings, customizable | ✅ `keymap.js` |
| **Command Palette** | F-key, fuzzy search, shows keys | ✅ |
| **Key Hints** | HUD shows context keys | ✅ |
| **Radial Menus** | Gesture-based, customizable | ✅ |
| **Tooltip on Hover** | Tool buttons show name + key | ✅ |
| **Focus Management** | Tab order, focus trap in modals | ❌ |
| **Screen Reader** | ARIA labels, roles | ⚠️ Partial |
| **High Contrast** | Theme support | ✅ `theme.json` |

---

## Phased Implementation Plan

### Phase 1: Inspector Panel + Modal Foundation (Weeks 1-2)
**Goal**: Right sidebar exists; at least Fillet and Loft use true modals

| Task | Files | Estimate |
|------|-------|----------|
| Create `Inspector.js` component with collapsible sections | `web/src/app/Inspector.js` | 2 days |
| Integrate into `App.js` shell (right aside) | `web/src/app/App.js` | 1 day |
| Create `Modal.js` base class with focus trap, ESC, backdrop | `web/src/app/Modal.js` | 1 day |
| Create `ToolDialogs.js` with Fillet dialog content | `web/src/app/ToolDialogs.js` | 2 days |
| Wire Fillet tool to open modal instead of inline panel | `web/src/app/App.js` | 1 day |
| Wire Loft tool to open modal | `web/src/app/App.js` | 1 day |
| Add Construction Planes section to Inspector | `web/src/app/Inspector.js` | 1 day |
| "New Plane" modal with 3-point/Line/Face/View types | `web/src/app/ToolDialogs.js` | 2 days |
| Plane persistence in .w3d format | `web/src/app/document.js` | 1 day |
| **Phase 1 Total** | | **~10 days** |

### Phase 2: Remaining Tool Modals (Weeks 3-4)
**Goal**: All complex tools use modals with parity controls

| Tool Group | Tools | Estimate |
|------------|-------|----------|
| Sweep/Pipe/Patch | `sweep`, `pipe`, `patch` | 3 days |
| Match Face/Align/Project | `match-face`, `align-surface`, `project-align` | 3 days |
| Thicken/Shell/Offset | `thicken`, `shell`, `offset`, `offset-edge` | 3 days |
| Bridge/Extend/Draft | `bridge-surface`, `extend-sheet`, `draft` | 2 days |
| Surface Tools | `constrained-surface`, `square`, `rebuild-face` | 2 days |
| Curve/Edit Tools | `untrim`, `unwrap`, `section`, `dimension`, `text` | 2 days |
| Place/Export/Preferences | `place`, `export-mesh`, `export-drawing`, `preferences` | 2 days |
| **Phase 2 Total** | | **~17 days** |

### Phase 3: Snapping/Constraints + Interaction Polish (Weeks 5-6)
**Goal**: Visual inference parity; smooth interaction behaviors

| Task | Files | Estimate |
|------|-------|----------|
| Inference line renderer (dashed Three.js lines) | `web/src/app/Inference.js` | 2 days |
| Constraint chip component (cursor-following pills) | `web/src/app/ConstraintChip.js` | 2 days |
| Snap tooltip (cursor-following, snap type + target) | `web/src/app/SnapTooltip.js` | 1 day |
| Integrate into `Constraints.js` and `snapKinds.js` | `web/src/app/constraints.js` | 2 days |
| Full unit parser (mm/in/cm/ft, fractions, expressions) | `web/src/units.js` | 2 days |
| Tab navigation in modals/dialogs | `web/src/app/Modal.js` | 1 day |
| Progressive ESC handling (tool → dialog → selection → nothing) | `web/src/app/App.js` | 1 day |
| Context menu on selection (RMB) | `web/src/app/ContextMenu.js` | 2 days |
| Pre-highlight render pass (cyan wireframe on hover) | `web/src/app/SelectionHighlight.js` | 2 days |
| **Phase 3 Total** | | **~15 days** |

### Phase 4: Viewport Polish + Accessibility (Weeks 7-8)
**Goal**: Visual polish matching Plasticity's fit & finish

| Task | Files | Estimate |
|------|-------|----------|
| Floor plane with contact shadow | `web/src/app/App.js` + `shading.js` | 1 day |
| Persistent measurement entities | `web/src/app/Measurement.js` | 2 days |
| Section view: plane slider, capping, multi-section | `web/src/app/SectionView.js` | 3 days |
| Improved selection highlight materials | `web/src/app/shading.js` | 1 day |
| Focus management (traps, restoration) | `web/src/app/Modal.js`, `Inspector.js` | 2 days |
| Full ARIA audit (roles, labels, live regions) | All UI files | 2 days |
| Keyboard navigation test (Tab, arrows, Escape) | Manual testing | 2 days |
| High contrast theme verification | `theme.json`, `shading.js` | 1 day |
| **Phase 4 Total** | | **~14 days** |

---

## Total Timeline: ~8 Weeks (2 Months)

| Phase | Focus | Duration |
|-------|-------|----------|
| 1 | Inspector + Modal Foundation | 2 weeks |
| 2 | All Tool Modals | 3-4 weeks |
| 3 | Snapping/Constraints + Interaction | 2 weeks |
| 4 | Viewport Polish + Accessibility | 2 weeks |
| **Total** | | **~8-9 weeks** |

---

## Technical Dependencies

### Must Complete First
1. ✅ OCCT build fixed (done)
2. ✅ Desktop app compiles (done)
3. ⬜ Web preview server running (needs restart)

### Can Parallelize
- Phase 1 Inspector/Modal work can happen while web preview is down
- Phase 2 tool dialogs are independent per tool
- Phase 3 snapping/constraints can be developed against LocalBackend

### Blockers
- Web preview memory pressure: need to restart `npm run dev` in `web/` with `--max-old-space-size=4096`
- REA analysis folder (`rea-input/`) is large (~2GB) — ensure `.gitignore` works

---

## Success Criteria (100% Parity Definition)

A tool/interaction has parity when:
1. ✅ Same keyboard shortcuts
2. ✅ Same mouse behaviors (click, drag, modifier keys)
3. ✅ Same visual feedback (highlights, gizmos, inference lines)
4. ✅ Same parameter controls (numeric inputs, dropdowns, toggles)
5. ✅ Same modal/panel behavior (ESC cancels, Enter OK, Apply commits)
6. ✅ Same persistence (settings remembered, planes saved)
7. ✅ Same accessibility (focus order, ARIA, screen reader)

**Verification Method**: Side-by-side video comparison of each tool workflow in Plasticity vs Witness-3D.

---

## Appendix: Plasticity-Specific Behaviors to Emulate

### Modal Dialog Patterns
- **Apply button**: Commits preview without closing dialog
- **OK button**: Commits and closes
- **Cancel button**: Reverts to pre-dialog state, closes
- **X button**: Same as Cancel
- **ESC key**: Same as Cancel
- **Enter key**: Same as OK (when not in text field)
- **Tab/Shift+Tab**: Cycles focus through controls
- **Numeric fields**: Accept expressions, units, show live preview

### Tool-Specific Nuances
- **Fillet**: Variable points show as yellow dots on edges; click to add/remove; drag to adjust
- **Loft**: Profiles can be reordered in list; guides are optional; limit points snap to profile ends
- **Sweep**: Guide method (None/Path/Guide Curves/Path+Guides); Alignment (Free/Follow Path/Follow Guides)
- **Pipe**: Profile can be Circle/Rectangle/Custom; Sides controls tessellation; Cap options
- **Match Face**: Solver dropdown (Constrained/xNURBS); Skew slider (-1 to 1) with live preview
- **Thicken**: Alt-click selects faces for "Thicken Face" mode; Front/Back distances independent
- **Shell**: Faces to remove = open faces; Direction toggle (In/Out/Both)

### Selection Nuances
- **Filter modes**: Point/Edge/Face/Solid — only selectable type highlights
- **Chain selection**: Double-click edge → selects tangent chain
- **Loop selection**: Double-click edge → selects edge loop
- **Ring selection**: Ctrl+Double-click edge → selects edge ring
- **Between selection**: Shift+Double-click two edges → selects between

---

## Next Steps

1. **Restart web preview**: `cd web && npm run dev -- --max-old-space-size=4096`
2. **Begin Phase 1**: Create `Inspector.js` and `Modal.js`
3. **Test each modal** against Plasticity behavior reference
4. **Commit incrementally** to GitHub after each tool dialog

---

*This plan will be updated as implementation progresses. Check `docs/roadmap-status.md` for overall project status.*