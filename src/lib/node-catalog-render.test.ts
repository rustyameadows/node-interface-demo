import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderModel } from "@/components/workspace/types";
import { getNodeCatalogEntry } from "@/lib/node-catalog";
import { buildNodeCatalogCanvasRenderNodes } from "@/lib/node-catalog-render";

function createProviderModel(overrides: Partial<ProviderModel>): ProviderModel {
  return {
    providerId: "openai",
    modelId: "gpt-image-1.5",
    displayName: "GPT Image 1.5",
    capabilities: {
      text: false,
      image: true,
      video: false,
      runnable: true,
      availability: "ready",
      billingAvailability: "free_and_paid",
      accessStatus: "available",
      accessReason: null,
      accessMessage: null,
      lastCheckedAt: null,
      requiresApiKeyEnv: "OPENAI_API_KEY",
      apiKeyConfigured: true,
      requirements: [],
      promptMode: "required",
      executionModes: ["generate", "edit"],
      acceptedInputMimeTypes: [],
      maxInputImages: 0,
      parameters: [],
      defaults: {},
    },
    ...overrides,
  };
}

const sampleProviders: ProviderModel[] = [
  createProviderModel({
    providerId: "openai",
    modelId: "gpt-image-1.5",
    displayName: "GPT Image 1.5",
  }),
  createProviderModel({
    providerId: "google-gemini",
    modelId: "gemini-2.5-flash-image",
    displayName: "Nano Banana 2",
  }),
];

test("model catalog specimen resolves the primary preview shell", () => {
  const entry = getNodeCatalogEntry("model", sampleProviders);
  assert.ok(entry);

  const fixture = entry.buildPlaygroundFixture(sampleProviders);
  const renderNodes = buildNodeCatalogCanvasRenderNodes({
    nodes: fixture.nodes,
    providerModels: sampleProviders,
  });
  const primaryNode = renderNodes.find((node) => node.id === fixture.primaryNodeId);

  assert.ok(primaryNode);
  assert.equal(primaryNode.kind, "model");
  assert.equal(primaryNode.renderMode, "preview");
  assert.equal(primaryNode.displayModelName, "GPT Image 1.5");
  assert.equal(primaryNode.previewImageUrl, null);
});

test("template catalog specimen keeps merged preview metadata", () => {
  const entry = getNodeCatalogEntry("text-template", sampleProviders);
  assert.ok(entry);

  const fixture = entry.buildPlaygroundFixture(sampleProviders);
  const renderNodes = buildNodeCatalogCanvasRenderNodes({
    nodes: fixture.nodes,
    providerModels: sampleProviders,
  });
  const primaryNode = renderNodes.find((node) => node.id === fixture.primaryNodeId);

  assert.ok(primaryNode);
  assert.equal(primaryNode.kind, "text-template");
  assert.equal(primaryNode.renderMode, "resized");
  assert.equal(primaryNode.templateReady, true);
  assert.deepEqual(primaryNode.templateTokens, ["Animal", "Pose", "Cute traits"]);
  assert.ok((primaryNode.templatePreviewRows || []).length > 0);
});

test("generated asset catalog specimen keeps generated lineage and preview placeholder", () => {
  const entry = getNodeCatalogEntry("asset-generated", sampleProviders);
  assert.ok(entry);

  const fixture = entry.buildPlaygroundFixture(sampleProviders);
  const renderNodes = buildNodeCatalogCanvasRenderNodes({
    nodes: fixture.nodes,
    providerModels: sampleProviders,
  });
  const primaryNode = renderNodes.find((node) => node.id === fixture.primaryNodeId);

  assert.ok(primaryNode);
  assert.equal(primaryNode.kind, "asset-source");
  assert.equal(primaryNode.assetOrigin, "generated");
  assert.equal(primaryNode.sourceModelNodeId, "library-generated-model");
  assert.match(primaryNode.previewImageUrl || "", /^data:image\/svg\+xml/);
  assert.equal(primaryNode.displaySourceLabel, "Generated Asset");
});
