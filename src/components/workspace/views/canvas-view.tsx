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
import { useRouter } from "next/navigation";
import { InfiniteCanvas } from "@/components/infinite-canvas";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import {
  createJobFromRequest,
  getCanvasWorkspace,
  getJobDebug,
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
  type JobDebugResponse,
  type OpenAIImageMode,
  type ProviderModel,
  type WorkflowNode,
} from "@/components/workspace/types";
import styles from "./canvas-view.module.css";

const defaultNodeModalPosition = {
  x: 24,
  y: 92,
};

const supportedOutputOrder = ["image", "video", "text"] as const;
const generatedNodeBaseOffsetX = 328;
const generatedNodeColumnOffsetX = 40;
const generatedNodeOffsetY = 38;

type Props = {
  projectId: string;
};

type CanvasInsertMenuState = {
  clientX: number;
  clientY: number;
  worldX: number;
  worldY: number;
};

function capabilityEnabled(value: unknown) {
  return value === true || value === "true" || value === 1;
}

function getModelDefaultSettings(model: ProviderModel | undefined) {
  const settings = model?.capabilities?.defaults ? { ...model.capabilities.defaults } : {};
  if (model?.providerId === "openai" && model.modelId === "gpt-image-1.5") {
    return {
      ...settings,
      openaiImageMode: settings.openaiImageMode === "generate" ? "generate" : "edit",
    };
  }
  return settings;
}

function getModelSupportedOutputs(model: ProviderModel | undefined): WorkflowNode["outputType"][] {
  const capabilities = model?.capabilities;
  const outputs = supportedOutputOrder.filter((outputType) => capabilityEnabled(capabilities?.[outputType]));
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

function nextCanvasNodePosition(nodeCount: number, position?: { x: number; y: number }) {
  return {
    x: Math.round(position?.x ?? (120 + (nodeCount % 4) * 260)),
    y: Math.round(position?.y ?? (120 + Math.floor(nodeCount / 4) * 160)),
  };
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

function fallbackProviderModel(providers: ProviderModel[]): ProviderModel {
  const preferred =
    providers.find((provider) => provider.providerId === "openai" && provider.modelId === "gpt-image-1.5") ||
    providers.find((provider) => provider.capabilities.runnable) ||
    providers[0];
  if (preferred) {
    return preferred;
  }

  return {
    providerId: "openai" as const,
    modelId: "gpt-image-1.5",
    displayName: "GPT Image 1.5",
    capabilities: {
      text: false,
      image: true,
      video: false,
      runnable: false,
      availability: "ready" as const,
      requiresApiKeyEnv: "OPENAI_API_KEY",
      apiKeyConfigured: false,
      executionModes: ["generate", "edit"],
      acceptedInputMimeTypes: ["image/png", "image/jpeg", "image/webp"],
      maxInputImages: 5,
      defaults: {
        outputFormat: "png",
        quality: "medium",
        size: "1024x1024",
        inputFidelity: "high",
        openaiImageMode: "edit",
      },
    },
  };
}

function normalizeAssetNodeLabel(fileName: string, index: number) {
  const trimmed = fileName.trim();
  if (!trimmed) {
    return `Asset ${index + 1}`;
  }
  return trimmed.length <= 28 ? trimmed : `${trimmed.slice(0, 26)}...`;
}

function getNodeSourceJobId(node: WorkflowNode | null | undefined) {
  if (!node) {
    return null;
  }
  if (node.sourceJobId) {
    return node.sourceJobId;
  }
  return typeof node.settings.sourceJobId === "string" ? node.settings.sourceJobId : null;
}

function isGeneratedAssetNode(node: WorkflowNode | null | undefined) {
  if (!node || node.kind !== "asset-source") {
    return false;
  }
  return node.settings.source === "generated" || Boolean(getNodeSourceJobId(node));
}

function readOpenAiImageMode(node: WorkflowNode | null | undefined): OpenAIImageMode {
  return node?.settings.openaiImageMode === "generate" ? "generate" : "edit";
}

function getGeneratedNodeLabel(existingCount: number) {
  return `Output ${existingCount + 1}`;
}

function isInputLikeElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

export function CanvasView({ projectId }: Props) {
  const router = useRouter();
  const [providers, setProviders] = useState<ProviderModel[]>([]);
  const [canvasDoc, setCanvasDoc] = useState<CanvasDocument>(defaultCanvasDocument);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [modalPosition, setModalPosition] = useState(defaultNodeModalPosition);
  const [isUploading, setIsUploading] = useState(false);
  const [isApiPreviewOpen, setIsApiPreviewOpen] = useState(false);
  const [isSourceCallOpen, setIsSourceCallOpen] = useState(false);
  const [sourceCallDebug, setSourceCallDebug] = useState<JobDebugResponse | null>(null);
  const [sourceCallLoading, setSourceCallLoading] = useState(false);
  const [sourceCallError, setSourceCallError] = useState<string | null>(null);
  const [insertMenu, setInsertMenu] = useState<CanvasInsertMenuState | null>(null);

  const saveTimer = useRef<NodeJS.Timeout | null>(null);
  const nodeModalRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const insertMenuRef = useRef<HTMLDivElement | null>(null);
  const pendingUploadAnchorRef = useRef<{ x: number; y: number } | null>(null);

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

  const nodesById = useMemo(() => {
    return canvasDoc.workflow.nodes.reduce<Record<string, WorkflowNode>>((acc, node) => {
      acc[node.id] = node;
      return acc;
    }, {});
  }, [canvasDoc.workflow.nodes]);

  const selectedNodes = useMemo(() => {
    return selectedNodeIds
      .map((nodeId) => nodesById[nodeId])
      .filter((node): node is WorkflowNode => Boolean(node));
  }, [nodesById, selectedNodeIds]);

  const primarySelectedNodeId = selectedNodeIds.length > 0 ? selectedNodeIds[selectedNodeIds.length - 1] : null;

  const selectedNode = useMemo(
    () => canvasDoc.workflow.nodes.find((node) => node.id === primarySelectedNodeId) || null,
    [canvasDoc.workflow.nodes, primarySelectedNodeId]
  );

  const selectedNodeIsAssetSource = selectedNode?.kind === "asset-source";
  const selectedNodeIsTextNote = selectedNode?.kind === "text-note";
  const selectedNodeIsModel = selectedNode?.kind === "model";
  const selectedNodeIsGeneratedAsset = isGeneratedAssetNode(selectedNode);

  const selectedModel = useMemo(() => {
    if (!selectedNode || !selectedNodeIsModel) {
      return undefined;
    }
    return providers.find(
      (model) => model.providerId === selectedNode.providerId && model.modelId === selectedNode.modelId
    );
  }, [providers, selectedNode, selectedNodeIsModel]);

  const selectedNodeSupportedOutputs = useMemo(() => {
    if (selectedNode && selectedNodeIsAssetSource) {
      return [selectedNode.outputType];
    }
    if (selectedNode && selectedNodeIsTextNote) {
      return ["text"];
    }
    return getModelSupportedOutputs(selectedModel);
  }, [selectedModel, selectedNode, selectedNodeIsAssetSource, selectedNodeIsTextNote]);

  const selectedNodeSourceJobId = useMemo(() => getNodeSourceJobId(selectedNode), [selectedNode]);

  const selectedGeneratedSourceJob = useMemo(() => {
    if (!selectedNodeSourceJobId) {
      return null;
    }
    return jobs.find((job) => job.id === selectedNodeSourceJobId) || null;
  }, [jobs, selectedNodeSourceJobId]);

  const latestImageAssetByNodeId = useMemo(() => {
    const map = new Map<string, { assetId: string; mimeType: string | null; createdAtMs: number }>();

    for (const job of jobs) {
      if (job.state !== "succeeded") {
        continue;
      }
      const nodeId = job.nodeRunPayload?.nodeId;
      if (!nodeId) {
        continue;
      }

      for (const asset of job.assets || []) {
        if (asset.type !== "image") {
          continue;
        }

        const createdAtMs = new Date(asset.createdAt).getTime();
        const existing = map.get(nodeId);
        if (!existing || createdAtMs > existing.createdAtMs) {
          map.set(nodeId, { assetId: asset.id, mimeType: asset.mimeType || null, createdAtMs });
        }
      }
    }

    return map;
  }, [jobs]);

  const resolveNodeImageAsset = useCallback(
    (node: WorkflowNode | null | undefined) => {
      if (!node || node.outputType !== "image") {
        return null;
      }

      if (node.sourceAssetId) {
        return {
          assetId: node.sourceAssetId,
          mimeType: node.sourceAssetMimeType,
        };
      }

      const latest = latestImageAssetByNodeId.get(node.id);
      if (!latest) {
        return null;
      }

      return {
        assetId: latest.assetId,
        mimeType: latest.mimeType,
      };
    },
    [latestImageAssetByNodeId]
  );

  const resolveNodeImageAssetId = useCallback(
    (node: WorkflowNode | null | undefined) => resolveNodeImageAsset(node)?.assetId || null,
    [resolveNodeImageAsset]
  );

  const selectedImageAssetIds = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const node of selectedNodes) {
      const assetId = resolveNodeImageAssetId(node);
      if (!assetId || seen.has(assetId)) {
        continue;
      }
      ids.push(assetId);
      seen.add(assetId);
    }
    return ids;
  }, [resolveNodeImageAssetId, selectedNodes]);

  const selectedSingleImageAssetId = useMemo(() => {
    if (selectedNodeIds.length !== 1) {
      return null;
    }
    return resolveNodeImageAssetId(selectedNode);
  }, [resolveNodeImageAssetId, selectedNode, selectedNodeIds.length]);

  const selectedPromptSourceNode = useMemo(() => {
    if (!selectedNode?.promptSourceNodeId) {
      return null;
    }

    return canvasDoc.workflow.nodes.find((node) => node.id === selectedNode.promptSourceNodeId) || null;
  }, [canvasDoc.workflow.nodes, selectedNode?.promptSourceNodeId]);

  const selectedTextNoteTargets = useMemo(() => {
    if (!selectedNodeIsTextNote || !selectedNode) {
      return [];
    }

    return canvasDoc.workflow.nodes.filter(
      (node) => node.kind === "model" && node.promptSourceNodeId === selectedNode.id
    );
  }, [canvasDoc.workflow.nodes, selectedNode, selectedNodeIsTextNote]);

  const selectedInputNodes = useMemo(() => {
    if (!selectedNode) {
      return [];
    }

    return selectedNode.upstreamNodeIds
      .map((nodeId) => nodesById[nodeId] || null)
      .filter((node): node is WorkflowNode => Boolean(node));
  }, [nodesById, selectedNode]);

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

    setSelectedNodeIds((current) => current.filter((nodeId) => nodes.some((node) => node.id === nodeId)));
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

  const selectSingleNode = useCallback((nodeId: string | null) => {
    setSelectedNodeIds(nodeId ? [nodeId] : []);
  }, []);

  const toggleNodeSelection = useCallback((nodeId: string) => {
    setSelectedNodeIds((prev) => {
      if (prev.includes(nodeId)) {
        return prev.filter((id) => id !== nodeId);
      }
      return [...prev, nodeId];
    });
  }, []);

  const addNodesToSelection = useCallback((nodeIds: string[]) => {
    setSelectedNodeIds((prev) => {
      const seen = new Set(prev);
      const merged = [...prev];
      for (const nodeId of nodeIds) {
        if (seen.has(nodeId)) {
          continue;
        }
        seen.add(nodeId);
        merged.push(nodeId);
      }
      return merged;
    });
  }, []);

  const buildNodeRunRequest = useCallback(
    (node: WorkflowNode) => {
      const model = providers.find(
        (providerModel) => providerModel.providerId === node.providerId && providerModel.modelId === node.modelId
      );
      const promptSourceNode = node.promptSourceNodeId ? nodesById[node.promptSourceNodeId] || null : null;
      const prompt = node.promptSourceNodeId ? (promptSourceNode?.prompt || "") : node.prompt;
      const maxInputImages = model?.capabilities.maxInputImages || 0;
      const acceptedMimeTypes = new Set(model?.capabilities.acceptedInputMimeTypes || []);
      const executionMode = readOpenAiImageMode(node);

      const inputImageAssetIds = node.upstreamNodeIds
        .map((nodeId) => nodesById[nodeId] || null)
        .map((inputNode) => (inputNode ? resolveNodeImageAsset(inputNode) : null))
        .filter((assetRef): assetRef is NonNullable<ReturnType<typeof resolveNodeImageAsset>> => Boolean(assetRef))
        .filter((assetRef) => {
          if (acceptedMimeTypes.size === 0) {
            return true;
          }
          return Boolean(assetRef.mimeType && acceptedMimeTypes.has(assetRef.mimeType));
        })
        .map((assetRef) => assetRef.assetId)
        .filter((assetId, index, array) => array.indexOf(assetId) === index)
        .slice(0, maxInputImages || undefined);

      const requestPayload = {
        providerId: node.providerId,
        modelId: node.modelId,
        nodePayload: {
          nodeId: node.id,
          nodeType: node.nodeType === "text-note" ? "text-gen" : node.nodeType,
          prompt: prompt.trim(),
          settings: {
            ...getModelDefaultSettings(model),
            ...node.settings,
          },
          outputType: node.outputType,
          executionMode,
          promptSourceNodeId: node.promptSourceNodeId,
          upstreamNodeIds: node.upstreamNodeIds,
          upstreamAssetIds: inputImageAssetIds,
          inputImageAssetIds,
        },
      } as const;

      let disabledReason: string | null = null;
      let readyMessage: string | null = null;
      if (!model) {
        disabledReason = "Selected model is unavailable.";
      } else if (model.capabilities.availability !== "ready") {
        disabledReason = `${model.displayName} is coming soon.`;
      } else if (model.capabilities.requiresApiKeyEnv && !model.capabilities.apiKeyConfigured) {
        disabledReason = `Set ${model.capabilities.requiresApiKeyEnv} in .env.local and restart npm run dev.`;
      } else if (!model.capabilities.executionModes.includes(executionMode)) {
        disabledReason = `${model.displayName} does not support ${executionMode} mode.`;
      } else if (!requestPayload.nodePayload.prompt) {
        disabledReason = node.promptSourceNodeId
          ? "Connected text note is empty."
          : "Connect a prompt note or enter a prompt.";
      } else if (executionMode === "generate" && requestPayload.nodePayload.inputImageAssetIds.length > 0) {
        disabledReason = "Generate mode is prompt-only. Disconnect image inputs or switch to Edit.";
      } else if (executionMode === "edit" && requestPayload.nodePayload.inputImageAssetIds.length === 0) {
        disabledReason =
          acceptedMimeTypes.size > 0
            ? "Connect a PNG, JPEG, or WebP image input."
            : "Connect an image input.";
      } else {
        readyMessage =
          executionMode === "generate"
            ? "Ready to generate from prompt only."
            : `Ready to edit with ${requestPayload.nodePayload.inputImageAssetIds.length} image input${
                requestPayload.nodePayload.inputImageAssetIds.length === 1 ? "" : "s"
              }.`;
      }

      return {
        requestPayload,
        disabledReason,
        readyMessage,
        endpoint:
          executionMode === "generate"
            ? "client.images.generate"
            : "client.images.edit",
      };
    },
    [nodesById, providers, resolveNodeImageAsset]
  );

  const selectedNodeRunPreview = useMemo(() => {
    if (!selectedNode || !selectedNodeIsModel) {
      return null;
    }

    return buildNodeRunRequest(selectedNode);
  }, [buildNodeRunRequest, selectedNode, selectedNodeIsModel]);

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
    setIsApiPreviewOpen(false);
    setIsSourceCallOpen(false);
    setSourceCallDebug(null);
    setSourceCallError(null);
  }, [primarySelectedNodeId]);

  useEffect(() => {
    if (!isSourceCallOpen || !selectedNodeSourceJobId) {
      return;
    }

    let canceled = false;
    setSourceCallLoading(true);
    getJobDebug(projectId, selectedNodeSourceJobId)
      .then((response) => {
        if (canceled) {
          return;
        }
        setSourceCallDebug(response);
        setSourceCallError(null);
      })
      .catch((error) => {
        if (canceled) {
          return;
        }
        setSourceCallDebug(null);
        setSourceCallError(error instanceof Error ? error.message : "Failed to load source call.");
      })
      .finally(() => {
        if (!canceled) {
          setSourceCallLoading(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, [isSourceCallOpen, projectId, selectedNodeSourceJobId]);

  useEffect(() => {
    if (jobs.length === 0) {
      return;
    }

    setCanvasDoc((prev) => {
      const jobById = new Map(jobs.map((job) => [job.id, job]));
      let didChange = false;

      const updatedNodes = prev.workflow.nodes.map((node) => {
        if (!isGeneratedAssetNode(node)) {
          return node;
        }

        const sourceJobId = getNodeSourceJobId(node);
        if (!sourceJobId) {
          return node;
        }

        const job = jobById.get(sourceJobId);
        if (!job) {
          return node;
        }

        const latestImageAsset = [...(job.assets || [])]
          .filter((asset) => asset.type === "image")
          .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
          .at(-1);

        const nextProcessingState =
          job.state === "queued" || job.state === "running" || job.state === "failed" ? job.state : null;
        const nextNode: WorkflowNode = {
          ...node,
          providerId: job.providerId as WorkflowNode["providerId"],
          modelId: job.modelId,
          sourceJobId,
          processingState: nextProcessingState,
          sourceAssetId: latestImageAsset?.id || node.sourceAssetId,
          sourceAssetMimeType: latestImageAsset?.mimeType || node.sourceAssetMimeType,
          settings: {
            ...node.settings,
            source: "generated",
            sourceJobId,
            sourceModelNodeId:
              typeof node.settings.sourceModelNodeId === "string"
                ? node.settings.sourceModelNodeId
                : job.nodeRunPayload?.nodeId || null,
          },
        };

        if (JSON.stringify(nextNode) === JSON.stringify(node)) {
          return node;
        }

        didChange = true;
        return nextNode;
      });

      if (!didChange) {
        return prev;
      }

      const nextDoc: CanvasDocument = {
        ...prev,
        workflow: {
          nodes: updatedNodes,
        },
      };

      queueCanvasSave(nextDoc);
      return nextDoc;
    });
  }, [jobs, queueCanvasSave]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!insertMenuRef.current) {
        return;
      }

      const target = event.target as Node | null;
      if (target && insertMenuRef.current.contains(target)) {
        return;
      }

      setInsertMenu(null);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setInsertMenu(null);
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

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

  const addModelNode = useCallback(
    (position?: { x: number; y: number }) => {
      const defaultProvider = fallbackProviderModel(providers);

      setCanvasDoc((prev) => {
        const outputType = resolveOutputType(undefined, getModelSupportedOutputs(defaultProvider));
        const nextPosition = nextCanvasNodePosition(prev.workflow.nodes.length, position);
        const node: WorkflowNode = {
          id: uid(),
          label: `Node ${prev.workflow.nodes.length + 1}`,
          kind: "model",
          providerId: defaultProvider.providerId,
          modelId: defaultProvider.modelId,
          nodeType: nodeTypeFromOutput(outputType),
          outputType,
          prompt: "",
          settings: getModelDefaultSettings(defaultProvider),
          sourceAssetId: null,
          sourceAssetMimeType: null,
          sourceJobId: null,
          processingState: null,
          promptSourceNodeId: null,
          upstreamNodeIds: [],
          upstreamAssetIds: [],
          x: nextPosition.x,
          y: nextPosition.y,
        };

        const nextDoc: CanvasDocument = {
          ...prev,
          workflow: {
            nodes: [...prev.workflow.nodes, node],
          },
        };

        queueCanvasSave(nextDoc);
        setSelectedNodeIds([node.id]);
        setInsertMenu(null);
        return nextDoc;
      });
    },
    [providers, queueCanvasSave]
  );

  const addTextNote = useCallback(
    (position?: { x: number; y: number }) => {
      const defaultProvider = fallbackProviderModel(providers);

      setCanvasDoc((prev) => {
        const nextPosition = nextCanvasNodePosition(prev.workflow.nodes.length, position);
        const node: WorkflowNode = {
          id: uid(),
          label: `Note ${prev.workflow.nodes.filter((item) => item.kind === "text-note").length + 1}`,
          kind: "text-note",
          providerId: defaultProvider.providerId,
          modelId: defaultProvider.modelId,
          nodeType: "text-note",
          outputType: "text",
          prompt: "",
          settings: { source: "text-note" },
          sourceAssetId: null,
          sourceAssetMimeType: null,
          sourceJobId: null,
          processingState: null,
          promptSourceNodeId: null,
          upstreamNodeIds: [],
          upstreamAssetIds: [],
          x: nextPosition.x,
          y: nextPosition.y,
        };

        const nextDoc: CanvasDocument = {
          ...prev,
          workflow: {
            nodes: [...prev.workflow.nodes, node],
          },
        };

        queueCanvasSave(nextDoc);
        setSelectedNodeIds([node.id]);
        setInsertMenu(null);
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
              kind: "asset-source" as const,
              providerId: defaultProvider.providerId,
              modelId: defaultProvider.modelId,
              nodeType: "transform" as const,
              outputType,
              prompt: "",
              settings: { source: "upload" },
              sourceAssetId: asset.id,
              sourceAssetMimeType: asset.mimeType,
              sourceJobId: null,
              processingState: null,
              promptSourceNodeId: null,
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
          const lastSourceNode = sourceNodes[sourceNodes.length - 1];
          setSelectedNodeIds(lastSourceNode ? [lastSourceNode.id] : []);
          setInsertMenu(null);
          return nextDoc;
        });
      } catch (error) {
        console.error(error);
      } finally {
        setIsUploading(false);
        pendingUploadAnchorRef.current = null;
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
        const sourceNode = prev.workflow.nodes.find((node) => node.id === sourceNodeId);
        const targetNode = prev.workflow.nodes.find((node) => node.id === targetNodeId);
        if (!sourceNode || !targetNode) {
          return prev;
        }

        if (targetNode.kind === "text-note") {
          return prev;
        }

        if (sourceNode.kind === "text-note") {
          if (targetNode.kind !== "model") {
            return prev;
          }

          const nextNodes = prev.workflow.nodes.map((node) =>
            node.id === targetNodeId
              ? {
                  ...node,
                  promptSourceNodeId: sourceNodeId,
                }
              : node
          );

          const nextDoc: CanvasDocument = {
            ...prev,
            workflow: {
              nodes: nextNodes,
            },
          };

          queueCanvasSave(nextDoc);
          return nextDoc;
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

  const removeNodes = useCallback(
    (nodeIds: string[]) => {
      if (nodeIds.length === 0) {
        return;
      }
      const nodeIdSet = new Set(nodeIds);

      setCanvasDoc((prev) => {
        const remainingNodes = prev.workflow.nodes.filter((node) => !nodeIdSet.has(node.id));
        const nextNodes = remainingNodes.map((node) => {
          const upstreamNodeIds = node.upstreamNodeIds.filter((upstreamNodeId) => !nodeIdSet.has(upstreamNodeId));
          return {
            ...node,
            promptSourceNodeId: node.promptSourceNodeId && nodeIdSet.has(node.promptSourceNodeId) ? null : node.promptSourceNodeId,
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

      setSelectedNodeIds((current) => current.filter((nodeId) => !nodeIdSet.has(nodeId)));
    },
    [queueCanvasSave]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") {
        return;
      }
      if (selectedNodeIds.length === 0) {
        return;
      }
      if (isInputLikeElement(event.target)) {
        return;
      }

      event.preventDefault();
      removeNodes(selectedNodeIds);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [removeNodes, selectedNodeIds]);

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

  const insertGeneratedOutputPlaceholder = useCallback(
    (job: Job, sourceNodeId: string) => {
      setCanvasDoc((prev) => {
        if (prev.workflow.nodes.some((node) => getNodeSourceJobId(node) === job.id)) {
          return prev;
        }

        const modelNode = prev.workflow.nodes.find((node) => node.id === sourceNodeId && node.kind === "model");
        if (!modelNode) {
          return prev;
        }

        const generatedCount = prev.workflow.nodes.filter(
          (node) =>
            isGeneratedAssetNode(node) &&
            (node.settings.sourceModelNodeId === sourceNodeId || node.upstreamNodeIds.includes(sourceNodeId))
        ).length;

        const outputNode: WorkflowNode = {
          id: uid(),
          label: getGeneratedNodeLabel(generatedCount),
          kind: "asset-source",
          providerId: modelNode.providerId,
          modelId: modelNode.modelId,
          nodeType: "transform",
          outputType: "image",
          prompt: "",
          settings: {
            source: "generated",
            sourceJobId: job.id,
            sourceModelNodeId: sourceNodeId,
            outputIndex: generatedCount,
          },
          sourceAssetId: null,
          sourceAssetMimeType: null,
          sourceJobId: job.id,
          processingState: "queued",
          promptSourceNodeId: null,
          upstreamNodeIds: [sourceNodeId],
          upstreamAssetIds: [`node:${sourceNodeId}`],
          x: Math.round(
            modelNode.x + generatedNodeBaseOffsetX + Math.floor(generatedCount / 4) * generatedNodeColumnOffsetX
          ),
          y: Math.round(modelNode.y + (generatedCount % 4) * generatedNodeOffsetY),
        };

        const nextDoc: CanvasDocument = {
          ...prev,
          workflow: {
            nodes: [...prev.workflow.nodes, outputNode],
          },
        };

        queueCanvasSave(nextDoc);
        return nextDoc;
      });
    },
    [queueCanvasSave]
  );

  const runNode = useCallback(
    async (node: WorkflowNode) => {
      if (node.kind !== "model" || node.sourceAssetId) {
        return;
      }

      const requestPreview = buildNodeRunRequest(node);
      if (requestPreview.disabledReason) {
        return;
      }

      const job = await createJobFromRequest(projectId, requestPreview.requestPayload);
      setJobs((prev) => [job, ...prev.filter((existingJob) => existingJob.id !== job.id)]);
      insertGeneratedOutputPlaceholder(job, node.id);
      await fetchJobs();
    },
    [buildNodeRunRequest, fetchJobs, insertGeneratedOutputPlaceholder, projectId]
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
      uploadFilesToCanvas(files, pendingUploadAnchorRef.current || undefined).catch(console.error);
    },
    [uploadFilesToCanvas]
  );

  const openAssetViewer = useCallback(
    (assetId: string) => {
      router.push(`/projects/${projectId}/assets/${assetId}`);
    },
    [projectId, router]
  );

  const openCompare = useCallback(
    (mode: "compare_2" | "compare_4", count: number) => {
      const assetIds = selectedImageAssetIds.slice(0, count);
      if (assetIds.length < count) {
        return;
      }
      const params = new URLSearchParams({
        layout: mode,
        assetIds: assetIds.join(","),
      });
      router.push(`/projects/${projectId}/assets?${params.toString()}`);
    },
    [projectId, router, selectedImageAssetIds]
  );

  const apiCallPreviewPayload = useMemo(() => {
    if (!selectedNodeRunPreview) {
      return null;
    }

    return {
      endpoint: selectedNodeRunPreview.endpoint,
      request: selectedNodeRunPreview.requestPayload,
    };
  }, [selectedNodeRunPreview]);
  const sourceCallLatestAttempt = sourceCallDebug?.attempts[0] || null;

  return (
    <WorkspaceShell projectId={projectId} view="canvas" jobs={jobs} showQueuePill>
      <div className={styles.page}>
        {isLoading ? (
          <div className={styles.loading}>Loading canvas...</div>
        ) : (
          <InfiniteCanvas
            nodes={canvasDoc.workflow.nodes}
            selectedNodeIds={selectedNodeIds}
            viewport={canvasDoc.canvasViewport}
            onSelectSingleNode={selectSingleNode}
            onToggleNodeSelection={toggleNodeSelection}
            onMarqueeSelectNodes={addNodesToSelection}
            onUpdateTextNote={(nodeId, prompt) => updateNode(nodeId, { prompt })}
            onRequestInsertMenu={(position) => {
              setInsertMenu({
                clientX: position.clientX,
                clientY: position.clientY,
                worldX: position.x,
                worldY: position.y,
              });
            }}
            onDropFiles={(files, position) => {
              uploadFilesToCanvas(files, position).catch(console.error);
            }}
            onViewportChange={updateViewport}
            onNodePositionChange={(nodeId, nodePosition) => updateNode(nodeId, nodePosition)}
            onConnectNodes={connectNodes}
          />
        )}

        {insertMenu ? (
          <div
            ref={insertMenuRef}
            className={styles.insertMenu}
            style={{
              left: insertMenu.clientX,
              top: insertMenu.clientY,
            }}
          >
            <div className={styles.insertMenuTitle}>Add To Canvas</div>
            <button type="button" onClick={() => addModelNode({ x: insertMenu.worldX, y: insertMenu.worldY })}>
              Add Model Node
            </button>
            <button type="button" onClick={() => addTextNote({ x: insertMenu.worldX, y: insertMenu.worldY })}>
              Add Text Note
            </button>
            <button
              type="button"
              onClick={() => {
                pendingUploadAnchorRef.current = { x: insertMenu.worldX, y: insertMenu.worldY };
                setInsertMenu(null);
                fileInputRef.current?.click();
              }}
            >
              Upload Assets
            </button>
          </div>
        ) : null}

        {selectedNodeIds.length > 0 ? (
          <div className={styles.selectionBar}>
            <span className={styles.selectionCount}>
              {`${selectedNodeIds.length} node${selectedNodeIds.length === 1 ? "" : "s"} selected`}
            </span>

            {selectedSingleImageAssetId ? (
              <button type="button" onClick={() => openAssetViewer(selectedSingleImageAssetId)}>
                View Image
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => openCompare("compare_2", 2)}
              disabled={selectedImageAssetIds.length < 2}
            >
              Compare 2
            </button>

            <button
              type="button"
              onClick={() => openCompare("compare_4", 4)}
              disabled={selectedImageAssetIds.length < 4}
            >
              Compare 4
            </button>

            <button type="button" onClick={() => removeNodes(selectedNodeIds)}>
              Delete Selected
            </button>
          </div>
        ) : null}

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
          onClick={() => {
            pendingUploadAnchorRef.current = null;
            fileInputRef.current?.click();
          }}
        >
          {isUploading ? "Uploading..." : "Upload Assets"}
        </button>

        {selectedNode && selectedNodeIds.length === 1 ? (
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
                <>
                  <label>
                    {selectedNodeIsGeneratedAsset ? "Generated Output Node" : "Uploaded Source Asset"}
                    <div className={styles.connectionSummary}>
                      {selectedNode.sourceAssetId || "Waiting for generated image output."}
                    </div>
                  </label>

                  {selectedNodeIsGeneratedAsset ? (
                    <label>
                      Generation Origin
                      <div className={styles.connectionSummary}>
                        <strong>{selectedNode.providerId}</strong>
                        {` / ${selectedNode.modelId} · `}
                        {selectedGeneratedSourceJob?.state ||
                          selectedNode.processingState ||
                          (selectedNode.sourceAssetId ? "succeeded" : "pending")}
                        {selectedNodeSourceJobId ? ` · ${selectedNodeSourceJobId}` : ""}
                      </div>
                    </label>
                  ) : null}
                </>
              ) : selectedNodeIsTextNote ? (
                <>
                  <label>
                    Note Text
                    <textarea
                      className={styles.nodePrompt}
                      value={selectedNode.prompt}
                      onChange={(event) => updateNode(selectedNode.id, { prompt: event.target.value })}
                      placeholder="Write prompt notes here"
                    />
                  </label>

                  <label>
                    Connected Targets
                    <div className={styles.connectionSummary}>
                      {selectedTextNoteTargets.length > 0
                        ? selectedTextNoteTargets.map((node) => node.label).join(", ")
                        : "No model nodes are using this note yet."}
                    </div>
                  </label>
                </>
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
                          settings: {
                            ...getModelDefaultSettings(model),
                            ...selectedNode.settings,
                          },
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
                          settings: {
                            ...getModelDefaultSettings(model),
                            ...selectedNode.settings,
                          },
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

                  {selectedModel?.providerId === "openai" && selectedModel.modelId === "gpt-image-1.5" ? (
                    <label>
                      Mode
                      <select
                        value={readOpenAiImageMode(selectedNode)}
                        onChange={(event) =>
                          updateNode(selectedNode.id, {
                            settings: {
                              ...selectedNode.settings,
                              openaiImageMode: event.target.value === "generate" ? "generate" : "edit",
                            },
                          })
                        }
                      >
                        <option value="generate">Generate</option>
                        <option value="edit">Edit</option>
                      </select>
                      <small className={styles.helperText}>
                        Generate uses prompt only. Edit requires one or more connected image inputs.
                      </small>
                    </label>
                  ) : null}
                </div>
              )}

              {selectedNodeIsModel ? (
                <label>
                  Prompt
                  <textarea
                    className={styles.nodePrompt}
                    value={selectedNode.prompt}
                    onChange={(event) => updateNode(selectedNode.id, { prompt: event.target.value })}
                    placeholder="Describe what this node should generate"
                  />
                  <small className={styles.helperText}>
                    {selectedPromptSourceNode
                      ? "A connected text note overrides this field at run time. This stays as fallback."
                      : "Used when no prompt note is connected."}
                  </small>
                </label>
              ) : null}

              <label>
                {selectedNodeIsTextNote ? "Connection State" : "Connected Inputs"}
                <div className={styles.connectionSummary}>
                  {selectedNodeIsTextNote
                    ? "Text notes connect to model nodes as external prompt sources."
                    : selectedInputNodes.length > 0
                    ? selectedInputNodes.map((node) => node.label).join(", ")
                    : "No incoming node connections."}
                </div>
              </label>

              {selectedNodeIsModel && selectedPromptSourceNode ? (
                <label>
                  Prompt Source
                  <div className={styles.connectionSummary}>
                    <strong>{selectedPromptSourceNode.label}</strong>
                    {selectedPromptSourceNode.prompt.trim()
                      ? `: ${selectedPromptSourceNode.prompt.trim()}`
                      : ": Empty note"}
                  </div>
                </label>
              ) : null}

              {selectedNodeIsModel && selectedNodeRunPreview ? (
                <label>
                  Run Readiness
                  <div
                    className={`${styles.connectionSummary} ${
                      selectedNodeRunPreview.disabledReason ? styles.connectionSummaryWarning : styles.connectionSummaryReady
                    }`}
                  >
                    {selectedNodeRunPreview.disabledReason
                      ? selectedNodeRunPreview.disabledReason
                      : `${selectedNodeRunPreview.readyMessage} via ${selectedNodeRunPreview.endpoint}.`}
                  </div>
                </label>
              ) : null}

              {selectedNodeIsModel ? (
                <div className={styles.debuggerBlock}>
                  <button
                    type="button"
                    className={styles.debuggerToggle}
                    onClick={() => setIsApiPreviewOpen((value) => !value)}
                  >
                    {isApiPreviewOpen ? "Hide API Call Preview" : "Show API Call Preview"}
                  </button>
                  {isApiPreviewOpen && apiCallPreviewPayload ? (
                    <pre className={styles.debuggerPreview}>
                      {JSON.stringify(apiCallPreviewPayload, null, 2)}
                    </pre>
                  ) : null}
                </div>
              ) : null}

              {selectedNodeIsGeneratedAsset && selectedNodeSourceJobId ? (
                <div className={styles.debuggerBlock}>
                  <button
                    type="button"
                    className={styles.debuggerToggle}
                    onClick={() => setIsSourceCallOpen((value) => !value)}
                  >
                    {isSourceCallOpen ? "Hide Source Call" : "Show Source Call"}
                  </button>
                  {isSourceCallOpen ? (
                    sourceCallLoading ? (
                      <div className={styles.connectionSummary}>Loading source call…</div>
                    ) : sourceCallError ? (
                      <div className={`${styles.connectionSummary} ${styles.connectionSummaryWarning}`}>
                        {sourceCallError}
                      </div>
                    ) : sourceCallDebug ? (
                      <>
                        <div className={styles.connectionSummary}>
                          {`Job ${sourceCallDebug.job.id} · ${sourceCallDebug.job.state} · ${sourceCallDebug.attempts.length} attempt${
                            sourceCallDebug.attempts.length === 1 ? "" : "s"
                          }`}
                        </div>
                        <pre className={styles.debuggerPreview}>
                          {JSON.stringify(
                            {
                              request: sourceCallLatestAttempt?.providerRequest || null,
                              response: sourceCallLatestAttempt?.providerResponse || null,
                              error:
                                sourceCallLatestAttempt?.errorCode || sourceCallLatestAttempt?.errorMessage
                                  ? {
                                      code: sourceCallLatestAttempt?.errorCode || "ERROR",
                                      message: sourceCallLatestAttempt?.errorMessage || "Unknown error",
                                    }
                                  : null,
                            },
                            null,
                            2
                          )}
                        </pre>
                      </>
                    ) : (
                      <div className={styles.connectionSummary}>No source call details found.</div>
                    )
                  ) : null}
                </div>
              ) : null}

              <div className={styles.nodeModalActions}>
                {selectedNodeIsModel ? (
                  <button
                    onClick={() => runNode(selectedNode)}
                    disabled={Boolean(selectedNodeRunPreview?.disabledReason)}
                  >
                    Run Node
                  </button>
                ) : null}
                {selectedNodeIsModel ? (
                  <button
                    onClick={() =>
                      updateNode(selectedNode.id, {
                        upstreamNodeIds: [],
                        upstreamAssetIds: [],
                        promptSourceNodeId: null,
                      })
                    }
                  >
                    Clear Inputs
                  </button>
                ) : null}
                {selectedNodeIsGeneratedAsset && selectedNodeSourceJobId ? (
                  <button onClick={() => router.push(`/projects/${projectId}/queue?inspectJobId=${selectedNodeSourceJobId}`)}>
                    View Source Call
                  </button>
                ) : null}
                <button onClick={() => removeNodes([selectedNode.id])}>Delete Node</button>
                <button onClick={() => setSelectedNodeIds([])}>Close</button>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </WorkspaceShell>
  );
}
