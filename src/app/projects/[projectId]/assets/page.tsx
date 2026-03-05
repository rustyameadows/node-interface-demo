import { AssetsView } from "@/components/workspace/views/assets-view";

export default async function ProjectAssetsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <AssetsView projectId={projectId} />;
}
