import path from "node:path";
import { fork, type ChildProcess } from "node:child_process";
import { eq } from "drizzle-orm";
import { app, BrowserWindow, dialog, ipcMain, protocol } from "electron";
import type { AppEventPayload, CreateJobRequest, ImportAssetInput } from "@/lib/ipc-contract";
import type { AssetFilterState } from "@/components/workspace/types";
import { getDb } from "@/lib/db/client";
import { jobPreviewFrames } from "@/lib/db/schema";
import { readAssetContent } from "@/lib/storage/local-storage";
import { getAsset, importAssets, importAssetsFromPaths, listAssets, readAssetFile, updateAsset } from "@/lib/services/assets";
import { createJob, getJobDebug, listJobs } from "@/lib/services/jobs";
import { createProject, deleteProject, listProjects, openProject, updateProject } from "@/lib/services/projects";
import { listProviders, syncProviderModels } from "@/lib/services/providers";
import { getWorkspaceSnapshot, saveWorkspaceSnapshot } from "@/lib/services/workspace";

const APP_EVENT_CHANNEL = "node-interface:event";
const APP_INVOKE_CHANNEL = "node-interface:invoke";

let mainWindow: BrowserWindow | null = null;
let workerProcess: ChildProcess | null = null;
let isQuitting = false;

function ensureAppEnvironment() {
  if (!process.env.NODE_INTERFACE_APP_DATA) {
    process.env.NODE_INTERFACE_APP_DATA = path.join(app.getPath("userData"), "node-interface-demo");
  }
}

function broadcastEvent(payload: AppEventPayload) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(APP_EVENT_CHANNEL, payload);
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#060606",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl) => {
    console.error(`[renderer:load-failed] ${errorCode} ${errorDescription} (${validatedUrl})`);
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[renderer:gone]", details.reason, details.exitCode);
  });

  if (process.env.NODE_ENV === "development") {
    mainWindow.webContents.on("did-finish-load", async () => {
      try {
        const state = await mainWindow.webContents.executeJavaScript(`
          ({
            title: document.title,
            bodyText: document.body?.innerText?.slice(0, 200) || "",
            hasNodeInterface: Boolean(window.nodeInterface),
          })
        `);
        console.log("[renderer:ready]", state);
      } catch (error) {
        console.error("[renderer:ready-check-failed]", error);
      }
    });
  }

  if (process.env.NODE_ENV === "development") {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL || "http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
    return;
  }

  await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
}

async function handleAssetProtocol(request: Request) {
  const url = new URL(request.url);

  if (url.host === "asset") {
    const assetId = url.pathname.replace(/^\/+/, "");
    const asset = await getAsset(assetId);
    const file = await readAssetFile(asset.storageRef, asset.mimeType);
    return new Response(new Uint8Array(file), {
      status: 200,
      headers: {
        "Content-Type": asset.mimeType,
        "Cache-Control": "no-store",
      },
    });
  }

  if (url.host === "preview") {
    const previewFrameId = url.pathname.replace(/^\/+/, "");
    const previewFrame = getDb().select().from(jobPreviewFrames).where(eq(jobPreviewFrames.id, previewFrameId)).get();
    if (!previewFrame) {
      return new Response("Preview frame not found", { status: 404 });
    }

    const file = await readAssetContent(previewFrame.storageRef);
    return new Response(new Uint8Array(file), {
      status: 200,
      headers: {
        "Content-Type": previewFrame.mimeType,
        "Cache-Control": "no-store",
      },
    });
  }

  return new Response("Not found", { status: 404 });
}

async function startWorker() {
  workerProcess = fork(path.join(__dirname, "worker.cjs"), {
    env: {
      ...process.env,
      NODE_INTERFACE_APP_DATA: process.env.NODE_INTERFACE_APP_DATA,
    },
  });

  workerProcess.on("message", (message: unknown) => {
    if (!message || typeof message !== "object") {
      return;
    }

    const payload = message as { type?: string; event?: AppEventPayload["event"]; projectId?: string };
    if (payload.type === "event" && payload.event) {
      broadcastEvent({
        event: payload.event,
        projectId: payload.projectId,
      });
    }
  });

  workerProcess.on("exit", () => {
    workerProcess = null;
    if (!isQuitting) {
      void startWorker();
    }
  });
}

function registerIpc() {
  const handlers = {
    listProjects: async () => listProjects(),
    createProject: async (name: string) => {
      const project = await createProject(name);
      broadcastEvent({ event: "projects.changed", projectId: project.id });
      broadcastEvent({ event: "workspace.changed", projectId: project.id });
      return project;
    },
    updateProject: async (projectId: string, payload: { name?: string; status?: "active" | "archived" }) => {
      const project = await updateProject(projectId, payload);
      broadcastEvent({ event: "projects.changed", projectId });
      return project;
    },
    deleteProject: async (projectId: string) => {
      await deleteProject(projectId);
      broadcastEvent({ event: "projects.changed", projectId });
    },
    openProject: async (projectId: string) => {
      await openProject(projectId);
      broadcastEvent({ event: "projects.changed", projectId });
      broadcastEvent({ event: "workspace.changed", projectId });
    },
    getWorkspaceSnapshot: async (projectId: string) => getWorkspaceSnapshot(projectId),
    saveWorkspaceSnapshot: async (
      projectId: string,
      payload: {
        canvasDocument: Record<string, unknown>;
        assetViewerLayout?: "grid" | "compare_2" | "compare_4";
        filterState?: Record<string, unknown>;
      }
    ) => {
      await saveWorkspaceSnapshot(projectId, payload);
      broadcastEvent({ event: "workspace.changed", projectId });
    },
    listAssets: async (
      projectId: string,
      filters: AssetFilterState,
      options?: {
        origin?: "all" | "uploaded" | "generated";
        query?: string;
      }
    ) => listAssets(projectId, filters, options),
    getAsset: async (assetId: string) => getAsset(assetId),
    updateAsset: async (assetId: string, payload: { rating?: number | null; flagged?: boolean; tags?: string[] }) => {
      const asset = await updateAsset(assetId, payload);
      broadcastEvent({ event: "assets.changed", projectId: asset.projectId });
      return asset;
    },
    importAssets: async (projectId: string, items?: ImportAssetInput[]) => {
      let imported;

      if (items && items.length > 0) {
        imported = await importAssets(
          projectId,
          items.map((item) => ({
            name: item.name,
            mimeType: item.mimeType,
            buffer: Buffer.from(item.content),
          }))
        );
      } else {
        const selected = await dialog.showOpenDialog(mainWindow || undefined, {
          properties: ["openFile", "multiSelections"],
        });
        if (selected.canceled || selected.filePaths.length === 0) {
          return [];
        }
        imported = await importAssetsFromPaths(projectId, selected.filePaths);
      }

      broadcastEvent({ event: "assets.changed", projectId });
      return imported;
    },
    listJobs: async (projectId: string) => listJobs(projectId),
    createJob: async (projectId: string, payload: CreateJobRequest) => {
      const job = await createJob(projectId, payload);
      broadcastEvent({ event: "jobs.changed", projectId });
      return job;
    },
    getJobDebug: async (projectId: string, jobId: string) => getJobDebug(projectId, jobId),
    listProviders: async () => listProviders(),
  } as const;

  ipcMain.handle(APP_INVOKE_CHANNEL, async (_event, method: keyof typeof handlers, ...args: unknown[]) => {
    const handler = handlers[method];
    if (!handler) {
      throw new Error(`Unknown node interface method: ${String(method)}`);
    }
    return handler(...(args as never[]));
  });
}

app.whenReady().then(async () => {
  ensureAppEnvironment();
  await syncProviderModels();
  protocol.handle("app-asset", handleAssetProtocol);
  registerIpc();
  await startWorker();
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  workerProcess?.kill();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
