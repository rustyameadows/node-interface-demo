import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAllProviderModels } from "@/lib/providers/registry";
import { syncProviderModels } from "@/lib/server/provider-models";
import { internalError } from "@/lib/server/http";

export async function GET() {
  try {
    await syncProviderModels();

    const models = await prisma.providerModel.findMany({
      where: { active: true },
      orderBy: [{ providerId: "asc" }, { displayName: "asc" }],
    });

    return NextResponse.json({
      providers: models,
      fallback: getAllProviderModels(),
    });
  } catch (error) {
    return internalError(error);
  }
}
