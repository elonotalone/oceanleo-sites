"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  isCanonicalProjectId,
  safeSourcePath,
  type SourceConflict,
  type SourceTransactionOperation,
  type SourceTreeEntry,
  type WebsiteDiagnostic,
  type WebsiteRevision,
} from "./project-workbench/core/contracts";
import {
  downloadRevisionArchive,
  downloadSourceFile,
  readDiagnostics,
  readRevisions,
  readSourceFile,
  readSourceTree,
  restoreRevision as restoreProjectRevision,
  transactSource,
} from "./project-workbench/core/project-api";
import {
  explorerRows,
  normalizeDiagnostics,
  normalizeSourceFile,
  normalizeSourceTree,
  sourceName,
  sourceParent,
} from "./project-workbench/core/source-model";
import { CodeTextEditor } from "./project-workbench/core/CodeTextEditor";

interface OpenBuffer {
  path: string;
  content: string;
  baseContent: string;
  sha256: string | null;
  revisionId: string | null;
  mimeType: string;
  isBinary: boolean;
  dirty: boolean;
}

export interface CodeWorkspaceProps {
  projectId: string;
  sessionId?: string;
  initialRevisionId?: string | null;
  initialHeadVersion?: number;
  historyRequestNonce?: number;
  onDirtyChange?: (dirty: boolean) => void;
  onRevisionChange?: (
    revisionId: string,
    headVersion: number,
    lastHealthyRevisionId: string | null,
  ) => void;
  onSessionPreviewChange?: (previewUrl: string) => void;
}

function triggerDownload(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 2_000);
}

function revisionList(value: unknown, expectedProjectId: string): {
  revisions: WebsiteRevision[];
  workingRevisionId: string | null;
  lastHealthyRevisionId: string | null;
  publishedRevisionId: string | null;
  headVersion: number;
} {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const responseProjectId =
    typeof source.project_id === "string" ? source.project_id : "";
  if (responseProjectId && responseProjectId !== expectedProjectId) {
    return {
      revisions: [],
      workingRevisionId: null,
      lastHealthyRevisionId: null,
      publishedRevisionId: null,
      headVersion: 0,
    };
  }
  const rawRevisions = Array.isArray(source.revisions)
    ? source.revisions
    : Array.isArray(source.items)
      ? source.items
      : [];
  const revisions = rawRevisions.flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
          return [];
        }
        const item = candidate as Record<string, unknown>;
        const id = typeof item.id === "string" ? item.id : "";
        const projectId =
          typeof item.project_id === "string" ? item.project_id : "";
        const treeSha =
          typeof item.tree_sha256 === "string" ? item.tree_sha256 : "";
        const createdAt =
          typeof item.created_at === "string" ? item.created_at : "";
        if (
          !id ||
          projectId !== expectedProjectId ||
          !treeSha ||
          !createdAt
        ) {
          return [];
        }
        const health =
          item.health_status === "healthy" || item.health_status === "broken"
            ? item.health_status
            : "pending";
        const origins = new Set([
          "visual_edit",
          "code_edit",
          "import_virtual_config",
          "import_snapshot",
          "import_github",
          "restore",
        ]);
        const origin = origins.has(String(item.origin))
          ? (item.origin as WebsiteRevision["origin"])
          : "code_edit";
        return [
          {
            id,
            project_id: projectId,
            parent_revision_id:
              typeof item.parent_revision_id === "string"
                ? item.parent_revision_id
                : null,
            tree_sha256: treeSha,
            origin,
            health_status: health,
            diagnostics_count:
              typeof item.diagnostics_count === "number"
                ? Math.max(0, item.diagnostics_count)
                : 0,
            message:
              typeof item.message === "string" ? item.message.slice(0, 500) : "",
            created_at: createdAt,
            ...(typeof item.created_by === "string"
              ? { created_by: item.created_by }
              : {}),
          } satisfies WebsiteRevision,
        ];
      });
  const stringOrNull = (candidate: unknown) =>
    typeof candidate === "string" && candidate ? candidate : null;
  return {
    revisions,
    workingRevisionId: stringOrNull(source.working_revision_id),
    lastHealthyRevisionId: stringOrNull(source.last_healthy_revision_id),
    publishedRevisionId: stringOrNull(source.published_revision_id),
    headVersion:
      typeof source.head_version === "number" &&
      Number.isSafeInteger(source.head_version)
        ? source.head_version
        : 0,
  };
}

export function CodeWorkspace({
  projectId,
  sessionId,
  initialRevisionId = null,
  initialHeadVersion = 0,
  historyRequestNonce = 0,
  onDirtyChange,
  onRevisionChange,
  onSessionPreviewChange,
}: CodeWorkspaceProps) {
  const [entries, setEntries] = useState<SourceTreeEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [explorerSelection, setExplorerSelection] = useState("");
  const [buffers, setBuffers] = useState<Map<string, OpenBuffer>>(new Map());
  const [tabs, setTabs] = useState<string[]>([]);
  const [activePath, setActivePath] = useState("");
  const [revisionId, setRevisionId] = useState<string | null>(
    initialRevisionId,
  );
  const [lastHealthyRevisionId, setLastHealthyRevisionId] = useState<
    string | null
  >(null);
  const [headVersion, setHeadVersion] = useState(initialHeadVersion);
  const [diagnostics, setDiagnostics] = useState<WebsiteDiagnostic[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [problemsOpen, setProblemsOpen] = useState(true);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [editorLocation, setEditorLocation] = useState<{
    path: string;
    line: number;
    column: number;
    nonce: number;
  } | null>(null);
  const [conflict, setConflict] = useState<SourceConflict | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [history, setHistory] = useState<WebsiteRevision[]>([]);
  const [publishedRevisionId, setPublishedRevisionId] = useState<string | null>(
    null,
  );
  const loadGenerationRef = useRef(0);
  const historyGenerationRef = useRef(0);
  const historyNonceRef = useRef(historyRequestNonce);
  const revisionIdRef = useRef<string | null>(initialRevisionId);
  const headVersionRef = useRef(initialHeadVersion);
  const dirtyRef = useRef(false);
  const externalRevisionPropsRef = useRef({
    revisionId: initialRevisionId,
    headVersion: initialHeadVersion,
  });

  const current = activePath ? buffers.get(activePath) || null : null;
  const rows = useMemo(
    () => explorerRows(entries, expanded),
    [entries, expanded],
  );
  const dirty = useMemo(
    () => [...buffers.values()].some((buffer) => buffer.dirty),
    [buffers],
  );
  const currentDiagnostics = useMemo(
    () =>
      diagnostics.filter(
        (diagnostic) =>
          diagnostic.file === activePath &&
          (!revisionId || diagnostic.revision_id === revisionId),
      ),
    [activePath, diagnostics, revisionId],
  );

  useEffect(() => {
    dirtyRef.current = dirty;
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    revisionIdRef.current = revisionId;
  }, [revisionId]);
  useEffect(() => {
    headVersionRef.current = headVersion;
  }, [headVersion]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  useEffect(() => {
    if (historyRequestNonce === historyNonceRef.current) return;
    historyNonceRef.current = historyRequestNonce;
    setHistoryOpen(true);
  }, [historyRequestNonce]);

  const updateBuffer = useCallback(
    (path: string, update: (buffer: OpenBuffer) => OpenBuffer) => {
      setBuffers((previous) => {
        const currentBuffer = previous.get(path);
        if (!currentBuffer) return previous;
        const next = new Map(previous);
        next.set(path, update(currentBuffer));
        return next;
      });
    },
    [],
  );

  const loadProblems = useCallback(
    async (targetRevision: string | null = revisionId) => {
      if (!isCanonicalProjectId(projectId)) return;
      const generation = loadGenerationRef.current;
      const result = await readDiagnostics(projectId, {
        sessionId,
        revisionId: targetRevision,
      });
      if (generation !== loadGenerationRef.current) return;
      if (!result.ok) {
        if (result.unavailable) {
          setNotice(
            "Diagnostics API unavailable. No synthetic Problems are shown.",
          );
        }
        return;
      }
      setDiagnostics(
        normalizeDiagnostics(result.data).filter(
          (diagnostic) => diagnostic.project_id === projectId,
        ),
      );
    },
    [projectId, revisionId, sessionId],
  );

  const loadTree = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    if (!isCanonicalProjectId(projectId)) {
      setLoading(false);
      setEntries([]);
      setUnavailable(true);
      setNotice(
        "Code requires a canonical Website Project ID. Legacy VirtualSiteConfig remains read-only here.",
      );
      return;
    }
    setLoading(true);
    setNotice("");
    const result = await readSourceTree(projectId, {
      sessionId,
    });
    if (generation !== loadGenerationRef.current) return;
    setLoading(false);
    if (!result.ok) {
      setUnavailable(true);
      setNotice(
        result.unavailable
          ? "Canonical source tree API unavailable. Code editing is disabled; no generated mirror is being shown."
          : result.message,
      );
      return;
    }
    const normalized = normalizeSourceTree(result.data);
    if (!normalized) {
      setUnavailable(true);
      setNotice("Source tree response did not satisfy the Website Project contract.");
      return;
    }
    if (normalized.project_id !== projectId) {
      setUnavailable(true);
      setEntries([]);
      setNotice(
        "Source tree response belonged to a different project and was rejected.",
      );
      return;
    }
    setUnavailable(false);
    setEntries(normalized.files);
    const nextRevisionId =
      normalized.working_revision_id || normalized.revision_id;
    revisionIdRef.current = nextRevisionId;
    headVersionRef.current = normalized.head_version;
    setRevisionId(nextRevisionId);
    setHeadVersion(normalized.head_version);
    setExpanded((previous) => {
      if (previous.size) return previous;
      return new Set(
        normalized.files
          .filter((entry) => entry.kind === "directory")
          .filter((entry) => !entry.path.includes("/"))
          .map((entry) => entry.path),
      );
    });
    void loadProblems(normalized.working_revision_id || normalized.revision_id);
  }, [loadProblems, projectId, sessionId]);

  useEffect(() => {
    historyGenerationRef.current += 1;
    setBuffers(new Map());
    setTabs([]);
    setActivePath("");
    setExplorerSelection("");
    setExpanded(new Set());
    setDiagnostics([]);
    setConflict(null);
    setLastHealthyRevisionId(null);
    setPublishedRevisionId(null);
    revisionIdRef.current = initialRevisionId;
    headVersionRef.current = initialHeadVersion;
    externalRevisionPropsRef.current = {
      revisionId: initialRevisionId,
      headVersion: initialHeadVersion,
    };
    setRevisionId(initialRevisionId);
    setHeadVersion(initialHeadVersion);
    setUnavailable(false);
    setSaving(false);
    setHistory([]);
    setHistoryError("");
    setHistoryLoading(false);
    void loadTree();
    // Project identity owns all source buffers; session changes intentionally
    // restart this state rather than risking buffers crossing projects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, sessionId]);

  useEffect(() => {
    if (
      externalRevisionPropsRef.current.revisionId === initialRevisionId &&
      externalRevisionPropsRef.current.headVersion === initialHeadVersion
    ) {
      return;
    }
    externalRevisionPropsRef.current = {
      revisionId: initialRevisionId,
      headVersion: initialHeadVersion,
    };
    if (
      initialRevisionId === revisionIdRef.current &&
      initialHeadVersion === headVersionRef.current
    ) {
      return;
    }
    if (dirtyRef.current) {
      setNotice(
        "The project revision changed outside Code. Save or discard open browser buffers before refreshing the source tree.",
      );
      return;
    }
    revisionIdRef.current = initialRevisionId;
    headVersionRef.current = initialHeadVersion;
    setRevisionId(initialRevisionId);
    setHeadVersion(initialHeadVersion);
    setBuffers(new Map());
    setTabs([]);
    setActivePath("");
    setExplorerSelection("");
    setExpanded(new Set());
    setDiagnostics([]);
    setConflict(null);
    void loadTree();
  }, [initialHeadVersion, initialRevisionId, loadTree]);

  const openFile = useCallback(
    async (path: string) => {
      const generation = loadGenerationRef.current;
      const safePath = safeSourcePath(path);
      const entry = entries.find((candidate) => candidate.path === safePath);
      if (!safePath || entry?.kind !== "file") return;
      setExplorerSelection(safePath);
      setActivePath(safePath);
      setTabs((previous) =>
        previous.includes(safePath) ? previous : [...previous, safePath],
      );
      if (buffers.has(safePath)) return;
      setNotice(`Reading ${safePath}…`);
      const result = await readSourceFile(projectId, safePath, {
        sessionId,
        revisionId,
      });
      if (generation !== loadGenerationRef.current) return;
      if (!result.ok) {
        setNotice(result.message);
        setUnavailable(result.unavailable || result.status === 401);
        return;
      }
      const file = normalizeSourceFile(result.data);
      if (!file) {
        setNotice("Source file response failed path or SHA validation.");
        return;
      }
      if (
        file.path !== safePath ||
        file.project_id !== projectId
      ) {
        setNotice(
          "Source file response did not match the requested project and path.",
        );
        return;
      }
      const buffer: OpenBuffer = {
        path: file.path,
        content: file.content || "",
        baseContent: file.content || "",
        sha256: file.sha256,
        revisionId: file.revision_id,
        mimeType: file.mime_type,
        isBinary: file.is_binary,
        dirty: false,
      };
      setBuffers((previous) => new Map(previous).set(safePath, buffer));
      setHeadVersion((previous) => {
        const next = Math.max(previous, file.head_version);
        headVersionRef.current = next;
        return next;
      });
      setNotice(file.is_binary ? "Binary file: use Download file." : "");
    },
    [buffers, entries, projectId, revisionId, sessionId],
  );

  useEffect(() => {
    if (activePath || loading || unavailable) return;
    const first = entries.find(
      (entry) => entry.kind === "file" && !entry.is_binary,
    );
    if (first) void openFile(first.path);
  }, [activePath, entries, loading, openFile, unavailable]);

  const markRevisionChanged = useCallback(
    (
      nextRevisionId: string,
      nextHeadVersion: number,
      healthyRevisionId: string | null,
    ) => {
      revisionIdRef.current = nextRevisionId;
      headVersionRef.current = nextHeadVersion;
      setRevisionId(nextRevisionId);
      setHeadVersion(nextHeadVersion);
      setLastHealthyRevisionId(healthyRevisionId);
      onRevisionChange?.(
        nextRevisionId,
        nextHeadVersion,
        healthyRevisionId,
      );
      window.dispatchEvent(
        new CustomEvent("oceanleo:website-project-history-changed", {
          detail: {
            projectId,
            revisionId: nextRevisionId,
            headVersion: nextHeadVersion,
            origin: "code",
          },
        }),
      );
    },
    [onRevisionChange, projectId],
  );

  const saveCurrent = useCallback(async () => {
    const buffer = activePath ? buffers.get(activePath) : null;
    if (!buffer || !buffer.dirty || buffer.isBinary || saving || unavailable) {
      return;
    }
    const generation = loadGenerationRef.current;
    const submittedContent = buffer.content;
    setSaving(true);
    setNotice("Saving immutable code revision…");
    setConflict(null);
    const result = await transactSource(projectId, {
      session_id: sessionId,
      base_revision_id: buffer.revisionId || revisionId,
      expected_head_version: headVersion,
      message: `Edit ${buffer.path}`,
      operations: [
        {
          operation: "write",
          path: buffer.path,
          content: submittedContent,
          expected_sha256: buffer.sha256,
          mime_type: buffer.mimeType,
        },
      ],
    });
    if (generation !== loadGenerationRef.current) return;
    setSaving(false);
    if (!result.ok) {
      if (result.status === 409) {
        const latest = await readSourceFile(projectId, buffer.path, {
          sessionId,
        });
        const normalizedLatest = latest.ok
          ? normalizeSourceFile(latest.data)
          : null;
        const latestFile =
          normalizedLatest &&
          normalizedLatest.path === buffer.path &&
          normalizedLatest.project_id === projectId
            ? normalizedLatest
            : null;
        setConflict({
          path: buffer.path,
          mine: submittedContent,
          base: buffer.baseContent,
          current: latestFile?.content || "",
          expected_sha256: buffer.sha256,
          current_sha256: latestFile?.sha256 || null,
          current_revision_id: latestFile?.revision_id || null,
          current_head_version: latestFile?.head_version || headVersion,
          message:
            "The working head or file SHA changed. Review mine/current/base before making a new edit; this save was not applied.",
        });
      }
      setUnavailable(result.unavailable || result.status === 401);
      setNotice(result.message);
      return;
    }
    const response = result.data;
    if (response.project_id !== projectId || !Array.isArray(response.files)) {
      setNotice(
        "The source transaction returned mismatched project metadata. Refresh before editing again.",
      );
      void loadTree();
      return;
    }
    const changed = response.files.find((file) => file.path === buffer.path);
    if (!changed?.sha256) {
      markRevisionChanged(
        response.working_revision_id || response.revision_id,
        response.head_version,
        response.last_healthy_revision_id,
      );
      setDiagnostics(
        normalizeDiagnostics(response.diagnostics).filter(
          (diagnostic) => diagnostic.project_id === projectId,
        ),
      );
      setNotice(
        "The write succeeded, but the source transaction omitted the committed file SHA. Refresh before editing again.",
      );
      void loadTree();
      return;
    }
    const committedSha = changed.sha256;
    setBuffers((previous) => {
      const next = new Map<string, OpenBuffer>();
      for (const [path, value] of previous) {
        next.set(
          path,
          path === buffer.path
            ? {
                ...value,
                baseContent: submittedContent,
                sha256: committedSha,
                revisionId: response.revision_id,
                dirty: value.content !== submittedContent,
              }
            : { ...value, revisionId: response.revision_id },
        );
      }
      return next;
    });
    setDiagnostics(
      normalizeDiagnostics(response.diagnostics).filter(
        (diagnostic) => diagnostic.project_id === projectId,
      ),
    );
    markRevisionChanged(
      response.working_revision_id || response.revision_id,
      response.head_version,
      response.last_healthy_revision_id,
    );
    if (response.preview_url) {
      onSessionPreviewChange?.(response.preview_url);
    }
    setNotice(
      response.session_reload_error
        ? `Code revision saved, but Preview reload failed: ${response.session_reload_error}`
        : response.health_status === "broken"
        ? "Revision saved with compile errors. Preview remains on a broken working head; publishing is blocked."
        : "Code revision saved.",
    );
    void loadTree();
  }, [
    activePath,
    buffers,
    headVersion,
    loadTree,
    markRevisionChanged,
    onSessionPreviewChange,
    projectId,
    revisionId,
    saving,
    sessionId,
    unavailable,
  ]);

  const runTreeTransaction = useCallback(
    async (
      operations: SourceTransactionOperation[],
      message: string,
      after?: () => void,
    ) => {
      if (unavailable || saving) return false;
      const generation = loadGenerationRef.current;
      setSaving(true);
      setNotice(message);
      const result = await transactSource(projectId, {
        session_id: sessionId,
        base_revision_id: revisionId,
        expected_head_version: headVersion,
        message,
        operations,
      });
      if (generation !== loadGenerationRef.current) return false;
      setSaving(false);
      if (!result.ok) {
        setUnavailable(result.unavailable || result.status === 401);
        setNotice(result.message);
        return false;
      }
      if (result.data.project_id !== projectId) {
        setNotice(
          "The source transaction returned a different project identity and was rejected.",
        );
        return false;
      }
      const nextRevisionId =
        result.data.working_revision_id || result.data.revision_id;
      setBuffers((previous) =>
        new Map(
          [...previous].map(([path, buffer]) => [
            path,
            { ...buffer, revisionId: nextRevisionId },
          ] as const),
        ),
      );
      markRevisionChanged(
        nextRevisionId,
        result.data.head_version,
        result.data.last_healthy_revision_id,
      );
      setDiagnostics(
        normalizeDiagnostics(result.data.diagnostics).filter(
          (diagnostic) => diagnostic.project_id === projectId,
        ),
      );
      after?.();
      await loadTree();
      setNotice(
        result.data.health_status === "broken"
          ? "Source transaction saved a broken revision."
          : "Source transaction saved.",
      );
      return true;
    },
    [
      headVersion,
      loadTree,
      markRevisionChanged,
      projectId,
      revisionId,
      saving,
      sessionId,
      unavailable,
    ],
  );

  const createFile = async () => {
    const candidate = window.prompt("New file path, relative to project root");
    if (candidate === null) return;
    const path = safeSourcePath(candidate);
    if (!path) {
      setNotice("Unsafe or private source path rejected.");
      return;
    }
    const ok = await runTreeTransaction(
      [
        {
          operation: "write",
          path,
          content: "",
          expected_sha256: null,
          mime_type: "text/plain; charset=utf-8",
        },
      ],
      `Create ${path}`,
    );
    if (ok) {
      const created = await readSourceFile(projectId, path, { sessionId });
      const file = created.ok ? normalizeSourceFile(created.data) : null;
      if (
        !file ||
        file.path !== path ||
        file.project_id !== projectId
      ) {
        setNotice("File was created, but its revision metadata could not be read.");
        return;
      }
      setBuffers((previous) =>
        new Map(previous).set(path, {
          path,
          content: file.content || "",
          baseContent: file.content || "",
          sha256: file.sha256,
          revisionId: file.revision_id,
          mimeType: file.mime_type,
          isBinary: file.is_binary,
          dirty: false,
        }),
      );
      setTabs((previous) => [...previous.filter((item) => item !== path), path]);
      setActivePath(path);
    }
  };

  const createDirectory = async () => {
    const candidate = window.prompt(
      "New directory path, relative to project root",
    );
    if (candidate === null) return;
    const sentinel = safeSourcePath(`${candidate.replace(/\/+$/, "")}/.keep`);
    const path = sentinel ? sourceParent(sentinel) : null;
    if (!path) {
      setNotice("Unsafe or private directory path rejected.");
      return;
    }
    await runTreeTransaction(
      [
        {
          operation: "write",
          path: `${path}/.gitkeep`,
          content: "",
          expected_sha256: null,
          mime_type: "text/plain; charset=utf-8",
        },
      ],
      `Create ${path}`,
    );
  };

  const renameSelection = async () => {
    const entry = entries.find((candidate) => candidate.path === explorerSelection);
    if (!entry) return;
    const candidate = window.prompt("Move or rename to", entry.path);
    if (candidate === null || candidate === entry.path) return;
    const destination = safeSourcePath(candidate);
    if (!destination) {
      setNotice("Unsafe or private destination rejected.");
      return;
    }
    const contains = (path: string) =>
      path === entry.path ||
      (entry.kind === "directory" && path.startsWith(`${entry.path}/`));
    const remap = (path: string) =>
      contains(path) ? `${destination}${path.slice(entry.path.length)}` : path;
    if (
      [...buffers.values()].some(
        (buffer) => buffer.dirty && contains(buffer.path),
      ) &&
      !window.confirm(
        `Move ${entry.path} and keep its unsaved browser buffers under the new path?`,
      )
    ) {
      return;
    }
    const moveOperations: SourceTransactionOperation[] =
      entry.kind === "directory"
        ? entries
            .filter(
              (candidate) =>
                candidate.kind === "file" &&
                candidate.path.startsWith(`${entry.path}/`),
            )
            .map((candidate) => ({
              operation: "rename" as const,
              path: candidate.path,
              target_path: remap(candidate.path),
              expected_sha256: candidate.sha256,
            }))
        : [
            {
              operation: "rename",
              path: entry.path,
              target_path: destination,
              expected_sha256: entry.sha256,
            },
          ];
    if (!moveOperations.length) {
      setNotice("The selected directory contains no revision files.");
      return;
    }
    const ok = await runTreeTransaction(
      moveOperations,
      `Move ${entry.path} to ${destination}`,
      () => {
        setBuffers((previous) => {
          const next = new Map<string, OpenBuffer>();
          for (const [path, buffer] of previous) {
            const nextPath = remap(path);
            next.set(nextPath, { ...buffer, path: nextPath });
          }
          return next;
        });
        setTabs((previous) => previous.map(remap));
        setActivePath(remap);
        setExplorerSelection(destination);
      },
    );
    if (ok) setNotice(`Moved to ${destination}.`);
  };

  const deleteSelection = async () => {
    const entry = entries.find((candidate) => candidate.path === explorerSelection);
    if (!entry) return;
    const contains = (path: string) =>
      path === entry.path ||
      (entry.kind === "directory" && path.startsWith(`${entry.path}/`));
    const hasDirtyBuffers = [...buffers.values()].some(
      (buffer) => buffer.dirty && contains(buffer.path),
    );
    if (
      !window.confirm(
        `Delete ${entry.path}? This creates a new revision and does not rewrite history.${
          hasDirtyBuffers
            ? " Unsaved browser buffers below this path will also close."
            : ""
        }`,
      )
    ) {
      return;
    }
    const deleteOperations: SourceTransactionOperation[] =
      entry.kind === "directory"
        ? entries
            .filter(
              (candidate) =>
                candidate.kind === "file" &&
                candidate.path.startsWith(`${entry.path}/`),
            )
            .map((candidate) => ({
              operation: "delete" as const,
              path: candidate.path,
              expected_sha256: candidate.sha256,
            }))
        : [
            {
              operation: "delete",
              path: entry.path,
              expected_sha256: entry.sha256,
            },
          ];
    if (!deleteOperations.length) {
      setNotice("The selected directory contains no revision files.");
      return;
    }
    await runTreeTransaction(
      deleteOperations,
      `Delete ${entry.path}`,
      () => {
        setBuffers((previous) => {
          return new Map(
            [...previous].filter(([path]) => !contains(path)),
          );
        });
        setTabs((previous) => previous.filter((path) => !contains(path)));
        setActivePath((path) => (contains(path) ? "" : path));
        setExplorerSelection("");
      },
    );
  };

  const closeTab = (path: string) => {
    const buffer = buffers.get(path);
    if (
      buffer?.dirty &&
      !window.confirm(`Close ${path} and discard its unsaved browser buffer?`)
    ) {
      return;
    }
    setTabs((previous) => {
      const index = previous.indexOf(path);
      const next = previous.filter((item) => item !== path);
      if (activePath === path) {
        setActivePath(next[Math.max(0, index - 1)] || "");
      }
      return next;
    });
    setBuffers((previous) => {
      const next = new Map(previous);
      next.delete(path);
      return next;
    });
  };

  const copyCurrent = async () => {
    if (!current || current.isBinary) return;
    try {
      await navigator.clipboard.writeText(current.content);
      setNotice("File copied.");
    } catch {
      setNotice("Clipboard permission was denied.");
    }
  };

  const downloadCurrent = async () => {
    if (!current) return;
    if (!current.isBinary && current.dirty) {
      triggerDownload(
        new Blob([current.content], {
          type: current.mimeType || "text/plain; charset=utf-8",
        }),
        sourceName(current.path),
      );
      setNotice("Downloaded the current unsaved browser buffer.");
      return;
    }
    const result = await downloadSourceFile(projectId, current.path, {
      sessionId,
      revisionId: current.revisionId || revisionId,
    });
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    triggerDownload(result.data.blob, result.data.filename);
  };

  const downloadProject = async () => {
    if (!isCanonicalProjectId(projectId)) {
      setNotice("Project ZIP requires a canonical Website Project ID.");
      return;
    }
    if (!revisionId) {
      setNotice("No immutable revision is available for ZIP download.");
      return;
    }
    setNotice("Building project ZIP from the immutable revision…");
    const result = await downloadRevisionArchive(projectId, revisionId);
    if (!result.ok) {
      setNotice(
        result.unavailable
          ? "Project archive API unavailable. A JSON descriptor will not be substituted for a ZIP."
          : result.message,
      );
      return;
    }
    triggerDownload(result.data.blob, result.data.filename);
    setNotice("Project ZIP downloaded.");
  };

  const loadHistory = useCallback(async () => {
    if (!historyOpen) return;
    if (!isCanonicalProjectId(projectId)) {
      setHistoryLoading(false);
      setHistoryError(
        "Revision history requires a canonical Website Project ID.",
      );
      return;
    }
    const generation = ++historyGenerationRef.current;
    setHistoryLoading(true);
    setHistoryError("");
    const result = await readRevisions(projectId);
    if (generation !== historyGenerationRef.current) return;
    setHistoryLoading(false);
    if (!result.ok) {
      const message = result.unavailable
          ? "Revision history API unavailable. No local-only history is shown."
          : result.message;
      setHistoryError(message);
      setNotice(message);
      return;
    }
    if (result.data.project_id !== projectId) {
      const message =
        "Revision history response belonged to a different project and was rejected.";
      setHistoryError(message);
      setNotice(message);
      return;
    }
    const normalized = revisionList(result.data, projectId);
    setHistory(normalized.revisions);
    setPublishedRevisionId(normalized.publishedRevisionId);
    setLastHealthyRevisionId(normalized.lastHealthyRevisionId);
    revisionIdRef.current = normalized.workingRevisionId;
    setRevisionId(normalized.workingRevisionId);
    headVersionRef.current = normalized.headVersion;
    setHeadVersion(normalized.headVersion);
  }, [historyOpen, projectId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const restore = async (target: WebsiteRevision) => {
    if (
      !window.confirm(
        `Restore revision ${target.id.slice(0, 8)} as a new child revision?${
          dirty
            ? " Unsaved browser buffers will be discarded after the restore."
            : ""
        }`,
      )
    ) {
      return;
    }
    const generation = loadGenerationRef.current;
    setHistoryLoading(true);
    const result = await restoreProjectRevision(projectId, target.id, {
      expected_head_version: headVersion,
      session_id: sessionId,
      message: `Restore ${target.id.slice(0, 12)} from Code`,
    });
    if (generation !== loadGenerationRef.current) return;
    setHistoryLoading(false);
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    if (result.data.project_id !== projectId) {
      setNotice(
        "Restore response belonged to a different project and was rejected.",
      );
      return;
    }
    markRevisionChanged(
      result.data.working_revision_id || result.data.revision_id,
      result.data.head_version,
      result.data.last_healthy_revision_id,
    );
    if (result.data.preview_url) {
      onSessionPreviewChange?.(result.data.preview_url);
    }
    setBuffers(new Map());
    setTabs([]);
    setActivePath("");
    await loadTree();
    await loadHistory();
    setNotice("Historical content restored as a new revision.");
  };

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#f4f4f2] text-zinc-900">
      <div className="flex h-11 min-w-0 shrink-0 items-center gap-2 overflow-x-auto border-b border-black/10 bg-white px-3">
        <button
          type="button"
          onClick={() => setExplorerOpen((open) => !open)}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 md:hidden"
          aria-label={explorerOpen ? "Close Explorer" : "Open Explorer"}
          aria-expanded={explorerOpen}
        >
          ☰
        </button>
        <span className="text-[11px] font-semibold text-zinc-800">Source</span>
        <span className="max-w-48 shrink-0 truncate font-mono text-[9px] text-zinc-400">
          {revisionId ? revisionId.slice(0, 12) : "no revision"}
        </span>
        {lastHealthyRevisionId &&
          revisionId &&
          lastHealthyRevisionId !== revisionId && (
            <span className="shrink-0 rounded bg-amber-100 px-2 py-1 text-[9px] font-semibold text-amber-800">
              Working head differs from last healthy
            </span>
          )}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="h-7 shrink-0 rounded-lg px-2 text-[10px] text-zinc-600 hover:bg-zinc-100"
          >
            Revision history
          </button>
          <button
            type="button"
            disabled={
              !revisionId || !isCanonicalProjectId(projectId)
            }
            onClick={() => void downloadProject()}
            className="h-7 shrink-0 rounded-lg bg-zinc-900 px-2 text-[10px] font-semibold text-white hover:bg-zinc-800 disabled:opacity-35"
          >
            Download project ZIP
          </button>
        </div>
      </div>

      {notice && (
        <div
          className={`shrink-0 border-b px-3 py-2 text-[10px] ${
            unavailable
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : "border-black/10 bg-white text-zinc-500"
          }`}
        >
          {notice}
        </div>
      )}

      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {explorerOpen && (
          <button
            type="button"
            className="absolute inset-0 z-20 bg-black/25 md:hidden"
            onClick={() => setExplorerOpen(false)}
            aria-label="Close Explorer"
          />
        )}
        <aside
          className={`absolute inset-y-0 left-0 z-30 w-[min(82vw,270px)] shrink-0 flex-col border-r border-black/10 bg-white shadow-xl md:static md:z-auto md:flex md:w-[250px] md:shadow-none ${
            explorerOpen ? "flex" : "hidden"
          }`}
        >
          <div className="flex h-9 shrink-0 items-center gap-1 border-b border-black/10 px-2">
            <span className="mr-auto text-[9px] font-bold uppercase tracking-[.12em] text-zinc-500">
              Explorer
            </span>
            <button
              type="button"
              disabled={unavailable || saving}
              onClick={() => void createFile()}
              className="grid h-7 w-7 place-items-center rounded text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-30"
              title="New file"
            >
              ＋
            </button>
            <button
              type="button"
              disabled={unavailable || saving}
              onClick={() => void createDirectory()}
              className="grid h-7 w-7 place-items-center rounded text-[10px] text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-30"
              title="New directory"
            >
              ▣
            </button>
            <button
              type="button"
              disabled={!explorerSelection || unavailable || saving}
              onClick={() => void renameSelection()}
              className="grid h-7 w-7 place-items-center rounded text-[10px] text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-30"
              title="Move or rename"
            >
              ↪
            </button>
            <button
              type="button"
              disabled={!explorerSelection || unavailable || saving}
              onClick={() => void deleteSelection()}
              className="grid h-7 w-7 place-items-center rounded text-[10px] text-zinc-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-30"
              title="Delete"
            >
              ×
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void loadTree()}
              className="grid h-7 w-7 place-items-center rounded text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-30"
              title="Refresh tree"
            >
              ↻
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto py-1">
            {loading ? (
              <p className="p-3 text-[10px] text-zinc-500">
                Reading source tree…
              </p>
            ) : rows.length ? (
              rows.map((entry) => {
                const selected = explorerSelection === entry.path;
                return (
                  <button
                    key={entry.path}
                    type="button"
                    onClick={() => {
                      setExplorerSelection(entry.path);
                      if (entry.kind === "directory") {
                        setExpanded((previous) => {
                          const next = new Set(previous);
                          if (next.has(entry.path)) next.delete(entry.path);
                          else next.add(entry.path);
                          return next;
                        });
                      } else {
                        void openFile(entry.path);
                        setExplorerOpen(false);
                      }
                    }}
                    className={`flex h-7 w-full items-center gap-1.5 pr-2 text-left font-mono text-[10px] ${
                      selected
                        ? "bg-orange-50 text-orange-800"
                        : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
                    }`}
                    style={{ paddingLeft: 8 + entry.depth * 14 }}
                    title={entry.path}
                  >
                    <span className="w-3 shrink-0 text-center text-[9px] text-zinc-400">
                      {entry.kind === "directory"
                        ? expanded.has(entry.path)
                          ? "▾"
                          : "▸"
                        : entry.is_binary
                          ? "◆"
                          : "·"}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                    {entry.modified && (
                      <span className="text-[8px] text-sky-400">M</span>
                    )}
                    {entry.conflict && (
                      <span className="text-[8px] text-rose-400">!</span>
                    )}
                    {entry.diagnostic_count > 0 && (
                      <span className="text-[8px] text-amber-400">
                        {entry.diagnostic_count}
                      </span>
                    )}
                  </button>
                );
              })
            ) : (
              <p className="p-3 text-[10px] leading-5 text-zinc-500">
                {unavailable
                  ? "Source API unavailable."
                  : "This revision contains no visible source files."}
              </p>
            )}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col bg-[#1d1d1d] text-zinc-100">
          <div className="flex h-9 shrink-0 items-end overflow-x-auto border-b border-white/10 bg-[#222]">
            {tabs.map((path) => {
              const buffer = buffers.get(path);
              return (
                <div
                  key={path}
                  className={`flex h-9 min-w-32 max-w-56 items-center gap-1 border-r border-white/10 px-2 font-mono text-[9px] ${
                    path === activePath
                      ? "bg-[#171717] text-zinc-200"
                      : "text-zinc-500 hover:bg-white/5"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setActivePath(path)}
                    className="min-w-0 flex-1 truncate text-left"
                    title={path}
                  >
                    {sourceName(path)}
                    {buffer?.dirty ? " •" : ""}
                  </button>
                  <button
                    type="button"
                    onClick={() => closeTab(path)}
                    className="grid h-5 w-5 shrink-0 place-items-center rounded hover:bg-white/10"
                    aria-label={`Close ${path}`}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>

          {current && (
            <div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/10 bg-[#1d1d1d] px-3">
              <span className="min-w-0 flex-1 truncate font-mono text-[9px] text-zinc-500">
                {current.path}
              </span>
              <button
                type="button"
                disabled={current.isBinary}
                onClick={() => void copyCurrent()}
                className="h-7 rounded px-2 text-[10px] text-zinc-400 hover:bg-white/10 hover:text-white disabled:opacity-30"
              >
                Copy file
              </button>
              <button
                type="button"
                onClick={() => void downloadCurrent()}
                className="h-7 rounded px-2 text-[10px] text-zinc-400 hover:bg-white/10 hover:text-white"
              >
                Download file
              </button>
              <button
                type="button"
                disabled={
                  !current.dirty || current.isBinary || saving || unavailable
                }
                onClick={() => void saveCurrent()}
                className="h-7 rounded bg-orange-600 px-3 text-[10px] font-semibold text-white hover:bg-orange-700 disabled:opacity-35"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col">
            {current ? (
              current.isBinary ? (
                <div className="grid min-h-0 flex-1 place-items-center bg-[#171717] p-8">
                  <div className="max-w-sm text-center">
                    <p className="text-sm font-semibold text-zinc-200">
                      Binary source file
                    </p>
                    <p className="mt-2 text-[11px] leading-5 text-zinc-500">
                      Binary bytes are never decoded into a text editor. Use
                      Download file to retrieve the exact revision blob.
                    </p>
                  </div>
                </div>
              ) : (
                <CodeTextEditor
                  path={current.path}
                  value={current.content}
                  externalVersion={`${current.revisionId || "draft"}:${current.sha256 || "new"}`}
                  diagnostics={currentDiagnostics}
                  jumpTo={
                    editorLocation?.path === current.path
                      ? editorLocation
                      : null
                  }
                  readOnly={unavailable || saving}
                  onChange={(content) =>
                    updateBuffer(current.path, (buffer) => ({
                      ...buffer,
                      content,
                      dirty: content !== buffer.baseContent,
                    }))
                  }
                  onSave={() => void saveCurrent()}
                />
              )
            ) : (
              <div className="grid min-h-0 flex-1 place-items-center bg-[#171717] p-8 text-center">
                <div>
                  <p className="text-sm font-semibold text-zinc-300">
                    Open a source file
                  </p>
                  <p className="mt-2 text-[10px] text-zinc-600">
                    Explorer reads the canonical project revision.
                  </p>
                </div>
              </div>
            )}

            <div
              className={`shrink-0 border-t border-white/10 bg-[#202020] ${
                problemsOpen ? "h-40" : "h-8"
              }`}
            >
              <button
                type="button"
                onClick={() => setProblemsOpen((open) => !open)}
                className="flex h-8 w-full items-center gap-2 px-3 text-left text-[9px] font-bold uppercase tracking-[.12em] text-zinc-500 hover:bg-white/5"
              >
                <span>{problemsOpen ? "▾" : "▸"}</span>
                <span>Problems</span>
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[8px]">
                  {diagnostics.length}
                </span>
                {revisionId && (
                  <span className="ml-auto font-mono text-[8px] normal-case tracking-normal">
                    revision {revisionId.slice(0, 8)}
                  </span>
                )}
              </button>
              {problemsOpen && (
                <div className="h-[calc(100%-2rem)] overflow-auto border-t border-white/5">
                  {diagnostics.length ? (
                    diagnostics.map((diagnostic, index) => (
                      <button
                        key={`${diagnostic.file}:${diagnostic.line}:${diagnostic.column}:${index}`}
                        type="button"
                        onClick={() => {
                          void (async () => {
                            await openFile(diagnostic.file);
                            setEditorLocation({
                              path: diagnostic.file,
                              line: diagnostic.line,
                              column: diagnostic.column,
                              nonce: Date.now(),
                            });
                          })();
                        }}
                        className="flex min-h-7 w-full items-start gap-2 px-3 py-1.5 text-left text-[9px] text-zinc-400 hover:bg-white/5"
                      >
                        <span
                          className={
                            diagnostic.severity === "error"
                              ? "text-rose-400"
                              : diagnostic.severity === "warning"
                                ? "text-amber-400"
                                : "text-sky-400"
                          }
                        >
                          {diagnostic.severity === "error" ? "●" : "▲"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="text-zinc-300">
                            {diagnostic.message}
                          </span>
                          <span className="ml-2 font-mono text-zinc-600">
                            {diagnostic.file}:{diagnostic.line}:
                            {diagnostic.column} · {diagnostic.source}
                            {diagnostic.code ? ` ${diagnostic.code}` : ""}
                          </span>
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="p-3 text-[10px] text-zinc-600">
                      No diagnostics for this revision.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {conflict && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-black/65 p-2 sm:p-6">
          <div className="flex max-h-[85vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#202020] shadow-2xl">
            <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-rose-300">
                  SHA / head conflict
                </p>
                <p className="mt-1 font-mono text-[9px] text-zinc-500">
                  {conflict.path}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConflict(null)}
                className="ml-auto rounded-lg px-3 py-1.5 text-[10px] text-zinc-400 hover:bg-white/10"
              >
                Keep mine open
              </button>
              {conflict.current_sha256 && (
                <button
                  type="button"
                  onClick={() => {
                    updateBuffer(conflict.path, (buffer) => ({
                      ...buffer,
                      content: conflict.current,
                      baseContent: conflict.current,
                      sha256: conflict.current_sha256,
                      revisionId:
                        conflict.current_revision_id || buffer.revisionId,
                      dirty: false,
                    }));
                    if (conflict.current_revision_id) {
                      setBuffers((previous) =>
                        new Map(
                          [...previous].map(([path, buffer]) => [
                            path,
                            {
                              ...buffer,
                              revisionId:
                                conflict.current_revision_id,
                            },
                          ] as const),
                        ),
                      );
                      revisionIdRef.current =
                        conflict.current_revision_id;
                      headVersionRef.current =
                        conflict.current_head_version;
                      setRevisionId(conflict.current_revision_id);
                      setHeadVersion(conflict.current_head_version);
                      onRevisionChange?.(
                        conflict.current_revision_id,
                        conflict.current_head_version,
                        lastHealthyRevisionId,
                      );
                    }
                    setConflict(null);
                    void loadTree();
                  }}
                  className="rounded-lg bg-white/10 px-3 py-1.5 text-[10px] font-semibold hover:bg-white/15"
                >
                  Reload current
                </button>
              )}
            </div>
            <p className="border-b border-white/10 px-4 py-2 text-[10px] text-zinc-400">
              {conflict.message}
            </p>
            <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-white/10 overflow-auto md:grid-cols-3 md:divide-x md:divide-y-0">
              {(
                [
                  ["Mine", conflict.mine],
                  ["Current", conflict.current],
                  ["Base", conflict.base],
                ] as const
              ).map(([label, content]) => (
                <div key={label} className="flex min-h-0 flex-col">
                  <p className="border-b border-white/10 px-3 py-2 text-[9px] font-bold uppercase tracking-[.12em] text-zinc-500">
                    {label}
                  </p>
                  <pre className="min-h-0 flex-1 overflow-auto whitespace-pre p-3 font-mono text-[10px] leading-5 text-zinc-300">
                    {content}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {historyOpen && (
        <div className="absolute inset-0 z-40 flex justify-end bg-black/45">
          <button
            type="button"
            aria-label="Close revision history"
            className="min-w-0 flex-1 cursor-default"
            onClick={() => setHistoryOpen(false)}
          />
          <aside className="flex h-full w-full max-w-md flex-col border-l border-white/10 bg-[#202020] shadow-2xl">
            <div className="flex h-12 shrink-0 items-center border-b border-white/10 px-4">
              <p className="text-xs font-semibold">Revision history</p>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-zinc-400 hover:bg-white/10"
              >
                ×
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {historyLoading ? (
                <p className="p-3 text-[10px] text-zinc-500">
                  Reading immutable revisions…
                </p>
              ) : historyError ? (
                <p className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-[10px] leading-5 text-amber-200">
                  {historyError}
                </p>
              ) : history.length ? (
                <div className="grid gap-2">
                  {history.map((item) => {
                    const working = item.id === revisionId;
                    const healthy = item.id === lastHealthyRevisionId;
                    const published = item.id === publishedRevisionId;
                    return (
                      <article
                        key={item.id}
                        className="rounded-xl border border-white/10 bg-white/[.03] p-3"
                      >
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="font-mono text-[10px] text-zinc-300">
                              {item.id.slice(0, 12)}
                            </p>
                            <p className="mt-1 text-[10px] text-zinc-500">
                              {item.message || item.origin}
                            </p>
                          </div>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[8px] font-semibold ${
                              item.health_status === "healthy"
                                ? "bg-emerald-500/15 text-emerald-300"
                                : item.health_status === "broken"
                                  ? "bg-rose-500/15 text-rose-300"
                                  : "bg-amber-500/15 text-amber-300"
                            }`}
                          >
                            {item.health_status}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {working && (
                            <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[8px] text-sky-300">
                              working
                            </span>
                          )}
                          {healthy && (
                            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[8px] text-emerald-300">
                              last healthy
                            </span>
                          )}
                          {published && (
                            <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[8px] text-violet-300">
                              published
                            </span>
                          )}
                        </div>
                        <p className="mt-2 text-[9px] text-zinc-600">
                          {new Date(item.created_at).toLocaleString()} ·{" "}
                          {item.diagnostics_count} problems
                        </p>
                        {!working && (
                          <button
                            type="button"
                            disabled={historyLoading}
                            onClick={() => void restore(item)}
                            className="mt-3 rounded-lg border border-white/10 px-2.5 py-1.5 text-[9px] font-semibold text-zinc-300 hover:bg-white/10 disabled:opacity-35"
                          >
                            Restore as new revision
                          </button>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-[10px] leading-5 text-amber-200">
                  No revision records were returned. Local browser history is
                  intentionally not presented as project history.
                </p>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
