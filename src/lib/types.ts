export type ProviderId = "openai" | "google-gemini" | "topaz";
export type NodeKind = "text-gen" | "image-gen" | "video-gen" | "transform";
export type OutputType = "text" | "image" | "video";
export type ProviderModelAvailability = "ready" | "coming_soon";
export type ImageOutputFormat = "png" | "jpeg" | "webp";
export type ImageSize = "1024x1024" | "1536x1024" | "1024x1536" | "auto";
export type ImageQuality = "low" | "medium" | "high" | "auto";
export type ImageInputFidelity = "high" | "low";

export type ProviderModelCapabilities = {
  text: boolean;
  image: boolean;
  video: boolean;
  runnable: boolean;
  availability: ProviderModelAvailability;
  requiresApiKeyEnv: string | null;
  apiKeyConfigured: boolean;
  executionMode: "image-edit" | "coming-soon";
  acceptedInputMimeTypes: string[];
  maxInputImages: number;
  defaults: {
    outputFormat?: ImageOutputFormat;
    quality?: ImageQuality;
    size?: ImageSize;
    inputFidelity?: ImageInputFidelity;
  };
};

export type NodePayload = {
  nodeId: string;
  nodeType: NodeKind;
  prompt: string;
  settings: Record<string, unknown>;
  outputType: OutputType;
  promptSourceNodeId?: string | null;
  upstreamNodeIds: string[];
  upstreamAssetIds: string[];
  inputImageAssetIds: string[];
};

export type ProviderInputAsset = {
  assetId: string;
  type: OutputType;
  storageRef: string;
  mimeType: string;
  buffer: Buffer;
  checksum?: string | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
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
  type: OutputType;
  mimeType: string;
  metadata: Record<string, unknown>;
  content: string | Buffer;
  encoding: BufferEncoding | "binary";
  extension: string;
};

export type ProviderModelDescriptor = {
  providerId: ProviderId;
  modelId: string;
  displayName: string;
  capabilities: ProviderModelCapabilities;
  defaultSettings: Record<string, unknown>;
};

export type ProviderCapabilities = {
  supportsCancel: boolean;
  supportsStreaming: boolean;
  nodeKinds: NodeKind[];
};

export type ProviderAdapter = {
  providerId: ProviderId;
  getCapabilities: () => ProviderCapabilities;
  getModels: () => ProviderModelDescriptor[];
  submitJob: (input: ProviderJobInput) => Promise<NormalizedOutput[]>;
};

export type ProjectFilterState = {
  type?: OutputType | "all";
  ratingAtLeast?: number;
  flaggedOnly?: boolean;
  tag?: string;
  providerId?: ProviderId | "all";
  sort?: "newest" | "oldest" | "rating";
};
