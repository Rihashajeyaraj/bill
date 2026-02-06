import React, { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Copy, GripVertical, Maximize2, Minus, X } from "lucide-react";

export type FloatingCardSize = "normal" | "minimized" | "maximized";

export interface FloatingCardState {
  x: number;
  y: number;
  size: FloatingCardSize;
  hidden: boolean;
}

interface FloatingCardProps {
  title: string;
  previewValue: string;
  state: FloatingCardState;
  onChange: (next: FloatingCardState) => void;
  children: React.ReactNode;
}

type ViewportKind = "mobile" | "tablet" | "desktop";

const MOBILE_BREAKPOINT = 768;
const DESKTOP_BREAKPOINT = 1280;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function viewportKind(width: number): ViewportKind {
  if (width < MOBILE_BREAKPOINT) return "mobile";
  if (width < DESKTOP_BREAKPOINT) return "tablet";
  return "desktop";
}

function fallbackCardSize(size: FloatingCardSize) {
  if (size === "minimized") return { width: 280, height: 60 };
  if (size === "maximized") return { width: 920, height: 760 };
  return { width: 380, height: 520 };
}

function computeBounds(width: number, height: number, screen: ViewportKind) {
  const margin = 16;
  const leftInset = screen === "desktop" ? 86 : 12;
  const topInset = screen === "desktop" ? 96 : 78;
  return {
    minX: leftInset,
    maxX: Math.max(leftInset, window.innerWidth - width - margin),
    minY: topInset,
    maxY: Math.max(topInset, window.innerHeight - height - 90)
  };
}

function nearestCorner(
  point: { x: number; y: number },
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
) {
  const corners = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.minX, y: bounds.maxY },
    { x: bounds.maxX, y: bounds.maxY }
  ];

  return corners.reduce((best, corner) => {
    const bestDistance = Math.hypot(best.x - point.x, best.y - point.y);
    const candidateDistance = Math.hypot(corner.x - point.x, corner.y - point.y);
    return candidateDistance < bestDistance ? corner : best;
  }, corners[0]);
}

export function defaultFloatingCardState(): FloatingCardState {
  if (typeof window === "undefined") {
    return { x: 980, y: 180, size: "normal", hidden: false };
  }
  return {
    x: Math.max(92, window.innerWidth - 430),
    y: 170,
    size: "normal",
    hidden: false
  };
}

export function sanitizeFloatingCardState(value: unknown): FloatingCardState {
  const fallback = defaultFloatingCardState();
  if (!value || typeof value !== "object") return fallback;
  const source = value as Record<string, unknown>;
  const x = Number(source.x);
  const y = Number(source.y);
  const sizeSource = String(source.size || source.mode || "normal");
  const size: FloatingCardSize =
    sizeSource === "minimized" || sizeSource === "maximized" || sizeSource === "normal"
      ? sizeSource
      : "normal";

  return {
    x: Number.isFinite(x) ? x : fallback.x,
    y: Number.isFinite(y) ? y : fallback.y,
    size,
    hidden: Boolean(source.hidden)
  };
}

export default function FloatingCard({ title, previewValue, state, onChange, children }: FloatingCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [screen, setScreen] = useState<ViewportKind>(() => viewportKind(typeof window === "undefined" ? DESKTOP_BREAKPOINT : window.innerWidth));

  const stateRef = useRef(state);
  const screenRef = useRef(screen);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  stateRef.current = state;
  screenRef.current = screen;

  const canDrag = screen !== "mobile" && state.size !== "maximized" && !state.hidden;

  useEffect(() => {
    const onResize = () => setScreen(viewportKind(window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (state.size !== "maximized") return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onChange({ ...stateRef.current, size: "normal" });
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [state.size, onChange]);

  useEffect(() => {
    if (state.hidden || state.size === "maximized" || screen === "mobile") return;
    const rect = cardRef.current?.getBoundingClientRect();
    const fallback = fallbackCardSize(state.size);
    const bounds = computeBounds(rect?.width || fallback.width, rect?.height || fallback.height, screen);
    const nextX = Math.round(clamp(state.x, bounds.minX, bounds.maxX));
    const nextY = Math.round(clamp(state.y, bounds.minY, bounds.maxY));
    if (nextX !== state.x || nextY !== state.y) {
      onChange({ ...state, x: nextX, y: nextY });
    }
  }, [state, screen, onChange]);

  useEffect(() => {
    if (!isDragging) return;

    const onPointerMove = (event: PointerEvent) => {
      const nextState = stateRef.current;
      const nextScreen = screenRef.current;
      if (nextScreen === "mobile" || nextState.size === "maximized") return;

      const rect = cardRef.current?.getBoundingClientRect();
      const fallback = fallbackCardSize(nextState.size);
      const bounds = computeBounds(rect?.width || fallback.width, rect?.height || fallback.height, nextScreen);

      const x = clamp(event.clientX - dragOffsetRef.current.x, bounds.minX, bounds.maxX);
      const y = clamp(event.clientY - dragOffsetRef.current.y, bounds.minY, bounds.maxY);
      onChange({ ...nextState, x: Math.round(x), y: Math.round(y) });
    };

    const onPointerUp = () => {
      const nextState = stateRef.current;
      const nextScreen = screenRef.current;
      if (nextScreen === "tablet") {
        const rect = cardRef.current?.getBoundingClientRect();
        const fallback = fallbackCardSize(nextState.size);
        const bounds = computeBounds(rect?.width || fallback.width, rect?.height || fallback.height, nextScreen);
        const corner = nearestCorner({ x: nextState.x, y: nextState.y }, bounds);
        onChange({ ...nextState, x: corner.x, y: corner.y });
      }
      setIsDragging(false);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [isDragging, onChange]);

  function startDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (!canDrag || event.button !== 0) return;
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragOffsetRef.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
    setIsDragging(true);
  }

  const floatingStyle = useMemo(() => {
    if (screen === "mobile") {
      const maxHeight = state.size === "maximized" ? "calc(100vh - 80px)" : "min(70vh, 470px)";
      return {
        left: 12,
        right: 12,
        bottom: 12,
        width: "auto",
        maxHeight
      } as React.CSSProperties;
    }

    if (state.size === "maximized") {
      return {
        left: "50%",
        top: "50%",
        width: "min(920px, calc(100vw - 32px))",
        height: "min(86vh, 900px)",
        transform: "translate(-50%, -50%)"
      } as React.CSSProperties;
    }

    const compact = state.size === "minimized";
    return {
      left: state.x,
      top: state.y,
      width: compact ? 285 : 380
    } as React.CSSProperties;
  }, [screen, state]);

  if (state.hidden) {
    return (
      <button
        type="button"
        onClick={() => onChange({ ...state, hidden: false })}
        className="fixed bottom-24 right-4 z-[70] inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-lg"
      >
        {title}
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-800">{previewValue}</span>
      </button>
    );
  }

  const minimized = state.size === "minimized";
  const contentMaxHeight =
    state.size === "maximized" || screen === "mobile" ? "calc(86vh - 52px)" : "min(62vh, 520px)";

  return (
    <>
      {state.size === "maximized" ? (
        <div
          className="fixed inset-0 z-[58] bg-slate-900/25 backdrop-blur-[1px] transition-opacity duration-200"
          onClick={() => onChange({ ...state, size: "normal" })}
        />
      ) : null}

      <section
        ref={cardRef}
        style={floatingStyle}
        className={clsx(
          "fixed z-[60] overflow-hidden border border-slate-200 bg-white transition-all duration-300 ease-out",
          screen === "mobile" ? "rounded-3xl" : minimized ? "rounded-full" : "rounded-3xl",
          isDragging ? "shadow-2xl ring-2 ring-slate-200" : "shadow-lg"
        )}
      >
        <header
          className={clsx(
            "sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur",
            minimized && "border-b-0"
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              aria-label="Drag totals card"
              onPointerDown={startDrag}
              className={clsx(
                "rounded-md border border-slate-200 bg-white p-1.5 text-slate-500",
                canDrag ? "cursor-move hover:bg-slate-50" : "cursor-not-allowed opacity-50",
                isDragging && "cursor-grabbing"
              )}
            >
              <GripVertical className="h-3.5 w-3.5" />
            </button>
            <p className="truncate text-sm font-semibold text-slate-900">{title}</p>
            {minimized ? <p className="truncate text-xs text-slate-500">{previewValue}</p> : null}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label={minimized ? "Expand card" : "Minimize card"}
              onClick={() => onChange({ ...state, size: minimized ? "normal" : "minimized" })}
              className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label={state.size === "maximized" ? "Restore card" : "Maximize card"}
              onClick={() => onChange({ ...state, size: state.size === "maximized" ? "normal" : "maximized" })}
              className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
            >
              {state.size === "maximized" ? <Copy className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              aria-label="Hide card"
              onClick={() => onChange({ ...state, hidden: true })}
              className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>

        <div
          className={clsx(
            "transition-[max-height,opacity,padding] duration-300 ease-out",
            minimized ? "max-h-0 px-4 pb-0 pt-0 opacity-0" : "px-4 pb-4 pt-3 opacity-100"
          )}
          style={{ maxHeight: minimized ? 0 : contentMaxHeight }}
        >
          <div className="overflow-y-auto" style={{ maxHeight: contentMaxHeight }}>
            {children}
          </div>
        </div>
      </section>
    </>
  );
}
