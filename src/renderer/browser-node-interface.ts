import { defaultCanvasDocument, type Asset, type CanvasDocument, type Job, type Project, type ProviderModel } from "@/components/workspace/types";
import type { AppEventName, AppEventPayload, NodeInterface, WorkspaceSnapshotResponse } from "@/lib/ipc-contract";

const STORAGE_KEY = "node-interface-browser-fallback";

type StoredProject = {
  id: string;
  name: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  isOpen: boolean;
  assetViewerLayout: "grid" | "compare_2" | "compare_4";
  filterState: Record<string, unknown> | null;
  canvasDocument: CanvasDocument;
};

type BrowserStore = {
  projects: StoredProject[];
};

function nowIso() {
  return new Date().toISOString();
}

function newId() {
  return `browser-${Math.random().toString(36).slice(2, 10)}`;
}

function readStore(): BrowserStore {
  if (typeof window === "undefined") {
    return { projects: [] };
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { projects: [] };
  }

  try {
    const parsed = JSON.parse(raw) as BrowserStore;
    return {
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
    };
  } catch {
    return { projects: [] };
  }
}

function writeStore(store: BrowserStore) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function toProject(project: StoredProject): Project {
  return {
    id: project.id,
    name: project.name,
    status: project.status,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    lastOpenedAt: project.lastOpenedAt,
    workspaceState: {
      isOpen: project.isOpen,
      assetViewerLayout: project.assetViewerLayout,
      filterState: project.filterState,
    },
    _count: {
      jobs: 0,
      assets: 0,
    },
  };
}

function broadcast(event: AppEventName, projectId?: string) {
  window.dispatchEvent(
    new CustomEvent<AppEventPayload>("node-interface-browser-event", {
      detail: {
        event,
        projectId,
      },
    })
  );
}

function updateProjectInStore(projectId: string, updater: (project: StoredProject) => StoredProject) {
  const store = readStore();
  store.projects = store.projects.map((project) => (project.id === projectId ? updater(project) : project));
  writeStore(store);
  return store;
}

export function installBrowserNodeInterface() {
  if (window.nodeInterface) {
    return;
  }

  const nodeInterface: NodeInterface = {
    async listProjects() {
      return readStore().projects.map(toProject);
    },
    async createProject(name: string) {
      const timestamp = nowIso();
      const store = readStore();
      const id = newId();
      const shouldOpen = !store.projects.some((project) => project.isOpen);
      const project: StoredProject = {
        id,
        name,
        status: "active",
        createdAt: timestamp,
        updatedAt: timestamp,
        lastOpenedAt: shouldOpen ? timestamp : null,
        isOpen: shouldOpen,
        assetViewerLayout: "grid",
        filterState: null,
        canvasDocument: defaultCanvasDocument,
      };
      store.projects.push(project);
      writeStore(store);
      broadcast("projects.changed", id);
      broadcast("workspace.changed", id);
      return toProject(project);
    },
    async updateProject(projectId, payload) {
      const store = updateProjectInStore(projectId, (project) => ({
        ...project,
        ...(payload.name ? { name: payload.name } : {}),
        ...(payload.status ? { status: payload.status } : {}),
        updatedAt: nowIso(),
      }));
      const updated = store.projects.find((project) => project.id === projectId);
      if (!updated) {
        throw new Error("Project not found");
      }
      broadcast("projects.changed", projectId);
      return toProject(updated);
    },
    async deleteProject(projectId) {
      const store = readStore();
      store.projects = store.projects.filter((project) => project.id !== projectId);
      writeStore(store);
      broadcast("projects.changed", projectId);
      broadcast("workspace.changed", projectId);
    },
    async openProject(projectId) {
      const timestamp = nowIso();
      const store = readStore();
      store.projects = store.projects.map((project) => ({
        ...project,
        isOpen: project.id === projectId,
        lastOpenedAt: project.id === projectId ? timestamp : project.lastOpenedAt,
        updatedAt: project.id === projectId ? timestamp : project.updatedAt,
      }));
      writeStore(store);
      broadcast("projects.changed", projectId);
      broadcast("workspace.changed", projectId);
    },
    async getWorkspaceSnapshot(projectId): Promise<WorkspaceSnapshotResponse> {
      const project = readStore().projects.find((item) => item.id === projectId);
      return {
        canvas: {
          canvasDocument: project?.canvasDocument || defaultCanvasDocument,
        },
        workspace: {
          assetViewerLayout: project?.assetViewerLayout || "grid",
          filterState: project?.filterState || null,
        },
      };
    },
    async saveWorkspaceSnapshot(projectId, payload) {
      updateProjectInStore(projectId, (project) => ({
        ...project,
        canvasDocument: payload.canvasDocument,
        assetViewerLayout: payload.assetViewerLayout || project.assetViewerLayout,
        filterState: payload.filterState || project.filterState,
        updatedAt: nowIso(),
      }));
      broadcast("workspace.changed", projectId);
    },
    async listAssets(): Promise<Asset[]> {
      return [];
    },
    async getAsset() {
      throw new Error("Browser preview mode does not expose asset files.");
    },
    async updateAsset() {
      throw new Error("Browser preview mode does not persist asset curation.");
    },
    async importAssets(): Promise<Asset[]> {
      return [];
    },
    async listJobs(): Promise<Job[]> {
      return [];
    },
    async createJob(): Promise<Job> {
      throw new Error("Browser preview mode does not run jobs. Use Electron for execution.");
    },
    async getJobDebug() {
      throw new Error("Browser preview mode does not expose queue debug details.");
    },
    async listProviders(): Promise<ProviderModel[]> {
      return [];
    },
    subscribe(eventName, listener) {
      const handler = (event: Event) => {
        const payload = (event as CustomEvent<AppEventPayload>).detail;
        if (payload.event === eventName) {
          listener(payload);
        }
      };

      window.addEventListener("node-interface-browser-event", handler as EventListener);
      return () => {
        window.removeEventListener("node-interface-browser-event", handler as EventListener);
      };
    },
  };

  window.nodeInterface = nodeInterface;
}
