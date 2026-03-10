import type { WorkflowNode } from "@/components/workspace/types";

export type GeneratedImageAssetMatch = {
  id: string;
  mimeType: string;
};

export function needsGeneratedImageNodeHydration(
  node: WorkflowNode,
  matchingImageAsset: GeneratedImageAssetMatch | null
) {
  return (
    node.kind === "asset-source" &&
    node.outputType === "image" &&
    Boolean(matchingImageAsset) &&
    (node.sourceAssetId !== matchingImageAsset.id ||
      node.sourceAssetMimeType !== matchingImageAsset.mimeType ||
      node.processingState !== null)
  );
}

export function shouldSkipConsumedGeneratedImageReceipt(input: {
  receiptConsumed: boolean;
  receiptNodes: WorkflowNode[];
  matchingImageAsset: GeneratedImageAssetMatch | null;
}) {
  if (!input.receiptConsumed) {
    return false;
  }

  return !input.receiptNodes.some((node) =>
    needsGeneratedImageNodeHydration(node, input.matchingImageAsset)
  );
}

export function hydrateGeneratedImageNode(input: {
  baseNode: WorkflowNode;
  pendingNode: WorkflowNode | null;
  providerId: WorkflowNode["providerId"];
  modelId: string;
  sourceJobId: string;
  outputIndex: number;
  sourceModelNodeId: string;
  matchingImageAsset: GeneratedImageAssetMatch;
}) {
  return {
    ...(input.pendingNode || input.baseNode),
    providerId: input.providerId,
    modelId: input.modelId,
    label: input.pendingNode?.label || input.baseNode.label,
    x: input.pendingNode?.x ?? input.baseNode.x,
    y: input.pendingNode?.y ?? input.baseNode.y,
    settings: {
      ...(input.pendingNode?.settings || input.baseNode.settings),
      source: "generated",
      sourceJobId: input.sourceJobId,
      outputIndex: input.outputIndex,
      sourceModelNodeId:
        input.pendingNode?.settings && typeof input.pendingNode.settings.sourceModelNodeId === "string"
          ? input.pendingNode.settings.sourceModelNodeId
          : input.sourceModelNodeId,
    },
    sourceAssetId: input.matchingImageAsset.id,
    sourceAssetMimeType: input.matchingImageAsset.mimeType,
    sourceJobId: input.sourceJobId,
    sourceOutputIndex: input.outputIndex,
    processingState: null,
  } satisfies WorkflowNode;
}
