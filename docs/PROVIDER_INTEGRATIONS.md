# Provider Integrations (Current Runtime)

## Goals
- Keep provider execution behind one adapter contract.
- Snapshot real graph inputs before enqueue so job execution is deterministic.
- Normalize binary outputs so generated assets land in local storage and the asset viewer without provider-specific UI code.

## Current Provider Status
- `openai / gpt-image-1.5`: real image-edit/reference execution path.
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
- `executionMode`
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
- Image references come from connected image-producing nodes
- Server resolves those references into concrete asset bytes before invoking OpenAI
- Successful output is stored as a project asset and later materialized as a generated image node on the canvas

### Request Shape
- API path: OpenAI Images API image-edit flow
- Model: `gpt-image-1.5`
- Defaults used in this pass:
  - `output_format = png`
  - `quality = medium`
  - `size = 1024x1024`
  - `input_fidelity = high`
- Input constraints enforced in app:
  - only image inputs
  - only `image/png`, `image/jpeg`, `image/webp`
  - first 5 connected images in stable connection order

### Run Gating
OpenAI run is disabled when:
- `OPENAI_API_KEY` is missing
- resolved prompt is empty
- no supported image inputs are connected

### Output Normalization
- Generated image bytes are decoded from OpenAI base64 output into `Buffer`
- Asset metadata stores:
  - `mimeType`
  - `checksum`
  - `width`
  - `height`
  - provider/model metadata in `job_attempts.provider_response`

## Placeholder Providers
Gemini and Topaz currently use the same registry and dropdown surfaces but reject execution with `COMING_SOON`. This preserves the provider-agnostic node contract without pretending those backends are live.

## Error Mapping
- `CONFIG_ERROR`: missing `OPENAI_API_KEY`
- `COMING_SOON`: non-runnable placeholder model/provider
- `INVALID_INPUT`: missing prompt or unsupported/missing image inputs
- `PROVIDER_ERROR`: adapter or upstream API failure

All provider request/response summaries and error details are stored in `job_attempts` for the queue inspector.
