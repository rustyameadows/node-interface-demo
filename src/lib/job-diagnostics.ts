import type {
  CanvasDocument,
  Job,
  JobAttemptDebug,
  JobCanvasImpact,
  JobDebugAssetReference,
  JobDebugCountBreakdown,
  JobDebugNormalizedOutput,
  JobDebugPreviewFrame,
  JobDebugProviderObjectCount,
  JobOutputReconciliation,
  WorkflowNode,
} from "@/components/workspace/types";
import type { GeneratedNodeDescriptor } from "@/lib/generated-text-output";
import { formatGeminiMixedOutputDiagnosticsNotice, type GeminiMixedOutputDiagnostics } from "@/lib/gemini-mixed-output";

export type JobPrettySection = {
  title: string;
  items: Array<{
    label: string;
    value: string;
  }>;
  note?: string | null;
};

export type JobDiagnosticStat = {
  label: string;
  value: string;
  note?: string | null;
};

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asRecordArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
}

function normalizeOutputType(value: unknown): WorkflowNode["outputType"] | null {
  if (value === "text" || value === "image" || value === "video") {
    return value;
  }
  return null;
}

function formatCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function buildCountBreakdown<Key extends string>(values: Key[]): JobDebugCountBreakdown<Key>[] {
  const counts = new Map<Key, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

export function buildJobProviderObjectCounts(
  diagnostics: GeminiMixedOutputDiagnostics | null | undefined
): JobDebugProviderObjectCount[] {
  if (!diagnostics) {
    return [];
  }

  const counts: JobDebugProviderObjectCount[] = [];
  if (diagnostics.imagePartCount > 0) {
    counts.push({ label: "image parts", count: diagnostics.imagePartCount });
  }
  if (diagnostics.candidateTextPartCount > 0) {
    counts.push({ label: "candidate text parts", count: diagnostics.candidateTextPartCount });
  }
  if (diagnostics.rawResponseTextPresent) {
    counts.push({ label: "raw response text", count: 1 });
  }
  return counts;
}

export function getNormalizedOutputsFromProviderResponse(
  providerResponse: Record<string, unknown> | null | undefined
): JobDebugNormalizedOutput[] {
  if (!providerResponse || typeof providerResponse !== "object") {
    return [];
  }

  return asRecordArray(providerResponse.outputs)
    .map((output, index) => {
      const type = normalizeOutputType(output.type);
      if (!type || typeof output.mimeType !== "string" || typeof output.extension !== "string") {
        return null;
      }

      const metadata = asRecord(output.metadata) || {};
      const outputIndex =
        typeof metadata.outputIndex === "number"
          ? Number(metadata.outputIndex)
          : typeof output.outputIndex === "number"
            ? Number(output.outputIndex)
            : index;

      return {
        outputIndex,
        type,
        mimeType: output.mimeType,
        extension: output.extension,
        responseId: typeof metadata.responseId === "string" ? metadata.responseId : null,
        content: type === "text" && typeof output.content === "string" ? output.content : null,
        metadata,
      } satisfies JobDebugNormalizedOutput;
    })
    .filter((output): output is JobDebugNormalizedOutput => Boolean(output))
    .sort((left, right) => left.outputIndex - right.outputIndex);
}

export function getInputAssetsFromProviderRequest(
  providerRequest: Record<string, unknown> | null | undefined
): JobDebugAssetReference[] {
  if (!providerRequest || typeof providerRequest !== "object") {
    return [];
  }

  return asRecordArray(providerRequest.inputAssets).map((asset) => ({
    id: typeof asset.assetId === "string" ? asset.assetId : "",
    type: normalizeOutputType(asset.type) || "image",
    mimeType: typeof asset.mimeType === "string" ? asset.mimeType : "application/octet-stream",
    outputIndex: null,
    createdAt: typeof asset.createdAt === "string" ? asset.createdAt : "",
    storageRef: typeof asset.storageRef === "string" ? asset.storageRef : "",
    width: typeof asset.width === "number" ? asset.width : null,
    height: typeof asset.height === "number" ? asset.height : null,
    durationMs: typeof asset.durationMs === "number" ? asset.durationMs : null,
  }));
}

export function buildJobCanvasImpact(
  canvasDocument: CanvasDocument | null | undefined,
  jobId: string
): JobCanvasImpact {
  const nodes = canvasDocument?.workflow.nodes || [];
  const matchingNodes = nodes.filter((node) => {
    if (node.sourceJobId === jobId) {
      return true;
    }

    return typeof node.settings.sourceJobId === "string" && node.settings.sourceJobId === jobId;
  });

  return {
    totalNodeCount: matchingNodes.length,
    pendingNodeCount: matchingNodes.filter((node) => node.processingState !== null).length,
    finishedNodeCount: matchingNodes.filter((node) => node.processingState === null).length,
    nodeKinds: buildCountBreakdown(matchingNodes.map((node) => node.kind)),
  };
}

export function buildJobOutputReconciliation(input: {
  job: Job;
  normalizedOutputs: JobDebugNormalizedOutput[];
  outputAssets: JobDebugAssetReference[];
  previewFrames: JobDebugPreviewFrame[];
  generatedNodeDescriptors: GeneratedNodeDescriptor[];
  canvasImpact: JobCanvasImpact;
  mixedOutputDiagnostics: GeminiMixedOutputDiagnostics | null | undefined;
}): JobOutputReconciliation {
  return {
    requestedOutputCount: input.job.nodeRunPayload?.outputCount || 1,
    requestedOutputType: input.job.nodeRunPayload?.outputType || null,
    normalizedOutputCount: input.normalizedOutputs.length,
    normalizedOutputTypes: buildCountBreakdown(input.normalizedOutputs.map((output) => output.type)),
    providerObjectCounts: buildJobProviderObjectCounts(input.mixedOutputDiagnostics),
    persistedAssetCount: input.outputAssets.length,
    persistedAssetTypes: buildCountBreakdown(input.outputAssets.map((asset) => asset.type)),
    previewFrameCount: input.previewFrames.length,
    textOutputCount: input.normalizedOutputs.filter((output) => output.type === "text").length,
    generatedDescriptorCount: input.generatedNodeDescriptors.length,
    generatedDescriptorKinds: buildCountBreakdown(input.generatedNodeDescriptors.map((descriptor) => descriptor.kind)),
    canvasNodeCount: input.canvasImpact.totalNodeCount,
    canvasNodeKinds: input.canvasImpact.nodeKinds,
  };
}

export function buildJobAttemptRequestSummary(
  providerRequest: Record<string, unknown> | null | undefined
): NonNullable<JobAttemptDebug["requestSummary"]> {
  const request = asRecord(providerRequest) || {};
  const payload = asRecord(request.payload) || {};
  const settings = asRecord(payload.settings);

  return {
    executionMode: payload.executionMode === "generate" || payload.executionMode === "edit" ? payload.executionMode : null,
    requestedOutputCount: typeof payload.outputCount === "number" ? Number(payload.outputCount) : null,
    promptLength: typeof payload.prompt === "string" ? payload.prompt.length : 0,
    inputAssetCount: asRecordArray(request.inputAssets).length,
    settingCount: settings ? Object.keys(settings).length : 0,
  };
}

export function buildJobAttemptResponseSummary(
  providerResponse: Record<string, unknown> | null | undefined,
  mixedOutputDiagnostics: GeminiMixedOutputDiagnostics | null | undefined
): NonNullable<JobAttemptDebug["responseSummary"]> {
  const response = asRecord(providerResponse) || {};
  const normalizedOutputs = getNormalizedOutputsFromProviderResponse(response);
  const descriptors = Array.isArray(response.generatedNodeDescriptors) ? response.generatedNodeDescriptors.length : 0;

  return {
    normalizedOutputCount: normalizedOutputs.length,
    normalizedOutputTypes: buildCountBreakdown(normalizedOutputs.map((output) => output.type)),
    previewFrameCount: typeof response.previewFrameCount === "number" ? Number(response.previewFrameCount) : 0,
    textOutputCount: normalizedOutputs.filter((output) => output.type === "text").length,
    generatedDescriptorCount: descriptors,
    providerObjectCounts: buildJobProviderObjectCounts(mixedOutputDiagnostics),
    warning:
      typeof response.generatedNodeDescriptorWarning === "string"
        ? response.generatedNodeDescriptorWarning
        : formatGeminiMixedOutputDiagnosticsNotice(mixedOutputDiagnostics) || null,
  };
}

export function getJobDiagnosticsNotice(input: {
  mixedOutputDiagnostics: GeminiMixedOutputDiagnostics | null | undefined;
  generatedOutputWarning: string | null | undefined;
}) {
  return formatGeminiMixedOutputDiagnosticsNotice(input.mixedOutputDiagnostics) || input.generatedOutputWarning || null;
}

export function formatBreakdownList(
  breakdown: Array<JobDebugCountBreakdown<string>>,
  fallback = "-"
) {
  if (breakdown.length === 0) {
    return fallback;
  }

  return breakdown.map((entry) => `${entry.key} ${entry.count}`).join(" · ");
}

export function describeJobAttemptRequest(attempt: JobAttemptDebug | null | undefined): JobPrettySection[] {
  if (!attempt) {
    return [];
  }

  const request = asRecord(attempt.providerRequest) || {};
  const payload = asRecord(request.payload) || {};
  const providerRequestPreview = asRecord(request.providerRequestPreview);
  const summary = attempt.requestSummary || buildJobAttemptRequestSummary(request);

  return [
    {
      title: "Execution",
      items: [
        { label: "Mode", value: summary.executionMode || "-" },
        {
          label: "Requested outputs",
          value: summary.requestedOutputCount === null ? "-" : String(summary.requestedOutputCount),
        },
        { label: "Prompt characters", value: String(summary.promptLength) },
        { label: "Input assets", value: String(summary.inputAssetCount) },
        { label: "Setting keys", value: String(summary.settingCount) },
      ],
      note: typeof providerRequestPreview?.endpoint === "string" ? providerRequestPreview.endpoint : null,
    },
    {
      title: "Graph inputs",
      items: [
        {
          label: "Prompt source node",
          value: typeof payload.promptSourceNodeId === "string" ? payload.promptSourceNodeId : "-",
        },
        {
          label: "Upstream nodes",
          value: String(Array.isArray(payload.upstreamNodeIds) ? payload.upstreamNodeIds.length : 0),
        },
        {
          label: "Upstream assets",
          value: String(Array.isArray(payload.upstreamAssetIds) ? payload.upstreamAssetIds.length : 0),
        },
      ],
    },
  ];
}

export function describeJobAttemptResponse(attempt: JobAttemptDebug | null | undefined): JobPrettySection[] {
  if (!attempt) {
    return [];
  }

  const response = asRecord(attempt.providerResponse) || {};
  const summary = attempt.responseSummary || buildJobAttemptResponseSummary(response, attempt.mixedOutputDiagnostics);

  return [
    {
      title: "Outputs",
      items: [
        { label: "Normalized outputs", value: String(summary.normalizedOutputCount) },
        { label: "Output types", value: formatBreakdownList(summary.normalizedOutputTypes) },
        { label: "Text outputs", value: String(summary.textOutputCount) },
        { label: "Preview frames", value: String(summary.previewFrameCount) },
        { label: "Generated descriptors", value: String(summary.generatedDescriptorCount) },
      ],
      note: summary.warning,
    },
    {
      title: "Provider objects",
      items:
        summary.providerObjectCounts.length > 0
          ? summary.providerObjectCounts.map((entry) => ({
              label: entry.label,
              value: String(entry.count),
            }))
          : [{ label: "Observed", value: "No provider-specific object counts" }],
    },
  ];
}

export function formatJobOutputReconciliationStats(reconciliation: JobOutputReconciliation): JobDiagnosticStat[] {
  const requestedLabel =
    reconciliation.requestedOutputType && reconciliation.requestedOutputType !== "text"
      ? `${reconciliation.requestedOutputType} output`
      : "output";
  const providerObjectTotal = reconciliation.providerObjectCounts.reduce((total, entry) => total + entry.count, 0);

  return [
    {
      label: "Requested",
      value: formatCount(reconciliation.requestedOutputCount, requestedLabel),
      note: reconciliation.requestedOutputType ? `Node target: ${reconciliation.requestedOutputType}` : "Node target unavailable",
    },
    {
      label: "Normalized",
      value: formatCount(reconciliation.normalizedOutputCount, "output"),
      note: formatBreakdownList(reconciliation.normalizedOutputTypes, "No normalized outputs"),
    },
    {
      label: "Provider objects",
      value:
        reconciliation.providerObjectCounts.length > 0 ? formatCount(providerObjectTotal, "object") : "Not reported",
      note:
        reconciliation.providerObjectCounts.length > 0
          ? reconciliation.providerObjectCounts.map((entry) => `${entry.label} ${entry.count}`).join(" · ")
          : "Provider did not expose raw object counts",
    },
    {
      label: "Assets",
      value: formatCount(reconciliation.persistedAssetCount, "asset"),
      note: formatBreakdownList(reconciliation.persistedAssetTypes, "No persisted assets"),
    },
    {
      label: "Preview frames",
      value: formatCount(reconciliation.previewFrameCount, "preview frame"),
      note: reconciliation.previewFrameCount > 0 ? "Transient provider previews" : "No previews persisted",
    },
    {
      label: "Generated nodes",
      value: formatCount(reconciliation.generatedDescriptorCount, "generated node"),
      note: formatBreakdownList(reconciliation.generatedDescriptorKinds, "No generated descriptors"),
    },
    {
      label: "Canvas nodes",
      value: formatCount(reconciliation.canvasNodeCount, "canvas node"),
      note: formatBreakdownList(reconciliation.canvasNodeKinds, "No canvas nodes"),
    },
  ];
}

export function formatCanvasImpactSummary(canvasImpact: JobCanvasImpact): JobDiagnosticStat[] {
  return [
    {
      label: "Total nodes",
      value: formatCount(canvasImpact.totalNodeCount, "node"),
      note: formatBreakdownList(canvasImpact.nodeKinds, "No nodes materialized"),
    },
    {
      label: "Finished",
      value: formatCount(canvasImpact.finishedNodeCount, "node"),
      note: canvasImpact.finishedNodeCount > 0 ? "Persisted on canvas" : "Nothing finished yet",
    },
    {
      label: "Pending",
      value: formatCount(canvasImpact.pendingNodeCount, "node"),
      note: canvasImpact.pendingNodeCount > 0 ? "Still awaiting hydration" : "No pending placeholders",
    },
  ];
}
