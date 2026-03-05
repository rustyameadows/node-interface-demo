import type {
  NormalizedOutput,
  ProviderAdapter,
  ProviderId,
  ProviderJobInput,
  ProviderModelDescriptor,
} from "@/lib/types";

const providerCatalog: Record<ProviderId, ProviderModelDescriptor[]> = {
  openai: [
    {
      providerId: "openai",
      modelId: "gpt-image-1",
      displayName: "GPT Image 1",
      capabilities: { text: true, image: true, video: false },
      defaultSettings: { size: "1024x1024", quality: "medium" },
    },
    {
      providerId: "openai",
      modelId: "gpt-4.1-mini",
      displayName: "GPT 4.1 Mini",
      capabilities: { text: true, image: false, video: false },
      defaultSettings: { temperature: 0.7 },
    },
  ],
  "google-gemini": [
    {
      providerId: "google-gemini",
      modelId: "gemini-3.1-flash",
      displayName: "Nano Banana 2",
      capabilities: { text: true, image: true, video: true },
      defaultSettings: { temperature: 0.6 },
    },
  ],
  topaz: [
    {
      providerId: "topaz",
      modelId: "topaz-studio-main",
      displayName: "Topaz Studio Main",
      capabilities: { text: false, image: true, video: true },
      defaultSettings: { upscale: "2x", denoise: 0.2 },
    },
  ],
};

function fakeDelay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildStubOutput(input: ProviderJobInput): NormalizedOutput[] {
  const base = `[STUB] provider=${input.providerId} model=${input.modelId} node=${input.payload.nodeId}`;
  const prompt = input.payload.prompt || "(empty prompt)";

  if (input.payload.outputType === "text") {
    return [
      {
        type: "text",
        mimeType: "text/plain",
        extension: "txt",
        encoding: "utf8",
        metadata: { providerId: input.providerId, modelId: input.modelId },
        content: `${base}\n${prompt}\n\nGenerated locally with stub adapter.`,
      },
    ];
  }

  if (input.payload.outputType === "video") {
    return [
      {
        type: "video",
        mimeType: "application/json",
        extension: "json",
        encoding: "utf8",
        metadata: { providerId: input.providerId, modelId: input.modelId, fps: 24, durationMs: 4000 },
        content: JSON.stringify(
          {
            message: "Video output is stubbed until API keys are configured.",
            provider: input.providerId,
            model: input.modelId,
            prompt,
            generatedAt: new Date().toISOString(),
          },
          null,
          2
        ),
      },
    ];
  }

  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='1024' height='768'>
<rect width='100%' height='100%' fill='#10172a'/>
<rect x='24' y='24' width='976' height='720' fill='#0f2f48' rx='22' ry='22' stroke='#57d3ff' stroke-width='2'/>
<text x='52' y='96' fill='#57d3ff' font-size='28' font-family='monospace'>${base.replace(/&/g, "&amp;")}</text>
<text x='52' y='148' fill='#d9f6ff' font-size='24' font-family='monospace'>${prompt
    .slice(0, 120)
    .replace(/&/g, "&amp;")}</text>
<text x='52' y='700' fill='#8fb1c7' font-size='18' font-family='monospace'>Generated: ${new Date()
    .toISOString()
    .replace(/&/g, "&amp;")}</text>
</svg>`;

  return [
    {
      type: "image",
      mimeType: "image/svg+xml",
      extension: "svg",
      encoding: "utf8",
      metadata: {
        providerId: input.providerId,
        modelId: input.modelId,
        width: 1024,
        height: 768,
      },
      content: svg,
    },
  ];
}

function buildAdapter(providerId: ProviderId): ProviderAdapter {
  return {
    providerId,
    getCapabilities: () => ({
      supportsCancel: true,
      supportsStreaming: false,
      nodeKinds: ["text-gen", "image-gen", "video-gen", "transform"],
    }),
    getModels: () => providerCatalog[providerId],
    submitJob: async (input) => {
      await fakeDelay(750 + Math.floor(Math.random() * 650));
      return buildStubOutput(input);
    },
  };
}

const adapters: Record<ProviderId, ProviderAdapter> = {
  openai: buildAdapter("openai"),
  "google-gemini": buildAdapter("google-gemini"),
  topaz: buildAdapter("topaz"),
};

export function getProviderAdapter(providerId: ProviderId): ProviderAdapter {
  return adapters[providerId];
}

export function getAllProviderModels(): ProviderModelDescriptor[] {
  return [...providerCatalog.openai, ...providerCatalog["google-gemini"], ...providerCatalog.topaz];
}
