import { getBoss, getExecutionMode, JOB_QUEUE_NAME } from "@/lib/queue/boss";
import { processJobById } from "@/lib/server/job-processor";

export async function dispatchJob(jobId: string) {
  const mode = getExecutionMode();

  if (mode === "queue") {
    const boss = await getBoss();
    await boss.send(JOB_QUEUE_NAME, { jobId });
    return;
  }

  queueMicrotask(() => {
    processJobById(jobId).catch((error) => {
      console.error("Inline job processing failed", error);
    });
  });
}
