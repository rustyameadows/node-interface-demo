import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getProviderAdapter } from "@/lib/providers/registry";
import { saveContentAsAsset } from "@/lib/storage/local-storage";
import type { NodePayload, ProviderId } from "@/lib/types";

function asNodePayload(value: unknown): NodePayload {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid node payload");
  }

  const raw = value as Record<string, unknown>;
  return {
    nodeId: String(raw.nodeId || "node"),
    nodeType: (raw.nodeType as NodePayload["nodeType"]) || "image-gen",
    prompt: String(raw.prompt || ""),
    settings: (raw.settings as Record<string, unknown>) || {},
    outputType: (raw.outputType as NodePayload["outputType"]) || "image",
    upstreamNodeIds: Array.isArray(raw.upstreamNodeIds)
      ? raw.upstreamNodeIds.map((id) => String(id))
      : [],
    upstreamAssetIds: Array.isArray(raw.upstreamAssetIds)
      ? raw.upstreamAssetIds.map((id) => String(id))
      : [],
  };
}

function toErrorMessage(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    return { code: "PROVIDER_ERROR", message: error.message };
  }
  return { code: "PROVIDER_ERROR", message: "Unknown provider execution error" };
}

export async function processJobById(jobId: string) {
  const existing = await prisma.job.findUnique({ where: { id: jobId } });
  if (!existing || existing.state !== "queued") {
    return;
  }

  const attemptNumber = existing.attempts + 1;
  const payload = asNodePayload(existing.nodeRunPayload);
  const providerId = existing.providerId as ProviderId;

  await prisma.job.update({
    where: { id: jobId },
    data: {
      state: "running",
      startedAt: new Date(),
      attempts: attemptNumber,
      errorCode: null,
      errorMessage: null,
    },
  });

  const start = Date.now();

  try {
    const adapter = getProviderAdapter(providerId);
    const outputs = await adapter.submitJob({
      projectId: existing.projectId,
      jobId,
      providerId,
      modelId: existing.modelId,
      payload,
    });

    await prisma.jobAttempt.create({
      data: {
        jobId,
        attemptNumber,
        providerRequest: {
          providerId,
          modelId: existing.modelId,
          payload,
        } as Prisma.InputJsonValue,
        providerResponse: {
          outputCount: outputs.length,
          outputTypes: outputs.map((output) => output.type),
        } as Prisma.InputJsonValue,
        durationMs: Date.now() - start,
      },
    });

    for (const output of outputs) {
      const stored = await saveContentAsAsset(existing.projectId, output.extension, output.content, output.encoding);
      const width = typeof output.metadata.width === "number" ? output.metadata.width : null;
      const height = typeof output.metadata.height === "number" ? output.metadata.height : null;
      const durationMs = typeof output.metadata.durationMs === "number" ? output.metadata.durationMs : null;

      const asset = await prisma.asset.create({
        data: {
          projectId: existing.projectId,
          jobId,
          type: output.type,
          storageRef: stored.storageRef,
          mimeType: output.mimeType,
          width,
          height,
          durationMs,
          checksum: stored.checksum,
        },
      });

      await prisma.assetFeedback.create({
        data: {
          assetId: asset.id,
          rating: null,
          flagged: false,
        },
      });
    }

    await prisma.job.update({
      where: { id: jobId },
      data: {
        state: "succeeded",
        finishedAt: new Date(),
      },
    });
  } catch (error) {
    const { code, message } = toErrorMessage(error);

    await prisma.jobAttempt.create({
      data: {
        jobId,
        attemptNumber,
        providerRequest: {
          providerId,
          modelId: existing.modelId,
          payload,
        } as Prisma.InputJsonValue,
        errorCode: code,
        errorMessage: message,
        durationMs: Date.now() - start,
      },
    });

    await prisma.job.update({
      where: { id: jobId },
      data: {
        state: "failed",
        errorCode: code,
        errorMessage: message,
        finishedAt: new Date(),
      },
    });
  }
}
