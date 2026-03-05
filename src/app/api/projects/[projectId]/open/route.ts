import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { internalError } from "@/lib/server/http";

export async function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;

    await prisma.$transaction([
      prisma.projectWorkspaceState.updateMany({ data: { isOpen: false } }),
      prisma.projectWorkspaceState.upsert({
        where: { projectId },
        update: { isOpen: true },
        create: {
          projectId,
          isOpen: true,
          viewportState: {},
          selectionState: {},
          filterState: {},
          assetViewerLayout: "grid",
        },
      }),
      prisma.project.update({ where: { id: projectId }, data: { lastOpenedAt: new Date() } }),
    ]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return internalError(error);
  }
}
