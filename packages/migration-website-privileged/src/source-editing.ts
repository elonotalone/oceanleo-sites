/**
 * Portable contracts for the Website Project Workbench.
 *
 * The interactive six-view React workbench still lives in the website
 * frontend. These contracts are intentionally server/client agnostic so the
 * privileged profile can preserve canonical project URLs and source safety
 * while that UI is migrated.
 */
export const WEBSITE_WORKBENCH_VIEWS = Object.freeze([
  "preview",
  "code",
  "dashboard",
  "database",
  "storage",
  "settings",
] as const);

export type WebsiteWorkbenchView =
  (typeof WEBSITE_WORKBENCH_VIEWS)[number];

export const WEBSITE_PROJECT_API_PATHS = Object.freeze({
  projects: "/v1/website-projects",
  project: (projectId: string) =>
    `/v1/website-projects/${encodeURIComponent(projectId)}`,
  byArtifact: (artifactId: string) =>
    `/v1/website-projects/by-artifact/${encodeURIComponent(artifactId)}`,
  artifactLink: (projectId: string) =>
    `/v1/website-projects/${encodeURIComponent(projectId)}/artifact-link`,
  migrateLegacy: (legacySiteId: string) =>
    `/v1/website-projects/legacy/deployed-sites/${encodeURIComponent(legacySiteId)}/migrate`,
  sessions: (projectId: string) =>
    `/v1/website-projects/${encodeURIComponent(projectId)}/sessions`,
  session: (projectId: string, sessionId: string) =>
    `/v1/website-projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}`,
  sourceTree: (projectId: string) =>
    `/v1/website-projects/${encodeURIComponent(projectId)}/source/files`,
  sourceFile: (projectId: string) =>
    `/v1/website-projects/${encodeURIComponent(projectId)}/source/file`,
  sourceTransactions: (projectId: string) =>
    `/v1/website-projects/${encodeURIComponent(projectId)}/source/transactions`,
  diagnostics: (projectId: string) =>
    `/v1/website-projects/${encodeURIComponent(projectId)}/diagnostics`,
  revisions: (projectId: string) =>
    `/v1/website-projects/${encodeURIComponent(projectId)}/revisions`,
  restoreRevision: (projectId: string, revisionId: string) =>
    `/v1/website-projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}/restore`,
  archiveRevision: (projectId: string, revisionId: string) =>
    `/v1/website-projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}/archive`,
});

export interface WebsiteSourceWrite {
  readonly operation: "write";
  readonly path: string;
  readonly content: string;
  readonly expected_sha256: string | null;
  readonly mime_type?: string;
  readonly file_mode?: number;
}

export interface WebsiteSourceDelete {
  readonly operation: "delete";
  readonly path: string;
  readonly expected_sha256: string | null;
}

export interface WebsiteSourceRename {
  readonly operation: "rename";
  readonly path: string;
  readonly target_path: string;
  readonly expected_sha256: string | null;
}

export type WebsiteSourceOperation =
  | WebsiteSourceWrite
  | WebsiteSourceDelete
  | WebsiteSourceRename;

export interface WebsiteSourceTransaction {
  readonly session_id?: string;
  readonly base_revision_id: string | null;
  readonly expected_head_version: number;
  readonly message: string;
  readonly operations: readonly WebsiteSourceOperation[];
}

export function isCanonicalWebsiteProjectId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export function normalizeWebsiteSourcePath(value: string): string | null {
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

export function isPrivateWebsiteSourcePath(value: string): boolean {
  const path = value.toLowerCase();
  const parts = path.split("/");
  return (
    parts.some((part) => [".git", ".next", "node_modules"].includes(part)) ||
    parts.some((part) => part === ".env" || part.startsWith(".env.")) ||
    /(?:^|\/)(?:oceanleo-dev-bridge|oceanleo_dev_bridge)\.[^/]+$/.test(path)
  );
}

export function safeWebsiteSourcePath(value: string): string | null {
  const normalized = normalizeWebsiteSourcePath(value);
  return normalized && !isPrivateWebsiteSourcePath(normalized)
    ? normalized
    : null;
}

export function normalizeWebsitePreviewRoute(value: string): string | null {
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
