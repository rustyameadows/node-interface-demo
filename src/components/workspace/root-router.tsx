"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@/renderer/navigation";
import { getProjects } from "@/components/workspace/client-api";
import { ProjectLauncher } from "@/components/workspace/project-launcher";
import { queryKeys } from "@/renderer/query";

export function RootRouter() {
  const router = useRouter();
  const { data: projects = [], isLoading } = useQuery({
    queryKey: queryKeys.projects,
    queryFn: getProjects,
  });

  useEffect(() => {
    if (isLoading) {
      return;
    }

    const current =
      projects.find((project) => project.workspaceState?.isOpen) ||
      projects.find((project) => project.status === "active") ||
      projects[0] ||
      null;

    if (current) {
      router.replace(`/projects/${current.id}/canvas`);
    }
  }, [isLoading, projects, router]);

  if (isLoading) {
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

  if (projects.length > 0) {
    return null;
  }

  return <ProjectLauncher />;
}
