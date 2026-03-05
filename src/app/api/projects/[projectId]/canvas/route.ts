import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { badRequest, internalError } from "@/lib/server/http";

const canvasSchema = z.object({
  canvasDocument: z.record(z.string(), z.unknown()).nullable().optional(),
  viewportState: z.record(z.string(), z.unknown()).optional(),
  selectionState: z.record(z.string(), z.unknown()).optional(),
  assetViewerLayout: z.enum(["grid", "compare_2", "compare_4"]).optional(),
  filterState: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    const [canvas, workspace] = await prisma.$transaction([
      prisma.canvas.findUnique({ where: { projectId } }),
      prisma.projectWorkspaceState.findUnique({ where: { projectId } }),
    ]);

    return NextResponse.json({ canvas, workspace });
  } catch (error) {
    return internalError(error);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    const parsed = canvasSchema.safeParse(await request.json());

    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message || "Invalid payload");
    }

    const canvasDocument = (parsed.data.canvasDocument || {}) as Prisma.InputJsonValue;

    const canvas = await prisma.canvas.upsert({
      where: { projectId },
      create: {
        projectId,
        canvasDocument,
      },
      update: {
        canvasDocument,
        version: { increment: 1 },
      },
    });

    if (
      parsed.data.viewportState ||
      parsed.data.selectionState ||
      parsed.data.assetViewerLayout ||
      parsed.data.filterState
    ) {
      await prisma.projectWorkspaceState.upsert({
        where: { projectId },
        create: {
          projectId,
          isOpen: false,
          viewportState: (parsed.data.viewportState || {}) as Prisma.InputJsonValue,
          selectionState: (parsed.data.selectionState || {}) as Prisma.InputJsonValue,
          filterState: (parsed.data.filterState || {}) as Prisma.InputJsonValue,
          assetViewerLayout: parsed.data.assetViewerLayout || "grid",
        },
        update: {
          ...(parsed.data.viewportState
            ? { viewportState: parsed.data.viewportState as Prisma.InputJsonValue }
            : {}),
          ...(parsed.data.selectionState
            ? { selectionState: parsed.data.selectionState as Prisma.InputJsonValue }
            : {}),
          ...(parsed.data.filterState
            ? { filterState: parsed.data.filterState as Prisma.InputJsonValue }
            : {}),
          ...(parsed.data.assetViewerLayout
            ? { assetViewerLayout: parsed.data.assetViewerLayout }
            : {}),
        },
      });
    }

    return NextResponse.json({ canvas });
  } catch (error) {
    return internalError(error);
  }
}
