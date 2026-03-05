import { redirect } from "next/navigation";

export default async function ProjectRootPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  redirect(`/projects/${projectId}/canvas`);
}
