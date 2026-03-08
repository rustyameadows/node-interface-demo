"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@/renderer/navigation";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import {
  clearProviderCredential,
  getProviderCredentials,
  getProviders,
  getProjects,
  openProject,
  removeProject,
  saveProviderCredential,
  updateProject,
} from "@/components/workspace/client-api";
import type {
  Project,
  ProviderCredentialKey,
  ProviderCredentialStatus,
  ProviderModel,
} from "@/components/workspace/types";
import { queryKeys } from "@/renderer/query";
import styles from "./settings-view.module.css";

type Props = {
  projectId: string;
};

const PROVIDER_LABELS: Record<ProviderCredentialKey, string> = {
  OPENAI_API_KEY: "OpenAI",
  GOOGLE_API_KEY: "Google Gemini",
  TOPAZ_API_KEY: "Topaz",
};

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  return date.toLocaleString();
}

function getCredentialSourceLabel(source: ProviderCredentialStatus["source"]) {
  if (source === "keychain") {
    return "Keychain";
  }

  if (source === "environment") {
    return "Environment";
  }

  return "None";
}

function getProviderCredentialHelpText(status: ProviderCredentialStatus) {
  if (status.source === "keychain") {
    return "Stored in the macOS Keychain. This value takes precedence over environment variables.";
  }

  if (status.source === "environment") {
    return "Loaded from the environment. Saving a value here writes a Keychain entry that overrides it.";
  }

  return "Missing. Save a value to Keychain here or provide it in .env.local for dev and source-run flows.";
}

function getProviderModelSummary(models: ProviderModel[], key: ProviderCredentialKey) {
  const providerId = key === "OPENAI_API_KEY" ? "openai" : key === "GOOGLE_API_KEY" ? "google-gemini" : "topaz";
  const matchingModels = models.filter((model) => model.providerId === providerId);
  const runnableCount = matchingModels.filter((model) => model.capabilities.runnable).length;

  if (matchingModels.length === 0) {
    return "No models registered.";
  }

  return `${runnableCount} of ${matchingModels.length} models runnable`;
}

export function SettingsView({ projectId }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credentialDrafts, setCredentialDrafts] = useState<Record<ProviderCredentialKey, string>>({
    OPENAI_API_KEY: "",
    GOOGLE_API_KEY: "",
    TOPAZ_API_KEY: "",
  });
  const [credentialBusyKey, setCredentialBusyKey] = useState<ProviderCredentialKey | null>(null);
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: queryKeys.projects,
    queryFn: getProjects,
  });
  const { data: providers = [] } = useQuery<ProviderModel[]>({
    queryKey: queryKeys.providers,
    queryFn: getProviders,
  });
  const { data: providerCredentials = [], isLoading: credentialsLoading } = useQuery<ProviderCredentialStatus[]>({
    queryKey: queryKeys.providerCredentials,
    queryFn: getProviderCredentials,
  });

  const project = useMemo(() => projects.find((item) => item.id === projectId) || null, [projects, projectId]);
  const credentialStatuses = useMemo(
    () =>
      providerCredentials.length > 0
        ? providerCredentials
        : (["OPENAI_API_KEY", "GOOGLE_API_KEY", "TOPAZ_API_KEY"] as ProviderCredentialKey[]).map((key) => ({
            key,
            configured: false,
            source: "none" as const,
          })),
    [providerCredentials]
  );

  useEffect(() => {
    openProject(projectId).catch(console.error);
  }, [projectId]);

  useEffect(() => {
    if (project) {
      setName(project.name);
    }
  }, [project]);

  return (
    <WorkspaceShell projectId={projectId} view="settings">
      <main className={styles.page}>
        <section className={styles.panel}>
          <h1>Project Settings</h1>

          {isLoading ? (
            <div className={styles.loading}>Loading project...</div>
          ) : !project ? (
            <div className={styles.error}>Project not found.</div>
          ) : (
            <>
              <label>
                Name
                <input value={name} onChange={(event) => setName(event.target.value)} disabled={busy} />
              </label>

              <div className={styles.metaRow}>
                <span>Created</span>
                <strong>{formatDate(project.createdAt)}</strong>
              </div>

              <div className={styles.metaRow}>
                <span>Updated</span>
                <strong>{formatDate(project.updatedAt)}</strong>
              </div>

              <div className={styles.metaRow}>
                <span>Last Opened</span>
                <strong>{formatDate(project.lastOpenedAt)}</strong>
              </div>

              <div className={styles.actionRow}>
                <button
                  disabled={busy || !name.trim() || name.trim() === project.name}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);

                    try {
                      await updateProject(projectId, { name: name.trim() });
                    } catch (nextError) {
                      setError(nextError instanceof Error ? nextError.message : "Failed to rename project");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Save Name
                </button>

                <button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);

                    try {
                      await updateProject(projectId, {
                        status: project.status === "active" ? "archived" : "active",
                      });
                    } catch (nextError) {
                      setError(nextError instanceof Error ? nextError.message : "Failed to update status");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {project.status === "active" ? "Archive Project" : "Unarchive Project"}
                </button>
              </div>

              <button
                className={styles.deleteButton}
                disabled={busy}
                onClick={async () => {
                  if (!confirm(`Delete project '${project.name}' and all data?`)) {
                    return;
                  }

                  setBusy(true);
                  setError(null);

                  try {
                    await removeProject(projectId);
                    const nextProjects = await getProjects();

                    const fallback = nextProjects.find((item) => item.status === "active") || nextProjects[0] || null;
                    if (!fallback) {
                      router.replace("/");
                      return;
                    }

                    await openProject(fallback.id);
                    router.replace(`/projects/${fallback.id}/canvas`);
                  } catch (nextError) {
                    setError(nextError instanceof Error ? nextError.message : "Failed to delete project");
                    setBusy(false);
                  }
                }}
              >
                Delete Project
              </button>

              {error && <div className={styles.error}>{error}</div>}
            </>
          )}
        </section>

        <section className={styles.panel}>
          <div className={styles.sectionHeader}>
            <div>
              <h1>Provider Credentials</h1>
              <p>Packaged apps can save provider API keys in the macOS Keychain. Keychain values override environment variables.</p>
            </div>
          </div>

          {credentialsLoading ? (
            <div className={styles.loading}>Loading provider credentials...</div>
          ) : (
            <div className={styles.credentialsList}>
              {credentialStatuses.map((status) => {
                const draftValue = credentialDrafts[status.key];
                const isSaving = credentialBusyKey === status.key && draftValue.trim().length > 0;
                const isClearing = credentialBusyKey === status.key && draftValue.trim().length === 0;
                const canClear = status.source === "keychain";

                return (
                  <section key={status.key} className={styles.credentialCard}>
                    <div className={styles.credentialHeader}>
                      <div>
                        <h2>{PROVIDER_LABELS[status.key]}</h2>
                        <p>{status.key}</p>
                      </div>

                      <div className={styles.badgeRow}>
                        <span className={status.configured ? styles.badgeReady : styles.badgeMissing}>
                          {status.configured ? "Configured" : "Missing"}
                        </span>
                        <span className={styles.badgeSource}>{getCredentialSourceLabel(status.source)}</span>
                      </div>
                    </div>

                    <div className={styles.metaRow}>
                      <span>Stored Value</span>
                      <strong>{status.configured ? "••••••••••••" : "Not saved"}</strong>
                    </div>

                    <div className={styles.metaRow}>
                      <span>Provider Status</span>
                      <strong>{getProviderModelSummary(providers, status.key)}</strong>
                    </div>

                    <p className={styles.helpText}>{getProviderCredentialHelpText(status)}</p>

                    <label>
                      Save to Keychain
                      <input
                        type="password"
                        value={draftValue}
                        placeholder={`Enter ${status.key}`}
                        onChange={(event) => {
                          setCredentialDrafts((current) => ({
                            ...current,
                            [status.key]: event.target.value,
                          }));
                        }}
                        disabled={Boolean(credentialBusyKey)}
                      />
                    </label>

                    <div className={styles.actionRow}>
                      <button
                        disabled={Boolean(credentialBusyKey) || draftValue.trim().length === 0}
                        onClick={async () => {
                          setCredentialBusyKey(status.key);
                          setCredentialError(null);

                          try {
                            await saveProviderCredential(status.key, draftValue);
                            setCredentialDrafts((current) => ({
                              ...current,
                              [status.key]: "",
                            }));
                          } catch (nextError) {
                            setCredentialError(nextError instanceof Error ? nextError.message : `Failed to save ${status.key}`);
                          } finally {
                            setCredentialBusyKey(null);
                          }
                        }}
                      >
                        {isSaving ? "Saving..." : "Save to Keychain"}
                      </button>

                      <button
                        disabled={Boolean(credentialBusyKey) || !canClear}
                        onClick={async () => {
                          setCredentialBusyKey(status.key);
                          setCredentialError(null);

                          try {
                            await clearProviderCredential(status.key);
                          } catch (nextError) {
                            setCredentialError(nextError instanceof Error ? nextError.message : `Failed to clear ${status.key}`);
                          } finally {
                            setCredentialBusyKey(null);
                          }
                        }}
                      >
                        {isClearing && canClear ? "Clearing..." : "Clear Saved Key"}
                      </button>
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {credentialError && <div className={styles.error}>{credentialError}</div>}
        </section>
      </main>
    </WorkspaceShell>
  );
}
