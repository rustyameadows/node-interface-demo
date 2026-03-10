"use client";

import { useEffect, useMemo, useRef } from "react";
import { Badge, Button, Panel, Textarea } from "@/components/ui";
import { SearchableModelSelect } from "@/components/searchable-model-select";
import type { CanvasCopilotMessage } from "@/lib/canvas-copilot";
import { formatModelVariantLabel, type NodeCatalogVariant } from "@/lib/node-catalog";
import styles from "./canvas-copilot-widget.module.css";

type Props = {
  open: boolean;
  modelVariantId: string | null;
  modelOptions: NodeCatalogVariant[];
  draft: string;
  messages: CanvasCopilotMessage[];
  isRunning: boolean;
  disabledReason: string | null;
  readyMessage: string | null;
  onOpenChange: (open: boolean) => void;
  onModelVariantChange: (variantId: string) => void;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
};

export function CanvasCopilotWidget({
  open,
  modelVariantId,
  modelOptions,
  draft,
  messages,
  isRunning,
  disabledReason,
  readyMessage,
  onOpenChange,
  onModelVariantChange,
  onDraftChange,
  onSubmit,
}: Props) {
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const selectedVariant = useMemo(
    () => modelOptions.find((option) => option.id === modelVariantId) || modelOptions[0] || null,
    [modelOptions, modelVariantId]
  );
  const statusTone = disabledReason ? "blocked" : readyMessage ? "ready" : "neutral";

  useEffect(() => {
    if (!open) {
      return;
    }

    const timer = window.setTimeout(() => {
      composerRef.current?.focus();
    }, 24);

    return () => {
      window.clearTimeout(timer);
    };
  }, [open]);

  useEffect(() => {
    if (!transcriptRef.current) {
      return;
    }

    transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [messages, open]);

  if (!open) {
    return (
      <button
        type="button"
        className={styles.pill}
        onFocus={() => onOpenChange(true)}
        onClick={() => onOpenChange(true)}
      >
        <span className={styles.pillLabel}>Copilot</span>
        <span className={styles.pillModel}>{selectedVariant ? formatModelVariantLabel(selectedVariant) : "No text model"}</span>
      </button>
    );
  }

  return (
    <Panel
      as="aside"
      surface="canvas-overlay"
      density="compact"
      variant="elevated"
      className={styles.panel}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onOpenChange(false);
        }
      }}
    >
      <div className={styles.header}>
        <div className={styles.headerCopy}>
          <span className={styles.eyebrow}>Canvas Copilot</span>
          <strong>Generate notes, lists, and templates</strong>
        </div>
        <div className={styles.headerActions}>
          {isRunning ? <Badge surface="canvas-overlay" density="compact" variant="accent">Running</Badge> : null}
          <Button
            surface="canvas-overlay"
            density="compact"
            variant="ghost"
            size="sm"
            className={styles.collapseButton}
            onClick={() => onOpenChange(false)}
          >
            Minimize
          </Button>
        </div>
      </div>

      <div className={styles.modelRow}>
        <SearchableModelSelect
          surface="canvas-overlay"
          density="compact"
          value={selectedVariant?.id || null}
          options={modelOptions}
          disabled={modelOptions.length === 0 || isRunning}
          onChange={(variant) => {
            onModelVariantChange(variant.id);
          }}
        />
      </div>

      <div
        className={`${styles.statusNotice} ${
          statusTone === "blocked"
            ? styles.statusNoticeBlocked
            : statusTone === "ready"
              ? styles.statusNoticeReady
              : styles.statusNoticeNeutral
        }`}
      >
        <strong className={styles.statusTitle}>
          {disabledReason ? "Not runnable yet" : readyMessage ? "Ready to run" : "Choose a text model"}
        </strong>
        <span className={styles.statusText}>
          {disabledReason ||
            readyMessage ||
            "Pick a text-capable model to generate notes, lists, and templates onto the canvas."}
        </span>
      </div>

      <div ref={transcriptRef} className={styles.transcript}>
        {messages.length === 0 ? (
          <div className={styles.emptyState}>
            <strong>Start with a prompt.</strong>
            <span>Ask for a note, a list, a template, or a small structured set of nodes to drop onto the canvas.</span>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`${styles.message} ${message.role === "user" ? styles.messageUser : styles.messageSystem}`}
            >
              <span className={styles.messageMeta}>{message.role === "user" ? "You" : "Copilot"}</span>
              <div
                className={`${styles.messageBody} ${
                  message.state === "error"
                    ? styles.messageError
                    : message.state === "success"
                      ? styles.messageSuccess
                      : message.state === "pending"
                        ? styles.messagePending
                        : ""
                }`}
              >
                {message.text}
              </div>
            </div>
          ))
        )}
      </div>

      <div className={styles.composer}>
        <Textarea
          ref={composerRef}
          surface="canvas-overlay"
          density="compact"
          className={styles.input}
          rows={5}
          value={draft}
          disabled={isRunning}
          placeholder="Describe the nodes you want on the canvas..."
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
        <div className={styles.composerFooter}>
          <span className={styles.composerHint}>
            {disabledReason ? "You can still type here. Fix the model requirement above, then send." : readyMessage || "Shift+Enter for a newline."}
          </span>
          <Button
            surface="canvas-overlay"
            density="compact"
            variant="accent"
            size="sm"
            disabled={isRunning || Boolean(disabledReason) || draft.trim().length === 0}
            onClick={onSubmit}
          >
            Send
          </Button>
        </div>
      </div>
    </Panel>
  );
}
