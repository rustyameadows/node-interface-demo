import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { badRequest, internalError } from "@/lib/server/http";

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export async function GET() {
  try {
    const projects = await prisma.project.findMany({
      include: {
        workspaceState: true,
        _count: {
          select: {
            jobs: true,
            assets: true,
          },
        },
      },
      orderBy: [{ lastOpenedAt: "desc" }, { createdAt: "desc" }],
    });

    return NextResponse.json({ projects });
  } catch (error) {
    return internalError(error);
  }
}

export async function POST(request: Request) {
  try {
    const parsed = createProjectSchema.safeParse(await request.json());
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message || "Invalid request payload");
    }

    const openWorkspace = await prisma.projectWorkspaceState.findFirst({ where: { isOpen: true } });
    const shouldOpen = !openWorkspace;

    const project = await prisma.project.create({
      data: {
        name: parsed.data.name,
        status: "active",
        lastOpenedAt: shouldOpen ? new Date() : null,
        workspaceState: {
          create: {
            isOpen: shouldOpen,
            viewportState: {},
            selectionState: {},
            filterState: {},
            assetViewerLayout: "grid",
          },
        },
        canvas: {
          create: {
            canvasDocument: { canvasViewport: { x: 240, y: 180, zoom: 1 }, workflow: { nodes: [] } },
            version: 1,
          },
        },
      },
      include: {
        workspaceState: true,
      },
    });

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return internalError(error);
  }
}
