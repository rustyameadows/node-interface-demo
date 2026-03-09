"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Field, Input, Panel, SectionHeader, ToolbarGroup } from "@/components/ui";
import { useRouter } from "@/renderer/navigation";
import {
  clearProviderCredential,
  getProviderCredentials,
  getProjects,
  getProviders,
  refreshProviderAccess,
  saveProviderCredential,
} from "@/components/workspace/client-api";
import type {
  Project,
  ProviderCredentialKey,
  ProviderCredentialStatus,
  ProviderModel,
} from "@/components/workspace/types";
import { formatProviderAccessMessage } from "@/lib/provider-readiness";
import { buildUiDataAttributes } from "@/lib/design-system";
import { queryKeys } from "@/renderer/query";
import { buildAppHomeRoute, buildWorkspaceRoute } from "@/renderer/workspace-route";
import styles from "./settings-view.module.css";

const PROVIDER_LABELS: Record<ProviderCredentialKey, string> = {
  OPENAI_API_KEY: "OpenAI",
  GOOGLE_API_KEY: "Google Gemini",
  TOPAZ_API_KEY: "Topaz",
};

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

function getProviderIdForCredentialKey(key: ProviderCredentialKey) {
  return key === "OPENAI_API_KEY" ? "openai" : key === "GOOGLE_API_KEY" ? "google-gemini" : "topaz";
}

function getProviderModelSummary(models: ProviderModel[], key: ProviderCredentialKey) {
  const providerId = getProviderIdForCredentialKey(key);
  const matchingModels = models.filter((model) => model.providerId === providerId);

  if (matchingModels.length === 0) {
    return "No models registered.";
  }

  if (providerId !== "google-gemini") {
    const runnableCount = matchingModels.filter((model) => model.capabilities.runnable).length;
    return `${runnableCount} of ${matchingModels.length} models runnable`;
  }

  const availableCount = matchingModels.filter((model) => model.capabilities.accessStatus === "available").length;
  const blockedCount = matchingModels.filter((model) => model.capabilities.accessStatus === "blocked").length;
  const limitedCount = matchingModels.filter((model) => model.capabilities.accessStatus === "limited").length;
  const unknownCount = matchingModels.filter((model) => model.capabilities.accessStatus === "unknown").length;

  return [
    `${availableCount} available`,
    blockedCount > 0 ? `${blockedCount} unavailable` : null,
    limitedCount > 0 ? `${limitedCount} temporarily limited` : null,
    unknownCount > 0 ? `${unknownCount} unverified` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

function getProviderStatusDetail(models: ProviderModel[], key: ProviderCredentialKey) {
  if (key !== "GOOGLE_API_KEY") {
    return null;
  }

  const matchingModels = models.filter((model) => model.providerId === "google-gemini");
  if (matchingModels.length === 0) {
    return null;
  }

  const firstWarning = matchingModels.find((model) => model.capabilities.accessStatus !== "available");
  if (!firstWarning) {
    return "Gemini model access is verified for this Google project.";
  }

  return formatProviderAccessMessage(firstWarning.capabilities);
}

function resolveCurrentProject(projects: Project[]) {
  return (
    projects.find((project) => project.workspaceState?.isOpen) ||
    projects.find((project) => project.status === "active") ||
    projects[0] ||
    null
  );
}

export function AppSettingsView() {
  const router = useRouter();
  const [credentialDrafts, setCredentialDrafts] = useState<Record<ProviderCredentialKey, string>>({
    OPENAI_API_KEY: "",
    GOOGLE_API_KEY: "",
    TOPAZ_API_KEY: "",
  });
  const [credentialBusyKey, setCredentialBusyKey] = useState<ProviderCredentialKey | null>(null);
  const [refreshBusyProviderId, setRefreshBusyProviderId] = useState<"google-gemini" | null>(null);
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const { data: projects = [], isLoading: projectsLoading } = useQuery<Project[]>({
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

  const currentProject = useMemo(() => resolveCurrentProject(projects), [projects]);
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

  return (
    <main {...buildUiDataAttributes("app", "comfortable")} className={styles.page}>
      <Panel variant="hero" className={styles.panel}>
        <SectionHeader
          eyebrow="Application"
          title="App Settings"
          description="Provider API keys are app-wide and shared across projects. They resolve from Keychain first, then fall back to environment variables."
        />

        <div className={styles.metaRow}>
          <span>Current Workspace</span>
          <strong>{projectsLoading ? "Loading…" : currentProject ? currentProject.name : "No project open"}</strong>
        </div>

        <ToolbarGroup className={styles.actionRow}>
          <Button
            onClick={() => {
              if (currentProject) {
                router.push(buildWorkspaceRoute(currentProject.id, "canvas"));
                return;
              }

              router.push(buildAppHomeRoute());
            }}
          >
            {currentProject ? "Back to Workspace" : "Back to Home"}
          </Button>

          {currentProject ? (
            <Button
              variant="secondary"
              onClick={() => {
                router.push(buildAppHomeRoute());
              }}
            >
              Home
            </Button>
          ) : null}

          {currentProject ? (
            <Button
              variant="ghost"
              onClick={() => {
                router.push(buildWorkspaceRoute(currentProject.id, "settings"));
              }}
            >
              Project Settings
            </Button>
          ) : null}
        </ToolbarGroup>
      </Panel>

      <Panel variant="panel" className={styles.panel}>
        <SectionHeader
          eyebrow="Providers"
          title="Provider Credentials"
          description="Packaged apps can save provider API keys in the macOS Keychain. Keychain values override environment variables."
        />

        {credentialsLoading ? (
          <div className={styles.loading}>Loading provider credentials...</div>
        ) : (
          <div className={styles.credentialsList}>
            {credentialStatuses.map((status) => {
              const draftValue = credentialDrafts[status.key];
              const isSaving = credentialBusyKey === status.key && draftValue.trim().length > 0;
              const isClearing = credentialBusyKey === status.key && draftValue.trim().length === 0;
              const canClear = status.source === "keychain";
              const providerId = getProviderIdForCredentialKey(status.key);
              const providerStatusDetail = getProviderStatusDetail(providers, status.key);
              const isRefreshing = refreshBusyProviderId === providerId;

              return (
                <section key={status.key} className={styles.credentialCard}>
                  <div className={styles.credentialHeader}>
                    <div>
                      <h2>{PROVIDER_LABELS[status.key]}</h2>
                      <p>{status.key}</p>
                    </div>

                    <div className={styles.badgeRow}>
                      <Badge variant={status.configured ? "success" : "warning"}>
                        {status.configured ? "Configured" : "Missing"}
                      </Badge>
                      <Badge variant="info">{getCredentialSourceLabel(status.source)}</Badge>
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

                  {providerStatusDetail ? <p className={styles.helpText}>{providerStatusDetail}</p> : null}
                  <p className={styles.helpText}>{getProviderCredentialHelpText(status)}</p>

                  <Field label="Save to Keychain" description="Stored Keychain values override matching environment variables.">
                    <Input
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
                  </Field>

                  <ToolbarGroup className={styles.actionRow}>
                    <Button
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
                          setCredentialError(
                            nextError instanceof Error ? nextError.message : `Failed to save ${status.key}`
                          );
                        } finally {
                          setCredentialBusyKey(null);
                        }
                      }}
                    >
                      {isSaving ? "Saving..." : "Save to Keychain"}
                    </Button>

                    <Button
                      variant="secondary"
                      disabled={Boolean(credentialBusyKey) || !canClear}
                      onClick={async () => {
                        setCredentialBusyKey(status.key);
                        setCredentialError(null);

                        try {
                          await clearProviderCredential(status.key);
                        } catch (nextError) {
                          setCredentialError(
                            nextError instanceof Error ? nextError.message : `Failed to clear ${status.key}`
                          );
                        } finally {
                          setCredentialBusyKey(null);
                        }
                      }}
                    >
                      {isClearing && canClear ? "Clearing..." : "Clear Saved Key"}
                    </Button>

                    {providerId === "google-gemini" ? (
                      <Button
                        variant="ghost"
                        disabled={Boolean(credentialBusyKey) || isRefreshing}
                        onClick={async () => {
                          setRefreshBusyProviderId("google-gemini");
                          setCredentialError(null);

                          try {
                            await refreshProviderAccess("google-gemini");
                          } catch (nextError) {
                            setCredentialError(
                              nextError instanceof Error ? nextError.message : "Failed to refresh Gemini access"
                            );
                          } finally {
                            setRefreshBusyProviderId(null);
                          }
                        }}
                      >
                        {isRefreshing ? "Refreshing..." : "Refresh Access"}
                      </Button>
                    ) : null}
                  </ToolbarGroup>
                </section>
              );
            })}
          </div>
        )}

        {credentialError && <div className={styles.error}>{credentialError}</div>}
      </Panel>
    </main>
  );
}
