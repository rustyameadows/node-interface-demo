import assert from "node:assert/strict";
import test from "node:test";
import { defaultCanvasDocument, type Job } from "@/components/workspace/types";
import {
  buildJobAttemptRequestSummary,
  buildJobAttemptResponseSummary,
  buildJobCanvasImpact,
  buildJobOutputReconciliation,
  describeJobAttemptRequest,
  describeJobAttemptResponse,
  formatCanvasImpactSummary,
  formatJobOutputReconciliationStats,
  getInputAssetsFromProviderRequest,
  getNormalizedOutputsFromProviderResponse,
} from "@/lib/job-diagnostics";

test("getNormalizedOutputsFromProviderResponse preserves multi-output mixed payloads", () => {
  const outputs = getNormalizedOutputsFromProviderResponse({
    outputs: [
      {
        type: "image",
        mimeType: "image/png",
        extension: "png",
        metadata: { outputIndex: 0 },
      },
      {
        type: "image",
        mimeType: "image/png",
        extension: "png",
        metadata: { outputIndex: 1 },
      },
      {
        type: "text",
        mimeType: "application/json",
        extension: "json",
        content: '{"nodes":[],"connections":[]}',
        metadata: { outputIndex: 2, responseId: "resp-1" },
      },
    ],
  });

  assert.deepEqual(
    outputs.map((output) => [output.outputIndex, output.type, output.responseId]),
    [
      [0, "image", null],
      [1, "image", null],
      [2, "text", "resp-1"],
    ]
  );
});

test("getInputAssetsFromProviderRequest returns typed input asset refs", () => {
  const inputs = getInputAssetsFromProviderRequest({
    inputAssets: [
      {
        assetId: "asset-1",
        type: "image",
        storageRef: "project/input.png",
        mimeType: "image/png",
        width: 1024,
        height: 768,
      },
    ],
  });

  assert.equal(inputs.length, 1);
  assert.equal(inputs[0]?.id, "asset-1");
  assert.equal(inputs[0]?.mimeType, "image/png");
  assert.equal(inputs[0]?.width, 1024);
});

test("buildJobCanvasImpact counts finished and pending nodes from the same source job", () => {
  const canvasImpact = buildJobCanvasImpact(
    {
      ...defaultCanvasDocument,
      workflow: {
        nodes: [
          {
            id: "asset-node",
            label: "Output Asset",
            providerId: "openai",
            modelId: "gpt-image-1.5",
            kind: "asset-source",
            nodeType: "image-gen",
            outputType: "image",
            prompt: "",
            settings: { source: "generated" },
            sourceAssetId: "asset-1",
            sourceAssetMimeType: "image/png",
            sourceJobId: "job-1",
            sourceOutputIndex: 0,
            processingState: null,
            promptSourceNodeId: null,
            upstreamNodeIds: [],
            upstreamAssetIds: [],
            x: 0,
            y: 0,
            displayMode: "preview",
            size: null,
          },
          {
            id: "note-node",
            label: "Generated Note",
            providerId: "openai",
            modelId: "gpt-5.1",
            kind: "text-note",
            nodeType: "text-note",
            outputType: "text",
            prompt: "Hello",
            settings: { source: "generated-model-text", sourceJobId: "job-1" },
            sourceAssetId: null,
            sourceAssetMimeType: null,
            sourceJobId: null,
            sourceOutputIndex: null,
            processingState: "running",
            promptSourceNodeId: null,
            upstreamNodeIds: [],
            upstreamAssetIds: [],
            x: 0,
            y: 0,
            displayMode: "preview",
            size: null,
          },
        ],
      },
    },
    "job-1"
  );

  assert.deepEqual(canvasImpact, {
    totalNodeCount: 2,
    pendingNodeCount: 1,
    finishedNodeCount: 1,
    nodeKinds: [
      { key: "asset-source", count: 1 },
      { key: "text-note", count: 1 },
    ],
  });
});

test("buildJobOutputReconciliation reflects normalized outputs, assets, and canvas nodes", () => {
  const job: Job = {
    id: "job-1",
    state: "succeeded",
    providerId: "google-gemini",
    modelId: "gemini-3.1-flash-image-preview",
    createdAt: "2026-03-10T10:00:00.000Z",
    startedAt: "2026-03-10T10:00:01.000Z",
    finishedAt: "2026-03-10T10:00:03.000Z",
    errorMessage: null,
    nodeRunPayload: {
      nodeId: "model-1",
      outputType: "image",
      outputCount: 2,
      executionMode: "generate",
      prompt: "A treehouse",
      settings: {},
      nodeType: "image-gen",
      runOrigin: "canvas-node",
      upstreamNodeIds: [],
      upstreamAssetIds: [],
      inputImageAssetIds: [],
    },
    generatedNodeDescriptors: [
      {
        descriptorId: "note-1",
        kind: "text-note",
        label: "Note",
        sourceJobId: "job-1",
        sourceModelNodeId: "model-1",
        outputIndex: 1,
        descriptorIndex: 0,
        runOrigin: "canvas-node",
        text: "Caption",
      },
    ],
    generatedConnections: [],
    generatedOutputWarning: null,
    mixedOutputDiagnostics: {
      requested: true,
      experimental: true,
      mode: "images_and_text",
      executionMode: "generate",
      inputImageCount: 0,
      rawResponseTextPresent: false,
      candidateTextPartCount: 0,
      imagePartCount: 3,
      warningCode: "mixed_output_missing_text",
      warningMessage: "Gemini returned images only.",
    },
  };

  const reconciliation = buildJobOutputReconciliation({
    job,
    normalizedOutputs: [
      {
        outputIndex: 0,
        type: "image",
        mimeType: "image/png",
        extension: "png",
        responseId: null,
        content: null,
        metadata: {},
      },
      {
        outputIndex: 1,
        type: "text",
        mimeType: "application/json",
        extension: "json",
        responseId: "resp-2",
        content: '{"nodes":[],"connections":[]}',
        metadata: {},
      },
    ],
    outputAssets: [
      {
        id: "asset-1",
        type: "image",
        mimeType: "image/png",
        outputIndex: 0,
        createdAt: "2026-03-10T10:00:03.000Z",
        storageRef: "project/output.png",
        width: 1408,
        height: 768,
        durationMs: null,
      },
    ],
    previewFrames: [
      {
        id: "preview-1",
        outputIndex: 0,
        previewIndex: 0,
        mimeType: "image/png",
        width: 704,
        height: 384,
        createdAt: "2026-03-10T10:00:02.000Z",
      },
    ],
    generatedNodeDescriptors: job.generatedNodeDescriptors || [],
    canvasImpact: {
      totalNodeCount: 2,
      pendingNodeCount: 0,
      finishedNodeCount: 2,
      nodeKinds: [
        { key: "asset-source", count: 1 },
        { key: "text-note", count: 1 },
      ],
    },
    mixedOutputDiagnostics: job.mixedOutputDiagnostics,
  });

  assert.equal(reconciliation.requestedOutputCount, 2);
  assert.deepEqual(reconciliation.normalizedOutputTypes, [
    { key: "image", count: 1 },
    { key: "text", count: 1 },
  ]);
  assert.deepEqual(reconciliation.providerObjectCounts, [{ label: "image parts", count: 3 }]);
  assert.equal(reconciliation.canvasNodeCount, 2);
});

test("attempt summaries and pretty sections stay readable for text-only runs", () => {
  const providerRequest = {
    payload: {
      executionMode: "generate",
      outputCount: 1,
      prompt: "Summarize this scene.",
      settings: {
        textOutputTarget: "smart",
        temperature: 0.2,
      },
      promptSourceNodeId: "note-1",
      upstreamNodeIds: [],
      upstreamAssetIds: [],
    },
    inputAssets: [],
  };
  const providerResponse = {
    outputCount: 1,
    outputTypes: ["text"],
    previewFrameCount: 0,
    outputs: [
      {
        type: "text",
        mimeType: "application/json",
        extension: "json",
        content: '{"nodes":[],"connections":[]}',
        metadata: {
          outputIndex: 0,
        },
      },
    ],
    generatedNodeDescriptors: [],
  };

  const requestSummary = buildJobAttemptRequestSummary(providerRequest);
  const responseSummary = buildJobAttemptResponseSummary(providerResponse, null);

  assert.deepEqual(requestSummary, {
    executionMode: "generate",
    requestedOutputCount: 1,
    promptLength: 21,
    inputAssetCount: 0,
    settingCount: 2,
  });
  assert.deepEqual(responseSummary, {
    normalizedOutputCount: 1,
    normalizedOutputTypes: [{ key: "text", count: 1 }],
    previewFrameCount: 0,
    textOutputCount: 1,
    generatedDescriptorCount: 0,
    providerObjectCounts: [],
    warning: null,
  });

  const requestSections = describeJobAttemptRequest({
    id: "attempt-1",
    attemptNumber: 1,
    providerRequest,
    providerResponse,
    errorCode: null,
    errorMessage: null,
    durationMs: 42,
    createdAt: "2026-03-10T10:00:00.000Z",
    mixedOutputDiagnostics: null,
    requestSummary,
    responseSummary,
  });
  const responseSections = describeJobAttemptResponse({
    id: "attempt-1",
    attemptNumber: 1,
    providerRequest,
    providerResponse,
    errorCode: null,
    errorMessage: null,
    durationMs: 42,
    createdAt: "2026-03-10T10:00:00.000Z",
    mixedOutputDiagnostics: null,
    requestSummary,
    responseSummary,
  });

  assert.equal(requestSections[0]?.title, "Execution");
  assert.equal(requestSections[0]?.items[0]?.value, "generate");
  assert.equal(responseSections[0]?.title, "Outputs");
  assert.equal(responseSections[0]?.items[0]?.value, "1");
});

test("reconciliation and canvas-impact stats keep counts readable and move breakdowns into notes", () => {
  const reconciliationStats = formatJobOutputReconciliationStats({
    requestedOutputCount: 1,
    requestedOutputType: "image",
    normalizedOutputCount: 2,
    normalizedOutputTypes: [
      { key: "image", count: 1 },
      { key: "text", count: 1 },
    ],
    providerObjectCounts: [{ label: "image parts", count: 3 }],
    persistedAssetCount: 1,
    persistedAssetTypes: [{ key: "image", count: 1 }],
    previewFrameCount: 0,
    textOutputCount: 1,
    generatedDescriptorCount: 1,
    generatedDescriptorKinds: [{ key: "text-note", count: 1 }],
    canvasNodeCount: 1,
    canvasNodeKinds: [{ key: "asset-source", count: 1 }],
  });
  const canvasImpactStats = formatCanvasImpactSummary({
    totalNodeCount: 1,
    finishedNodeCount: 1,
    pendingNodeCount: 0,
    nodeKinds: [{ key: "asset-source", count: 1 }],
  });

  assert.deepEqual(reconciliationStats.find((item) => item.label === "Canvas nodes"), {
    label: "Canvas nodes",
    value: "1 canvas node",
    note: "asset-source 1",
  });
  assert.deepEqual(reconciliationStats.find((item) => item.label === "Assets"), {
    label: "Assets",
    value: "1 asset",
    note: "image 1",
  });
  assert.deepEqual(canvasImpactStats[0], {
    label: "Total nodes",
    value: "1 node",
    note: "asset-source 1",
  });
});
