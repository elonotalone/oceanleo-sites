import type { PluginRouteHandler } from "@oceanleo/plugin-runtime";

import {
  createRepo,
  getAuthenticatedUser,
  parseRepoIdentifier,
  pushFilesViaTree,
  syncOverridesToRepo,
} from "./github-helpers";
import {
  allocatePlatformSlug,
  deployPlatformFiles,
  PLATFORM_HOST_PROVIDER,
  readPlatformSiteTree,
  resolvePlatformTarget,
  slugifyHost,
  teardownPlatformSite,
  testUserSshConnection,
  type PlatformFile,
  type SSHCredentials,
} from "./platform-host";
import {
  authenticated,
  decryptVaultValue,
  encryptVaultValue,
  fetchWithTimeout,
  json,
  parameter,
  parseRecord,
  publicSiteOrigin,
  responseHandler,
  stringValue,
  type WebsiteSupabaseClient,
} from "./runtime";
import { mergeOverrides, resolveSlots } from "./template-slots";
import { createProject, triggerFirstDeployment } from "./vercel-api";

const VERCEL_API = "https://api.vercel.com";

type AuthOk = Extract<Awaited<ReturnType<typeof authenticated>>, { ok: true }>;

async function githubAccessToken(
  supabase: AuthOk["supabase"],
  userId: string,
): Promise<string> {
  const { data } = await supabase
    .from("vault_entries")
    .select("encrypted_token, iv, auth_tag")
    .eq("user_id", userId)
    .eq("platform", "github")
    .single();
  if (!data) throw new Error("Connect GitHub first in Vault.");
  const raw = decryptVaultValue(data.encrypted_token, data.iv, data.auth_tag);
  return stringValue(parseRecord(raw)?.access_token) || raw;
}

async function githubAccessTokenOrNull(
  supabase: AuthOk["supabase"],
  userId: string,
): Promise<string | null> {
  try {
    return await githubAccessToken(supabase, userId);
  } catch {
    return null;
  }
}

async function vercelCredentialsOrNull(
  supabase: AuthOk["supabase"],
  userId: string,
): Promise<{ token: string; teamId: string | null } | null> {
  const { data } = await supabase
    .from("vault_entries")
    .select("encrypted_token, iv, auth_tag")
    .eq("user_id", userId)
    .eq("platform", "vercel")
    .single();
  if (!data) return null;
  const raw = decryptVaultValue(data.encrypted_token, data.iv, data.auth_tag);
  const parsed = parseRecord(raw);
  return {
    token: stringValue(parsed?.access_token) || raw,
    teamId: stringValue(parsed?.team_id) || null,
  };
}

async function updateSiteResilient(
  supabase: WebsiteSupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("deployed_sites").update(patch).eq("id", id);
  if (!error) return;
  const fallback = { ...patch };
  for (const key of Object.keys(fallback)) {
    if (
      (key.startsWith("platform_") || key === "hosting_mode") &&
      new RegExp(key).test(error.message || "")
    ) {
      delete fallback[key];
    }
  }
  await supabase.from("deployed_sites").update(fallback).eq("id", id);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

async function uniqueSlug(
  supabase: WebsiteSupabaseClient,
  userId: string,
  base: string,
): Promise<string> {
  const root = base || "imported-site";
  let candidate = root;
  for (let i = 0; i < 20; i++) {
    const { data } = await supabase
      .from("deployed_sites")
      .select("id, status")
      .eq("user_id", userId)
      .eq("slug", candidate)
      .maybeSingle();
    if (!data || data.status === "deleted") return candidate;
    candidate = `${root}-${i + 2}`;
  }
  return `${root}-${Date.now().toString(36)}`;
}

function defaultImportedCapabilities(): Record<string, boolean> {
  return {
    vibe_code: false,
    env_edit: true,
    toggle_dns: true,
    domain: true,
  };
}

async function insertWithSchemaRefresh<R extends { data: unknown; error: unknown }>(
  request: Request,
  doInsert: () => PromiseLike<R>,
): Promise<R> {
  const first = await doInsert();
  const err = first.error as { message?: string } | null;
  if (!err) return first;

  const msg = err.message || "";
  const schemaMiss = /schema cache|does not exist|could not find/i.test(msg);
  const benign = /unique|duplicate|already exists/i.test(msg);
  if (!schemaMiss || benign) return first;

  const origin =
    request.headers.get("origin") || publicSiteOrigin(new URL(request.url).origin);
  if (!origin) return first;

  const initRes = await fetch(`${origin}/api/setup/init-db`, {
    method: "POST",
    headers: { Authorization: request.headers.get("Authorization") || "" },
  });
  if (!initRes.ok) return first;

  await new Promise((resolve) => setTimeout(resolve, 3000));
  return doInsert();
}

const overridesSyncHandler = responseHandler({
  POST: async (request, params) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    const id = parameter(params, "id");

    let body: { userTemplateId?: unknown; overrides?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const { data: site, error: siteErr } = await auth.supabase
      .from("deployed_sites")
      .select(
        "id, user_id, github_repo, github_repo_url, applied_overrides, user_template_id, status",
      )
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .single();
    if (siteErr || !site) return json({ error: "Site not found" }, 404);
    if (!site.github_repo && !site.github_repo_url) {
      return json(
        { error: "This site has no GitHub repo yet. Finish deployment first." },
        409,
      );
    }

    const repoIdent =
      (site.github_repo && parseRepoIdentifier(String(site.github_repo))) ||
      (site.github_repo_url && parseRepoIdentifier(String(site.github_repo_url)));
    if (!repoIdent) {
      return json(
        { error: "Could not parse site's GitHub repo identifier." },
        500,
      );
    }

    const newOverrides: Record<string, string> = {};
    let baseSlug: string | null = null;
    let userTemplateId: string | null = null;
    if (
      body.overrides &&
      typeof body.overrides === "object" &&
      !Array.isArray(body.overrides)
    ) {
      for (const [key, value] of Object.entries(
        body.overrides as Record<string, unknown>,
      )) {
        if (typeof value === "string") newOverrides[key] = value;
      }
    }
    if (typeof body.userTemplateId === "string" && body.userTemplateId) {
      userTemplateId = body.userTemplateId;
      const { data: ut, error: utErr } = await auth.supabase
        .from("user_templates")
        .select("id, user_id, base_template_slug, overrides")
        .eq("id", userTemplateId)
        .eq("user_id", auth.user.id)
        .single();
      if (utErr || !ut) {
        return json(
          { error: "user_template not found or not owned by you." },
          404,
        );
      }
      baseSlug = ut.base_template_slug as string;
      if (Object.keys(newOverrides).length === 0) {
        const raw = ut.overrides;
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
            if (typeof value === "string") newOverrides[key] = value;
          }
        }
      }
    }
    if (!baseSlug) baseSlug = "default";

    const slots = resolveSlots(baseSlug, null);
    const newEffective = mergeOverrides(slots, newOverrides);
    const prevApplied =
      site.applied_overrides &&
      typeof site.applied_overrides === "object" &&
      !Array.isArray(site.applied_overrides)
        ? (site.applied_overrides as Record<string, string>)
        : mergeOverrides(slots, {});

    const transitions: Array<{ id: string; from: string; to: string }> = [];
    for (const slot of slots) {
      const from = prevApplied[slot.id];
      const to = newEffective[slot.id];
      if (typeof from === "string" && typeof to === "string" && from !== to) {
        transitions.push({ id: slot.id, from, to });
      }
    }

    let token: string;
    try {
      token = await githubAccessToken(auth.supabase, auth.user.id);
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error ? error.message : "GitHub token unavailable",
        },
        400,
      );
    }

    let result;
    try {
      result = await syncOverridesToRepo(
        token,
        repoIdent.owner,
        repoIdent.repo,
        transitions,
        newEffective,
      );
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : "Sync failed" },
        500,
      );
    }

    const { error: updateErr } = await auth.supabase
      .from("deployed_sites")
      .update({
        applied_overrides: newEffective,
        user_template_id: userTemplateId || site.user_template_id || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (updateErr) {
      console.warn("[sync] Could not persist applied_overrides:", updateErr.message);
    }

    return json({
      status: "ok",
      filesTextReplaced: result.filesTextReplaced,
      overridesFile: result.overridesFile,
      readerInjected: result.readerInjected,
      transitions: transitions.length,
      willRedeploy: true,
    });
  },
});

const transferOutHandler = responseHandler({
  POST: async (request, params) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    const id = parameter(params, "id");

    let body: { repoName?: string; private?: boolean; releaseHosting?: boolean };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      body = {};
    }

    const { data: site } = await auth.supabase
      .from("deployed_sites")
      .select("*")
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .single();
    if (!site) return json({ error: "Site not found" }, 404);

    if (site.hosting_mode !== "platform") {
      return json(
        {
          error:
            "Only platform-hosted sites (on oceanleo.app) can be transferred out. This site is hosted elsewhere.",
        },
        409,
      );
    }

    const githubToken = await githubAccessTokenOrNull(auth.supabase, auth.user.id);
    if (!githubToken) {
      return json(
        {
          error: "github_not_connected",
          message: "Connect GitHub in your Key Vault first, then transfer out.",
          missingPlatform: "github",
        },
        400,
      );
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

    const slug: string = site.platform_subdomain
      ? String(site.platform_subdomain).split(".")[0]!
      : slugifyHost(site.slug || site.name);

    try {
      const files = await readPlatformSiteTree(target, slug);
      if (files.length === 0) {
        return json(
          { error: "No files found for this site on the platform host." },
          404,
        );
      }

      const ghUser = await getAuthenticatedUser(githubToken);
      const repoName =
        slugifyHost(body.repoName || slug) || `site-${Date.now().toString(36)}`;
      const isPrivate = body.private !== false;
      const created = await createRepo(
        githubToken,
        repoName,
        isPrivate,
        `Transferred from ${site.platform_subdomain || "oceanleo.app"} by OceanLeo`,
      );

      const [owner, repo] = created.repoFullName.split("/");
      await pushFilesViaTree(
        githubToken,
        owner!,
        repo!,
        files,
        "Initial import from OceanLeo platform hosting",
        "main",
      );

      const patch: Record<string, unknown> = {
        github_repo: created.repoFullName,
        github_repo_url: created.htmlUrl,
        updated_at: new Date().toISOString(),
      };

      let releasedHosting = false;
      if (body.releaseHosting) {
        try {
          await teardownPlatformSite(target, slug);
          releasedHosting = true;
          patch.hosting_mode = "external";
          patch.status = "paused";
          patch.paused_at = new Date().toISOString();
          patch.platform_root = null;
          patch.site_url = created.htmlUrl;
        } catch (teardownErr) {
          console.warn("[transfer-out] teardown failed:", teardownErr);
        }
      }

      await updateSiteResilient(auth.supabase, id, patch);

      return json({
        status: "ok",
        githubRepo: created.repoFullName,
        githubRepoUrl: created.htmlUrl,
        owner: ghUser.login,
        fileCount: files.length,
        releasedHosting,
      });
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error ? error.message : "Transfer out failed",
        },
        500,
      );
    }
  },
});

interface VercelAlias {
  domain?: string;
}

interface VercelProjectSummary {
  id: string;
  name: string;
  alias?: VercelAlias[];
  targets?: { production?: { alias?: string[] } };
  link?: { type?: string; org?: string; repo?: string } | null;
}

async function handleUploadFiles(
  request: Request,
  supabase: WebsiteSupabaseClient,
  userId: string,
  body: { files?: PlatformFile[]; siteName?: string },
): Promise<Response> {
  const files = Array.isArray(body.files) ? body.files : [];
  if (files.length === 0) {
    return json(
      {
        error:
          "No files provided. Upload a built static site (must include index.html).",
      },
      400,
    );
  }
  const hasIndex = files.some((file) => /(^|\/)index\.html$/i.test(file.path || ""));
  if (!hasIndex) {
    return json(
      {
        error:
          "The upload must contain an index.html at the site root or a single top-level folder.",
      },
      400,
    );
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

  const requestedName = (body.siteName || "").trim();
  const nameForSlug = requestedName || "imported-site";
  const isTaken = async (slug: string): Promise<boolean> => {
    const { data } = await supabase
      .from("deployed_sites")
      .select("id")
      .eq("platform_subdomain", `${slug}.oceanleo.app`)
      .neq("status", "deleted")
      .maybeSingle();
    const { data: own } = await supabase
      .from("deployed_sites")
      .select("id")
      .eq("user_id", userId)
      .eq("slug", slug)
      .neq("status", "deleted")
      .maybeSingle();
    return Boolean(data || own);
  };
  const slug = await allocatePlatformSlug(nameForSlug, isTaken);

  const { data: inserted, error: insertErr } = await insertWithSchemaRefresh(
    request,
    () =>
      supabase
        .from("deployed_sites")
        .insert({
          user_id: userId,
          name: requestedName || slug,
          slug,
          template_id: null,
          deploy_mode: "platform_static",
          status: "deploying",
          source: "imported_upload",
          hosting_mode: "platform",
          host_provider: PLATFORM_HOST_PROVIDER,
          platform_subdomain: `${slug}.oceanleo.app`,
          capabilities: {
            vibe_code: true,
            env_edit: false,
            toggle_dns: false,
            domain: true,
          },
          dns_provider: "cloudflare",
          deploy_log: [
            {
              name: "import_upload_files",
              status: "running",
              startedAt: new Date().toISOString(),
              output: { subdomain: `${slug}.oceanleo.app`, files: files.length },
            },
          ],
        })
        .select("id")
        .single(),
  );

  if (insertErr || !inserted) {
    return json(
      {
        error: `Failed to create site record: ${(insertErr as { message?: string } | null)?.message || "unknown"}`,
      },
      500,
    );
  }
  const siteId = (inserted as { id: string }).id;

  try {
    const result = await deployPlatformFiles(target, slug, files);
    await supabase
      .from("deployed_sites")
      .update({
        status: "live",
        platform_root: result.root,
        site_url: result.url,
        deploy_log: [
          {
            name: "import_upload_files",
            status: "success",
            completedAt: new Date().toISOString(),
            output: { subdomain: result.subdomain, files: result.fileCount },
          },
        ],
        updated_at: new Date().toISOString(),
      })
      .eq("id", siteId);
    return json({
      siteId,
      status: "live",
      source: "imported_upload",
      hostingMode: "platform",
      subdomain: result.subdomain,
      siteUrl: result.url,
      fileCount: result.fileCount,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Upload deploy failed";
    await supabase
      .from("deployed_sites")
      .update({
        status: "error",
        platform_deploy_error: msg.slice(0, 1000),
        deploy_log: [
          { name: "import_upload_files", status: "error", error: msg.slice(0, 500) },
        ],
        updated_at: new Date().toISOString(),
      })
      .eq("id", siteId);
    return json({ error: msg, siteId }, 500);
  }
}

async function handleRemoteServer(
  supabase: WebsiteSupabaseClient,
  userId: string,
  body: {
    server?: {
      host?: string;
      port?: number;
      username?: string;
      authType?: "key" | "password";
      privateKey?: string;
      password?: string;
      label?: string;
    };
    siteName?: string;
    siteUrl?: string;
  },
): Promise<Response> {
  const serverBody = body.server || {};
  const host = (serverBody.host || "").trim();
  const username = (serverBody.username || "root").trim();
  const port = Number.isFinite(serverBody.port) ? Number(serverBody.port) : 22;
  const authType: "key" | "password" =
    serverBody.authType === "password" ? "password" : "key";
  if (!host) return json({ error: "server.host is required" }, 400);
  if (authType === "key" && !serverBody.privateKey) {
    return json({ error: "server.privateKey is required for key auth" }, 400);
  }
  if (authType === "password" && !serverBody.password) {
    return json({ error: "server.password is required for password auth" }, 400);
  }

  const creds: SSHCredentials = {
    host,
    port,
    username,
    authType,
    privateKey: serverBody.privateKey,
    password: serverBody.password,
  };

  const probe = await testUserSshConnection(creds);
  if (!probe.ok) {
    return json(
      {
        error: `Could not connect to ${host}:${port} — ${probe.error || "unknown error"}`,
      },
      400,
    );
  }

  const enc = encryptVaultValue(
    JSON.stringify({
      authType,
      privateKey: serverBody.privateKey || null,
      password: serverBody.password || null,
    }),
  );
  const { data: server, error: serverErr } = await supabase
    .from("server_connections")
    .insert({
      user_id: userId,
      label: (serverBody.label || host).slice(0, 80),
      host,
      port,
      username,
      auth_type: authType,
      encrypted_credentials: enc.ciphertext,
      iv: enc.iv,
      auth_tag: enc.tag,
      status: "active",
      last_connected_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (serverErr || !server) {
    return json(
      {
        error: `Failed to store server connection: ${serverErr?.message || "unknown"}`,
      },
      500,
    );
  }

  const requestedName = (body.siteName || host).trim();
  const slug = await uniqueSlug(supabase, userId, slugify(requestedName));

  const { data: inserted, error: insertErr } = await insertWithSchemaRefresh(
    new Request("http://localhost/api/setup/init-db"),
    () =>
      supabase
        .from("deployed_sites")
        .insert({
          user_id: userId,
          name: requestedName,
          slug,
          template_id: null,
          deploy_mode: "remote_server",
          status: "live",
          source: "imported_remote",
          hosting_mode: "remote_server",
          host_provider: host,
          server_connection_id: server.id,
          site_url: (body.siteUrl || "").trim() || null,
          capabilities: {
            vibe_code: true,
            env_edit: false,
            toggle_dns: false,
            domain: true,
          },
          dns_provider: "external",
          deploy_log: [
            {
              name: "import_remote_server",
              status: "success",
              completedAt: new Date().toISOString(),
              output: {
                host,
                port,
                username,
                os: probe.osInfo?.split("\n")[0] || "",
              },
            },
          ],
        })
        .select("id")
        .single(),
  );

  if (insertErr || !inserted) {
    return json(
      {
        error: `Failed to create site record: ${(insertErr as { message?: string } | null)?.message || "unknown"}`,
      },
      500,
    );
  }

  await supabase
    .from("server_connections")
    .update({ site_id: (inserted as { id: string }).id })
    .eq("id", server.id);

  return json({
    siteId: (inserted as { id: string }).id,
    status: "live",
    source: "imported_remote",
    hostingMode: "remote_server",
    serverId: server.id,
    osInfo: probe.osInfo || null,
  });
}

const sitesImportHandler = responseHandler({
  POST: async (request) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;

    let body: {
      mode?: "vercel_project" | "github_repo" | "upload_files" | "remote_server";
      vercelProjectId?: string;
      githubRepo?: string;
      siteName?: string;
      ref?: string;
      files?: PlatformFile[];
      server?: {
        host?: string;
        port?: number;
        username?: string;
        authType?: "key" | "password";
        privateKey?: string;
        password?: string;
        label?: string;
      };
      siteUrl?: string;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const mode = body.mode;
    if (
      mode !== "vercel_project" &&
      mode !== "github_repo" &&
      mode !== "upload_files" &&
      mode !== "remote_server"
    ) {
      return json(
        {
          error:
            "mode must be 'vercel_project', 'github_repo', 'upload_files', or 'remote_server'",
        },
        400,
      );
    }

    if (mode === "upload_files") {
      return handleUploadFiles(request, auth.supabase, auth.user.id, body);
    }
    if (mode === "remote_server") {
      return handleRemoteServer(auth.supabase, auth.user.id, body);
    }

    const vercelCreds = await vercelCredentialsOrNull(auth.supabase, auth.user.id);
    if (!vercelCreds) {
      return json(
        {
          error: "vercel_not_connected",
          message: "Connect Vercel first to import projects.",
          missingPlatform: "vercel",
        },
        400,
      );
    }
    const { token: vercelToken, teamId: vercelTeamId } = vercelCreds;

    if (mode === "vercel_project") {
      const projectId = (body.vercelProjectId || "").trim();
      if (!projectId) {
        return json({ error: "vercelProjectId is required" }, 400);
      }

      const { data: existing } = await auth.supabase
        .from("deployed_sites")
        .select("id, status")
        .eq("user_id", auth.user.id)
        .eq("vercel_project_id", projectId)
        .neq("status", "deleted")
        .maybeSingle();
      if (existing) {
        return json(
          {
            error: "already_imported",
            message:
              "This Vercel project is already linked to one of your Mycreator sites.",
            siteId: existing.id,
          },
          409,
        );
      }

      const qs = vercelTeamId ? `?teamId=${vercelTeamId}` : "";
      const res = await fetchWithTimeout(
        `${VERCEL_API}/v9/projects/${projectId}${qs}`,
        { headers: { Authorization: `Bearer ${vercelToken}` } },
      );
      if (!res.ok) {
        const errText = await res.text();
        return json(
          {
            error: "vercel_project_fetch_failed",
            message: `Vercel API returned ${res.status}: ${errText.slice(0, 200)}`,
          },
          res.status === 404 ? 404 : 500,
        );
      }
      const project = (await res.json()) as VercelProjectSummary;

      const productionAlias =
        (project.alias || []).find((alias) => alias?.domain)?.domain ||
        project.targets?.production?.alias?.[0] ||
        null;
      const siteUrl = productionAlias ? `https://${productionAlias}` : null;
      const dashSlug = vercelTeamId || "~";
      const dashboardUrl = `https://vercel.com/${dashSlug}/${project.name}`;
      const link = project.link || null;
      const githubRepo =
        link && link.type === "github" ? `${link.org}/${link.repo}` : null;
      const githubRepoUrl = githubRepo ? `https://github.com/${githubRepo}` : null;

      const requestedName = (body.siteName || "").trim();
      const slug = await uniqueSlug(
        auth.supabase,
        auth.user.id,
        requestedName ? slugify(requestedName) : slugify(project.name),
      );

      const { data: inserted, error: insertErr } = await insertWithSchemaRefresh(
        request,
        () =>
          auth.supabase
            .from("deployed_sites")
            .insert({
              user_id: auth.user.id,
              name: requestedName || project.name,
              slug,
              template_id: null,
              deploy_mode: "vercel_only",
              status: "live",
              source: "imported_vercel",
              capabilities: defaultImportedCapabilities(),
              dns_provider: "cloudflare",
              vercel_project_id: project.id,
              vercel_project_url: dashboardUrl,
              github_repo: githubRepo,
              github_repo_url: githubRepoUrl,
              site_url: siteUrl,
              deploy_log: [
                {
                  name: "import_vercel_project",
                  status: "success",
                  completedAt: new Date().toISOString(),
                  output: { projectId: project.id, name: project.name },
                },
              ],
            })
            .select("id")
            .single(),
      );

      if (insertErr || !inserted) {
        return json(
          {
            error: `Failed to import project: ${(insertErr as { message?: string } | null)?.message || "unknown"}`,
          },
          500,
        );
      }

      return json({
        siteId: (inserted as { id: string }).id,
        status: "live",
        source: "imported_vercel",
        siteUrl,
        githubRepo,
      });
    }

    const repoFullName = (body.githubRepo || "").trim();
    if (!repoFullName || !/^[^/]+\/[^/]+$/.test(repoFullName)) {
      return json({ error: "githubRepo must be 'owner/repo'" }, 400);
    }

    const githubToken = await githubAccessTokenOrNull(auth.supabase, auth.user.id);
    if (!githubToken) {
      return json(
        {
          error: "github_not_connected",
          message: "Connect GitHub first to import a repository.",
          missingPlatform: "github",
        },
        400,
      );
    }

    const repoRes = await fetchWithTimeout(
      `https://api.github.com/repos/${repoFullName}`,
      {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github+json",
        },
      },
    );
    if (!repoRes.ok) {
      return json(
        {
          error: "github_repo_unreachable",
          message: `GitHub returned ${repoRes.status} for ${repoFullName}. Re-authorize GitHub with access to this repo.`,
        },
        400,
      );
    }
    const repo = (await repoRes.json()) as Record<string, any>;
    const defaultBranch: string = body.ref || repo.default_branch || "main";

    const qs = new URLSearchParams();
    qs.set("limit", "100");
    if (vercelTeamId) qs.set("teamId", vercelTeamId);
    let existingProject: VercelProjectSummary | null = null;
    for (let page = 0; page < 3 && !existingProject; page++) {
      const listRes = await fetchWithTimeout(
        `${VERCEL_API}/v9/projects?${qs.toString()}`,
        { headers: { Authorization: `Bearer ${vercelToken}` } },
      );
      if (!listRes.ok) break;
      const data = (await listRes.json()) as Record<string, any>;
      for (const project of data.projects || []) {
        const link = project.link;
        if (
          link?.type === "github" &&
          `${link.org}/${link.repo}` === repoFullName
        ) {
          existingProject = project as VercelProjectSummary;
          break;
        }
      }
      if (!data.pagination?.next) break;
      qs.set("until", String(data.pagination.next));
    }

    const requestedName = (body.siteName || "").trim();
    const slug = await uniqueSlug(
      auth.supabase,
      auth.user.id,
      requestedName ? slugify(requestedName) : slugify(String(repo.name)),
    );

    if (existingProject) {
      const { data: dupe } = await auth.supabase
        .from("deployed_sites")
        .select("id")
        .eq("user_id", auth.user.id)
        .eq("vercel_project_id", existingProject.id)
        .neq("status", "deleted")
        .maybeSingle();
      if (dupe) {
        return json(
          {
            error: "already_imported",
            message:
              "This repo's Vercel project is already linked to an Mycreator site.",
            siteId: dupe.id,
          },
          409,
        );
      }

      const productionAlias =
        (existingProject.alias || []).find((alias) => alias?.domain)?.domain ||
        existingProject.targets?.production?.alias?.[0] ||
        null;
      const siteUrl = productionAlias ? `https://${productionAlias}` : null;
      const dashSlug = vercelTeamId || "~";
      const dashboardUrl = `https://vercel.com/${dashSlug}/${existingProject.name}`;

      const { data: inserted, error: insertErr } = await insertWithSchemaRefresh(
        request,
        () =>
          auth.supabase
            .from("deployed_sites")
            .insert({
              user_id: auth.user.id,
              name: requestedName || repo.name,
              slug,
              template_id: null,
              deploy_mode: "vercel_only",
              status: "live",
              source: "imported_github",
              capabilities: defaultImportedCapabilities(),
              dns_provider: "cloudflare",
              vercel_project_id: existingProject.id,
              vercel_project_url: dashboardUrl,
              github_repo: repoFullName,
              github_repo_url: repo.html_url,
              site_url: siteUrl,
              deploy_log: [
                {
                  name: "import_github_repo_existing_vercel",
                  status: "success",
                  completedAt: new Date().toISOString(),
                  output: { repo: repoFullName, projectId: existingProject.id },
                },
              ],
            })
            .select("id")
            .single(),
      );

      if (insertErr || !inserted) {
        return json(
          {
            error: `Failed to import: ${(insertErr as { message?: string } | null)?.message || "unknown"}`,
          },
          500,
        );
      }

      return json({
        siteId: (inserted as { id: string }).id,
        status: "live",
        source: "imported_github",
        reusedVercelProject: true,
        siteUrl,
      });
    }

    const { data: seed, error: seedErr } = await insertWithSchemaRefresh(
      request,
      () =>
        auth.supabase
          .from("deployed_sites")
          .insert({
            user_id: auth.user.id,
            name: requestedName || repo.name,
            slug,
            template_id: null,
            deploy_mode: "vercel_only",
            status: "deploying",
            source: "imported_github",
            capabilities: defaultImportedCapabilities(),
            dns_provider: "cloudflare",
            github_repo: repoFullName,
            github_repo_url: repo.html_url,
            deploy_log: [
              {
                name: "import_github_repo",
                status: "running",
                startedAt: new Date().toISOString(),
                output: { repo: repoFullName },
              },
            ],
          })
          .select("id")
          .single(),
    );
    if (seedErr || !seed) {
      return json(
        {
          error: `Failed to create site record: ${(seedErr as { message?: string } | null)?.message}`,
        },
        500,
      );
    }
    const siteId = (seed as { id: string }).id;

    try {
      const project = await createProject(
        vercelToken,
        slug,
        repoFullName,
        vercelTeamId,
      );
      const effectiveTeamId = project.resolvedTeamId ?? vercelTeamId;
      try {
        await triggerFirstDeployment(
          vercelToken,
          project.projectName,
          project.repoId ?? null,
          defaultBranch,
          effectiveTeamId,
        );
      } catch (triggerErr) {
        console.warn(
          "[import] triggerFirstDeployment failed, will still proceed:",
          triggerErr,
        );
      }

      await auth.supabase
        .from("deployed_sites")
        .update({
          status: "live",
          vercel_project_id: project.projectId,
          vercel_project_url: project.projectUrl,
          deploy_log: [
            {
              name: "import_github_repo",
              status: "success",
              completedAt: new Date().toISOString(),
              output: { repo: repoFullName, projectId: project.projectId },
            },
          ],
          updated_at: new Date().toISOString(),
        })
        .eq("id", siteId);

      return json({
        siteId,
        status: "live",
        source: "imported_github",
        createdVercelProject: true,
        vercelProjectId: project.projectId,
        vercelProjectUrl: project.projectUrl,
      });
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Failed to import GitHub repo";
      await auth.supabase
        .from("deployed_sites")
        .update({
          status: "error",
          deploy_log: [
            {
              name: "import_github_repo",
              status: "error",
              error: msg,
              completedAt: new Date().toISOString(),
            },
          ],
          updated_at: new Date().toISOString(),
        })
        .eq("id", siteId);
      return json({ error: msg, siteId }, 500);
    }
  },
});

export const ORCHESTRATION_WEBSITE_HANDLERS: Readonly<
  Record<string, PluginRouteHandler>
> = Object.freeze({
  "/api/sites/[id]/overrides/sync": overridesSyncHandler,
  "/api/sites/[id]/transfer-out": transferOutHandler,
  "/api/sites/import": sitesImportHandler,
});
