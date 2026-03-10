"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Panel, SectionHeader, SelectField } from "@/components/ui";
import { getJobs, openProject } from "@/components/workspace/client-api";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import type { Job } from "@/components/workspace/types";
import { buildUiDataAttributes } from "@/lib/design-system";
import { getJobDiagnosticsNotice } from "@/lib/job-diagnostics";
import { useRouter, useSearchParams } from "@/renderer/navigation";
import { queryKeys } from "@/renderer/query";
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

  return new Date(value).toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDuration(startedAt: string | null, finishedAt: string | null) {
  if (!startedAt || !finishedAt) {
    return "-";
  }

  return `${Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime())}ms`;
}

function formatOutputType(job: Job) {
  const count = job.nodeRunPayload?.outputCount || 1;
  const type = job.nodeRunPayload?.outputType || "output";
  return `${count} ${type}${count === 1 ? "" : "s"}`;
}

function formatProduced(job: Job) {
  const pieces = [
    `${job.assets?.length || 0} assets`,
    `${job.generatedNodeDescriptors?.length || 0} nodes`,
  ];

  if ((job.latestPreviewFrames?.length || 0) > 0) {
    pieces.push(`${job.latestPreviewFrames?.length || 0} previews`);
  }
  if ((job.latestTextOutputs?.length || 0) > 0) {
    pieces.push(`${job.latestTextOutputs?.length || 0} text`);
  }

  return pieces.join(" · ");
}

function formatRequest(job: Job) {
  const executionMode = job.nodeRunPayload?.executionMode || "-";
  const inputCount =
    job.nodeRunPayload?.inputImageAssetIds?.length || job.nodeRunPayload?.upstreamAssetIds?.length || 0;

  return `${executionMode} · ${formatOutputType(job)} · ${inputCount} inputs`;
}

function formatSource(job: Job) {
  const nodeId = job.nodeRunPayload?.nodeId || "-";
  const runOrigin = job.nodeRunPayload?.runOrigin || "canvas-node";
  return `${nodeId} · ${runOrigin}`;
}

function formatModel(job: Job) {
  return `${job.providerId}\n${job.modelId}`;
}

function formatStatusNote(job: Job) {
  if (job.errorMessage?.trim()) {
    return job.errorMessage.trim();
  }

  const notice = getJobDiagnosticsNotice({
    mixedOutputDiagnostics: job.mixedOutputDiagnostics,
    generatedOutputWarning: job.generatedOutputWarning,
  });

  if (!notice) {
    return "-";
  }

  return notice.length > 110 ? `${notice.slice(0, 107)}...` : notice;
}

export function QueueView({ projectId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const bootstrapInspectJobId = searchParams.get("inspectJobId");
  const { data: jobs = [], isLoading } = useQuery<Job[]>({
    queryKey: queryKeys.jobs(projectId),
    queryFn: () => getJobs(projectId),
    refetchInterval: (query) => {
      const currentJobs = (query.state.data as Job[] | undefined) || [];
      return currentJobs.some((job) => job.state === "queued" || job.state === "running") ? 900 : 2_500;
    },
  });

  useEffect(() => {
    openProject(projectId).catch(console.error);
  }, [projectId]);

  useEffect(() => {
    if (!bootstrapInspectJobId) {
      return;
    }

    router.push(`/projects/${projectId}/queue/${bootstrapInspectJobId}`);
  }, [bootstrapInspectJobId, projectId, router]);

  const visibleJobs = useMemo(() => {
    if (stateFilter === "all") {
      return jobs;
    }

    return jobs.filter((job) => job.state === stateFilter);
  }, [jobs, stateFilter]);

  return (
    <WorkspaceShell projectId={projectId} view="queue" jobs={jobs}>
      <main {...buildUiDataAttributes("app", "compact")} className={styles.page}>
        <Panel variant="shell" density="compact" className={styles.panel}>
          <header className={styles.header}>
            <SectionHeader
              eyebrow="Execution"
              title="Run Queue"
              description="Dense run ledger. Click any row to open the full execution record."
            />

            <SelectField value={stateFilter} onChange={(event) => setStateFilter(event.target.value as StateFilter)}>
              {stateOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </SelectField>
          </header>

          {isLoading ? (
            <div className={styles.loading}>Loading queue...</div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>State</th>
                    <th>Source</th>
                    <th>Provider / Model</th>
                    <th>Request</th>
                    <th>Produced</th>
                    <th>Queued / Duration</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleJobs.map((job) => (
                    <tr
                      key={job.id}
                      tabIndex={0}
                      onClick={() => router.push(`/projects/${projectId}/queue/${job.id}`)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          router.push(`/projects/${projectId}/queue/${job.id}`);
                        }
                      }}
                    >
                      <td className={styles.jobIdCell}>{job.id}</td>
                      <td>
                        <span className={`${styles.state} ${styles[`state_${job.state}`] || ""}`}>{job.state}</span>
                      </td>
                      <td className={styles.compoundCell}>{formatSource(job)}</td>
                      <td className={styles.multiLineCell}>{formatModel(job)}</td>
                      <td className={styles.compoundCell}>{formatRequest(job)}</td>
                      <td className={styles.compoundCell}>{formatProduced(job)}</td>
                      <td className={styles.multiLineCell}>{`${formatDate(job.createdAt)}\n${formatDuration(job.startedAt, job.finishedAt)}`}</td>
                      <td className={styles.statusCell} title={formatStatusNote(job)}>
                        {formatStatusNote(job)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {visibleJobs.length === 0 ? <div className={styles.empty}>No jobs in this state.</div> : null}
            </div>
          )}
        </Panel>
      </main>
    </WorkspaceShell>
  );
}
