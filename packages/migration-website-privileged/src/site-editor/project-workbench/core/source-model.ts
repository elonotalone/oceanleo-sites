import {
  isPrivateSourcePath,
  safeSourcePath,
  type SourceFileResponse,
  type SourceTreeEntry,
  type SourceTreeResponse,
  type WebsiteDiagnostic,
} from "./contracts";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, maximum = 2_000): string {
  return typeof value === "string" ? value.slice(0, maximum) : "";
}

function integer(value: unknown, fallback = 0): number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : fallback;
}

function boolean(value: unknown): boolean {
  return value === true;
}

function normalizedTreeEntry(
  value: unknown,
  parent = "",
): Array<SourceTreeEntry> {
  const source = record(value);
  if (!source) return [];
  const rawPath =
    text(source.path, 512) ||
    [parent, text(source.name, 180)].filter(Boolean).join("/");
  const path = safeSourcePath(rawPath);
  if (!path) return [];
  const children = Array.isArray(source.children) ? source.children : [];
  const rawKind = text(source.kind || source.type, 24).toLowerCase();
  const kind =
    rawKind === "directory" || rawKind === "dir" || children.length
      ? "directory"
      : "file";
  const entry: SourceTreeEntry = {
    path,
    kind,
    sha256:
      typeof (source.sha256 || source.blob_sha256) === "string" &&
      /^[a-f0-9]{64}$/i.test(String(source.sha256 || source.blob_sha256))
        ? String(source.sha256 || source.blob_sha256).toLowerCase()
        : null,
    byte_size: integer(source.byte_size ?? source.size),
    mime_type: text(source.mime_type || source.content_type, 200) || null,
    is_binary: boolean(source.is_binary) || source.encoding === "binary",
    modified: boolean(source.modified),
    conflict: boolean(source.conflict),
    diagnostic_count: integer(
      source.diagnostic_count ?? source.diagnostics_count,
    ),
  };
  return [
    entry,
    ...children.flatMap((child) => normalizedTreeEntry(child, path)),
  ];
}

function addParentDirectories(entries: SourceTreeEntry[]): SourceTreeEntry[] {
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  for (const entry of entries) {
    const parts = entry.path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      const path = parts.slice(0, index).join("/");
      if (!byPath.has(path)) {
        byPath.set(path, {
          path,
          kind: "directory",
          sha256: null,
          byte_size: 0,
          mime_type: null,
          is_binary: false,
          modified: false,
          conflict: false,
          diagnostic_count: 0,
        });
      }
    }
  }
  return [...byPath.values()].sort((left, right) => {
    const leftParent = sourceParent(left.path);
    const rightParent = sourceParent(right.path);
    if (leftParent === rightParent && left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }
    return left.path.localeCompare(right.path, "en");
  });
}

export function normalizeSourceTree(value: unknown): SourceTreeResponse | null {
  const source = record(value);
  if (!source) return null;
  const candidates = Array.isArray(source.files)
    ? source.files
    : Array.isArray(source.entries)
      ? source.entries
      : Array.isArray(source.tree)
        ? source.tree
        : [];
  const files = addParentDirectories(
    candidates
      .flatMap((entry) => normalizedTreeEntry(entry))
      .filter((entry) => !isPrivateSourcePath(entry.path)),
  );
  const projectId = text(source.project_id, 128);
  const revisionId = text(
    source.revision_id || source.working_revision_id,
    128,
  );
  return {
    project_id: projectId,
    revision_id: revisionId || null,
    working_revision_id:
      text(source.working_revision_id, 128) || revisionId || null,
    head_version: integer(source.head_version),
    files,
  };
}

export function normalizeSourceFile(value: unknown): SourceFileResponse | null {
  const source = record(value);
  if (!source) return null;
  const path = safeSourcePath(text(source.path, 512));
  const sha256 = text(source.sha256, 64).toLowerCase();
  const isBinary =
    source.is_binary === true ||
    source.encoding === "binary" ||
    source.encoding === "base64";
  const content =
    typeof source.content === "string" && !isBinary ? source.content : null;
  if (!path || !/^[a-f0-9]{64}$/.test(sha256)) return null;
  return {
    project_id: text(source.project_id, 128),
    revision_id:
      text(source.revision_id || source.working_revision_id, 128) || null,
    head_version: integer(source.head_version),
    path,
    sha256,
    byte_size: integer(
      source.byte_size,
      content === null ? 0 : new TextEncoder().encode(content).byteLength,
    ),
    mime_type:
      text(source.mime_type || source.content_type, 200) ||
      "text/plain; charset=utf-8",
    is_binary: isBinary,
    content,
    encoding: isBinary
      ? source.encoding === "base64"
        ? "base64"
        : "binary"
      : "utf-8",
  };
}

export function normalizeDiagnostics(value: unknown): WebsiteDiagnostic[] {
  const source = record(value);
  const candidates = Array.isArray(value)
    ? value
    : Array.isArray(source?.diagnostics)
      ? source.diagnostics
      : [];
  return candidates.flatMap((candidate) => {
    const item = record(candidate);
    if (!item) return [];
    const file = safeSourcePath(text(item.file || item.path, 512));
    const revisionId = text(item.revision_id, 128);
    const rawSeverity = text(item.severity, 20).toLowerCase();
    const severity =
      rawSeverity === "warning" || rawSeverity === "info"
        ? rawSeverity
        : "error";
    const message = text(item.message, 4_000);
    if (!file || !revisionId || !message) return [];
    return [
      {
        project_id: text(item.project_id, 128),
        session_id: text(item.session_id, 128) || null,
        revision_id: revisionId,
        file,
        line: Math.max(1, integer(item.line, 1)),
        column: Math.max(1, integer(item.column, 1)),
        end_line:
          item.end_line === null || item.end_line === undefined
            ? null
            : Math.max(1, integer(item.end_line, 1)),
        end_column:
          item.end_column === null || item.end_column === undefined
            ? null
            : Math.max(1, integer(item.end_column, 1)),
        severity,
        code: text(item.code, 100) || null,
        message,
        source: text(item.source, 100) || "compiler",
      } satisfies WebsiteDiagnostic,
    ];
  });
}

export interface ExplorerRow extends SourceTreeEntry {
  depth: number;
  name: string;
}

export function sourceParent(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

export function sourceName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function explorerRows(
  entries: readonly SourceTreeEntry[],
  expanded: ReadonlySet<string>,
): ExplorerRow[] {
  const byParent = new Map<string, SourceTreeEntry[]>();
  for (const entry of entries) {
    const parent = sourceParent(entry.path);
    const siblings = byParent.get(parent) || [];
    siblings.push(entry);
    byParent.set(parent, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((left, right) =>
      left.kind === right.kind
        ? left.path.localeCompare(right.path, "en")
        : left.kind === "directory"
          ? -1
          : 1,
    );
  }
  const rows: ExplorerRow[] = [];
  const visit = (parent: string, depth: number) => {
    for (const entry of byParent.get(parent) || []) {
      rows.push({ ...entry, depth, name: sourceName(entry.path) });
      if (entry.kind === "directory" && expanded.has(entry.path)) {
        visit(entry.path, depth + 1);
      }
    }
  };
  visit("", 0);
  return rows;
}

export function sourceLanguage(path: string): string {
  const extension = sourceName(path).split(".").pop()?.toLowerCase() || "";
  const languages: Record<string, string> = {
    ts: "TypeScript",
    tsx: "TypeScript React",
    js: "JavaScript",
    jsx: "JavaScript React",
    json: "JSON",
    css: "CSS",
    scss: "SCSS",
    html: "HTML",
    md: "Markdown",
    mdx: "MDX",
    py: "Python",
    yml: "YAML",
    yaml: "YAML",
    toml: "TOML",
    sql: "SQL",
    svg: "SVG",
  };
  return languages[extension] || (extension ? extension.toUpperCase() : "Text");
}

export function fileLineColumn(
  content: string,
  selectionStart: number,
): { line: number; column: number } {
  const before = content.slice(0, Math.max(0, selectionStart));
  const lines = before.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length || 0) + 1 };
}
