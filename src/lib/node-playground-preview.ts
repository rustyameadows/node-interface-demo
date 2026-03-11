import type { WorkflowNode } from "@/components/workspace/types";

const PLAYGROUND_IMAGE_PLACEHOLDER_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 720" fill="none">
  <defs>
    <pattern id="checker" width="96" height="96" patternUnits="userSpaceOnUse">
      <rect width="96" height="96" fill="rgba(255,255,255,0.03)"/>
      <rect width="48" height="48" fill="rgba(255,255,255,0.08)"/>
      <rect x="48" y="48" width="48" height="48" fill="rgba(255,255,255,0.08)"/>
    </pattern>
    <linearGradient id="wash" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="rgba(255,255,255,0.12)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0.02)"/>
    </linearGradient>
  </defs>
  <rect width="960" height="720" fill="url(#checker)"/>
  <rect x="48" y="48" width="864" height="624" rx="36" fill="url(#wash)" stroke="rgba(255,255,255,0.18)" stroke-width="2"/>
</svg>`.trim();

const PLAYGROUND_IMAGE_PLACEHOLDER_URL = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
  PLAYGROUND_IMAGE_PLACEHOLDER_SVG
)}`;

export function getNodePlaygroundPreviewImageUrl(
  node: Pick<WorkflowNode, "kind" | "outputType" | "sourceAssetId">
) {
  if (node.kind !== "asset-source" || node.outputType !== "image" || node.sourceAssetId) {
    return null;
  }

  return PLAYGROUND_IMAGE_PLACEHOLDER_URL;
}

