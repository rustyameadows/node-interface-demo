"use client";

import { useState } from "react";
import { useRouter } from "@/renderer/navigation";
import { buildAppSettingsRoute } from "@/renderer/workspace-route";
import styles from "./project-launcher.module.css";
import { createProject, openProject } from "@/components/workspace/client-api";

export function ProjectLauncher() {
  const router = useRouter();
  const [name, setName] = useState("New Project");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <h1>Start a Project</h1>
        <p>Create your first local workspace and jump into canvas immediately.</p>

        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Project name"
          disabled={busy}
        />

        <div className={styles.actionRow}>
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={async () => {
              setBusy(true);
              setError(null);

              try {
                const project = await createProject(name.trim());
                await openProject(project.id);
                router.replace(`/projects/${project.id}/canvas`);
              } catch (nextError) {
                setError(nextError instanceof Error ? nextError.message : "Could not create project");
                setBusy(false);
              }
            }}
          >
            {busy ? "Creating..." : "Create Project"}
          </button>

          <button
            type="button"
            className={styles.secondaryButton}
            disabled={busy}
            onClick={() => {
              router.push(buildAppSettingsRoute());
            }}
          >
            App Settings
          </button>
        </div>

        {error && <div className={styles.error}>{error}</div>}
      </section>
    </main>
  );
}
