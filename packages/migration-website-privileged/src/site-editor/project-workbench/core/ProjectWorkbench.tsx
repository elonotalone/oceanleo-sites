"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  WORKBENCH_VIEWS,
  type WorkbenchView,
} from "./contracts";

export interface ProjectWorkbenchModule {
  content?: ReactNode;
  available?: boolean;
  unavailableReason?: string;
}

export interface ProjectWorkbenchProps {
  title: string;
  projectId: string;
  activeView: WorkbenchView;
  onViewChange: (view: WorkbenchView) => void;
  modules: Partial<Record<WorkbenchView, ProjectWorkbenchModule>>;
  previewDirty?: boolean;
  codeDirty?: boolean;
  revisionLabel?: string | null;
  onOpenRevisionHistory?: () => void;
  onClose?: () => void;
}

const VIEW_META: Record<
  WorkbenchView,
  { label: string; compact: string; shortcut: string }
> = {
  preview: { label: "Preview", compact: "◉", shortcut: "Alt+1" },
  code: { label: "Code", compact: "</>", shortcut: "Alt+2" },
  dashboard: { label: "Dashboard", compact: "▦", shortcut: "Alt+3" },
  database: { label: "Database", compact: "▤", shortcut: "Alt+4" },
  storage: { label: "File storage", compact: "▱", shortcut: "Alt+5" },
  settings: { label: "Settings", compact: "⚙", shortcut: "Alt+6" },
};

function viewIndex(value: WorkbenchView): number {
  return WORKBENCH_VIEWS.indexOf(value);
}

export function ProjectWorkbench({
  title,
  projectId,
  activeView,
  onViewChange,
  modules,
  previewDirty = false,
  codeDirty = false,
  revisionLabel,
  onOpenRevisionHistory,
  onClose,
}: ProjectWorkbenchProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const dirty = previewDirty || codeDirty;
  const module = modules[activeView];

  useEffect(() => {
    const onFullscreenChange = () => {
      setFullscreen(document.fullscreenElement === rootRef.current);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      const index = Number(event.key) - 1;
      const view = WORKBENCH_VIEWS[index];
      if (!view) return;
      event.preventDefault();
      onViewChange(view);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modules, onViewChange]);

  const status = useMemo(() => {
    if (codeDirty && previewDirty) return "Preview + Code drafts";
    if (previewDirty) return "Preview draft";
    if (codeDirty) return "Unsaved code";
    if (!module?.content || module.available === false) {
      return `${VIEW_META[activeView].label} unavailable`;
    }
    return revisionLabel ? `Revision ${revisionLabel}` : "No pending changes";
  }, [activeView, codeDirty, module, previewDirty, revisionLabel]);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === rootRef.current) {
        await document.exitFullscreen();
      } else {
        await rootRef.current?.requestFullscreen();
      }
    } catch {
      // The browser can reject fullscreen outside a trusted user gesture.
    }
  };

  return (
    <div
      ref={rootRef}
      className="flex h-dvh min-h-0 flex-col overflow-hidden bg-[#f4f4f2] text-zinc-900"
      data-website-project-workbench
      data-project-id={projectId || undefined}
    >
      <header className="relative z-40 flex h-14 shrink-0 items-center gap-3 border-b border-black/10 bg-white/95 px-3 shadow-[0_1px_0_rgba(0,0,0,.02)] backdrop-blur">
        <div className="flex min-w-0 items-center gap-2 pr-1">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-orange-600 text-[11px] font-black text-white shadow-sm">
            W
          </div>
          <div className="hidden min-w-0 sm:block">
            <p className="max-w-40 truncate text-[12px] font-semibold leading-4">
              {title || "Website project"}
            </p>
            <p className="max-w-40 truncate text-[10px] leading-3 text-zinc-400">
              {projectId || "Project not attached"}
            </p>
          </div>
        </div>

        <nav
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
          aria-label="Website project views"
        >
          {WORKBENCH_VIEWS.map((view) => {
            const meta = VIEW_META[view];
            const selected = view === activeView;
            const registered = modules[view];
            const unavailable = !registered || registered.available === false;
            const reason =
              registered?.unavailableReason ||
              `${meta.label} module is not registered`;
            return (
              <button
                key={view}
                type="button"
                aria-current={selected ? "page" : undefined}
                aria-label={meta.label}
                data-workbench-view={view}
                data-unavailable={unavailable || undefined}
                title={
                  unavailable
                    ? `${meta.label}: ${reason}`
                    : `${meta.label} · ${meta.shortcut}`
                }
                onClick={() => onViewChange(view)}
                className={`inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border text-[12px] font-semibold transition ${
                  selected
                    ? "border-orange-200 bg-orange-50 px-3 text-orange-700 shadow-sm"
                    : `w-9 border-transparent hover:border-zinc-200 hover:bg-zinc-50 hover:text-zinc-900 ${
                        unavailable ? "text-zinc-300" : "text-zinc-500"
                      }`
                }`}
              >
                <span
                  className={
                    view === "code"
                      ? "text-[9px] font-black tracking-[-.08em]"
                      : "text-sm"
                  }
                  aria-hidden="true"
                >
                  {meta.compact}
                </span>
                {selected && <span>{meta.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <span
            className={`hidden rounded-full px-2.5 py-1 text-[10px] font-semibold md:inline-flex ${
              dirty
                ? "bg-amber-100 text-amber-800"
                : "bg-emerald-50 text-emerald-700"
            }`}
            title={status}
          >
            {status}
          </span>
          {onOpenRevisionHistory && (
            <button
              type="button"
              onClick={onOpenRevisionHistory}
              className="grid h-9 w-9 place-items-center rounded-xl border border-transparent text-sm text-zinc-500 hover:border-zinc-200 hover:bg-zinc-50 hover:text-zinc-900"
              title="Revision history"
              aria-label="Revision history"
            >
              ↶
            </button>
          )}
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            className="grid h-9 w-9 place-items-center rounded-xl border border-transparent text-sm text-zinc-500 hover:border-zinc-200 hover:bg-zinc-50 hover:text-zinc-900"
            title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {fullscreen ? "↙" : "↗"}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="grid h-9 w-9 place-items-center rounded-xl border border-transparent text-lg text-zinc-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
              title="Close project"
              aria-label="Close project"
            >
              ×
            </button>
          )}
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        {WORKBENCH_VIEWS.map((view) => {
          const registered = modules[view];
          if (registered?.available === false || !registered?.content) {
            return null;
          }
          return (
            <div
              key={view}
              hidden={view !== activeView}
              className="absolute inset-0 min-h-0"
              aria-hidden={view !== activeView}
              data-workbench-slot={view}
            >
              {registered.content}
            </div>
          );
        })}
        {(!module?.content || module.available === false) && (
          <div className="grid h-full place-items-center p-8">
            <div className="max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-5 text-center">
              <p className="text-sm font-semibold text-amber-950">
                {VIEW_META[activeView].label} unavailable
              </p>
              <p className="mt-2 text-xs leading-5 text-amber-800">
                {module?.unavailableReason ||
                  "This project module has not been registered. No placeholder data is being shown."}
              </p>
            </div>
          </div>
        )}
      </div>
      <span className="sr-only" data-active-view-index={viewIndex(activeView)}>
        {activeView}
      </span>
    </div>
  );
}
