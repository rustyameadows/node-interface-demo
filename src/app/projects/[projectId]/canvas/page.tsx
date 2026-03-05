import { CanvasView } from "@/components/workspace/views/canvas-view";

export default async function ProjectCanvasPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <CanvasView projectId={projectId} />;
}
