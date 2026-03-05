"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { InfiniteCanvas } from "@/components/infinite-canvas";
import styles from "./studio-app.module.css";

type ProviderModel = {
  providerId: "openai" | "google-gemini" | "topaz";
  modelId: string;
  displayName: string;
  capabilities: Record<string, unknown>;
};

type Project = {
  id: string;
  name: string;
  status: "active" | "archived";
  lastOpenedAt: string | null;
  workspaceState: {
    isOpen: boolean;
    assetViewerLayout: "grid" | "compare_2" | "compare_4";
    filterState?: Record<string, unknown> | null;
  } | null;
  _count: {
    jobs: number;
    assets: number;
  };
};

type WorkflowNode = {
  id: string;
  label: string;
  providerId: "openai" | "google-gemini" | "topaz";
  modelId: string;
  nodeType: "text-gen" | "image-gen" | "video-gen" | "transform";
  outputType: "text" | "image" | "video";
  prompt: string;
  settings: Record<string, unknown>;
  upstreamAssetIds: string[];
  x: number;
  y: number;
};

type CanvasDocument = {
  canvasViewport: {
    x: number;
    y: number;
    zoom: number;
  };
  workflow: {
    nodes: WorkflowNode[];
  };
};

type Job = {
  id: string;
  state: "queued" | "running" | "succeeded" | "failed" | "canceled";
  providerId: string;
  modelId: string;
  createdAt: string;
  errorMessage: string | null;
  nodeRunPayload?: {
    nodeId?: string;
  };
};

type Asset = {
  id: string;
  type: "image" | "video" | "text";
  storageRef: string;
  mimeType: string;
  createdAt: string;
  tagNames: string[];
  rating: number | null;
  flagged: boolean;
  job: {
    providerId: string;
    modelId: string;
    state: string;
  } | null;
};

type AssetFilterState = {
  type: "all" | "image" | "video" | "text";
  ratingAtLeast: number;
  flaggedOnly: boolean;
  tag: string;
  providerId: "all" | "openai" | "google-gemini" | "topaz";
  sort: "newest" | "oldest" | "rating";
};

const defaultCanvasDocument: CanvasDocument = {
  canvasViewport: {
    x: 240,
    y: 180,
    zoom: 1,
  },
  workflow: {
    nodes: [],
  },
};

const defaultFilterState: AssetFilterState = {
  type: "all",
  ratingAtLeast: 0,
  flaggedOnly: false,
  tag: "",
  providerId: "all",
  sort: "newest",
};

const defaultNodeModalPosition = {
  x: 24,
  y: 110,
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function mergeFilters(input: Record<string, unknown> | null | undefined): AssetFilterState {
  return {
    ...defaultFilterState,
    ...(input || {}),
  } as AssetFilterState;
}

function normalizeNode(raw: Record<string, unknown>, index: number): WorkflowNode {
  return {
    id: String(raw.id || uid()),
    label: String(raw.label || `Node ${index + 1}`),
    providerId: (raw.providerId as WorkflowNode["providerId"]) || "google-gemini",
    modelId: String(raw.modelId || "gemini-3.1-flash"),
    nodeType: (raw.nodeType as WorkflowNode["nodeType"]) || "image-gen",
    outputType: (raw.outputType as WorkflowNode["outputType"]) || "image",
    prompt: String(raw.prompt || ""),
    settings: (raw.settings as Record<string, unknown>) || {},
    upstreamAssetIds: Array.isArray(raw.upstreamAssetIds)
      ? raw.upstreamAssetIds.map((item) => String(item))
      : [],
    x: typeof raw.x === "number" ? raw.x : 120 + (index % 4) * 260,
    y: typeof raw.y === "number" ? raw.y : 120 + Math.floor(index / 4) * 160,
  };
}

export function StudioApp() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [providers, setProviders] = useState<ProviderModel[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [canvasDoc, setCanvasDoc] = useState<CanvasDocument>(defaultCanvasDocument);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [layoutMode, setLayoutMode] = useState<"grid" | "compare_2" | "compare_4">("grid");
  const [filters, setFilters] = useState<AssetFilterState>(defaultFilterState);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("New Project");
  const [isLoading, setIsLoading] = useState(false);
  const [assetDockOpen, setAssetDockOpen] = useState(true);
  const [modalPosition, setModalPosition] = useState(defaultNodeModalPosition);

  const saveTimer = useRef<NodeJS.Timeout | null>(null);
  const filtersRef = useRef<AssetFilterState>(defaultFilterState);
  const nodeModalRef = useRef<HTMLElement | null>(null);

  const modalDragStateRef = useRef<{
    active: boolean;
    startMouseX: number;
    startMouseY: number;
    startX: number;
    startY: number;
  }>({
    active: false,
    startMouseX: 0,
    startMouseY: 0,
    startX: 0,
    startY: 0,
  });

  const groupedProviders = useMemo(() => {
    return providers.reduce<Record<string, ProviderModel[]>>((acc, model) => {
      acc[model.providerId] = acc[model.providerId] || [];
      acc[model.providerId].push(model);
      return acc;
    }, {});
  }, [providers]);

  const activeProjects = useMemo(() => projects.filter((project) => project.status === "active"), [projects]);
  const archivedProjects = useMemo(
    () => projects.filter((project) => project.status === "archived"),
    [projects]
  );

  const selectedNode = useMemo(
    () => canvasDoc.workflow.nodes.find((node) => node.id === selectedNodeId) || null,
    [canvasDoc.workflow.nodes, selectedNodeId]
  );

  const latestNodeStates = useMemo(() => {
    const map: Record<string, string> = {};
    for (const job of jobs) {
      const nodeId = job.nodeRunPayload?.nodeId;
      if (!nodeId || map[nodeId]) {
        continue;
      }
      map[nodeId] = job.state;
    }
    return map;
  }, [jobs]);

  const activeAssets = useMemo(() => {
    return assets.filter((asset) => selectedAssetIds.includes(asset.id));
  }, [assets, selectedAssetIds]);

  const fetchProjects = useCallback(async () => {
    const res = await fetch("/api/projects", { cache: "no-store" });
    const data = await res.json();
    const list = (data.projects || []) as Project[];
    setProjects(list);

    const currentlyOpen = list.find((project) => project.workspaceState?.isOpen) || null;
    setActiveProjectId((prev) => prev || currentlyOpen?.id || list[0]?.id || null);
  }, []);

  const fetchProviders = useCallback(async () => {
    const res = await fetch("/api/providers", { cache: "no-store" });
    const data = await res.json();
    setProviders((data.providers || []) as ProviderModel[]);
  }, []);

  const fetchCanvas = useCallback(async (projectId: string) => {
    const res = await fetch(`/api/projects/${projectId}/canvas`, { cache: "no-store" });
    const data = await res.json();

    const raw = (data.canvas?.canvasDocument || {}) as Record<string, unknown>;
    const viewportRaw = (raw.canvasViewport as Record<string, unknown> | undefined) || {};
    const nodesRaw = Array.isArray((raw.workflow as Record<string, unknown> | undefined)?.nodes)
      ? (((raw.workflow as Record<string, unknown>).nodes as unknown[]) || [])
      : [];

    const nodes = nodesRaw
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((node, index) => normalizeNode(node, index));

    setCanvasDoc({
      canvasViewport: {
        x: typeof viewportRaw.x === "number" ? viewportRaw.x : defaultCanvasDocument.canvasViewport.x,
        y: typeof viewportRaw.y === "number" ? viewportRaw.y : defaultCanvasDocument.canvasViewport.y,
        zoom:
          typeof viewportRaw.zoom === "number"
            ? viewportRaw.zoom
            : defaultCanvasDocument.canvasViewport.zoom,
      },
      workflow: {
        nodes,
      },
    });

    setSelectedNodeId((current) => (current && nodes.some((node) => node.id === current) ? current : null));

    const workspace = data.workspace;
    setLayoutMode(workspace?.assetViewerLayout || "grid");
    setFilters(mergeFilters(workspace?.filterState));
  }, []);

  const fetchJobs = useCallback(async (projectId: string) => {
    const res = await fetch(`/api/projects/${projectId}/jobs`, { cache: "no-store" });
    const data = await res.json();
    setJobs((data.jobs || []) as Job[]);
  }, []);

  const fetchAssets = useCallback(async (projectId: string, nextFilters: AssetFilterState) => {
    const query = new URLSearchParams({
      type: nextFilters.type,
      ratingAtLeast: String(nextFilters.ratingAtLeast),
      flaggedOnly: String(nextFilters.flaggedOnly),
      tag: nextFilters.tag,
      providerId: nextFilters.providerId,
      sort: nextFilters.sort,
    });

    const res = await fetch(`/api/projects/${projectId}/assets?${query.toString()}`, {
      cache: "no-store",
    });

    const data = await res.json();
    setAssets((data.assets || []) as Asset[]);
  }, []);

  const persistWorkspace = useCallback(
    async (doc: CanvasDocument, nextLayout = layoutMode, nextFilters = filters) => {
      if (!activeProjectId) {
        return;
      }

      await fetch(`/api/projects/${activeProjectId}/canvas`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canvasDocument: doc,
          assetViewerLayout: nextLayout,
          filterState: nextFilters,
        }),
      });
    },
    [activeProjectId, layoutMode, filters]
  );

  const queueCanvasSave = useCallback(
    (doc: CanvasDocument) => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }

      saveTimer.current = setTimeout(() => {
        persistWorkspace(doc).catch((error) => {
          console.error("Failed to persist canvas", error);
        });
      }, 420);
    },
    [persistWorkspace]
  );

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    fetchProjects().catch(console.error);
    fetchProviders().catch(console.error);
  }, [fetchProjects, fetchProviders]);

  useEffect(() => {
    if (!activeProjectId) {
      return;
    }

    setIsLoading(true);

    Promise.all([
      fetchCanvas(activeProjectId),
      fetchJobs(activeProjectId),
      fetchAssets(activeProjectId, filtersRef.current),
    ])
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [activeProjectId, fetchCanvas, fetchJobs, fetchAssets]);

  useEffect(() => {
    if (!activeProjectId) {
      return;
    }

    const interval = setInterval(() => {
      fetchJobs(activeProjectId)
        .then(() => fetchAssets(activeProjectId, filtersRef.current))
        .catch(console.error);
    }, 2500);

    return () => clearInterval(interval);
  }, [activeProjectId, fetchJobs, fetchAssets]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (!modalDragStateRef.current.active) {
        return;
      }

      const modalRect = nodeModalRef.current?.getBoundingClientRect();
      const modalWidth = modalRect?.width || 420;
      const modalHeight = modalRect?.height || 520;
      const maxX = Math.max(10, window.innerWidth - modalWidth - 10);
      const maxY = Math.max(10, window.innerHeight - modalHeight - 10);

      setModalPosition({
        x: Math.min(
          maxX,
          Math.max(10, modalDragStateRef.current.startX + (event.clientX - modalDragStateRef.current.startMouseX))
        ),
        y: Math.min(
          maxY,
          Math.max(10, modalDragStateRef.current.startY + (event.clientY - modalDragStateRef.current.startMouseY))
        ),
      });
    };

    const onPointerUp = () => {
      modalDragStateRef.current.active = false;
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  const openProject = useCallback(
    async (projectId: string) => {
      await fetch(`/api/projects/${projectId}/open`, { method: "POST" });
      setActiveProjectId(projectId);
      setSelectedNodeId(null);
      await fetchProjects();
    },
    [fetchProjects]
  );

  const createProject = useCallback(async () => {
    const name = newProjectName.trim();
    if (!name) {
      return;
    }

    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    if (!res.ok) {
      return;
    }

    setNewProjectName(`Project ${projects.length + 1}`);
    await fetchProjects();
  }, [fetchProjects, newProjectName, projects.length]);

  const renameProject = useCallback(async (projectId: string) => {
    const next = prompt("Project name");
    if (!next?.trim()) {
      return;
    }

    await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: next.trim() }),
    });

    await fetchProjects();
  }, [fetchProjects]);

  const toggleArchive = useCallback(async (project: Project) => {
    await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: project.status === "active" ? "archived" : "active" }),
    });

    await fetchProjects();
  }, [fetchProjects]);

  const deleteProject = useCallback(async (project: Project) => {
    if (!confirm(`Delete project '${project.name}' and all assets/jobs?`)) {
      return;
    }

    await fetch(`/api/projects/${project.id}`, { method: "DELETE" });

    if (activeProjectId === project.id) {
      setActiveProjectId(null);
      setSelectedNodeId(null);
    }

    await fetchProjects();
  }, [activeProjectId, fetchProjects]);

  const addNode = useCallback((position?: { x: number; y: number }) => {
    const defaultProvider = providers[0];
    if (!defaultProvider) {
      return;
    }

    setCanvasDoc((prev) => {
      const node: WorkflowNode = {
        id: uid(),
        label: `Node ${prev.workflow.nodes.length + 1}`,
        providerId: defaultProvider.providerId,
        modelId: defaultProvider.modelId,
        nodeType: "image-gen",
        outputType: "image",
        prompt: "",
        settings: {},
        upstreamAssetIds: [],
        x: Math.round(position?.x ?? (120 + (prev.workflow.nodes.length % 4) * 260)),
        y: Math.round(position?.y ?? (120 + Math.floor(prev.workflow.nodes.length / 4) * 160)),
      };

      const nextDoc: CanvasDocument = {
        ...prev,
        workflow: {
          nodes: [...prev.workflow.nodes, node],
        },
      };

      queueCanvasSave(nextDoc);
      setSelectedNodeId(node.id);
      return nextDoc;
    });
  }, [providers, queueCanvasSave]);

  const updateNode = useCallback((nodeId: string, patch: Partial<WorkflowNode>) => {
    setCanvasDoc((prev) => {
      const nextDoc: CanvasDocument = {
        ...prev,
        workflow: {
          nodes: prev.workflow.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)),
        },
      };

      queueCanvasSave(nextDoc);
      return nextDoc;
    });
  }, [queueCanvasSave]);

  const removeNode = useCallback((nodeId: string) => {
    setCanvasDoc((prev) => {
      const nextDoc: CanvasDocument = {
        ...prev,
        workflow: {
          nodes: prev.workflow.nodes.filter((node) => node.id !== nodeId),
        },
      };

      queueCanvasSave(nextDoc);
      return nextDoc;
    });

    setSelectedNodeId((current) => (current === nodeId ? null : current));
  }, [queueCanvasSave]);

  const updateViewport = useCallback((nextViewport: CanvasDocument["canvasViewport"]) => {
    setCanvasDoc((prev) => {
      const nextDoc: CanvasDocument = {
        ...prev,
        canvasViewport: nextViewport,
      };
      queueCanvasSave(nextDoc);
      return nextDoc;
    });
  }, [queueCanvasSave]);

  const runNode = useCallback(async (node: WorkflowNode) => {
    if (!activeProjectId) {
      return;
    }

    await fetch(`/api/projects/${activeProjectId}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: node.providerId,
        modelId: node.modelId,
        nodePayload: {
          nodeId: node.id,
          nodeType: node.nodeType,
          prompt: node.prompt,
          settings: node.settings,
          outputType: node.outputType,
          upstreamAssetIds: node.upstreamAssetIds,
        },
      }),
    });

    await fetchJobs(activeProjectId);
    await fetchAssets(activeProjectId, filtersRef.current);
    await fetchProjects();
  }, [activeProjectId, fetchAssets, fetchJobs, fetchProjects]);

  const runAllNodes = useCallback(async () => {
    for (const node of canvasDoc.workflow.nodes) {
      await runNode(node);
    }
  }, [canvasDoc.workflow.nodes, runNode]);

  const updateAsset = useCallback(async (assetId: string, payload: { rating?: number | null; flagged?: boolean; tags?: string[] }) => {
    await fetch(`/api/assets/${assetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (activeProjectId) {
      await fetchAssets(activeProjectId, filtersRef.current);
      await fetchProjects();
    }
  }, [activeProjectId, fetchAssets, fetchProjects]);

  const onFilterChange = useCallback((patch: Partial<AssetFilterState>) => {
    const next = { ...filtersRef.current, ...patch };
    setFilters(next);

    if (activeProjectId) {
      fetchAssets(activeProjectId, next).catch(console.error);
      persistWorkspace(canvasDoc, layoutMode, next).catch(console.error);
    }
  }, [activeProjectId, fetchAssets, persistWorkspace, canvasDoc, layoutMode]);

  const changeLayoutMode = useCallback((layout: "grid" | "compare_2" | "compare_4") => {
    setLayoutMode(layout);
    setSelectedAssetIds([]);
    persistWorkspace(canvasDoc, layout, filtersRef.current).catch(console.error);
  }, [canvasDoc, persistWorkspace]);

  const startDraggingModal = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    modalDragStateRef.current = {
      active: true,
      startMouseX: event.clientX,
      startMouseY: event.clientY,
      startX: modalPosition.x,
      startY: modalPosition.y,
    };
  }, [modalPosition.x, modalPosition.y]);

  return (
    <div className={styles.page}>
      <div className={styles.canvasViewport}>
        {activeProjectId ? (
          <InfiniteCanvas
            nodes={canvasDoc.workflow.nodes}
            selectedNodeId={selectedNodeId}
            viewport={canvasDoc.canvasViewport}
            onSelectNode={setSelectedNodeId}
            onDropNode={(position) => addNode(position)}
            onViewportChange={updateViewport}
            onNodePositionChange={(nodeId, position) => updateNode(nodeId, position)}
            latestNodeStates={latestNodeStates}
          />
        ) : (
          <div className={styles.emptyState}>Create or open a project to start building your canvas.</div>
        )}
      </div>

      <nav className={styles.projectNav}>
        <details open>
          <summary>Projects</summary>

          <div className={styles.newProjectRow}>
            <input
              value={newProjectName}
              onChange={(event) => setNewProjectName(event.target.value)}
              placeholder="Project name"
            />
            <button onClick={createProject}>Create</button>
          </div>

          <ul className={styles.navTree}>
            <li>
              <span className={styles.navSectionLabel}>Active</span>
              <ul>
                {activeProjects.map((project) => {
                  const isActive = project.id === activeProjectId;
                  return (
                    <li key={project.id}>
                      <button
                        className={`${styles.projectLink} ${isActive ? styles.projectLinkActive : ""}`}
                        onClick={() => openProject(project.id)}
                      >
                        {project.name}
                      </button>
                      <div className={styles.projectActionsInline}>
                        <button onClick={() => renameProject(project.id)}>Rename</button>
                        <button onClick={() => toggleArchive(project)}>Archive</button>
                        <button onClick={() => deleteProject(project)}>Delete</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </li>

            <li>
              <span className={styles.navSectionLabel}>Archived</span>
              <ul>
                {archivedProjects.map((project) => (
                  <li key={project.id}>
                    <button className={styles.projectLink} onClick={() => openProject(project.id)}>
                      {project.name}
                    </button>
                    <div className={styles.projectActionsInline}>
                      <button onClick={() => toggleArchive(project)}>Unarchive</button>
                      <button onClick={() => deleteProject(project)}>Delete</button>
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          </ul>
        </details>
      </nav>

      <div className={styles.topActions}>
        <button onClick={() => addNode()} disabled={!activeProjectId}>Add Node</button>
        <button onClick={runAllNodes} disabled={!activeProjectId || canvasDoc.workflow.nodes.length === 0}>
          Run All
        </button>
        <button onClick={() => setAssetDockOpen((open) => !open)}>{assetDockOpen ? "Hide Assets" : "Show Assets"}</button>
      </div>

      {selectedNode && (
        <section
          ref={(node) => {
            nodeModalRef.current = node;
          }}
          className={styles.nodeModal}
          style={{ left: modalPosition.x, top: modalPosition.y }}
        >
          <header className={styles.nodeModalHeader} onPointerDown={startDraggingModal}>
            <strong>Node Settings</strong>
            <span>Drag me</span>
          </header>

          <div className={styles.nodeModalBody}>
            <input
              className={styles.nodeInput}
              value={selectedNode.label}
              onChange={(event) => updateNode(selectedNode.id, { label: event.target.value })}
            />

            <div className={styles.nodeGrid}>
              <label>
                Provider
                <select
                  value={selectedNode.providerId}
                  onChange={(event) => {
                    const providerId = event.target.value as WorkflowNode["providerId"];
                    const model = (groupedProviders[providerId] || [])[0];
                    updateNode(selectedNode.id, {
                      providerId,
                      modelId: model?.modelId || "",
                    });
                  }}
                >
                  {Object.keys(groupedProviders).map((providerId) => (
                    <option key={providerId} value={providerId}>
                      {providerId}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Model
                <select
                  value={selectedNode.modelId}
                  onChange={(event) => updateNode(selectedNode.id, { modelId: event.target.value })}
                >
                  {(groupedProviders[selectedNode.providerId] || []).map((model) => (
                    <option key={model.modelId} value={model.modelId}>
                      {model.displayName}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Node Type
                <select
                  value={selectedNode.nodeType}
                  onChange={(event) =>
                    updateNode(selectedNode.id, {
                      nodeType: event.target.value as WorkflowNode["nodeType"],
                    })
                  }
                >
                  <option value="text-gen">text-gen</option>
                  <option value="image-gen">image-gen</option>
                  <option value="video-gen">video-gen</option>
                  <option value="transform">transform</option>
                </select>
              </label>

              <label>
                Output
                <select
                  value={selectedNode.outputType}
                  onChange={(event) =>
                    updateNode(selectedNode.id, {
                      outputType: event.target.value as WorkflowNode["outputType"],
                    })
                  }
                >
                  <option value="image">image</option>
                  <option value="video">video</option>
                  <option value="text">text</option>
                </select>
              </label>
            </div>

            <label>
              Prompt
              <textarea
                className={styles.nodePrompt}
                value={selectedNode.prompt}
                onChange={(event) => updateNode(selectedNode.id, { prompt: event.target.value })}
                placeholder="Describe what this node should generate"
              />
            </label>

            <label>
              Upstream Asset IDs (comma separated)
              <input
                className={styles.nodeInput}
                value={selectedNode.upstreamAssetIds.join(",")}
                onChange={(event) =>
                  updateNode(selectedNode.id, {
                    upstreamAssetIds: event.target.value
                      .split(",")
                      .map((value) => value.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>

            <div className={styles.nodeModalActions}>
              <button onClick={() => runNode(selectedNode)}>Run Node</button>
              <button onClick={() => removeNode(selectedNode.id)}>Delete Node</button>
              <button onClick={() => setSelectedNodeId(null)}>Close</button>
            </div>
          </div>
        </section>
      )}

      <aside className={styles.jobsOverlay}>
        <h3>Jobs</h3>
        <div className={styles.jobsList}>
          {jobs.slice(0, 8).map((job) => (
            <div key={job.id} className={styles.jobRow}>
              <span>{job.providerId}</span>
              <strong>{job.state}</strong>
            </div>
          ))}
        </div>
      </aside>

      {assetDockOpen && (
        <section className={styles.assetDock}>
          <header className={styles.assetHeader}>
            <div className={styles.modeButtons}>
              <button onClick={() => changeLayoutMode("grid")}>Grid</button>
              <button onClick={() => changeLayoutMode("compare_2")}>2-up</button>
              <button onClick={() => changeLayoutMode("compare_4")}>4-up</button>
            </div>

            <div className={styles.filters}>
              <select
                value={filters.type}
                onChange={(event) =>
                  onFilterChange({
                    type: event.target.value as AssetFilterState["type"],
                  })
                }
              >
                <option value="all">all types</option>
                <option value="image">image</option>
                <option value="video">video</option>
                <option value="text">text</option>
              </select>

              <select
                value={filters.ratingAtLeast}
                onChange={(event) => onFilterChange({ ratingAtLeast: Number(event.target.value) })}
              >
                <option value={0}>any rating</option>
                <option value={1}>1+ stars</option>
                <option value={2}>2+ stars</option>
                <option value={3}>3+ stars</option>
                <option value={4}>4+ stars</option>
                <option value={5}>5 stars</option>
              </select>

              <select
                value={filters.providerId}
                onChange={(event) =>
                  onFilterChange({ providerId: event.target.value as AssetFilterState["providerId"] })
                }
              >
                <option value="all">all providers</option>
                <option value="openai">openai</option>
                <option value="google-gemini">google-gemini</option>
                <option value="topaz">topaz</option>
              </select>

              <select
                value={filters.sort}
                onChange={(event) => onFilterChange({ sort: event.target.value as AssetFilterState["sort"] })}
              >
                <option value="newest">newest</option>
                <option value="oldest">oldest</option>
                <option value="rating">rating</option>
              </select>

              <label className={styles.flaggedOnlyToggle}>
                <input
                  type="checkbox"
                  checked={filters.flaggedOnly}
                  onChange={(event) => onFilterChange({ flaggedOnly: event.target.checked })}
                />
                flagged
              </label>

              <input
                value={filters.tag}
                onChange={(event) => onFilterChange({ tag: event.target.value })}
                placeholder="tag filter"
              />
            </div>
          </header>

          {layoutMode === "grid" ? (
            <div className={styles.assetGrid}>
              {assets.map((asset) => (
                <article
                  key={asset.id}
                  className={`${styles.assetCard} ${selectedAssetIds.includes(asset.id) ? styles.assetSelected : ""}`}
                  onClick={() => {
                    setSelectedAssetIds((prev) =>
                      prev.includes(asset.id) ? prev.filter((id) => id !== asset.id) : [...prev, asset.id].slice(-4)
                    );
                  }}
                >
                  <AssetPreview asset={asset} />

                  <div className={styles.assetMeta}>
                    <strong>{asset.type}</strong>
                    <span>{asset.job?.providerId || "local"}</span>
                  </div>

                  <div className={styles.ratingRow}>
                    {[1, 2, 3, 4, 5].map((score) => (
                      <button
                        key={score}
                        className={asset.rating && asset.rating >= score ? styles.starOn : styles.starOff}
                        onClick={(event) => {
                          event.stopPropagation();
                          updateAsset(asset.id, { rating: score });
                        }}
                      >
                        ★
                      </button>
                    ))}
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        updateAsset(asset.id, { flagged: !asset.flagged });
                      }}
                    >
                      {asset.flagged ? "Unflag" : "Flag"}
                    </button>
                  </div>

                  <TagEditor asset={asset} onSave={(tags) => updateAsset(asset.id, { tags })} />
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.compareMode}>
              <p>
                {layoutMode === "compare_2"
                  ? "Select exactly 2 assets in grid to compare."
                  : "Select exactly 4 assets in grid to compare."}
              </p>

              <div className={layoutMode === "compare_2" ? styles.compareTwo : styles.compareFour}>
                {activeAssets.map((asset) => (
                  <div key={asset.id} className={styles.compareCard}>
                    <AssetPreview asset={asset} />
                    <div className={styles.assetMeta}>
                      <strong>{asset.type}</strong>
                      <span>{asset.job?.providerId || "local"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {isLoading && <div className={styles.loadingOverlay}>Loading workspace...</div>}
    </div>
  );
}

type AssetPreviewProps = {
  asset: Asset;
};

function AssetPreview({ asset }: AssetPreviewProps) {
  if (asset.type === "image") {
    return (
      <img
        className={styles.assetPreviewImage}
        src={`/api/assets/${asset.id}/file`}
        alt={`Generated asset ${asset.id}`}
      />
    );
  }

  if (asset.type === "text") {
    return (
      <iframe
        className={styles.assetPreviewFrame}
        src={`/api/assets/${asset.id}/file`}
        title={`Asset ${asset.id}`}
      />
    );
  }

  return (
    <div className={styles.videoPlaceholder}>
      <p>Video Output (stub)</p>
      <a href={`/api/assets/${asset.id}/file`} target="_blank" rel="noreferrer">
        Open metadata
      </a>
    </div>
  );
}

type TagEditorProps = {
  asset: Asset;
  onSave: (tags: string[]) => void;
};

function TagEditor({ asset, onSave }: TagEditorProps) {
  const [value, setValue] = useState(asset.tagNames.join(", "));

  useEffect(() => {
    setValue(asset.tagNames.join(", "));
  }, [asset.tagNames]);

  return (
    <div className={styles.tagEditor}>
      <input value={value} onChange={(event) => setValue(event.target.value)} placeholder="tags" />
      <button
        onClick={(event) => {
          event.stopPropagation();
          const tags = value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
          onSave(tags);
        }}
      >
        Save
      </button>
    </div>
  );
}
