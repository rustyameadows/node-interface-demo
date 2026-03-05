# Node Interface Demo

Local-first Next.js app for node-based image/video/text generation workflows with a project-isolated infinite canvas and Lightroom-style asset review.

## Implemented Through Milestone 5

- Milestone 1: Next.js + TypeScript scaffold, Prisma schema, local Postgres setup, pg-boss worker scaffold.
- Milestone 2: Local project CRUD, project sidebar, one-open-project switching, workspace restore state.
- Milestone 3: Custom infinite canvas engine (pan/zoom/drag/drop) with persisted project document and workflow node runner.
- Milestone 4: Provider adapter layer with a real OpenAI `gpt-image-1.5` image-edit path plus placeholder Gemini (`Nano Banana 2`) and Topaz catalog entries.
- Milestone 5: Asset viewer with Grid / 2-up / 4-up modes, star ratings, flagging, tags, and filters.

Current live provider status:
- OpenAI `gpt-image-1.5`: real image edit/reference generation flow
- Other OpenAI models, Gemini, and Topaz: visible in dropdowns, `Coming soon`, not runnable

## Quick Start

```bash
npm install
npm run dev
```

`npm run dev` auto-boots a local Postgres instance under `.local-pg/`, runs Prisma setup (`generate + db push`), and starts Next.js.

The app boots without API keys. To run real OpenAI image generations, add `OPENAI_API_KEY` to `.env.local` and restart `npm run dev`:

```bash
OPENAI_API_KEY=your_key_here
```

Open [http://localhost:3000](http://localhost:3000).

## First Real OpenAI Flow

Once `OPENAI_API_KEY` is configured:

1. Create or open a project.
2. In Canvas, add a text note and write the prompt.
3. Upload one or more images.
4. Add a model node and keep it on `OpenAI / GPT Image 1.5`.
5. Connect the text note and image node(s) into the model node.
6. Run the node from the node modal.
7. The generated image is stored locally and auto-added back to the canvas as a new image node.

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
- Default local execution mode is `JOB_EXECUTION_MODE=inline`, so the first OpenAI test only needs `npm run dev`.
- Accounts/orgs/sharing are deferred and documented in `docs/FUTURE_MULTITENANCY.md`.
