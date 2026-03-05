import { SettingsView } from "@/components/workspace/views/settings-view";

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <SettingsView projectId={projectId} />;
}
