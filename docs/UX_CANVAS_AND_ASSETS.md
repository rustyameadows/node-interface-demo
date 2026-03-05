# UX Spec: Canvas and Asset Viewer (V1)

## Workspace Shell
- Full-viewport canvas is the primary workspace.
- Floating nested project nav (active + archived + create).
- Floating node settings modal (draggable), containing provider/model/type/output/prompt and run controls.
- Floating asset dock for active project outputs.
- Floating compact jobs panel.

## Project-Aware Behavior
- Exactly one project open at any time.
- Opening another project swaps the entire workspace context.
- Workspace restore includes canvas viewport, node selection, and viewer layout/filter state.

## Infinite Canvas (Custom Engine)
- Canvas supports pan/zoom and large graph layouts.
- Node operations:
  - add node
  - drag/move node cards
  - delete node
  - run selected node or run all
- Node state indicators:
  - idle
  - queued
  - running
  - success
  - failed
  - canceled

## Node Configuration UX
- Node card includes:
  - provider selector
  - model selector
  - settings panel generated from `settingsSchema`
- Input/output ports display supported media types.
- Validation appears before run when required ports/settings are missing.

## Job Feedback UX
- Run action creates visible job chip with state and progress.
- Failed jobs show normalized error class and short detail.
- Users can retry failed jobs or cancel running jobs when supported.

## Asset Viewer Modes
- `grid`: responsive thumbnail grid with adjustable density.
- `2-up`: side-by-side comparison view for two selected assets.
- `4-up`: tiled comparison view for four selected assets.

## Asset Curation Controls
- Rating: 1-5 stars.
- Flagging: boolean pick/reject marker.
- Tags: attach and filter by tag labels.
- Sorting: newest, oldest, highest rating.
- Filtering: type, rating range, flagged, tag set, provider/model.

## Selection and Compare Rules
- Selection is project-scoped.
- Compare entry points:
  - choose exactly 2 assets for 2-up
  - choose exactly 4 assets for 4-up
- Invalid selection counts show inline guidance.

## Keyboard Shortcuts (Proposed V1)
- Canvas:
  - `Space + drag`: pan
  - `Cmd/Ctrl + +/-`: zoom
  - `Delete`: remove selected node/edge
  - `Cmd/Ctrl + D`: duplicate node
- Asset viewer:
  - `1..5`: set star rating
  - `F`: toggle flag
  - `G`: grid mode
  - `2`: compare 2-up mode
  - `4`: compare 4-up mode

## Accessibility
- All actionable controls keyboard reachable.
- Focus ring visible on interactive elements.
- High-contrast state indicators for job status.
- Text alternatives for visual-only status badges.

## Performance Targets
- Smooth pan/zoom on large canvases typical for local workflows.
- Filter and sort operations should feel immediate on typical project asset sets.
- Mode switching (grid/2-up/4-up) should not require page reload.
