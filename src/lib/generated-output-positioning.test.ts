import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGeneratedImageOutputPosition,
  buildGeneratedTextOutputPosition,
  getGeneratedModelSpawnAnchor,
  resolveGeneratedOutputVisualIndex,
  resolveGeneratedTextNodePlacement,
} from "@/lib/generated-output-positioning";

test("active preview models spawn from the visible expanded edge", () => {
  const previewAnchor = getGeneratedModelSpawnAnchor({
    modelNode: {
      id: "model-1",
      kind: "model",
      outputType: "image",
      displayMode: "preview",
      size: null,
      x: 120,
      y: 180,
    },
    activeNodeId: null,
    fullNodeId: null,
  });
  const expandedAnchor = getGeneratedModelSpawnAnchor({
    modelNode: {
      id: "model-1",
      kind: "model",
      outputType: "image",
      displayMode: "preview",
      size: null,
      x: 120,
      y: 180,
    },
    activeNodeId: "model-1",
    fullNodeId: "model-1",
  });

  assert.deepEqual(previewAnchor, {
    x: 440,
    y: 180,
  });
  assert.deepEqual(expandedAnchor, {
    x: 1184,
    y: 180,
  });
});

test("builds image output positions from the visible model edge anchor", () => {
  const position = buildGeneratedImageOutputPosition(
    {
      x: 1184,
      y: 180,
    },
    0
  );

  assert.deepEqual(position, {
    x: 1184,
    y: 180,
  });
});

test("falls back to output index when generated image visual index is missing", () => {
  assert.equal(resolveGeneratedOutputVisualIndex(undefined, 3), 3);
  assert.equal(resolveGeneratedOutputVisualIndex(null, 1), 1);
});

test("clamps invalid generated image visual indexes to a safe value", () => {
  assert.equal(resolveGeneratedOutputVisualIndex(-8, 4), 0);
  assert.equal(resolveGeneratedOutputVisualIndex("bad", "also-bad"), 0);
});

test("single generated text outputs reuse the placeholder position exactly", () => {
  const placement = resolveGeneratedTextNodePlacement({
    descriptorOrderIndex: 0,
    fallbackVisualIndex: 3,
    exactPendingNode: {
      id: "placeholder-1",
      x: 480,
      y: 260,
    },
    genericSmartPlaceholderNode: {
      id: "placeholder-1",
      x: 480,
      y: 260,
    },
    allowGenericSmartPlaceholder: true,
    modelAnchor: {
      x: 880,
      y: 200,
    },
  });

  assert.equal(placement.pendingNode?.id, "placeholder-1");
  assert.deepEqual(placement.position, {
    x: 480,
    y: 260,
  });
  assert.equal(placement.claimsGenericSmartPlaceholder, true);
});

test("multi output smart runs cascade from the claimed placeholder anchor", () => {
  const placement = resolveGeneratedTextNodePlacement({
    descriptorOrderIndex: 1,
    fallbackVisualIndex: 7,
    exactPendingNode: null,
    genericSmartPlaceholderNode: {
      id: "placeholder-1",
      x: 480,
      y: 260,
    },
    allowGenericSmartPlaceholder: true,
    modelAnchor: {
      x: 880,
      y: 200,
    },
  });

  assert.equal(placement.pendingNode, null);
  assert.deepEqual(placement.position, buildGeneratedTextOutputPosition({ x: 480, y: 260 }, 1));
});

test("descriptor-specific pending nodes beat generic smart placeholders", () => {
  const placement = resolveGeneratedTextNodePlacement({
    descriptorOrderIndex: 0,
    fallbackVisualIndex: 2,
    exactPendingNode: {
      id: "descriptor-node",
      x: 640,
      y: 420,
    },
    genericSmartPlaceholderNode: {
      id: "generic-placeholder",
      x: 480,
      y: 260,
    },
    allowGenericSmartPlaceholder: true,
    modelAnchor: {
      x: 880,
      y: 200,
    },
  });

  assert.equal(placement.pendingNode?.id, "descriptor-node");
  assert.deepEqual(placement.position, {
    x: 640,
    y: 420,
  });
  assert.equal(placement.ignoreGenericSmartPlaceholder, true);
});
