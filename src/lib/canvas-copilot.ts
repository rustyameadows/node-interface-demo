import type { CreateJobRequest } from "@/lib/ipc-contract";
import { formatProviderAccessMessage, formatProviderRequirementMessage, getFirstUnconfiguredRequirement, isProviderAccessBlocked } from "@/lib/provider-readiness";
import { isRunnableTextModel, resolveTextModelSettings } from "@/lib/provider-model-helpers";
import { getOpenAiTextOutputTargetLabel, readOpenAiTextOutputTarget } from "@/lib/text-output-targets";
import type { JobRunOrigin, ProviderModel } from "@/components/workspace/types";
import type { NodeCatalogVariant } from "@/lib/node-catalog";

export type CanvasCopilotMessage = {
  id: string;
  role: "user" | "system";
  text: string;
  createdAt: string;
  state?: "pending" | "success" | "error";
  jobId?: string | null;
};

export type CanvasCopilotRunPreview = {
  variant: NodeCatalogVariant | null;
  model: ProviderModel | null;
  requestPayload: CreateJobRequest | null;
  disabledReason: string | null;
  readyMessage: string | null;
};

export type CanvasCopilotHydrationSummary = {
  addedNodeCount: number;
  connectedCount: number;
  skippedConnectionCount: number;
};

const COPILOT_RUN_ORIGIN: JobRunOrigin = "copilot";

export function getCanvasCopilotModelVariants(variants: NodeCatalogVariant[]) {
  return variants.filter((variant) => isRunnableTextModel(variant.providerId, variant.modelId));
}

export function getDefaultCanvasCopilotModelVariant(variants: NodeCatalogVariant[]) {
  return variants.find((variant) => variant.status === "ready") || variants[0] || null;
}

export function buildCanvasCopilotRunPreview(input: {
  providers: ProviderModel[];
  variants: NodeCatalogVariant[];
  selectedVariantId: string | null;
  prompt: string;
  requestNodeId: string;
}) : CanvasCopilotRunPreview {
  const variants = getCanvasCopilotModelVariants(input.variants);
  const variant =
    variants.find((candidate) => candidate.id === input.selectedVariantId) || getDefaultCanvasCopilotModelVariant(variants);

  if (!variant) {
    return {
      variant: null,
      model: null,
      requestPayload: null,
      disabledReason: "No runnable text models are available for copilot.",
      readyMessage: null,
    };
  }

  const model =
    input.providers.find(
      (candidate) => candidate.providerId === variant.providerId && candidate.modelId === variant.modelId
    ) || null;
  const trimmedPrompt = input.prompt.trim();
  const effectiveSettings = resolveTextModelSettings(variant.providerId, variant.modelId, {
    ...(variant.defaultSettings || {}),
    textOutputTarget: "smart",
  })?.effectiveSettings || {
    ...(variant.defaultSettings || {}),
    textOutputTarget: "smart",
  };
  const resolvedTextSettings = resolveTextModelSettings(variant.providerId, variant.modelId, effectiveSettings);

  const requestPayload: CreateJobRequest = {
    providerId: variant.providerId,
    modelId: variant.modelId,
    nodePayload: {
      nodeId: input.requestNodeId,
      nodeType: "text-gen",
      prompt: trimmedPrompt,
      settings: effectiveSettings,
      outputType: "text",
      executionMode: "generate",
      outputCount: 1,
      runOrigin: COPILOT_RUN_ORIGIN,
      promptSourceNodeId: null,
      upstreamNodeIds: [],
      upstreamAssetIds: [],
      inputImageAssetIds: [],
    },
  };

  let disabledReason: string | null = null;
  let readyMessage: string | null = null;

  if (!model) {
    disabledReason = "Selected model is unavailable.";
  } else if (model.capabilities.availability !== "ready") {
    disabledReason = `${model.displayName} is coming soon.`;
  } else if (getFirstUnconfiguredRequirement(model.capabilities)) {
    disabledReason =
      formatProviderRequirementMessage(getFirstUnconfiguredRequirement(model.capabilities)) ||
      `${model.displayName} is not runnable right now.`;
  } else if (isProviderAccessBlocked(model.capabilities)) {
    disabledReason = formatProviderAccessMessage(model.capabilities) || `${model.displayName} is not runnable right now.`;
  } else if (!isRunnableTextModel(model.providerId, model.modelId)) {
    disabledReason = `${model.displayName} is not available for copilot text generation.`;
  } else if (!model.capabilities.executionModes.includes("generate")) {
    disabledReason = `${model.displayName} does not support generate mode.`;
  } else if (model.capabilities.promptMode === "required" && !trimmedPrompt) {
    disabledReason = "Enter a prompt.";
  } else if (model.capabilities.promptMode === "unsupported" && trimmedPrompt) {
    disabledReason = `${model.displayName} does not support prompt input.`;
  } else if (resolvedTextSettings?.validationError) {
    disabledReason = resolvedTextSettings.validationError;
  } else {
    readyMessage = `Ready to generate ${getOpenAiTextOutputTargetLabel(
      readOpenAiTextOutputTarget(effectiveSettings.textOutputTarget)
    )} with ${model.displayName}.`;
  }

  return {
    variant,
    model,
    requestPayload,
    disabledReason,
    readyMessage,
  };
}

export function formatCanvasCopilotSuccessMessage(summary: CanvasCopilotHydrationSummary) {
  const nodeLabel = `${summary.addedNodeCount} node${summary.addedNodeCount === 1 ? "" : "s"}`;
  const connectedLabel =
    summary.connectedCount > 0
      ? ` Connected ${summary.connectedCount} pair${summary.connectedCount === 1 ? "" : "s"}.`
      : "";
  const skippedLabel =
    summary.skippedConnectionCount > 0
      ? ` Skipped ${summary.skippedConnectionCount} invalid connection${summary.skippedConnectionCount === 1 ? "" : "s"}.`
      : "";

  return `Added ${nodeLabel}.${connectedLabel}${skippedLabel}`.trim();
}

export function applyCanvasCopilotSuccessSummaries(
  messages: CanvasCopilotMessage[],
  summaries: Map<string, CanvasCopilotHydrationSummary>
) {
  return messages.map((message) => {
    if (!message.jobId || message.state !== "pending") {
      return message;
    }

    const summary = summaries.get(message.jobId);
    if (!summary) {
      return message;
    }

    return {
      ...message,
      text: formatCanvasCopilotSuccessMessage(summary),
      state: "success" as const,
    };
  });
}
