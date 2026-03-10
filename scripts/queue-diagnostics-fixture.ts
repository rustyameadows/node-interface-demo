import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const INPUT_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="640" height="384" viewBox="0 0 640 384">
    <rect width="640" height="384" fill="#141414" />
    <circle cx="188" cy="194" r="94" fill="#ff7a32" />
    <rect x="312" y="92" width="182" height="184" rx="24" fill="#48b8ff" />
  </svg>
`.trim();

const OUTPUT_A_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="704" height="448" viewBox="0 0 704 448">
    <rect width="704" height="448" fill="#120f1f" />
    <rect x="58" y="52" width="588" height="344" rx="28" fill="#f3d2a2" />
    <circle cx="208" cy="222" r="88" fill="#ff8e52" />
    <rect x="330" y="124" width="198" height="186" rx="18" fill="#5bb7ff" />
  </svg>
`.trim();

const OUTPUT_B_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="704" height="448" viewBox="0 0 704 448">
    <rect width="704" height="448" fill="#10181f" />
    <rect x="72" y="64" width="560" height="320" rx="28" fill="#d4f2ee" />
    <path d="M166 304c66-136 146-204 238-204 52 0 100 22 144 66" fill="none" stroke="#1f9f8f" stroke-width="38" stroke-linecap="round"/>
    <circle cx="520" cy="176" r="42" fill="#ffb74a" />
  </svg>
`.trim();

export type QueueDiagnosticsFixture = {
  primaryJobId: string;
  secondaryJobId: string;
  primaryOutputAssetId: string;
  secondaryOutputAssetId: string;
};

function ensureCanvasDocument(raw: string | null | undefined) {
  if (!raw) {
    return {
      canvasViewport: {
        x: 240,
        y: 180,
        zoom: 1,
      },
      generatedOutputReceiptKeys: [],
      workflow: {
        nodes: [],
      },
    } as Record<string, unknown>;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed.workflow || typeof parsed.workflow !== "object") {
      parsed.workflow = { nodes: [] };
    }
    if (!Array.isArray((parsed.workflow as { nodes?: unknown[] }).nodes)) {
      (parsed.workflow as { nodes: unknown[] }).nodes = [];
    }
    if (!Array.isArray(parsed.generatedOutputReceiptKeys)) {
      parsed.generatedOutputReceiptKeys = [];
    }
    return parsed;
  } catch {
    return {
      canvasViewport: {
        x: 240,
        y: 180,
        zoom: 1,
      },
      generatedOutputReceiptKeys: [],
      workflow: {
        nodes: [],
      },
    } as Record<string, unknown>;
  }
}

async function writeProjectAsset(appDataRoot: string, projectId: string, fileName: string, content: string) {
  const projectAssetsRoot = path.join(appDataRoot, "assets", projectId);
  await mkdir(projectAssetsRoot, { recursive: true });
  await writeFile(path.join(projectAssetsRoot, fileName), content, "utf8");
  return `${projectId}/${fileName}`;
}

async function writeJobPreview(appDataRoot: string, jobId: string, fileName: string, content: string) {
  const previewRoot = path.join(appDataRoot, "previews", jobId);
  await mkdir(previewRoot, { recursive: true });
  await writeFile(path.join(previewRoot, fileName), content, "utf8");
  return `${jobId}/${fileName}`;
}

function upsertCanvasNode(nodes: Array<Record<string, unknown>>, node: Record<string, unknown>) {
  const existingIndex = nodes.findIndex((candidate) => candidate.id === node.id);
  if (existingIndex >= 0) {
    nodes[existingIndex] = node;
    return;
  }
  nodes.push(node);
}

export async function seedQueueDiagnosticsFixture(input: {
  appDataRoot: string;
  projectId: string;
  inputAssetId: string;
}) {
  const { appDataRoot, projectId, inputAssetId } = input;
  const sqlite = new DatabaseSync(path.join(appDataRoot, "app.sqlite"));
  sqlite.exec("PRAGMA foreign_keys = ON");

  const primaryJobId = "queue-job-primary";
  const secondaryJobId = "queue-job-secondary";
  const primaryAttemptId = "queue-attempt-primary";
  const secondaryAttemptId = "queue-attempt-secondary";
  const primaryOutputAssetId = "queue-output-asset-primary";
  const secondaryOutputAssetId = "queue-output-asset-secondary";
  const primaryPreviewId = "queue-preview-primary";
  const modelNodeId = "queue-debug-model";
  const noteNodeId = "queue-debug-note";
  const assetNodeId = "queue-debug-asset";

  const primaryQueuedAt = "2026-03-10T10:00:00.000Z";
  const primaryStartedAt = "2026-03-10T10:00:01.000Z";
  const primaryFinishedAt = "2026-03-10T10:00:03.000Z";
  const secondaryQueuedAt = "2026-03-10T10:05:00.000Z";
  const secondaryStartedAt = "2026-03-10T10:05:01.000Z";
  const secondaryFinishedAt = "2026-03-10T10:05:04.000Z";

  const primaryAssetStorageRef = await writeProjectAsset(appDataRoot, projectId, "queue-output-primary.svg", OUTPUT_A_SVG);
  const secondaryAssetStorageRef = await writeProjectAsset(appDataRoot, projectId, "queue-output-secondary.svg", OUTPUT_B_SVG);
  const primaryPreviewStorageRef = await writeJobPreview(appDataRoot, primaryJobId, "preview-primary.svg", INPUT_SVG);

  sqlite
    .prepare(
      `
      INSERT OR REPLACE INTO jobs (
        id, project_id, state, provider_id, model_id, node_run_payload, attempts, max_attempts,
        error_code, error_message, queued_at, started_at, finished_at, created_at, updated_at,
        available_at, claimed_at, claim_token, last_heartbeat_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      primaryJobId,
      projectId,
      "succeeded",
      "google-gemini",
      "gemini-3.1-flash-image-preview",
      JSON.stringify({
        nodeId: modelNodeId,
        nodeType: "image-gen",
        prompt: "Turn the reference into a styled room card with a caption note.",
        settings: {
          outputMode: "images_and_text",
          textOutputTarget: "smart",
        },
        outputType: "image",
        executionMode: "edit",
        outputCount: 2,
        runOrigin: "canvas-node",
        promptSourceNodeId: null,
        upstreamNodeIds: [],
        upstreamAssetIds: [],
        inputImageAssetIds: [inputAssetId],
      }),
      1,
      3,
      null,
      null,
      primaryQueuedAt,
      primaryStartedAt,
      primaryFinishedAt,
      primaryQueuedAt,
      primaryFinishedAt,
      primaryQueuedAt,
      primaryStartedAt,
      "fixture-claim-primary",
      primaryFinishedAt
    );

  sqlite
    .prepare(
      `
      INSERT OR REPLACE INTO jobs (
        id, project_id, state, provider_id, model_id, node_run_payload, attempts, max_attempts,
        error_code, error_message, queued_at, started_at, finished_at, created_at, updated_at,
        available_at, claimed_at, claim_token, last_heartbeat_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      secondaryJobId,
      projectId,
      "succeeded",
      "openai",
      "gpt-image-1.5",
      JSON.stringify({
        nodeId: modelNodeId,
        nodeType: "image-gen",
        prompt: "Generate a second variant for queue selection testing.",
        settings: {},
        outputType: "image",
        executionMode: "generate",
        outputCount: 1,
        runOrigin: "canvas-node",
        promptSourceNodeId: null,
        upstreamNodeIds: [],
        upstreamAssetIds: [],
        inputImageAssetIds: [],
      }),
      1,
      3,
      null,
      null,
      secondaryQueuedAt,
      secondaryStartedAt,
      secondaryFinishedAt,
      secondaryQueuedAt,
      secondaryFinishedAt,
      secondaryQueuedAt,
      secondaryStartedAt,
      "fixture-claim-secondary",
      secondaryFinishedAt
    );

  const primaryProviderRequest = {
    providerId: "google-gemini",
    modelId: "gemini-3.1-flash-image-preview",
    providerRequestPreview: {
      endpoint: "Google Gemini generateContent",
      requestPayload: {
        mode: "images_and_text",
      },
    },
    payload: {
      executionMode: "edit",
      outputCount: 2,
      prompt: "Turn the reference into a styled room card with a caption note.",
      settings: {
        outputMode: "images_and_text",
        textOutputTarget: "smart",
      },
      promptSourceNodeId: null,
      upstreamNodeIds: [],
      upstreamAssetIds: [],
    },
    inputAssets: [
      {
        assetId: inputAssetId,
        type: "image",
        storageRef: `${projectId}/uploaded-input.svg`,
        mimeType: "image/svg+xml",
        width: 640,
        height: 384,
      },
    ],
  };

  const primaryProviderResponse = {
    outputCount: 2,
    outputTypes: ["image", "text"],
    outputs: [
      {
        type: "image",
        mimeType: "image/svg+xml",
        extension: "svg",
        metadata: {
          providerId: "google-gemini",
          modelId: "gemini-3.1-flash-image-preview",
          outputIndex: 0,
        },
      },
      {
        type: "text",
        mimeType: "application/json",
        extension: "json",
        metadata: {
          outputIndex: 1,
          responseId: "resp-primary",
          textOutputTarget: "smart",
        },
        content: JSON.stringify({
          nodes: [
            {
              id: noteNodeId,
              kind: "text-note",
              label: "Room Caption",
              text: "Tall windows, warm lamp, and a clean diagnostic card composition.",
              columns: null,
              rows: null,
              templateText: null,
            },
          ],
          connections: [],
        }),
      },
    ],
    previewFrameCount: 1,
    previewFrames: [
      {
        id: primaryPreviewId,
        outputIndex: 0,
        previewIndex: 0,
        mimeType: "image/svg+xml",
        createdAt: "2026-03-10T10:00:02.000Z",
      },
    ],
    textOutputTarget: "smart",
    generatedNodeDescriptors: [
      {
        descriptorId: noteNodeId,
        kind: "text-note",
        label: "Room Caption",
        sourceJobId: primaryJobId,
        sourceModelNodeId: modelNodeId,
        outputIndex: 1,
        descriptorIndex: 0,
        runOrigin: "canvas-node",
        text: "Tall windows, warm lamp, and a clean diagnostic card composition.",
      },
    ],
    generatedConnections: [],
  };

  const secondaryProviderRequest = {
    providerId: "openai",
    modelId: "gpt-image-1.5",
    providerRequestPreview: {
      endpoint: "OpenAI Images",
      requestPayload: {
        size: "1536x1024",
      },
    },
    payload: {
      executionMode: "generate",
      outputCount: 1,
      prompt: "Generate a second variant for queue selection testing.",
      settings: {},
      promptSourceNodeId: null,
      upstreamNodeIds: [],
      upstreamAssetIds: [],
    },
    inputAssets: [],
  };

  const secondaryProviderResponse = {
    outputCount: 1,
    outputTypes: ["image"],
    outputs: [
      {
        type: "image",
        mimeType: "image/svg+xml",
        extension: "svg",
        metadata: {
          providerId: "openai",
          modelId: "gpt-image-1.5",
          outputIndex: 0,
        },
      },
    ],
    previewFrameCount: 0,
    previewFrames: [],
  };

  sqlite
    .prepare(
      `
      INSERT OR REPLACE INTO job_attempts (
        id, job_id, attempt_number, provider_request, provider_response, error_code, error_message, duration_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      primaryAttemptId,
      primaryJobId,
      1,
      JSON.stringify(primaryProviderRequest),
      JSON.stringify(primaryProviderResponse),
      null,
      null,
      1999,
      primaryFinishedAt
    );

  sqlite
    .prepare(
      `
      INSERT OR REPLACE INTO job_attempts (
        id, job_id, attempt_number, provider_request, provider_response, error_code, error_message, duration_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      secondaryAttemptId,
      secondaryJobId,
      1,
      JSON.stringify(secondaryProviderRequest),
      JSON.stringify(secondaryProviderResponse),
      null,
      null,
      2450,
      secondaryFinishedAt
    );

  sqlite
    .prepare(
      `
      INSERT OR REPLACE INTO assets (
        id, project_id, job_id, type, storage_ref, mime_type, output_index,
        width, height, duration_ms, checksum, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      primaryOutputAssetId,
      projectId,
      primaryJobId,
      "image",
      primaryAssetStorageRef,
      "image/svg+xml",
      0,
      704,
      448,
      null,
      null,
      primaryFinishedAt,
      primaryFinishedAt
    );

  sqlite
    .prepare(
      `
      INSERT OR REPLACE INTO assets (
        id, project_id, job_id, type, storage_ref, mime_type, output_index,
        width, height, duration_ms, checksum, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      secondaryOutputAssetId,
      projectId,
      secondaryJobId,
      "image",
      secondaryAssetStorageRef,
      "image/svg+xml",
      0,
      704,
      448,
      null,
      null,
      secondaryFinishedAt,
      secondaryFinishedAt
    );

  sqlite
    .prepare(
      `
      INSERT OR REPLACE INTO job_preview_frames (
        id, job_id, output_index, preview_index, storage_ref, mime_type, width, height, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(primaryPreviewId, primaryJobId, 0, 0, primaryPreviewStorageRef, "image/svg+xml", 640, 384, "2026-03-10T10:00:02.000Z");

  const canvasRow = sqlite.prepare("SELECT canvas_document FROM canvases WHERE project_id = ?").get(projectId) as
    | { canvas_document?: string | null }
    | undefined;
  const canvasDocument = ensureCanvasDocument(canvasRow?.canvas_document);
  const workflow = canvasDocument.workflow as { nodes: Array<Record<string, unknown>> };
  const nodes = workflow.nodes;
  const receiptKeys = canvasDocument.generatedOutputReceiptKeys as string[];

  upsertCanvasNode(nodes, {
    id: modelNodeId,
    label: "Queue Diagnostics Model",
    providerId: "google-gemini",
    modelId: "gemini-3.1-flash-image-preview",
    kind: "model",
    nodeType: "image-gen",
    outputType: "image",
    prompt: "Turn the reference into a styled room card with a caption note.",
    settings: {
      outputMode: "images_and_text",
      textOutputTarget: "smart",
    },
    sourceAssetId: null,
    sourceAssetMimeType: null,
    sourceJobId: null,
    sourceOutputIndex: null,
    processingState: null,
    promptSourceNodeId: null,
    upstreamNodeIds: [],
    upstreamAssetIds: [],
    x: 720,
    y: 240,
    displayMode: "preview",
    size: null,
  });

  upsertCanvasNode(nodes, {
    id: assetNodeId,
    label: "Primary Output Asset",
    providerId: "google-gemini",
    modelId: "gemini-3.1-flash-image-preview",
    kind: "asset-source",
    nodeType: "image-gen",
    outputType: "image",
    prompt: "",
    settings: {
      source: "generated",
    },
    sourceAssetId: primaryOutputAssetId,
    sourceAssetMimeType: "image/svg+xml",
    sourceJobId: primaryJobId,
    sourceOutputIndex: 0,
    processingState: null,
    promptSourceNodeId: null,
    upstreamNodeIds: [],
    upstreamAssetIds: [],
    x: 1010,
    y: 212,
    displayMode: "preview",
    size: null,
  });

  upsertCanvasNode(nodes, {
    id: noteNodeId,
    label: "Room Caption",
    providerId: "google-gemini",
    modelId: "gemini-3.1-flash-image-preview",
    kind: "text-note",
    nodeType: "text-note",
    outputType: "text",
    prompt: "Tall windows, warm lamp, and a clean diagnostic card composition.",
    settings: {
      source: "generated-model-text",
      sourceJobId: primaryJobId,
      sourceModelNodeId: modelNodeId,
      outputIndex: 1,
      descriptorIndex: 0,
      runOrigin: "canvas-node",
    },
    sourceAssetId: null,
    sourceAssetMimeType: null,
    sourceJobId: primaryJobId,
    sourceOutputIndex: 1,
    processingState: null,
    promptSourceNodeId: null,
    upstreamNodeIds: [],
    upstreamAssetIds: [],
    x: 1030,
    y: 460,
    displayMode: "preview",
    size: null,
  });

  for (const receipt of [`${primaryJobId}:0`, `${primaryJobId}:1:0`, `${secondaryJobId}:0`]) {
    if (!receiptKeys.includes(receipt)) {
      receiptKeys.push(receipt);
    }
  }

  sqlite
    .prepare(
      `
      INSERT OR REPLACE INTO canvases (project_id, canvas_document, version, updated_at)
      VALUES (?, ?, COALESCE((SELECT version FROM canvases WHERE project_id = ?), 1), ?)
      `
    )
    .run(projectId, JSON.stringify(canvasDocument), projectId, secondaryFinishedAt);

  sqlite.close();

  return {
    primaryJobId,
    secondaryJobId,
    primaryOutputAssetId,
    secondaryOutputAssetId,
  } satisfies QueueDiagnosticsFixture;
}

export async function ensureUploadedInputFixture(appDataRoot: string, projectId: string) {
  await writeProjectAsset(appDataRoot, projectId, "uploaded-input.svg", INPUT_SVG);
}
