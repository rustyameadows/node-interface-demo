# Provider Integrations (Current Runtime)

## Goals
- Keep provider execution behind one adapter contract.
- Snapshot real graph inputs before enqueue so job execution is deterministic.
- Normalize binary outputs so generated assets land in local storage and the asset viewer without provider-specific UI code.

## Current Provider Status
- `openai / gpt-image-1.5`: real image generation path with both prompt-only (`generate`) and image-edit/reference (`edit`) modes.
- `openai / gpt-image-1`, `openai / gpt-image-1-mini`, `openai / gpt-4.1-mini`: visible in UI, `Coming soon`, not runnable.
- `google-gemini / gemini-3.1-flash` (`Nano Banana 2`): visible in UI, `Coming soon`, not runnable.
- `topaz / topaz-studio-main`: visible in UI, `Coming soon`, not runnable.

The dropdowns still expose the future catalog so node IDs and routing stay stable, but only `gpt-image-1.5` executes real provider calls in this pass.

## Runtime Contract

```ts
export type ProviderId = "openai" | "google-gemini" | "topaz";

export type NodePayload = {
  nodeId: string;
  nodeType: "text-gen" | "image-gen" | "video-gen" | "transform";
  prompt: string; // resolved prompt snapshot
  settings: Record<string, unknown>;
  outputType: "text" | "image" | "video";
  executionMode: "generate" | "edit";
  promptSourceNodeId?: string | null;
  upstreamNodeIds: string[];
  upstreamAssetIds: string[];
  inputImageAssetIds: string[];
};

export type ProviderInputAsset = {
  assetId: string;
  type: "image" | "video" | "text";
  storageRef: string;
  mimeType: string;
  buffer: Buffer;
  checksum?: string | null;
  width?: number | null;
  height?: number | null;
};

export type ProviderJobInput = {
  projectId: string;
  jobId: string;
  providerId: ProviderId;
  modelId: string;
  payload: NodePayload;
  inputAssets: ProviderInputAsset[];
};

export type NormalizedOutput = {
  type: "image" | "video" | "text";
  mimeType: string;
  metadata: Record<string, unknown>;
  content: string | Buffer;
  encoding: BufferEncoding | "binary";
  extension: string;
};
```

## Model Capability Metadata
Provider-model records sync into `provider_models.capabilities` with the runtime metadata the UI needs:
- `runnable`
- `availability` (`ready | coming_soon`)
- `requiresApiKeyEnv`
- `apiKeyConfigured`
- `executionModes`
- `acceptedInputMimeTypes`
- `maxInputImages`
- `defaults`

This keeps the browser truthful about whether a node can run without inventing client-side rules.

## OpenAI (`openai`)

### Supported Flow
- One model node targeting `gpt-image-1.5`
- Prompt comes from:
  - connected text note when present
  - otherwise the model node prompt textarea
- Execution mode is inferred from connected image inputs:
  - `generate`: no connected image inputs
  - `edit`: one or more connected supported image inputs
- Image references come from connected image-producing nodes when the inferred mode is `edit`
- Server resolves those references into concrete asset bytes before invoking OpenAI
- Run inserts a generated output placeholder node on the canvas immediately after job creation
- Successful output is stored as a project asset and attached to that same output node
- Failed output nodes remain on canvas and retain source-call inspection

### Request Shape
- API path:
  - `generate`: `client.images.generate(...)`
  - `edit`: `client.images.edit(...)`
- Model: `gpt-image-1.5`
- Defaults used in this pass:
  - `output_format = png`
  - `quality = medium`
  - `size = 1024x1024`
  - `input_fidelity = high` (`edit` only)
- Input constraints enforced in app:
  - `generate`: zero image inputs
  - `edit`: only image inputs, first 5 connected images in stable connection order
  - accepted types for `edit`: `image/png`, `image/jpeg`, `image/webp`

### Run Gating
OpenAI run is disabled when:
- `OPENAI_API_KEY` is missing
- resolved prompt is empty
- one or more image connections exist but none resolve to supported image assets

### Output Normalization
- Generated image bytes are decoded from OpenAI base64 output into `Buffer`
- Asset metadata stores:
  - `mimeType`
  - `checksum`
  - `width`
  - `height`
  - provider/model metadata in `job_attempts.provider_response`
- Generated output nodes also retain:
  - originating `jobId`
  - transient processing state (`queued | running | failed | null`)
  - source-call inspection via the same `job_attempts` payloads shown in Queue

## Placeholder Providers
Gemini and Topaz currently use the same registry and dropdown surfaces but reject execution with `COMING_SOON`. This preserves the provider-agnostic node contract without pretending those backends are live.

## Error Mapping
- `CONFIG_ERROR`: missing `OPENAI_API_KEY`
- `COMING_SOON`: non-runnable placeholder model/provider
- `INVALID_INPUT`: missing prompt or unsupported/missing image inputs
- `PROVIDER_ERROR`: adapter or upstream API failure

All provider request/response summaries and error details are stored in `job_attempts` for the queue inspector.
