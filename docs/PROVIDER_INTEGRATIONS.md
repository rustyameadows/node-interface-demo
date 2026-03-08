# Provider Integrations (Desktop Runtime)

## Goals
- Keep provider execution behind one adapter boundary.
- Snapshot concrete graph inputs before queueing a job.
- Normalize outputs so the renderer never needs provider-specific transport logic.

## Current Provider Status
- `openai / gpt-image-1.5`
- `openai / gpt-image-1-mini`
  - runnable image generation and image edit/reference flows
- `openai / gpt-5.4`
- `openai / gpt-5-mini`
- `openai / gpt-5-nano`
  - runnable text-generation flows through the Responses API
- `topaz / high_fidelity_v2`
- `topaz / redefine`
  - runnable Topaz image transforms
- `google-gemini / gemini-3.1-flash`
  - visible as `Nano Banana 2`, not runnable in this pass

## Runtime Contract

```ts
type ProviderJobInput = {
  projectId: string;
  jobId: string;
  providerId: "openai" | "google-gemini" | "topaz";
  modelId: string;
  payload: NodePayload;
  inputAssets: ProviderInputAsset[];
  onPreviewFrame?: (previewFrame: NormalizedPreviewFrame) => Promise<void> | void;
};
```

Provider adapters return normalized outputs:
- image/video buffers for persisted assets
- inline text for note-native GPT outputs
- preview frames when streaming is supported

## Capability Metadata
`provider_models.capabilities` stores the renderer-facing metadata needed for honest UI gating:
- `runnable`
- `availability`
- `requirements`
- `promptMode`
- `requiresApiKeyEnv`
- `apiKeyConfigured`
- `executionModes`
- `acceptedInputMimeTypes`
- `maxInputImages`
- `parameters`
- `defaults`

## Environment Keys
The renderer never receives these values directly:

```bash
OPENAI_API_KEY=...
GOOGLE_API_KEY=...
TOPAZ_API_KEY=...
```

Read locations:
- main process
- worker process
- provider adapters

## OpenAI Image Jobs
- support prompt-only `generate` and reference-image `edit`
- execution mode is inferred from connected image inputs
- request settings are resolved before enqueue
- partial previews are persisted as `job_preview_frames`
- final outputs become `assets` rows plus local files

## OpenAI GPT Text Jobs
- accept prompt text only
- create generated `text-note` placeholders on the canvas
- persist returned text in `job_attempts.provider_response`
- do not create asset rows or asset files

## Topaz Jobs
- run as single-image transforms
- `high_fidelity_v2` is synchronous
- `redefine` is async and may require download-envelope resolution
- final outputs are normalized back into standard asset storage

## Failure Model
- queue attempts are persisted
- failures surface explicit error code and message
- retries use bounded backoff
- worker restarts recover stale running jobs by re-queueing them
