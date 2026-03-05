export type ProviderId = "openai" | "google-gemini" | "topaz";
export type NodeKind = "text-gen" | "image-gen" | "video-gen" | "transform";
export type OutputType = "text" | "image" | "video";

export type NodePayload = {
  nodeId: string;
  nodeType: NodeKind;
  prompt: string;
  settings: Record<string, unknown>;
  outputType: OutputType;
  upstreamAssetIds: string[];
};

export type ProviderJobInput = {
  projectId: string;
  jobId: string;
  providerId: ProviderId;
  modelId: string;
  payload: NodePayload;
};

export type NormalizedOutput = {
  type: OutputType;
  mimeType: string;
  metadata: Record<string, unknown>;
  content: string;
  encoding: "utf8";
  extension: string;
};

export type ProviderModelDescriptor = {
  providerId: ProviderId;
  modelId: string;
  displayName: string;
  capabilities: Record<string, unknown>;
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
