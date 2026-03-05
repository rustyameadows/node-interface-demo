import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readAssetContent } from "@/lib/storage/local-storage";
import { badRequest, internalError } from "@/lib/server/http";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ assetId: string }> }
) {
  try {
    const { assetId } = await context.params;
    const asset = await prisma.asset.findUnique({ where: { id: assetId } });

    if (!asset) {
      return badRequest("Asset not found", 404);
    }

    const file = await readAssetContent(asset.storageRef);

    return new NextResponse(new Uint8Array(file), {
      status: 200,
      headers: {
        "Content-Type": asset.mimeType,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return internalError(error);
  }
}
