"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Panel, SectionHeader, SelectField, ToolbarGroup } from "@/components/ui";
import { getAssetFileUrl, getJobDebug, getJobs, getPreviewFrameFileUrl, openProject } from "@/components/workspace/client-api";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import type {
  JobAttemptDebug,
  JobDebugAssetReference,
  JobDebugNormalizedOutput,
  JobDebugPreviewFrame,
  JobDebugResponse,
} from "@/components/workspace/types";
import { buildUiDataAttributes } from "@/lib/design-system";
import {
  buildCountBreakdown,
  describeJobAttemptRequest,
  describeJobAttemptResponse,
  formatBreakdownList,
  formatCanvasImpactSummary,
  formatJobOutputReconciliationStats,
  getJobDiagnosticsNotice,
  type JobDiagnosticStat,
} from "@/lib/job-diagnostics";
import { useRouter } from "@/renderer/navigation";
import { queryKeys } from "@/renderer/query";
import styles from "./job-detail-view.module.css";

type Props = {
  projectId: string;
  jobId: string;
};

type OutputGroup = {
  outputIndex: number;
  normalizedOutputs: JobDebugNormalizedOutput[];
  assets: JobDebugAssetReference[];
  previewFrames: JobDebugPreviewFrame[];
  descriptors: NonNullable<JobDebugResponse["job"]["generatedNodeDescriptors"]>;
};

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString();
}

function formatDuration(startedAt: string | null | undefined, finishedAt: string | null | undefined) {
  if (!startedAt || !finishedAt) {
    return "-";
  }

  return `${Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime())}ms`;
}

function renderJson(value: Record<string, unknown> | null) {
  if (!value) {
    return "-";
  }

  return JSON.stringify(value, null, 2);
}

function attemptLabel(attempt: JobAttemptDebug) {
  return `Attempt ${attempt.attemptNumber}`;
}

function assetTitle(asset: JobDebugAssetReference) {
  if (!asset.storageRef) {
    return asset.id;
  }

  const segments = asset.storageRef.split("/");
  return segments[segments.length - 1] || asset.storageRef;
}

function OutputMediaCard(props: {
  label: string;
  type: "asset" | "preview";
  asset?: JobDebugAssetReference;
  previewFrame?: JobDebugPreviewFrame;
  onOpenAsset?: (assetId: string) => void;
}) {
  const { label, type, asset, previewFrame, onOpenAsset } = props;
  const mimeType = asset?.mimeType || previewFrame?.mimeType || "";
  const isImage = mimeType.startsWith("image/");
  const isText = mimeType.startsWith("text/") || mimeType === "application/json";
  const imageSrc =
    type === "asset" && asset ? getAssetFileUrl(asset.id) : previewFrame ? getPreviewFrameFileUrl(previewFrame.id, previewFrame.createdAt) : "";

  return (
    <div className={styles.mediaCard}>
      <div className={styles.mediaThumb}>
        {isImage ? (
          <img src={imageSrc} alt={label} />
        ) : isText ? (
          <div className={styles.mediaPlaceholder}>TEXT</div>
        ) : (
          <div className={styles.mediaPlaceholder}>MEDIA</div>
        )}
      </div>
      <div className={styles.mediaMeta}>
        <strong>{label}</strong>
        <span>{mimeType || "-"}</span>
        {asset ? (
          <span>
            {asset.width && asset.height ? `${asset.width} x ${asset.height}` : "unknown size"}
          </span>
        ) : previewFrame ? (
          <span>
            {previewFrame.width && previewFrame.height ? `${previewFrame.width} x ${previewFrame.height}` : "preview"}
          </span>
        ) : null}
      </div>
      {asset && onOpenAsset ? (
        <Button size="sm" variant="ghost" onClick={() => onOpenAsset(asset.id)}>
          Open Asset
        </Button>
      ) : null}
    </div>
  );
}

function SummaryStrip(props: { title: string; items: JobDiagnosticStat[] }) {
  return (
    <section className={styles.summaryStrip}>
      <h3>{props.title}</h3>
      <div className={styles.summaryStripGrid}>
        {props.items.map((item) => (
          <div key={item.label} className={styles.summaryTile}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            {item.note ? <small>{item.note}</small> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function PrettySections(props: { sections: ReturnType<typeof describeJobAttemptRequest> | ReturnType<typeof describeJobAttemptResponse> }) {
  return (
    <div className={styles.prettySections}>
      {props.sections.map((section) => (
        <section key={section.title} className={styles.prettySection}>
          <h4>{section.title}</h4>
          {section.note ? <p className={styles.prettyNote}>{section.note}</p> : null}
          <dl className={styles.prettyList}>
            {section.items.map((item) => (
              <div key={`${section.title}:${item.label}`} className={styles.prettyRow}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

function TextOutputCard({ output }: { output: JobDebugNormalizedOutput }) {
  return (
    <div className={styles.textOutputCard}>
      <div className={styles.textOutputHeader}>
        <strong>{`Text Output ${output.outputIndex + 1}`}</strong>
        <span>{output.mimeType}</span>
      </div>
      <pre>{output.content || ""}</pre>
    </div>
  );
}

export function JobDetailView({ projectId, jobId }: Props) {
  const router = useRouter();
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);
  const [requestLens, setRequestLens] = useState<"pretty" | "raw">("pretty");
  const [responseLens, setResponseLens] = useState<"pretty" | "raw">("pretty");
  const { data: jobs = [] } = useQuery({
    queryKey: queryKeys.jobs(projectId),
    queryFn: () => getJobs(projectId),
    refetchInterval: (query) => {
      const currentJobs = query.state.data || [];
      return currentJobs.some((job) => job.state === "queued" || job.state === "running") ? 900 : 2_500;
    },
  });
  const {
    data: jobDebug,
    isLoading,
    error,
  } = useQuery<JobDebugResponse>({
    queryKey: queryKeys.jobDebug(projectId, jobId),
    queryFn: () => getJobDebug(projectId, jobId),
  });

  useEffect(() => {
    openProject(projectId).catch(console.error);
  }, [projectId]);

  useEffect(() => {
    if (!jobDebug?.attempts.length) {
      setSelectedAttemptId(null);
      return;
    }

    setSelectedAttemptId((current) =>
      current && jobDebug.attempts.some((attempt) => attempt.id === current) ? current : jobDebug.attempts[0]!.id
    );
  }, [jobDebug]);

  const selectedAttempt =
    jobDebug?.attempts.find((attempt) => attempt.id === selectedAttemptId) || jobDebug?.attempts[0] || null;
  const diagnosticsNotice = jobDebug
    ? getJobDiagnosticsNotice({
        mixedOutputDiagnostics: selectedAttempt?.mixedOutputDiagnostics || jobDebug.job.mixedOutputDiagnostics,
        generatedOutputWarning: jobDebug.job.generatedOutputWarning,
      })
    : null;

  const outputGroups = useMemo<OutputGroup[]>(() => {
    if (!jobDebug) {
      return [];
    }

    const indices = new Set<number>();
    for (const output of jobDebug.normalizedOutputs) indices.add(output.outputIndex);
    for (const asset of jobDebug.outputAssets) {
      if (typeof asset.outputIndex === "number") {
        indices.add(asset.outputIndex);
      }
    }
    for (const previewFrame of jobDebug.previewFrames) indices.add(previewFrame.outputIndex);
    for (const descriptor of jobDebug.job.generatedNodeDescriptors || []) indices.add(descriptor.outputIndex);

    return [...indices]
      .sort((left, right) => left - right)
      .map((outputIndex) => ({
        outputIndex,
        normalizedOutputs: jobDebug.normalizedOutputs.filter((output) => output.outputIndex === outputIndex),
        assets: jobDebug.outputAssets.filter((asset) => asset.outputIndex === outputIndex),
        previewFrames: jobDebug.previewFrames.filter((previewFrame) => previewFrame.outputIndex === outputIndex),
        descriptors: (jobDebug.job.generatedNodeDescriptors || []).filter((descriptor) => descriptor.outputIndex === outputIndex),
      }));
  }, [jobDebug]);

  const errorMessage = error instanceof Error ? error.message : null;

  return (
    <WorkspaceShell projectId={projectId} view="queue" jobs={jobs}>
      <main {...buildUiDataAttributes("app", "compact")} className={styles.page} data-testid="job-diagnostics-view">
        <Panel variant="shell" density="compact" className={styles.panel}>
          <header className={styles.header}>
            <ToolbarGroup className={styles.headerActions}>
              <Button size="sm" variant="secondary" onClick={() => router.push(`/projects/${projectId}/queue`)}>
                Back to Queue
              </Button>
            </ToolbarGroup>
            <SectionHeader
              eyebrow="Execution"
              title="Execution Record"
              description="Lifecycle, inputs, outputs, canvas impact, and attempt payloads."
              actions={jobDebug ? <Badge variant="info">{jobDebug.job.state}</Badge> : null}
            />
          </header>

          {isLoading ? (
            <div className={styles.centerState}>Loading job diagnostics...</div>
          ) : errorMessage ? (
            <div className={styles.centerState}>{errorMessage}</div>
          ) : !jobDebug ? (
            <div className={styles.centerState}>Job not found.</div>
          ) : (
            <div className={styles.body}>
              <SummaryStrip title="Reconciliation" items={formatJobOutputReconciliationStats(jobDebug.outputReconciliation)} />

              <section className={styles.section}>
                <h2>Outputs</h2>
                {outputGroups.length === 0 ? (
                  <p className={styles.emptyText}>No normalized outputs or assets were persisted for this job.</p>
                ) : (
                  <div className={styles.outputGroups}>
                    {outputGroups.map((group) => (
                      <div key={group.outputIndex} className={styles.outputGroup}>
                        <header className={styles.outputGroupHeader}>
                          <h3>{`Output ${group.outputIndex + 1}`}</h3>
                          <span>
                            {formatBreakdownList(
                              buildCountBreakdown(group.normalizedOutputs.map((output) => output.type)),
                              "no normalized outputs"
                            )}
                          </span>
                        </header>
                        {group.assets.length > 0 ? (
                          <div className={styles.mediaGrid}>
                            {group.assets.map((asset) => (
                              <OutputMediaCard
                                key={asset.id}
                                label={assetTitle(asset)}
                                type="asset"
                                asset={asset}
                                onOpenAsset={(assetId) => router.push(`/projects/${projectId}/assets/${assetId}`)}
                              />
                            ))}
                          </div>
                        ) : null}
                        {group.previewFrames.length > 0 ? (
                          <div className={styles.mediaGrid}>
                            {group.previewFrames.map((previewFrame) => (
                              <OutputMediaCard
                                key={previewFrame.id}
                                label={`Preview ${previewFrame.previewIndex + 1}`}
                                type="preview"
                                previewFrame={previewFrame}
                              />
                            ))}
                          </div>
                        ) : null}
                        {group.normalizedOutputs.filter((output) => output.type === "text").length > 0 ? (
                          <div className={styles.textOutputGrid}>
                            {group.normalizedOutputs
                              .filter((output) => output.type === "text")
                              .map((output) => (
                                <TextOutputCard key={`${output.outputIndex}:${output.responseId || "text"}`} output={output} />
                              ))}
                          </div>
                        ) : null}
                        {group.descriptors.length > 0 ? (
                          <div className={styles.descriptorGrid}>
                            {group.descriptors.map((descriptor) => (
                              <div key={descriptor.descriptorId} className={styles.descriptorCard}>
                                <strong>{descriptor.label}</strong>
                                <span>{descriptor.kind}</span>
                                {"text" in descriptor ? <p>{descriptor.text}</p> : null}
                                {"columns" in descriptor ? (
                                  <p>{`${descriptor.columns.length} columns · ${descriptor.rows.length} rows`}</p>
                                ) : null}
                                {"templateText" in descriptor ? <pre>{descriptor.templateText}</pre> : null}
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
                {jobDebug.job.generatedConnections?.length ? (
                  <div className={styles.connectionStrip}>
                    {jobDebug.job.generatedConnections.map((connection) => (
                      <span key={`${connection.kind}:${connection.sourceDescriptorId}:${connection.targetDescriptorId}`}>
                        {`${connection.kind}: ${connection.sourceDescriptorId} → ${connection.targetDescriptorId}`}
                      </span>
                    ))}
                  </div>
                ) : null}
              </section>

              <div className={styles.contentGrid}>
                <section className={styles.section}>
                  <h2>Overview</h2>
                  <dl className={styles.metaGrid}>
                    <div>
                      <dt>Job</dt>
                      <dd>{jobDebug.job.id}</dd>
                    </div>
                    <div>
                      <dt>Provider</dt>
                      <dd>{jobDebug.job.providerId}</dd>
                    </div>
                    <div>
                      <dt>Model</dt>
                      <dd>{jobDebug.job.modelId}</dd>
                    </div>
                    <div>
                      <dt>Source Node</dt>
                      <dd>{jobDebug.sourceNode?.label || jobDebug.sourceNode?.id || "-"}</dd>
                    </div>
                    <div>
                      <dt>Prompt Source</dt>
                      <dd>{jobDebug.promptSourceNode?.label || jobDebug.promptSourceNode?.id || "-"}</dd>
                    </div>
                    <div>
                      <dt>Run Origin</dt>
                      <dd>{jobDebug.job.nodeRunPayload?.runOrigin || "canvas-node"}</dd>
                    </div>
                    <div>
                      <dt>Queued</dt>
                      <dd>{formatDate(jobDebug.lifecycle.queuedAt)}</dd>
                    </div>
                    <div>
                      <dt>Started</dt>
                      <dd>{formatDate(jobDebug.lifecycle.startedAt)}</dd>
                    </div>
                    <div>
                      <dt>Finished</dt>
                      <dd>{formatDate(jobDebug.lifecycle.finishedAt)}</dd>
                    </div>
                    <div>
                      <dt>Duration</dt>
                      <dd>{formatDuration(jobDebug.lifecycle.startedAt, jobDebug.lifecycle.finishedAt)}</dd>
                    </div>
                    <div>
                      <dt>Attempts</dt>
                      <dd>{`${jobDebug.lifecycle.attempts}/${jobDebug.lifecycle.maxAttempts}`}</dd>
                    </div>
                    <div>
                      <dt>Last Heartbeat</dt>
                      <dd>{formatDate(jobDebug.lifecycle.lastHeartbeatAt)}</dd>
                    </div>
                  </dl>
                  {diagnosticsNotice ? <p className={styles.notice}>{diagnosticsNotice}</p> : null}
                  <SummaryStrip title="Canvas Impact" items={formatCanvasImpactSummary(jobDebug.canvasImpact)} />
                </section>

                <section className={styles.section}>
                  <h2>Inputs</h2>
                  <dl className={styles.metaGrid}>
                    <div>
                      <dt>Prompt</dt>
                      <dd className={styles.wrapValue}>{jobDebug.job.nodeRunPayload?.prompt?.trim() || "-"}</dd>
                    </div>
                    <div>
                      <dt>Execution Mode</dt>
                      <dd>{jobDebug.job.nodeRunPayload?.executionMode || "-"}</dd>
                    </div>
                    <div>
                      <dt>Requested Output Count</dt>
                      <dd>{jobDebug.job.nodeRunPayload?.outputCount || 1}</dd>
                    </div>
                    <div>
                      <dt>Text Target</dt>
                      <dd>{jobDebug.job.textOutputTarget || "-"}</dd>
                    </div>
                  </dl>
                  {jobDebug.inputAssets.length > 0 ? (
                    <div className={styles.mediaGrid}>
                      {jobDebug.inputAssets.map((asset) => (
                        <OutputMediaCard
                          key={asset.id}
                          label={assetTitle(asset)}
                          type="asset"
                          asset={asset}
                          onOpenAsset={(assetId) => router.push(`/projects/${projectId}/assets/${assetId}`)}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className={styles.emptyText}>No asset inputs were serialized for the latest attempt.</p>
                  )}
                </section>
              </div>

              <section className={styles.section}>
                <div className={styles.tabHeader}>
                  <h2>Attempts</h2>
                  {jobDebug.attempts.length > 0 ? (
                    <SelectField value={selectedAttempt?.id || ""} onChange={(event) => setSelectedAttemptId(event.target.value)}>
                      {jobDebug.attempts.map((attempt) => (
                        <option key={attempt.id} value={attempt.id}>
                          {attemptLabel(attempt)}
                        </option>
                      ))}
                    </SelectField>
                  ) : null}
                </div>
                <div className={styles.attemptTimeline}>
                  {jobDebug.attempts.map((attempt) => (
                    <button
                      key={attempt.id}
                      type="button"
                      className={`${styles.attemptChip} ${selectedAttempt?.id === attempt.id ? styles.attemptChipActive : ""}`}
                      onClick={() => setSelectedAttemptId(attempt.id)}
                    >
                      <strong>{attemptLabel(attempt)}</strong>
                      <span>{formatDate(attempt.createdAt)}</span>
                    </button>
                  ))}
                </div>
                {selectedAttempt ? (
                  <div className={styles.attemptInspectorGrid}>
                    <div className={styles.prettyContainer}>
                      <div className={styles.tabHeader}>
                        <h3>Request</h3>
                        <ToolbarGroup>
                          <Button size="sm" variant={requestLens === "pretty" ? "secondary" : "ghost"} onClick={() => setRequestLens("pretty")}>
                            Request Summary
                          </Button>
                          <Button size="sm" variant={requestLens === "raw" ? "secondary" : "ghost"} onClick={() => setRequestLens("raw")}>
                            Request JSON
                          </Button>
                        </ToolbarGroup>
                      </div>
                      {requestLens === "pretty" ? (
                        <PrettySections sections={describeJobAttemptRequest(selectedAttempt)} />
                      ) : (
                        <pre className={styles.codeBlock}>{renderJson(selectedAttempt.providerRequest)}</pre>
                      )}
                    </div>
                    <div className={styles.prettyContainer}>
                      <div className={styles.tabHeader}>
                        <h3>Response</h3>
                        <ToolbarGroup>
                          <Button size="sm" variant={responseLens === "pretty" ? "secondary" : "ghost"} onClick={() => setResponseLens("pretty")}>
                            Response Summary
                          </Button>
                          <Button size="sm" variant={responseLens === "raw" ? "secondary" : "ghost"} onClick={() => setResponseLens("raw")}>
                            Response JSON
                          </Button>
                        </ToolbarGroup>
                      </div>
                      {responseLens === "pretty" ? (
                        <PrettySections sections={describeJobAttemptResponse(selectedAttempt)} />
                      ) : (
                        <pre className={styles.codeBlock}>{renderJson(selectedAttempt.providerResponse)}</pre>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className={styles.emptyText}>No attempts recorded.</p>
                )}
              </section>
            </div>
          )}
        </Panel>
      </main>
    </WorkspaceShell>
  );
}
