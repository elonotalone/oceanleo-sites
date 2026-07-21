import type { PluginRouteHandler } from "@oceanleo/plugin-runtime";

import {
  deleteDnsRecord,
  getZoneForDomain,
  listDnsRecords,
  upsertVercelDnsRecord,
} from "./cloudflare-zones";
import {
  getDefaultBranchSha,
  parseRepoIdentifier,
  setRepoTemplateFlag,
} from "./github-helpers";
import {
  allocatePlatformSlug,
  deployPlatformFiles,
  PLATFORM_HOST_PROVIDER,
  resolvePlatformTarget,
  slugifyHost,
  type PlatformFile,
} from "./platform-host";
import {
  authenticated,
  decryptVaultValue,
  fetchWithTimeout,
  json,
  parameter,
  parseRecord,
  publicSiteOrigin,
  record,
  responseHandler,
  stringValue,
} from "./runtime";
import {
  deleteEnvironmentVariable,
  deleteSupabaseProject,
  deleteVercelProject,
  getEnvironmentVariables,
  setEnvironmentVariables,
  triggerRedeploy,
  updateEnvironmentVariable,
} from "./vercel-api";
import { normalizeVirtualSiteConfig } from "./virtual-site-normalize";
import {
  renderVirtualSiteFiles,
  renderVirtualSiteToHtml,
} from "./virtual-site-render";

async function githubAccessToken(
  supabase: Extract<
    Awaited<ReturnType<typeof authenticated>>,
    { ok: true }
  >["supabase"],
  userId: string,
): Promise<string> {
  const { data } = await supabase
    .from("vault_entries")
    .select("encrypted_token, iv, auth_tag")
    .eq("user_id", userId)
    .eq("platform", "github")
    .single();
  if (!data) throw new Error("Connect GitHub first in Vault.");
  const raw = decryptVaultValue(
    data.encrypted_token,
    data.iv,
    data.auth_tag,
  );
  return stringValue(parseRecord(raw)?.access_token) || raw;
}

async function vercelCredentials(
  supabase: Extract<
    Awaited<ReturnType<typeof authenticated>>,
    { ok: true }
  >["supabase"],
  userId: string,
): Promise<{ token: string; teamId: string | null }> {
  const { data } = await supabase
    .from("vault_entries")
    .select("encrypted_token, iv, auth_tag")
    .eq("user_id", userId)
    .eq("platform", "vercel")
    .single();
  if (!data) throw new Error("Vercel not connected");
  const raw = decryptVaultValue(
    data.encrypted_token,
    data.iv,
    data.auth_tag,
  );
  const parsed = parseRecord(raw);
  return {
    token: stringValue(parsed?.access_token) || raw,
    teamId: stringValue(parsed?.team_id) || null,
  };
}

const SENSITIVE_PATTERNS = ["KEY", "SECRET", "PASSWORD", "TOKEN"];
const CORE_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "CURSOR_API_KEY",
  "CURSOR_REPO_URL",
  "CURSOR_BASE_BRANCH",
  "CURSOR_MODEL",
];

function isSensitive(key: string): boolean {
  const upper = key.toUpperCase();
  return SENSITIVE_PATTERNS.some((pattern) => upper.includes(pattern));
}

const sitesHandler = responseHandler({
  GET: async (request) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    const userTemplateId = new URL(request.url).searchParams.get(
      "userTemplateId",
    );
    let query = auth.supabase
      .from("deployed_sites")
      .select("*")
      .eq("user_id", auth.user.id)
      .neq("status", "deleted")
      .order("created_at", { ascending: false });
    if (userTemplateId) {
      query = query.eq("user_template_id", userTemplateId);
    }
    const { data: sites } = await query;
    return json({ sites: sites || [] });
  },
  PATCH: async (request) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    let body: { siteId?: string; name?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const siteId = typeof body.siteId === "string" ? body.siteId : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!siteId || !name) {
      return json({ error: "siteId and name are required" }, 400);
    }
    if (name.length > 80) {
      return json({ error: "Name must be 80 characters or fewer" }, 400);
    }
    const { data, error } = await auth.supabase
      .from("deployed_sites")
      .update({ name, updated_at: new Date().toISOString() })
      .eq("id", siteId)
      .eq("user_id", auth.user.id)
      .select("id, name")
      .single();
    return error || !data
      ? json({ error: "Site not found" }, 404)
      : json({ site: data });
  },
  DELETE: async (request) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    let body: {
      siteId?: string;
      deleteGithub?: boolean;
      deleteVercel?: boolean;
      deleteSupabase?: boolean;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const siteId = body.siteId;
    if (!siteId) return json({ error: "siteId is required" }, 400);

    const { data: site } = await auth.supabase
      .from("deployed_sites")
      .select("*")
      .eq("id", siteId)
      .eq("user_id", auth.user.id)
      .single();
    if (!site) return json({ error: "Site not found" }, 404);

    const errors: string[] = [];

    if (body.deleteGithub && site.github_repo) {
      try {
        const token = await githubAccessToken(auth.supabase, auth.user.id);
        const response = await fetch(
          `https://api.github.com/repos/${site.github_repo}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        if (!response.ok && response.status !== 404) {
          errors.push(`GitHub: ${response.status}`);
        }
      } catch (error) {
        errors.push(
          `GitHub: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
    }

    if (body.deleteVercel && site.vercel_project_id) {
      try {
        const { token, teamId } = await vercelCredentials(
          auth.supabase,
          auth.user.id,
        );
        await deleteVercelProject(token, site.vercel_project_id, teamId);
      } catch (error) {
        errors.push(
          `Vercel: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
    }

    if (body.deleteSupabase && site.supabase_project_ref) {
      try {
        const { data: vaultEntry } = await auth.supabase
          .from("vault_entries")
          .select("encrypted_token, iv, auth_tag")
          .eq("user_id", auth.user.id)
          .eq("platform", "supabase")
          .single();
        if (vaultEntry) {
          const raw = decryptVaultValue(
            vaultEntry.encrypted_token,
            vaultEntry.iv,
            vaultEntry.auth_tag,
          );
          const token =
            stringValue(parseRecord(raw)?.access_token) || raw;
          await deleteSupabaseProject(token, site.supabase_project_ref);
        }
      } catch (error) {
        errors.push(
          `Supabase: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
    }

    await auth.supabase
      .from("deployed_sites")
      .update({ status: "deleted", updated_at: new Date().toISOString() })
      .eq("id", siteId);

    return json({
      status: "deleted",
      errors: errors.length > 0 ? errors : undefined,
    });
  },
});

const siteEnvHandler = responseHandler({
  GET: async (request, params) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    const { data: site } = await auth.supabase
      .from("deployed_sites")
      .select("vercel_project_id")
      .eq("id", parameter(params, "id"))
      .eq("user_id", auth.user.id)
      .single();
    if (!site?.vercel_project_id) {
      return json({ error: "Site not found or no Vercel project" }, 404);
    }
    try {
      const { token, teamId } = await vercelCredentials(
        auth.supabase,
        auth.user.id,
      );
      const envVars = await getEnvironmentVariables(
        token,
        site.vercel_project_id,
        teamId,
      );
      return json({
        envVars: envVars.map((env) => ({
          id: env.id,
          key: env.key,
          value: isSensitive(env.key) ? "••••••••" : env.value || "",
          target: env.target,
          type: env.type,
          isCore: CORE_VARS.includes(env.key),
          isSensitive: isSensitive(env.key),
        })),
      });
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to read env vars",
        },
        500,
      );
    }
  },
  PUT: async (request, params) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    const { data: site } = await auth.supabase
      .from("deployed_sites")
      .select("vercel_project_id")
      .eq("id", parameter(params, "id"))
      .eq("user_id", auth.user.id)
      .single();
    if (!site?.vercel_project_id) {
      return json({ error: "Site not found or no Vercel project" }, 404);
    }
    let body: { updates?: { envId: string; value: string }[] };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    if (!Array.isArray(body.updates)) {
      return json({ error: "updates array is required" }, 400);
    }
    try {
      const { token, teamId } = await vercelCredentials(
        auth.supabase,
        auth.user.id,
      );
      for (const update of body.updates) {
        await updateEnvironmentVariable(
          token,
          site.vercel_project_id,
          update.envId,
          update.value,
          teamId,
        );
      }
      await triggerRedeploy(token, site.vercel_project_id, teamId);
      return json({ status: "updated", redeploying: true });
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to update env vars",
        },
        500,
      );
    }
  },
  POST: async (request, params) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    const { data: site } = await auth.supabase
      .from("deployed_sites")
      .select("vercel_project_id")
      .eq("id", parameter(params, "id"))
      .eq("user_id", auth.user.id)
      .single();
    if (!site?.vercel_project_id) {
      return json({ error: "Site not found or no Vercel project" }, 404);
    }
    let body: { key?: string; value?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    if (!body.key || !body.value) {
      return json({ error: "key and value are required" }, 400);
    }
    try {
      const { token, teamId } = await vercelCredentials(
        auth.supabase,
        auth.user.id,
      );
      await setEnvironmentVariables(
        token,
        site.vercel_project_id,
        [
          {
            key: body.key,
            value: body.value,
            target: ["production", "preview", "development"],
            type: isSensitive(body.key) ? "sensitive" : "plain",
          },
        ],
        teamId,
      );
      return json({ status: "added" });
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error ? error.message : "Failed to add env var",
        },
        500,
      );
    }
  },
  DELETE: async (request, params) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    const { data: site } = await auth.supabase
      .from("deployed_sites")
      .select("vercel_project_id")
      .eq("id", parameter(params, "id"))
      .eq("user_id", auth.user.id)
      .single();
    if (!site?.vercel_project_id) {
      return json({ error: "Site not found or no Vercel project" }, 404);
    }
    const envId = new URL(request.url).searchParams.get("envId");
    if (!envId) return json({ error: "envId is required" }, 400);
    try {
      const { token, teamId } = await vercelCredentials(
        auth.supabase,
        auth.user.id,
      );
      await deleteEnvironmentVariable(
        token,
        site.vercel_project_id,
        envId,
        teamId,
      );
      return json({ status: "deleted" });
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to delete env var",
        },
        500,
      );
    }
  },
});

const virtualConfigHandler = responseHandler({
  GET: async (request, params) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    const { data: site, error } = await auth.supabase
      .from("deployed_sites")
      .select(
        "id, name, status, site_url, virtual_site_config, hosting_mode, platform_subdomain, updated_at",
      )
      .eq("id", parameter(params, "id"))
      .eq("user_id", auth.user.id)
      .neq("status", "deleted")
      .single();
    if (error || !site) return json({ error: "Site not found" }, 404);
    return json({
      site: {
        id: site.id,
        name: site.name,
        status: site.status,
        siteUrl: site.site_url,
        hostingMode: site.hosting_mode,
        platformSubdomain: site.platform_subdomain,
      },
      config: site.virtual_site_config ?? null,
      version: site.updated_at,
    });
  },
  PUT: async (request, params) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    const id = parameter(params, "id");
    let body: { config?: unknown; expectedUpdatedAt?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    if (!body.config || typeof body.config !== "object") {
      return json({ error: "config object is required" }, 400);
    }

    const { data: current, error: currentError } = await auth.supabase
      .from("deployed_sites")
      .select(
        "id, name, slug, site_url, hosting_mode, platform_subdomain, virtual_site_config, updated_at",
      )
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .neq("status", "deleted")
      .single();
    if (currentError || !current) {
      return json({ error: "Site not found" }, 404);
    }
    if (!current.virtual_site_config) {
      return json(
        {
          error:
            "This content is not an editable visual-site project. Import or create it in the site builder first.",
        },
        409,
      );
    }

    const normalized = normalizeVirtualSiteConfig(body.config);
    const expectedUpdatedAt =
      typeof body.expectedUpdatedAt === "string"
        ? body.expectedUpdatedAt
        : "";
    if (!expectedUpdatedAt || expectedUpdatedAt !== current.updated_at) {
      return json(
        {
          error: "站点已在其他窗口发生变化，请重新载入后再保存。",
          version: current.updated_at,
        },
        409,
      );
    }

    const shouldDeploy =
      current.hosting_mode === "platform" ||
      Boolean(current.platform_subdomain);
    const platformSlug = shouldDeploy
      ? current.platform_subdomain
        ? String(current.platform_subdomain).split(".")[0]
        : slugifyHost(current.slug || current.name)
      : "";
    if (
      shouldDeploy &&
      (!platformSlug ||
        slugifyHost(platformSlug) !== platformSlug ||
        (current.platform_subdomain &&
          current.platform_subdomain !== `${platformSlug}.oceanleo.app`))
    ) {
      return json({ error: "Invalid platform deployment target." }, 409);
    }

    const nextUpdatedAt = new Date().toISOString();
    const { data: reserved, error: reserveError } = await auth.supabase
      .from("deployed_sites")
      .update({
        virtual_site_config: normalized,
        updated_at: nextUpdatedAt,
      })
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .eq("updated_at", expectedUpdatedAt)
      .select("id, name, site_url, platform_subdomain")
      .maybeSingle();
    if (reserveError || !reserved) {
      return json(
        { error: "站点已在其他窗口发生变化，请重新载入后再保存。" },
        reserveError ? 500 : 409,
      );
    }

    let data = reserved;
    let deployedUrl: string | null = current.site_url;
    if (shouldDeploy) {
      try {
        const files = renderVirtualSiteFiles(normalized).map((file) => ({
          path: file.path,
          contentBase64: Buffer.from(file.html, "utf-8").toString("base64"),
        }));
        const deployed = await deployPlatformFiles(
          resolvePlatformTarget(),
          platformSlug!,
          files,
        );
        deployedUrl = deployed.url;
      } catch (error) {
        await auth.supabase
          .from("deployed_sites")
          .update({
            virtual_site_config: current.virtual_site_config,
            site_url: current.site_url,
            updated_at: expectedUpdatedAt,
          })
          .eq("id", id)
          .eq("user_id", auth.user.id)
          .eq("updated_at", nextUpdatedAt);
        return json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Could not publish the edited site.",
          },
          502,
        );
      }
    }

    if (deployedUrl && deployedUrl !== current.site_url) {
      const { data: finalized, error: finalizeError } = await auth.supabase
        .from("deployed_sites")
        .update({ site_url: deployedUrl })
        .eq("id", id)
        .eq("user_id", auth.user.id)
        .eq("updated_at", nextUpdatedAt)
        .select("id, name, site_url, platform_subdomain")
        .maybeSingle();
      if (finalizeError) {
        return json(
          {
            error: finalizeError.message || "Could not finalize site URL.",
          },
          500,
        );
      }
      if (finalized) data = finalized;
    }

    return json({
      ok: true,
      site: {
        id: data.id,
        name: data.name,
        siteUrl: data.site_url,
        platformSubdomain: data.platform_subdomain,
      },
      config: normalized,
      version: nextUpdatedAt,
    });
  },
});

const userTemplateSnapshotHandler = responseHandler({
  POST: async (request, params) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    const id = parameter(params, "id");
    let body: { siteId?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const siteId = typeof body.siteId === "string" ? body.siteId : null;
    if (!siteId) return json({ error: "siteId is required" }, 400);

    const { data: userTmpl, error: utErr } = await auth.supabase
      .from("user_templates")
      .select("id, user_id")
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .single();
    if (utErr || !userTmpl) {
      return json({ error: "user_template not found" }, 404);
    }

    const { data: site, error: siteErr } = await auth.supabase
      .from("deployed_sites")
      .select("id, user_id, github_repo, github_repo_url, name")
      .eq("id", siteId)
      .eq("user_id", auth.user.id)
      .single();
    if (siteErr || !site) {
      return json({ error: "Site not found" }, 404);
    }

    const repoIdent =
      (site.github_repo && parseRepoIdentifier(site.github_repo)) ||
      (site.github_repo_url && parseRepoIdentifier(site.github_repo_url));
    if (!repoIdent) {
      return json({ error: "Site has no usable GitHub repo." }, 409);
    }

    let token: string;
    try {
      token = await githubAccessToken(auth.supabase, auth.user.id);
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "GitHub token unavailable",
        },
        400,
      );
    }

    let branchInfo: { branch: string; sha: string };
    try {
      branchInfo = await getDefaultBranchSha(
        token,
        repoIdent.owner,
        repoIdent.repo,
      );
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Could not read repo state",
        },
        502,
      );
    }

    try {
      await setRepoTemplateFlag(
        token,
        repoIdent.owner,
        repoIdent.repo,
        true,
      );
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Could not mark repo as template",
        },
        502,
      );
    }

    const snapshotRef = {
      type: "github-template" as const,
      owner: repoIdent.owner,
      repo: repoIdent.repo,
      defaultBranch: branchInfo.branch,
      ref: branchInfo.sha,
      capturedAt: new Date().toISOString(),
      capturedFromSiteId: siteId,
    };

    const { error: updErr } = await auth.supabase
      .from("user_templates")
      .update({
        snapshot_ref: snapshotRef,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", auth.user.id);
    if (updErr) {
      return json(
        { error: `Failed to persist snapshot: ${updErr.message}` },
        500,
      );
    }
    return json({ status: "ok", snapshot: snapshotRef });
  },
  DELETE: async (request, params) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    const { error } = await auth.supabase
      .from("user_templates")
      .update({
        snapshot_ref: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", parameter(params, "id"))
      .eq("user_id", auth.user.id);
    return error
      ? json({ error: error.message }, 500)
      : json({ status: "ok" });
  },
});

async function updateSiteResilient(
  supabase: Extract<
    Awaited<ReturnType<typeof authenticated>>,
    { ok: true }
  >["supabase"],
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from("deployed_sites")
    .update(patch)
    .eq("id", id);
  if (!error) return;
  const fallback = { ...patch };
  for (const key of Object.keys(fallback)) {
    if (
      key.startsWith("platform_") ||
      key === "hosting_mode" ||
      key === "host_provider"
    ) {
      if (new RegExp(key).test(error.message || "")) delete fallback[key];
    }
  }
  await supabase.from("deployed_sites").update(fallback).eq("id", id);
}

const platformDeployHandler = responseHandler({
  POST: async (request) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;

    let body: {
      siteId?: string;
      siteName?: string;
      virtualSiteConfig?: unknown;
      files?: PlatformFile[];
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    let target;
    try {
      target = resolvePlatformTarget();
    } catch (error) {
      return json(
        {
          error: "platform_hosting_unconfigured",
          message:
            error instanceof Error
              ? error.message
              : "Platform hosting not configured",
        },
        503,
      );
    }

    let files: PlatformFile[] = [];
    let editableConfig: ReturnType<typeof normalizeVirtualSiteConfig> | null =
      null;
    if (Array.isArray(body.files) && body.files.length > 0) {
      files = body.files;
    } else if (body.virtualSiteConfig) {
      editableConfig = normalizeVirtualSiteConfig(body.virtualSiteConfig);
      const html = renderVirtualSiteToHtml(editableConfig);
      files = [
        {
          path: "index.html",
          contentBase64: Buffer.from(html, "utf-8").toString("base64"),
        },
      ];
    } else {
      return json(
        { error: "Provide either `files` or `virtualSiteConfig`." },
        400,
      );
    }

    if (body.siteId) {
      const { data: site } = await auth.supabase
        .from("deployed_sites")
        .select("*")
        .eq("id", body.siteId)
        .eq("user_id", auth.user.id)
        .single();
      if (!site) return json({ error: "Site not found" }, 404);

      const slug: string = site.platform_subdomain
        ? String(site.platform_subdomain).split(".")[0]!
        : slugifyHost(site.slug || site.name);

      try {
        const result = await deployPlatformFiles(target, slug, files);
        const updatedAt = new Date().toISOString();
        await updateSiteResilient(auth.supabase, body.siteId, {
          hosting_mode: "platform",
          host_provider: PLATFORM_HOST_PROVIDER,
          platform_subdomain: result.subdomain,
          platform_root: result.root,
          site_url: result.url,
          status: "live",
          platform_deploy_error: null,
          ...(editableConfig ? { virtual_site_config: editableConfig } : {}),
          updated_at: updatedAt,
        });
        return json({
          siteId: body.siteId,
          status: "live",
          hostingMode: "platform",
          subdomain: result.subdomain,
          url: result.url,
          fileCount: result.fileCount,
          version: updatedAt,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Platform deploy failed";
        await updateSiteResilient(auth.supabase, body.siteId, {
          platform_deploy_error: message.slice(0, 1000),
          updated_at: new Date().toISOString(),
        });
        return json({ error: message, siteId: body.siteId }, 500);
      }
    }

    const requestedName = (body.siteName || "").trim();
    const nameForSlug =
      requestedName ||
      (body.virtualSiteConfig &&
      typeof (body.virtualSiteConfig as { siteName?: unknown }).siteName ===
        "string"
        ? String((body.virtualSiteConfig as { siteName?: unknown }).siteName)
        : "site");

    const isTaken = async (slug: string): Promise<boolean> => {
      const { data } = await auth.supabase
        .from("deployed_sites")
        .select("id")
        .eq("platform_subdomain", `${slug}.oceanleo.app`)
        .neq("status", "deleted")
        .maybeSingle();
      const { data: own } = await auth.supabase
        .from("deployed_sites")
        .select("id")
        .eq("user_id", auth.user.id)
        .eq("slug", slug)
        .neq("status", "deleted")
        .maybeSingle();
      return Boolean(data || own);
    };

    const slug = await allocatePlatformSlug(nameForSlug, isTaken);
    const { data: inserted, error: insertErr } = await auth.supabase
      .from("deployed_sites")
      .insert({
        user_id: auth.user.id,
        name: requestedName || nameForSlug,
        slug,
        template_id: null,
        deploy_mode: "platform_static",
        status: "deploying",
        source: "platform",
        hosting_mode: "platform",
        host_provider: PLATFORM_HOST_PROVIDER,
        platform_subdomain: `${slug}.oceanleo.app`,
        virtual_site_config: editableConfig,
        capabilities: {
          vibe_code: true,
          env_edit: false,
          toggle_dns: false,
          domain: true,
        },
        dns_provider: "cloudflare",
        deploy_log: [
          {
            name: "platform_host_create",
            status: "running",
            startedAt: new Date().toISOString(),
            output: { subdomain: `${slug}.oceanleo.app` },
          },
        ],
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      return json(
        {
          error: `Failed to create site record: ${insertErr?.message || "unknown"}`,
        },
        500,
      );
    }
    const siteId = inserted.id as string;

    try {
      const result = await deployPlatformFiles(target, slug, files);
      const updatedAt = new Date().toISOString();
      await updateSiteResilient(auth.supabase, siteId, {
        status: "live",
        platform_root: result.root,
        site_url: result.url,
        platform_deploy_error: null,
        deploy_log: [
          {
            name: "platform_host_create",
            status: "success",
            completedAt: new Date().toISOString(),
            output: { subdomain: result.subdomain, files: result.fileCount },
          },
        ],
        updated_at: updatedAt,
      });
      return json({
        siteId,
        status: "live",
        hostingMode: "platform",
        subdomain: result.subdomain,
        url: result.url,
        fileCount: result.fileCount,
        version: updatedAt,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Platform deploy failed";
      await updateSiteResilient(auth.supabase, siteId, {
        status: "error",
        platform_deploy_error: message.slice(0, 1000),
        deploy_log: [
          {
            name: "platform_host_create",
            status: "error",
            error: message.slice(0, 500),
          },
        ],
        updated_at: new Date().toISOString(),
      });
      return json({ error: message, siteId }, 500);
    }
  },
});

const VERCEL_API = "https://api.vercel.com";

const PROTECTED_DOMAINS = new Set([
  "website.oceanleo.com",
  "api.website.oceanleo.com",
  "vercel.com",
  "github.com",
  "supabase.co",
  "cloudflare.com",
]);

function isDomainProtected(domain: string): boolean {
  const lower = domain.toLowerCase();
  if (PROTECTED_DOMAINS.has(lower)) return true;
  for (const protectedDomain of PROTECTED_DOMAINS) {
    if (lower.endsWith(`.${protectedDomain}`)) return true;
  }
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (siteUrl) {
    try {
      const platformHost = new URL(siteUrl).hostname.toLowerCase();
      const apex = platformHost.replace(/^www\./, "");
      if (
        lower === apex ||
        lower === `www.${apex}` ||
        lower.endsWith(`.${apex}`)
      ) {
        return true;
      }
    } catch {
      // Ignore invalid optional site URL override.
    }
  }
  try {
    const originHost = new URL(publicSiteOrigin("https://website.oceanleo.com"))
      .hostname.toLowerCase();
    const apex = originHost.replace(/^www\./, "");
    if (
      lower === apex ||
      lower === `www.${apex}` ||
      lower.endsWith(`.${apex}`)
    ) {
      return true;
    }
  } catch {
    // Ignore.
  }
  return false;
}

async function cloudflareVaultToken(
  supabase: Extract<
    Awaited<ReturnType<typeof authenticated>>,
    { ok: true }
  >["supabase"],
  userId: string,
): Promise<string> {
  const { data } = await supabase
    .from("vault_entries")
    .select("encrypted_token, iv, auth_tag")
    .eq("user_id", userId)
    .eq("platform", "cloudflare")
    .single();
  if (!data) throw new Error("Connect cloudflare first");
  const raw = decryptVaultValue(
    data.encrypted_token,
    data.iv,
    data.auth_tag,
  );
  return stringValue(parseRecord(raw)?.api_token) ||
    stringValue(parseRecord(raw)?.access_token) ||
    raw;
}

const siteDomainHandler = responseHandler({
  GET: async (request, params) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    const { data: site } = await auth.supabase
      .from("deployed_sites")
      .select("custom_domain, custom_domain_status, vercel_project_id")
      .eq("id", parameter(params, "id"))
      .eq("user_id", auth.user.id)
      .single();
    if (!site) return json({ error: "Site not found" }, 404);
    if (!site.custom_domain) {
      return json({ domain: null, status: "none" });
    }

    let vercelStatus: unknown = null;
    try {
      const { token, teamId } = await vercelCredentials(
        auth.supabase,
        auth.user.id,
      );
      const qs = teamId ? `?teamId=${teamId}` : "";
      const response = await fetchWithTimeout(
        `${VERCEL_API}/v6/domains/${site.custom_domain}/config${qs}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (response.ok) vercelStatus = await response.json();
    } catch {
      /* non-critical */
    }

    return json({
      domain: site.custom_domain,
      status: site.custom_domain_status,
      vercel: vercelStatus,
    });
  },
  POST: async (request, params) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    const id = parameter(params, "id");
    let body: { domain?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const domain = body.domain?.trim().toLowerCase();
    if (!domain) return json({ error: "domain is required" }, 400);
    if (isDomainProtected(domain)) {
      return json(
        {
          error: "domain_protected",
          message: `"${domain}" is a platform-reserved domain and cannot be bound to user sites.`,
        },
        403,
      );
    }

    const { data: site } = await auth.supabase
      .from("deployed_sites")
      .select("vercel_project_id")
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .single();
    if (!site) return json({ error: "Site not found" }, 404);

    try {
      const { token: vercelToken, teamId } = await vercelCredentials(
        auth.supabase,
        auth.user.id,
      );
      const qs = teamId ? `?teamId=${teamId}` : "";
      const vercelRes = await fetchWithTimeout(
        `${VERCEL_API}/v10/projects/${site.vercel_project_id}/domains${qs}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${vercelToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: domain }),
        },
      );
      if (!vercelRes.ok) {
        const errText = await vercelRes.text();
        if (vercelRes.status === 409) {
          const errBody = parseRecord(errText);
          const errorDetails = record(errBody?.error);
          const domainDetails = record(errorDetails?.domain);
          const conflictProjectId =
            stringValue(errorDetails?.projectId) ||
            stringValue(domainDetails?.projectId);
          if (conflictProjectId !== site.vercel_project_id) {
            return json(
              {
                error: "domain_conflict",
                message:
                  "This domain is bound to a different Vercel project. Remove it there first.",
              },
              409,
            );
          }
        } else {
          throw new Error(
            `Vercel add domain failed (${vercelRes.status}): ${errText.slice(0, 300)}`,
          );
        }
      }

      let cfToken: string;
      try {
        cfToken = await cloudflareVaultToken(auth.supabase, auth.user.id);
      } catch {
        return json(
          {
            error: "cloudflare_not_connected",
            message: "Connect Cloudflare first in Vault settings.",
          },
          400,
        );
      }

      let zone;
      try {
        zone = await getZoneForDomain(cfToken, domain);
      } catch (zoneError) {
        const message =
          zoneError instanceof Error ? zoneError.message : "";
        if (message.includes("No Cloudflare zone found")) {
          const apexDomain = domain.split(".").slice(-2).join(".");
          return json(
            {
              error: "domain_not_owned",
              domain: apexDomain,
              siteId: id,
              message: `Domain "${apexDomain}" is not in your Cloudflare account. Purchase or add it first.`,
            },
            400,
          );
        }
        throw zoneError;
      }

      await upsertVercelDnsRecord(cfToken, zone.id, domain, zone.name);
      await auth.supabase
        .from("deployed_sites")
        .update({
          custom_domain: domain,
          custom_domain_status: "verifying",
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      return json({
        status: "ok",
        domain,
        message: "Domain bound. DNS propagation may take a few minutes.",
      });
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Domain binding failed",
        },
        500,
      );
    }
  },
  DELETE: async (request, params) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    const id = parameter(params, "id");
    const { data: site } = await auth.supabase
      .from("deployed_sites")
      .select("custom_domain, vercel_project_id")
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .single();
    if (!site || !site.custom_domain) {
      return json({ error: "No domain bound" }, 404);
    }

    try {
      const { token: vercelToken, teamId } = await vercelCredentials(
        auth.supabase,
        auth.user.id,
      );
      const qs = teamId ? `?teamId=${teamId}` : "";
      await fetchWithTimeout(
        `${VERCEL_API}/v10/projects/${site.vercel_project_id}/domains/${site.custom_domain}${qs}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${vercelToken}` },
        },
      );
    } catch {
      /* best effort */
    }

    try {
      const cfToken = await cloudflareVaultToken(
        auth.supabase,
        auth.user.id,
      );
      const zone = await getZoneForDomain(cfToken, site.custom_domain);
      const records = await listDnsRecords(
        cfToken,
        zone.id,
        site.custom_domain,
      );
      for (const dns of records) {
        if (dns.type === "A" || dns.type === "CNAME") {
          await deleteDnsRecord(cfToken, zone.id, dns.id);
        }
      }
    } catch {
      /* best effort */
    }

    await auth.supabase
      .from("deployed_sites")
      .update({
        custom_domain: null,
        custom_domain_status: "none",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    return json({ status: "ok" });
  },
});

export const SITE_WEBSITE_HANDLERS: Readonly<
  Record<string, PluginRouteHandler>
> = Object.freeze({
  "/api/sites": sitesHandler,
  "/api/sites/[id]/domain": siteDomainHandler,
  "/api/sites/[id]/env": siteEnvHandler,
  "/api/sites/[id]/virtual-config": virtualConfigHandler,
  "/api/sites/platform-deploy": platformDeployHandler,
  "/api/user-templates/[id]/snapshot": userTemplateSnapshotHandler,
});
