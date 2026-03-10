import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Job, JobDebugResponse } from "@/components/workspace/types";
import { normalizeCanvasDocument } from "@/lib/canvas-document";
import { getDb, getSqlite } from "@/lib/db/client";
import { assets, canvases, jobAttempts, jobPreviewFrames, jobs } from "@/lib/db/schema";
import {
  getGeneratedOutputData,
  getGeminiMixedOutputDiagnostics,
  getLatestTextOutputs,
  getStoredTextOutputTarget,
} from "@/lib/job-attempt-response";
import {
  buildJobAttemptRequestSummary,
  buildJobAttemptResponseSummary,
  buildJobCanvasImpact,
  buildJobOutputReconciliation,
  getInputAssetsFromProviderRequest,
  getNormalizedOutputsFromProviderResponse,
} from "@/lib/job-diagnostics";
import {
  formatProviderAccessMessage,
  formatProviderRequirementMessage,
  getFirstUnconfiguredRequirement,
  isProviderAccessBlocked,
} from "@/lib/provider-readiness";
import { getProviderModel } from "@/lib/providers/registry";
import { syncProviderModels } from "@/lib/services/providers";
import { nowIso, newId } from "@/lib/services/common";
import { isRunnableTopazGigapixelModel, resolveTopazGigapixelSettings } from "@/lib/topaz-gigapixel-settings";
import type { OpenAIImageMode } from "@/lib/types";
import type { CreateJobRequest } from "@/lib/ipc-contract";
import {
  isRunnableImageModel,
  isRunnableTextModel,
  resolveImageModelSettings,
  resolveTextModelSettings,
} from "@/lib/provider-model-helpers";

const createJobSchema = z.object({
  providerId: z.enum(["openai", "google-gemini", "topaz"]),
  modelId: z.string().min(1),
  nodePayload: z.object({
    nodeId: z.string().min(1),
    nodeType: z.enum(["text-gen", "image-gen", "video-gen", "transform"]),
    prompt: z.string().default(""),
    settings: z.record(z.string(), z.unknown()).default({}),
    outputType: z.enum(["text", "image", "video"]),
    executionMode: z.enum(["generate", "edit"]).default("edit"),
    outputCount: z.number().int().min(1).max(4).default(1),
    runOrigin: z.enum(["canvas-node", "copilot"]).default("canvas-node"),
    promptSourceNodeId: z.string().nullable().optional(),
    upstreamNodeIds: z.array(z.string()).default([]),
    upstreamAssetIds: z.array(z.string()).default([]),
    inputImageAssetIds: z.array(z.string()).default([]),
  }),
});

async function getSubmissionError(input: z.infer<typeof createJobSchema>) {
  const model = await getProviderModel(input.providerId, input.modelId);
  if (!model) {
    return "Unknown provider/model selection.";
  }

  if (model.capabilities.availability !== "ready") {
    return `${model.displayName} is coming soon.`;
  }

  const missingRequirement = getFirstUnconfiguredRequirement(model.capabilities);
  if (missingRequirement) {
    return formatProviderRequirementMessage(missingRequirement) || `${model.displayName} is not runnable right now.`;
  }

  if (isProviderAccessBlocked(model.capabilities)) {
    return formatProviderAccessMessage(model.capabilities) || `${model.displayName} is not runnable right now.`;
  }

  if (!model.capabilities.runnable) {
    return formatProviderAccessMessage(model.capabilities) || `${model.displayName} is not runnable right now.`;
  }

  const executionMode = input.nodePayload.executionMode as OpenAIImageMode;
  if (!model.capabilities.executionModes.includes(executionMode)) {
    return `${model.displayName} does not support ${executionMode} mode.`;
  }

  if (model.capabilities.promptMode === "required" && !input.nodePayload.prompt.trim()) {
    return "Connect a prompt note or enter a prompt before running.";
  }

  if (model.capabilities.promptMode === "unsupported" && input.nodePayload.prompt.trim()) {
    return `${model.displayName} does not support prompt input.`;
  }

  if (executionMode === "generate" && input.nodePayload.inputImageAssetIds.length > 0) {
    return "Disconnect image inputs before running prompt-only generation.";
  }

  if (executionMode === "edit" && input.nodePayload.inputImageAssetIds.length === 0) {
    return "Connect at least one supported image input before running.";
  }

  if (isRunnableImageModel(input.providerId, input.modelId)) {
    const resolved = resolveImageModelSettings(input.providerId, input.modelId, input.nodePayload.settings, executionMode);
    if (resolved && resolved.outputCount !== input.nodePayload.outputCount) {
      return "Output count is outside the supported range.";
    }
  }

  if (isRunnableTextModel(input.providerId, input.modelId)) {
    if (input.nodePayload.executionMode !== "generate") {
      return `${model.displayName} only supports generate mode.`;
    }

    if (input.nodePayload.upstreamNodeIds.length > 0 || input.nodePayload.upstreamAssetIds.length > 0) {
      return `${model.displayName} only accepts prompt text, not connected asset inputs.`;
    }

    if (input.nodePayload.outputCount !== 1) {
      return `${model.displayName} produces exactly one text response per run.`;
    }

    const resolved = resolveTextModelSettings(input.providerId, input.modelId, input.nodePayload.settings);
    if (resolved?.validationError) {
      return resolved.validationError;
    }
  }

  if (isRunnableTopazGigapixelModel(input.providerId, input.modelId)) {
    if (input.nodePayload.executionMode !== "edit") {
      return `${model.displayName} only supports edit mode.`;
    }

    if (input.nodePayload.inputImageAssetIds.length !== 1) {
      return `${model.displayName} requires exactly one connected image input.`;
    }

    if (input.nodePayload.outputCount !== 1) {
      return `${model.displayName} produces exactly one output.`;
    }

    resolveTopazGigapixelSettings(input.nodePayload.settings, input.modelId);
  }

  return null;
}

function serializeAssetRow(row: typeof assets.$inferSelect) {
  return {
    id: row.id,
    type: row.type as Job["assets"][number]["type"],
    mimeType: row.mimeType,
    outputIndex: row.outputIndex,
    createdAt: row.createdAt,
    storageRef: row.storageRef,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
  };
}

function serializePreviewFrameRow(row: typeof jobPreviewFrames.$inferSelect) {
  return {
    id: row.id,
    outputIndex: row.outputIndex,
    previewIndex: row.previewIndex,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
    createdAt: row.createdAt,
  };
}

function getNodeReference(
  canvasDocument: ReturnType<typeof normalizeCanvasDocument> | null,
  nodeId: string | null | undefined
): JobDebugResponse["sourceNode"] {
  if (!nodeId) {
    return null;
  }

  const node = canvasDocument?.workflow.nodes.find((candidate) => candidate.id === nodeId) || null;
  if (!node) {
    return {
      id: nodeId,
      label: null,
      kind: null,
      nodeType: null,
    };
  }

  return {
    id: node.id,
    label: node.label,
    kind: node.kind,
    nodeType: node.nodeType,
  };
}

function serializeJobRows(
  rows: typeof jobs.$inferSelect[],
  assetsByJobId: Map<
    string,
    Array<{
      id: string;
      type: string;
      mimeType: string;
      outputIndex: number | null;
      createdAt: string;
      storageRef: string;
      width: number | null;
      height: number | null;
      durationMs: number | null;
    }>
  >,
  previewFramesByJobId: Map<
    string,
    Array<{
      id: string;
      outputIndex: number;
      previewIndex: number;
      mimeType: string;
      width: number | null;
      height: number | null;
      createdAt: string;
    }>
  >,
  latestAttemptByJobId: Map<string, typeof jobAttempts.$inferSelect>
): Job[] {
  return rows.map((job) => {
    const latestAttempt = latestAttemptByJobId.get(job.id) || null;
    const latestProviderResponse = latestAttempt?.providerResponse || null;
    const sourceModelNodeId =
      typeof (job.nodeRunPayload as Record<string, unknown> | undefined)?.nodeId === "string" &&
      (job.nodeRunPayload as Record<string, unknown> | undefined)?.runOrigin !== "copilot"
        ? String((job.nodeRunPayload as Record<string, unknown>).nodeId)
        : null;
    const runOrigin =
      (job.nodeRunPayload as Record<string, unknown> | undefined)?.runOrigin === "copilot" ? "copilot" : "canvas-node";
    const generatedOutputData = getGeneratedOutputData({
      providerResponse: latestProviderResponse,
      sourceJobId: job.id,
      sourceModelNodeId,
      runOrigin,
    });

    return {
      id: job.id,
      state: job.state,
      providerId: job.providerId,
      modelId: job.modelId,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      errorMessage: job.errorMessage,
      nodeRunPayload: job.nodeRunPayload as Job["nodeRunPayload"],
      assets: assetsByJobId.get(job.id) || [],
      latestPreviewFrames: previewFramesByJobId.get(job.id) || [],
      latestTextOutputs: getLatestTextOutputs(latestProviderResponse),
      textOutputTarget: getStoredTextOutputTarget(
        latestProviderResponse,
        (job.nodeRunPayload as Record<string, unknown> | undefined)?.settings &&
          typeof (job.nodeRunPayload as Record<string, unknown> | undefined)?.settings === "object"
          ? ((job.nodeRunPayload as Record<string, unknown>).settings as Record<string, unknown>).textOutputTarget
          : undefined
      ),
      generatedNodeDescriptors: generatedOutputData.generatedNodeDescriptors,
      generatedConnections: generatedOutputData.generatedConnections,
      generatedOutputWarning: generatedOutputData.warning,
      mixedOutputDiagnostics: getGeminiMixedOutputDiagnostics(latestProviderResponse),
    };
  });
}

export async function listJobs(projectId: string): Promise<Job[]> {
  const db = getDb();
  const rows = db.select().from(jobs).where(eq(jobs.projectId, projectId)).orderBy(desc(jobs.createdAt)).limit(100).all();
  const jobIds = rows.map((job) => job.id);
  const jobAssetRows = jobIds.length ? db.select().from(assets).where(inArray(assets.jobId, jobIds)).all() : [];
  const previewRows = jobIds.length ? db.select().from(jobPreviewFrames).where(inArray(jobPreviewFrames.jobId, jobIds)).all() : [];
  const attempts = jobIds.length ? db.select().from(jobAttempts).where(inArray(jobAttempts.jobId, jobIds)).all() : [];

  const assetsByJobId = jobAssetRows.reduce<
    Map<
      string,
      Array<{
        id: string;
        type: string;
        mimeType: string;
        outputIndex: number | null;
        createdAt: string;
        storageRef: string;
        width: number | null;
        height: number | null;
        durationMs: number | null;
      }>
    >
  >(
    (acc, asset) => {
      if (!asset.jobId) {
        return acc;
      }
      const next = acc.get(asset.jobId) || [];
      next.push(serializeAssetRow(asset));
      acc.set(asset.jobId, next);
      return acc;
    },
    new Map()
  );
  const previewFramesByJobId = previewRows
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.previewIndex - left.previewIndex)
    .reduce<
      Map<
        string,
        Array<{
          id: string;
          outputIndex: number;
          previewIndex: number;
          mimeType: string;
          width: number | null;
          height: number | null;
          createdAt: string;
        }>
      >
    >((acc, preview) => {
      const next = acc.get(preview.jobId) || [];
      if (!next.some((existing) => existing.outputIndex === preview.outputIndex)) {
        next.push(serializePreviewFrameRow(preview));
      }
      acc.set(preview.jobId, next);
      return acc;
    }, new Map());
  const latestAttemptByJobId = attempts
    .sort((left, right) => right.attemptNumber - left.attemptNumber || right.createdAt.localeCompare(left.createdAt))
    .reduce<Map<string, typeof jobAttempts.$inferSelect>>((acc, attempt) => {
      if (!acc.has(attempt.jobId)) {
        acc.set(attempt.jobId, attempt);
      }
      return acc;
    }, new Map());

  return serializeJobRows(rows, assetsByJobId, previewFramesByJobId, latestAttemptByJobId);
}

export async function getJobDebug(projectId: string, jobId: string): Promise<JobDebugResponse> {
  const db = getDb();
  const row = db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.projectId, projectId))).get();
  if (!row) {
    throw new Error("Job not found");
  }

  const attempts = db
    .select()
    .from(jobAttempts)
    .where(eq(jobAttempts.jobId, jobId))
    .orderBy(desc(jobAttempts.attemptNumber), desc(jobAttempts.createdAt))
    .all();
  const outputAssetRows = db
    .select()
    .from(assets)
    .where(and(eq(assets.projectId, projectId), eq(assets.jobId, jobId)))
    .orderBy(desc(assets.createdAt))
    .all();
  const previewRows = db
    .select()
    .from(jobPreviewFrames)
    .where(eq(jobPreviewFrames.jobId, jobId))
    .orderBy(desc(jobPreviewFrames.createdAt), desc(jobPreviewFrames.previewIndex))
    .all();
  const canvasRow = db.select().from(canvases).where(eq(canvases.projectId, projectId)).get();
  const latestAttemptByJobId = attempts.reduce<Map<string, typeof jobAttempts.$inferSelect>>((acc, attempt) => {
    if (!acc.has(attempt.jobId)) {
      acc.set(attempt.jobId, attempt);
    }
    return acc;
  }, new Map());
  const [job] = serializeJobRows(
    [row],
    new Map([[jobId, outputAssetRows.map((asset) => serializeAssetRow(asset))]]),
    new Map([[jobId, previewRows.map((preview) => serializePreviewFrameRow(preview))]]),
    latestAttemptByJobId
  );
  const latestAttempt = attempts[0] || null;
  const latestProviderRequest = latestAttempt?.providerRequest || null;
  const latestProviderResponse = latestAttempt?.providerResponse || null;
  const canvasDocument = normalizeCanvasDocument(canvasRow?.canvasDocument);
  const canvasImpact = buildJobCanvasImpact(canvasDocument, jobId);
  const normalizedOutputs = getNormalizedOutputsFromProviderResponse(latestProviderResponse);
  const outputAssets = outputAssetRows.map((asset) => serializeAssetRow(asset));
  const previewFrames = previewRows.map((preview) => serializePreviewFrameRow(preview));
  const sourceNodeId = typeof row.nodeRunPayload?.nodeId === "string" ? row.nodeRunPayload.nodeId : null;
  const promptSourceNodeId =
    typeof row.nodeRunPayload?.promptSourceNodeId === "string" ? row.nodeRunPayload.promptSourceNodeId : null;

  return {
    job,
    lifecycle: {
      queuedAt: row.queuedAt,
      createdAt: row.createdAt,
      availableAt: row.availableAt,
      claimedAt: row.claimedAt,
      lastHeartbeatAt: row.lastHeartbeatAt,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
    },
    sourceNode: getNodeReference(canvasDocument, sourceNodeId),
    promptSourceNode: getNodeReference(canvasDocument, promptSourceNodeId),
    inputAssets: getInputAssetsFromProviderRequest(latestProviderRequest),
    outputAssets,
    previewFrames,
    normalizedOutputs,
    outputReconciliation: buildJobOutputReconciliation({
      job,
      normalizedOutputs,
      outputAssets,
      previewFrames,
      generatedNodeDescriptors: job.generatedNodeDescriptors || [],
      canvasImpact,
      mixedOutputDiagnostics: job.mixedOutputDiagnostics,
    }),
    canvasImpact,
    attempts: attempts.map((attempt) => ({
      id: attempt.id,
      attemptNumber: attempt.attemptNumber,
      providerRequest: attempt.providerRequest,
      providerResponse: attempt.providerResponse,
      errorCode: attempt.errorCode,
      errorMessage: attempt.errorMessage,
      durationMs: attempt.durationMs,
      createdAt: attempt.createdAt,
      mixedOutputDiagnostics: getGeminiMixedOutputDiagnostics(attempt.providerResponse),
      requestSummary: buildJobAttemptRequestSummary(attempt.providerRequest),
      responseSummary: buildJobAttemptResponseSummary(
        attempt.providerResponse,
        getGeminiMixedOutputDiagnostics(attempt.providerResponse)
      ),
    })),
  };
}

export async function createJob(projectId: string, input: CreateJobRequest) {
  const parsed = createJobSchema.parse(input);
  await syncProviderModels();
  const submissionError = await getSubmissionError(parsed);
  if (submissionError) {
    throw new Error(submissionError);
  }

  const db = getDb();
  const timestamp = nowIso();
  const jobId = newId();
  db.insert(jobs)
    .values({
      id: jobId,
      projectId,
      state: "queued",
      providerId: parsed.providerId,
      modelId: parsed.modelId,
      nodeRunPayload: parsed.nodePayload,
      attempts: 0,
      maxAttempts: 3,
      queuedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      availableAt: timestamp,
    })
    .run();

  return (await listJobs(projectId)).find((job) => job.id === jobId)!;
}

export function recoverStaleRunningJobs(staleMs = 30_000) {
  const sqlite = getSqlite();
  const staleBefore = new Date(Date.now() - staleMs).toISOString();
  sqlite
    .prepare(
      `
      UPDATE jobs
      SET state = 'queued',
          claimed_at = NULL,
          claim_token = NULL,
          last_heartbeat_at = NULL,
          started_at = NULL,
          updated_at = ?,
          available_at = ?
      WHERE state = 'running'
        AND claimed_at IS NOT NULL
        AND (last_heartbeat_at IS NULL OR last_heartbeat_at < ?)
      `
    )
    .run(nowIso(), nowIso(), staleBefore);
}

export function claimNextJob() {
  const sqlite = getSqlite();
  const claimToken = randomUUID();
  const now = nowIso();

  return sqlite.transaction(() => {
    const nextJob = sqlite
      .prepare(
        `
        SELECT id
        FROM jobs
        WHERE state = 'queued'
          AND available_at <= ?
        ORDER BY available_at ASC, created_at ASC
        LIMIT 1
        `
      )
      .get(now) as { id?: string } | undefined;

    if (!nextJob?.id) {
      return null;
    }

    const updated = sqlite
      .prepare(
        `
        UPDATE jobs
        SET state = 'running',
            claimed_at = ?,
            claim_token = ?,
            last_heartbeat_at = ?,
            started_at = COALESCE(started_at, ?),
            updated_at = ?
        WHERE id = ?
          AND state = 'queued'
        `
      )
      .run(now, claimToken, now, now, now, nextJob.id);

    if (updated.changes === 0) {
      return null;
    }

    return { id: nextJob.id, claimToken };
  })();
}

export function heartbeatJob(jobId: string, claimToken: string) {
  getSqlite()
    .prepare(
      `
      UPDATE jobs
      SET last_heartbeat_at = ?, updated_at = ?
      WHERE id = ? AND claim_token = ?
      `
    )
    .run(nowIso(), nowIso(), jobId, claimToken);
}

export function rescheduleJob(jobId: string, errorCode: string, errorMessage: string, attemptNumber: number, maxAttempts: number) {
  const timestamp = nowIso();
  const shouldRetry = attemptNumber < maxAttempts;
  const nextAvailableAt = new Date(Date.now() + Math.min(30_000, Math.pow(2, attemptNumber) * 1_000)).toISOString();

  getSqlite()
    .prepare(
      `
      UPDATE jobs
      SET state = ?,
          error_code = ?,
          error_message = ?,
          available_at = ?,
          claimed_at = NULL,
          claim_token = NULL,
          last_heartbeat_at = NULL,
          finished_at = ?,
          updated_at = ?
      WHERE id = ?
      `
    )
    .run(shouldRetry ? "queued" : "failed", errorCode, errorMessage, shouldRetry ? nextAvailableAt : timestamp, shouldRetry ? null : timestamp, timestamp, jobId);
}
