import assert from "node:assert/strict";
import test from "node:test";
import type { WorkflowNode } from "@/components/workspace/types";
import { getNodePlaygroundPreviewImageUrl } from "@/lib/node-playground-preview";

function createAssetNode(
  overrides?: Partial<Pick<WorkflowNode, "kind" | "outputType" | "sourceAssetId">>
): Pick<WorkflowNode, "kind" | "outputType" | "sourceAssetId"> {
  return {
    kind: "asset-source",
    outputType: "image",
    sourceAssetId: null,
    ...overrides,
  };
}

test("node playground preview uses a placeholder for image assets without a file reference", () => {
  const previewImageUrl = getNodePlaygroundPreviewImageUrl(createAssetNode());

  assert.ok(previewImageUrl);
  assert.match(previewImageUrl, /^data:image\/svg\+xml/);
});

test("node playground preview skips placeholder images when the asset already has a file reference", () => {
  const previewImageUrl = getNodePlaygroundPreviewImageUrl(
    createAssetNode({ sourceAssetId: "asset-123" })
  );

  assert.equal(previewImageUrl, null);
});

test("node playground preview only applies to image asset nodes", () => {
  assert.equal(getNodePlaygroundPreviewImageUrl(createAssetNode({ outputType: "video" })), null);
  assert.equal(getNodePlaygroundPreviewImageUrl(createAssetNode({ kind: "model" })), null);
});
