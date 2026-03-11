import assert from "node:assert/strict";
import test from "node:test";
import type { CanvasRenderNode } from "@/components/canvas-node-types";
import {
  centerCanvasInsertPosition,
  DEFAULT_CANVAS_NODE_HEIGHT,
  DEFAULT_CANVAS_NODE_WIDTH,
  sortCanvasNodesForDisplay,
} from "@/lib/canvas-layout";

test("centerCanvasInsertPosition offsets the default preview node size around the anchor point", () => {
  assert.deepEqual(centerCanvasInsertPosition({ x: 400, y: 300 }), {
    x: 400 - DEFAULT_CANVAS_NODE_WIDTH / 2,
    y: 300 - DEFAULT_CANVAS_NODE_HEIGHT / 2,
  });
});

test("centerCanvasInsertPosition respects explicit node dimensions", () => {
  assert.deepEqual(centerCanvasInsertPosition({ x: 500, y: 280 }, { width: 320, height: 180 }), {
    x: 340,
    y: 190,
  });
});

test("sortCanvasNodesForDisplay uses persisted z-order first and preserves source order on ties", () => {
  const nodes = [
    { id: "a", zIndex: 2 },
    { id: "b", zIndex: 1 },
    { id: "c", zIndex: 2 },
    { id: "d", zIndex: 4 },
  ] as CanvasRenderNode[];

  assert.deepEqual(
    sortCanvasNodesForDisplay(nodes).map((node) => node.id),
    ["b", "a", "c", "d"]
  );
});

test("sortCanvasNodesForDisplay returns the original list when there is only one node", () => {
  const nodes = [{ id: "a", zIndex: 1 }] as CanvasRenderNode[];
  assert.equal(sortCanvasNodesForDisplay(nodes), nodes);
});
