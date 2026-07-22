"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  SelectionCommand,
  SelectionContext,
  SelectionControl,
  SelectionControlValue,
} from "@oceanleo/ui/shell";
import {
  type DraftHistoryState,
  type PreviewDevice,
  type PreviewMode,
  normalizePreviewRoute,
  requestId,
} from "./project-workbench/core/contracts";
import {
  PREVIEW_TOOLS,
  buildContextCommandSource,
  controlsForPreviewTool,
  selectionCommand,
  type ContextCommandDescriptor,
  type PreviewTool,
} from "./project-workbench/core/selection-command-source";

export interface PreviewWorkspaceProps {
  title: string;
  mode: PreviewMode;
  onModeChange: (mode: PreviewMode) => void;
  device: PreviewDevice;
  onDeviceChange: (device: PreviewDevice) => void;
  route: string;
  routes: string[];
  onRouteChange: (route: string) => void;
  onOpenWebsite: () => void;
  onRefresh: () => void;
  selection: SelectionContext | null;
  onSelectionCommand: (command: SelectionCommand) => void;
  preview: ReactNode;
  draftHistory: DraftHistoryState;
  actionState?: {
    busy: "apply" | "discard" | "undo" | "redo" | null;
    message: string;
    unavailable: boolean;
  };
  onApply: () => void;
  onDiscard: () => void;
  onUndo: () => void;
  onRedo: () => void;
  contextMenuRequest?: { x: number; y: number; nonce: number } | null;
  hostOwnsChrome?: boolean;
}

const TOOL_META: Record<
  PreviewTool,
  { label: string; icon: string; description: string }
> = {
  pages: { label: "Pages", icon: "▤", description: "Project routes" },
  sections: { label: "Sections", icon: "▥", description: "Section structure" },
  components: { label: "Components", icon: "◇", description: "Selected component" },
  assets: { label: "Assets", icon: "▧", description: "Bound media" },
  layers: { label: "Layers", icon: "▱", description: "Position and order" },
  styles: { label: "Site styles", icon: "◐", description: "Deterministic styles" },
  navigation: { label: "Navigation", icon: "↗", description: "Bound links" },
  forms: { label: "Forms", icon: "▭", description: "Bound form controls" },
};

const DEVICE_WIDTH: Record<PreviewDevice, string> = {
  desktop: "1440px",
  tablet: "768px",
  mobile: "390px",
};

function ControlEditor({
  control,
  context,
  onCommand,
}: {
  control: SelectionControl;
  context: SelectionContext;
  onCommand: (command: SelectionCommand) => void;
}) {
  const [draftValue, setDraftValue] = useState<SelectionControlValue>(
    control.value ?? "",
  );
  const gestureRef = useRef<string | null>(null);
  const gestureValueRef = useRef<SelectionControlValue>(
    control.value ?? "",
  );
  const gestureStartValueRef = useRef<SelectionControlValue>(
    control.value ?? "",
  );
  const composingRef = useRef(false);
  const onCommandRef = useRef(onCommand);

  useEffect(() => {
    onCommandRef.current = onCommand;
  }, [onCommand]);

  useEffect(() => {
    if (gestureRef.current) return;
    const value = control.value ?? "";
    setDraftValue(value);
    gestureValueRef.current = value;
    gestureStartValueRef.current = value;
  }, [control.id, control.value, context.epoch, context.id, context.revision]);

  useEffect(() => {
    const transactionContext = context;
    const controlId = control.id;
    return () => {
      const transactionId = gestureRef.current;
      if (!transactionId) return;
      onCommandRef.current({
        ...selectionCommand(
          transactionContext,
          controlId,
          gestureValueRef.current,
        ),
        phase: "cancel",
        transactionId,
      });
      gestureRef.current = null;
    };
  }, [context.epoch, context.id, context.revision, control.id]);

  const emit = (value?: SelectionControlValue) =>
    onCommand(selectionCommand(context, control.id, value));

  if (control.kind === "action" || control.kind === "panel") {
    return (
      <button
        type="button"
        disabled={control.disabled || control.kind === "panel"}
        onClick={() => emit()}
        className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
          control.danger || control.tone === "danger"
            ? "border-rose-200 text-rose-700 hover:bg-rose-50"
            : "border-zinc-200 bg-white text-zinc-700 hover:border-orange-300 hover:bg-orange-50"
        }`}
      >
        <span>{control.label}</span>
        <span aria-hidden="true">›</span>
      </button>
    );
  }

  if (control.kind === "toggle") {
    return (
      <label className="flex items-center justify-between gap-3 text-xs text-zinc-600">
        <span>{control.label}</span>
        <input
          type="checkbox"
          checked={control.value === true}
          disabled={control.disabled}
          onChange={(event) => emit(event.target.checked)}
          className="h-4 w-4 accent-orange-600"
        />
      </label>
    );
  }

  if (control.kind === "select") {
    return (
      <label className="grid gap-1.5 text-[11px] font-medium text-zinc-500">
        <span>{control.label}</span>
        <select
          value={String(control.value ?? "")}
          disabled={control.disabled}
          onChange={(event) => emit(event.target.value)}
          className="h-9 rounded-lg border border-zinc-200 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-orange-400"
        >
          {(control.options || []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (control.kind === "color") {
    const value =
      typeof draftValue === "string" && /^#[0-9a-f]{6}$/i.test(draftValue)
        ? draftValue
        : "#000000";
    return (
      <label className="flex items-center justify-between gap-3 text-[11px] font-medium text-zinc-500">
        <span>{control.label}</span>
        <span className="flex items-center gap-2">
          <code className="text-[10px] text-zinc-400">{value}</code>
          <input
            type="color"
            value={value}
            disabled={control.disabled}
            onChange={(event) => {
              setDraftValue(event.target.value);
              emit(event.target.value);
            }}
            className="h-8 w-10 cursor-pointer rounded border border-zinc-200 bg-white p-1"
          />
        </span>
      </label>
    );
  }

  if (control.kind === "range") {
    const value =
      typeof draftValue === "number"
        ? draftValue
        : Number(control.value || control.min || 0);
    const startGesture = (next: number) => {
      if (gestureRef.current) return gestureRef.current;
      const transactionId = requestId(`gesture-${control.id}`);
      gestureRef.current = transactionId;
      gestureStartValueRef.current = next;
      gestureValueRef.current = next;
      onCommand({
        ...selectionCommand(context, control.id, next),
        phase: "start",
        transactionId,
      });
      return transactionId;
    };
    const updateGesture = (next: number) => {
      const transactionId =
        gestureRef.current ||
        startGesture(
          typeof gestureValueRef.current === "number"
            ? gestureValueRef.current
            : next,
        );
      gestureValueRef.current = next;
      onCommand({
        ...selectionCommand(context, control.id, next),
        phase: "update",
        transactionId,
      });
    };
    const commitGesture = (next: number) => {
      const transactionId = gestureRef.current;
      if (!transactionId) return;
      gestureValueRef.current = next;
      gestureRef.current = null;
      onCommand({
        ...selectionCommand(context, control.id, next),
        phase: "commit",
        transactionId,
      });
    };
    const cancelGesture = () => {
      const transactionId = gestureRef.current;
      if (!transactionId) return;
      const start = gestureStartValueRef.current;
      gestureRef.current = null;
      setDraftValue(start);
      gestureValueRef.current = start;
      onCommand({
        ...selectionCommand(context, control.id, start),
        phase: "cancel",
        transactionId,
      });
    };
    return (
      <label className="grid gap-1.5 text-[11px] font-medium text-zinc-500">
        <span className="flex justify-between gap-2">
          <span>{control.label}</span>
          <span className="font-mono text-zinc-700">
            {value}
            {control.suffix || ""}
          </span>
        </span>
        <input
          type="range"
          value={value}
          min={control.min}
          max={control.max}
          step={control.step}
          disabled={control.disabled}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture?.(event.pointerId);
            startGesture(Number(event.currentTarget.value));
          }}
          onChange={(event) => {
            const next = Number(event.target.value);
            setDraftValue(next);
            updateGesture(next);
          }}
          onPointerUp={(event) =>
            commitGesture(Number(event.currentTarget.value))
          }
          onPointerCancel={cancelGesture}
          onKeyDown={(event) => {
            if (event.key === "Escape" && gestureRef.current) {
              event.preventDefault();
              cancelGesture();
              return;
            }
            if (
              ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(
                event.key,
              ) &&
              !gestureRef.current
            ) {
              startGesture(Number(event.currentTarget.value));
            }
          }}
          onKeyUp={(event) => {
            if (
              gestureRef.current &&
              ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(
                event.key,
              )
            ) {
              commitGesture(Number(event.currentTarget.value));
            }
          }}
          onBlur={() => {
            if (
              gestureRef.current &&
              typeof gestureValueRef.current === "number"
            ) {
              commitGesture(gestureValueRef.current);
            }
          }}
          className="w-full accent-orange-600"
        />
      </label>
    );
  }

  const stringValue =
    typeof draftValue === "string" || typeof draftValue === "number"
      ? String(draftValue)
      : "";
  return (
    <label className="grid gap-1.5 text-[11px] font-medium text-zinc-500">
      <span>{control.label}</span>
      <div className="flex items-center gap-1">
        <input
          type={control.kind === "number" ? "number" : "text"}
          value={stringValue}
          min={control.min}
          max={control.max}
          step={control.step}
          disabled={control.disabled}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onChange={(event) =>
            setDraftValue(
              control.kind === "number"
                ? Number(event.target.value)
                : event.target.value,
            )
          }
          onKeyDown={(event) => {
            if (
              event.key !== "Enter" ||
              event.nativeEvent.isComposing ||
              composingRef.current
            ) {
              return;
            }
            event.preventDefault();
            emit(draftValue);
          }}
          className="h-9 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-orange-400"
        />
        <button
          type="button"
          disabled={control.disabled}
          onClick={() => {
            if (composingRef.current) return;
            emit(draftValue);
          }}
          aria-label={`Set ${control.label}`}
          className="h-9 rounded-lg bg-zinc-900 px-2.5 text-[10px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Set
        </button>
      </div>
    </label>
  );
}

export function PreviewWorkspace({
  title,
  mode,
  onModeChange,
  device,
  onDeviceChange,
  route,
  routes,
  onRouteChange,
  onOpenWebsite,
  onRefresh,
  selection,
  onSelectionCommand,
  preview,
  draftHistory,
  actionState = { busy: null, message: "", unavailable: false },
  onApply,
  onDiscard,
  onUndo,
  onRedo,
  contextMenuRequest,
  hostOwnsChrome = false,
}: PreviewWorkspaceProps) {
  const [activeTool, setActiveTool] = useState<PreviewTool>("components");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [routeDraft, setRouteDraft] = useState(route);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const commandSource = useMemo(
    () => buildContextCommandSource(selection),
    [selection],
  );
  const toolControls = useMemo(
    () => controlsForPreviewTool(activeTool, selection),
    [activeTool, selection],
  );
  const contextualTools = useMemo(
    () =>
      PREVIEW_TOOLS.filter(
        (tool) =>
          tool !== "pages" &&
          controlsForPreviewTool(tool, selection).length > 0,
      ),
    [selection],
  );

  useEffect(() => setRouteDraft(route), [route]);
  useEffect(() => {
    setContextMenu(null);
    setMoreOpen(false);
    if (!selection) setInspectorOpen(false);
  }, [mode, selection?.id, selection?.revision, selection?.epoch]);
  useEffect(() => {
    if (
      contextualTools.length > 0 &&
      !contextualTools.includes(activeTool)
    ) {
      setActiveTool(contextualTools[0]);
    }
  }, [activeTool, contextualTools]);
  useEffect(() => {
    if (!contextMenuRequest || !selection) return;
    setContextMenu({
      x: contextMenuRequest.x,
      y: contextMenuRequest.y,
    });
  }, [contextMenuRequest, selection]);
  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, []);

  const commitRoute = () => {
    const normalized = normalizePreviewRoute(routeDraft);
    if (!normalized) {
      setRouteDraft(route);
      return;
    }
    onRouteChange(normalized);
  };

  const runContextCommand = async (command: ContextCommandDescriptor) => {
    setContextMenu(null);
    if (!selection) return;
    if (command.local === "copy-stable-id") {
      try {
        await navigator.clipboard.writeText(selection.id);
      } catch {
        // Clipboard permissions are user-agent controlled; no mutation occurs.
      }
      return;
    }
    if (command.controlId) {
      onSelectionCommand(
        selectionCommand(selection, command.controlId, command.value),
      );
    }
  };

  return (
    <div
      data-preview-workspace
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#efefed]"
    >
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-black/10 bg-white p-2">
        <div className="flex shrink-0 items-center rounded-lg bg-zinc-100 p-1">
          {(["desktop", "tablet", "mobile"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => onDeviceChange(item)}
              aria-pressed={device === item}
              title={item}
              className={`grid h-7 min-w-7 place-items-center rounded-md px-1.5 text-[10px] font-semibold ${
                device === item
                  ? "bg-white text-zinc-900 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-800"
              }`}
            >
              <span aria-hidden="true">
                {item === "desktop" ? "▱" : item === "tablet" ? "▯" : "▯"}
              </span>
              <span className="sr-only">{item}</span>
            </button>
          ))}
        </div>

        <div className="order-3 flex min-w-0 basis-full items-center gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1 sm:order-none sm:min-w-48 sm:flex-1 sm:basis-auto">
          <button
            type="button"
            onClick={() => onRouteChange("/")}
            className="h-7 shrink-0 rounded-lg px-2 text-[10px] font-semibold text-zinc-500 hover:bg-white hover:text-zinc-900"
          >
            Home
          </button>
          <input
            list="website-project-routes"
            value={routeDraft}
            onChange={(event) => setRouteDraft(event.target.value)}
            onBlur={commitRoute}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitRoute();
            }}
            className="h-7 min-w-0 flex-1 bg-transparent px-1 font-mono text-[11px] text-zinc-700 outline-none"
            aria-label="Preview route"
          />
          <datalist id="website-project-routes">
            {routes.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
          <button
            type="button"
            onClick={onOpenWebsite}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs text-zinc-500 hover:bg-white hover:text-zinc-900"
            title="Open website"
            aria-label="Open website"
          >
            ↗
          </button>
          <button
            type="button"
            onClick={onRefresh}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs text-zinc-500 hover:bg-white hover:text-zinc-900"
            title="Refresh preview"
            aria-label="Refresh preview"
          >
            ↻
          </button>
        </div>

        <div className="ml-auto flex shrink-0 items-center rounded-lg bg-zinc-100 p-1">
          {(["view", "edit"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => onModeChange(item)}
              aria-pressed={mode === item}
              className={`h-7 rounded-md px-2.5 text-[10px] font-semibold ${
                mode === item
                  ? item === "edit"
                    ? "bg-orange-600 text-white shadow-sm"
                    : "bg-white text-zinc-900 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-800"
              }`}
            >
              {item === "edit" ? "Edit" : "View"}
            </button>
          ))}
        </div>
      </div>

      <main
        className="relative min-h-0 min-w-0 flex-1 overflow-auto p-2 sm:p-3"
        onContextMenu={(event) => {
          if (
            hostOwnsChrome ||
            mode !== "edit" ||
            !selection ||
            !commandSource.length
          ) {
            return;
          }
          event.preventDefault();
          setContextMenu({ x: event.clientX, y: event.clientY });
        }}
        onPointerDown={() => setContextMenu(null)}
      >
        <div
          className="mx-auto h-full max-w-full transition-[width] duration-200"
          style={{ width: DEVICE_WIDTH[device], maxWidth: "100%" }}
        >
          {preview}
        </div>

        {!hostOwnsChrome && mode === "edit" && selection && (
          <div
            data-site-editor-local-toolbar
            className="absolute left-1/2 top-4 z-30 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-1 rounded-xl border border-black/10 bg-white/95 p-1.5 shadow-xl backdrop-blur"
          >
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
              <span className="max-w-32 shrink-0 truncate px-2 text-[10px] font-semibold text-zinc-500">
                {selection.label || selection.id}
              </span>
              {commandSource.map((command) => (
                <button
                  key={command.id}
                  type="button"
                  onClick={() => void runContextCommand(command)}
                  className={`shrink-0 rounded-lg px-2 py-1.5 text-[10px] font-semibold ${
                    command.danger
                      ? "text-rose-700 hover:bg-rose-50"
                      : "text-zinc-700 hover:bg-zinc-100"
                  }`}
                >
                  {command.label}
                </button>
              ))}
            </div>
            {contextualTools.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setInspectorOpen(true);
                  setMoreOpen(false);
                }}
                className="shrink-0 rounded-lg bg-orange-50 px-2.5 py-1.5 text-[10px] font-semibold text-orange-700 hover:bg-orange-100"
              >
                Inspect
              </button>
            )}
            {contextualTools.length > 1 && (
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setMoreOpen((open) => !open)}
                  className="rounded-lg px-2.5 py-1.5 text-[10px] font-semibold text-zinc-700 hover:bg-zinc-100"
                  aria-expanded={moreOpen}
                >
                  More
                </button>
                {moreOpen && (
                  <div className="absolute right-0 top-full mt-2 grid min-w-40 gap-1 rounded-xl border border-black/10 bg-white p-1.5 shadow-xl">
                    {contextualTools.map((tool) => (
                      <button
                        key={tool}
                        type="button"
                        onClick={() => {
                          setActiveTool(tool);
                          setInspectorOpen(true);
                          setMoreOpen(false);
                        }}
                        className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[10px] font-semibold text-zinc-700 hover:bg-zinc-100"
                      >
                        <span aria-hidden="true">{TOOL_META[tool].icon}</span>
                        {TOOL_META[tool].label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {!hostOwnsChrome &&
          mode === "edit" &&
          selection &&
          inspectorOpen &&
          contextualTools.length > 0 && (
            <aside
              data-contextual-inspector
              className="absolute inset-y-3 right-3 z-40 flex w-[min(320px,calc(100%-1.5rem))] flex-col overflow-hidden rounded-2xl border border-black/10 bg-[#fafaf9]/95 shadow-2xl backdrop-blur"
            >
              <div className="flex shrink-0 items-start gap-2 border-b border-black/10 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-zinc-900">
                    {selection.label || selection.id}
                  </p>
                  <code className="mt-1 block truncate text-[9px] text-zinc-400">
                    {selection.id}
                  </code>
                </div>
                <button
                  type="button"
                  onClick={() => setInspectorOpen(false)}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100"
                  aria-label="Close inspector"
                >
                  ×
                </button>
              </div>
              <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-black/10 p-2">
                {contextualTools.map((tool) => (
                  <button
                    key={tool}
                    type="button"
                    onClick={() => setActiveTool(tool)}
                    aria-pressed={activeTool === tool}
                    className={`shrink-0 rounded-lg px-2 py-1.5 text-[9px] font-semibold ${
                      activeTool === tool
                        ? "bg-orange-50 text-orange-700"
                        : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                    }`}
                  >
                    {TOOL_META[tool].label}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <p className="mb-3 text-[10px] leading-4 text-zinc-400">
                  {TOOL_META[activeTool].description}
                </p>
                <div className="grid gap-3">
                  {toolControls.map((control) => (
                    <ControlEditor
                      key={control.id}
                      control={control}
                      context={selection}
                      onCommand={onSelectionCommand}
                    />
                  ))}
                </div>
              </div>
            </aside>
          )}

        {!hostOwnsChrome && contextMenu && selection && (
          <div
            role="menu"
            className="fixed z-[80] min-w-44 rounded-xl border border-black/10 bg-white p-1.5 shadow-2xl"
            style={{
              left: Math.max(
                8,
                Math.min(contextMenu.x, window.innerWidth - 200),
              ),
              top: Math.max(
                8,
                Math.min(contextMenu.y, window.innerHeight - 240),
              ),
            }}
          >
            <p className="max-w-48 truncate border-b border-zinc-100 px-2 py-1.5 text-[9px] font-medium text-zinc-400">
              {selection.id}
            </p>
            {commandSource.map((command) => (
              <button
                key={command.id}
                type="button"
                role="menuitem"
                onClick={() => void runContextCommand(command)}
                className={`flex w-full items-center rounded-lg px-2.5 py-2 text-left text-[11px] ${
                  command.danger
                    ? "text-rose-700 hover:bg-rose-50"
                    : "text-zinc-700 hover:bg-zinc-100"
                }`}
              >
                {command.label}
              </button>
            ))}
          </div>
        )}

        {(mode === "edit" || draftHistory.draft_change_count > 0) && (
          <div className="absolute bottom-4 left-1/2 z-30 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-xl border border-black/10 bg-white/95 p-1.5 shadow-xl backdrop-blur">
            <span className="shrink-0 px-2 text-[10px] font-semibold text-zinc-500">
              {draftHistory.draft_change_count} draft change
              {draftHistory.draft_change_count === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              disabled={
                draftHistory.undo_depth < 1 ||
                actionState.busy !== null ||
                actionState.unavailable
              }
              onClick={onUndo}
              className="h-8 shrink-0 rounded-lg px-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-100 disabled:opacity-35"
              title="Undo"
              aria-label="Undo"
            >
              ↶
            </button>
            <button
              type="button"
              disabled={
                draftHistory.redo_depth < 1 ||
                actionState.busy !== null ||
                actionState.unavailable
              }
              onClick={onRedo}
              className="h-8 shrink-0 rounded-lg px-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-100 disabled:opacity-35"
              title="Redo"
              aria-label="Redo"
            >
              ↷
            </button>
            <button
              type="button"
              disabled={
                draftHistory.draft_change_count < 1 ||
                actionState.busy !== null ||
                actionState.unavailable
              }
              onClick={onDiscard}
              className="h-8 shrink-0 rounded-lg px-3 text-[10px] font-semibold text-zinc-600 hover:bg-zinc-100 disabled:opacity-35"
            >
              {actionState.busy === "discard" ? "Discarding…" : "Discard"}
            </button>
            <button
              type="button"
              disabled={
                draftHistory.draft_change_count < 1 ||
                actionState.busy !== null ||
                actionState.unavailable
              }
              onClick={onApply}
              className="h-8 shrink-0 rounded-lg bg-orange-600 px-3 text-[10px] font-semibold text-white hover:bg-orange-700 disabled:opacity-35"
            >
              {actionState.busy === "apply" ? "Applying…" : "Apply"}
            </button>
          </div>
        )}

        {actionState.message && (
          <div
            className={`absolute bottom-16 left-1/2 z-30 max-w-[calc(100%-1rem)] -translate-x-1/2 rounded-lg px-3 py-2 text-center text-[10px] shadow ${
              actionState.unavailable
                ? "border border-amber-200 bg-amber-50 text-amber-800"
                : "bg-zinc-900 text-white"
            }`}
          >
            {actionState.message}
          </div>
        )}
      </main>
      <span className="sr-only">{title}</span>
      <span className="sr-only" data-preview-route-count={routes.length}>
        {route}
      </span>
    </div>
  );
}
