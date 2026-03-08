import type {
  Asset,
  AssetFilterState,
  CanvasDocument,
  Job,
  JobDebugResponse,
  OpenAIImageMode,
  Project,
  ProviderId,
  ProviderModel,
  RunnableWorkflowNodeType,
  WorkflowNode,
} from "@/components/workspace/types";

export type AppEventName = "projects.changed" | "workspace.changed" | "assets.changed" | "jobs.changed" | "providers.changed";

export type AppEventPayload = {
  event: AppEventName;
  projectId?: string;
};

export type WorkspaceSnapshotResponse = {
  canvas: {
    canvasDocument: Record<string, unknown> | null;
  } | null;
  workspace: {
    assetViewerLayout?: "grid" | "compare_2" | "compare_4";
    filterState?: Record<string, unknown> | null;
  } | null;
};

export type CreateJobRequest = {
  providerId: ProviderId;
  modelId: string;
  nodePayload: {
    nodeId: string;
    nodeType: RunnableWorkflowNodeType;
    prompt: string;
    settings: Record<string, unknown>;
    outputType: WorkflowNode["outputType"];
    executionMode: OpenAIImageMode;
    outputCount: number;
    promptSourceNodeId?: string | null;
    upstreamNodeIds: string[];
    upstreamAssetIds: string[];
    inputImageAssetIds: string[];
  };
};

export type ImportAssetInput = {
  name: string;
  mimeType: string;
  content: ArrayBuffer;
};

export type NodeInterface = {
  listProjects: () => Promise<Project[]>;
  createProject: (name: string) => Promise<Project>;
  updateProject: (projectId: string, payload: { name?: string; status?: "active" | "archived" }) => Promise<Project>;
  deleteProject: (projectId: string) => Promise<void>;
  openProject: (projectId: string) => Promise<void>;
  getWorkspaceSnapshot: (projectId: string) => Promise<WorkspaceSnapshotResponse>;
  saveWorkspaceSnapshot: (
    projectId: string,
    payload: {
      canvasDocument: CanvasDocument;
      assetViewerLayout?: "grid" | "compare_2" | "compare_4";
      filterState?: Record<string, unknown>;
    }
  ) => Promise<void>;
  listAssets: (
    projectId: string,
    filters: AssetFilterState,
    options?: {
      origin?: "all" | "uploaded" | "generated";
      query?: string;
    }
  ) => Promise<Asset[]>;
  getAsset: (assetId: string) => Promise<Asset>;
  updateAsset: (assetId: string, payload: { rating?: number | null; flagged?: boolean; tags?: string[] }) => Promise<Asset>;
  importAssets: (projectId: string, items?: ImportAssetInput[]) => Promise<Asset[]>;
  listJobs: (projectId: string) => Promise<Job[]>;
  createJob: (projectId: string, payload: CreateJobRequest) => Promise<Job>;
  getJobDebug: (projectId: string, jobId: string) => Promise<JobDebugResponse>;
  listProviders: () => Promise<ProviderModel[]>;
  subscribe: (event: AppEventName, listener: (payload: AppEventPayload) => void) => () => void;
};
