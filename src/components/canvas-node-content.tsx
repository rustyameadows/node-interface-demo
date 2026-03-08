"use client";

import { useRef } from "react";
import type { WorkflowNode } from "@/components/workspace/types";
import type { ListNodeSettings } from "@/components/workspace/types";
import type { ProviderId, ProviderModel } from "@/components/workspace/types";
import type { ModelParameterDefinition } from "@/lib/model-parameters";
import type { TextTemplatePreview } from "@/lib/list-template";
import type { CanvasRenderNode } from "@/components/canvas-node-types";
import styles from "@/components/infinite-canvas.module.css";

type SelectOption = {
  value: string;
  label: string;
  description?: string;
  statusLabel?: string;
};

type RunPreview = {
  disabledReason: string | null;
  readyMessage: string | null;
  endpoint: string;
};

export type ActiveCanvasNodeEditorState = {
  nodeId: string;
  selectedNode: WorkflowNode;
  selectedModel?: ProviderModel;
  selectedNodeRunPreview: RunPreview | null;
  selectedNodeResolvedSettings: Record<string, unknown>;
  selectedCoreParameters: ModelParameterDefinition[];
  selectedAdvancedParameters: ModelParameterDefinition[];
  selectedInputNodes: WorkflowNode[];
  selectedPromptSourceNode: WorkflowNode | null;
  selectedListSettings: ListNodeSettings | null;
  selectedTemplatePreview: TextTemplatePreview | null;
  selectedTemplateListNode: WorkflowNode | null;
  selectedNodeSourceJobId: string | null;
  selectedSingleImageAssetId: string | null;
  providerOptions: SelectOption[];
  modelOptions: SelectOption[];
};

type Props = {
  node: CanvasRenderNode;
  activeEditor: ActiveCanvasNodeEditorState | null;
  onSetDisplayMode: (mode: "preview" | "compact") => void;
  onLabelChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onProviderChange: (providerId: ProviderId) => void;
  onModelChange: (modelId: string) => void;
  onParameterChange: (parameterKey: string, value: string | number | null) => void;
  onUpdateListColumnLabel: (columnId: string, label: string) => void;
  onUpdateListCell: (rowId: string, columnId: string, value: string) => void;
  onAddListColumn: () => void;
  onRemoveListColumn: (columnId: string) => void;
  onAddListRow: () => void;
  onRemoveListRow: (rowId: string) => void;
  onClearInputs: () => void;
  onOpenAssetViewer: (assetId: string) => void;
  onDownloadAssets: (assetIds: string[]) => void;
  onOpenQueueInspect: (jobId: string) => void;
  onCommitTextEdits: () => void;
};

function renderSummaryLines(lines: string[]) {
  return lines.filter(Boolean).map((line, index) => (
    <span key={`${line}-${index}`}>{line}</span>
  ));
}

function renderParameterField(
  definition: ModelParameterDefinition,
  value: unknown,
  onChange: (value: string | number | null) => void,
  onBlur: () => void
) {
  if (definition.control === "select") {
    return (
      <select
        className={styles.inlineSelect}
        value={value === null || value === undefined ? "" : String(value)}
        onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
        onBlur={onBlur}
      >
        <option value="">Unset</option>
        {(definition.options || []).map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (definition.control === "number") {
    return (
      <input
        className={styles.inlineNumberInput}
        type="number"
        min={definition.min}
        max={definition.max}
        step={definition.step}
        value={value === null || value === undefined ? "" : String(value)}
        placeholder={definition.placeholder}
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
        onBlur={onBlur}
      />
    );
  }

  if (definition.control === "textarea") {
    return (
      <textarea
        className={styles.inlineTextareaField}
        rows={definition.rows || 4}
        value={value === null || value === undefined ? "" : String(value)}
        placeholder={definition.placeholder}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
    );
  }

  return (
    <input
      className={styles.inlineTextInput}
      type="text"
      value={value === null || value === undefined ? "" : String(value)}
      placeholder={definition.placeholder}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
    />
  );
}

function ModeSwitch({
  showPreviewButton,
  onCompact,
  onPreview,
}: {
  showPreviewButton: boolean;
  onCompact: () => void;
  onPreview: () => void;
}) {
  return (
    <div className={styles.inlineModeSwitch}>
      {showPreviewButton ? (
        <button type="button" onClick={onPreview}>
          Default
        </button>
      ) : null}
      <button type="button" onClick={onCompact}>
        Compact
      </button>
    </div>
  );
}

function PreviewModelNode({ node }: { node: CanvasRenderNode }) {
  const summary = [
    node.displayModelName || node.modelId,
    node.promptSourceNodeId ? "Prompt note connected" : node.prompt.trim() ? node.prompt.trim() : "No prompt",
    node.displaySourceLabel || "No inputs",
  ];

  return (
    <div className={styles.inlineModelPreview}>
      <div className={styles.inlineModelPreviewHeader}>
        <strong>{node.label}</strong>
        <span>{node.outputType}</span>
      </div>
      <div className={styles.inlineSummaryStack}>{renderSummaryLines(summary)}</div>
    </div>
  );
}

function PreviewTextNoteNode({ node }: { node: CanvasRenderNode }) {
  return (
    <div className={styles.inlinePreviewCard}>
      <div className={styles.inlinePreviewHeader}>
        <strong>{node.label}</strong>
      </div>
      <p className={styles.inlinePreviewCopy}>{node.prompt.trim() || "Empty note"}</p>
    </div>
  );
}

function PreviewListNode({ node }: { node: CanvasRenderNode }) {
  return (
    <div className={styles.inlinePreviewCard}>
      <div className={styles.inlinePreviewHeader}>
        <strong>{node.label}</strong>
        <span>{`${node.listColumnCount || 0} × ${node.listRowCount || 0}`}</span>
      </div>
      <div className={styles.inlineListPreviewGrid}>
        {(node.listPreviewColumns || []).slice(0, 3).map((column, index) => (
          <span key={`${node.id}-preview-column-${index}`} className={styles.inlineListPreviewCell}>
            {column}
          </span>
        ))}
        {(node.listPreviewRows || []).slice(0, 2).flatMap((row, rowIndex) =>
          row.slice(0, 3).map((cell, cellIndex) => (
            <span
              key={`${node.id}-preview-cell-${rowIndex}-${cellIndex}`}
              className={styles.inlineListPreviewCellMuted}
            >
              {cell}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function PreviewTemplateNode({ node }: { node: CanvasRenderNode }) {
  return (
    <div className={styles.inlinePreviewCard}>
      <div className={styles.inlinePreviewHeader}>
        <strong>{node.label}</strong>
        <span>{node.templateReady ? "Ready" : "Needs input"}</span>
      </div>
      <div className={styles.inlineTemplateBadges}>
        <span>{`${node.templateRegisteredColumnCount || 0} columns`}</span>
        <span>{`${node.templateUnresolvedCount || 0} unresolved`}</span>
      </div>
      <p className={styles.inlinePreviewCopy}>{node.prompt.trim() || "Empty template"}</p>
    </div>
  );
}

function PreviewAssetNode({ node }: { node: CanvasRenderNode }) {
  return (
    <div className={styles.inlineAssetPreviewMeta}>
      <strong>{node.label}</strong>
      <span>{node.displaySourceLabel || node.displayModelName || node.outputType}</span>
    </div>
  );
}

function CompactNode({ node }: { node: CanvasRenderNode }) {
  return (
    <div className={styles.inlineCompactNode}>
      <strong>{node.label}</strong>
      <span>{node.kind === "model" ? node.displayModelName || node.modelId : node.kind}</span>
    </div>
  );
}

export function CanvasNodeContent({
  node,
  activeEditor,
  onSetDisplayMode,
  onLabelChange,
  onPromptChange,
  onProviderChange,
  onModelChange,
  onParameterChange,
  onUpdateListColumnLabel,
  onUpdateListCell,
  onAddListColumn,
  onRemoveListColumn,
  onAddListRow,
  onRemoveListRow,
  onClearInputs,
  onOpenAssetViewer,
  onDownloadAssets,
  onOpenQueueInspect,
  onCommitTextEdits,
}: Props) {
  const isActive = activeEditor?.nodeId === node.id;
  const templateTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const showPreviewButton = node.displayMode !== "preview";

  const insertTemplateToken = (label: string) => {
    if (!templateTextareaRef.current || !activeEditor) {
      onPromptChange(`${activeEditor?.selectedNode.prompt || ""}[[${label}]]`);
      return;
    }

    const textarea = templateTextareaRef.current;
    const value = activeEditor.selectedNode.prompt;
    const start = textarea.selectionStart ?? value.length;
    const end = textarea.selectionEnd ?? value.length;
    const token = `[[${label}]]`;
    onPromptChange(`${value.slice(0, start)}${token}${value.slice(end)}`);
  };

  if (node.renderMode === "compact") {
    return <CompactNode node={node} />;
  }

  if (!isActive || node.renderMode === "preview") {
    if (node.kind === "model") {
      return <PreviewModelNode node={node} />;
    }
    if (node.kind === "text-note") {
      return <PreviewTextNoteNode node={node} />;
    }
    if (node.kind === "list") {
      return <PreviewListNode node={node} />;
    }
    if (node.kind === "text-template") {
      return <PreviewTemplateNode node={node} />;
    }
    return <PreviewAssetNode node={node} />;
  }

  if (!activeEditor) {
    return null;
  }

  const sharedHeader = (
    <header className={styles.inlineNodeHeader} data-node-drag-handle="true">
      <div className={styles.inlineNodeHeaderMeta}>
        <input
          className={styles.inlineNodeTitleInput}
          value={activeEditor.selectedNode.label}
          onChange={(event) => onLabelChange(event.target.value)}
          onBlur={onCommitTextEdits}
        />
        <span>{node.kind === "model" ? activeEditor.selectedModel?.displayName || node.modelId : node.kind}</span>
      </div>
      <ModeSwitch
        showPreviewButton={showPreviewButton}
        onCompact={() => onSetDisplayMode("compact")}
        onPreview={() => onSetDisplayMode("preview")}
      />
    </header>
  );

  if (node.kind === "text-note") {
    return (
      <div className={styles.inlineNodeSurface}>
        {sharedHeader}
        <textarea
          className={styles.inlineNoteEditor}
          value={activeEditor.selectedNode.prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          onBlur={onCommitTextEdits}
          placeholder="Write note text"
        />
      </div>
    );
  }

  if (node.kind === "list" && activeEditor.selectedListSettings) {
    return (
      <div className={styles.inlineNodeSurface}>
        {sharedHeader}
        <div className={styles.inlineListEditorToolbar}>
          <button type="button" onClick={onAddListColumn}>
            Add column
          </button>
          <button type="button" onClick={onAddListRow}>
            Add row
          </button>
        </div>
        <div className={styles.inlineListEditor}>
          <div className={styles.inlineListEditorGrid}>
            {activeEditor.selectedListSettings.columns.map((column) => (
              <div key={column.id} className={styles.inlineListColumn}>
                <input
                  className={styles.inlineTextInput}
                  value={column.label}
                  onChange={(event) => onUpdateListColumnLabel(column.id, event.target.value)}
                  onBlur={onCommitTextEdits}
                  placeholder="Column name"
                />
                <button type="button" onClick={() => onRemoveListColumn(column.id)}>
                  Remove
                </button>
              </div>
            ))}
            {activeEditor.selectedListSettings.rows.map((row, rowIndex) => (
              <div key={row.id} className={styles.inlineListRow}>
                <span className={styles.inlineListRowLabel}>{`Row ${rowIndex + 1}`}</span>
                {activeEditor.selectedListSettings.columns.map((column) => (
                  <input
                    key={`${row.id}-${column.id}`}
                    className={styles.inlineTextInput}
                    value={row.values[column.id] || ""}
                    onChange={(event) => onUpdateListCell(row.id, column.id, event.target.value)}
                    onBlur={onCommitTextEdits}
                  />
                ))}
                <button type="button" onClick={() => onRemoveListRow(row.id)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (node.kind === "text-template") {
    const availableColumns = activeEditor.selectedTemplateListNode
      ? activeEditor.selectedTemplatePreview?.columns || []
      : [];
    const variableChips =
      availableColumns.length > 0
        ? availableColumns.map((column) => ({
            key: column.id,
            label: column.label,
          }))
        : (activeEditor.selectedTemplatePreview?.tokens || []).map((token) => ({
            key: token.key,
            label: token.label,
          }));

    return (
      <div className={styles.inlineNodeSurface}>
        {sharedHeader}
        <div className={styles.inlineTemplateLayout}>
          <div className={styles.inlineTemplateEditorColumn}>
            <textarea
              ref={templateTextareaRef}
              className={styles.inlineTemplateEditor}
              value={activeEditor.selectedNode.prompt}
              onChange={(event) => onPromptChange(event.target.value)}
              onBlur={onCommitTextEdits}
              placeholder="Write template with [[variables]]"
            />
            <div className={styles.inlineVariableShelf}>
              {variableChips.map((token) => (
                <button
                  key={token.key}
                  type="button"
                  className={styles.inlineVariableChip}
                  onClick={() => insertTemplateToken(token.label)}
                >
                  {`[[${token.label}]]`}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.inlineTemplatePreviewColumn}>
            <div className={styles.inlineTemplateStatusCard}>
              <strong>Compatibility</strong>
              <span>{activeEditor.selectedTemplatePreview?.disabledReason || activeEditor.selectedTemplatePreview?.readyMessage || "Ready"}</span>
            </div>
            <div className={styles.inlineTemplateStatusCard}>
              <strong>Merge preview</strong>
              {(activeEditor.selectedTemplatePreview?.rows || []).slice(0, 4).map((row) => (
                <span key={row.rowId}>{row.text}</span>
              ))}
              {!activeEditor.selectedTemplatePreview?.rows.length ? <span>No preview rows yet.</span> : null}
              <span>{`${activeEditor.selectedTemplatePreview?.nonBlankRowCount || 0} total rows`}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (node.kind === "model") {
    return (
      <div className={styles.inlineNodeSurface}>
        {sharedHeader}
        <div className={styles.inlineModelFullLayout}>
          <section className={styles.inlineModelSection}>
            <span className={styles.inlineSectionLabel}>Inputs</span>
            <div className={styles.inlineSummaryStack}>
              {activeEditor.selectedInputNodes.length > 0
                ? activeEditor.selectedInputNodes.map((inputNode) => <span key={inputNode.id}>{inputNode.label}</span>)
                : <span>No connected inputs</span>}
              {activeEditor.selectedPromptSourceNode ? (
                <span>{`Prompt source: ${activeEditor.selectedPromptSourceNode.label}`}</span>
              ) : null}
            </div>
            <button type="button" onClick={onClearInputs}>
              Clear inputs
            </button>
          </section>
          <section className={styles.inlineModelSection}>
            <span className={styles.inlineSectionLabel}>Prompt</span>
            <textarea
              className={styles.inlinePromptEditor}
              value={activeEditor.selectedNode.prompt}
              onChange={(event) => onPromptChange(event.target.value)}
              onBlur={onCommitTextEdits}
              placeholder="Describe what to generate"
            />
          </section>
          <section className={styles.inlineModelSectionWide}>
            <div className={styles.inlineSelectRow}>
              <label className={styles.inlineFieldLabel}>
                Provider
                <select
                  className={styles.inlineSelect}
                  value={activeEditor.selectedNode.providerId}
                  onChange={(event) => onProviderChange(event.target.value as ProviderId)}
                >
                  {activeEditor.providerOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.inlineFieldLabel}>
                Model
                <select
                  className={styles.inlineSelect}
                  value={activeEditor.selectedNode.modelId}
                  onChange={(event) => onModelChange(event.target.value)}
                >
                  {activeEditor.modelOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className={styles.inlineParameterGrid}>
              {[...activeEditor.selectedCoreParameters, ...activeEditor.selectedAdvancedParameters].map((parameter) => (
                <label key={parameter.key} className={styles.inlineFieldLabel}>
                  {parameter.label}
                  {renderParameterField(
                    parameter,
                    activeEditor.selectedNodeResolvedSettings[parameter.key],
                    (value) => onParameterChange(parameter.key, value),
                    onCommitTextEdits
                  )}
                </label>
              ))}
            </div>
          </section>
          <section className={styles.inlineModelSection}>
            <span className={styles.inlineSectionLabel}>Output</span>
            <div className={styles.inlineSummaryStack}>
              <span>{activeEditor.selectedNodeRunPreview?.readyMessage || activeEditor.selectedNodeRunPreview?.disabledReason || "Not ready"}</span>
              <span>{activeEditor.selectedNodeRunPreview?.endpoint || "No endpoint"}</span>
              <span>{`Target: ${node.outputType}`}</span>
            </div>
          </section>
        </div>
      </div>
    );
  }

  if (node.kind === "asset-source") {
    return (
      <div className={styles.inlineNodeSurface}>
        {sharedHeader}
        <div className={styles.inlineAssetActions}>
          {activeEditor.selectedSingleImageAssetId ? (
            <button type="button" onClick={() => onOpenAssetViewer(activeEditor.selectedSingleImageAssetId!)}>
              Open asset
            </button>
          ) : null}
          {activeEditor.selectedSingleImageAssetId ? (
            <button type="button" onClick={() => onDownloadAssets([activeEditor.selectedSingleImageAssetId!])}>
              Download
            </button>
          ) : null}
          {activeEditor.selectedNodeSourceJobId ? (
            <button type="button" onClick={() => onOpenQueueInspect(activeEditor.selectedNodeSourceJobId!)}>
              Inspect source
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return null;
}
