import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Job, JobDebugResponse } from "@/components/workspace/types";
import { getDb, getSqlite } from "@/lib/db/client";
import { assets, jobAttempts, jobPreviewFrames, jobs } from "@/lib/db/schema";
import {
  createGeneratedTextNoteDescriptorsFromRawText,
  type GeneratedConnectionDescriptor,
  type GeneratedNodeDescriptor,
} from "@/lib/generated-text-output";
import {
  formatProviderAccessMessage,
  formatProviderRequirementMessage,
  getFirstUnconfiguredRequirement,
  isProviderAccessBlocked,
} from "@/lib/provider-readiness";
import { getProviderModel } from "@/lib/providers/registry";
import { syncProviderModels } from "@/lib/services/providers";
import { nowIso, newId } from "@/lib/services/common";
import { readOpenAiTextOutputTarget } from "@/lib/text-output-targets";
import { isRunnableTopazGigapixelModel, resolveTopazGigapixelSettings } from "@/lib/topaz-gigapixel-settings";
import type { OpenAIImageMode } from "@/lib/types";
import type { CreateJobRequest } from "@/lib/ipc-contract";
import {
  isRunnableImageModel,
  isRunnableTextModel,
  resolveImageModelSettings,
  resolveTextModelSettings,
} from "@/lib/provider-model-helpers";

function getLatestTextOutputs(providerResponse: Record<string, unknown> | null | undefined) {
  if (!providerResponse || typeof providerResponse !== "object") {
    return [];
  }

  const outputs = Array.isArray(providerResponse.outputs) ? providerResponse.outputs : [];

  return outputs
    .map((output) => (output && typeof output === "object" ? (output as Record<string, unknown>) : null))
    .filter((output): output is Record<string, unknown> => Boolean(output))
    .filter((output) => output.type === "text" && typeof output.content === "string")
    .map((output, index) => {
      const metadata =
        output.metadata && typeof output.metadata === "object"
          ? (output.metadata as Record<string, unknown>)
          : {};
      return {
        outputIndex:
          typeof metadata.outputIndex === "number"
            ? Number(metadata.outputIndex)
            : typeof output.outputIndex === "number"
              ? Number(output.outputIndex)
              : index,
        content: String(output.content),
        responseId: metadata.responseId ? String(metadata.responseId) : null,
      };
    });
}

function getStoredTextOutputTarget(
  providerResponse: Record<string, unknown> | null | undefined,
  fallback: unknown
): Job["textOutputTarget"] {
  if (providerResponse && typeof providerResponse === "object" && "textOutputTarget" in providerResponse) {
    return readOpenAiTextOutputTarget(
      (providerResponse as Record<string, unknown>).textOutputTarget,
      readOpenAiTextOutputTarget(fallback)
    );
  }

  return readOpenAiTextOutputTarget(fallback);
}

function normalizeGeneratedNodeDescriptors(
  rawDescriptors: unknown[],
  sourceJobId: string,
  sourceModelNodeId: string | null | undefined,
  runOrigin: "canvas-node" | "copilot"
): GeneratedNodeDescriptor[] {
  return rawDescriptors
    .map((descriptor, descriptorIndex) => {
      if (!descriptor || typeof descriptor !== "object") {
        return null;
      }

      const record = descriptor as Record<string, unknown>;
      const kind = record.kind;
      const outputIndex = typeof record.outputIndex === "number" ? Number(record.outputIndex) : 0;
      const normalizedSourceModelNodeId =
        typeof record.sourceModelNodeId === "string" ? String(record.sourceModelNodeId) : sourceModelNodeId ?? null;
      const normalizedRunOrigin =
        record.runOrigin === "copilot" || record.runOrigin === "canvas-node"
          ? record.runOrigin
          : normalizedSourceModelNodeId
            ? "canvas-node"
            : runOrigin;
      const shared = {
        descriptorId:
          typeof record.descriptorId === "string" && record.descriptorId.trim()
            ? String(record.descriptorId)
            : `generated-${outputIndex}-${descriptorIndex}`,
        label:
          typeof record.label === "string" && record.label.trim()
            ? String(record.label)
            : `Generated ${descriptorIndex + 1}`,
        sourceJobId: typeof record.sourceJobId === "string" ? String(record.sourceJobId) : sourceJobId,
        sourceModelNodeId: normalizedSourceModelNodeId,
        outputIndex,
        descriptorIndex:
          typeof record.descriptorIndex === "number" ? Number(record.descriptorIndex) : descriptorIndex,
        runOrigin: normalizedRunOrigin,
      } as const;

      if (kind === "list" && Array.isArray(record.columns) && Array.isArray(record.rows)) {
        return {
          ...shared,
          kind: "list" as const,
          columns: record.columns.map((value) => String(value)),
          rows: record.rows.map((row) => (Array.isArray(row) ? row.map((value) => String(value)) : [])),
        };
      }

      if (kind === "text-template" && typeof record.templateText === "string") {
        return {
          ...shared,
          kind: "text-template" as const,
          templateText: String(record.templateText),
        };
      }

      if (kind === "text-note" && typeof record.text === "string") {
        return {
          ...shared,
          kind: "text-note" as const,
          text: String(record.text),
        };
      }

      return null;
    })
    .filter((descriptor): descriptor is GeneratedNodeDescriptor => Boolean(descriptor));
}

function getGeneratedConnections(providerResponse: Record<string, unknown> | null | undefined): GeneratedConnectionDescriptor[] {
  if (!providerResponse || typeof providerResponse !== "object" || !Array.isArray(providerResponse.generatedConnections)) {
    return [];
  }

  return providerResponse.generatedConnections
    .map((connection) => (connection && typeof connection === "object" ? (connection as Record<string, unknown>) : null))
    .filter((connection): connection is Record<string, unknown> => Boolean(connection))
    .map((connection) => {
      if (
        (connection.kind !== "input" && connection.kind !== "prompt") ||
        typeof connection.sourceDescriptorId !== "string" ||
        typeof connection.targetDescriptorId !== "string"
      ) {
        return null;
      }

      return {
        kind: connection.kind,
        sourceDescriptorId: connection.sourceDescriptorId,
        targetDescriptorId: connection.targetDescriptorId,
      } satisfies GeneratedConnectionDescriptor;
    })
    .filter((connection): connection is GeneratedConnectionDescriptor => Boolean(connection));
}

function getGeneratedNodeDescriptors(
  providerResponse: Record<string, unknown> | null | undefined,
  sourceJobId: string,
  sourceModelNodeId: string | null | undefined,
  runOrigin: "canvas-node" | "copilot"
): GeneratedNodeDescriptor[] {
  if (!providerResponse || typeof providerResponse !== "object") {
    return [];
  }

  if (Array.isArray(providerResponse.generatedNodeDescriptors)) {
    return normalizeGeneratedNodeDescriptors(
      providerResponse.generatedNodeDescriptors,
      sourceJobId,
      sourceModelNodeId,
      runOrigin
    );
  }

  const textOutputs = getLatestTextOutputs(providerResponse);
  if (textOutputs.length === 0) {
    return [];
  }

  const textOutputTarget = readOpenAiTextOutputTarget(providerResponse.textOutputTarget);
  if (textOutputTarget !== "note") {
    return [];
  }

  return createGeneratedTextNoteDescriptorsFromRawText({
    outputs: textOutputs.map((output) => ({
      content: output.content,
      outputIndex: output.outputIndex,
    })),
    sourceJobId,
    sourceModelNodeId,
    runOrigin,
  });
}

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

function serializeJobRows(
  rows: typeof jobs.$inferSelect[],
  assetsByJobId: Map<string, Array<{ id: string; type: string; mimeType: string; outputIndex: number | null; createdAt: string }>>,
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
  return rows.map((job) => ({
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
    latestTextOutputs: getLatestTextOutputs(latestAttemptByJobId.get(job.id)?.providerResponse || null),
    textOutputTarget: getStoredTextOutputTarget(
      latestAttemptByJobId.get(job.id)?.providerResponse || null,
      (job.nodeRunPayload as Record<string, unknown> | undefined)?.settings &&
        typeof (job.nodeRunPayload as Record<string, unknown> | undefined)?.settings === "object"
        ? ((job.nodeRunPayload as Record<string, unknown>).settings as Record<string, unknown>).textOutputTarget
        : undefined
    ),
    generatedNodeDescriptors: getGeneratedNodeDescriptors(
      latestAttemptByJobId.get(job.id)?.providerResponse || null,
      job.id,
      typeof (job.nodeRunPayload as Record<string, unknown> | undefined)?.nodeId === "string" &&
        (job.nodeRunPayload as Record<string, unknown> | undefined)?.runOrigin !== "copilot"
        ? String((job.nodeRunPayload as Record<string, unknown>).nodeId)
        : null,
      (job.nodeRunPayload as Record<string, unknown> | undefined)?.runOrigin === "copilot" ? "copilot" : "canvas-node"
    ),
    generatedConnections: getGeneratedConnections(latestAttemptByJobId.get(job.id)?.providerResponse || null),
    generatedOutputWarning:
      latestAttemptByJobId.get(job.id)?.providerResponse &&
      typeof latestAttemptByJobId.get(job.id)?.providerResponse === "object" &&
      typeof (latestAttemptByJobId.get(job.id)?.providerResponse as Record<string, unknown>).generatedNodeDescriptorWarning ===
        "string"
        ? String(
            (latestAttemptByJobId.get(job.id)?.providerResponse as Record<string, unknown>).generatedNodeDescriptorWarning
          )
        : null,
  }));
}

export async function listJobs(projectId: string): Promise<Job[]> {
  const db = getDb();
  const rows = db.select().from(jobs).where(eq(jobs.projectId, projectId)).orderBy(desc(jobs.createdAt)).limit(100).all();
  const jobIds = rows.map((job) => job.id);
  const jobAssetRows = jobIds.length ? db.select().from(assets).where(inArray(assets.jobId, jobIds)).all() : [];
  const previewRows = jobIds.length ? db.select().from(jobPreviewFrames).where(inArray(jobPreviewFrames.jobId, jobIds)).all() : [];
  const attempts = jobIds.length ? db.select().from(jobAttempts).where(inArray(jobAttempts.jobId, jobIds)).all() : [];

  const assetsByJobId = jobAssetRows.reduce<Map<string, Array<{ id: string; type: string; mimeType: string; outputIndex: number | null; createdAt: string }>>>(
    (acc, asset) => {
      if (!asset.jobId) {
        return acc;
      }
      const next = acc.get(asset.jobId) || [];
      next.push({
        id: asset.id,
        type: asset.type as Job["assets"][number]["type"],
        mimeType: asset.mimeType,
        outputIndex: asset.outputIndex,
        createdAt: asset.createdAt,
      });
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
        next.push({
          id: preview.id,
          outputIndex: preview.outputIndex,
          previewIndex: preview.previewIndex,
          mimeType: preview.mimeType,
          width: preview.width,
          height: preview.height,
          createdAt: preview.createdAt,
        });
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

  const [job] = serializeJobRows([row], new Map(), new Map(), new Map());
  const attempts = db.select().from(jobAttempts).where(eq(jobAttempts.jobId, jobId)).orderBy(desc(jobAttempts.attemptNumber), desc(jobAttempts.createdAt)).all();

  return {
    job,
    attempts: attempts.map((attempt) => ({
      id: attempt.id,
      attemptNumber: attempt.attemptNumber,
      providerRequest: attempt.providerRequest,
      providerResponse: attempt.providerResponse,
      errorCode: attempt.errorCode,
      errorMessage: attempt.errorMessage,
      durationMs: attempt.durationMs,
      createdAt: attempt.createdAt,
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
