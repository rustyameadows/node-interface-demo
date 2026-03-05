import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAllProviderModels } from "@/lib/providers/registry";

export async function syncProviderModels() {
  const models = getAllProviderModels();

  await prisma.$transaction(
    models.map((model) =>
      prisma.providerModel.upsert({
        where: {
          providerId_modelId: {
            providerId: model.providerId,
            modelId: model.modelId,
          },
        },
        update: {
          displayName: model.displayName,
          capabilities: model.capabilities as Prisma.InputJsonValue,
          active: true,
        },
        create: {
          providerId: model.providerId,
          modelId: model.modelId,
          displayName: model.displayName,
          capabilities: model.capabilities as Prisma.InputJsonValue,
          active: true,
        },
      })
    )
  );
}
