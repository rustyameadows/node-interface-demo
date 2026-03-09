# Design System

## Goal
Unify the non-canvas desktop app around one reusable UI system without disturbing the protected canvas node and connection renderers.

## Surface Model
- `app`
  - light, high-clarity shell for app home, Node Library, settings, assets, queue, and asset detail
  - uses warm white surfaces with citrus/aqua accent echoes from the canvas palette
- `canvas-overlay`
  - dark floating chrome for the workspace menu, queue pill, insert picker, bottom tray popovers, asset picker modal, and selection action strip
  - keeps the overlay language aligned with the black canvas without restyling the node surfaces themselves

Protected areas:
- main project canvas nodes
- main project canvas connections
- Node Library playground canvas internals

Allowed wrapper changes around protected areas:
- page framing
- shell/menu chrome
- queue pill
- insert/context menus
- compare/download selection strip
- Node Library detail rails and canvas frame

## Token Layers
Source files live under `src/styles/design-system/`.

1. Primitive tokens
- raw color palette
- spacing scale
- radii
- shadows
- motion/easing
- typography
- z-index

2. Semantic tokens
- page wash and surfaces
- text and border roles
- focus ring
- control backgrounds
- app vs canvas-overlay surface values
- state colors for success, warning, danger, info, accent, neutral

3. Component tokens
- button padding
- panel padding and radius
- popover and modal radius
- shell/menu/queue radii

Rule:
- CSS Modules and component styles consume semantic/component variables.
- Primitive values stay in the token layer.

## Density
- `comfortable`
  - home, settings, Node Library wrappers
- `compact`
  - assets controls, queue tables/inspector, canvas overlays

Density is a design-system implementation detail in this pass. There is no user-facing density toggle yet.

## Shared Primitives
Shared UI primitives live in `src/components/ui/`.

Available primitives:
- `Button`
- `Panel` / `Card`
- `Field`
- `Input`
- `Textarea`
- `SelectField`
- `Badge`
- `SectionHeader`
- `EmptyState`
- `ToolbarGroup`
- `PopoverSurface`
- `ModalSurface`

Usage rules:
- migrated route surfaces should prefer these primitives over route-local button/input/panel styling
- route CSS should handle layout and page-specific composition, not reinvent control chrome
- overlay shells should use `canvas-overlay` data attributes when they render outside the normal tree

## Motion and Accessibility
- micro feedback: `140ms`
- UI transitions: `180ms`
- layout shifts: `240ms`
- focus-visible always uses the semantic focus ring
- disabled controls reduce opacity and remove pointer affordance
- global reduced-motion fallback collapses animations/transitions

## Guardrail
- Run `npm run check:design-system`.
- The check rejects raw color literals in design-system-managed files and migrated UI modules.
- Token files are exempt because they are the source of truth for raw values.

## UI PR Checklist
- Uses semantic/component vars instead of raw colors in migrated UI files
- Uses shared primitives for route-level controls and panels where applicable
- Keeps protected canvas node/connection renderers untouched
- Preserves keyboard/accessibility behavior
- Verifies light app surfaces and dark canvas overlays both still read clearly
