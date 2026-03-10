import assert from "node:assert/strict";
import test from "node:test";
import {
  hydrateGeneratedImageNode,
  needsGeneratedImageNodeHydration,
  shouldSkipConsumedGeneratedImageReceipt,
} from "@/lib/generated-image-hydration";
import type { WorkflowNode } from "@/components/workspace/types";

function createGeneratedImageNode(overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id: "asset-node-1",
    label: "Output 1",
    providerId: "google-gemini",
    modelId: "gemini-3.1-flash-image-preview",
    kind: "asset-source",
    nodeType: "transform",
    outputType: "image",
    prompt: "",
    settings: {
      source: "generated",
      sourceJobId: "job-1",
      sourceModelNodeId: "model-1",
      outputIndex: 0,
    },
    sourceAssetId: null,
    sourceAssetMimeType: null,
    sourceJobId: "job-1",
    sourceOutputIndex: 0,
    processingState: "running",
    promptSourceNodeId: null,
    upstreamNodeIds: ["model-1"],
    upstreamAssetIds: ["node:model-1"],
    x: 120,
    y: 240,
    displayMode: "preview",
    size: null,
    ...overrides,
  };
}

test("does not skip a consumed image receipt when the node is still blank", () => {
  const pendingNode = createGeneratedImageNode();

  assert.equal(
    shouldSkipConsumedGeneratedImageReceipt({
      receiptConsumed: true,
      receiptNodes: [pendingNode],
      matchingImageAsset: {
        id: "asset-1",
        mimeType: "image/png",
      },
    }),
    false
  );
  assert.equal(
    needsGeneratedImageNodeHydration(pendingNode, {
      id: "asset-1",
      mimeType: "image/png",
    }),
    true
  );
});

test("skips a consumed image receipt once the node already points at the asset", () => {
  const hydratedNode = createGeneratedImageNode({
    sourceAssetId: "asset-1",
    sourceAssetMimeType: "image/png",
    processingState: null,
  });

  assert.equal(
    shouldSkipConsumedGeneratedImageReceipt({
      receiptConsumed: true,
      receiptNodes: [hydratedNode],
      matchingImageAsset: {
        id: "asset-1",
        mimeType: "image/png",
      },
    }),
    true
  );
});

test("hydrates a pending generated image node in place", () => {
  const pendingNode = createGeneratedImageNode({
    id: "pending-node",
    label: "Output 8",
    x: 400,
    y: 520,
  });
  const baseNode = createGeneratedImageNode({
    id: "base-node",
    label: "Output 9",
    x: 900,
    y: 980,
  });

  const hydrated = hydrateGeneratedImageNode({
    baseNode,
    pendingNode,
    providerId: "google-gemini",
    modelId: "gemini-3.1-flash-image-preview",
    sourceJobId: "job-1",
    outputIndex: 0,
    sourceModelNodeId: "model-1",
    matchingImageAsset: {
      id: "asset-1",
      mimeType: "image/png",
    },
  });

  assert.equal(hydrated.id, "pending-node");
  assert.equal(hydrated.label, "Output 8");
  assert.equal(hydrated.x, 400);
  assert.equal(hydrated.y, 520);
  assert.equal(hydrated.sourceAssetId, "asset-1");
  assert.equal(hydrated.sourceAssetMimeType, "image/png");
  assert.equal(hydrated.processingState, null);
});
