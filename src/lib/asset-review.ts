import type { Asset, AssetFilterState } from "@/components/workspace/types";

export type AssetReviewLayoutMode = "grid" | "compare_2" | "compare_4";

type EditableTargetLike = {
  tagName?: string | null;
  isContentEditable?: boolean | null;
  parentElement?: EditableTargetLike | null;
  getAttribute?: ((name: string) => string | null) | null;
};

export function shouldShowAssetReviewFilterRail(layoutMode: AssetReviewLayoutMode) {
  return layoutMode === "grid";
}

export function getAssetOriginLabel(asset: Pick<Asset, "origin" | "jobId">) {
  return resolveAssetOrigin(asset) === "generated" ? "Generated" : "Uploaded";
}

export function getAssetOriginFilterOption(origin: AssetFilterState["origin"]) {
  return origin === "all" ? "all" : origin;
}

export function resolveAssetOrigin(asset: Pick<Asset, "origin" | "jobId">): "generated" | "uploaded" {
  if (asset.origin === "generated" || asset.origin === "uploaded") {
    return asset.origin;
  }

  return asset.jobId ? "generated" : "uploaded";
}

export function isAssetRatingStarActive(
  score: number,
  rating: number | null | undefined,
  hoveredRating: number | null | undefined
) {
  const effectiveRating = hoveredRating ?? rating ?? 0;
  return effectiveRating >= score;
}

export function isEditableEventTarget(target: EventTarget | null) {
  return isEditableTargetLike(target as EditableTargetLike | null);
}

function isEditableTargetLike(target: EditableTargetLike | null): boolean {
  if (!target) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = typeof target.tagName === "string" ? target.tagName.toLowerCase() : "";
  if (tagName === "input" || tagName === "textarea" || tagName === "select") {
    return true;
  }

  if (typeof target.getAttribute === "function" && target.getAttribute("contenteditable") === "true") {
    return true;
  }

  return isEditableTargetLike(target.parentElement || null);
}
