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
import {
  getAssetOriginFilterOption,
  getAssetOriginLabel,
  isAssetRatingStarActive,
  isEditableEventTarget,
  shouldShowAssetReviewFilterRail,
  type AssetReviewLayoutMode,
} from "@/lib/asset-review";
import { buildUiDataAttributes } from "@/lib/design-system";
import { queryKeys } from "@/renderer/query";
import styles from "./assets-view.module.css";

type Props = {
  projectId: string;
};

function asLayoutMode(input: string | null): AssetReviewLayoutMode | null {
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
  const [layoutMode, setLayoutMode] = useState<AssetReviewLayoutMode>("grid");
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
  const assetQueryOptions = useMemo(() => {
    const origin = getAssetOriginFilterOption(filters.origin);
    return origin === "all" ? undefined : { origin };
  }, [filters.origin]);
  const workspaceQuery = useQuery({
    queryKey: queryKeys.workspace(projectId),
    queryFn: () => getCanvasWorkspace(projectId),
  });
  const assetsQuery = useQuery<Asset[]>({
    queryKey: queryKeys.assets(projectId, filters, assetQueryOptions),
    queryFn: () => getAssets(projectId, filters, assetQueryOptions),
    enabled: workspaceReady,
  });
  const assets = assetsQuery.data || [];
  const showFilterRail = shouldShowAssetReviewFilterRail(layoutMode);

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
  const contentStatus = showFilterRail
    ? `${assets.length} asset${assets.length === 1 ? "" : "s"}`
    : `${compareAssets.length}/${compareRequiredCount} loaded${activeAssets.length > 0 ? " from selection" : ""}`;

  const persistWorkspaceLayout = useCallback(
    async (nextLayout = layoutMode) => {
      await putCanvasWorkspace(projectId, {
        canvasDocument,
        assetViewerLayout: nextLayout,
        filterState: defaultFilterState,
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

    const normalizedCanvasDocument = normalizeCanvasDocument(
      (workspaceQuery.data.canvas?.canvasDocument || null) as Record<string, unknown> | null
    );
    const nextLayout = workspaceQuery.data.workspace?.assetViewerLayout || "grid";
    const effectiveLayout = queryLayoutMode || nextLayout;
    const persistedFilterState = workspaceQuery.data.workspace?.filterState || null;

    setCanvasDocument(normalizedCanvasDocument);

    filtersRef.current = defaultFilterState;
    hydratedProjectRef.current = projectId;
    setLayoutMode(effectiveLayout);
    setFilters(defaultFilterState);
    setWorkspaceReady(true);

    if (persistedFilterState && Object.keys(persistedFilterState).length > 0) {
      putCanvasWorkspace(projectId, {
        canvasDocument: normalizedCanvasDocument,
        assetViewerLayout: effectiveLayout,
        filterState: defaultFilterState,
      }).catch(console.error);
    }
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
    },
    []
  );

  const changeLayoutMode = useCallback(
    (layout: AssetReviewLayoutMode) => {
      setLayoutMode(layout);
      persistWorkspaceLayout(layout).catch(console.error);
    },
    [persistWorkspaceLayout]
  );

  return (
    <WorkspaceShell projectId={projectId} view="assets">
      <div
        {...buildUiDataAttributes("app", "compact")}
        className={`${styles.page} ${showFilterRail ? styles.pageGrid : styles.pageCompare}`}
      >
        {showFilterRail ? (
          <Panel
            as="aside"
            variant="shell"
            density="compact"
            className={styles.filterRail}
            data-testid="asset-review-filter-rail"
          >
            <h2>Assets</h2>

            <Field label="Origin">
              <SelectField
                value={filters.origin}
                onChange={(event) => onFilterChange({ origin: event.target.value as AssetFilterState["origin"] })}
              >
                <option value="all">all assets</option>
                <option value="uploaded">uploads</option>
                <option value="generated">generated</option>
              </SelectField>
            </Field>

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
                <option value="all">all providers</option>
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
        ) : null}
        <Panel variant="panel" density="compact" className={styles.content}>
          <header className={styles.contentHeader}>
            <div className={styles.headerCopy}>
              <SectionHeader eyebrow="Review" title="Assets" />
              <p className={styles.contentStatus}>{contentStatus}</p>
            </div>

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
            <div data-testid="asset-review-grid" className={styles.assetGrid}>
              {assets.map((asset) => (
                <article
                  key={asset.id}
                  data-testid={`asset-review-card-${asset.id}`}
                  className={`${styles.assetCard} ${selectedAssetIds.includes(asset.id) ? styles.assetSelected : ""}`}
                  tabIndex={0}
                  data-origin={asset.origin || (asset.jobId ? "generated" : "uploaded")}
                  onDoubleClick={() => {
                    router.push(`/projects/${projectId}/assets/${asset.id}`);
                  }}
                  onClick={() => {
                    setSelectedAssetIds((prev) =>
                      prev.includes(asset.id) ? prev.filter((id) => id !== asset.id) : [...prev, asset.id].slice(-4)
                    );
                  }}
                  onKeyDown={(event) => {
                    if (isEditableEventTarget(event.target)) {
                      return;
                    }

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
                  <div className={styles.assetTopRail}>
                    <span className={styles.assetOriginChip}>{getAssetOriginLabel(asset)}</span>
                    <span className={styles.assetRatingChip}>
                      {asset.rating ? `★ ${asset.rating}` : "Unrated"}
                    </span>
                  </div>
                  <div className={styles.assetInfoRail}>
                    <div className={styles.assetProviderStack}>
                      <span>{asset.job?.providerId || "local"}</span>
                      <span>{asset.job?.modelId || asset.mimeType}</span>
                    </div>
                    <div className={styles.assetInfoStack}>
                      <span>{asset.type}</span>
                      <span>{asset.width && asset.height ? `${asset.width}×${asset.height}` : "ratio unknown"}</span>
                    </div>
                  </div>
                  <AssetCardUtilityRail
                    asset={asset}
                    onRefresh={() => assetsQuery.refetch()}
                  />
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.compareMode}>
              <div
                data-testid="asset-review-compare-stage"
                className={`${styles.compareStage} ${
                  layoutMode === "compare_2" ? styles.compareTwo : styles.compareFour
                }`}
              >
                {compareAssets.map((asset) => (
                  <article key={asset.id} className={styles.compareCell}>
                    <AssetPreview asset={asset} analysis />
                    <div className={styles.compareMetaBar}>
                      <span>{getAssetOriginLabel(asset)}</span>
                      <span>{asset.job?.providerId || "local"}</span>
                      <span>{asset.width && asset.height ? `${asset.width}x${asset.height}` : "unknown dimensions"}</span>
                    </div>
                  </article>
                ))}
                {Array.from({ length: compareMissingCount }).map((_, index) => (
                  <div key={`missing-${index}`} className={styles.comparePlaceholder}>
                    <span className={styles.comparePlaceholderCta}>
                      {`Select ${compareMissingCount - index} more asset${compareMissingCount - index === 1 ? "" : "s"} in Grid`}
                    </span>
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
    if ((!compact && !analysis) || (analysis && compact)) {
      return content;
    }

    return (
      <div className={analysis ? styles.assetPreviewAnalysisFrame : styles.assetPreviewCompactFrame}>
        {content}
      </div>
    );
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

type AssetCardUtilityRailProps = {
  asset: Asset;
  onRefresh: () => void;
};

function AssetCardUtilityRail({ asset, onRefresh }: AssetCardUtilityRailProps) {
  const [hoveredRating, setHoveredRating] = useState<number | null>(null);

  const updateRating = useCallback(
    (rating: number) => {
      updateAsset(asset.id, { rating })
        .then(() => onRefresh())
        .catch(console.error);
    },
    [asset.id, onRefresh]
  );

  const updateFlag = useCallback(() => {
    updateAsset(asset.id, { flagged: !asset.flagged })
      .then(() => onRefresh())
      .catch(console.error);
  }, [asset.flagged, asset.id, onRefresh]);

  return (
    <div className={styles.assetUtilityRail}>
      <div className={styles.assetUtilityRow}>
        <div className={styles.ratingStrip} aria-label={`Rate asset ${asset.id}`}>
          {[1, 2, 3, 4, 5].map((score) => (
            <button
              key={score}
              type="button"
              className={
                isAssetRatingStarActive(score, asset.rating, hoveredRating) ? styles.starOn : styles.starOff
              }
              aria-label={`Rate ${score} star${score === 1 ? "" : "s"}`}
              onPointerEnter={() => setHoveredRating(score)}
              onPointerLeave={() => setHoveredRating(null)}
              onFocus={() => setHoveredRating(score)}
              onBlur={() => setHoveredRating(null)}
              onClick={(event) => {
                event.stopPropagation();
                updateRating(score);
              }}
            >
              ★
            </button>
          ))}
        </div>

        <button
          type="button"
          className={`${styles.flagButton} ${asset.flagged ? styles.flagButtonActive : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            updateFlag();
          }}
        >
          {asset.flagged ? "Flagged" : "Flag"}
        </button>
      </div>

      <TagEditor
        asset={asset}
        onSave={(tags) => {
          updateAsset(asset.id, { tags })
            .then(() => onRefresh())
            .catch(console.error);
        }}
      />
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
      <input
        data-testid={`asset-tag-input-${asset.id}`}
        value={value}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onChange={(event) => setValue(event.target.value)}
        placeholder="tags"
      />
      <button
        type="button"
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
