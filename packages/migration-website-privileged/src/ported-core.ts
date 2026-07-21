import { promises as dns } from "node:dns";

import type { PluginRouteHandler } from "@oceanleo/plugin-runtime";

import {
  authenticated,
  decryptVaultValue,
  fetchWithTimeout,
  json,
  parameter,
  parseCursorErrorDetail,
  parseRecord,
  responseHandler,
  stringValue,
  supabaseFor,
  type WebsiteSupabaseClient,
} from "./runtime";
import { MIGRATION_SQL } from "./setup-migration-sql";

const CURSOR_API_BASE = "https://api.cursor.com";
const ALLOWED_CURSOR_MODELS = [
  "gpt-5.4-fast",
  "claude-4.6-opus-fast",
  "claude-opus-4-6",
] as const;
const DEFAULT_CURSOR_MODEL = ALLOWED_CURSOR_MODELS[0];

function normalizeCursorModel(model: string): string {
  const trimmed = model.trim();
  if (trimmed === "claude-opus-4-6-fast") return "claude-4.6-opus-fast";
  if (trimmed === "claude-4.6-opus") return "claude-opus-4-6";
  return ALLOWED_CURSOR_MODELS.includes(
    trimmed as (typeof ALLOWED_CURSOR_MODELS)[number],
  )
    ? trimmed
    : DEFAULT_CURSOR_MODEL;
}

const cursorAgentHandler = responseHandler({
  POST: async (request) => {
    const isPreview = request.headers.get("X-Preview-Mode") === "true";
    if (isPreview) {
      const authHeader = request.headers.get("Authorization");
      if (!authHeader) {
        return json(
          { error: "Authorization required for preview", remaining: 0 },
          429,
        );
      }
      const quotaResponse = await fetch(
        new URL("/api/preview/quota", request.url),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
          },
          body: JSON.stringify({
            action: "consume",
            templateSlug:
              request.headers.get("X-Template-Slug") || "default",
          }),
        },
      );
      if (quotaResponse.status === 429) {
        const result = (await quotaResponse.json()) as Record<string, unknown>;
        return json(
          {
            error: result.error || "Preview quota exhausted",
            remaining: 0,
          },
          429,
        );
      }
      if (!quotaResponse.ok) {
        return json({ error: "Failed to check quota", remaining: 0 }, 429);
      }
    }

    const apiKey = process.env.CURSOR_API_KEY;
    const repoUrl = isPreview
      ? process.env.CURSOR_PREVIEW_REPO_URL || process.env.CURSOR_REPO_URL
      : process.env.CURSOR_REPO_URL;
    const baseBranch = isPreview
      ? process.env.CURSOR_PREVIEW_BRANCH || "preview-sandbox"
      : process.env.CURSOR_BASE_BRANCH || "main";
    if (!apiKey) {
      return json(
        { error: "CURSOR_API_KEY is not configured on the server." },
        500,
      );
    }
    if (!repoUrl) {
      return json(
        { error: "CURSOR_REPO_URL is not configured on the server." },
        500,
      );
    }

    let payload: {
      prompt?: unknown;
      model?: unknown;
      mcpServers?: unknown;
    };
    try {
      payload = (await request.json()) as typeof payload;
    } catch {
      return json({ error: "Request body must be valid JSON." }, 400);
    }
    const prompt =
      typeof payload.prompt === "string" ? payload.prompt.trim() : "";
    if (!prompt) return json({ error: "Prompt cannot be empty." }, 400);
    const model = normalizeCursorModel(
      typeof payload.model === "string"
        ? payload.model
        : process.env.CURSOR_MODEL || DEFAULT_CURSOR_MODEL,
    );
    const mcpServers =
      Array.isArray(payload.mcpServers) &&
      payload.mcpServers.every((value) => typeof value === "string")
        ? payload.mcpServers
        : [];

    try {
      const response = await fetch(`${CURSOR_API_BASE}/v0/agents`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: { text: prompt },
          model,
          source: { repository: repoUrl, ref: baseBranch },
          target: { autoCreatePr: true },
        }),
      });
      if (!response.ok) {
        const detail = parseCursorErrorDetail(await response.text());
        return json(
          {
            error: detail
              ? `Cursor API returned an error (${response.status}): ${detail}`
              : `Cursor API returned an error (${response.status})`,
          },
          response.status,
        );
      }
      const data = (await response.json()) as Record<string, any>;
      return json({
        agentId: data.id,
        status: data.status,
        branch: data.target?.branch ?? null,
        model,
        mcpServers,
        isPreview,
      });
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to call Cursor API.",
        },
        500,
      );
    }
  },
});

const cursorAgentStatusHandler = responseHandler({
  GET: async (_request, params) => {
    const apiKey = process.env.CURSOR_API_KEY;
    if (!apiKey) {
      return json(
        { error: "CURSOR_API_KEY is not configured on the server." },
        500,
      );
    }
    const id = parameter(params, "id");
    if (!id) return json({ error: "Missing agent ID." }, 400);
    try {
      const response = await fetch(`${CURSOR_API_BASE}/v0/agents/${id}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) {
        const detail = parseCursorErrorDetail(await response.text());
        return json(
          {
            error: detail
              ? `Cursor API returned an error (${response.status}): ${detail}`
              : `Cursor API returned an error (${response.status})`,
          },
          response.status,
        );
      }
      const data = (await response.json()) as Record<string, any>;
      return json({
        agentId: data.id,
        status: data.status,
        summary: data.summary ?? null,
        prUrl: data.pullRequestUrl ?? null,
        branch: data.target?.branch ?? null,
        createdAt: data.createdAt ?? null,
      });
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to fetch agent status.",
        },
        500,
      );
    }
  },
});

const MODEL_GROUPS = [
  { fallback: "gpt-5.4-fast", aliases: ["gpt-5.4-fast"] },
  {
    fallback: "claude-4.6-opus-fast",
    aliases: ["claude-4.6-opus-fast", "claude-opus-4-6-fast"],
  },
  {
    fallback: "claude-opus-4-6",
    aliases: ["claude-opus-4-6", "claude-4.6-opus"],
  },
] as const;

function fallbackModels(): string[] {
  return MODEL_GROUPS.map(({ fallback }) => fallback);
}

const cursorModelsHandler = responseHandler({
  GET: async () => {
    const apiKey = process.env.CURSOR_API_KEY;
    if (!apiKey) return json({ models: fallbackModels() });
    try {
      const response = await fetch(`${CURSOR_API_BASE}/v0/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) return json({ models: fallbackModels() });
      const data = (await response.json()) as { models?: unknown };
      if (!Array.isArray(data.models) || data.models.length === 0) {
        return json({ models: fallbackModels() });
      }
      const available = new Set(
        data.models
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean),
      );
      return json({
        models: MODEL_GROUPS.map(
          (group) =>
            group.aliases.find((alias) => available.has(alias)) ??
            group.fallback,
        ),
      });
    } catch {
      return json({ models: fallbackModels() });
    }
  },
});

const deployStatusHandler = responseHandler({
  GET: async (request, params) => {
    try {
      const auth = await authenticated(request);
      if (!auth.ok) return auth.response;
      const id = parameter(params, "id");
      const { data: site, error } = await auth.supabase
        .from("deployed_sites")
        .select("*")
        .eq("id", id)
        .eq("user_id", auth.user.id)
        .single();
      if (error || !site) return json({ error: "Site not found" }, 404);
      const row = site as Record<string, any>;
      const source = typeof row.source === "string" ? row.source : "template";
      const capabilities =
        row.capabilities &&
        typeof row.capabilities === "object" &&
        !Array.isArray(row.capabilities)
          ? (row.capabilities as Record<string, boolean>)
          : {};
      const effectiveCapabilities: Record<string, boolean> = {
        vibe_code: source === "template",
        env_edit: true,
        toggle_dns: true,
        domain: true,
        ...capabilities,
      };
      const hostingMode =
        (typeof row.hosting_mode === "string" ? row.hosting_mode : null) ||
        (row.server_connection_id
          ? "remote_server"
          : row.vercel_project_id
            ? "vercel"
            : null);
      if (hostingMode === "platform" || hostingMode === "remote_server") {
        if (capabilities.vibe_code === undefined) {
          effectiveCapabilities.vibe_code = true;
        }
      }
      return json({
        id: row.id,
        name: row.name,
        status: row.status,
        pausedAt: row.paused_at ?? null,
        siteUrl: row.site_url,
        githubRepo: row.github_repo,
        githubRepoUrl: row.github_repo_url,
        vercelProjectId: row.vercel_project_id,
        vercelProjectUrl: row.vercel_project_url,
        supabaseProjectRef: row.supabase_project_ref,
        customDomain: row.custom_domain || null,
        customDomainStatus: row.custom_domain_status || null,
        backendProvider: row.backend_provider || null,
        backendUrl: row.backend_url || null,
        backendStatus: row.backend_status || null,
        backendDeployError: row.backend_deploy_error ?? null,
        backendDeployLog: row.backend_deploy_log ?? [],
        backendPort: row.backend_port || null,
        serverConnectionId: row.server_connection_id || null,
        hostingMode,
        platformSubdomain: row.platform_subdomain ?? null,
        platformDeployError: row.platform_deploy_error ?? null,
        steps: row.deploy_log || [],
        source,
        capabilities: effectiveCapabilities,
        toggleError: row.toggle_error ?? null,
        dnsProvider:
          typeof row.dns_provider === "string"
            ? row.dns_provider
            : "cloudflare",
      });
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error ? error.message : "Internal server error",
        },
        500,
      );
    }
  },
});

const DEFAULT_PREVIEW_MAX = 5;
const PREVIEW_RESET_HOURS = 24;

const previewQuotaHandler = responseHandler({
  POST: async (request) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    let body: { action?: string; templateSlug?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const action = body.action || "check";
    const templateSlug = body.templateSlug || "default";
    const { data: existing } = await auth.supabase
      .from("preview_quotas")
      .select("*")
      .eq("user_id", auth.user.id)
      .eq("template_slug", templateSlug)
      .single();
    const now = new Date();
    if (!existing) {
      if (action === "consume") {
        const resetAt = new Date(
          now.getTime() + PREVIEW_RESET_HOURS * 60 * 60 * 1_000,
        );
        await auth.supabase.from("preview_quotas").insert({
          user_id: auth.user.id,
          template_slug: templateSlug,
          used_count: 1,
          max_count: DEFAULT_PREVIEW_MAX,
          last_used_at: now.toISOString(),
          reset_at: resetAt.toISOString(),
        });
        return json({
          remaining: DEFAULT_PREVIEW_MAX - 1,
          max: DEFAULT_PREVIEW_MAX,
          resetAt: resetAt.toISOString(),
          consumed: true,
        });
      }
      return json({
        remaining: DEFAULT_PREVIEW_MAX,
        max: DEFAULT_PREVIEW_MAX,
        resetAt: null,
        consumed: false,
      });
    }
    let usedCount = Number(existing.used_count) || 0;
    let resetAt = existing.reset_at ? new Date(existing.reset_at) : null;
    if (resetAt && now >= resetAt) {
      usedCount = 0;
      resetAt = new Date(
        now.getTime() + PREVIEW_RESET_HOURS * 60 * 60 * 1_000,
      );
      await auth.supabase
        .from("preview_quotas")
        .update({
          used_count: 0,
          reset_at: resetAt.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq("id", existing.id);
    }
    const max = Number(existing.max_count) || DEFAULT_PREVIEW_MAX;
    const remaining = Math.max(0, max - usedCount);
    if (action === "consume") {
      if (remaining <= 0) {
        return json(
          {
            error: "Preview quota exhausted",
            remaining: 0,
            max,
            resetAt: resetAt?.toISOString() || null,
          },
          429,
        );
      }
      const nextReset =
        resetAt ||
        new Date(now.getTime() + PREVIEW_RESET_HOURS * 60 * 60 * 1_000);
      await auth.supabase
        .from("preview_quotas")
        .update({
          used_count: usedCount + 1,
          last_used_at: now.toISOString(),
          reset_at: nextReset.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq("id", existing.id);
      return json({
        remaining: remaining - 1,
        max,
        resetAt: nextReset.toISOString(),
        consumed: true,
      });
    }
    return json({
      remaining,
      max,
      resetAt: resetAt?.toISOString() || null,
      consumed: false,
    });
  },
});

async function probeTable(
  supabase: WebsiteSupabaseClient,
  table: string,
  columns: readonly string[],
): Promise<{ ok: boolean; missing: string[] }> {
  const missing: string[] = [];
  for (const column of columns) {
    const { error } = await supabase.from(table).select(column).limit(1);
    if (
      error &&
      /does not exist|schema cache|could not find|column/i.test(error.message)
    ) {
      missing.push(column);
    }
  }
  return { ok: missing.length === 0, missing };
}

const setupCheckDbHandler = responseHandler({
  GET: async (request) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    const deployed = await probeTable(auth.supabase, "deployed_sites", [
      "id",
      "deploy_log",
      "backend_deploy_error",
      "backend_deploy_log",
      "custom_domain",
      "user_template_id",
      "applied_overrides",
      "paused_at",
      "source",
      "capabilities",
      "dns_provider",
      "toggle_error",
    ]);
    const vault = await probeTable(auth.supabase, "vault_entries", ["id"]);
    const servers = await probeTable(auth.supabase, "server_connections", [
      "id",
    ]);
    const userTemplates = await probeTable(
      auth.supabase,
      "user_templates",
      ["id", "overrides", "base_template_slug", "snapshot_ref"],
    );
    const templates = await probeTable(auth.supabase, "templates", [
      "id",
      "slots",
      "default_overrides",
    ]);
    return json({
      ok:
        deployed.ok &&
        vault.ok &&
        servers.ok &&
        userTemplates.ok &&
        templates.ok,
      tables: {
        deployed_sites: deployed,
        vault_entries: vault,
        server_connections: servers,
        user_templates: userTemplates,
        templates,
      },
    });
  },
});

function supabaseProjectRef(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  const match = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
  return match?.[1] ?? null;
}

async function executeManagementSql(
  token: string,
  projectRef: string,
  sql: string,
): Promise<void> {
  const response = await fetchWithTimeout(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
      timeoutMs: 120_000,
    },
  );
  if (!response.ok) {
    const err = await response.text();
    throw new Error(
      `Supabase SQL execution failed (${response.status}): ${err}`,
    );
  }
}

const setupInitDbHandler = responseHandler({
  POST: async (request) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;

    const projectRef = supabaseProjectRef();
    if (!projectRef) {
      return json(
        { error: "Cannot determine Supabase project ref from URL" },
        500,
      );
    }

    const { data: vaultEntry } = await auth.supabase
      .from("vault_entries")
      .select("encrypted_token, iv, auth_tag")
      .eq("user_id", auth.user.id)
      .eq("platform", "supabase")
      .single();
    if (!vaultEntry) {
      return json(
        {
          error:
            "Supabase management token not found. Connect Supabase first.",
        },
        400,
      );
    }

    let managementToken: string;
    try {
      const raw = decryptVaultValue(
        vaultEntry.encrypted_token,
        vaultEntry.iv,
        vaultEntry.auth_tag,
      ).trim();
      managementToken =
        stringValue(parseRecord(raw)?.access_token) || raw;
    } catch {
      return json(
        { error: "Failed to decrypt Supabase management token" },
        500,
      );
    }

    try {
      await executeManagementSql(managementToken, projectRef, MIGRATION_SQL);
      return json({
        status: "ok",
        message: "Database tables created successfully",
      });
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error ? error.message : "Migration failed",
        },
        500,
      );
    }
  },
});

const siteVibeCodeHandler = responseHandler({
  POST: async (request, params) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    let body: {
      prompt?: unknown;
      cursorApiKey?: unknown;
      model?: unknown;
      branch?: unknown;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const prompt =
      typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return json({ error: "prompt is required" }, 400);
    const apiKey =
      typeof body.cursorApiKey === "string"
        ? body.cursorApiKey.trim()
        : "";
    if (!apiKey) {
      return json(
        {
          error:
            "cursorApiKey is required. Save your Cursor API key in Vault first (Vault → Cursor).",
        },
        400,
      );
    }
    const id = parameter(params, "id");
    const { data: site } = await auth.supabase
      .from("deployed_sites")
      .select("github_repo_url, name")
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .single();
    if (!site) return json({ error: "Site not found" }, 404);
    if (!site.github_repo_url) {
      return json(
        {
          error:
            "This site has no GitHub repository yet. Finish the initial deployment first.",
        },
        409,
      );
    }
    const model =
      typeof body.model === "string" && body.model.trim()
        ? body.model.trim().replace(/^composer1\.5$/, "composer-1.5")
        : "composer-1.5";
    const branch =
      typeof body.branch === "string" && body.branch.trim()
        ? body.branch.trim()
        : "main";
    try {
      const response = await fetch(`${CURSOR_API_BASE}/v0/agents`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: { text: prompt },
          model,
          source: { repository: site.github_repo_url, ref: branch },
          target: { autoCreatePr: true },
        }),
      });
      if (!response.ok) {
        const detail = parseCursorErrorDetail(await response.text());
        const hint =
          response.status === 401 || response.status === 403
            ? " Make sure your Cursor API key is valid and that you've authorized the Cursor GitHub App for this repository."
            : "";
        return json(
          {
            error: detail
              ? `Cursor API error (${response.status}): ${detail}${hint}`
              : `Cursor API error (${response.status})${hint}`,
          },
          response.status,
        );
      }
      const data = (await response.json()) as Record<string, any>;
      return json({
        agentId: data.id,
        status: data.status,
        branch: data.target?.branch ?? null,
        prUrl: data.pullRequestUrl ?? null,
        model,
        siteName: site.name,
        repoUrl: site.github_repo_url,
      });
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to call Cursor API.",
        },
        500,
      );
    }
  },
  GET: async (request, params) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    const id = parameter(params, "id");
    const url = new URL(request.url);
    const agentId = url.searchParams.get("agentId");
    const apiKey =
      url.searchParams.get("cursorApiKey") ||
      request.headers.get("X-Cursor-Key") ||
      "";
    if (!agentId) return json({ error: "agentId is required" }, 400);
    if (!apiKey) {
      return json(
        {
          error:
            "cursorApiKey is required (header X-Cursor-Key or ?cursorApiKey=)",
        },
        400,
      );
    }
    const { data: site } = await auth.supabase
      .from("deployed_sites")
      .select("id")
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .single();
    if (!site) return json({ error: "Site not found" }, 404);
    try {
      const response = await fetch(
        `${CURSOR_API_BASE}/v0/agents/${agentId}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );
      if (!response.ok) {
        const detail = parseCursorErrorDetail(await response.text());
        return json(
          {
            error: detail
              ? `Cursor API error (${response.status}): ${detail}`
              : `Cursor API error (${response.status})`,
          },
          response.status,
        );
      }
      const data = (await response.json()) as Record<string, any>;
      return json({
        agentId: data.id,
        status: data.status,
        summary: data.summary ?? null,
        prUrl: data.pullRequestUrl ?? null,
        branch: data.target?.branch ?? null,
        createdAt: data.createdAt ?? null,
      });
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to fetch agent status.",
        },
        500,
      );
    }
  },
});

const VERCEL_A_RECORDS = new Set([
  "76.76.21.21",
  "76.76.21.61",
  "76.76.21.123",
]);

function dnsError(error: unknown): { code?: string; message?: string } {
  if (!error || typeof error !== "object") return {};
  const value = error as Record<string, unknown>;
  return {
    code: typeof value.code === "string" ? value.code : undefined,
    message: typeof value.message === "string" ? value.message : undefined,
  };
}

const siteDomainDnsHandler = responseHandler({
  GET: async (request, params) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    const { data: site } = await auth.supabase
      .from("deployed_sites")
      .select("custom_domain")
      .eq("id", parameter(params, "id"))
      .eq("user_id", auth.user.id)
      .single();
    if (!site?.custom_domain) return json({ error: "No domain bound" }, 404);
    const domain = site.custom_domain;
    let aRecords: string[] = [];
    let cnames: string[] = [];
    let aaaa: string[] = [];
    let error: string | null = null;
    try {
      aRecords = await dns.resolve4(domain);
    } catch (caught) {
      const detail = dnsError(caught);
      if (detail.code !== "ENODATA" && detail.code !== "ENOTFOUND") {
        error = `A: ${detail.code || detail.message || "unknown"}`;
      }
    }
    try {
      cnames = await dns.resolveCname(domain);
    } catch (caught) {
      const detail = dnsError(caught);
      if (
        detail.code !== "ENODATA" &&
        detail.code !== "ENOTFOUND" &&
        !error
      ) {
        error = `CNAME: ${detail.code || detail.message || "unknown"}`;
      }
    }
    try {
      aaaa = await dns.resolve6(domain);
    } catch {
      // IPv6 is optional.
    }
    const pointsToVercel =
      aRecords.some((value) => VERCEL_A_RECORDS.has(value)) ||
      cnames.some((value) => {
        const target = value.toLowerCase().replace(/\.$/, "");
        return (
          target === "vercel-dns.com" ||
          target === "cname.vercel-dns.com" ||
          target.endsWith(".vercel-dns.com")
        );
      });
    const propagated =
      aRecords.length === 0 && cnames.length === 0
        ? "unresolved"
        : pointsToVercel
          ? "active"
          : "pending";
    return json({
      domain,
      checkedAt: new Date().toISOString(),
      aRecords,
      cnames,
      aaaa,
      pointsToVercel,
      propagated,
      error,
    });
  },
});

const LANDING_SLOTS = [
  ["brand.name", "品牌名称", "Brand name", "text", "Mycreator", "brand"],
  ["brand.logo", "品牌 Logo URL", "Brand logo URL", "image", "", "brand"],
  ["hero.title", "主标题", "Hero title", "text", "用自然语言构建你自己的网站", "hero"],
  ["hero.subtitle", "副标题", "Hero subtitle", "longtext", "代码归你、基础设施归你。描述想要什么，AI 写给你看。", "hero"],
  ["hero.cta_primary", "主按钮文案", "Primary CTA", "text", "立即开始", "hero"],
  ["hero.cta_secondary", "次按钮文案", "Secondary CTA", "text", "浏览模板", "hero"],
  ["hero.image", "Hero 配图 URL", "Hero image URL", "image", "", "hero"],
  ["hero.bg_color", "Hero 背景色", "Hero background", "color", "#0f172a", "hero"],
  ["hero.text_color", "Hero 文字颜色", "Hero text color", "color", "#ffffff", "hero"],
  ["feature1.title", "功能 1 标题", "Feature 1 title", "text", "你拥有代码", "features"],
  ["feature1.desc", "功能 1 描述", "Feature 1 description", "longtext", "每一行代码都在你自己的 GitHub 仓库里。", "features"],
  ["feature2.title", "功能 2 标题", "Feature 2 title", "text", "你拥有基础设施", "features"],
  ["feature2.desc", "功能 2 描述", "Feature 2 description", "longtext", "部署到你自己的 Vercel + Supabase，不锁定。", "features"],
  ["feature3.title", "功能 3 标题", "Feature 3 title", "text", "自然语言编辑", "features"],
  ["feature3.desc", "功能 3 描述", "Feature 3 description", "longtext", "描述变更，AI 帮你改代码提 PR。", "features"],
  ["cta.title", "底部 CTA 标题", "Footer CTA title", "text", "准备好了吗？", "cta"],
  ["cta.desc", "底部 CTA 描述", "Footer CTA description", "longtext", "几分钟内拥有一个可上线的网站。", "cta"],
  ["cta.button", "底部按钮文案", "Footer CTA button", "text", "开始部署", "cta"],
  ["cta.bg_color", "底部 CTA 背景色", "Footer CTA background", "color", "#111827", "cta"],
].map(([id, label_zh, label_en, type, defaultValue, group]) => ({
  id,
  label_zh,
  label_en,
  type,
  default: defaultValue,
  group,
}));

const DEFAULT_TEMPLATE = {
  id: "default-template-id",
  slug: "default",
  name_zh: "Vibe Coding 标准版",
  name_en: "Vibe Coding Standard",
  description_zh:
    "用自然语言修改你的网站。内置 Self-Edit 功能，连接 Cursor AI Agent，让 AI 帮你写代码、提 PR。",
  description_en:
    "Edit your website with natural language. Built-in Self-Edit powered by Cursor AI Agent — AI writes code and opens PRs for you.",
  thumbnail_url: "/images/templates/default-thumbnail.svg",
  github_template_owner: "website",
  github_template_repo: "template-default",
  framework: "nextjs",
  supports_backend: false,
  required_platforms: ["github", "vercel", "supabase", "cursor"],
  optional_platforms: ["cloudflare"],
  is_free: true,
  price_cents: 0,
  version: "1.0.0",
  is_published: true,
  env_vars: [
    {
      key: "NEXT_PUBLIC_SUPABASE_URL",
      required: true,
      source: "supabase",
    },
    {
      key: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      required: true,
      source: "supabase",
    },
    { key: "CURSOR_API_KEY", required: true, source: "cursor" },
    { key: "CURSOR_REPO_URL", required: true, source: "github" },
    {
      key: "CURSOR_BASE_BRANCH",
      required: true,
      source: "auto",
      default: "main",
    },
    {
      key: "CURSOR_MODEL",
      required: false,
      source: "auto",
      default: "composer-1.5",
    },
  ],
  files_to_remove: [
    "back-end/",
    "docs/",
    "scripts/",
    ".cursorrules",
    "AGENTS.md",
    "agent.md",
    ".githooks/",
    ".cursor/rules/",
  ],
};

function templateWithSlots(template: Record<string, any>) {
  return {
    ...template,
    slots:
      Array.isArray(template.slots) && template.slots.length > 0
        ? template.slots
        : template.slug === "default"
          ? LANDING_SLOTS
          : [],
  };
}

const templatesHandler = responseHandler({
  GET: async (request) => {
    const slug = new URL(request.url).searchParams.get("slug");
    try {
      const supabase = supabaseFor(request);
      if (slug) {
        const { data } = await supabase
          .from("templates")
          .select("*")
          .eq("slug", slug)
          .eq("is_published", true)
          .single();
        const template = data || (slug === "default" ? DEFAULT_TEMPLATE : null);
        return json({
          template: template
            ? templateWithSlots(template as Record<string, any>)
            : null,
        });
      }
      const { data } = await supabase
        .from("templates")
        .select("*")
        .eq("is_published", true)
        .order("sort_order", { ascending: true });
      const templates =
        data && data.length > 0 ? data : [DEFAULT_TEMPLATE];
      return json({
        templates: templates.map((template) =>
          templateWithSlots(template as Record<string, any>),
        ),
      });
    } catch {
      return json({
        templates: [templateWithSlots(DEFAULT_TEMPLATE)],
      });
    }
  },
});

const userTemplatesHandler = responseHandler({
  GET: async (request) => {
    try {
      if (
        !process.env.NEXT_PUBLIC_SUPABASE_URL ||
        !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ) {
        return json({ templates: [], error: "Supabase env not configured" });
      }
      const auth = await authenticated(request);
      if (!auth.ok) return auth.response;
      const { data, error } = await auth.supabase
        .from("user_templates")
        .select(
          "id, base_template_slug, name, description, thumbnail_url, overrides, snapshot_ref, published_template_slug, created_at, updated_at",
        )
        .eq("user_id", auth.user.id)
        .order("updated_at", { ascending: false });
      return error
        ? json({ templates: [], error: error.message })
        : json({ templates: data || [] });
    } catch (error) {
      return json({
        templates: [],
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
  POST: async (request) => {
    try {
      const auth = await authenticated(request);
      if (!auth.ok) return auth.response;
      let body: Record<string, any>;
      try {
        body = (await request.json()) as Record<string, any>;
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }
      if (!body.base_template_slug || !body.name) {
        return json(
          { error: "base_template_slug and name are required" },
          400,
        );
      }
      const { data, error } = await auth.supabase
        .from("user_templates")
        .insert({
          user_id: auth.user.id,
          base_template_slug: body.base_template_slug,
          name: body.name,
          description: body.description || null,
          thumbnail_url: body.thumbnail_url || null,
          overrides: body.overrides || {},
        })
        .select()
        .single();
      return error
        ? json({ error: error.message }, 500)
        : json({ template: data });
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        500,
      );
    }
  },
});

const userTemplateHandler = responseHandler({
  GET: async (request, params) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    const { data, error } = await auth.supabase
      .from("user_templates")
      .select("*")
      .eq("id", parameter(params, "id"))
      .eq("user_id", auth.user.id)
      .single();
    return error || !data
      ? json({ error: "Not found" }, 404)
      : json({ template: data });
  },
  PATCH: async (request, params) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    let body: Record<string, any>;
    try {
      body = (await request.json()) as Record<string, any>;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    for (const key of ["name", "description", "thumbnail_url"]) {
      if (typeof body[key] === "string") patch[key] = body[key];
    }
    if (
      body.overrides &&
      typeof body.overrides === "object" &&
      !Array.isArray(body.overrides)
    ) {
      patch.overrides = body.overrides;
    }
    const { data, error } = await auth.supabase
      .from("user_templates")
      .update(patch)
      .eq("id", parameter(params, "id"))
      .eq("user_id", auth.user.id)
      .select()
      .single();
    return error || !data
      ? json({ error: error?.message || "Not found" }, 404)
      : json({ template: data });
  },
  DELETE: async (request, params) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    const { error } = await auth.supabase
      .from("user_templates")
      .delete()
      .eq("id", parameter(params, "id"))
      .eq("user_id", auth.user.id);
    return error
      ? json({ error: error.message }, 500)
      : json({ status: "ok" });
  },
});

export const CORE_WEBSITE_HANDLERS: Readonly<
  Record<string, PluginRouteHandler>
> = Object.freeze({
  "/api/cursor-agent": cursorAgentHandler,
  "/api/cursor-agent/[id]": cursorAgentStatusHandler,
  "/api/cursor-agent/models": cursorModelsHandler,
  "/api/deploy/[id]/status": deployStatusHandler,
  "/api/preview/quota": previewQuotaHandler,
  "/api/setup/check-db": setupCheckDbHandler,
  "/api/setup/init-db": setupInitDbHandler,
  "/api/sites/[id]/domain/dns": siteDomainDnsHandler,
  "/api/sites/[id]/vibe-code": siteVibeCodeHandler,
  "/api/templates": templatesHandler,
  "/api/user-templates": userTemplatesHandler,
  "/api/user-templates/[id]": userTemplateHandler,
});
