import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAllProviderModels } from "@/lib/providers/registry";

export async function syncProviderModels() {
  const models = getAllProviderModels();
  const activePairs = models.map((model) => ({ providerId: model.providerId, modelId: model.modelId }));

  await prisma.$transaction([
    prisma.providerModel.updateMany({
      where: {
        NOT: {
          OR: activePairs,
        },
      },
      data: {
        active: false,
      },
    }),
    ...models.map((model) =>
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
    ),
  ]);
}
