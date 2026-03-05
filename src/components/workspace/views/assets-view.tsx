"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import {
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
import styles from "./assets-view.module.css";

type Props = {
  projectId: string;
};

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
  const [assets, setAssets] = useState<Asset[]>([]);
  const [layoutMode, setLayoutMode] = useState<"grid" | "compare_2" | "compare_4">("grid");
  const [filters, setFilters] = useState<AssetFilterState>(defaultFilterState);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [canvasDocument, setCanvasDocument] = useState<CanvasDocument>(defaultCanvasDocument);
  const [isLoading, setIsLoading] = useState(true);

  const filtersRef = useRef<AssetFilterState>(defaultFilterState);

  const activeAssets = useMemo(() => {
    return assets.filter((asset) => selectedAssetIds.includes(asset.id));
  }, [assets, selectedAssetIds]);

  const refreshAssets = useCallback(async (nextFilters: AssetFilterState) => {
    const nextAssets = await getAssets(projectId, nextFilters);
    setAssets(nextAssets);
  }, [projectId]);

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
    setIsLoading(true);

    getCanvasWorkspace(projectId)
      .then(async (data) => {
        setCanvasDocument(normalizeCanvasDocument((data.canvas?.canvasDocument || null) as Record<string, unknown> | null));

        const nextLayout = data.workspace?.assetViewerLayout || "grid";
        const nextFilters = mergeFilters(data.workspace?.filterState || null, defaultFilterState);
        filtersRef.current = nextFilters;

        setLayoutMode(nextLayout);
        setFilters(nextFilters);

        await Promise.all([refreshAssets(nextFilters), openProject(projectId)]);
      })
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [projectId, refreshAssets]);

  const onFilterChange = useCallback(
    (patch: Partial<AssetFilterState>) => {
      const next = { ...filtersRef.current, ...patch };
      filtersRef.current = next;
      setFilters(next);

      refreshAssets(next).catch(console.error);
      persistWorkspace(layoutMode, next).catch(console.error);
    },
    [layoutMode, persistWorkspace, refreshAssets]
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
      <div className={styles.page}>
        <aside className={styles.filterRail}>
          <h2>Assets</h2>

          <label>
            Type
            <select
              value={filters.type}
              onChange={(event) => onFilterChange({ type: event.target.value as AssetFilterState["type"] })}
            >
              <option value="all">all types</option>
              <option value="image">image</option>
              <option value="video">video</option>
              <option value="text">text</option>
            </select>
          </label>

          <label>
            Rating
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
          </label>

          <label>
            Provider
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
          </label>

          <label>
            Sort
            <select
              value={filters.sort}
              onChange={(event) => onFilterChange({ sort: event.target.value as AssetFilterState["sort"] })}
            >
              <option value="newest">newest</option>
              <option value="oldest">oldest</option>
              <option value="rating">rating</option>
            </select>
          </label>

          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={filters.flaggedOnly}
              onChange={(event) => onFilterChange({ flaggedOnly: event.target.checked })}
            />
            flagged only
          </label>

          <label>
            Tag
            <input
              value={filters.tag}
              onChange={(event) => onFilterChange({ tag: event.target.value })}
              placeholder="tag filter"
            />
          </label>
        </aside>

        <section className={styles.content}>
          <header className={styles.contentHeader}>
            <div className={styles.modeButtons}>
              <button onClick={() => changeLayoutMode("grid")} className={layoutMode === "grid" ? styles.modeOn : ""}>Grid</button>
              <button onClick={() => changeLayoutMode("compare_2")} className={layoutMode === "compare_2" ? styles.modeOn : ""}>2-up</button>
              <button onClick={() => changeLayoutMode("compare_4")} className={layoutMode === "compare_4" ? styles.modeOn : ""}>4-up</button>
            </div>
          </header>

          {isLoading ? (
            <div className={styles.loading}>Loading assets...</div>
          ) : layoutMode === "grid" ? (
            <div className={styles.assetGrid}>
              {assets.map((asset) => (
                <article
                  key={asset.id}
                  className={`${styles.assetCard} ${selectedAssetIds.includes(asset.id) ? styles.assetSelected : ""}`}
                  tabIndex={0}
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
                  }}
                >
                  <AssetPreview asset={asset} compact />

                  <div
                    className={styles.assetHoverPanel}
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
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
                              .then(() => refreshAssets(filtersRef.current))
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
                            .then(() => refreshAssets(filtersRef.current))
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
                          .then(() => refreshAssets(filtersRef.current))
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
      </div>
    </WorkspaceShell>
  );
}

type AssetPreviewProps = {
  asset: Asset;
  compact?: boolean;
};

function AssetPreview({ asset, compact = false }: AssetPreviewProps) {
  const className = compact ? styles.assetPreviewImageCompact : styles.assetPreviewImage;
  const frameClassName = compact ? styles.assetPreviewFrameCompact : styles.assetPreviewFrame;

  if (asset.type === "image") {
    return (
      <img
        className={className}
        src={`/api/assets/${asset.id}/file`}
        alt={`Generated asset ${asset.id}`}
      />
    );
  }

  if (asset.type === "text") {
    return (
      <iframe
        className={frameClassName}
        src={`/api/assets/${asset.id}/file`}
        title={`Asset ${asset.id}`}
      />
    );
  }

  return (
    <div className={compact ? styles.videoPlaceholderCompact : styles.videoPlaceholder}>
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
