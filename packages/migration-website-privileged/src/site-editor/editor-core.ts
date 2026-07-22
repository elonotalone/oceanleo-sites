import type {
  VirtualSectionType,
  VirtualSiteConfig,
  VirtualSiteSection,
} from "../virtual-site-types";

// ---------------------------------------------------------------------------
// Pure helpers for the Manus-style embed site editor (/embed/site-editor).
// No React in here — everything is unit-testable data plumbing.

const CANONICAL_PROJECT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function trimmedString(value: unknown, max = 128): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

function metaRecord(asset: unknown): Record<string, unknown> | null {
  if (!asset || typeof asset !== "object") return null;
  const meta = (asset as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object") return null;
  return meta as Record<string, unknown>;
}

/** Extract the project id from an open-asset payload's meta. Prefer UUIDs. */
export function assetProjectId(asset: unknown): string | null {
  const record = metaRecord(asset);
  if (!record) return null;
  const candidates: string[] = [];
  for (const key of ["website_id", "project_id", "slug", "site_id"]) {
    const value = trimmedString(record[key], 256);
    if (value) candidates.push(value);
  }
  return (
    candidates.find((value) => CANONICAL_PROJECT_ID.test(value)) ||
    candidates[0] ||
    null
  );
}

/** Durable library artifact id: top-level artifactId or meta.artifact_id. */
export function assetArtifactId(asset: unknown): string | null {
  if (!asset || typeof asset !== "object") return null;
  const top = trimmedString((asset as { artifactId?: unknown }).artifactId);
  if (top) return top;
  const record = metaRecord(asset);
  return record ? trimmedString(record.artifact_id) : null;
}

/** Durable library revision id: top-level revisionId or meta.revision_id. */
export function assetRevisionId(asset: unknown): string | null {
  if (!asset || typeof asset !== "object") return null;
  const top = trimmedString((asset as { revisionId?: unknown }).revisionId);
  if (top) return top;
  const record = metaRecord(asset);
  return record ? trimmedString(record.revision_id) : null;
}

export interface EmbedEditorQueryContext {
  host: string;
  instanceId: string;
  projectId: string;
  artifactId: string;
  revisionId: string;
  starterId: string;
  githubRepo: string;
  commitSha: string;
  blank: boolean;
}

export const EMPTY_EMBED_EDITOR_QUERY: EmbedEditorQueryContext = {
  host: "",
  instanceId: "",
  projectId: "",
  artifactId: "",
  revisionId: "",
  starterId: "",
  githubRepo: "",
  commitSha: "",
  blank: false,
};

/** Parse /embed/site-editor query identity (host may be any *.oceanleo.com). */
export function parseEmbedEditorQuery(
  search: string | URLSearchParams,
): EmbedEditorQueryContext {
  const query =
    typeof search === "string"
      ? new URLSearchParams(
          search.startsWith("?") ? search.slice(1) : search,
        )
      : search;
  const rawInstanceId = query.get("instance") || "";
  const instanceId = /^[A-Za-z0-9_.:-]{1,128}$/.test(rawInstanceId)
    ? rawInstanceId
    : "";
  return {
    host: query.get("host") || "",
    instanceId,
    projectId: query.get("projectId") || query.get("siteId") || "",
    artifactId: trimmedString(query.get("artifactId")) || "",
    revisionId: trimmedString(query.get("revisionId")) || "",
    starterId: query.get("starterId") || "",
    githubRepo: query.get("githubRepo") || "",
    commitSha: query.get("commitSha") || "",
    blank: query.get("blank") === "1",
  };
}

/** Extract the immutable platform Starter slug from an open-asset payload. */
export function assetStarterId(asset: unknown): string | null {
  if (!asset || typeof asset !== "object") return null;
  const meta = (asset as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object") return null;
  const value = (meta as Record<string, unknown>).starter_id;
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{1,63}$/.test(value)
    ? value
    : null;
}

export function assetGithubRepo(asset: unknown): string | null {
  if (!asset || typeof asset !== "object") return null;
  const meta = (asset as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object") return null;
  const value = (meta as Record<string, unknown>).github_repo;
  return typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(
      value,
    )
    ? value
    : null;
}

export function assetCommitSha(asset: unknown): string | null {
  if (!asset || typeof asset !== "object") return null;
  const meta = (asset as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object") return null;
  const value = (meta as Record<string, unknown>).commit_sha;
  return typeof value === "string" && /^[a-f0-9]{7,40}$/i.test(value)
    ? value
    : null;
}

/** Extract an owner-bound private source snapshot ID from a saved library item. */
export function assetSourceSnapshotId(asset: unknown): string | null {
  if (!asset || typeof asset !== "object") return null;
  const meta = (asset as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object") return null;
  const value = (meta as Record<string, unknown>).source_snapshot_id;
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
    ? value
    : null;
}

export function assetTitle(asset: unknown): string {
  if (!asset || typeof asset !== "object") return "";
  const title = (asset as { title?: unknown }).title;
  return typeof title === "string" ? title : "";
}

// ---------------------------------------------------------------------------
// Config editing
// ---------------------------------------------------------------------------

/**
 * Immutable update: deep-clone the config, let the caller mutate the draft.
 * All property-panel edits funnel through this so history snapshots stay
 * cheap and referentially clean.
 */
export function produceConfig(
  config: VirtualSiteConfig,
  mutate: (draft: VirtualSiteConfig) => void,
): VirtualSiteConfig {
  const draft = JSON.parse(JSON.stringify(config)) as VirtualSiteConfig;
  mutate(draft);
  // The builder keeps `sections` as the home-page compatibility alias while
  // the renderer reads `pages[0].sections`. Keep both views atomically synced
  // after every visual edit so the canvas never displays stale content.
  if (draft.pages[0]) draft.pages[0].sections = draft.sections;
  return draft;
}

export type Selection =
  | { kind: "site" }
  | { kind: "section"; id: string; focusPath?: string }
  | null;

export const SECTION_TYPE_LABELS: Record<VirtualSectionType, string> = {
  hero: "Hero 首屏",
  stats: "数据指标",
  "feature-grid": "功能网格",
  pricing: "价格方案",
  footer: "页脚",
};

export const ADDABLE_SECTION_TYPES: VirtualSectionType[] = [
  "hero",
  "stats",
  "feature-grid",
  "pricing",
  "footer",
];

export function sectionIndexById(
  config: VirtualSiteConfig,
  id: string,
): number {
  return config.sections.findIndex((section) => section.id === id);
}

/** Move sections[index] by delta (−1 up / +1 down), clamped. */
export function moveSection(
  config: VirtualSiteConfig,
  index: number,
  delta: number,
): VirtualSiteConfig {
  const target = index + delta;
  if (index < 0 || index >= config.sections.length) return config;
  if (target < 0 || target >= config.sections.length) return config;
  return produceConfig(config, (draft) => {
    const [moved] = draft.sections.splice(index, 1);
    draft.sections.splice(target, 0, moved);
  });
}

export function duplicateSection(
  config: VirtualSiteConfig,
  index: number,
): VirtualSiteConfig {
  const source = config.sections[index];
  if (!source) return config;
  return produceConfig(config, (draft) => {
    const clone = JSON.parse(JSON.stringify(source)) as VirtualSiteSection;
    clone.id = `${clone.type}-${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    draft.sections.splice(index + 1, 0, clone);
  });
}

// ---------------------------------------------------------------------------
// Click → field mapping (Manus-style "click the text you want to edit")
// ---------------------------------------------------------------------------

export type FieldEntry = { path: string; value: string };

/**
 * All string leaves of a section's content, as dotted paths relative to
 * `content` (e.g. "title", "plans.0.name", "items.1.label"). Used to map a
 * clicked DOM element's text back to the config field it came from.
 */
export function collectSectionFields(section: VirtualSiteSection): FieldEntry[] {
  const out: FieldEntry[] = [];
  function walk(node: unknown, path: string) {
    if (typeof node === "string") {
      const trimmed = node.trim();
      if (trimmed) out.push({ path, value: trimmed });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, path ? `${path}.${i}` : String(i)));
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        walk(value, path ? `${path}.${key}` : key);
      }
    }
  }
  walk(section.content, "");
  return out;
}

/**
 * Given the clicked element inside a section, find the config field whose
 * value exactly equals the element's (or a close ancestor's) full text.
 * Walking up at most 4 levels mirrors EditModeOverlay's proven heuristic.
 */
export function resolveClickedField(
  section: VirtualSiteSection,
  target: Element | null,
): string | undefined {
  if (!target) return undefined;
  const explicit = target.closest<HTMLElement>("[data-editor-field]");
  const explicitPath = explicit?.dataset.editorField?.trim();
  if (explicitPath) return explicitPath;
  if (target instanceof HTMLElement && target.closest("img")) return "image";
  const entries = collectSectionFields(section);
  let el: HTMLElement | null = target as HTMLElement;
  let depth = 0;
  while (el && depth < 4) {
    const text = (el.textContent || "").trim();
    if (text) {
      const match = entries.find((entry) => entry.value === text);
      if (match) return match.path;
    }
    el = el.parentElement;
    depth++;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Undo / redo history
// ---------------------------------------------------------------------------

export interface EditorHistory {
  past: VirtualSiteConfig[];
  present: VirtualSiteConfig;
  future: VirtualSiteConfig[];
}

const HISTORY_LIMIT = 60;

export function historyInit(config: VirtualSiteConfig): EditorHistory {
  return { past: [], present: config, future: [] };
}

export function historyPush(
  history: EditorHistory,
  next: VirtualSiteConfig,
): EditorHistory {
  return {
    past: [...history.past.slice(-(HISTORY_LIMIT - 1)), history.present],
    present: next,
    future: [],
  };
}

export function historyUndo(history: EditorHistory): EditorHistory {
  if (history.past.length === 0) return history;
  return {
    past: history.past.slice(0, -1),
    present: history.past[history.past.length - 1],
    future: [history.present, ...history.future],
  };
}

export function historyRedo(history: EditorHistory): EditorHistory {
  if (history.future.length === 0) return history;
  return {
    past: [...history.past, history.present],
    present: history.future[0],
    future: history.future.slice(1),
  };
}
