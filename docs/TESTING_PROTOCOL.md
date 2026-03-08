# Testing Protocol

## Goal
Verify the desktop app in layers so failures are isolated quickly:
1. static correctness
2. build correctness
3. Electron app boot
4. automated desktop smoke flow
5. optional manual provider checks

## Baseline Commands
Run these from the repo root:

```bash
npm run lint
npm run test:unit
npm run build
npm run db:generate
```

Expected results:
- `lint` passes
- `test:unit` passes
- `build` emits `dist/renderer` and `dist/electron`
- `db:generate` emits a migration under `drizzle/`

## Primary Desktop Smoke Test
Use the automated Electron smoke flow:

```bash
npm run smoke:electron
```

What it does:
- builds the app
- launches the real Electron app from `dist/electron/main.cjs`
- uses a temporary `NODE_INTERFACE_APP_DATA` directory
- waits for the launcher
- creates a project
- writes a canvas snapshot with two nodes through the live preload bridge
- imports an SVG asset through the live preload bridge
- navigates through assets, queue, and project settings
- verifies:
  - preload bridge exists
  - SQLite file is created
  - canvas data round-trips
  - asset metadata exists
  - asset file exists on disk
  - queue screen renders
  - project settings render with project metadata
- writes screenshots into the temp app-data directory

Expected output:
- JSON summary printed to stdout with:
  - `projectId`
  - `appDataRoot`
  - `canvasScreenshotPath`
  - `assetsScreenshotPath`
  - `queueScreenshotPath`
  - `settingsScreenshotPath`
  - `providerSummary`
  - `nodeLabels`
  - `assetCount`
  - `storedAssetFiles`

## Dev-App Verification
For interactive testing:

```bash
npm run dev
```

This should:
- start Vite on `http://localhost:5173`
- watch-build Electron main/preload/worker bundles
- launch Electron against the dev server

If `npm run dev` fails with `Port 5173 is already in use`, clear the stale dev server first:

```bash
lsof -nP -iTCP:5173 -sTCP:LISTEN
kill <pid>
```

## Browser-Only Renderer Smoke
When debugging renderer UI separate from preload/main:

1. run `npm run dev`
2. open `http://localhost:5173`

The renderer has a browser fallback bridge for smoke inspection only. Use this for:
- launcher rendering
- route rendering
- CSS/token verification
- quick TanStack Router/Query checks

Do not treat browser fallback mode as a substitute for Electron smoke.

## Manual Desktop Checklist
Run this when touching workflow or asset UX:

1. Launch `npm run dev`.
2. Create a project from the launcher.
3. Confirm the canvas route loads.
4. Add or restore at least one text note and one model node.
5. Import an asset.
6. Open the Assets view and confirm the imported asset appears.
7. Open Project Settings and confirm the project metadata renders.
8. If API keys are configured, run at least one real provider job and verify:
   - queue row created
   - state changes visible
   - output lands on canvas or in assets as appropriate

## Troubleshooting

### Blank Electron window
Check:
- Electron dev process is using `NODE_ENV=development`
- `ELECTRON_RENDERER_URL` points at `http://localhost:5173`
- no stale `dist/electron` cleanup is racing Electron restarts

### Preload missing in dev
Symptoms:
- black window
- `Unable to load preload script`
- `window.nodeInterface` missing

Check:
- `tsup` watch build is not cleaning `dist/electron` on every rebuild
- `dist/electron/preload.cjs` exists before Electron restart

### App works in browser but not Electron
That usually means a preload/main problem, not a React problem. Re-run:

```bash
npm run smoke:electron
```

and inspect the printed temp `appDataRoot` plus screenshots.

## When To Update This Doc
Update this protocol when any of these change:
- app run commands
- build commands
- smoke-test command or coverage
- Electron boot path
- required verification steps for canvas/assets/queue flows
