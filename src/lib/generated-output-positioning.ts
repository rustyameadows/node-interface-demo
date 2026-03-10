import type { WorkflowNode } from "@/components/workspace/types";
import { resolveCanvasNodePresentation } from "@/lib/canvas-node-presentation";

export const MODEL_OUTPUT_PREVIEW_GAP = 84;
const GENERATED_OUTPUT_ROWS_PER_COLUMN = 4;
const GENERATED_IMAGE_OUTPUT_COLUMN_OFFSET_X = 40;
const GENERATED_IMAGE_OUTPUT_OFFSET_Y = 38;
const GENERATED_TEXT_OUTPUT_OFFSET_Y = 172;

export type CanvasPoint = {
  x: number;
  y: number;
};

export type GeneratedOutputPlacementNode = Pick<WorkflowNode, "id" | "x" | "y">;

export function resolveGeneratedOutputVisualIndex(visualIndex: unknown, outputIndex: unknown) {
  if (typeof visualIndex === "number" && Number.isFinite(visualIndex)) {
    return Math.max(0, Math.trunc(visualIndex));
  }

  if (typeof outputIndex === "number" && Number.isFinite(outputIndex)) {
    return Math.max(0, Math.trunc(outputIndex));
  }

  return 0;
}

export function getGeneratedModelSpawnAnchor(input: {
  modelNode: Pick<WorkflowNode, "id" | "kind" | "outputType" | "displayMode" | "size" | "x" | "y">;
  activeNodeId: string | null;
  fullNodeId: string | null;
}) {
  const presentation = resolveCanvasNodePresentation({
    node: input.modelNode,
    activeNodeId: input.activeNodeId,
    fullNodeId: input.fullNodeId,
    nodeId: input.modelNode.id,
  });

  return {
    x: Math.round(input.modelNode.x + presentation.size.width + MODEL_OUTPUT_PREVIEW_GAP),
    y: Math.round(input.modelNode.y),
  } satisfies CanvasPoint;
}

function buildGeneratedOutputPositionFromAnchor(input: {
  anchor: CanvasPoint;
  visualIndex: number;
  columnOffsetX: number;
  offsetY: number;
}) {
  return {
    x: Math.round(input.anchor.x + Math.floor(input.visualIndex / GENERATED_OUTPUT_ROWS_PER_COLUMN) * input.columnOffsetX),
    y: Math.round(input.anchor.y + (input.visualIndex % GENERATED_OUTPUT_ROWS_PER_COLUMN) * input.offsetY),
  } satisfies CanvasPoint;
}

export function buildGeneratedImageOutputPosition(anchor: CanvasPoint, visualIndex: number) {
  return buildGeneratedOutputPositionFromAnchor({
    anchor,
    visualIndex,
    columnOffsetX: GENERATED_IMAGE_OUTPUT_COLUMN_OFFSET_X,
    offsetY: GENERATED_IMAGE_OUTPUT_OFFSET_Y,
  });
}

export function buildGeneratedTextOutputPosition(anchor: CanvasPoint, visualIndex: number) {
  return buildGeneratedOutputPositionFromAnchor({
    anchor,
    visualIndex,
    columnOffsetX: 0,
    offsetY: GENERATED_TEXT_OUTPUT_OFFSET_Y,
  });
}

export function resolveGeneratedTextNodePlacement(input: {
  descriptorOrderIndex: number;
  fallbackVisualIndex: number;
  exactPendingNode: GeneratedOutputPlacementNode | null;
  genericSmartPlaceholderNode: GeneratedOutputPlacementNode | null;
  allowGenericSmartPlaceholder: boolean;
  modelAnchor: CanvasPoint;
}) {
  if (input.exactPendingNode) {
    return {
      pendingNode: input.exactPendingNode,
      position: {
        x: input.exactPendingNode.x,
        y: input.exactPendingNode.y,
      } satisfies CanvasPoint,
      claimsGenericSmartPlaceholder: Boolean(
        input.genericSmartPlaceholderNode && input.exactPendingNode.id === input.genericSmartPlaceholderNode.id
      ),
      ignoreGenericSmartPlaceholder: Boolean(
        input.descriptorOrderIndex === 0 &&
          input.genericSmartPlaceholderNode &&
          input.exactPendingNode.id !== input.genericSmartPlaceholderNode.id
      ),
    };
  }

  if (input.allowGenericSmartPlaceholder && input.genericSmartPlaceholderNode) {
    if (input.descriptorOrderIndex === 0) {
      return {
        pendingNode: input.genericSmartPlaceholderNode,
        position: {
          x: input.genericSmartPlaceholderNode.x,
          y: input.genericSmartPlaceholderNode.y,
        } satisfies CanvasPoint,
        claimsGenericSmartPlaceholder: true,
        ignoreGenericSmartPlaceholder: false,
      };
    }

    return {
      pendingNode: null,
      position: buildGeneratedTextOutputPosition(input.genericSmartPlaceholderNode, input.descriptorOrderIndex),
      claimsGenericSmartPlaceholder: false,
      ignoreGenericSmartPlaceholder: false,
    };
  }

  return {
    pendingNode: null,
    position: buildGeneratedTextOutputPosition(input.modelAnchor, input.fallbackVisualIndex),
    claimsGenericSmartPlaceholder: false,
    ignoreGenericSmartPlaceholder: false,
  };
}
