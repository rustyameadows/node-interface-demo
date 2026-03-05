"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getProjects } from "@/components/workspace/client-api";
import { ProjectLauncher } from "@/components/workspace/project-launcher";

export function RootRouter() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [hasProjects, setHasProjects] = useState(false);

  useEffect(() => {
    getProjects()
      .then((projects) => {
        const current =
          projects.find((project) => project.workspaceState?.isOpen) ||
          projects.find((project) => project.status === "active") ||
          projects[0] ||
          null;

        if (!current) {
          setHasProjects(false);
          setReady(true);
          return;
        }

        setHasProjects(true);
        router.replace(`/projects/${current.id}/canvas`);
      })
      .catch((error) => {
        console.error(error);
        setHasProjects(false);
        setReady(true);
      });
  }, [router]);

  if (!ready && hasProjects) {
    return null;
  }

  if (!ready) {
    return (
      <main
        style={{
          width: "100vw",
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#b4cbe3",
        }}
      >
        Loading workspace...
      </main>
    );
  }

  return <ProjectLauncher />;
}
