import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { badRequest, internalError } from "@/lib/server/http";
import { dispatchJob } from "@/lib/server/job-dispatch";
import { syncProviderModels } from "@/lib/server/provider-models";

const createJobSchema = z.object({
  providerId: z.enum(["openai", "google-gemini", "topaz"]),
  modelId: z.string().min(1),
  nodePayload: z.object({
    nodeId: z.string().min(1),
    nodeType: z.enum(["text-gen", "image-gen", "video-gen", "transform"]),
    prompt: z.string().default(""),
    settings: z.record(z.string(), z.unknown()).default({}),
    outputType: z.enum(["text", "image", "video"]),
    upstreamAssetIds: z.array(z.string()).default([]),
  }),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;

    const jobs = await prisma.job.findMany({
      where: { projectId },
      include: {
        assets: {
          select: { id: true, type: true, createdAt: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return NextResponse.json({ jobs });
  } catch (error) {
    return internalError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    const parsed = createJobSchema.safeParse(await request.json());

    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message || "Invalid payload");
    }

    await syncProviderModels();

    const job = await prisma.job.create({
      data: {
        projectId,
        state: "queued",
        providerId: parsed.data.providerId,
        modelId: parsed.data.modelId,
        nodeRunPayload: parsed.data.nodePayload as Prisma.InputJsonValue,
        attempts: 0,
        maxAttempts: 3,
      },
    });

    await dispatchJob(job.id);

    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    return internalError(error);
  }
}
