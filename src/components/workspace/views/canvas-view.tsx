"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent as ReactChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { InfiniteCanvas } from "@/components/infinite-canvas";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import {
  createJob,
  getCanvasWorkspace,
  getJobs,
  getProviders,
  normalizeNode,
  openProject,
  putCanvasWorkspace,
  uid,
  uploadProjectAsset,
} from "@/components/workspace/client-api";
import {
  defaultCanvasDocument,
  type Asset,
  type CanvasDocument,
  type Job,
  type ProviderModel,
  type WorkflowNode,
} from "@/components/workspace/types";
import styles from "./canvas-view.module.css";

const defaultNodeModalPosition = {
  x: 24,
  y: 92,
};

const supportedOutputOrder = ["image", "video", "text"] as const;

type Props = {
  projectId: string;
};

function capabilityEnabled(value: unknown) {
  return value === true || value === "true" || value === 1;
}

function getModelSupportedOutputs(model: ProviderModel | undefined): WorkflowNode["outputType"][] {
  const capabilities = (model?.capabilities || {}) as Record<string, unknown>;
  const outputs = supportedOutputOrder.filter((outputType) => capabilityEnabled(capabilities[outputType]));
  return outputs.length > 0 ? [...outputs] : ["image", "video", "text"];
}

function resolveOutputType(
  currentOutputType: WorkflowNode["outputType"] | undefined,
  supportedOutputs: WorkflowNode["outputType"][]
): WorkflowNode["outputType"] {
  if (currentOutputType && supportedOutputs.includes(currentOutputType)) {
    return currentOutputType;
  }
  return supportedOutputs[0];
}

function nodeTypeFromOutput(outputType: WorkflowNode["outputType"]): WorkflowNode["nodeType"] {
  if (outputType === "text") {
    return "text-gen";
  }
  if (outputType === "video") {
    return "video-gen";
  }
  return "image-gen";
}

function outputTypeFromAssetType(type: Asset["type"]): WorkflowNode["outputType"] {
  if (type === "video") {
    return "video";
  }
  if (type === "text") {
    return "text";
  }
  return "image";
}

function buildAssetRefsFromNodes(upstreamNodeIds: string[], nodes: WorkflowNode[]) {
  const nodeMap = nodes.reduce<Record<string, WorkflowNode>>((acc, node) => {
    acc[node.id] = node;
    return acc;
  }, {});

  const refs = upstreamNodeIds
    .map((nodeId) => {
      const sourceNode = nodeMap[nodeId];
      if (!sourceNode) {
        return null;
      }
      return sourceNode.sourceAssetId || `node:${nodeId}`;
    })
    .filter((value): value is string => Boolean(value));

  return [...new Set(refs)];
}

function fallbackProviderModel(providers: ProviderModel[]) {
  const first = providers[0];
  if (first) {
    return first;
  }

  return {
    providerId: "google-gemini" as const,
    modelId: "gemini-3.1-flash",
    displayName: "Nano Banana 2",
    capabilities: { text: true, image: true, video: true },
  };
}

function normalizeAssetNodeLabel(fileName: string, index: number) {
  const trimmed = fileName.trim();
  if (!trimmed) {
    return `Asset ${index + 1}`;
  }
  return trimmed.length <= 28 ? trimmed : `${trimmed.slice(0, 26)}...`;
}

export function CanvasView({ projectId }: Props) {
  const [providers, setProviders] = useState<ProviderModel[]>([]);
  const [canvasDoc, setCanvasDoc] = useState<CanvasDocument>(defaultCanvasDocument);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [modalPosition, setModalPosition] = useState(defaultNodeModalPosition);
  const [isUploading, setIsUploading] = useState(false);

  const saveTimer = useRef<NodeJS.Timeout | null>(null);
  const nodeModalRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const selectedNode = useMemo(
    () => canvasDoc.workflow.nodes.find((node) => node.id === selectedNodeId) || null,
    [canvasDoc.workflow.nodes, selectedNodeId]
  );

  const selectedNodeIsAssetSource = Boolean(selectedNode?.sourceAssetId);

  const selectedModel = useMemo(() => {
    if (!selectedNode || selectedNodeIsAssetSource) {
      return undefined;
    }
    return providers.find(
      (model) => model.providerId === selectedNode.providerId && model.modelId === selectedNode.modelId
    );
  }, [providers, selectedNode, selectedNodeIsAssetSource]);

  const selectedNodeSupportedOutputs = useMemo(() => {
    if (selectedNode && selectedNodeIsAssetSource) {
      return [selectedNode.outputType];
    }
    return getModelSupportedOutputs(selectedModel);
  }, [selectedModel, selectedNode, selectedNodeIsAssetSource]);

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

  const fetchCanvas = useCallback(async () => {
    const data = await getCanvasWorkspace(projectId);
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
  }, [projectId]);

  const fetchJobs = useCallback(async () => {
    const nextJobs = await getJobs(projectId);
    setJobs(nextJobs);
  }, [projectId]);

  const persistCanvas = useCallback(
    async (doc: CanvasDocument) => {
      await putCanvasWorkspace(projectId, {
        canvasDocument: doc,
      });
    },
    [projectId]
  );

  const queueCanvasSave = useCallback(
    (doc: CanvasDocument) => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }

      saveTimer.current = setTimeout(() => {
        persistCanvas(doc).catch((error) => {
          console.error("Failed to persist canvas", error);
        });
      }, 360);
    },
    [persistCanvas]
  );

  useEffect(() => {
    setIsLoading(true);

    Promise.all([getProviders(), fetchCanvas(), fetchJobs(), openProject(projectId)])
      .then(([nextProviders]) => {
        setProviders(nextProviders);
      })
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [fetchCanvas, fetchJobs, projectId]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchJobs().catch(console.error);
    }, 2500);

    return () => clearInterval(interval);
  }, [fetchJobs]);

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

  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
    };
  }, []);

  const addNode = useCallback(
    (position?: { x: number; y: number }) => {
      const defaultProvider = fallbackProviderModel(providers);

      setCanvasDoc((prev) => {
        const outputType = resolveOutputType(undefined, getModelSupportedOutputs(defaultProvider));
        const node: WorkflowNode = {
          id: uid(),
          label: `Node ${prev.workflow.nodes.length + 1}`,
          providerId: defaultProvider.providerId,
          modelId: defaultProvider.modelId,
          nodeType: nodeTypeFromOutput(outputType),
          outputType,
          prompt: "",
          settings: {},
          sourceAssetId: null,
          sourceAssetMimeType: null,
          upstreamNodeIds: [],
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
    },
    [providers, queueCanvasSave]
  );

  const updateNode = useCallback(
    (nodeId: string, patch: Partial<WorkflowNode>) => {
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
    },
    [queueCanvasSave]
  );

  const uploadFilesToCanvas = useCallback(
    async (files: File[], position?: { x: number; y: number }) => {
      if (files.length === 0) {
        return;
      }

      setIsUploading(true);
      try {
        const uploaded = await Promise.all(
          files.map(async (file) => ({
            file,
            asset: await uploadProjectAsset(projectId, file),
          }))
        );

        const defaultProvider = fallbackProviderModel(providers);
        setCanvasDoc((prev) => {
          const baseX =
            position?.x ?? Math.round(120 + (prev.workflow.nodes.length % 4) * 260);
          const baseY =
            position?.y ?? Math.round(120 + Math.floor(prev.workflow.nodes.length / 4) * 170);

          const sourceNodes = uploaded.map(({ file, asset }, index) => {
            const outputType = outputTypeFromAssetType(asset.type);
            return {
              id: uid(),
              label: normalizeAssetNodeLabel(file.name, index),
              providerId: defaultProvider.providerId,
              modelId: defaultProvider.modelId,
              nodeType: "transform" as const,
              outputType,
              prompt: "",
              settings: { source: "upload" },
              sourceAssetId: asset.id,
              sourceAssetMimeType: asset.mimeType,
              upstreamNodeIds: [],
              upstreamAssetIds: [],
              x: Math.round(baseX + index * 34),
              y: Math.round(baseY + index * 26),
            };
          });

          const nextDoc: CanvasDocument = {
            ...prev,
            workflow: {
              nodes: [...prev.workflow.nodes, ...sourceNodes],
            },
          };

          queueCanvasSave(nextDoc);
          setSelectedNodeId(sourceNodes[sourceNodes.length - 1]?.id || null);
          return nextDoc;
        });
      } catch (error) {
        console.error(error);
      } finally {
        setIsUploading(false);
      }
    },
    [projectId, providers, queueCanvasSave]
  );

  const connectNodes = useCallback(
    (sourceNodeId: string, targetNodeId: string) => {
      if (sourceNodeId === targetNodeId) {
        return;
      }

      setCanvasDoc((prev) => {
        const sourceExists = prev.workflow.nodes.some((node) => node.id === sourceNodeId);
        const targetExists = prev.workflow.nodes.some((node) => node.id === targetNodeId);
        if (!sourceExists || !targetExists) {
          return prev;
        }

        const nextNodes = prev.workflow.nodes.map((node) => {
          if (node.id !== targetNodeId) {
            return node;
          }
          const upstreamNodeIds = [...new Set([...node.upstreamNodeIds, sourceNodeId])];
          return {
            ...node,
            upstreamNodeIds,
            upstreamAssetIds: buildAssetRefsFromNodes(upstreamNodeIds, prev.workflow.nodes),
          };
        });

        const nextDoc: CanvasDocument = {
          ...prev,
          workflow: {
            nodes: nextNodes,
          },
        };

        queueCanvasSave(nextDoc);
        return nextDoc;
      });
    },
    [queueCanvasSave]
  );

  const removeNode = useCallback(
    (nodeId: string) => {
      setCanvasDoc((prev) => {
        const remainingNodes = prev.workflow.nodes.filter((node) => node.id !== nodeId);
        const nextNodes = remainingNodes.map((node) => {
          const upstreamNodeIds = node.upstreamNodeIds.filter((upstreamNodeId) => upstreamNodeId !== nodeId);
          return {
            ...node,
            upstreamNodeIds,
            upstreamAssetIds: buildAssetRefsFromNodes(upstreamNodeIds, remainingNodes),
          };
        });

        const nextDoc: CanvasDocument = {
          ...prev,
          workflow: {
            nodes: nextNodes,
          },
        };

        queueCanvasSave(nextDoc);
        return nextDoc;
      });

      setSelectedNodeId((current) => (current === nodeId ? null : current));
    },
    [queueCanvasSave]
  );

  const updateViewport = useCallback(
    (nextViewport: CanvasDocument["canvasViewport"]) => {
      setCanvasDoc((prev) => {
        const nextDoc: CanvasDocument = {
          ...prev,
          canvasViewport: nextViewport,
        };

        queueCanvasSave(nextDoc);
        return nextDoc;
      });
    },
    [queueCanvasSave]
  );

  const runNode = useCallback(
    async (node: WorkflowNode) => {
      if (node.sourceAssetId) {
        return;
      }

      const resolvedAssetIds = buildAssetRefsFromNodes(node.upstreamNodeIds, canvasDoc.workflow.nodes);
      await createJob(projectId, {
        ...node,
        upstreamAssetIds: resolvedAssetIds,
      });
      await fetchJobs();
    },
    [canvasDoc.workflow.nodes, fetchJobs, projectId]
  );

  const startDraggingModal = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      modalDragStateRef.current = {
        active: true,
        startMouseX: event.clientX,
        startMouseY: event.clientY,
        startX: modalPosition.x,
        startY: modalPosition.y,
      };
    },
    [modalPosition.x, modalPosition.y]
  );

  const onFilePickerChange = useCallback(
    (event: ReactChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      event.target.value = "";
      uploadFilesToCanvas(files).catch(console.error);
    },
    [uploadFilesToCanvas]
  );

  return (
    <WorkspaceShell projectId={projectId} view="canvas" jobs={jobs} showQueuePill>
      <div className={styles.page}>
        {isLoading ? (
          <div className={styles.loading}>Loading canvas...</div>
        ) : (
          <InfiniteCanvas
            nodes={canvasDoc.workflow.nodes}
            selectedNodeId={selectedNodeId}
            viewport={canvasDoc.canvasViewport}
            onSelectNode={setSelectedNodeId}
            onDropNode={(position) => addNode(position)}
            onDropFiles={(files, position) => {
              uploadFilesToCanvas(files, position).catch(console.error);
            }}
            onViewportChange={updateViewport}
            onNodePositionChange={(nodeId, nodePosition) => updateNode(nodeId, nodePosition)}
            onConnectNodes={connectNodes}
            latestNodeStates={latestNodeStates}
          />
        )}

        <input
          ref={fileInputRef}
          className={styles.fileInput}
          type="file"
          multiple
          onChange={onFilePickerChange}
        />

        <button
          type="button"
          className={styles.uploadCta}
          disabled={isUploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {isUploading ? "Uploading..." : "Upload Assets"}
        </button>

        {selectedNode ? (
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

              {selectedNodeIsAssetSource ? (
                <label>
                  Uploaded Source Asset
                  <div className={styles.connectionSummary}>{selectedNode.sourceAssetId}</div>
                </label>
              ) : (
                <div className={styles.nodeGrid}>
                  <label>
                    Provider
                    <select
                      value={selectedNode.providerId}
                      onChange={(event) => {
                        const providerId = event.target.value as WorkflowNode["providerId"];
                        const model = (groupedProviders[providerId] || [])[0];
                        const supportedOutputs = getModelSupportedOutputs(model);
                        const outputType = resolveOutputType(selectedNode.outputType, supportedOutputs);

                        updateNode(selectedNode.id, {
                          providerId,
                          modelId: model?.modelId || "",
                          outputType,
                          nodeType: nodeTypeFromOutput(outputType),
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
                      onChange={(event) => {
                        const modelId = event.target.value;
                        const model = (groupedProviders[selectedNode.providerId] || []).find(
                          (providerModel) => providerModel.modelId === modelId
                        );
                        const supportedOutputs = getModelSupportedOutputs(model);
                        const outputType = resolveOutputType(selectedNode.outputType, supportedOutputs);

                        updateNode(selectedNode.id, {
                          modelId,
                          outputType,
                          nodeType: nodeTypeFromOutput(outputType),
                        });
                      }}
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
                      disabled={selectedNodeSupportedOutputs.length <= 1}
                      onChange={(event) => {
                        const outputType = event.target.value as WorkflowNode["outputType"];
                        updateNode(selectedNode.id, {
                          outputType,
                          nodeType: nodeTypeFromOutput(outputType),
                        });
                      }}
                    >
                      {selectedNodeSupportedOutputs.map((outputType) => (
                        <option key={outputType} value={outputType}>
                          {outputType}
                        </option>
                      ))}
                    </select>
                    <small className={styles.helperText}>
                      {selectedNodeSupportedOutputs.length <= 1
                        ? "Output locked by selected model."
                        : "Output options based on selected model."}
                    </small>
                  </label>
                </div>
              )}

              {selectedNodeIsAssetSource ? null : (
                <label>
                  Prompt
                  <textarea
                    className={styles.nodePrompt}
                    value={selectedNode.prompt}
                    onChange={(event) => updateNode(selectedNode.id, { prompt: event.target.value })}
                    placeholder="Describe what this node should generate"
                  />
                </label>
              )}

              <label>
                Connected Inputs
                <div className={styles.connectionSummary}>
                  {selectedNode.upstreamNodeIds.length > 0
                    ? selectedNode.upstreamNodeIds.join(", ")
                    : "No incoming node connections."}
                </div>
              </label>

              <div className={styles.nodeModalActions}>
                {selectedNodeIsAssetSource ? null : <button onClick={() => runNode(selectedNode)}>Run Node</button>}
                <button
                  onClick={() =>
                    updateNode(selectedNode.id, {
                      upstreamNodeIds: [],
                      upstreamAssetIds: [],
                    })
                  }
                >
                  Clear Inputs
                </button>
                <button onClick={() => removeNode(selectedNode.id)}>Delete Node</button>
                <button onClick={() => setSelectedNodeId(null)}>Close</button>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </WorkspaceShell>
  );
}
