import { PgBoss } from "pg-boss";

export const JOB_QUEUE_NAME = "generation-job";

const globalForBoss = globalThis as unknown as {
  boss: PgBoss | undefined;
  bossStartPromise: Promise<PgBoss> | undefined;
};

export async function getBoss(): Promise<PgBoss> {
  if (globalForBoss.boss) {
    return globalForBoss.boss;
  }

  if (globalForBoss.bossStartPromise) {
    return globalForBoss.bossStartPromise;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for pg-boss queue mode.");
  }

  const boss = new PgBoss({ connectionString, schema: process.env.PG_BOSS_SCHEMA || "pgboss" });

  globalForBoss.bossStartPromise = boss.start().then(async () => {
    await boss.createQueue(JOB_QUEUE_NAME);
    globalForBoss.boss = boss;
    return boss;
  });

  return globalForBoss.bossStartPromise;
}

export function getExecutionMode() {
  return process.env.JOB_EXECUTION_MODE || "inline";
}
