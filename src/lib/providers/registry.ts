import OpenAI, { toFile } from "openai";
import type {
  OpenAIImageMode,
  ImageInputFidelity,
  ImageOutputFormat,
  ImageQuality,
  ImageSize,
  NormalizedOutput,
  ProviderAdapter,
  ProviderId,
  ProviderJobInput,
  ProviderModelCapabilities,
  ProviderModelDescriptor,
} from "@/lib/types";

const OPENAI_IMAGE_INPUT_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];
const OPENAI_DEFAULT_OUTPUT_FORMAT: ImageOutputFormat = "png";
const OPENAI_DEFAULT_QUALITY: ImageQuality = "medium";
const OPENAI_DEFAULT_SIZE: ImageSize = "1024x1024";
const OPENAI_DEFAULT_INPUT_FIDELITY: ImageInputFidelity = "high";
const OPENAI_MAX_INPUT_IMAGES = 5;

type ProviderErrorCode = "CONFIG_ERROR" | "COMING_SOON" | "INVALID_INPUT" | "PROVIDER_ERROR";

function createProviderError(
  code: ProviderErrorCode,
  message: string,
  details?: Record<string, unknown>
): Error & { code: ProviderErrorCode; details?: Record<string, unknown> } {
  const error = new Error(message) as Error & { code: ProviderErrorCode; details?: Record<string, unknown> };
  error.code = code;
  if (details) {
    error.details = details;
  }
  return error;
}

function apiKeyConfigured(envVar: string) {
  return Boolean(process.env[envVar]?.trim());
}

function buildCapabilities({
  text,
  image,
  video,
  runnable,
  availability,
  requiresApiKeyEnv = null,
  executionModes = [],
  acceptedInputMimeTypes = [],
  maxInputImages = 0,
  defaults = {},
}: {
  text: boolean;
  image: boolean;
  video: boolean;
  runnable: boolean;
  availability: ProviderModelCapabilities["availability"];
  requiresApiKeyEnv?: string | null;
  executionModes?: ProviderModelCapabilities["executionModes"];
  acceptedInputMimeTypes?: string[];
  maxInputImages?: number;
  defaults?: ProviderModelCapabilities["defaults"];
}): ProviderModelCapabilities {
  return {
    text,
    image,
    video,
    runnable,
    availability,
    requiresApiKeyEnv,
    apiKeyConfigured: requiresApiKeyEnv ? apiKeyConfigured(requiresApiKeyEnv) : true,
    executionModes,
    acceptedInputMimeTypes,
    maxInputImages,
    defaults,
  };
}

function buildProviderCatalog(): Record<ProviderId, ProviderModelDescriptor[]> {
  const openAiCapabilities = buildCapabilities({
    text: false,
    image: true,
    video: false,
    runnable: apiKeyConfigured("OPENAI_API_KEY"),
    availability: "ready",
    requiresApiKeyEnv: "OPENAI_API_KEY",
    executionModes: ["generate", "edit"],
    acceptedInputMimeTypes: OPENAI_IMAGE_INPUT_MIME_TYPES,
    maxInputImages: OPENAI_MAX_INPUT_IMAGES,
    defaults: {
      outputFormat: OPENAI_DEFAULT_OUTPUT_FORMAT,
      quality: OPENAI_DEFAULT_QUALITY,
      size: OPENAI_DEFAULT_SIZE,
      inputFidelity: OPENAI_DEFAULT_INPUT_FIDELITY,
    },
  });

  const comingSoonImageCapabilities = buildCapabilities({
    text: false,
    image: true,
    video: false,
    runnable: false,
    availability: "coming_soon",
    executionModes: [],
  });

  const comingSoonTextCapabilities = buildCapabilities({
    text: true,
    image: false,
    video: false,
    runnable: false,
    availability: "coming_soon",
    executionModes: [],
  });

  const comingSoonMixedCapabilities = buildCapabilities({
    text: true,
    image: true,
    video: true,
    runnable: false,
    availability: "coming_soon",
    executionModes: [],
  });

  return {
    openai: [
      {
        providerId: "openai",
        modelId: "gpt-image-1.5",
        displayName: "GPT Image 1.5",
        capabilities: openAiCapabilities,
        defaultSettings: { ...openAiCapabilities.defaults },
      },
      {
        providerId: "openai",
        modelId: "gpt-image-1",
        displayName: "GPT Image 1",
        capabilities: comingSoonImageCapabilities,
        defaultSettings: {},
      },
      {
        providerId: "openai",
        modelId: "gpt-image-1-mini",
        displayName: "GPT Image 1 Mini",
        capabilities: comingSoonImageCapabilities,
        defaultSettings: {},
      },
      {
        providerId: "openai",
        modelId: "gpt-4.1-mini",
        displayName: "GPT 4.1 Mini",
        capabilities: comingSoonTextCapabilities,
        defaultSettings: {},
      },
    ],
    "google-gemini": [
      {
        providerId: "google-gemini",
        modelId: "gemini-3.1-flash",
        displayName: "Nano Banana 2",
        capabilities: comingSoonMixedCapabilities,
        defaultSettings: {},
      },
    ],
    topaz: [
      {
        providerId: "topaz",
        modelId: "topaz-studio-main",
        displayName: "Topaz Studio Main",
        capabilities: comingSoonImageCapabilities,
        defaultSettings: {},
      },
    ],
  };
}

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw createProviderError(
      "CONFIG_ERROR",
      "OpenAI is not configured. Set OPENAI_API_KEY in .env.local and restart npm run dev."
    );
  }

  return new OpenAI({ apiKey });
}

function getProviderModelDescriptor(providerId: ProviderId, modelId: string): ProviderModelDescriptor | null {
  const providerModels = buildProviderCatalog()[providerId] || [];
  return providerModels.find((model) => model.modelId === modelId) || null;
}

function outputFormatToMimeType(outputFormat: ImageOutputFormat) {
  if (outputFormat === "jpeg") {
    return "image/jpeg";
  }
  if (outputFormat === "webp") {
    return "image/webp";
  }
  return "image/png";
}

function parseImageSize(size: ImageSize) {
  if (size === "1536x1024") {
    return { width: 1536, height: 1024 };
  }
  if (size === "1024x1536") {
    return { width: 1024, height: 1536 };
  }
  return { width: 1024, height: 1024 };
}

function extensionForMimeType(mimeType: string) {
  if (mimeType === "image/jpeg") {
    return "jpg";
  }
  if (mimeType === "image/webp") {
    return "webp";
  }
  return "png";
}

function readOutputFormat(value: unknown, fallback: ImageOutputFormat): ImageOutputFormat {
  return value === "png" || value === "jpeg" || value === "webp" ? value : fallback;
}

function readQuality(value: unknown, fallback: ImageQuality): ImageQuality {
  return value === "low" || value === "medium" || value === "high" || value === "auto" ? value : fallback;
}

function readSize(value: unknown, fallback: ImageSize): ImageSize {
  return value === "1024x1024" || value === "1536x1024" || value === "1024x1536" || value === "auto"
    ? value
    : fallback;
}

function readInputFidelity(value: unknown, fallback: ImageInputFidelity): ImageInputFidelity {
  return value === "high" || value === "low" ? value : fallback;
}

function readExecutionMode(value: unknown): OpenAIImageMode {
  return value === "generate" ? "generate" : "edit";
}

async function submitOpenAiImage(input: ProviderJobInput): Promise<NormalizedOutput[]> {
  const model = getProviderModelDescriptor(input.providerId, input.modelId);
  if (!model) {
    throw createProviderError("INVALID_INPUT", `Unknown provider model: ${input.providerId}/${input.modelId}`);
  }

  if (model.capabilities.availability !== "ready") {
    throw createProviderError("COMING_SOON", `${model.displayName} is not runnable yet.`);
  }

  if (!model.capabilities.runnable) {
    throw createProviderError(
      "CONFIG_ERROR",
      "OpenAI is not configured. Set OPENAI_API_KEY in .env.local and restart npm run dev."
    );
  }

  const prompt = input.payload.prompt.trim();
  if (!prompt) {
    throw createProviderError("INVALID_INPUT", "Connect a prompt note or enter a prompt before running.");
  }

  const executionMode = readExecutionMode(input.payload.executionMode);
  const acceptedMimeTypes = new Set(model.capabilities.acceptedInputMimeTypes);
  const inputAssets = input.inputAssets
    .filter((asset) => asset.type === "image" && acceptedMimeTypes.has(asset.mimeType))
    .slice(0, model.capabilities.maxInputImages);

  if (executionMode === "generate" && inputAssets.length > 0) {
    throw createProviderError(
      "INVALID_INPUT",
      "Disconnect image inputs or switch the node to Edit mode before running."
    );
  }

  if (executionMode === "edit" && inputAssets.length === 0) {
    throw createProviderError(
      "INVALID_INPUT",
      "Connect at least one PNG, JPEG, or WebP image input before running."
    );
  }

  const defaults = model.capabilities.defaults;
  const outputFormat = readOutputFormat(input.payload.settings.outputFormat, defaults.outputFormat || OPENAI_DEFAULT_OUTPUT_FORMAT);
  const quality = readQuality(input.payload.settings.quality, defaults.quality || OPENAI_DEFAULT_QUALITY);
  const size = readSize(input.payload.settings.size, defaults.size || OPENAI_DEFAULT_SIZE);
  const inputFidelity = readInputFidelity(
    input.payload.settings.inputFidelity,
    defaults.inputFidelity || OPENAI_DEFAULT_INPUT_FIDELITY
  );

  const client = getOpenAIClient();
  const response =
    executionMode === "generate"
      ? await client.images.generate({
          model: input.modelId,
          prompt,
          size,
          quality,
          output_format: outputFormat,
          n: 1,
        })
      : await client.images.edit({
          model: input.modelId,
          image: await Promise.all(
            inputAssets.map((asset, index) =>
              toFile(asset.buffer, `input-${index + 1}.${extensionForMimeType(asset.mimeType)}`, {
                type: asset.mimeType,
              })
            )
          ),
          prompt,
          size,
          quality,
          output_format: outputFormat,
          input_fidelity: inputFidelity,
          n: 1,
        });

  const firstImage = response.data?.[0];
  if (!firstImage?.b64_json) {
    throw createProviderError("PROVIDER_ERROR", "OpenAI returned no image bytes.");
  }

  const content = Buffer.from(firstImage.b64_json, "base64");
  const dimensions = parseImageSize(size);

  return [
    {
      type: "image",
      mimeType: outputFormatToMimeType(outputFormat),
      extension: outputFormat === "jpeg" ? "jpg" : outputFormat,
      encoding: "binary",
      metadata: {
        providerId: input.providerId,
        modelId: input.modelId,
        width: dimensions.width,
        height: dimensions.height,
        executionMode,
        quality,
        size,
        outputFormat,
        inputFidelity: executionMode === "edit" ? inputFidelity : null,
        inputAssetIds: inputAssets.map((asset) => asset.assetId),
        revisedPrompt: firstImage.revised_prompt || null,
      },
      content,
    },
  ];
}

function buildComingSoonAdapter(providerId: ProviderId): ProviderAdapter {
  return {
    providerId,
    getCapabilities: () => ({
      supportsCancel: false,
      supportsStreaming: false,
      nodeKinds: ["text-gen", "image-gen", "video-gen", "transform"],
    }),
    getModels: () => buildProviderCatalog()[providerId],
    submitJob: async (input) => {
      const model = getProviderModelDescriptor(input.providerId, input.modelId);
      const label = model?.displayName || `${input.providerId}/${input.modelId}`;
      throw createProviderError("COMING_SOON", `${label} is coming soon.`);
    },
  };
}

const adapters: Record<ProviderId, ProviderAdapter> = {
  openai: {
    providerId: "openai",
    getCapabilities: () => ({
      supportsCancel: false,
      supportsStreaming: false,
      nodeKinds: ["image-gen"],
    }),
    getModels: () => buildProviderCatalog().openai,
    submitJob: submitOpenAiImage,
  },
  "google-gemini": buildComingSoonAdapter("google-gemini"),
  topaz: buildComingSoonAdapter("topaz"),
};

export function getProviderAdapter(providerId: ProviderId): ProviderAdapter {
  return adapters[providerId];
}

export function getProviderModel(providerId: ProviderId, modelId: string): ProviderModelDescriptor | null {
  return getProviderModelDescriptor(providerId, modelId);
}

export function getAllProviderModels(): ProviderModelDescriptor[] {
  const catalog = buildProviderCatalog();
  return [...catalog.openai, ...catalog["google-gemini"], ...catalog.topaz];
}
