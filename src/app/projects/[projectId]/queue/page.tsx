import { QueueView } from "@/components/workspace/views/queue-view";

export default async function ProjectQueuePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <QueueView projectId={projectId} />;
}
