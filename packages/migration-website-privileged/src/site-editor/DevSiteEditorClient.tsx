"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { authed, uploadFile } from "@oceanleo/ui/lib";
import {
  EDITOR_PROTOCOL,
  asHostToEditorMessage,
  isTrustedEditorOrigin,
  type SelectionCommand,
} from "@oceanleo/ui/shell";
import { accessToken } from "../auth/client";
import { GATEWAY_BASE } from "../auth/config";
import {
  defaultVirtualSiteConfig,
  normalizeVirtualSiteConfig,
} from "../virtual-site-normalize";
import {
  assetArtifactId,
  assetCommitSha,
  assetGithubRepo,
  assetProjectId,
  assetRevisionId,
  assetSourceSnapshotId,
  assetStarterId,
  assetTitle,
  EMPTY_EMBED_EDITOR_QUERY,
  parseEmbedEditorQuery,
  type EmbedEditorQueryContext,
} from "./editor-core";
import {
  normalizeDomSelection,
  selectionContext,
  type DomSelection,
} from "./editor-controls";
import {
  debounceMutationFlush,
  isDeterministicMutationControl,
  isReplaySafeMutation,
  isStableEditorId,
  LatestMutationBuffer,
  normalizeWebsiteSelectionCommand,
  pendingMutationFromCommand,
  selectionCommandCanReachPreview,
  shouldPersistSelectionCommand,
  WebsiteSelectionCommandGate,
  type PendingMutation,
  type WebsiteEditorBreakpoint,
  type WebsiteSelectionCommand,
} from "./editor-runtime";
import { virtualSiteDevFiles, type DevSourceFile } from "./dev-source";
import { PreviewWorkspace } from "./PreviewWorkspace";
import { CodeWorkspace } from "./CodeWorkspace";
import {
  ProjectWorkbench,
  type ProjectWorkbenchModule,
} from "./project-workbench/core/ProjectWorkbench";
import {
  EMPTY_DRAFT_HISTORY,
  isCanonicalProjectId,
  isWorkbenchView,
  normalizePreviewRoute,
  requestId,
  type DraftHistoryState,
  type ManagementWorkbenchView,
  type PreviewDevice,
  type PreviewMode,
  type WorkbenchView,
} from "./project-workbench/core/contracts";
import {
  applyProjectDraft,
  changeProjectDraftHistory,
  createWebsiteProject,
  createProjectSession,
  discardProjectDraft,
  linkWebsiteProjectArtifact,
  migrateLegacyWebsiteProject,
  readWebsiteProject,
  readWebsiteProjectByArtifact,
} from "./project-workbench/core/project-api";

const DEV_PROTOCOL = "oceanleo.dev-selection.v1";
const ACCENT = "#ea580c";
const DETERMINISTIC_SOURCE_REQUIRED =
  "此源码不支持确定性就地编辑，请先转换为 OceanLeo 网站文档";

type EditorContext = EmbedEditorQueryContext;

interface SiteSessionResponse {
  session_id: string;
  preview_url: string;
  ready?: boolean;
  running?: boolean;
  http_code?: number;
  compile_errors?: string[];
  project_id?: string;
  base_revision_id?: string | null;
  working_revision_id?: string | null;
  last_healthy_revision_id?: string | null;
  head_version?: number;
  draft_change_count?: number;
  undo_depth?: number;
  redo_depth?: number;
  history_version?: number;
}

interface MutationResponse {
  ok: boolean;
  project_id?: string;
  session_id?: string;
  applied_indices?: number[];
  unsupported_indices?: number[];
  running?: boolean;
  http_code?: number;
  compile_errors?: string[];
  base_revision_id?: string | null;
  working_revision_id?: string | null;
  last_healthy_revision_id?: string | null;
  head_version?: number;
  draft_change_count?: number;
  undo_depth?: number;
  redo_depth?: number;
  history_version?: number;
}

interface MutationPayload {
  mutations: Array<{
    selection_id: string;
    control_id: string;
    breakpoint: WebsiteEditorBreakpoint;
    value: PendingMutation["value"] | null;
    operation_id?: string;
  }>;
}

interface SnapshotResponse {
  ok: boolean;
  source_snapshot_id: string;
  preview_url: string;
}

interface ProjectResponse {
  site?: {
    id: string;
    name: string;
    siteUrl?: string | null;
    githubRepo?: string | null;
  };
  config?: unknown;
  error?: string;
}

interface StarterResponse {
  title?: string;
  config?: unknown;
  detail?: string;
}

interface SessionLaunch {
  projectId: string;
  artifactId: string;
  revisionId: string;
  starterId: string;
  sourceSnapshotId: string;
  githubRepo: string;
  commitSha: string;
  assetName: string;
  blank: boolean;
}

export interface WebsiteProjectWorkbenchModuleContext {
  title: string;
  projectId: string;
  sessionId: string | null;
  workingRevisionId: string | null;
  lastHealthyRevisionId: string | null;
  headVersion: number;
}

export type WebsiteProjectWorkbenchModuleSlot =
  | ProjectWorkbenchModule
  | ((
      context: WebsiteProjectWorkbenchModuleContext,
    ) => ProjectWorkbenchModule);

export interface DevSiteEditorClientProps {
  modules?: Partial<
    Record<ManagementWorkbenchView, WebsiteProjectWorkbenchModuleSlot>
  >;
}

interface SessionIssue {
  kind: "expired" | "compile" | "unavailable";
  title: string;
  description: string;
}

const EMPTY_CONTEXT: EditorContext = EMPTY_EMBED_EDITOR_QUERY;

function queryContext(): EditorContext {
  if (typeof window === "undefined") return EMPTY_CONTEXT;
  return parseEmbedEditorQuery(window.location.search);
}

function queryWorkbenchView(): WorkbenchView {
  if (typeof window === "undefined") return "preview";
  const view = new URLSearchParams(window.location.search).get("view");
  return isWorkbenchView(view) ? view : "preview";
}

function configRoutes(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["/"];
  const pages = (value as { pages?: unknown }).pages;
  if (!Array.isArray(pages)) return ["/"];
  const routes = pages.flatMap((page) => {
    if (!page || typeof page !== "object" || Array.isArray(page)) return [];
    const candidate = normalizePreviewRoute(
      String((page as Record<string, unknown>).path || ""),
    );
    return candidate ? [candidate] : [];
  });
  return [...new Set(["/", ...routes])];
}

function historyAfterMutation(
  response: MutationResponse,
  current: DraftHistoryState,
  appliedCount: number,
): DraftHistoryState {
  const complete =
    Object.prototype.hasOwnProperty.call(response, "base_revision_id") &&
    (response.base_revision_id === null ||
      typeof response.base_revision_id === "string") &&
    Number.isSafeInteger(response.draft_change_count) &&
    Number.isSafeInteger(response.undo_depth) &&
    Number.isSafeInteger(response.redo_depth) &&
    Number.isSafeInteger(response.history_version);
  if (complete) {
    return {
      base_revision_id:
        typeof response.base_revision_id === "string"
          ? response.base_revision_id
          : null,
      draft_change_count: Math.max(0, response.draft_change_count || 0),
      undo_depth: Math.max(0, response.undo_depth || 0),
      redo_depth: Math.max(0, response.redo_depth || 0),
      history_version: Math.max(0, response.history_version || 0),
    };
  }
  return {
    ...current,
    draft_change_count: current.draft_change_count + appliedCount,
    undo_depth: current.undo_depth + 1,
    redo_depth: 0,
    history_version: current.history_version + 1,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function trustedPreviewUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    const capabilityHost =
      url.protocol === "https:" &&
      /^p\d{2,5}-[a-f0-9]{32}(?:--[a-z0-9-]+)?\.website\.oceanleo\.com$/i.test(
        url.hostname,
      );
    if (capabilityHost) return true;
    return (
      process.env.NODE_ENV !== "production" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      (url.protocol === "http:" || url.protocol === "https:")
    );
  } catch {
    return false;
  }
}

function sourcePackageName(value: string): string {
  const base = value
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 80);
  return `${base || "oceanleo-website"}-source.zip`;
}

function friendlyEditorError(error: string | undefined, status?: number): string {
  if (status === 401) return "登录状态已失效，请重新登录 OceanLeo";
  if (status === 404 || status === 410) {
    return "这个编辑会话已休眠，请重新打开网站继续编辑";
  }
  if (status === 409) return "暂时无法恢复这个网站的已保存源码";
  if (status === 429 || status === 503) {
    return "网站编辑服务当前繁忙，请稍后重试";
  }
  if (status && status >= 500) return "网站编辑服务暂时不可用，请稍后重试";
  if (error?.includes("Failed to fetch") || error?.includes("网络")) {
    return "网络连接暂时中断，请检查后重试";
  }
  return error && !/HTTP\s*\d+|Error:|Module parse|Failed to compile/i.test(error)
    ? error
    : "网站编辑器暂时无法启动，请稍后重试";
}

function friendlyMutationError(error: string | undefined, status?: number): string {
  if (status === 401) return "登录状态已失效，请重新登录 OceanLeo";
  if (status === 404 || status === 410) {
    return "这个编辑会话已休眠，请重新打开网站继续编辑";
  }
  if (status === 409 || status === 422) {
    return "这项修改未能安全写回，预览将恢复到上次保存状态";
  }
  if (status === 429 || status === 503) {
    return "网站编辑服务当前繁忙，修改仍保留在当前编辑会话";
  }
  if (status && status >= 500) {
    return "网站编辑服务暂时不可用，修改仍保留在当前编辑会话";
  }
  if (error?.includes("Failed to fetch") || error?.includes("网络")) {
    return "网络连接暂时中断，修改仍保留在当前编辑会话";
  }
  return "源码写回未完成，请稍后重试";
}

function issueFromHealth(
  health: SiteSessionResponse | undefined,
): SessionIssue | null {
  if (!health?.running) {
    return {
      kind: "unavailable",
      title: "网站预览暂时未就绪",
      description: "编辑服务没有正常启动预览，重新打开网站即可重试。",
    };
  }
  if (
    (health.http_code || 0) >= 500 ||
    (health.compile_errors || []).length > 0
  ) {
    return {
      kind: "compile",
      title: "页面源码暂时无法预览",
      description:
        "编辑器已隐藏内部编译代码。源码修复后可重新检查，也可以随时用上方返回按钮离开。",
    };
  }
  return null;
}

export function DevSiteEditorClient({
  modules: childModules = {},
}: DevSiteEditorClientProps = {}) {
  const hydrated = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  const context = hydrated ? queryContext() : EMPTY_CONTEXT;
  const trustedHost = useMemo(() => {
    if (!context.host || !isTrustedEditorOrigin(context.host)) return "";
    try {
      const url = new URL(context.host);
      return url.origin === context.host ? url.origin : "";
    } catch {
      return "";
    }
  }, [context.host]);
  const standalone =
    hydrated && typeof window !== "undefined" && window.parent === window;
  useEffect(() => {
    if (standalone) window.location.replace("/workspace");
  }, [standalone]);
  const [title, setTitle] = useState("动态网站编辑器");
  const [sessionId, setSessionId] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewNonce, setPreviewNonce] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewDirty, setDirty] = useState(false);
  const [, setStatus] = useState("等待启动 dev 网站");
  const [sessionIssue, setSessionIssue] = useState<SessionIssue | null>(null);
  const [viewportDevice, setViewportDevice] =
    useState<PreviewDevice>("desktop");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("view");
  const [previewRoute, setPreviewRoute] = useState("/");
  const [previewRoutes, setPreviewRoutes] = useState<string[]>(["/"]);
  const [activeView, setActiveView] = useState<WorkbenchView>("preview");
  const [selection, setSelection] = useState<ReturnType<
    typeof selectionContext
  >>(null);
  const [draftHistory, setDraftHistory] =
    useState<DraftHistoryState>(EMPTY_DRAFT_HISTORY);
  const [draftAction, setDraftAction] = useState<{
    busy: "apply" | "discard" | "undo" | "redo" | null;
    message: string;
    unavailable: boolean;
  }>({ busy: null, message: "", unavailable: false });
  const [workingRevisionId, setWorkingRevisionId] = useState<string | null>(
    null,
  );
  const [lastHealthyRevisionId, setLastHealthyRevisionId] = useState<
    string | null
  >(null);
  const [headVersion, setHeadVersion] = useState(0);
  const [canonicalProjectId, setCanonicalProjectId] = useState("");
  const [codeDirty, setCodeDirty] = useState(false);
  const [historyRequestNonce, setHistoryRequestNonce] = useState(0);
  const [contextMenuRequest, setContextMenuRequest] = useState<{
    x: number;
    y: number;
    nonce: number;
  } | null>(null);
  const previewRef = useRef<HTMLIFrameElement>(null);
  const sessionRef = useRef("");
  const projectRef = useRef("");
  const titleRef = useRef(title);
  const revisionRef = useRef(0);
  const pendingSaveRef = useRef<{ saveId: string; revision: number } | null>(null);
  const disposedRef = useRef(false);
  const loadGenerationRef = useRef(0);
  const loadedKeyRef = useRef("");
  const lastLaunchRef = useRef<SessionLaunch | null>(null);
  const sourcePreviewRef = useRef("");
  const selectionRef = useRef<DomSelection | null>(null);
  const selectionEpochRef = useRef(0);
  const activeSelectionIdentityRef = useRef("");
  const breakpointRef = useRef<WebsiteEditorBreakpoint>("desktop");
  const structuredBridgeRef = useRef(false);
  const pendingMutationsRef = useRef(new LatestMutationBuffer());
  const pendingSelectionCommandsRef = useRef(
    new Map<
      string,
      {
        command: WebsiteSelectionCommand;
        timer: number;
      }
    >(),
  );
  const selectionCommandGateRef = useRef(
    new WebsiteSelectionCommandGate(),
  );
  const pendingMaterialsRef = useRef(
    new Map<
      string,
      {
        url: string;
        title: string;
        timer: number;
      }
    >(),
  );
  const persistTimerRef = useRef<number | null>(null);
  const persistingRef = useRef(false);
  const persistenceRunnerRef = useRef<() => void>(() => undefined);
  const persistenceErrorRef = useRef("");
  const authTokenRef = useRef("");
  const disposedSessionIdsRef = useRef(new Set<string>());
  const projectBoundSessionIdsRef = useRef(new Map<string, string>());
  const previewUrlRef = useRef(previewUrl);
  const instanceIdRef = useRef(context.instanceId);
  const draftHistoryRef = useRef<DraftHistoryState>(EMPTY_DRAFT_HISTORY);
  const workingRevisionIdRef = useRef<string | null>(null);
  const headVersionRef = useRef(0);

  useEffect(() => {
    sessionRef.current = sessionId;
  }, [sessionId]);
  useEffect(() => {
    titleRef.current = title;
  }, [title]);
  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);
  useEffect(() => {
    instanceIdRef.current = context.instanceId;
  }, [context.instanceId]);
  useEffect(() => {
    draftHistoryRef.current = draftHistory;
  }, [draftHistory]);
  useEffect(() => {
    workingRevisionIdRef.current = workingRevisionId;
  }, [workingRevisionId]);
  useEffect(() => {
    headVersionRef.current = headVersion;
  }, [headVersion]);
  useEffect(() => {
    if (!hydrated) return;
    setActiveView(queryWorkbenchView());
  }, [hydrated]);

  const changeActiveView = useCallback((view: WorkbenchView) => {
    setActiveView(view);
    const url = new URL(window.location.href);
    url.searchParams.set("view", view);
    window.history.replaceState(window.history.state, "", url);
  }, []);
  const clearPendingSelectionCommands = useCallback(() => {
    pendingSelectionCommandsRef.current.forEach((pending) =>
      window.clearTimeout(pending.timer),
    );
    pendingSelectionCommandsRef.current.clear();
    selectionCommandGateRef.current.clear();
  }, []);
  const resetPreviewTransaction = useCallback(
    (
      reason: string,
      frame = previewRef.current?.contentWindow,
      sourceUrl = previewUrlRef.current,
    ) => {
      if (!frame || !sourceUrl || !trustedPreviewUrl(sourceUrl)) return;
      try {
        frame.postMessage(
          {
            protocol: DEV_PROTOCOL,
            instanceId: instanceIdRef.current,
            type: "generated-transaction-reset",
            reason,
          },
          new URL(sourceUrl).origin,
        );
      } catch {
        // A navigating or already-disposed preview needs no further cleanup.
      }
    },
    [],
  );

  const disposeSiteSession = useCallback(
    (disposedSession: string, keepalive: boolean) => {
      if (
        !disposedSession ||
        disposedSessionIdsRef.current.has(disposedSession)
      ) {
        return false;
      }
      disposedSessionIdsRef.current.add(disposedSession);
      const projectId = projectBoundSessionIdsRef.current.get(disposedSession);
      projectBoundSessionIdsRef.current.delete(disposedSession);
      const path = projectId
        ? `/v1/website-projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(disposedSession)}`
        : `/v1/site-editor/sessions/${encodeURIComponent(disposedSession)}`;
      const token = authTokenRef.current;
      if (!token) {
        void authed(path, { method: "DELETE", keepalive });
        return true;
      }
      void fetch(`${GATEWAY_BASE}${path}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        keepalive,
      }).catch(() => undefined);
      return true;
    },
    [],
  );

  const closeCurrentSession = useCallback(
    (keepalive: boolean) => {
      resetPreviewTransaction("host-dispose");
      disposedRef.current = true;
      loadGenerationRef.current += 1;
      const current = sessionRef.current;
      sessionRef.current = "";
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      clearPendingSelectionCommands();
      if (current) disposeSiteSession(current, keepalive);
    },
    [
      clearPendingSelectionCommands,
      disposeSiteSession,
      resetPreviewTransaction,
    ],
  );

  const postToHost = useCallback(
    (message: Record<string, unknown>) => {
      if (
        !trustedHost ||
        !context.instanceId ||
        window.parent === window ||
        disposedRef.current
      ) {
        return;
      }
      window.parent.postMessage(
        {
          protocol: EDITOR_PROTOCOL,
          instanceId: context.instanceId,
          ...message,
        },
        trustedHost,
      );
    },
    [context.instanceId, trustedHost],
  );

  const publishDraftHistory = useCallback(
    (
      next:
        | DraftHistoryState
        | ((current: DraftHistoryState) => DraftHistoryState),
      reason: string,
    ) => {
      const value =
        typeof next === "function"
          ? next(draftHistoryRef.current)
          : next;
      draftHistoryRef.current = value;
      setDraftHistory(value);
      const dirty = value.draft_change_count > 0;
      setDirty(dirty);
      postToHost({
        type: "dirty",
        dirty,
        revision: revisionRef.current,
      });
      postToHost({
        type: "history-changed",
        reason,
        history: value,
        workingRevisionId: workingRevisionIdRef.current || undefined,
        headVersion: headVersionRef.current,
      });
    },
    [postToHost],
  );

  const previewSrc = useMemo(() => {
    if (!previewUrl || !hydrated) return "";
    const url = new URL(previewUrl);
    const route = normalizePreviewRoute(previewRoute) || "/";
    const routeUrl = new URL(route, url.origin);
    url.pathname = routeUrl.pathname;
    routeUrl.searchParams.forEach((value, key) =>
      url.searchParams.set(key, value),
    );
    url.hash = routeUrl.hash;
    url.searchParams.set("oceanleoEditor", previewMode === "edit" ? "1" : "0");
    url.searchParams.set("oceanleoInstance", context.instanceId);
    url.searchParams.set("oceanleoController", window.location.origin);
    url.searchParams.set("oceanleoRefresh", String(previewNonce));
    return url.toString();
  }, [
    context.instanceId,
    hydrated,
    previewMode,
    previewNonce,
    previewRoute,
    previewUrl,
  ]);
  useEffect(() => {
    const frame = previewRef.current?.contentWindow;
    const sourceUrl = previewUrl;
    structuredBridgeRef.current = false;
    clearPendingSelectionCommands();
    selectionRef.current = null;
    activeSelectionIdentityRef.current = "";
    setSelection(null);
    postToHost({ type: "selection-changed", selection: null });
    return () =>
      resetPreviewTransaction("preview-replaced", frame, sourceUrl);
  }, [
    clearPendingSelectionCommands,
    postToHost,
    previewSrc,
    previewUrl,
    resetPreviewTransaction,
  ]);

  const runPersistenceQueue = useCallback(async () => {
    if (persistingRef.current || disposedRef.current || !sessionRef.current) return;
    const mutations = pendingMutationsRef.current.take(16);
    if (!mutations.length) return;
    const requestSession = sessionRef.current;
    persistingRef.current = true;
    persistenceErrorRef.current = "";
    setStatus("正在自动保存");
    const payload: MutationPayload = {
      mutations: mutations.map((mutation) => ({
        selection_id: mutation.selectionId,
        control_id: mutation.controlId,
        breakpoint: mutation.breakpoint,
        value: mutation.value ?? null,
        ...(mutation.operationId
          ? { operation_id: mutation.operationId }
          : {}),
      })),
    };
    const requestProject =
      projectBoundSessionIdsRef.current.get(requestSession);
    const mutationPath = requestProject
      ? `/v1/website-projects/${encodeURIComponent(requestProject)}/sessions/${encodeURIComponent(requestSession)}/mutations`
      : `/v1/site-editor/sessions/${encodeURIComponent(requestSession)}/mutations`;
    const direct = await authed<MutationResponse>(
      mutationPath,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
    if (disposedRef.current || requestSession !== sessionRef.current) {
      persistingRef.current = false;
      return;
    }
    if (!direct.ok || !direct.data?.ok) {
      const sourceIsNotDeterministic =
        direct.status === 409 &&
        /(?:没有可验证的\s*siteConfig|site_config_not_mutable)/i.test(
          direct.error || "",
        );
      if (sourceIsNotDeterministic) {
        resetPreviewTransaction("site-config-not-mutable");
        clearPendingSelectionCommands();
        pendingMutationsRef.current.clear();
        selectionRef.current = null;
        activeSelectionIdentityRef.current = "";
        structuredBridgeRef.current = false;
        persistenceErrorRef.current = DETERMINISTIC_SOURCE_REQUIRED;
        setStatus(DETERMINISTIC_SOURCE_REQUIRED);
        setSessionIssue({
          kind: "compile",
          title: "此源码不支持确定性就地编辑",
          description: DETERMINISTIC_SOURCE_REQUIRED,
        });
        postToHost({
          type: "error",
          message: DETERMINISTIC_SOURCE_REQUIRED,
        });
        postToHost({ type: "selection-changed", selection: null });
        setPreviewNonce((value) => value + 1);
        persistingRef.current = false;
        publishDraftHistory(
          draftHistoryRef.current,
          "mutation-source-rejected",
        );
        return;
      }
      const message = friendlyMutationError(direct.error, direct.status);
      // Structural edits carry operation ids, so a lost response can safely
      // replay against the gateway's owner/session-scoped result cache.
      pendingMutationsRef.current.restore(
        mutations.filter(isReplaySafeMutation),
      );
      persistenceErrorRef.current = message;
      setStatus(message);
      setSessionIssue({
        kind: "compile",
        title: "这项修改未能完成",
        description:
          "编辑器已隐藏内部构建信息，并重新载入当前可用源码。可以重新检查或继续返回。",
      });
      postToHost({ type: "error", message });
      // The sandbox endpoint is atomic and rolls unhealthy writes back. Reload
      // the iframe so optimistic property previews cannot masquerade as saved.
      setPreviewNonce((value) => value + 1);
      persistingRef.current = false;
      if (!pendingMutationsRef.current.size) {
        publishDraftHistory(draftHistoryRef.current, "mutation-failed");
      }
      return;
    }
    if (
      requestProject &&
      ((direct.data.project_id &&
        direct.data.project_id !== requestProject) ||
        (direct.data.session_id &&
          direct.data.session_id !== requestSession))
    ) {
      const message =
        "Mutation response identity did not match the active project session.";
      persistenceErrorRef.current = message;
      setSessionIssue({
        kind: "unavailable",
        title: "项目会话身份不一致",
        description: message,
      });
      setPreviewNonce((value) => value + 1);
      persistingRef.current = false;
      postToHost({ type: "error", message });
      return;
    }
    const mutationResponse = direct.data;
    const appliedIndices = new Set(
      (direct.data.applied_indices || []).filter(
        (index) => Number.isInteger(index) && index >= 0 && index < mutations.length,
      ),
    );
    const unsupportedIndices = new Set(
      (direct.data.unsupported_indices || []).filter(
        (index) => Number.isInteger(index) && index >= 0 && index < mutations.length,
      ),
    );
    const unsupportedMutations = mutations.filter(
      (_, index) => !appliedIndices.has(index),
    );
    for (const index of unsupportedIndices) {
      if (!appliedIndices.has(index) && !unsupportedMutations.includes(mutations[index])) {
        unsupportedMutations.push(mutations[index]);
      }
    }
    if (unsupportedMutations.length) {
      const message = "这项修改没有稳定源码映射，源码未写入";
      persistenceErrorRef.current = message;
      setStatus(message);
      setSessionIssue({
        kind: "compile",
        title: "这项修改无法安全保存",
        description:
          "当前元素没有可验证的源码映射，编辑器已恢复当前已保存内容。",
      });
      postToHost({ type: "error", message });
      setPreviewNonce((value) => value + 1);
      persistingRef.current = false;
      if (!pendingMutationsRef.current.size) {
        publishDraftHistory(draftHistoryRef.current, "mutation-unsupported");
      }
      return;
    }
    persistenceErrorRef.current = "";
    setSessionIssue(null);
    if (requestProject) {
      if (
        typeof direct.data.head_version === "number" &&
        Number.isSafeInteger(direct.data.head_version) &&
        direct.data.head_version >= 0
      ) {
        headVersionRef.current = direct.data.head_version;
        setHeadVersion(direct.data.head_version);
      }
      if (typeof direct.data.working_revision_id === "string") {
        workingRevisionIdRef.current = direct.data.working_revision_id;
        setWorkingRevisionId(direct.data.working_revision_id);
      }
      if (
        direct.data.last_healthy_revision_id === null ||
        typeof direct.data.last_healthy_revision_id === "string"
      ) {
        setLastHealthyRevisionId(
          direct.data.last_healthy_revision_id || null,
        );
      }
      setStatus("修改已写入 session draft，等待 Apply");
      publishDraftHistory(
        (current) =>
          historyAfterMutation(
            mutationResponse,
            current,
            appliedIndices.size,
          ),
        "mutation-persisted",
      );
    } else {
      setStatus("已保存（兼容模式自动写回；当前环境不提供 Apply）");
      publishDraftHistory(
        (current) => ({
          ...current,
          draft_change_count: 0,
          undo_depth: 0,
          redo_depth: 0,
        }),
        "legacy-mutation-persisted",
      );
    }
    persistingRef.current = false;
    if (pendingMutationsRef.current.size) {
      window.setTimeout(() => persistenceRunnerRef.current(), 0);
    }
  }, [
    clearPendingSelectionCommands,
    postToHost,
    publishDraftHistory,
    resetPreviewTransaction,
  ]);
  useEffect(() => {
    persistenceRunnerRef.current = () => {
      void runPersistenceQueue();
    };
    return () => {
      persistenceRunnerRef.current = () => undefined;
    };
  }, [runPersistenceQueue]);

  const scheduleMutationPersistence = useCallback(
    (delay: number) => {
      persistTimerRef.current = debounceMutationFlush(
        persistTimerRef.current,
        (flush, timeout) => window.setTimeout(flush, timeout),
        (timer) => window.clearTimeout(timer),
        () => {
          persistTimerRef.current = null;
          void runPersistenceQueue();
        },
        delay,
      );
    },
    [runPersistenceQueue],
  );

  const queueMutation = useCallback(
    (command: WebsiteSelectionCommand) => {
      if (!shouldPersistSelectionCommand(command)) return;
      if (
        !isStableEditorId(command.selectionId) ||
        !isDeterministicMutationControl(command.controlId)
      ) {
        const message = "这个控件没有确定性的源码 mutation，已拒绝修改";
        persistenceErrorRef.current = message;
        setStatus(message);
        postToHost({ type: "error", message });
        return;
      }
      const mutation = pendingMutationFromCommand(
        command.selectionId,
        command.controlId,
        command.value,
        command.requestId,
        command.breakpoint ?? breakpointRef.current,
      );
      if (!mutation) return;
      persistenceErrorRef.current = "";
      pendingMutationsRef.current.upsert(mutation);
      revisionRef.current += 1;
      setDirty(true);
      setStatus("正在自动保存");
      postToHost({
        type: "dirty",
        dirty: true,
        revision: revisionRef.current,
      });
      scheduleMutationPersistence(
        ["duplicate", "delete", "move-up", "move-down"].includes(
          command.controlId,
        )
          ? 0
          : 250,
      );
    },
    [postToHost, scheduleMutationPersistence],
  );
  const queueInlineTextPersistence = useCallback(
    (
      target: {
        id: string;
      },
      value: string,
    ) => {
      if (!isStableEditorId(target.id)) {
        const message = "该预览元素没有稳定 data-editor-id，文字未写回源码";
        persistenceErrorRef.current = message;
        postToHost({ type: "error", message });
        return;
      }
      persistenceErrorRef.current = "";
      pendingMutationsRef.current.upsert({
        selectionId: target.id,
        controlId: "text",
        breakpoint: "base",
        value,
      });
      revisionRef.current += 1;
      setDirty(true);
      setStatus("正在自动保存");
      postToHost({
        type: "dirty",
        dirty: true,
        revision: revisionRef.current,
      });
      scheduleMutationPersistence(0);
    },
    [postToHost, scheduleMutationPersistence],
  );
  const queueMaterialPersistence = useCallback(
    (
      selectionId: string,
      material: { url: string; title: string },
      operationId: string,
    ) => {
      persistenceErrorRef.current = "";
      pendingMutationsRef.current.upsert({
        selectionId,
        controlId: "insert-image",
        breakpoint: "base",
        value: JSON.stringify({
          url: material.url,
          alt: material.title,
          responsive: true,
          target_selection_id: selectionId,
        }),
        operationId,
      });
      revisionRef.current += 1;
      setDirty(true);
      setStatus("正在自动保存");
      postToHost({
        type: "dirty",
        dirty: true,
        revision: revisionRef.current,
      });
      scheduleMutationPersistence(300);
    },
    [postToHost, scheduleMutationPersistence],
  );

  const flushPersistence = useCallback(async () => {
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    if (!persistingRef.current && pendingMutationsRef.current.size) {
      persistenceErrorRef.current = "";
      await runPersistenceQueue();
    }
    const deadline = Date.now() + 4 * 60_000;
    while (
      (persistingRef.current || pendingMutationsRef.current.size) &&
      Date.now() < deadline
    ) {
      if (!persistingRef.current && pendingMutationsRef.current.size) {
        if (persistenceErrorRef.current) {
          throw new Error(persistenceErrorRef.current);
        }
        await runPersistenceQueue();
      } else {
        await sleep(100);
      }
    }
    if (persistenceErrorRef.current) {
      throw new Error(persistenceErrorRef.current);
    }
    if (persistingRef.current || pendingMutationsRef.current.size) {
      throw new Error("源码写回超时，尚未保存当前修改");
    }
  }, [runPersistenceQueue]);

  const applyDraft = useCallback(async () => {
    const projectId = projectRef.current;
    const currentSession = sessionRef.current;
    if (!projectId || !currentSession) {
      setDraftAction({
        busy: null,
        message:
          "Apply requires a canonical project-bound session; this legacy source remains unchanged.",
        unavailable: true,
      });
      return false;
    }
    setDraftAction({
      busy: "apply",
      message: "Flushing session mutations before Apply…",
      unavailable: false,
    });
    try {
      await flushPersistence();
    } catch (caught) {
      setDraftAction({
        busy: null,
        message:
          caught instanceof Error
            ? caught.message
            : "Pending mutations could not be flushed.",
        unavailable: false,
      });
      return false;
    }
    const result = await applyProjectDraft(projectId, currentSession, {
      expected_base_revision_id:
        draftHistoryRef.current.base_revision_id,
      expected_head_version: headVersionRef.current,
      idempotency_key: requestId("visual-apply"),
    });
    if (!result.ok) {
      setDraftAction({
        busy: null,
        message: result.unavailable
          ? "Canonical Apply API unavailable. The session draft is preserved and the working revision was not changed."
          : result.message,
        unavailable: result.unavailable,
      });
      return false;
    }
    if (
      result.data.project_id !== projectId ||
      result.data.session_id !== currentSession
    ) {
      setDraftAction({
        busy: null,
        message:
          "Apply response identity did not match the active project session.",
        unavailable: true,
      });
      return false;
    }
    const nextHeadVersion = Math.max(0, result.data.head_version);
    headVersionRef.current = nextHeadVersion;
    setHeadVersion(nextHeadVersion);
    workingRevisionIdRef.current = result.data.working_revision_id;
    setWorkingRevisionId(result.data.working_revision_id);
    setLastHealthyRevisionId(result.data.last_healthy_revision_id);
    revisionRef.current += 1;
    publishDraftHistory(
      {
        base_revision_id:
          result.data.base_revision_id ||
          result.data.working_revision_id,
        draft_change_count: 0,
        undo_depth: 0,
        redo_depth: 0,
        history_version: Math.max(0, result.data.history_version),
      },
      "draft-applied",
    );
    setDraftAction({
      busy: null,
      message: `Applied revision ${result.data.working_revision_id.slice(0, 8)}.`,
      unavailable: false,
    });
    window.dispatchEvent(
      new CustomEvent("oceanleo:website-project-history-changed", {
        detail: {
          projectId,
          revisionId: result.data.working_revision_id,
          headVersion: nextHeadVersion,
          origin: "visual_edit",
        },
      }),
    );
    return true;
  }, [flushPersistence, publishDraftHistory]);

  const discardDraft = useCallback(async () => {
    const projectId = projectRef.current;
    const currentSession = sessionRef.current;
    if (!projectId || !currentSession) {
      setDraftAction({
        busy: null,
        message: "Discard requires a canonical project-bound session.",
        unavailable: true,
      });
      return;
    }
    setDraftAction({
      busy: "discard",
      message: "Restoring the session base revision…",
      unavailable: false,
    });
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    pendingMutationsRef.current.clear();
    clearPendingSelectionCommands();
    resetPreviewTransaction("project-discard");
    const deadline = Date.now() + 10_000;
    while (persistingRef.current && Date.now() < deadline) {
      await sleep(50);
    }
    if (persistingRef.current) {
      setDraftAction({
        busy: null,
        message: "A mutation request is still in flight; Discard was not sent.",
        unavailable: false,
      });
      return;
    }
    const result = await discardProjectDraft(projectId, currentSession, {
      expected_base_revision_id:
        draftHistoryRef.current.base_revision_id,
      expected_head_version: headVersionRef.current,
      idempotency_key: requestId("visual-discard"),
    });
    if (!result.ok) {
      setDraftAction({
        busy: null,
        message: result.unavailable
          ? "Canonical Discard API unavailable. The server draft was not reported as discarded."
          : result.message,
        unavailable: result.unavailable,
      });
      return;
    }
    if (
      result.data.project_id !== projectId ||
      result.data.session_id !== currentSession
    ) {
      setDraftAction({
        busy: null,
        message:
          "Discard response identity did not match the active project session.",
        unavailable: true,
      });
      return;
    }
    const nextHeadVersion = Math.max(0, result.data.head_version);
    headVersionRef.current = nextHeadVersion;
    setHeadVersion(nextHeadVersion);
    workingRevisionIdRef.current = result.data.working_revision_id;
    setWorkingRevisionId(result.data.working_revision_id);
    setLastHealthyRevisionId(result.data.last_healthy_revision_id);
    publishDraftHistory(
      {
        base_revision_id:
          result.data.base_revision_id ||
          result.data.working_revision_id,
        draft_change_count: 0,
        undo_depth: 0,
        redo_depth: 0,
        history_version: Math.max(0, result.data.history_version),
      },
      "draft-discarded",
    );
    selectionRef.current = null;
    activeSelectionIdentityRef.current = "";
    setSelection(null);
    setPreviewNonce((value) => value + 1);
    setDraftAction({
      busy: null,
      message: "Session draft discarded; base revision restored.",
      unavailable: false,
    });
  }, [
    clearPendingSelectionCommands,
    publishDraftHistory,
    resetPreviewTransaction,
  ]);

  const changeDraftHistory = useCallback(
    async (direction: "undo" | "redo") => {
      const projectId = projectRef.current;
      const currentSession = sessionRef.current;
      if (!projectId || !currentSession) {
        setDraftAction({
          busy: null,
          message: `${direction} requires a canonical project-bound session.`,
          unavailable: true,
        });
        return;
      }
      setDraftAction({
        busy: direction,
        message: `${direction === "undo" ? "Undoing" : "Redoing"} session mutation…`,
        unavailable: false,
      });
      try {
        await flushPersistence();
      } catch (caught) {
        setDraftAction({
          busy: null,
          message:
            caught instanceof Error
              ? caught.message
              : "Pending mutations could not be flushed.",
          unavailable: false,
        });
        return;
      }
      const result = await changeProjectDraftHistory(
        direction,
        projectId,
        currentSession,
        {
          expected_history_version:
            draftHistoryRef.current.history_version,
          idempotency_key: requestId(`visual-${direction}`),
        },
      );
      if (!result.ok) {
        setDraftAction({
          busy: null,
          message: result.unavailable
            ? `Canonical ${direction} API unavailable. No local-only history action was applied.`
            : result.message,
          unavailable: result.unavailable,
        });
        return;
      }
      if (
        result.data.project_id !== projectId ||
        result.data.session_id !== currentSession
      ) {
        setDraftAction({
          busy: null,
          message: `${direction} response identity did not match the active project session.`,
          unavailable: true,
        });
        return;
      }
      publishDraftHistory(
        {
          base_revision_id: result.data.base_revision_id,
          draft_change_count: Math.max(
            0,
            result.data.draft_change_count,
          ),
          undo_depth: Math.max(0, result.data.undo_depth),
          redo_depth: Math.max(0, result.data.redo_depth),
          history_version: Math.max(0, result.data.history_version),
        },
        `draft-${direction}`,
      );
      selectionRef.current = null;
      activeSelectionIdentityRef.current = "";
      setSelection(null);
      setPreviewNonce((value) => value + 1);
      setDraftAction({
        busy: null,
        message: direction === "undo" ? "Undo complete." : "Redo complete.",
        unavailable: false,
      });
    },
    [flushPersistence, publishDraftHistory],
  );

  const startSession = useCallback(
    async (launch: SessionLaunch) => {
      if (disposedRef.current) return;
      const {
      projectId,
      artifactId,
      revisionId,
      starterId,
      sourceSnapshotId,
      githubRepo,
      commitSha,
      assetName,
      blank,
      } = launch;
      const key = `${projectId}:${artifactId}:${revisionId}:${starterId}:${sourceSnapshotId}:${githubRepo}:${commitSha}:${
        blank ? "blank" : ""
      }`;
      if (loadedKeyRef.current === key) return;
      loadedKeyRef.current = key;
      lastLaunchRef.current = launch;
      const generation = ++loadGenerationRef.current;
      const previousSession = sessionRef.current;
      resetPreviewTransaction("host-context-replaced");
      sessionRef.current = "";
      setSessionId("");
      setPreviewUrl("");
      setSessionIssue(null);
      structuredBridgeRef.current = false;
      clearPendingSelectionCommands();
      pendingMutationsRef.current.clear();
      persistenceErrorRef.current = "";
      draftHistoryRef.current = EMPTY_DRAFT_HISTORY;
      setDraftHistory(EMPTY_DRAFT_HISTORY);
      setDirty(false);
      setDraftAction({ busy: null, message: "", unavailable: false });
      workingRevisionIdRef.current = null;
      projectRef.current = "";
      setCanonicalProjectId("");
      setWorkingRevisionId(null);
      setLastHealthyRevisionId(null);
      setHeadVersion(0);
      headVersionRef.current = 0;
      setSelection(null);
      setPreviewMode("view");
      setPreviewRoute("/");
      setPreviewRoutes(["/"]);
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      if (previousSession) {
        disposeSiteSession(previousSession, false);
      }
      setLoading(true);
      selectionRef.current = null;
      activeSelectionIdentityRef.current = "";
      postToHost({ type: "selection-changed", selection: null });
      setStatus("正在启动隔离的 Next.js dev 网站…");
      let files: DevSourceFile[] = [];
      let nextTitle = assetName || "动态网站";
      let liveUrl = "";
      let nextRoutes = ["/"];
      const restoreFromSnapshot = Boolean(sourceSnapshotId);
      const restoreFromGitHub = Boolean(githubRepo);
      try {
        const token = await accessToken();
        if (!token) throw new Error("登录状态已失效，请重新登录 OceanLeo");
        authTokenRef.current = token;
        let resolvedProjectId = "";
        let legacyConfig: unknown = undefined;
        if (projectId && isCanonicalProjectId(projectId)) {
          const existing = await readWebsiteProject(projectId);
          if (existing.ok) {
            const returnedId = existing.data.project?.project_id || "";
            if (returnedId !== projectId || !isCanonicalProjectId(returnedId)) {
              throw new Error(
                "Website Project API returned a different project identity.",
              );
            }
            resolvedProjectId = returnedId;
            nextTitle =
              assetName ||
              existing.data.project.display_name ||
              nextTitle;
          } else if (existing.status !== 404) {
            throw new Error(
              existing.unavailable
                ? "Canonical Website Project API is unavailable; no compatibility save was attempted."
                : existing.message,
            );
          }
        }
        if (
          !resolvedProjectId &&
          artifactId &&
          isCanonicalProjectId(artifactId)
        ) {
          const linked = await readWebsiteProjectByArtifact(artifactId, {
            revisionId:
              revisionId && isCanonicalProjectId(revisionId)
                ? revisionId
                : undefined,
          });
          if (linked.ok) {
            const returnedId = linked.data.project?.project_id || "";
            if (!isCanonicalProjectId(returnedId)) {
              throw new Error(
                "Website Project by-artifact API returned a non-canonical project identity.",
              );
            }
            resolvedProjectId = returnedId;
            nextTitle =
              assetName ||
              linked.data.project.display_name ||
              nextTitle;
          } else if (linked.status !== 404) {
            throw new Error(
              linked.unavailable
                ? "Website Project by-artifact API is unavailable; no compatibility save was attempted."
                : linked.message,
            );
          }
        }
        if (!resolvedProjectId) {
          if (blank && !restoreFromSnapshot && !restoreFromGitHub) {
            files = virtualSiteDevFiles(defaultVirtualSiteConfig);
            nextRoutes = configRoutes(defaultVirtualSiteConfig);
            nextTitle =
              assetName || defaultVirtualSiteConfig.siteName || "未命名网站";
          } else if (
            projectId &&
            !starterId &&
            !restoreFromSnapshot &&
            !restoreFromGitHub
          ) {
            const response = await fetch(
              `/api/sites/${encodeURIComponent(projectId)}/virtual-config`,
              {
                headers: { Authorization: `Bearer ${token}` },
                cache: "no-store",
                signal: AbortSignal.timeout(20_000),
              },
            );
            const data = (await response.json()) as ProjectResponse;
            if (!response.ok) {
              throw new Error(friendlyEditorError(data.error, response.status));
            }
            if (data.site?.id && data.site.id !== projectId) {
              throw new Error(
                "Website config response returned a different legacy identity.",
              );
            }
            nextTitle = assetName || data.site?.name || nextTitle;
            liveUrl = data.site?.siteUrl || "";
            legacyConfig = data.config;
            if (data.config) {
              const config = normalizeVirtualSiteConfig(data.config);
              files = virtualSiteDevFiles(config);
              nextRoutes = configRoutes(config);
            }
          } else if (
            starterId &&
            !blank &&
            !restoreFromSnapshot &&
            !restoreFromGitHub
          ) {
            const response = await fetch(
              `${GATEWAY_BASE}/v1/assets/library/starters/${encodeURIComponent(starterId)}`,
              { cache: "no-store", signal: AbortSignal.timeout(20_000) },
            );
            const data = (await response.json()) as StarterResponse;
            if (!response.ok || !data.config) {
              throw new Error(friendlyEditorError(data.detail, response.status));
            }
            const config = normalizeVirtualSiteConfig(data.config);
            files = virtualSiteDevFiles(config);
            nextRoutes = configRoutes(config);
            nextTitle = assetName || data.title || config.siteName;
          }
          const importInput = {
            display_name: nextTitle,
            default_route: "/",
            source_snapshot_id: sourceSnapshotId || undefined,
            github_repo: githubRepo || undefined,
            commit_sha: commitSha || undefined,
            files: files.length ? files : undefined,
            virtual_site_config: legacyConfig,
          };
          const imported =
            projectId && !starterId
              ? await migrateLegacyWebsiteProject(projectId, importInput)
              : await createWebsiteProject(importInput);
          if (!imported.ok) {
            throw new Error(
              imported.unavailable
                ? "Canonical Website Project creation is unavailable; no legacy session was created."
                : imported.message,
            );
          }
          resolvedProjectId = imported.data.project?.project_id || "";
          if (!isCanonicalProjectId(resolvedProjectId)) {
            throw new Error(
              "Website Project import did not return a canonical project ID.",
            );
          }
          if (artifactId && isCanonicalProjectId(artifactId)) {
            const linked = await linkWebsiteProjectArtifact(resolvedProjectId, {
              artifact_id: artifactId,
              artifact_revision_id:
                revisionId && isCanonicalProjectId(revisionId)
                  ? revisionId
                  : null,
            });
            if (!linked.ok && linked.status !== 404 && !linked.unavailable) {
              throw new Error(linked.message);
            }
          }
        }
        projectRef.current = resolvedProjectId;
        setCanonicalProjectId(resolvedProjectId);
        const canonicalUrl = new URL(window.location.href);
        canonicalUrl.searchParams.set("projectId", resolvedProjectId);
        canonicalUrl.searchParams.delete("siteId");
        window.history.replaceState(
          window.history.state,
          "",
          canonicalUrl,
        );
        postToHost({
          type: "project-resolved",
          projectId: resolvedProjectId,
          project_id: resolvedProjectId,
        });
        const canonical = await createProjectSession(resolvedProjectId, {});
        if (!canonical.ok) {
          throw new Error(
            canonical.unavailable
              ? "Canonical project session API unavailable. No legacy session was created."
              : canonical.message,
          );
        }
        const createdData: SiteSessionResponse | undefined = canonical.data;
        const canonicalSession = true;
        if (!createdData?.session_id) {
          throw new Error("Canonical Website Project session was not created.");
        }
        if (!trustedPreviewUrl(createdData.preview_url)) {
          projectBoundSessionIdsRef.current.set(
            createdData.session_id,
            resolvedProjectId,
          );
          disposeSiteSession(createdData.session_id, true);
          throw new Error("Website preview returned an untrusted origin.");
        }
        if (
          canonicalSession &&
          createdData.project_id !== resolvedProjectId
        ) {
          projectBoundSessionIdsRef.current.set(
            createdData.session_id,
            resolvedProjectId,
          );
          disposeSiteSession(createdData.session_id, true);
          throw new Error(
            "Canonical project session returned a different project identity.",
          );
        }
        if (generation !== loadGenerationRef.current || disposedRef.current) {
          projectBoundSessionIdsRef.current.set(
            createdData.session_id,
            resolvedProjectId,
          );
          disposeSiteSession(createdData.session_id, true);
          return;
        }
        projectBoundSessionIdsRef.current.set(
          createdData.session_id,
          resolvedProjectId,
        );
        projectRef.current = resolvedProjectId;
        sessionRef.current = createdData.session_id;
        titleRef.current = nextTitle;
        setSessionId(createdData.session_id);
        setPreviewUrl(createdData.preview_url);
        setTitle(nextTitle);
        setPreviewRoutes(nextRoutes);
        const nextHistory: DraftHistoryState = {
          base_revision_id: createdData.base_revision_id || null,
          draft_change_count: Math.max(
            0,
            createdData.draft_change_count || 0,
          ),
          undo_depth: Math.max(0, createdData.undo_depth || 0),
          redo_depth: Math.max(0, createdData.redo_depth || 0),
          history_version: Math.max(0, createdData.history_version || 0),
        };
        draftHistoryRef.current = nextHistory;
        setDraftHistory(nextHistory);
        setDirty(nextHistory.draft_change_count > 0);
        workingRevisionIdRef.current =
          createdData.working_revision_id || null;
        setWorkingRevisionId(createdData.working_revision_id || null);
        setLastHealthyRevisionId(
          createdData.last_healthy_revision_id || null,
        );
        const nextHeadVersion = Math.max(0, createdData.head_version || 0);
        setHeadVersion(nextHeadVersion);
        headVersionRef.current = nextHeadVersion;
        const issue = issueFromHealth(createdData);
        setSessionIssue(issue);
        setStatus(
          issue?.description ||
            (restoreFromSnapshot
              ? "已恢复我的库源码 · 点击文字即可原位编辑"
              : files.length
              ? "真实 Next.js dev 已就绪 · 点击文字即可原位编辑"
              : restoreFromGitHub
                ? "已恢复 GitHub 中保存的源码 · 点击文字即可原位编辑"
                : liveUrl
                  ? "dev 已就绪 · 仅稳定编辑目标会确定性写回源码"
                  : "空白 Next.js dev 已就绪 · 可直接开始搭建"),
        );
        postToHost({
          type: "dirty",
          dirty: nextHistory.draft_change_count > 0,
          revision: revisionRef.current,
        });
        postToHost({
          type: "history-changed",
          reason: "session-started",
          history: nextHistory,
          workingRevisionId: createdData.working_revision_id || undefined,
          headVersion: nextHeadVersion,
        });
      } catch (caught) {
        if (
          generation !== loadGenerationRef.current ||
          disposedRef.current
        ) {
          return;
        }
        loadedKeyRef.current = "";
        const message = friendlyEditorError(
          caught instanceof Error ? caught.message : undefined,
        );
        setSessionIssue({
          kind: "unavailable",
          title: "网站编辑器未能启动",
          description: message,
        });
        setStatus(message);
        postToHost({ type: "error", message });
      } finally {
        if (generation === loadGenerationRef.current) setLoading(false);
      }
    },
    [
      clearPendingSelectionCommands,
      disposeSiteSession,
      postToHost,
      resetPreviewTransaction,
    ],
  );

  const refreshSessionHealth = useCallback(async () => {
    const checkedSession = sessionRef.current;
    if (!checkedSession || disposedRef.current) return;
    const checkedProject =
      projectBoundSessionIdsRef.current.get(checkedSession);
    const healthPath = checkedProject
      ? `/v1/website-projects/${encodeURIComponent(checkedProject)}/sessions/${encodeURIComponent(checkedSession)}`
      : `/v1/site-editor/sessions/${encodeURIComponent(checkedSession)}`;
    const result = await authed<SiteSessionResponse>(
      healthPath,
      { cache: "no-store" },
    );
    if (checkedSession !== sessionRef.current || disposedRef.current) return;
    if (!result.ok) {
      // A transient disconnected request must not cover a still-usable preview.
      if (result.status === 0) return;
      const expired = result.status === 404 || result.status === 410;
      const issue: SessionIssue = {
        kind: expired ? "expired" : "unavailable",
        title: expired ? "编辑会话已休眠" : "暂时无法连接编辑服务",
        description: friendlyEditorError(result.error, result.status),
      };
      setSessionIssue(issue);
      setStatus(issue.description);
      return;
    }
    if (
      checkedProject &&
      result.data?.project_id !== checkedProject
    ) {
      const issue: SessionIssue = {
        kind: "unavailable",
        title: "项目会话身份不一致",
        description:
          "编辑服务返回了另一个项目的会话状态；本页已拒绝使用该响应。",
      };
      setSessionIssue(issue);
      setStatus(issue.description);
      return;
    }
    if (
      result.data?.preview_url &&
      result.data.preview_url !== previewUrlRef.current &&
      trustedPreviewUrl(result.data.preview_url)
    ) {
      setPreviewUrl(result.data.preview_url);
      setPreviewNonce((value) => value + 1);
    }
    if (typeof result.data?.working_revision_id === "string") {
      workingRevisionIdRef.current = result.data.working_revision_id;
      setWorkingRevisionId(result.data.working_revision_id);
    }
    if (
      typeof result.data?.head_version === "number" &&
      Number.isSafeInteger(result.data.head_version) &&
      result.data.head_version >= 0
    ) {
      headVersionRef.current = result.data.head_version;
      setHeadVersion(result.data.head_version);
    }
    if (
      result.data?.last_healthy_revision_id === null ||
      typeof result.data?.last_healthy_revision_id === "string"
    ) {
      setLastHealthyRevisionId(
        result.data.last_healthy_revision_id || null,
      );
    }
    if (
      result.data &&
      typeof result.data.history_version === "number" &&
      typeof result.data.draft_change_count === "number"
    ) {
      publishDraftHistory(
        {
          base_revision_id: result.data.base_revision_id || null,
          draft_change_count: Math.max(0, result.data.draft_change_count),
          undo_depth: Math.max(0, result.data.undo_depth || 0),
          redo_depth: Math.max(0, result.data.redo_depth || 0),
          history_version: Math.max(0, result.data.history_version),
        },
        "session-refreshed",
      );
    }
    const issue = issueFromHealth(result.data);
    setSessionIssue(issue);
    if (issue) {
      setStatus(issue.description);
    } else if (!persistingRef.current && pendingMutationsRef.current.size === 0) {
      persistenceErrorRef.current = "";
      setStatus("网站预览连接正常 · 点击文字即可原位编辑");
    }
  }, [publishDraftHistory]);

  useEffect(() => {
    if (!sessionId) return;
    void refreshSessionHealth();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshSessionHealth();
    }, 45_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshSessionHealth();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshSessionHealth, sessionId]);

  const recoverSession = useCallback(() => {
    if (sessionIssue?.kind === "expired" || sessionIssue?.kind === "unavailable") {
      const launch = lastLaunchRef.current;
      if (!launch) return;
      loadedKeyRef.current = "";
      setSessionIssue(null);
      void startSession(launch);
      return;
    }
    setSessionIssue(null);
    setPreviewNonce((value) => value + 1);
    window.setTimeout(() => void refreshSessionHealth(), 1_000);
  }, [refreshSessionHealth, sessionIssue?.kind, startSession]);

  const snapshotCurrentSource = useCallback(async (): Promise<SnapshotResponse> => {
    if (codeDirty) {
      throw new Error(
        "Save the current Code buffer before snapshotting or exporting source.",
      );
    }
    const currentSession = sessionRef.current;
    if (!currentSession || disposedRef.current) {
      throw new Error("网站编辑会话尚未就绪");
    }
    await flushPersistence();
    const currentProject =
      projectBoundSessionIdsRef.current.get(currentSession);
    if (currentProject && draftHistoryRef.current.draft_change_count > 0) {
      const applied = await applyDraft();
      if (!applied) {
        throw new Error(
          "Preview draft was not applied; no durable snapshot was created.",
        );
      }
    }
    if (currentSession !== sessionRef.current || disposedRef.current) {
      throw new Error("网站编辑会话已关闭");
    }
    const snapshotPath = currentProject
      ? `/v1/website-projects/${encodeURIComponent(currentProject)}/sessions/${encodeURIComponent(currentSession)}/snapshot`
      : `/v1/site-editor/sessions/${encodeURIComponent(currentSession)}/snapshot`;
    const result = await authed<SnapshotResponse>(
      snapshotPath,
      { method: "POST" },
    );
    if (
      !result.ok ||
      !result.data?.ok ||
      !/^[a-f0-9]{64}$/.test(result.data.source_snapshot_id) ||
      !trustedPreviewUrl(result.data.preview_url)
    ) {
      throw new Error(
        result.ok
          ? "源码快照保存失败"
          : friendlyMutationError(result.error, result.status),
      );
    }
    return result.data;
  }, [applyDraft, codeDirty, flushPersistence]);

  const saveSnapshot = useCallback(
    async (requestedSaveId?: string) => {
      if (!sessionRef.current || saving) return;
      setSaving(true);
      setStatus("正在确认源码写回…");
      let snapshot: SnapshotResponse;
      try {
        snapshot = await snapshotCurrentSource();
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : "当前修改尚未写回源码";
        setStatus(message);
        postToHost({ type: "error", message });
        setSaving(false);
        return;
      }
      const revision = revisionRef.current;
      const saveId =
        requestedSaveId ||
        `website-dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const launch = lastLaunchRef.current;
      const versionUrl = new URL(snapshot.preview_url);
      versionUrl.searchParams.set(
        "sourceSnapshot",
        snapshot.source_snapshot_id,
      );
      pendingSaveRef.current = { saveId, revision };
      postToHost({
        type: "artifact-updated",
        url: versionUrl.toString(),
        previewUrl: sourcePreviewRef.current || snapshot.preview_url,
        title: `${titleRef.current}-编辑版`,
        saveId,
        meta: {
          editor: "website-dev",
          website_id: projectRef.current || undefined,
          project_id: projectRef.current || undefined,
          artifact_id: launch?.artifactId || undefined,
          revision_id: launch?.revisionId || undefined,
          starter_id: launch?.starterId || undefined,
          source_snapshot_id: snapshot.source_snapshot_id,
          github_repo: launch?.githubRepo || undefined,
          commit_sha: launch?.commitSha || undefined,
        },
      });
      const linkedProjectId = projectRef.current;
      const linkedArtifactId = launch?.artifactId || "";
      if (
        linkedProjectId &&
        isCanonicalProjectId(linkedProjectId) &&
        linkedArtifactId &&
        isCanonicalProjectId(linkedArtifactId)
      ) {
        void linkWebsiteProjectArtifact(linkedProjectId, {
          artifact_id: linkedArtifactId,
          artifact_revision_id:
            launch?.revisionId && isCanonicalProjectId(launch.revisionId)
              ? launch.revisionId
              : null,
        });
      }
      setStatus("源码快照已保存 · 正在登记到我的库…");
      setSaving(false);
    },
    [postToHost, saving, snapshotCurrentSource],
  );

  const downloadSourcePackage = useCallback(
    async (
      reply:
        | { type: "export"; exportId: string }
        | { type: "download"; requestId: string },
    ) => {
      try {
        const snapshot = await snapshotCurrentSource();
        const projectId = projectRef.current;
        const revisionId = workingRevisionIdRef.current;
        const token = authTokenRef.current;
        if (!projectId || !revisionId || !token) {
          throw new Error("Canonical source revision is unavailable.");
        }
        const filename = sourcePackageName(titleRef.current);
        const archiveResponse = await fetch(
          `${GATEWAY_BASE}/v1/website-projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}/archive`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
            signal: AbortSignal.timeout(60_000),
          },
        );
        if (!archiveResponse.ok) {
          throw new Error(`Source archive failed (${archiveResponse.status}).`);
        }
        const archive = await archiveResponse.blob();
        const signature = new Uint8Array(await archive.slice(0, 4).arrayBuffer());
        if (
          signature.length < 4 ||
          signature[0] !== 0x50 ||
          signature[1] !== 0x4b
        ) {
          throw new Error("Source archive did not contain a ZIP payload.");
        }
        const file = new File([archive], filename, {
          type: "application/zip",
        });
        if (reply.type === "export") {
          const uploaded = await uploadFile(file, {
            siteId: "website",
            title: filename,
            registerAsset: false,
            idempotencyKey: `website-source:${projectId}:${revisionId}`,
          });
          const url = uploaded.data?.file?.url || "";
          if (!uploaded.ok || !url) {
            throw new Error(uploaded.error || "网站源码包上传失败");
          }
          postToHost({
            type: "export-result",
            exportId: reply.exportId,
            ok: true,
            url,
          });
          return;
        }
        const href = URL.createObjectURL(
          file,
        );
        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.download = filename;
        anchor.hidden = true;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
        postToHost({
          type: "download-result",
          requestId: reply.requestId,
          ok: true,
          filename,
          sourceSnapshotId: snapshot.source_snapshot_id,
        });
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : "网站源码包下载失败";
        setStatus(message);
        postToHost(
          reply.type === "export"
            ? {
                type: "export-result",
                exportId: reply.exportId,
                ok: false,
                message,
              }
            : {
                type: "download-result",
                requestId: reply.requestId,
                ok: false,
                message,
              },
        );
        postToHost({ type: "error", message });
      }
    },
    [postToHost, snapshotCurrentSource],
  );

  const dispatchSelectionCommand = useCallback(
    (rawCommand: unknown) => {
      const normalizedCommand = normalizeWebsiteSelectionCommand(rawCommand);
      if (!normalizedCommand) return;
      const currentContext = selectionContext(selectionRef.current);
      const accepted = selectionCommandGateRef.current.accept(
        normalizedCommand,
        currentContext,
      );
      if (
        normalizedCommand.controlId === "set-device" ||
        normalizedCommand.controlId === "refresh-preview"
      ) {
        if (accepted) {
          selectionCommandGateRef.current.abort(normalizedCommand);
        }
        postToHost({
          type: "selection-result",
          requestId: normalizedCommand.requestId,
          ok: false,
          message:
            "This global action is not a declared selection capability.",
        });
        return;
      }
      if (
        !structuredBridgeRef.current ||
        !selectionCommandCanReachPreview(
          normalizedCommand,
          selectionRef.current,
        )
      ) {
        if (accepted) {
          selectionCommandGateRef.current.abort(normalizedCommand);
        }
        postToHost({
          type: "selection-result",
          requestId: normalizedCommand.requestId,
          ok: false,
          message: "选择已变化，请重新选择元素后再操作",
        });
        return;
      }
      if (!accepted) {
        postToHost({
          type: "selection-result",
          requestId: normalizedCommand.requestId,
          ok: false,
          message: "选择命令已过期、重复或事务顺序无效",
        });
        return;
      }
      if (
        normalizedCommand.controlId === "responsive-breakpoint" &&
        (normalizedCommand.value === "base" ||
          normalizedCommand.value === "mobile" ||
          normalizedCommand.value === "tablet" ||
          normalizedCommand.value === "desktop")
      ) {
        breakpointRef.current = normalizedCommand.value;
        if (normalizedCommand.value !== "base") {
          setViewportDevice(normalizedCommand.value);
        }
        if (selectionRef.current) {
          selectionRef.current = {
            ...selectionRef.current,
            breakpoint: normalizedCommand.value,
          };
        }
        const next = selectionContext(selectionRef.current);
        setSelection(next);
        postToHost({
          type: "selection-result",
          requestId: normalizedCommand.requestId,
          ok: true,
        });
        postToHost({ type: "selection-changed", selection: next });
        return;
      }
      const command: WebsiteSelectionCommand = {
        ...normalizedCommand,
        breakpoint: breakpointRef.current,
      };
      const target = previewRef.current?.contentWindow;
      const origin =
        previewUrl && trustedPreviewUrl(previewUrl)
          ? new URL(previewUrl).origin
          : "";
      if (
        !target ||
        !origin ||
        pendingSelectionCommandsRef.current.has(command.requestId) ||
        pendingSelectionCommandsRef.current.size >= 64
      ) {
        selectionCommandGateRef.current.abort(command);
        postToHost({
          type: "selection-result",
          requestId: command.requestId,
          ok: false,
          message: "网站预览暂时无法确认这项修改",
        });
        return;
      }
      const timer = window.setTimeout(() => {
        const pending =
          pendingSelectionCommandsRef.current.get(command.requestId);
        if (!pendingSelectionCommandsRef.current.delete(command.requestId)) {
          return;
        }
        if (pending) {
          selectionCommandGateRef.current.abort(pending.command);
        }
        postToHost({
          type: "selection-result",
          requestId: command.requestId,
          ok: false,
          message: "网站预览确认超时，源码未写入",
        });
      }, 5_000);
      pendingSelectionCommandsRef.current.set(command.requestId, {
        command,
        timer,
      });
      target.postMessage(
        {
          protocol: DEV_PROTOCOL,
          instanceId: context.instanceId,
          type: structuredBridgeRef.current
            ? "generated-selection-command"
            : "selection-command",
          command,
        },
        origin,
      );
    },
    [context.instanceId, postToHost, previewUrl],
  );

  useEffect(() => {
    if (!hydrated || !trustedHost || !context.instanceId) return;
    disposedRef.current = false;
    postToHost({
      type: "ready",
      capabilities: {
        persistence: { mode: "structured-mutation" },
        download: {
          requestType: "export-request",
          resultType: "export-result",
          formats: ["default"],
        },
        actions: [
          { id: "download-source", label: "下载源码", icon: "download" },
        ],
      },
    });
    postToHost({
      type: "selection-changed",
      selection: selectionContext(null),
    });
    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== window.parent ||
        event.origin !== trustedHost ||
        !event.data ||
        event.data.protocol !== EDITOR_PROTOCOL ||
        event.data.instanceId !== context.instanceId
      ) {
        return;
      }
      const data = event.data as Record<string, unknown>;
      const canonicalMessage = asHostToEditorMessage(
        event.data,
        context.instanceId,
      );
      if (data.type === "init") {
        postToHost({
          type: "ready",
          capabilities: {
            persistence: { mode: "structured-mutation" },
            download: {
              requestType: "export-request",
              resultType: "export-result",
              formats: ["default"],
            },
            actions: [
              { id: "download-source", label: "下载源码", icon: "download" },
            ],
          },
        });
        postToHost({
          type: "selection-changed",
          selection: selectionContext(null),
        });
      } else if (data.type === "open-asset") {
        const asset =
          data.asset && typeof data.asset === "object"
            ? (data.asset as Record<string, unknown>)
            : {};
        const projectId = assetProjectId(data.asset) || context.projectId;
        const artifactId = assetArtifactId(data.asset) || context.artifactId;
        const revisionId = assetRevisionId(data.asset) || context.revisionId;
        const starterId = assetStarterId(data.asset) || context.starterId;
        const sourceSnapshotId = assetSourceSnapshotId(data.asset) || "";
        const githubRepo = assetGithubRepo(data.asset) || context.githubRepo;
        const commitSha = assetCommitSha(data.asset) || context.commitSha;
        sourcePreviewRef.current =
          (typeof asset.previewUrl === "string" && asset.previewUrl) ||
          (typeof asset.url === "string" && asset.url) ||
          "";
        void startSession({
          projectId: projectId || "",
          artifactId: artifactId || "",
          revisionId: revisionId || "",
          starterId: starterId || "",
          sourceSnapshotId,
          githubRepo: githubRepo || "",
          commitSha: commitSha || "",
          assetName: assetTitle(data.asset),
          blank: context.blank,
        });
      } else if (
        data.type === "material-insert" &&
        canonicalMessage?.type === "material-insert"
      ) {
        const insertion = canonicalMessage.insertion;
        const material = insertion.material;
        const rawPoint = insertion.point;
        const commandId = insertion.commandId;
        const url = material.url || material.previewUrl || "";
        const title = material.title || "网站素材";
        const target = previewRef.current?.contentWindow;
        const origin = previewUrl ? new URL(previewUrl).origin : "";
        const frameRect = previewRef.current?.getBoundingClientRect();
        if (
          !structuredBridgeRef.current ||
          !commandId ||
          insertion?.action !== "insert" ||
          !url ||
          !target ||
          !origin
        ) {
          postToHost({
            type: "material-result",
            commandId: commandId || "invalid",
            ok: false,
            message: "网站预览尚未就绪",
          });
          return;
        }
        const timer = window.setTimeout(() => {
          if (!pendingMaterialsRef.current.delete(commandId)) return;
          postToHost({
            type: "material-result",
            commandId,
            ok: false,
            message: "网站预览添加素材超时",
          });
        }, 15_000);
        pendingMaterialsRef.current.set(commandId, { url, title, timer });
        target.postMessage(
          {
            protocol: DEV_PROTOCOL,
            instanceId: context.instanceId,
            type: "material-insert",
            insertion: {
              commandId,
              action: "insert",
              material: { url, title },
              ...(rawPoint &&
              frameRect &&
              Number.isFinite(rawPoint.x) &&
              Number.isFinite(rawPoint.y)
                ? {
                    point: {
                      x: rawPoint.x - frameRect.left,
                      y: rawPoint.y - frameRect.top,
                    },
                  }
                : {}),
            },
          },
          origin,
        );
      } else if (data.type === "selection-command") {
        dispatchSelectionCommand(data.command);
      } else if (
        data.type === "set-host-layout" &&
        typeof data.sidePanelVisible === "boolean"
      ) {
        // The host always owns chrome for this embedded editor.
      } else if (
        data.type === "save-request" &&
        typeof data.saveId === "string" &&
        data.saveId.length <= 128
      ) {
        void saveSnapshot(data.saveId);
      } else if (data.type === "download-request") {
        const requestId =
          typeof data.requestId === "string" ? data.requestId.slice(0, 128) : "";
        const format =
          typeof data.format === "string" ? data.format.toLowerCase() : "zip";
        if (!["zip", "source-zip", "default"].includes(format)) {
          postToHost({
            type: "download-result",
            requestId,
            ok: false,
            message: "网站编辑器当前提供完整 ZIP 源码包",
          });
          return;
        }
        void downloadSourcePackage({ type: "download", requestId });
      } else if (
        data.type === "export-request" &&
        typeof data.exportId === "string" &&
        data.exportId.length <= 128 &&
        data.format === "default"
      ) {
        void downloadSourcePackage({
          type: "export",
          exportId: data.exportId,
        });
      } else if (data.type === "save-result") {
        const pending = pendingSaveRef.current;
        if (!pending || (data.saveId && data.saveId !== pending.saveId)) return;
        if (data.ok === true && revisionRef.current === pending.revision) {
          publishDraftHistory(
            draftHistoryRef.current,
            "library-snapshot-saved",
          );
          setStatus(
            draftHistoryRef.current.draft_change_count > 0
              ? "来源快照已保存；Project draft 仍需 Apply"
              : "新版本已保存到我的库",
          );
        } else if (data.ok === true) {
          setStatus("当时版本已保存；当前还有较新的修改");
        } else {
          setStatus(String(data.message || "登记新版本失败"));
        }
        pendingSaveRef.current = null;
      } else if (data.type === "dispose") {
        resetPreviewTransaction("host-dispose");
        closeCurrentSession(true);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [
    context.artifactId,
    context.blank,
    context.commitSha,
    context.githubRepo,
    context.instanceId,
    context.projectId,
    context.revisionId,
    context.starterId,
    closeCurrentSession,
    dispatchSelectionCommand,
    downloadSourcePackage,
    hydrated,
    postToHost,
    previewUrl,
    publishDraftHistory,
    resetPreviewTransaction,
    saveSnapshot,
    startSession,
    trustedHost,
  ]);

  useEffect(() => {
    const onPreviewMessage = (event: MessageEvent) => {
      const frame = previewRef.current?.contentWindow;
      if (!frame || event.source !== frame || !previewUrl) return;
      if (event.origin !== new URL(previewUrl).origin) return;
      const data = event.data as Record<string, unknown> | null;
      if (
        !data ||
        data.protocol !== DEV_PROTOCOL ||
        data.instanceId !== context.instanceId ||
        data.bridge !== "structured"
      ) {
        return;
      }
      if (data.type === "generated-ready") {
        structuredBridgeRef.current = true;
      } else if (data.type === "selection-changed") {
        structuredBridgeRef.current = true;
        const raw =
          data.selection === null
            ? null
            : normalizeDomSelection(
                data.selection,
                breakpointRef.current,
              );
        const previewRect = previewRef.current?.getBoundingClientRect();
        const next =
          raw && previewRect
            ? {
                ...raw,
                anchor: {
                  x: previewRect.left + raw.anchor.x,
                  y: previewRect.top + raw.anchor.y,
                  width: raw.anchor.width,
                  height: raw.anchor.height,
                },
              }
            : raw;
        const nextIdentity = next
          ? `${sessionRef.current}:${next.id}`
          : "";
        if (nextIdentity !== activeSelectionIdentityRef.current) {
          activeSelectionIdentityRef.current = nextIdentity;
          if (nextIdentity) selectionEpochRef.current += 1;
        }
        const epochSelection = next
          ? { ...next, epoch: selectionEpochRef.current }
          : null;
        selectionRef.current = epochSelection;
        const nextContext = selectionContext(epochSelection);
        selectionCommandGateRef.current.reconcile(nextContext);
        setSelection(nextContext);
        postToHost({
          type: "selection-changed",
          selection: nextContext,
        });
      } else if (
        data.type === "context-menu" &&
        previewMode === "edit" &&
        typeof data.x === "number" &&
        Number.isFinite(data.x) &&
        typeof data.y === "number" &&
        Number.isFinite(data.y)
      ) {
        const previewRect = previewRef.current?.getBoundingClientRect();
        if (previewRect && selectionRef.current) {
          setContextMenuRequest({
            x: previewRect.left + Number(data.x),
            y: previewRect.top + Number(data.y),
            nonce: Date.now(),
          });
        }
      } else if (
        data.type === "inline-text-change" ||
        data.type === "inline-text-commit" ||
        data.type === "inline-text-cancel"
      ) {
        const target =
          data.target &&
          typeof data.target === "object" &&
          !Array.isArray(data.target)
            ? (data.target as Record<string, unknown>)
            : null;
        if (
          !target ||
          typeof target.id !== "string" ||
          (typeof target.revision !== "string" &&
            typeof target.revision !== "number") ||
          typeof data.value !== "string"
        ) {
          return;
        }
        const current = selectionRef.current;
        if (
          !current ||
          !isStableEditorId(target.id) ||
          target.id !== current.id ||
          !Object.is(target.revision, current.revision)
        ) {
          if (data.type === "inline-text-commit") {
            postToHost({
              type: "error",
              message: "文字选择已变化，本次内容未写入源码",
            });
          }
          return;
        }
        if (data.type === "inline-text-commit") {
          queueInlineTextPersistence(
            {
              id: target.id,
            },
            data.value.slice(0, 2_000),
          );
        }
      } else if (
        data.type === "selection-result" &&
        typeof data.requestId === "string" &&
        typeof data.ok === "boolean"
      ) {
        const pending = pendingSelectionCommandsRef.current.get(data.requestId);
        if (!pending) return;
        window.clearTimeout(pending.timer);
        pendingSelectionCommandsRef.current.delete(data.requestId);
        if (!data.ok) {
          selectionCommandGateRef.current.abort(pending.command);
        }
        if (data.ok && shouldPersistSelectionCommand(pending.command)) {
          queueMutation(pending.command);
        }
        const resultMessage =
          typeof data.message === "string"
            ? data.message.slice(0, 200)
            : data.ok
              ? undefined
              : "网站预览拒绝了这项修改";
        postToHost({
          type: "selection-result",
          requestId: data.requestId,
          ok: data.ok,
          ...(resultMessage ? { message: resultMessage } : {}),
        });
      } else if (
        data.type === "material-result" &&
        typeof data.commandId === "string" &&
        typeof data.ok === "boolean"
      ) {
        const pending = pendingMaterialsRef.current.get(data.commandId);
        pendingMaterialsRef.current.delete(data.commandId);
        if (pending) window.clearTimeout(pending.timer);
        const target =
          data.target &&
          typeof data.target === "object" &&
          !Array.isArray(data.target)
            ? (data.target as Record<string, unknown>)
            : null;
        const rawTargetId =
          target && isStableEditorId(target.id)
            ? target.id
            : isStableEditorId(selectionRef.current?.id)
              ? selectionRef.current.id
              : "";
        const targetId =
          rawTargetId.startsWith("field:") &&
          !rawTargetId.endsWith(":image")
            ? `section:${rawTargetId.split(":")[1]}`
            : rawTargetId;
        const targetValid = Boolean(targetId);
        if (
          data.ok &&
          pending &&
          targetValid
        ) {
          queueMaterialPersistence(
            targetId,
            { url: pending.url, title: pending.title },
            data.commandId,
          );
        }
        postToHost({
          type: "material-result",
          commandId: data.commandId,
          ok: data.ok === true && Boolean(pending) && targetValid,
          ...(typeof data.message === "string"
            ? { message: data.message.slice(0, 500) }
            : data.ok === true && !targetValid
              ? { message: "素材已预览，但无法定位源码插入点" }
              : {}),
        });
      }
    };
    window.addEventListener("message", onPreviewMessage);
    return () => window.removeEventListener("message", onPreviewMessage);
  }, [
    context.instanceId,
    postToHost,
    previewUrl,
    queueInlineTextPersistence,
    queueMaterialPersistence,
    queueMutation,
    previewMode,
  ]);

  useEffect(() => {
    const onPageHide = () => closeCurrentSession(true);
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [closeCurrentSession]);

  useEffect(
    () => () => {
      postToHost({ type: "selection-changed", selection: null });
      closeCurrentSession(true);
      pendingMaterialsRef.current.forEach((pending) =>
        window.clearTimeout(pending.timer),
      );
      pendingMaterialsRef.current.clear();
    },
    [closeCurrentSession, postToHost],
  );

  const changePreviewMode = useCallback(
    (mode: PreviewMode) => {
      if (mode === previewMode) return;
      resetPreviewTransaction(`preview-mode-${mode}`);
      clearPendingSelectionCommands();
      selectionRef.current = null;
      activeSelectionIdentityRef.current = "";
      setSelection(null);
      setContextMenuRequest(null);
      postToHost({ type: "selection-changed", selection: null });
      setPreviewMode(mode);
    },
    [
      clearPendingSelectionCommands,
      postToHost,
      previewMode,
      resetPreviewTransaction,
    ],
  );

  const changeViewportDevice = useCallback((next: PreviewDevice) => {
    setViewportDevice(next);
    breakpointRef.current = next;
    if (selectionRef.current) {
      selectionRef.current = {
        ...selectionRef.current,
        breakpoint: next,
      };
      setSelection(selectionContext(selectionRef.current));
    }
  }, []);

  const changePreviewRoute = useCallback(
    (value: string) => {
      const route = normalizePreviewRoute(value);
      if (!route || route === previewRoute) return;
      resetPreviewTransaction("preview-route-change");
      clearPendingSelectionCommands();
      selectionRef.current = null;
      activeSelectionIdentityRef.current = "";
      setSelection(null);
      setPreviewRoute(route);
    },
    [
      clearPendingSelectionCommands,
      previewRoute,
      resetPreviewTransaction,
    ],
  );

  const openWebsite = useCallback(() => {
    if (!previewSrc || !previewUrl || !trustedPreviewUrl(previewUrl)) return;
    const target = new URL(previewSrc);
    for (const key of [
      "oceanleoEditor",
      "oceanleoInstance",
      "oceanleoController",
      "oceanleoRefresh",
    ]) {
      target.searchParams.delete(key);
    }
    window.open(target.toString(), "_blank", "noopener,noreferrer");
  }, [previewSrc, previewUrl]);

  const onCodeRevisionChange = useCallback(
    (
      revisionId: string,
      nextHeadVersion: number,
      healthyRevisionId: string | null,
    ) => {
      workingRevisionIdRef.current = revisionId;
      setWorkingRevisionId(revisionId);
      setLastHealthyRevisionId(healthyRevisionId);
      setHeadVersion(nextHeadVersion);
      headVersionRef.current = nextHeadVersion;
      setPreviewNonce((value) => value + 1);
      postToHost({
        type: "history-changed",
        reason: "code-revision-created",
        workingRevisionId: revisionId,
        headVersion: nextHeadVersion,
      });
    },
    [postToHost],
  );

  const requestClose = useCallback(() => {
    if (previewDirty || codeDirty) {
      changeActiveView(codeDirty ? "code" : "preview");
      setDraftAction({
        busy: null,
        message: codeDirty
          ? "Save or close the unsaved Code buffer before closing the project."
          : "Apply or Discard the Preview draft before closing the project.",
        unavailable: false,
      });
      return;
    }
    postToHost({ type: "close-request" });
  }, [changeActiveView, codeDirty, postToHost, previewDirty]);

  // SSR and the first hydration frame stay blank. The protocol receiver only
  // becomes visible after the browser proves it is running inside a host.
  if (!hydrated || standalone) return null;

  const previewCanvas = previewSrc ? (
    <div className="relative h-full overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl">
      <iframe
        key={previewSrc}
        ref={previewRef}
        src={previewSrc}
        title={`${title} dev preview`}
        className="h-full w-full border-0 bg-white"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads allow-modals"
        allow="clipboard-read; clipboard-write"
      />
      {sessionIssue && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-white p-6">
          <div className="max-w-md text-center">
            <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-amber-50 text-xl text-amber-600">
              !
            </div>
            <h2 className="mt-4 text-base font-semibold text-zinc-900">
              {sessionIssue.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-500">
              {sessionIssue.description}
            </p>
            <button
              type="button"
              onClick={recoverSession}
              className="mt-5 rounded-xl px-4 py-2 text-xs font-semibold text-white"
              style={{ background: ACCENT }}
            >
              {sessionIssue.kind === "compile" ? "重新检查" : "重新打开网站"}
            </button>
            <p className="mt-3 text-[11px] text-zinc-400">
              Workbench navigation and Close remain available.
            </p>
          </div>
        </div>
      )}
    </div>
  ) : (
    <div className="grid h-full w-full place-items-center rounded-xl border border-dashed border-zinc-300 bg-white">
      {loading ? (
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-200"
          style={{ borderTopColor: ACCENT }}
        />
      ) : sessionIssue ? (
        <div className="max-w-sm text-center">
          <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-amber-50 text-amber-600">
            !
          </div>
          <p className="mt-3 text-sm font-medium">{sessionIssue.description}</p>
          <button
            type="button"
            onClick={recoverSession}
            className="mt-4 rounded-xl px-4 py-2 text-xs font-semibold text-white"
            style={{ background: ACCENT }}
          >
            重新打开网站
          </button>
        </div>
      ) : (
        <p className="text-xs text-zinc-400">
          Waiting for a project source…
        </p>
      )}
    </div>
  );

  const managementModuleContext: WebsiteProjectWorkbenchModuleContext = {
    title,
    projectId: canonicalProjectId,
    sessionId: sessionId || null,
    workingRevisionId,
    lastHealthyRevisionId,
    headVersion,
  };
  const resolveChildModule = (
    view: ManagementWorkbenchView,
  ): ProjectWorkbenchModule | undefined => {
    const slot = childModules[view];
    return typeof slot === "function"
      ? slot(managementModuleContext)
      : slot;
  };
  const workbenchModules: Partial<
    Record<WorkbenchView, ProjectWorkbenchModule>
  > = {
    preview: {
      content: (
        <PreviewWorkspace
          title={title}
          mode={previewMode}
          onModeChange={changePreviewMode}
          device={viewportDevice}
          onDeviceChange={changeViewportDevice}
          route={previewRoute}
          routes={previewRoutes}
          onRouteChange={changePreviewRoute}
          onOpenWebsite={openWebsite}
          onRefresh={() => setPreviewNonce((value) => value + 1)}
          selection={selection}
          onSelectionCommand={(command: SelectionCommand) => {
            if (previewMode === "edit") {
              dispatchSelectionCommand(command);
            }
          }}
          preview={previewCanvas}
          draftHistory={draftHistory}
          actionState={draftAction}
          onApply={() => void applyDraft()}
          onDiscard={() => void discardDraft()}
          onUndo={() => void changeDraftHistory("undo")}
          onRedo={() => void changeDraftHistory("redo")}
          contextMenuRequest={contextMenuRequest}
          hostOwnsChrome
        />
      ),
    },
    code: {
      content: (
        <CodeWorkspace
          projectId={canonicalProjectId}
          sessionId={sessionId || undefined}
          initialRevisionId={workingRevisionId}
          initialHeadVersion={headVersion}
          historyRequestNonce={historyRequestNonce}
          onDirtyChange={setCodeDirty}
          onRevisionChange={onCodeRevisionChange}
          onSessionPreviewChange={(nextPreviewUrl) => {
            if (!trustedPreviewUrl(nextPreviewUrl)) return;
            setPreviewUrl(nextPreviewUrl);
            setPreviewNonce((value) => value + 1);
          }}
        />
      ),
    },
    dashboard: resolveChildModule("dashboard") || {
      available: false,
      content: null,
      unavailableReason:
        "Dashboard child module has not been registered for this build.",
    },
    database: resolveChildModule("database") || {
      available: false,
      content: null,
      unavailableReason:
        "Database child module has not been registered for this build.",
    },
    storage: resolveChildModule("storage") || {
      available: false,
      content: null,
      unavailableReason:
        "File storage child module has not been registered for this build.",
    },
    settings: resolveChildModule("settings") || {
      available: false,
      content: null,
      unavailableReason:
        "Settings child module has not been registered for this build.",
    },
  };

  return (
    <ProjectWorkbench
      title={title}
      projectId={canonicalProjectId}
      activeView={activeView}
      onViewChange={changeActiveView}
      modules={workbenchModules}
      previewDirty={previewDirty}
      codeDirty={codeDirty}
      revisionLabel={workingRevisionId?.slice(0, 8) || null}
      onOpenRevisionHistory={() => {
        changeActiveView("code");
        setHistoryRequestNonce((value) => value + 1);
      }}
      onClose={requestClose}
    />
  );
}
