"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Field, Input, Panel, SectionHeader, SelectField, ToolbarGroup } from "@/components/ui";
import { useRouter, useSearchParams } from "@/renderer/navigation";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import {
  getAssetFileUrl,
  getAssets,
  getCanvasWorkspace,
  mergeFilters,
  normalizeNode,
  openProject,
  putCanvasWorkspace,
  updateAsset,
} from "@/components/workspace/client-api";
import {
  defaultCanvasDocument,
  defaultFilterState,
  type Asset,
  type AssetFilterState,
  type CanvasDocument,
} from "@/components/workspace/types";
import { buildUiDataAttributes } from "@/lib/design-system";
import { queryKeys } from "@/renderer/query";
import styles from "./assets-view.module.css";

type Props = {
  projectId: string;
};

function asLayoutMode(input: string | null): "grid" | "compare_2" | "compare_4" | null {
  if (input === "grid" || input === "compare_2" || input === "compare_4") {
    return input;
  }
  return null;
}

function normalizeCanvasDocument(raw: Record<string, unknown> | null | undefined): CanvasDocument {
  const source = (raw || {}) as Record<string, unknown>;
  const viewportRaw = (source.canvasViewport as Record<string, unknown> | undefined) || {};
  const nodesRaw = Array.isArray((source.workflow as Record<string, unknown> | undefined)?.nodes)
    ? (((source.workflow as Record<string, unknown>).nodes as unknown[]) || [])
    : [];

  const nodes = nodesRaw
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((node, index) => normalizeNode(node, index));

  return {
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
  };
}

export function AssetsView({ projectId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [layoutMode, setLayoutMode] = useState<"grid" | "compare_2" | "compare_4">("grid");
  const [filters, setFilters] = useState<AssetFilterState>(defaultFilterState);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [canvasDocument, setCanvasDocument] = useState<CanvasDocument>(defaultCanvasDocument);
  const [workspaceReady, setWorkspaceReady] = useState(false);

  const filtersRef = useRef<AssetFilterState>(defaultFilterState);
  const appliedQueryKeyRef = useRef<string>("");
  const hydratedProjectRef = useRef<string | null>(null);
  const queryLayoutMode = useMemo(() => asLayoutMode(searchParams.get("layout")), [searchParams]);
  const queryAssetIds = useMemo(() => {
    const raw = searchParams.get("assetIds");
    if (!raw) {
      return [];
    }
    return raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 4);
  }, [searchParams]);
  const workspaceQuery = useQuery({
    queryKey: queryKeys.workspace(projectId),
    queryFn: () => getCanvasWorkspace(projectId),
  });
  const assetsQuery = useQuery<Asset[]>({
    queryKey: queryKeys.assets(projectId, filters),
    queryFn: () => getAssets(projectId, filters),
    enabled: workspaceReady,
  });
  const assets = assetsQuery.data || [];

  const activeAssets = useMemo(() => {
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    return selectedAssetIds
      .map((assetId) => byId.get(assetId))
      .filter((asset): asset is Asset => Boolean(asset));
  }, [assets, selectedAssetIds]);

  const compareRequiredCount = layoutMode === "compare_2" ? 2 : 4;
  const compareCandidateAssets = useMemo(() => {
    if (activeAssets.length > 0) {
      return activeAssets;
    }

    return assets;
  }, [activeAssets, assets]);
  const compareAssets = useMemo(() => {
    return compareCandidateAssets.slice(0, compareRequiredCount);
  }, [compareCandidateAssets, compareRequiredCount]);
  const compareMissingCount = Math.max(0, compareRequiredCount - compareAssets.length);
  const compareOverflowCount = Math.max(0, compareCandidateAssets.length - compareRequiredCount);

  const persistWorkspace = useCallback(
    async (nextLayout = layoutMode, nextFilters = filtersRef.current) => {
      await putCanvasWorkspace(projectId, {
        canvasDocument,
        assetViewerLayout: nextLayout,
        filterState: nextFilters,
      });
    },
    [canvasDocument, layoutMode, projectId]
  );

  useEffect(() => {
    hydratedProjectRef.current = null;
    appliedQueryKeyRef.current = "";
    setWorkspaceReady(false);
    setSelectedAssetIds([]);
    setLayoutMode("grid");
    setFilters(defaultFilterState);
    filtersRef.current = defaultFilterState;
    setCanvasDocument(defaultCanvasDocument);
    openProject(projectId).catch(console.error);
  }, [projectId]);

  useEffect(() => {
    if (!workspaceQuery.data || hydratedProjectRef.current === projectId) {
      return;
    }

    setCanvasDocument(
      normalizeCanvasDocument((workspaceQuery.data.canvas?.canvasDocument || null) as Record<string, unknown> | null)
    );

    const nextLayout = workspaceQuery.data.workspace?.assetViewerLayout || "grid";
    const nextFilters = mergeFilters(workspaceQuery.data.workspace?.filterState || null, defaultFilterState);
    filtersRef.current = nextFilters;
    hydratedProjectRef.current = projectId;
    setLayoutMode(queryLayoutMode || nextLayout);
    setFilters(nextFilters);
    setWorkspaceReady(true);
  }, [projectId, queryLayoutMode, workspaceQuery.data]);

  useEffect(() => {
    if (queryLayoutMode) {
      setLayoutMode(queryLayoutMode);
    }
  }, [queryLayoutMode]);

  useEffect(() => {
    if (queryAssetIds.length === 0 || assets.length === 0) {
      return;
    }
    const queryKey = `${queryLayoutMode || ""}|${queryAssetIds.join(",")}`;
    if (appliedQueryKeyRef.current === queryKey) {
      return;
    }
    const validIds = queryAssetIds.filter((assetId) => assets.some((asset) => asset.id === assetId));
    setSelectedAssetIds(validIds.slice(0, 4));
    appliedQueryKeyRef.current = queryKey;
  }, [assets, queryAssetIds, queryLayoutMode]);

  const onFilterChange = useCallback(
    (patch: Partial<AssetFilterState>) => {
      const next = { ...filtersRef.current, ...patch };
      filtersRef.current = next;
      setFilters(next);

      persistWorkspace(layoutMode, next).catch(console.error);
    },
    [layoutMode, persistWorkspace]
  );

  const changeLayoutMode = useCallback(
    (layout: "grid" | "compare_2" | "compare_4") => {
      setLayoutMode(layout);
      persistWorkspace(layout, filtersRef.current).catch(console.error);
    },
    [persistWorkspace]
  );

  return (
    <WorkspaceShell projectId={projectId} view="assets">
      <div {...buildUiDataAttributes("app", "compact")} className={styles.page}>
        <Panel as="aside" variant="shell" density="compact" className={styles.filterRail}>
          <h2>Assets</h2>

          <Field label="Type">
            <SelectField
              value={filters.type}
              onChange={(event) => onFilterChange({ type: event.target.value as AssetFilterState["type"] })}
            >
              <option value="all">all types</option>
              <option value="image">image</option>
              <option value="video">video</option>
              <option value="text">text</option>
            </SelectField>
          </Field>

          <Field label="Rating">
            <SelectField
              value={filters.ratingAtLeast}
              onChange={(event) => onFilterChange({ ratingAtLeast: Number(event.target.value) })}
            >
              <option value={0}>any rating</option>
              <option value={1}>1+ stars</option>
              <option value={2}>2+ stars</option>
              <option value={3}>3+ stars</option>
              <option value={4}>4+ stars</option>
              <option value={5}>5 stars</option>
            </SelectField>
          </Field>

          <Field label="Provider">
            <SelectField
              value={filters.providerId}
              onChange={(event) =>
                onFilterChange({ providerId: event.target.value as AssetFilterState["providerId"] })
              }
            >
              <option value="all">all providers + uploaded assets</option>
              <option value="openai">openai</option>
              <option value="google-gemini">google-gemini</option>
              <option value="topaz">topaz</option>
            </SelectField>
          </Field>

          <Field label="Sort">
            <SelectField
              value={filters.sort}
              onChange={(event) => onFilterChange({ sort: event.target.value as AssetFilterState["sort"] })}
            >
              <option value="newest">newest</option>
              <option value="oldest">oldest</option>
              <option value="rating">rating</option>
            </SelectField>
          </Field>

          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={filters.flaggedOnly}
              onChange={(event) => onFilterChange({ flaggedOnly: event.target.checked })}
            />
            flagged only
          </label>

          <Field label="Tag">
            <Input
              value={filters.tag}
              onChange={(event) => onFilterChange({ tag: event.target.value })}
              placeholder="tag filter"
            />
          </Field>
        </Panel>

        <Panel variant="panel" density="compact" className={styles.content}>
          <header className={styles.contentHeader}>
            <SectionHeader
              eyebrow="Review"
              title="Assets"
              description="Filter by source and quality, then flip between review grid and precision compare layouts."
            />

            <ToolbarGroup className={styles.modeButtons}>
              <Button
                variant={layoutMode === "grid" ? "primary" : "secondary"}
                size="sm"
                onClick={() => changeLayoutMode("grid")}
              >
                Grid
              </Button>
              <Button
                variant={layoutMode === "compare_2" ? "primary" : "secondary"}
                size="sm"
                onClick={() => changeLayoutMode("compare_2")}
              >
                2-up
              </Button>
              <Button
                variant={layoutMode === "compare_4" ? "primary" : "secondary"}
                size="sm"
                onClick={() => changeLayoutMode("compare_4")}
              >
                4-up
              </Button>
            </ToolbarGroup>
          </header>

          {workspaceQuery.isLoading || (workspaceReady && assetsQuery.isLoading) ? (
            <div className={styles.loading}>Loading assets...</div>
          ) : layoutMode === "grid" ? (
            <div className={styles.assetGrid}>
              {assets.map((asset) => (
                <article
                  key={asset.id}
                  className={`${styles.assetCard} ${selectedAssetIds.includes(asset.id) ? styles.assetSelected : ""}`}
                  tabIndex={0}
                  onDoubleClick={() => {
                    router.push(`/projects/${projectId}/assets/${asset.id}`);
                  }}
                  onClick={() => {
                    setSelectedAssetIds((prev) =>
                      prev.includes(asset.id) ? prev.filter((id) => id !== asset.id) : [...prev, asset.id].slice(-4)
                    );
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedAssetIds((prev) =>
                        prev.includes(asset.id) ? prev.filter((id) => id !== asset.id) : [...prev, asset.id].slice(-4)
                      );
                    }

                    if (event.key === "o" || event.key === "O") {
                      router.push(`/projects/${projectId}/assets/${asset.id}`);
                    }
                  }}
                >
                  <AssetPreview asset={asset} compact />

                  <div className={styles.assetHoverPanel}>
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
                            updateAsset(asset.id, { rating: score })
                              .then(() => assetsQuery.refetch())
                              .catch(console.error);
                          }}
                        >
                          ★
                        </button>
                      ))}

                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          updateAsset(asset.id, { flagged: !asset.flagged })
                            .then(() => assetsQuery.refetch())
                            .catch(console.error);
                        }}
                      >
                        {asset.flagged ? "Unflag" : "Flag"}
                      </button>
                    </div>

                    <TagEditor
                      asset={asset}
                      onSave={(tags) => {
                        updateAsset(asset.id, { tags })
                          .then(() => assetsQuery.refetch())
                          .catch(console.error);
                      }}
                    />
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.compareMode}>
              <p>
                {layoutMode === "compare_2"
                  ? "2-up precision mode: two full images in one viewport, no crop."
                  : "4-up precision mode: four full images in one viewport, no crop."}
              </p>
              {compareOverflowCount > 0 ? (
                <p className={styles.compareHint}>
                  {`Showing first ${compareRequiredCount} of ${compareCandidateAssets.length} assets for this mode.`}
                </p>
              ) : null}

              <div
                className={`${styles.compareStage} ${
                  layoutMode === "compare_2" ? styles.compareTwo : styles.compareFour
                }`}
              >
                {compareAssets.map((asset) => (
                  <article key={asset.id} className={styles.compareCell}>
                    <AssetPreview asset={asset} analysis />
                    <div className={styles.compareMetaOverlay}>
                      <span>{asset.job?.providerId || "uploaded/local"}</span>
                      <span>{asset.width && asset.height ? `${asset.width}x${asset.height}` : "unknown dimensions"}</span>
                    </div>
                  </article>
                ))}
                {Array.from({ length: compareMissingCount }).map((_, index) => (
                  <div key={`missing-${index}`} className={styles.comparePlaceholder}>
                    {`Select ${compareMissingCount - index} more asset${compareMissingCount - index === 1 ? "" : "s"} in Grid`}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>
      </div>
    </WorkspaceShell>
  );
}

type AssetPreviewProps = {
  asset: Asset;
  compact?: boolean;
  analysis?: boolean;
};

function AssetPreview({ asset, compact = false, analysis = false }: AssetPreviewProps) {
  const className = analysis
    ? styles.assetPreviewImageAnalysis
    : compact
      ? styles.assetPreviewImageCompact
      : styles.assetPreviewImage;
  const frameClassName = analysis
    ? styles.assetPreviewFrameAnalysis
    : compact
      ? styles.assetPreviewFrameCompact
      : styles.assetPreviewFrame;

  const wrapCompactPreview = (content: ReactElement) => {
    if (!compact || analysis) {
      return content;
    }

    return <div className={styles.assetPreviewCompactFrame}>{content}</div>;
  };

  if (asset.type === "image") {
    const image = (
      <img
        className={className}
        src={getAssetFileUrl(asset.id)}
        alt={`Generated asset ${asset.id}`}
      />
    );

    return wrapCompactPreview(image);
  }

  if (asset.type === "text") {
    const frame = (
      <iframe
        className={frameClassName}
        src={getAssetFileUrl(asset.id)}
        title={`Asset ${asset.id}`}
      />
    );

    return wrapCompactPreview(frame);
  }

  const video = (
    <div
      className={
        analysis ? styles.videoPlaceholderAnalysis : compact ? styles.videoPlaceholderCompact : styles.videoPlaceholder
      }
    >
      <p>Video Output (stub)</p>
      <a href={getAssetFileUrl(asset.id)} target="_blank" rel="noreferrer">
        Open metadata
      </a>
    </div>
  );

  return wrapCompactPreview(video);
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
      <input
        value={value}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onChange={(event) => setValue(event.target.value)}
        placeholder="tags"
      />
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
