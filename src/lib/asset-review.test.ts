import assert from "node:assert/strict";
import test from "node:test";
import { defaultFilterState, type Asset } from "@/components/workspace/types";
import {
  getAssetOriginFilterOption,
  getAssetOriginLabel,
  isAssetRatingStarActive,
  isEditableEventTarget,
  shouldShowAssetReviewFilterRail,
} from "@/lib/asset-review";
import { assetMatchesFilters } from "@/lib/services/assets";

function createAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "asset-1",
    type: "image",
    storageRef: "project/asset.png",
    mimeType: "image/png",
    origin: "uploaded",
    createdAt: "2026-03-10T00:00:00.000Z",
    updatedAt: "2026-03-10T00:00:00.000Z",
    tagNames: [],
    rating: null,
    flagged: false,
    job: null,
    ...overrides,
  };
}

test("asset review helpers expose the active filter rail and origin labels", () => {
  assert.equal(shouldShowAssetReviewFilterRail("grid"), true);
  assert.equal(shouldShowAssetReviewFilterRail("compare_2"), false);
  assert.equal(getAssetOriginFilterOption("all"), "all");
  assert.equal(getAssetOriginFilterOption("generated"), "generated");
  assert.equal(getAssetOriginLabel(createAsset({ origin: "generated" })), "Generated");
  assert.equal(getAssetOriginLabel(createAsset({ origin: undefined, jobId: null })), "Uploaded");
  assert.equal(getAssetOriginLabel(createAsset({ origin: undefined, jobId: "job-1" })), "Generated");
});

test("rating hover preview uses the hovered score before the committed score", () => {
  assert.equal(isAssetRatingStarActive(4, 2, 4), true);
  assert.equal(isAssetRatingStarActive(5, 2, 4), false);
  assert.equal(isAssetRatingStarActive(3, 3, null), true);
  assert.equal(isAssetRatingStarActive(4, 3, null), false);
});

test("editable target detection suppresses asset shortcuts inside text inputs", () => {
  const nestedInput = {
    tagName: "SPAN",
    parentElement: {
      tagName: "INPUT",
      parentElement: null,
    },
  };
  const editableRegion = {
    tagName: "DIV",
    isContentEditable: true,
    parentElement: null,
  };
  const plainTarget = {
    tagName: "DIV",
    parentElement: null,
  };

  assert.equal(isEditableEventTarget(nestedInput as EventTarget), true);
  assert.equal(isEditableEventTarget(editableRegion as EventTarget), true);
  assert.equal(isEditableEventTarget(plainTarget as EventTarget), false);
});

test("asset filter matching honors origin options and provider scoping", () => {
  const uploaded = createAsset({
    id: "uploaded",
    origin: "uploaded",
    jobId: null,
    job: null,
  });
  const generated = createAsset({
    id: "generated",
    origin: "generated",
    jobId: "job-1",
    job: {
      providerId: "google-gemini",
      modelId: "gemini-3.1-flash-image-preview",
      state: "succeeded",
    },
  });

  assert.equal(assetMatchesFilters(uploaded, defaultFilterState, { origin: "uploaded" }), true);
  assert.equal(assetMatchesFilters(uploaded, defaultFilterState, { origin: "generated" }), false);
  assert.equal(assetMatchesFilters(generated, defaultFilterState, { origin: "generated" }), true);
  assert.equal(
    assetMatchesFilters(generated, { ...defaultFilterState, providerId: "google-gemini" }),
    true
  );
  assert.equal(
    assetMatchesFilters(uploaded, { ...defaultFilterState, providerId: "google-gemini" }),
    false
  );
});
