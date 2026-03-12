import type { WorkflowNodeDisplayMode, WorkflowNodeSize } from "@/components/workspace/types";
import type { CanvasNodeRenderMode } from "@/lib/canvas-node-presentation";

export type NodePlaygroundMode = "compact" | "preview" | "edit" | "resize";

export function getInitialNodePlaygroundMode(
  displayMode: WorkflowNodeDisplayMode,
  opensInEdit = false
): NodePlaygroundMode {
  if (opensInEdit) {
    return "edit";
  }

  if (displayMode === "compact") {
    return "compact";
  }

  if (displayMode === "resized") {
    return "resize";
  }

  return "preview";
}

export function getActiveNodePlaygroundMode(
  persistedMode: WorkflowNodeDisplayMode,
  renderMode: CanvasNodeRenderMode
): NodePlaygroundMode {
  if (renderMode === "full") {
    return "edit";
  }

  if (renderMode === "resized") {
    return "resize";
  }

  if (persistedMode === "compact") {
    return "compact";
  }

  return "preview";
}

export function positionNodeAroundCenter(
  center: { x: number; y: number },
  size: WorkflowNodeSize
) {
  return {
    x: Math.round(center.x - size.width / 2),
    y: Math.round(center.y - size.height / 2),
  };
}

export function preserveNodeCenterPosition(
  position: { x: number; y: number },
  currentSize: WorkflowNodeSize,
  nextSize: WorkflowNodeSize
) {
  return positionNodeAroundCenter(
    {
      x: position.x + currentSize.width / 2,
      y: position.y + currentSize.height / 2,
    },
    nextSize
  );
}

export function buildCenteredViewportForNode(input: {
  zoom: number;
  nodePosition: { x: number; y: number };
  nodeSize: WorkflowNodeSize;
  surfaceSize: { width: number; height: number };
}) {
  const zoom = input.zoom;
  const nodeCenterX = input.nodePosition.x + input.nodeSize.width / 2;
  const nodeCenterY = input.nodePosition.y + input.nodeSize.height / 2;

  return {
    zoom,
    x: Math.round(input.surfaceSize.width / 2 - nodeCenterX * zoom),
    y: Math.round(input.surfaceSize.height / 2 - nodeCenterY * zoom),
  };
}

export function buildFramedViewportForNode(input: {
  nodePosition: { x: number; y: number };
  nodeSize: WorkflowNodeSize;
  surfaceSize: { width: number; height: number };
}) {
  const availableWidth = Math.max(200, input.surfaceSize.width - 160);
  const availableHeight = Math.max(160, input.surfaceSize.height - 128);
  const fitZoom = Math.min(
    availableWidth / input.nodeSize.width,
    availableHeight / input.nodeSize.height
  );
  const zoom = Math.min(1.5, Math.max(0.8, fitZoom));

  return buildCenteredViewportForNode({
    zoom,
    nodePosition: input.nodePosition,
    nodeSize: input.nodeSize,
    surfaceSize: input.surfaceSize,
  });
}

export function buildNodePlaygroundTransitionLayout(input: {
  currentPosition: { x: number; y: number };
  currentSize: WorkflowNodeSize;
  nextSize: WorkflowNodeSize;
  surfaceSize: { width: number; height: number };
}) {
  const targetCenter = {
    x: input.currentPosition.x + input.currentSize.width / 2,
    y: input.currentPosition.y + input.currentSize.height / 2,
  };
  const nodePosition = positionNodeAroundCenter(targetCenter, input.nextSize);

  return {
    targetCenter,
    nodePosition,
    viewport: buildFramedViewportForNode({
      nodePosition,
      nodeSize: input.nextSize,
      surfaceSize: input.surfaceSize,
    }),
  };
}

export function buildNodePlaygroundMeasuredCorrection(input: {
  targetCenter: { x: number; y: number };
  measuredSize: WorkflowNodeSize;
  surfaceSize: { width: number; height: number };
}) {
  const nodePosition = positionNodeAroundCenter(input.targetCenter, input.measuredSize);

  return {
    nodePosition,
    viewport: buildFramedViewportForNode({
      nodePosition,
      nodeSize: input.measuredSize,
      surfaceSize: input.surfaceSize,
    }),
  };
}

export function shouldCorrectNodePlaygroundMeasuredSize(
  predictedSize: WorkflowNodeSize,
  measuredSize: WorkflowNodeSize,
  tolerance = 1
) {
  return (
    Math.abs(predictedSize.width - measuredSize.width) > tolerance ||
    Math.abs(predictedSize.height - measuredSize.height) > tolerance
  );
}
