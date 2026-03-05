import { getBoss, JOB_QUEUE_NAME } from "@/lib/queue/boss";
import { processJobById } from "@/lib/server/job-processor";

async function startWorker() {
  const boss = await getBoss();

  await boss.work(JOB_QUEUE_NAME, async (work) => {
    const batch = Array.isArray(work) ? work : [work];
    for (const item of batch) {
      const payload = item.data as { jobId?: string };
      if (!payload?.jobId) {
        continue;
      }

      await processJobById(payload.jobId);
    }
  });

  console.log(`Worker listening on queue '${JOB_QUEUE_NAME}'`);
}

startWorker().catch((error) => {
  console.error("Failed to start worker", error);
  process.exit(1);
});
