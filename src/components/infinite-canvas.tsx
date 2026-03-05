"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import styles from "./infinite-canvas.module.css";

type CanvasViewport = {
  x: number;
  y: number;
  zoom: number;
};

type CanvasNode = {
  id: string;
  label: string;
  providerId: "openai" | "google-gemini" | "topaz";
  outputType: "image" | "video" | "text";
  x: number;
  y: number;
};

type Props = {
  nodes: CanvasNode[];
  selectedNodeId: string | null;
  viewport: CanvasViewport;
  onSelectNode: (nodeId: string | null) => void;
  onDropNode: (position: { x: number; y: number }) => void;
  onViewportChange: (viewport: CanvasViewport) => void;
  onNodePositionChange: (nodeId: string, position: { x: number; y: number }) => void;
  latestNodeStates: Record<string, string>;
};

type InteractionState =
  | {
      type: "idle";
    }
  | {
      type: "pan";
      startClientX: number;
      startClientY: number;
      startViewport: CanvasViewport;
    }
  | {
      type: "drag";
      nodeId: string;
      pointerOffsetX: number;
      pointerOffsetY: number;
    };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function InfiniteCanvas({
  nodes,
  selectedNodeId,
  viewport,
  onSelectNode,
  onDropNode,
  onViewportChange,
  onNodePositionChange,
  latestNodeStates,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<CanvasViewport>(viewport);
  const viewRef = useRef<CanvasViewport>(viewport);
  const interactionRef = useRef<InteractionState>({ type: "idle" });
  const viewportTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setView(viewport);
    viewRef.current = viewport;
  }, [viewport]);

  const toWorldPoint = useCallback((clientX: number, clientY: number, targetView = viewRef.current) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }

    return {
      x: (clientX - rect.left - targetView.x) / targetView.zoom,
      y: (clientY - rect.top - targetView.y) / targetView.zoom,
    };
  }, []);

  const scheduleViewportCommit = useCallback((next: CanvasViewport) => {
    if (viewportTimer.current) {
      clearTimeout(viewportTimer.current);
    }

    viewportTimer.current = setTimeout(() => {
      onViewportChange(next);
    }, 280);
  }, [onViewportChange]);

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      const interaction = interactionRef.current;
      if (interaction.type === "idle") {
        return;
      }

      if (interaction.type === "pan") {
        const next: CanvasViewport = {
          ...interaction.startViewport,
          x: interaction.startViewport.x + (event.clientX - interaction.startClientX),
          y: interaction.startViewport.y + (event.clientY - interaction.startClientY),
        };

        viewRef.current = next;
        setView(next);
        scheduleViewportCommit(next);
        return;
      }

      const point = toWorldPoint(event.clientX, event.clientY);
      onNodePositionChange(interaction.nodeId, {
        x: point.x - interaction.pointerOffsetX,
        y: point.y - interaction.pointerOffsetY,
      });
    },
    [onNodePositionChange, scheduleViewportCommit, toWorldPoint]
  );

  const handlePointerUp = useCallback(() => {
    interactionRef.current = { type: "idle" };
  }, []);

  useEffect(() => {
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  useEffect(() => {
    return () => {
      if (viewportTimer.current) {
        clearTimeout(viewportTimer.current);
      }
    };
  }, []);

  const onBackgroundPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      onSelectNode(null);
      interactionRef.current = {
        type: "pan",
        startClientX: event.clientX,
        startClientY: event.clientY,
        startViewport: viewRef.current,
      };
    },
    [onSelectNode]
  );

  const onNodePointerDown = useCallback(
    (node: CanvasNode, event: ReactPointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();

      const point = toWorldPoint(event.clientX, event.clientY);
      interactionRef.current = {
        type: "drag",
        nodeId: node.id,
        pointerOffsetX: point.x - node.x,
        pointerOffsetY: point.y - node.y,
      };

      onSelectNode(node.id);
    },
    [onSelectNode, toWorldPoint]
  );

  const onWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      event.preventDefault();

      const current = viewRef.current;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      const scaleFactor = event.deltaY < 0 ? 1.08 : 0.92;
      const nextZoom = clamp(current.zoom * scaleFactor, 0.35, 2.4);

      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      const worldX = (cursorX - current.x) / current.zoom;
      const worldY = (cursorY - current.y) / current.zoom;

      const next: CanvasViewport = {
        zoom: nextZoom,
        x: cursorX - worldX * nextZoom,
        y: cursorY - worldY * nextZoom,
      };

      viewRef.current = next;
      setView(next);
      scheduleViewportCommit(next);
    },
    [scheduleViewportCommit]
  );

  const onDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const point = toWorldPoint(event.clientX, event.clientY);
      onDropNode(point);
    },
    [onDropNode, toWorldPoint]
  );

  const gridStyle = useMemo(() => {
    const size = 42 * view.zoom;
    return {
      backgroundSize: `${size}px ${size}px, ${size}px ${size}px, auto`,
      backgroundPosition: `${view.x}px ${view.y}px, ${view.x}px ${view.y}px, 0 0`,
    };
  }, [view.x, view.y, view.zoom]);

  return (
    <div
      ref={containerRef}
      className={styles.canvasRoot}
      onPointerDown={onBackgroundPointerDown}
      onWheel={onWheel}
      onDoubleClick={onDoubleClick}
    >
      <div className={styles.grid} style={gridStyle} />

      <div className={styles.overlayTop}>Double-click canvas to drop a new node</div>
      <div className={styles.overlayBottom}>
        Pan: drag background · Zoom: mouse wheel · {Math.round(view.zoom * 100)}%
      </div>

      <div
        className={styles.world}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
      >
        {nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            className={`${styles.node} ${selectedNodeId === node.id ? styles.nodeSelected : ""}`}
            style={{ left: `${node.x}px`, top: `${node.y}px` }}
            onClick={(event) => {
              event.stopPropagation();
              onSelectNode(node.id);
            }}
            onPointerDown={(event) => onNodePointerDown(node, event)}
          >
            <div className={styles.nodeTitle}>
              <span>{node.label}</span>
              <span className={styles.statusBubble}>{latestNodeStates[node.id] || "idle"}</span>
            </div>
            <div className={styles.nodeBody}>
              <span>{node.providerId}</span>
              <span>{node.outputType}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
