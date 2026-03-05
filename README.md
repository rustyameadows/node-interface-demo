# Node Interface Demo

Local-first Next.js app for node-based image/video/text generation workflows with a project-isolated infinite canvas and Lightroom-style asset review.

## Implemented Through Milestone 5

- Milestone 1: Next.js + TypeScript scaffold, Prisma schema, local Postgres setup, pg-boss worker scaffold.
- Milestone 2: Local project CRUD, project sidebar, one-open-project switching, workspace restore state.
- Milestone 3: Custom infinite canvas engine (pan/zoom/drag/drop) with persisted project document and workflow node runner.
- Milestone 4: Provider adapter layer with OpenAI, Gemini (`Nano Banana 2` display label), and Topaz stubs.
- Milestone 5: Asset viewer with Grid / 2-up / 4-up modes, star ratings, flagging, tags, and filters.

Provider calls are currently stubbed. No API keys are required for the current end-to-end flow.

## Quick Start

```bash
npm install
npm run dev
```

`npm run dev` now auto-boots a local Postgres instance under `.local-pg/`, runs Prisma setup (`generate + db push`), and starts Next.js. No `.env` setup is required for the stubbed flow.

Open [http://localhost:3000](http://localhost:3000).

## Optional Queue Worker Mode (Advanced)

Default mode is inline job execution (`JOB_EXECUTION_MODE=inline`) so the app works without a second process.

To run with pg-boss worker queue:

1. Configure a Postgres `DATABASE_URL` (pg-boss requires Postgres).
2. Set `JOB_EXECUTION_MODE=queue` in `.env`.
3. Run app + worker:

```bash
npm run dev:all
```

## API Surface

- `GET/POST /api/projects`
- `PATCH/DELETE /api/projects/:projectId`
- `POST /api/projects/:projectId/open`
- `GET/PUT /api/projects/:projectId/canvas`
- `GET/POST /api/projects/:projectId/jobs`
- `GET /api/projects/:projectId/assets`
- `PATCH /api/assets/:assetId`
- `GET /api/assets/:assetId/file`
- `GET /api/providers`

## Notes

- `Gemini 3.1 Flash` is displayed as `Nano Banana 2` through model registry labels.
- Asset binaries are stored under `.local-assets/<projectId>/...`.
- Local dev Postgres data directory is `.local-pg/`.
- Accounts/orgs/sharing are deferred and documented in `docs/FUTURE_MULTITENANCY.md`.
