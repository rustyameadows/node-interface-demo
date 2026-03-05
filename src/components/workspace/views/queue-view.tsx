"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getJobs, openProject } from "@/components/workspace/client-api";
import type { Job } from "@/components/workspace/types";
import styles from "./queue-view.module.css";

type Props = {
  projectId: string;
};

const stateOptions = ["all", "queued", "running", "succeeded", "failed", "canceled"] as const;
type StateFilter = (typeof stateOptions)[number];

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  return date.toLocaleString();
}

export function QueueView({ projectId }: Props) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [loading, setLoading] = useState(true);

  const refreshJobs = useCallback(async () => {
    const nextJobs = await getJobs(projectId);
    setJobs(nextJobs);
  }, [projectId]);

  useEffect(() => {
    setLoading(true);

    Promise.all([refreshJobs(), openProject(projectId)])
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [projectId, refreshJobs]);

  useEffect(() => {
    const interval = setInterval(() => {
      refreshJobs().catch(console.error);
    }, 2500);

    return () => clearInterval(interval);
  }, [refreshJobs]);

  const visibleJobs = useMemo(() => {
    if (stateFilter === "all") {
      return jobs;
    }

    return jobs.filter((job) => job.state === stateFilter);
  }, [jobs, stateFilter]);

  return (
    <WorkspaceShell projectId={projectId} view="queue" jobs={jobs}>
      <main className={styles.page}>
        <section className={styles.panel}>
          <header className={styles.header}>
            <h1>Queue</h1>

            <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value as StateFilter)}>
              {stateOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </header>

          {loading ? (
            <div className={styles.loading}>Loading queue...</div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>State</th>
                    <th>Provider</th>
                    <th>Model</th>
                    <th>Queued</th>
                    <th>Started</th>
                    <th>Finished</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleJobs.map((job) => (
                    <tr key={job.id}>
                      <td>
                        <span className={`${styles.state} ${styles[`state_${job.state}`] || ""}`}>{job.state}</span>
                      </td>
                      <td>{job.providerId}</td>
                      <td>{job.modelId}</td>
                      <td>{formatDate(job.createdAt)}</td>
                      <td>{formatDate(job.startedAt)}</td>
                      <td>{formatDate(job.finishedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {visibleJobs.length === 0 && <div className={styles.empty}>No jobs in this state.</div>}
            </div>
          )}
        </section>
      </main>
    </WorkspaceShell>
  );
}
