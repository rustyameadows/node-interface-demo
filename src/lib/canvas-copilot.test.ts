import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCanvasCopilotSuccessSummaries,
  buildCanvasCopilotRunPreview,
  formatCanvasCopilotSuccessMessage,
  getCanvasCopilotModelVariants,
  getDefaultCanvasCopilotModelVariant,
} from "@/lib/canvas-copilot";
import type { ProviderModel } from "@/components/workspace/types";
import type { NodeCatalogVariant } from "@/lib/node-catalog";

const sampleProviders: ProviderModel[] = [
  {
    providerId: "openai",
    modelId: "gpt-5.4",
    displayName: "GPT 5.4",
    capabilities: {
      text: true,
      image: false,
      video: false,
      runnable: true,
      availability: "ready",
      billingAvailability: "free_and_paid",
      accessStatus: "available",
      accessReason: null,
      accessMessage: null,
      lastCheckedAt: null,
      requiresApiKeyEnv: "OPENAI_API_KEY",
      apiKeyConfigured: true,
      requirements: [],
      promptMode: "required",
      executionModes: ["generate"],
      acceptedInputMimeTypes: [],
      maxInputImages: 0,
      parameters: [],
      defaults: {
        textOutputTarget: "note",
        maxOutputTokens: 1024,
      },
    },
  },
  {
    providerId: "google-gemini",
    modelId: "gemini-3-flash-preview",
    displayName: "Gemini 3 Flash",
    capabilities: {
      text: true,
      image: false,
      video: false,
      runnable: false,
      availability: "ready",
      billingAvailability: "free_and_paid",
      accessStatus: "blocked",
      accessReason: "missing_key",
      accessMessage: "Missing GOOGLE_API_KEY.",
      lastCheckedAt: null,
      requiresApiKeyEnv: "GOOGLE_API_KEY",
      apiKeyConfigured: false,
      requirements: [],
      promptMode: "required",
      executionModes: ["generate"],
      acceptedInputMimeTypes: [],
      maxInputImages: 0,
      parameters: [],
      defaults: {
        textOutputTarget: "note",
        maxOutputTokens: 1024,
      },
    },
  },
  {
    providerId: "openai",
    modelId: "gpt-image-1.5",
    displayName: "GPT Image 1.5",
    capabilities: {
      text: false,
      image: true,
      video: false,
      runnable: true,
      availability: "ready",
      billingAvailability: "free_and_paid",
      accessStatus: "available",
      accessReason: null,
      accessMessage: null,
      lastCheckedAt: null,
      requiresApiKeyEnv: "OPENAI_API_KEY",
      apiKeyConfigured: true,
      requirements: [],
      promptMode: "required",
      executionModes: ["generate", "edit"],
      acceptedInputMimeTypes: [],
      maxInputImages: 4,
      parameters: [],
      defaults: {},
    },
  },
];

const sampleVariants: NodeCatalogVariant[] = [
  {
    id: "model:openai:gpt-5.4",
    entryId: "model",
    providerId: "openai",
    modelId: "gpt-5.4",
    label: "GPT 5.4",
    providerLabel: "OpenAI",
    description: "gpt-5.4",
    availabilityLabel: "Ready",
    status: "ready",
    disabled: false,
    disabledReason: null,
    outputType: "text",
    defaultSettings: {
      textOutputTarget: "note",
      maxOutputTokens: 1024,
    },
  },
  {
    id: "model:google-gemini:gemini-3-flash-preview",
    entryId: "model",
    providerId: "google-gemini",
    modelId: "gemini-3-flash-preview",
    label: "Gemini 3 Flash",
    providerLabel: "Google Gemini",
    description: "gemini-3-flash-preview",
    availabilityLabel: "Missing key",
    status: "missing_key",
    disabled: true,
    disabledReason: "Missing GOOGLE_API_KEY.",
    outputType: "text",
    defaultSettings: {
      textOutputTarget: "note",
      maxOutputTokens: 1024,
    },
  },
  {
    id: "model:openai:gpt-image-1.5",
    entryId: "model",
    providerId: "openai",
    modelId: "gpt-image-1.5",
    label: "GPT Image 1.5",
    providerLabel: "OpenAI",
    description: "gpt-image-1.5",
    availabilityLabel: "Ready",
    status: "ready",
    disabled: false,
    disabledReason: null,
    outputType: "image",
    defaultSettings: {},
  },
];

test("copilot variants only include runnable text models", () => {
  const variants = getCanvasCopilotModelVariants(sampleVariants);

  assert.deepEqual(
    variants.map((variant) => variant.id),
    ["model:openai:gpt-5.4", "model:google-gemini:gemini-3-flash-preview"]
  );
  assert.equal(getDefaultCanvasCopilotModelVariant(variants)?.id, "model:openai:gpt-5.4");
});

test("copilot request forces smart output and marks the run as copilot-origin", () => {
  const preview = buildCanvasCopilotRunPreview({
    providers: sampleProviders,
    variants: sampleVariants,
    selectedVariantId: "model:openai:gpt-5.4",
    prompt: "Make a list and matching template.",
    requestNodeId: "copilot-preview",
  });

  assert.equal(preview.disabledReason, null);
  assert.equal(preview.requestPayload?.nodePayload.runOrigin, "copilot");
  assert.equal(preview.requestPayload?.nodePayload.settings.textOutputTarget, "smart");
  assert.match(preview.readyMessage || "", /smart structured nodes/i);
});

test("copilot surfaces provider access errors for disabled text models", () => {
  const preview = buildCanvasCopilotRunPreview({
    providers: sampleProviders,
    variants: sampleVariants,
    selectedVariantId: "model:google-gemini:gemini-3-flash-preview",
    prompt: "Make a template.",
    requestNodeId: "copilot-preview",
  });

  assert.match(preview.disabledReason || "", /GOOGLE_API_KEY/);
});

test("formats success summaries for the copilot transcript", () => {
  assert.equal(
    formatCanvasCopilotSuccessMessage({
      addedNodeCount: 2,
      connectedCount: 1,
      skippedConnectionCount: 1,
    }),
    "Added 2 nodes. Connected 1 pair. Skipped 1 invalid connection."
  );
});

test("success transcript updates only replace pending copilot status rows", () => {
  const messages = applyCanvasCopilotSuccessSummaries(
    [
      {
        id: "user-1",
        role: "user",
        text: "Add ten notes.",
        createdAt: "2026-03-09T10:00:00.000Z",
      },
      {
        id: "status-1",
        role: "system",
        text: "Running GPT 5.4...",
        createdAt: "2026-03-09T10:00:01.000Z",
        state: "pending",
        jobId: "job-1",
      },
      {
        id: "status-2",
        role: "system",
        text: "Added 10 nodes.",
        createdAt: "2026-03-09T10:00:02.000Z",
        state: "success",
        jobId: "job-2",
      },
    ],
    new Map([
      [
        "job-1",
        {
          addedNodeCount: 10,
          connectedCount: 0,
          skippedConnectionCount: 0,
        },
      ],
      [
        "job-2",
        {
          addedNodeCount: 0,
          connectedCount: 0,
          skippedConnectionCount: 0,
        },
      ],
    ])
  );

  assert.equal(messages[1]?.text, "Added 10 nodes.");
  assert.equal(messages[1]?.state, "success");
  assert.equal(messages[2]?.text, "Added 10 nodes.");
  assert.equal(messages[2]?.state, "success");
});
