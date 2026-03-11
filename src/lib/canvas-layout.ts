import type { CanvasRenderNode } from "@/components/canvas-node-types";

export const DEFAULT_CANVAS_NODE_WIDTH = 212;
export const DEFAULT_CANVAS_NODE_HEIGHT = 72;

export function centerCanvasInsertPosition(
  position: { x: number; y: number },
  options?: {
    width?: number;
    height?: number;
  }
) {
  const width = options?.width ?? DEFAULT_CANVAS_NODE_WIDTH;
  const height = options?.height ?? DEFAULT_CANVAS_NODE_HEIGHT;

  return {
    x: Math.round(position.x - width / 2),
    y: Math.round(position.y - height / 2),
  };
}

export function sortCanvasNodesForDisplay(nodes: CanvasRenderNode[]) {
  if (nodes.length <= 1) {
    return nodes;
  }
  return [...nodes]
    .map((node, index) => ({
      node,
      index,
    }))
    .sort((left, right) => {
      if (left.node.zIndex !== right.node.zIndex) {
        return left.node.zIndex - right.node.zIndex;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.node);
}
