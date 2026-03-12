import type {
  CanvasNodeGeneratedProvenance,
  CanvasRenderNode,
} from "@/components/canvas-node-types";
import type { ProviderModel, WorkflowNode } from "@/components/workspace/types";
import {
  type CanvasNodeRenderMode,
  resolveCanvasNodePresentation,
} from "@/lib/canvas-node-presentation";
import { getUploadedAssetNodeAspectRatio } from "@/lib/canvas-asset-nodes";
import { getNodePlaygroundPreviewImageUrl } from "@/lib/node-playground-preview";
import {
  buildTextTemplatePreview,
  getGeneratedModelNodeSource,
  getGeneratedTextNoteSettings,
  getListNodeSettings,
} from "@/lib/list-template";

function outputSemanticType(node: WorkflowNode) {
  if (node.kind === "text-template") {
    return "operator" as const;
  }
  if (node.kind === "model") {
    return "citrus" as const;
  }
  return node.outputType;
}

function getNodeSourceJobId(node: WorkflowNode | null | undefined) {
  if (!node) {
    return null;
  }

  if (node.sourceJobId) {
    return node.sourceJobId;
  }

  if (
    node.settings &&
    typeof node.settings === "object" &&
    typeof (node.settings as Record<string, unknown>).sourceJobId === "string"
  ) {
    return String((node.settings as Record<string, unknown>).sourceJobId);
  }

  return null;
}

function getSourceModelNodeId(node: WorkflowNode) {
  if (node.settings && typeof node.settings === "object") {
    const value = (node.settings as Record<string, unknown>).sourceModelNodeId;
    return typeof value === "string" ? value : null;
  }

  return null;
}

function isGeneratedAssetNode(node: WorkflowNode) {
  return node.kind === "asset-source" && getNodeSourceJobId(node) !== null;
}

function getGeneratedNodeProvenance(node: WorkflowNode): CanvasNodeGeneratedProvenance | null {
  if (node.kind === "asset-source" && isGeneratedAssetNode(node)) {
    return "model";
  }

  if (node.kind === "text-note" && getGeneratedTextNoteSettings(node.settings)) {
    return "operator";
  }

  return getGeneratedModelNodeSource(node.settings) ? "model" : null;
}

function buildRenderNode(input: {
  node: WorkflowNode;
  allNodes: WorkflowNode[];
  nodesById: Record<string, WorkflowNode>;
  displayNameMap: Record<string, string>;
  activeNodeId: string | null;
  fullNodeId: string | null;
  forcedRenderMode?: CanvasNodeRenderMode | null;
}) {
  const { node, allNodes, nodesById, displayNameMap } = input;
  const listSettings = node.kind === "list" ? getListNodeSettings(node.settings) : null;
  const connectedListNode =
    node.kind === "text-template"
      ? allNodes.find((candidate) => candidate.id === node.upstreamNodeIds[0] && candidate.kind === "list") || null
      : null;
  const templatePreview =
    node.kind === "text-template"
      ? buildTextTemplatePreview(
          node.prompt,
          connectedListNode ? getListNodeSettings(connectedListNode.settings) : null
        )
      : null;
  const uploadedAssetAspectRatio = getUploadedAssetNodeAspectRatio(node) || undefined;
  const presentation = resolveCanvasNodePresentation({
    node,
    activeNodeId: input.activeNodeId,
    fullNodeId: input.fullNodeId,
    nodeId: node.id,
    aspectRatio: uploadedAssetAspectRatio,
    forcedRenderMode: input.forcedRenderMode ?? null,
  });
  const generatedProvenance = getGeneratedNodeProvenance(node);

  return {
    ...node,
    presentation,
    assetOrigin: node.kind === "asset-source" ? (isGeneratedAssetNode(node) ? "generated" : "uploaded") : null,
    sourceModelNodeId: getSourceModelNodeId(node),
    generatedProvenance,
    displayModelName:
      node.kind === "asset-source"
        ? null
        : node.kind === "list"
          ? "List"
          : node.kind === "text-template"
            ? "Template"
            : displayNameMap[`${node.providerId}:${node.modelId}`] || node.modelId,
    displaySourceLabel:
      node.kind === "asset-source"
        ? isGeneratedAssetNode(node)
          ? "Generated Asset"
          : "Uploaded Asset"
        : node.kind === "list"
          ? `${listSettings?.columns.length || 0} col${(listSettings?.columns.length || 0) === 1 ? "" : "s"}`
          : node.kind === "text-template"
            ? templatePreview?.disabledReason || `${templatePreview?.nonBlankRowCount || 0} rows ready`
            : displayNameMap[`${node.providerId}:${node.modelId}`] || node.modelId,
    inputSemanticTypes: [
      ...(node.kind === "model" && node.promptSourceNodeId ? (["text"] as const) : []),
      ...node.upstreamNodeIds
        .map((nodeId) => nodesById[nodeId] || null)
        .filter((inputNode): inputNode is WorkflowNode => Boolean(inputNode))
        .map((inputNode) => outputSemanticType(inputNode)),
    ],
    outputSemanticType: outputSemanticType(node),
    previewImageUrl: getNodePlaygroundPreviewImageUrl(node),
    hasStartedJob: node.kind === "model" ? true : undefined,
    listPreviewColumns: listSettings?.columns.slice(0, 3).map((column) => column.label) || [],
    listPreviewRows:
      listSettings?.rows.slice(0, 3).map((row) =>
        listSettings.columns.slice(0, 3).map((column) => String(row.values[column.id] || "—"))
      ) || [],
    listRowCount: listSettings?.rows.length || 0,
    listColumnCount: listSettings?.columns.length || 0,
    templateRegisteredColumnCount: templatePreview?.columns.length || 0,
    templateUnresolvedCount: templatePreview?.unresolvedTokens.length || 0,
    templateReady: Boolean(templatePreview && !templatePreview.disabledReason),
    templateTokens:
      (templatePreview?.columns.length || 0) > 0
        ? (templatePreview?.columns || []).map((column) => column.label)
        : (templatePreview?.tokens || []).map((token) => token.label),
    templatePreviewRows: (templatePreview?.rows || []).slice(0, 4).map((row) => row.text),
    templateStatusMessage: templatePreview?.disabledReason || templatePreview?.readyMessage || null,
    renderMode: presentation.renderMode,
    canResize: presentation.canResize,
    lockAspectRatio: presentation.lockAspectRatio,
    resolvedSize: presentation.size,
  } satisfies CanvasRenderNode;
}

export function buildNodeCatalogCanvasRenderNodes(input: {
  nodes: WorkflowNode[];
  providerModels: ProviderModel[];
  activeNodeId?: string | null;
  fullNodeId?: string | null;
  forcedRenderModesById?: Partial<Record<string, CanvasNodeRenderMode | null>>;
}) {
  const nodesById = input.nodes.reduce<Record<string, WorkflowNode>>((acc, node) => {
    acc[node.id] = node;
    return acc;
  }, {});
  const displayNameMap = input.providerModels.reduce<Record<string, string>>((acc, model) => {
    acc[`${model.providerId}:${model.modelId}`] = model.displayName;
    return acc;
  }, {});

  return input.nodes.map((node) =>
    buildRenderNode({
      node,
      allNodes: input.nodes,
      nodesById,
      displayNameMap,
      activeNodeId: input.activeNodeId ?? null,
      fullNodeId: input.fullNodeId ?? null,
      forcedRenderMode: input.forcedRenderModesById?.[node.id] ?? null,
    })
  );
}

export function buildNodeCatalogCanvasRenderNode(input: {
  node: WorkflowNode;
  nodes: WorkflowNode[];
  providerModels: ProviderModel[];
  activeNodeId?: string | null;
  fullNodeId?: string | null;
  forcedRenderMode?: CanvasNodeRenderMode | null;
}) {
  const nodes = input.nodes.map((candidate) => (candidate.id === input.node.id ? input.node : candidate));

  return (
    buildNodeCatalogCanvasRenderNodes({
      nodes,
      providerModels: input.providerModels,
      activeNodeId: input.activeNodeId ?? null,
      fullNodeId: input.fullNodeId ?? null,
      forcedRenderModesById: {
        [input.node.id]: input.forcedRenderMode ?? null,
      },
    }).find((candidate) => candidate.id === input.node.id) || null
  );
}
