export const WORKBENCH_VIEWS = [
  "preview",
  "code",
  "dashboard",
  "database",
  "storage",
  "settings",
] as const;

export type WorkbenchView = (typeof WORKBENCH_VIEWS)[number];
export const MANAGEMENT_WORKBENCH_VIEWS = [
  "dashboard",
  "database",
  "storage",
  "settings",
] as const satisfies readonly WorkbenchView[];
export type ManagementWorkbenchView =
  (typeof MANAGEMENT_WORKBENCH_VIEWS)[number];
export type PreviewMode = "view" | "edit";
export type PreviewDevice = "desktop" | "tablet" | "mobile";

export interface WebsiteProjectHead {
  project_id: string;
  display_name: string;
  slug: string;
  working_revision_id: string | null;
  last_healthy_revision_id: string | null;
  published_revision_id: string | null;
  head_version: number;
  artifact_id?: string | null;
  artifact_revision_id?: string | null;
}

export interface DraftHistoryState {
  base_revision_id: string | null;
  draft_change_count: number;
  undo_depth: number;
  redo_depth: number;
  history_version: number;
}

export interface WebsiteEditorSessionState extends DraftHistoryState {
  session_id: string;
  project_id: string;
  state: "starting" | "ready" | "unhealthy" | "disposing" | "disposed";
  working_revision_id: string | null;
  last_healthy_revision_id: string | null;
  head_version: number;
}

export interface ProjectSessionLaunchResponse
  extends WebsiteEditorSessionState {
  preview_url: string;
  ready: boolean;
  running: boolean;
  http_code: number;
  compile_errors: string[];
}

export interface ApplyDraftResponse extends DraftHistoryState {
  project_id: string;
  session_id: string;
  working_revision_id: string;
  last_healthy_revision_id: string;
  head_version: number;
  health_status: "healthy";
}

export interface DiscardDraftResponse extends DraftHistoryState {
  project_id: string;
  session_id: string;
  working_revision_id: string;
  last_healthy_revision_id: string | null;
  head_version: number;
}

export interface DraftHistoryActionResponse extends DraftHistoryState {
  project_id: string;
  session_id: string;
  preview_revision: string | number | null;
}

export type SourceTreeKind = "file" | "directory";

export interface SourceTreeEntry {
  path: string;
  kind: SourceTreeKind;
  sha256: string | null;
  byte_size: number;
  mime_type: string | null;
  is_binary: boolean;
  modified: boolean;
  conflict: boolean;
  diagnostic_count: number;
}

export interface SourceTreeResponse {
  project_id: string;
  revision_id: string | null;
  working_revision_id: string | null;
  head_version: number;
  files: SourceTreeEntry[];
}

export interface SourceFileResponse {
  project_id: string;
  revision_id: string | null;
  head_version: number;
  path: string;
  sha256: string;
  byte_size: number;
  mime_type: string;
  is_binary: boolean;
  content: string | null;
  encoding: "utf-8" | "base64" | "binary";
}

export type SourceTransactionOperation =
  | {
      operation: "write";
      path: string;
      content: string;
      expected_sha256: string | null;
      mime_type?: string;
      file_mode?: number;
    }
  | {
      operation: "delete";
      path: string;
      expected_sha256: string | null;
    }
  | {
      operation: "rename";
      path: string;
      target_path: string;
      expected_sha256: string | null;
    };

export interface SourceTransactionRequest {
  session_id?: string;
  base_revision_id: string | null;
  expected_head_version: number;
  message: string;
  operations: SourceTransactionOperation[];
}

export interface WebsiteDiagnostic {
  project_id: string;
  session_id: string | null;
  revision_id: string;
  file: string;
  line: number;
  column: number;
  end_line: number | null;
  end_column: number | null;
  severity: "error" | "warning" | "info";
  code: string | null;
  message: string;
  source: string;
}

export interface SourceTransactionResponse {
  project_id: string;
  revision_id: string;
  working_revision_id: string;
  last_healthy_revision_id: string | null;
  parent_revision_id: string | null;
  head_version: number;
  health_status: "pending" | "healthy" | "broken";
  files: Array<{
    path: string;
    sha256: string | null;
    deleted?: boolean;
  }>;
  diagnostics: WebsiteDiagnostic[];
  preview_url?: string;
  session_reload_error?: string;
}

export interface WebsiteRevision {
  id: string;
  project_id: string;
  parent_revision_id: string | null;
  tree_sha256: string;
  origin:
    | "visual_edit"
    | "code_edit"
    | "import_virtual_config"
    | "import_snapshot"
    | "import_github"
    | "restore";
  health_status: "pending" | "healthy" | "broken";
  diagnostics_count: number;
  message: string;
  created_at: string;
  created_by?: string;
}

export interface RevisionListResponse {
  project_id: string;
  working_revision_id: string | null;
  last_healthy_revision_id: string | null;
  published_revision_id: string | null;
  head_version: number;
  revisions: WebsiteRevision[];
}

export interface RestoreRevisionResponse {
  project_id: string;
  revision_id: string;
  restored_from_revision_id: string;
  working_revision_id: string;
  last_healthy_revision_id: string | null;
  head_version: number;
  preview_url?: string;
}

export interface ProjectApiFailure {
  ok: false;
  status: number;
  code: string;
  message: string;
  unavailable: boolean;
  details?: unknown;
}

export interface ProjectApiSuccess<T> {
  ok: true;
  status: number;
  data: T;
}

export type ProjectApiResult<T> =
  | ProjectApiSuccess<T>
  | ProjectApiFailure;

export interface SourceConflict {
  path: string;
  mine: string;
  base: string;
  current: string;
  expected_sha256: string | null;
  current_sha256: string | null;
  current_revision_id: string | null;
  current_head_version: number;
  message: string;
}

export const EMPTY_DRAFT_HISTORY: DraftHistoryState = {
  base_revision_id: null,
  draft_change_count: 0,
  undo_depth: 0,
  redo_depth: 0,
  history_version: 0,
};

export function isWorkbenchView(value: unknown): value is WorkbenchView {
  return (
    typeof value === "string" &&
    (WORKBENCH_VIEWS as readonly string[]).includes(value)
  );
}

export function isCanonicalProjectId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export function normalizeProjectPath(value: string): string | null {
  const raw = value.trim().replaceAll("\\", "/");
  if (
    !raw ||
    raw.startsWith("/") ||
    raw.endsWith("/") ||
    raw.length > 512 ||
    raw.includes("\0")
  ) {
    return null;
  }
  const parts = raw.split("/");
  if (
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.length > 180 ||
        /[\u0000-\u001f\u007f]/.test(part),
    )
  ) {
    return null;
  }
  return parts.join("/");
}

export function isPrivateSourcePath(value: string): boolean {
  const path = value.toLowerCase();
  const parts = path.split("/");
  return (
    parts.some((part) =>
      [".git", ".next", "node_modules"].includes(part),
    ) ||
    parts.some((part) => part === ".env" || part.startsWith(".env.")) ||
    /(?:^|\/)(?:oceanleo-dev-bridge|oceanleo_dev_bridge)\.[^/]+$/.test(
      path,
    )
  );
}

export function safeSourcePath(value: string): string | null {
  const normalized = normalizeProjectPath(value);
  return normalized && !isPrivateSourcePath(normalized) ? normalized : null;
}

export function normalizePreviewRoute(value: string): string | null {
  const raw = value.trim();
  if (!raw) return "/";
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) return null;
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  try {
    const parsed = new URL(withSlash, "https://preview.invalid");
    if (parsed.origin !== "https://preview.invalid") return null;
    const route = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return route.length <= 2_000 ? route : null;
  } catch {
    return null;
  }
}

export function requestId(prefix: string): string {
  const entropy =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${entropy}`;
}
