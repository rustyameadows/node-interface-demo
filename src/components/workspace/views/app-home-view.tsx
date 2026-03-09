"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, EmptyState, Field, Input, Panel, SectionHeader, ToolbarGroup } from "@/components/ui";
import {
  createProject,
  getProjects,
  openProject,
} from "@/components/workspace/client-api";
import type { Project } from "@/components/workspace/types";
import { useRouter } from "@/renderer/navigation";
import { queryKeys } from "@/renderer/query";
import {
  buildAppSettingsRoute,
  buildNodeLibraryRoute,
  buildWorkspaceRoute,
} from "@/renderer/workspace-route";
import { buildUiDataAttributes } from "@/lib/design-system";
import styles from "./app-home-view.module.css";

function formatDate(value: string | null) {
  if (!value) {
    return "Never";
  }

  return new Date(value).toLocaleString();
}

function resolveCurrentProject(projects: Project[]) {
  return (
    projects.find((project) => project.workspaceState?.isOpen) ||
    projects.find((project) => project.status === "active") ||
    projects[0] ||
    null
  );
}

type ProjectCardProps = {
  project: Project;
  busy: boolean;
  onOpen: (projectId: string) => Promise<void>;
};

function ProjectCard({ project, busy, onOpen }: ProjectCardProps) {
  const isOpen = Boolean(project.workspaceState?.isOpen);

  return (
    <button
      type="button"
      className={styles.projectCard}
      disabled={busy}
      aria-label={`Open project ${project.name}`}
      onClick={() => {
        void onOpen(project.id);
      }}
    >
      <div className={styles.cardHeader}>
        <div>
          <h3>{project.name}</h3>
          <p>{project.status === "archived" ? "Archived project" : "Local workspace"}</p>
        </div>

        <div className={styles.badgeRow}>
          {isOpen ? (
            <Badge variant="accent" className={styles.badge}>
              Current
            </Badge>
          ) : null}
          <Badge variant={project.status === "archived" ? "warning" : "success"} className={styles.badge}>
            {project.status === "archived" ? "Archived" : "Active"}
          </Badge>
        </div>
      </div>

      <div className={styles.cardMetaGrid}>
        <div className={styles.metaCard}>
          <span>Last Opened</span>
          <strong>{formatDate(project.lastOpenedAt)}</strong>
        </div>
        <div className={styles.metaCard}>
          <span>Assets</span>
          <strong>{project._count.assets}</strong>
        </div>
        <div className={styles.metaCard}>
          <span>Jobs</span>
          <strong>{project._count.jobs}</strong>
        </div>
      </div>
    </button>
  );
}

export function AppHomeView() {
  const router = useRouter();
  const [name, setName] = useState("New Project");
  const [busy, setBusy] = useState(false);
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: queryKeys.projects,
    queryFn: getProjects,
  });

  const currentProject = useMemo(() => resolveCurrentProject(projects), [projects]);
  const activeProjects = useMemo(
    () => projects.filter((project) => project.status === "active"),
    [projects]
  );
  const archivedProjects = useMemo(
    () => projects.filter((project) => project.status === "archived"),
    [projects]
  );

  const handleCreateProject = async () => {
    setBusy(true);
    setError(null);

    try {
      const project = await createProject(name.trim());
      await openProject(project.id);
      router.replace(buildWorkspaceRoute(project.id, "canvas"));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not create project");
      setBusy(false);
    }
  };

  const handleOpenProject = async (projectId: string) => {
    setBusyProjectId(projectId);
    setError(null);

    try {
      await openProject(projectId);
      router.push(buildWorkspaceRoute(projectId, "canvas"));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not open project");
      setBusyProjectId(null);
    }
  };

  return (
    <main {...buildUiDataAttributes("app", "comfortable")} className={styles.page}>
      <Panel variant="hero" className={styles.heroPanel}>
        <div className={styles.heroCopy}>
          <div className={styles.kicker}>Nodes Nodes Nodes</div>
          <h1>App Home</h1>
          <p>
            Build media workflows from a local-first canvas, keep projects tidy, and move between setup, library, and production views without losing context.
          </p>

          <ToolbarGroup className={styles.heroActions}>
            <Button
              onClick={() => {
                void handleCreateProject();
              }}
              disabled={busy || Boolean(busyProjectId) || !name.trim()}
            >
              {busy ? "Creating..." : "Create and Open"}
            </Button>
            <Button
              variant="secondary"
              disabled={busy || Boolean(busyProjectId)}
              onClick={() => {
                router.push(buildNodeLibraryRoute());
              }}
            >
              Explore Nodes
            </Button>
            <Button
              variant="ghost"
              disabled={busy || Boolean(busyProjectId)}
              onClick={() => {
                router.push(buildAppSettingsRoute());
              }}
            >
              Configure App
            </Button>
          </ToolbarGroup>
        </div>

        <div className={styles.heroMetaGrid}>
          <Panel variant="subtle" className={styles.heroMetaCard}>
            <span>Current Project</span>
            <strong>{currentProject ? currentProject.name : "No project open"}</strong>
          </Panel>
          <Panel variant="subtle" className={styles.heroMetaCard}>
            <span>Total Projects</span>
            <strong>{isLoading ? "…" : projects.length}</strong>
          </Panel>
          <Panel variant="subtle" className={styles.heroMetaCard}>
            <span>Active Workspaces</span>
            <strong>{isLoading ? "…" : activeProjects.length}</strong>
          </Panel>
          <Panel variant="subtle" className={styles.heroMetaCard}>
            <span>Archived Projects</span>
            <strong>{isLoading ? "…" : archivedProjects.length}</strong>
          </Panel>
        </div>
      </Panel>

      <Panel variant="raised" className={styles.createPanel}>
        <SectionHeader
          eyebrow="Kickoff"
          title="Create Project"
          description="Start a new local workspace and land on canvas immediately."
        />

        <Field
          className={styles.field}
          label="Project Name"
          description="Use a short workspace name. You can rename it later in Project Settings."
        >
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Project name"
            disabled={busy || Boolean(busyProjectId)}
          />
        </Field>

        <ToolbarGroup className={styles.actionRow}>
          <Button
            disabled={busy || Boolean(busyProjectId) || !name.trim()}
            onClick={() => {
              void handleCreateProject();
            }}
          >
            {busy ? "Creating..." : "Create Project"}
          </Button>

          <Button
            variant="secondary"
            disabled={busy || Boolean(busyProjectId)}
            onClick={() => {
              router.push(buildNodeLibraryRoute());
            }}
          >
            Node Library
          </Button>

          <Button
            variant="ghost"
            disabled={busy || Boolean(busyProjectId)}
            onClick={() => {
              router.push(buildAppSettingsRoute());
            }}
          >
            App Settings
          </Button>
        </ToolbarGroup>

        {error ? <div className={styles.error}>{error}</div> : null}
      </Panel>

      <Panel variant="panel" className={styles.projectsPanel}>
        <SectionHeader
          eyebrow="Workspace"
          title="Active Projects"
          description="Open any active workspace and continue on its canvas."
        />

        {isLoading ? (
          <div className={styles.loading}>Loading projects...</div>
        ) : activeProjects.length === 0 ? (
          <EmptyState
            title="No active projects yet"
            description="Create a project above to open your first canvas."
          />
        ) : (
          <div className={styles.projectGrid}>
            {activeProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                busy={busy || busyProjectId !== null}
                onOpen={handleOpenProject}
              />
            ))}
          </div>
        )}
      </Panel>

      {archivedProjects.length > 0 ? (
        <Panel variant="panel" className={styles.projectsPanel}>
          <SectionHeader
            eyebrow="Archive"
            title="Archived Projects"
            description="Archived work stays separate but can still be reopened from home."
          />

          <div className={styles.projectGrid}>
            {archivedProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                busy={busy || busyProjectId !== null}
                onOpen={handleOpenProject}
              />
            ))}
          </div>
        </Panel>
      ) : null}
    </main>
  );
}
