import assert from "node:assert/strict";
import { access, mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron, type Page } from "playwright";

const FILTERS = {
  type: "all" as const,
  ratingAtLeast: 0,
  flaggedOnly: false,
  tag: "",
  providerId: "all" as const,
  sort: "newest" as const,
};

function projectRoutePattern(projectId?: string, view?: "canvas" | "assets") {
  if (projectId && view) {
    return new RegExp(`#?/projects/${projectId}/${view}$`);
  }

  if (view) {
    return new RegExp(`#?/projects/[^/]+/${view}$`);
  }

  return /#?\/projects\/[^/]+$/;
}

async function withTimeout<T>(label: string, promise: Promise<T>, timeoutMs = 15_000): Promise<T> {
  let timer: NodeJS.Timeout | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function captureFailureState(window: Page | null, appDataRoot: string) {
  if (!window) {
    return;
  }

  try {
    await window.screenshot({
      path: path.join(appDataRoot, "failure.png"),
      fullPage: true,
    });
    console.error("Failure screenshot:", path.join(appDataRoot, "failure.png"));
    console.error("Failure URL:", window.url());
    console.error("Failure HTML:");
    console.error(await window.locator("body").innerHTML());
  } catch (error) {
    console.error("Failed to capture failure state:", error);
  }
}

async function openMenuItem(window: Page, itemName: string) {
  await window.getByRole("button", { name: "Menu" }).click();
  await window.getByRole("button", { name: itemName }).click();
}

async function main() {
  const appDataRoot = await mkdtemp(path.join(os.tmpdir(), "node-interface-smoke-"));
  const canvasScreenshotPath = path.join(appDataRoot, "canvas-smoke.png");
  const assetsScreenshotPath = path.join(appDataRoot, "assets-smoke.png");
  const queueScreenshotPath = path.join(appDataRoot, "queue-smoke.png");
  const settingsScreenshotPath = path.join(appDataRoot, "settings-smoke.png");

  console.log("Smoke app data root:", appDataRoot);

  const electronApp = await withTimeout("electron.launch", electron.launch({
    args: [path.resolve("dist/electron/main.cjs")],
    env: {
      ...process.env,
      NODE_ENV: "production",
      NODE_INTERFACE_APP_DATA: appDataRoot,
    },
  }));

  let window: Page | null = null;
  try {
    console.log("Electron launched");
    window = await withTimeout("electron.firstWindow", electronApp.firstWindow());
    window.on("console", (message) => {
      console.log(`[window:${message.type()}]`, message.text());
    });

    await withTimeout("window.domcontentloaded", window.waitForLoadState("domcontentloaded"));
    console.log("Window loaded:", await window.title(), window.url());

    await withTimeout(
      "window.nodeInterface",
      window.waitForFunction(() => Boolean(window.nodeInterface), undefined, { timeout: 15_000 })
    );
    console.log("Preload bridge detected");

    const providerSummary = await window.evaluate(async () => {
      const providers = await window.nodeInterface.listProviders();
      return providers
        .filter((model) => ["openai", "topaz", "google-gemini"].includes(model.providerId))
        .map((model) => ({
          providerId: model.providerId,
          modelId: model.modelId,
          runnable: model.capabilities.runnable,
          requirements: model.capabilities.requirements || [],
        }));
    });
    console.log("Provider readiness:", JSON.stringify(providerSummary, null, 2));

    await withTimeout(
      "launcher heading",
      window.getByRole("heading", { name: "Start a Project" }).waitFor({ state: "visible", timeout: 15_000 })
    );
    console.log("Launcher rendered");

    await window.getByRole("button", { name: "Create Project" }).click();
    await withTimeout("canvas route", window.waitForURL(projectRoutePattern(undefined, "canvas")));
    console.log("Project created and canvas route loaded:", window.url());

    const projectId = await window.evaluate(() => {
      const currentUrl = `${window.location.pathname}${window.location.hash}`;
      return currentUrl.match(/\/projects\/([^/]+)/)?.[1] || "";
    });
    assert.ok(projectId, "Expected a project id in the canvas route.");
    console.log("Active project:", projectId);

    const nodeLabels = await window.evaluate(async ({ activeProjectId }) => {
      await window.nodeInterface.saveWorkspaceSnapshot(activeProjectId, {
        canvasDocument: {
          canvasViewport: {
            x: 0,
            y: 0,
            zoom: 1,
          },
          workflow: {
            nodes: [
              {
                id: "smoke-text-note",
                label: "Smoke Prompt",
                providerId: "openai",
                modelId: "gpt-image-1.5",
                kind: "text-note",
                nodeType: "text-note",
                outputType: "text",
                prompt: "Draw a red square on a blue background.",
                settings: {
                  source: "text-note",
                },
                sourceAssetId: null,
                sourceAssetMimeType: null,
                sourceJobId: null,
                sourceOutputIndex: null,
                processingState: null,
                promptSourceNodeId: null,
                upstreamNodeIds: [],
                upstreamAssetIds: [],
                x: 120,
                y: 120,
              },
              {
                id: "smoke-model-node",
                label: "Smoke Image Model",
                providerId: "openai",
                modelId: "gpt-image-1.5",
                kind: "model",
                nodeType: "image-gen",
                outputType: "image",
                prompt: "",
                settings: {},
                sourceAssetId: null,
                sourceAssetMimeType: null,
                sourceJobId: null,
                sourceOutputIndex: null,
                processingState: null,
                promptSourceNodeId: "smoke-text-note",
                upstreamNodeIds: [],
                upstreamAssetIds: [],
                x: 420,
                y: 120,
              },
            ],
          },
        },
      });

      const snapshot = await window.nodeInterface.getWorkspaceSnapshot(activeProjectId);
      const nodes = Array.isArray((snapshot.canvas?.canvasDocument as { workflow?: { nodes?: Array<{ label?: string }> } } | null)?.workflow?.nodes)
        ? ((snapshot.canvas?.canvasDocument as { workflow?: { nodes?: Array<{ label?: string }> } }).workflow?.nodes || [])
        : [];

      return nodes.map((node) => node.label || "");
    }, { activeProjectId: projectId });

    assert.deepEqual(nodeLabels, ["Smoke Prompt", "Smoke Image Model"]);
    console.log("Canvas snapshot round-trip verified");

    await window.reload();
    await withTimeout("canvas reload", window.waitForLoadState("domcontentloaded"));
    await window.waitForTimeout(800);
    await window.screenshot({ path: canvasScreenshotPath, fullPage: true });
    console.log("Canvas screenshot:", canvasScreenshotPath);

    const importedAssets = await window.evaluate(async ({ activeProjectId }) => {
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
          <rect width="320" height="200" fill="#0b0b0b" />
          <circle cx="100" cy="100" r="56" fill="#ff4fa2" />
          <rect x="160" y="44" width="96" height="112" rx="12" fill="#4ea4ff" />
        </svg>
      `.trim();

      return window.nodeInterface.importAssets(activeProjectId, [
        {
          name: "smoke.svg",
          mimeType: "image/svg+xml",
          content: new TextEncoder().encode(svg).buffer,
        },
      ]);
    }, { activeProjectId: projectId });

    assert.equal(importedAssets.length, 1, "Expected one imported asset.");
    console.log("Asset import verified");

    const assetCount = await window.evaluate(async ({ activeProjectId, filters }) => {
      const assets = await window.nodeInterface.listAssets(activeProjectId, filters);
      return assets.length;
    }, { activeProjectId: projectId, filters: FILTERS });

    assert.equal(assetCount, 1, "Expected one asset after import.");
    console.log("Asset listing verified");

    await openMenuItem(window, "Assets");
    await withTimeout("assets route", window.waitForURL(projectRoutePattern(projectId, "assets")));
    await withTimeout(
      "asset preview",
      window.getByRole("img", { name: new RegExp(`Generated asset ${importedAssets[0]!.id}`) }).waitFor({
        state: "visible",
        timeout: 15_000,
      })
    );
    await window.waitForTimeout(800);
    await window.screenshot({ path: assetsScreenshotPath, fullPage: true });
    console.log("Assets screenshot:", assetsScreenshotPath);

    await openMenuItem(window, "Queue");
    await withTimeout("queue route", window.waitForURL(projectRoutePattern(projectId, "queue")));
    await withTimeout("queue heading", window.getByRole("heading", { name: "Queue" }).waitFor({ state: "visible", timeout: 15_000 }));
    await withTimeout(
      "queue inspector",
      window.getByRole("heading", { name: "Call Inspector" }).waitFor({ state: "visible", timeout: 15_000 })
    );
    await window.screenshot({ path: queueScreenshotPath, fullPage: true });
    console.log("Queue screenshot:", queueScreenshotPath);

    await openMenuItem(window, "Project Settings");
    await withTimeout("settings route", window.waitForURL(projectRoutePattern(projectId, "settings")));
    await withTimeout(
      "settings heading",
      window.getByRole("heading", { name: "Project Settings" }).waitFor({ state: "visible", timeout: 15_000 })
    );
    const projectNameValue = await window.getByRole("textbox").inputValue();
    assert.ok(projectNameValue.trim().length > 0, "Expected a project name in settings.");
    await window.screenshot({ path: settingsScreenshotPath, fullPage: true });
    console.log("Settings screenshot:", settingsScreenshotPath);

    await access(path.join(appDataRoot, "app.sqlite"));
    const storedAssetFiles = await readdir(path.join(appDataRoot, "assets", projectId));
    assert.ok(storedAssetFiles.length > 0, "Expected imported asset files on disk.");
    console.log("On-disk asset storage verified");

    console.log(
      JSON.stringify(
        {
          projectId,
          appDataRoot,
          canvasScreenshotPath,
          assetsScreenshotPath,
          queueScreenshotPath,
          settingsScreenshotPath,
          providerSummary,
          nodeLabels,
          assetCount,
          storedAssetFiles,
        },
        null,
        2
      )
    );
  } catch (error) {
    await captureFailureState(window, appDataRoot);
    throw error;
  } finally {
    await electronApp.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
