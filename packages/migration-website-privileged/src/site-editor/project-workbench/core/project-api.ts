"use client";

import { authed } from "@oceanleo/ui/lib";
import { accessToken } from "../../../auth/client";
import { GATEWAY_BASE } from "../../../auth/config";
import type {
  ApplyDraftResponse,
  DiscardDraftResponse,
  DraftHistoryActionResponse,
  ProjectSessionLaunchResponse,
  ProjectApiFailure,
  ProjectApiResult,
  RestoreRevisionResponse,
  RevisionListResponse,
  SourceFileResponse,
  SourceTransactionRequest,
  SourceTransactionResponse,
  SourceTreeResponse,
  WebsiteDiagnostic,
  WebsiteEditorSessionState,
  WebsiteProjectHead,
} from "./contracts";

const UNAVAILABLE_STATUSES = new Set([
  0,
  404,
  405,
  501,
  502,
  503,
  504,
]);
const UNAVAILABLE_CODES = new Set([
  "capability_unavailable",
  "not_implemented",
  "route_not_registered",
  "source_unavailable",
]);

function segment(value: string): string {
  return encodeURIComponent(value);
}

export const websiteProjectApiPaths = {
  projects: "/v1/website-projects",
  project: (projectId: string) =>
    `/v1/website-projects/${segment(projectId)}`,
  byArtifact: (artifactId: string) =>
    `/v1/website-projects/by-artifact/${segment(artifactId)}`,
  artifactLink: (projectId: string) =>
    `/v1/website-projects/${segment(projectId)}/artifact-link`,
  migrateLegacy: (legacySiteId: string) =>
    `/v1/website-projects/legacy/deployed-sites/${segment(legacySiteId)}/migrate`,
  sessions: (projectId: string) =>
    `/v1/website-projects/${segment(projectId)}/sessions`,
  session: (projectId: string, sessionId: string) =>
    `${websiteProjectApiPaths.sessions(projectId)}/${segment(sessionId)}`,
  apply: (projectId: string, sessionId: string) =>
    `${websiteProjectApiPaths.session(projectId, sessionId)}/apply`,
  discard: (projectId: string, sessionId: string) =>
    `${websiteProjectApiPaths.session(projectId, sessionId)}/discard`,
  undo: (projectId: string, sessionId: string) =>
    `${websiteProjectApiPaths.session(projectId, sessionId)}/undo`,
  redo: (projectId: string, sessionId: string) =>
    `${websiteProjectApiPaths.session(projectId, sessionId)}/redo`,
  sourceTree: (projectId: string) =>
    `${websiteProjectApiPaths.project(projectId)}/source/files`,
  sourceFile: (projectId: string) =>
    `${websiteProjectApiPaths.project(projectId)}/source/file`,
  sourceTransactions: (projectId: string) =>
    `${websiteProjectApiPaths.project(projectId)}/source/transactions`,
  diagnostics: (projectId: string) =>
    `${websiteProjectApiPaths.project(projectId)}/diagnostics`,
  revisions: (projectId: string) =>
    `${websiteProjectApiPaths.project(projectId)}/revisions`,
  restoreRevision: (projectId: string, revisionId: string) =>
    `${websiteProjectApiPaths.revisions(projectId)}/${segment(revisionId)}/restore`,
  archiveRevision: (projectId: string, revisionId: string) =>
    `${websiteProjectApiPaths.revisions(projectId)}/${segment(revisionId)}/archive`,
} as const;

export interface WebsiteProjectSourceInput {
  path: string;
  content: string;
  mime_type?: string;
  file_mode?: number;
}

export interface WebsiteProjectImportInput {
  display_name: string;
  slug?: string;
  default_route?: string;
  source_snapshot_id?: string;
  github_repo?: string;
  commit_sha?: string;
  files?: WebsiteProjectSourceInput[];
  virtual_site_config?: unknown;
}

function errorRecord(value: unknown): {
  code: string;
  message: string;
  details?: unknown;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { code: "", message: "" };
  }
  const source = value as Record<string, unknown>;
  const nested =
    source.detail && typeof source.detail === "object"
      ? (source.detail as Record<string, unknown>)
      : null;
  const code = String(source.code || nested?.code || "").slice(0, 100);
  const message = String(
    source.message ||
      nested?.message ||
      (typeof source.detail === "string" ? source.detail : ""),
  ).slice(0, 1_000);
  return {
    code,
    message,
    ...(source.details !== undefined
      ? { details: source.details }
      : nested?.details !== undefined
        ? { details: nested.details }
        : {}),
  };
}

export function projectApiFailure(
  status: number,
  rawMessage: string,
  rawDetails?: unknown,
): ProjectApiFailure {
  const parsed = errorRecord(rawDetails);
  const code = parsed.code || (UNAVAILABLE_STATUSES.has(status) ? "capability_unavailable" : "request_failed");
  const unavailable =
    UNAVAILABLE_STATUSES.has(status) || UNAVAILABLE_CODES.has(code);
  const message =
    parsed.message ||
    rawMessage ||
    (unavailable
      ? "Website Project API 尚未在当前环境提供"
      : status === 409
        ? "项目已被其他编辑更新，请先处理版本冲突"
        : status === 401
          ? "登录状态已失效"
          : "Website Project API 请求失败");
  return {
    ok: false,
    status,
    code,
    message,
    unavailable,
    ...(parsed.details !== undefined
      ? { details: parsed.details }
      : rawDetails !== undefined
        ? { details: rawDetails }
        : {}),
  };
}

async function jsonRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<ProjectApiResult<T>> {
  const result = await authed<T>(path, init);
  if (!result.ok || result.data === undefined) {
    return projectApiFailure(
      result.status || 0,
      result.error || "",
      result.data,
    );
  }
  return { ok: true, status: result.status || 200, data: result.data };
}

function queryPath(
  path: string,
  query: Record<string, string | number | null | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

export function readWebsiteProject(
  projectId: string,
): Promise<ProjectApiResult<{ project: WebsiteProjectHead }>> {
  return jsonRequest(websiteProjectApiPaths.project(projectId), {
    cache: "no-store",
  });
}

export function readWebsiteProjectByArtifact(
  artifactId: string,
  options: { revisionId?: string | null } = {},
): Promise<ProjectApiResult<{ project: WebsiteProjectHead }>> {
  return jsonRequest(
    queryPath(websiteProjectApiPaths.byArtifact(artifactId), {
      revision_id: options.revisionId || undefined,
    }),
    { cache: "no-store" },
  );
}

export function linkWebsiteProjectArtifact(
  projectId: string,
  input: {
    artifact_id: string;
    artifact_revision_id?: string | null;
  },
): Promise<ProjectApiResult<{ project: WebsiteProjectHead }>> {
  return jsonRequest(websiteProjectApiPaths.artifactLink(projectId), {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function createWebsiteProject(
  input: WebsiteProjectImportInput,
): Promise<ProjectApiResult<{ project: WebsiteProjectHead }>> {
  return jsonRequest(websiteProjectApiPaths.projects, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function migrateLegacyWebsiteProject(
  legacySiteId: string,
  input: WebsiteProjectImportInput,
): Promise<ProjectApiResult<{ project: WebsiteProjectHead }>> {
  return jsonRequest(websiteProjectApiPaths.migrateLegacy(legacySiteId), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function readProjectSession(
  projectId: string,
  sessionId: string,
): Promise<ProjectApiResult<WebsiteEditorSessionState>> {
  return jsonRequest(websiteProjectApiPaths.session(projectId, sessionId));
}

export function createProjectSession(
  projectId: string,
  input: {
    revision_id?: string;
  },
): Promise<ProjectApiResult<ProjectSessionLaunchResponse>> {
  return jsonRequest(websiteProjectApiPaths.sessions(projectId), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function applyProjectDraft(
  projectId: string,
  sessionId: string,
  input: {
    expected_base_revision_id: string | null;
    expected_head_version: number;
    idempotency_key: string;
  },
): Promise<ProjectApiResult<ApplyDraftResponse>> {
  return jsonRequest(websiteProjectApiPaths.apply(projectId, sessionId), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function discardProjectDraft(
  projectId: string,
  sessionId: string,
  input: {
    expected_base_revision_id: string | null;
    expected_head_version: number;
    idempotency_key: string;
  },
): Promise<ProjectApiResult<DiscardDraftResponse>> {
  return jsonRequest(websiteProjectApiPaths.discard(projectId, sessionId), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function changeProjectDraftHistory(
  direction: "undo" | "redo",
  projectId: string,
  sessionId: string,
  input: {
    expected_history_version: number;
    idempotency_key: string;
  },
): Promise<ProjectApiResult<DraftHistoryActionResponse>> {
  const path =
    direction === "undo"
      ? websiteProjectApiPaths.undo(projectId, sessionId)
      : websiteProjectApiPaths.redo(projectId, sessionId);
  return jsonRequest(path, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function readSourceTree(
  projectId: string,
  options: {
    sessionId?: string;
    revisionId?: string | null;
  } = {},
): Promise<ProjectApiResult<SourceTreeResponse>> {
  return jsonRequest(
    queryPath(websiteProjectApiPaths.sourceTree(projectId), {
      session_id: options.sessionId,
      revision_id: options.revisionId,
    }),
  );
}

export function readSourceFile(
  projectId: string,
  path: string,
  options: {
    sessionId?: string;
    revisionId?: string | null;
  } = {},
): Promise<ProjectApiResult<SourceFileResponse>> {
  return jsonRequest(
    queryPath(websiteProjectApiPaths.sourceFile(projectId), {
      path,
      session_id: options.sessionId,
      revision_id: options.revisionId,
    }),
  );
}

export function transactSource(
  projectId: string,
  input: SourceTransactionRequest,
): Promise<ProjectApiResult<SourceTransactionResponse>> {
  return jsonRequest(websiteProjectApiPaths.sourceTransactions(projectId), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function readDiagnostics(
  projectId: string,
  options: {
    sessionId?: string;
    revisionId?: string | null;
  } = {},
): Promise<ProjectApiResult<{ diagnostics: WebsiteDiagnostic[] }>> {
  return jsonRequest(
    queryPath(websiteProjectApiPaths.diagnostics(projectId), {
      session_id: options.sessionId,
      revision_id: options.revisionId,
    }),
  );
}

export function readRevisions(
  projectId: string,
): Promise<ProjectApiResult<RevisionListResponse>> {
  return jsonRequest(websiteProjectApiPaths.revisions(projectId));
}

export function restoreRevision(
  projectId: string,
  revisionId: string,
  input: {
    expected_head_version: number;
    session_id?: string;
    message?: string;
  },
): Promise<ProjectApiResult<RestoreRevisionResponse>> {
  return jsonRequest(
    websiteProjectApiPaths.restoreRevision(projectId, revisionId),
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

function filenameFromDisposition(value: string | null): string {
  if (!value) return "";
  const utf = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (utf) {
    try {
      return decodeURIComponent(utf).replaceAll(/[\\/:*?"<>|]/g, "-");
    } catch {
      return "";
    }
  }
  return (
    value
      .match(/filename="?([^";]+)"?/i)?.[1]
      ?.replaceAll(/[\\/:*?"<>|]/g, "-") || ""
  );
}

async function downloadBinary(
  path: string,
  fallbackFilename: string,
  acceptedContentType: RegExp,
  timeout = 120_000,
): Promise<ProjectApiResult<{ blob: Blob; filename: string }>> {
  const token = await accessToken();
  if (!token) return projectApiFailure(401, "登录状态已失效");
  let response: Response;
  try {
    response = await fetch(`${GATEWAY_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(timeout),
    });
  } catch (caught) {
    return projectApiFailure(
      0,
      caught instanceof Error ? caught.message : "文件下载失败",
    );
  }
  if (!response.ok) {
    let details: unknown;
    try {
      details = await response.json();
    } catch {
      details = undefined;
    }
    return projectApiFailure(
      response.status,
      `文件下载失败（HTTP ${response.status}）`,
      details,
    );
  }
  const contentType = response.headers.get("content-type") || "";
  if (contentType && !acceptedContentType.test(contentType)) {
    return projectApiFailure(
      502,
      `download endpoint 返回了不受支持的内容（${contentType}）`,
    );
  }
  const blob = await response.blob();
  if (blob.size === 0) {
    return projectApiFailure(502, "download endpoint 返回了空文件");
  }
  return {
    ok: true,
    status: response.status,
    data: {
      blob,
      filename:
        filenameFromDisposition(response.headers.get("content-disposition")) ||
        fallbackFilename,
    },
  };
}

export function downloadSourceFile(
  projectId: string,
  path: string,
  options: {
    sessionId?: string;
    revisionId?: string | null;
  } = {},
): Promise<ProjectApiResult<{ blob: Blob; filename: string }>> {
  return downloadBinary(
    queryPath(websiteProjectApiPaths.sourceFile(projectId), {
      path,
      session_id: options.sessionId,
      revision_id: options.revisionId,
      download: 1,
    }),
    path.slice(path.lastIndexOf("/") + 1) || "source-file",
    /.*/,
    60_000,
  );
}

export async function downloadRevisionArchive(
  projectId: string,
  revisionId: string,
): Promise<
  ProjectApiResult<{
    blob: Blob;
    filename: string;
  }>
> {
  const result = await downloadBinary(
    websiteProjectApiPaths.archiveRevision(projectId, revisionId),
    `website-${revisionId.slice(0, 8)}.zip`,
    /(?:application\/zip|application\/octet-stream)/i,
  );
  if (!result.ok) return result;
  const signature = new Uint8Array(
    await result.data.blob.slice(0, 4).arrayBuffer(),
  );
  const zipRecord =
    signature.length === 4 &&
    signature[0] === 0x50 &&
    signature[1] === 0x4b &&
    ((signature[2] === 0x03 && signature[3] === 0x04) ||
      (signature[2] === 0x05 && signature[3] === 0x06) ||
      (signature[2] === 0x07 && signature[3] === 0x08));
  if (!zipRecord) {
    return projectApiFailure(
      502,
      "Project archive endpoint did not return ZIP bytes.",
    );
  }
  return result;
}
