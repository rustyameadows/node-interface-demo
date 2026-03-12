"use client";

import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { CanvasNodeContent } from "@/components/canvas-nodes";
import type { CanvasRenderNode } from "@/components/canvas-node-types";
import styles from "./node-library-specimen.module.css";
import canvasStyles from "@/components/infinite-canvas.module.css";
import nodeStyles from "@/components/canvas-nodes/canvas-node.module.css";
import { getAssetFileUrl } from "@/components/workspace/client-api";
import type { ProviderModel } from "@/components/workspace/types";
import { buildNodeCatalogCanvasRenderNodes } from "@/lib/node-catalog-render";
import type { NodePlaygroundFixture } from "@/lib/node-catalog";
import {
  shouldCanvasNodeMeasureContentHeight,
} from "@/lib/canvas-node-presentation";
import { getUploadedAssetNodeAspectRatio } from "@/lib/canvas-asset-nodes";

type Props = {
  fixture: NodePlaygroundFixture;
  providerModels: ProviderModel[];
};

const STAGE_PADDING = 20;
const MAX_SPECIMEN_SCALE = 1.32;
const MIN_SPECIMEN_SCALE = 0.35;
const NOOP = () => {};
const NOOP_ADD_LIST_ROW = () => null;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isGeneratedTextNoteNode(node: CanvasRenderNode) {
  return (
    node.kind === "text-note" &&
    (node.settings.source === "generated-model-text" || node.settings.source === "template-output")
  );
}

function isGeneratedAssetNode(node: CanvasRenderNode) {
  return node.kind === "asset-source" && node.assetOrigin === "generated";
}

function getStaticNodeClassName(node: CanvasRenderNode) {
  const classes = [canvasStyles.node];
  const isTextNote = node.kind === "text-note";
  const isListNode = node.kind === "list";
  const isTextTemplateNode = node.kind === "text-template";
  const isModelNode = node.kind === "model";
  const isOperatorNode = node.kind === "text-template";
  const isGeneratedAsset = isGeneratedAssetNode(node);
  const isGeneratedTextNote = isGeneratedTextNoteNode(node);
  const isUploadedAsset = node.kind === "asset-source" && node.assetOrigin === "uploaded";
  const shouldRenderImageFrame = node.kind === "asset-source" && node.outputType === "image";

  if (shouldRenderImageFrame) {
    classes.push(nodeStyles.nodeWithImage);
  }
  if (isGeneratedAsset) {
    classes.push(nodeStyles.nodeGeneratedAsset);
  }
  if (isUploadedAsset) {
    classes.push(nodeStyles.nodeUploadedAsset);
  }
  if (isTextNote) {
    classes.push(nodeStyles.nodeTextNote);
  }
  if (isTextNote && !isGeneratedTextNote) {
    classes.push(nodeStyles.nodeSemanticFrame);
  }
  if (isGeneratedTextNote) {
    classes.push(nodeStyles.nodeGeneratedTextNote);
  }
  if (isListNode) {
    classes.push(nodeStyles.nodeList, nodeStyles.nodeSemanticFrame);
  }
  if (isTextTemplateNode) {
    classes.push(nodeStyles.nodeTextTemplate);
  }
  if (isModelNode || isOperatorNode) {
    classes.push(nodeStyles.nodeModel);
  }
  if (node.renderMode === "compact") {
    classes.push(nodeStyles.nodeCompactMode);
  }
  if (node.renderMode === "full") {
    classes.push(nodeStyles.nodeFullMode);
  }
  if (node.renderMode === "resized") {
    classes.push(nodeStyles.nodeResizedMode);
  }

  return classes.join(" ");
}

function getStaticNodeStyle(node: CanvasRenderNode): CSSProperties {
  const autoHeight = shouldCanvasNodeMeasureContentHeight({
    kind: node.kind,
    renderMode: node.renderMode,
  });

  return {
    left: 0,
    top: 0,
    width: `${node.resolvedSize.width}px`,
    height: autoHeight ? undefined : `${node.resolvedSize.height}px`,
    zIndex: 1,
    transition: "none",
    cursor: "default",
  };
}

export function NodeLibrarySpecimen({ fixture, providerModels }: Props) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });

  const renderNodes = useMemo(
    () =>
      buildNodeCatalogCanvasRenderNodes({
        nodes: fixture.nodes,
        providerModels,
      }),
    [fixture.nodes, providerModels]
  );
  const primaryNode = useMemo(
    () => renderNodes.find((node) => node.id === fixture.primaryNodeId) || null,
    [fixture.primaryNodeId, renderNodes]
  );

  useLayoutEffect(() => {
    const element = stageRef.current;
    if (!element) {
      return;
    }

    const update = () => {
      setStageSize({
        width: element.offsetWidth,
        height: element.offsetHeight,
      });
    };

    update();

    const observer = new ResizeObserver(() => {
      update();
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  const scale = useMemo(() => {
    if (!primaryNode || stageSize.width <= 0 || stageSize.height <= 0) {
      return 1;
    }

    const availableWidth = Math.max(1, stageSize.width - STAGE_PADDING * 2);
    const availableHeight = Math.max(1, stageSize.height - STAGE_PADDING * 2);
    const fittedScale = Math.min(
      availableWidth / Math.max(1, primaryNode.resolvedSize.width),
      availableHeight / Math.max(1, primaryNode.resolvedSize.height)
    );

    return clamp(fittedScale, MIN_SPECIMEN_SCALE, MAX_SPECIMEN_SCALE);
  }, [primaryNode, stageSize.height, stageSize.width]);

  const imageSourceUrl =
    primaryNode?.kind === "asset-source" && primaryNode.outputType === "image"
      ? primaryNode.sourceAssetId
        ? getAssetFileUrl(primaryNode.sourceAssetId)
        : primaryNode.previewImageUrl || null
      : null;
  const imageAspectRatio =
    primaryNode && primaryNode.kind === "asset-source" && primaryNode.outputType === "image"
      ? getUploadedAssetNodeAspectRatio(primaryNode) || 960 / 720
      : 1;

  return (
    <div ref={stageRef} className={styles.stage} aria-hidden="true">
      <div className={styles.viewport}>
        {primaryNode ? (
          <div
            className={styles.nodeWrap}
            style={{
              width: `${primaryNode.resolvedSize.width}px`,
              height: `${primaryNode.resolvedSize.height}px`,
              transform: `scale(${scale})`,
            }}
          >
            <div className={getStaticNodeClassName(primaryNode)} style={getStaticNodeStyle(primaryNode)}>
              {primaryNode.kind === "asset-source" && primaryNode.outputType === "image" ? (
                <div className={nodeStyles.assetNodeLayout}>
                  <div
                    className={`${nodeStyles.sourcePreviewFrame} ${
                      primaryNode.assetOrigin === "generated"
                        ? nodeStyles.sourcePreviewFrameGenerated
                        : nodeStyles.sourcePreviewFrameUploaded
                    } ${!imageSourceUrl ? nodeStyles.sourcePreviewFramePlaceholder : ""}`}
                    style={{
                      aspectRatio: String(imageAspectRatio),
                    }}
                  >
                    {imageSourceUrl ? (
                      <img
                        className={nodeStyles.sourcePreviewImage}
                        src={imageSourceUrl}
                        alt=""
                        draggable={false}
                      />
                    ) : (
                      <div className={nodeStyles.imagePlaceholderSurface} />
                    )}
                  </div>
                  <CanvasNodeContent
                    node={primaryNode}
                    activeEditor={null}
                    onSetDisplayMode={NOOP}
                    onEnterEditMode={NOOP}
                    onExitEditMode={NOOP}
                    onRunNode={NOOP}
                    onLabelChange={NOOP}
                    onPromptChange={NOOP}
                    onModelVariantChange={NOOP}
                    onParameterChange={NOOP}
                    onUpdateListColumnLabel={NOOP}
                    onUpdateListCell={NOOP}
                    onAddListColumn={NOOP}
                    onRemoveListColumn={NOOP}
                    onAddListRow={NOOP_ADD_LIST_ROW}
                    onRemoveListRow={NOOP}
                    onClearInputs={NOOP}
                    onDuplicateNode={NOOP}
                    onOpenAssetViewer={NOOP}
                    onDownloadAssets={NOOP}
                    onOpenQueueInspect={NOOP}
                    onCommitTextEdits={NOOP}
                  />
                </div>
              ) : (
                <CanvasNodeContent
                  node={primaryNode}
                  activeEditor={null}
                  onSetDisplayMode={NOOP}
                  onEnterEditMode={NOOP}
                  onExitEditMode={NOOP}
                  onRunNode={NOOP}
                  onLabelChange={NOOP}
                  onPromptChange={NOOP}
                  onModelVariantChange={NOOP}
                  onParameterChange={NOOP}
                  onUpdateListColumnLabel={NOOP}
                  onUpdateListCell={NOOP}
                  onAddListColumn={NOOP}
                  onRemoveListColumn={NOOP}
                  onAddListRow={NOOP_ADD_LIST_ROW}
                  onRemoveListRow={NOOP}
                  onClearInputs={NOOP}
                  onDuplicateNode={NOOP}
                  onOpenAssetViewer={NOOP}
                  onDownloadAssets={NOOP}
                  onOpenQueueInspect={NOOP}
                  onCommitTextEdits={NOOP}
                />
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
