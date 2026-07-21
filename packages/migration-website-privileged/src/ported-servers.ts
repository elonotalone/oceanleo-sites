import type { PluginRouteHandler } from "@oceanleo/plugin-runtime";

import {
  createFirewallRules,
  createInstance,
  listImages,
  listPlans,
  listRegions,
  waitForInstanceRunning,
} from "./aliyun-swas";
import {
  checkUserSshPrerequisites,
  getRootConsoleTaskStatus,
  getUserSshServiceStatus,
  launchRootConsoleTask,
  PLATFORM_SITES_ROOT,
  resolvePlatformTarget,
  restartUserSshService,
  runUserSshCommand,
  slugifyHost,
  testUserSshConnection,
  type RootConsoleTarget,
  type SSHCredentials,
} from "./platform-host";
import {
  authenticated,
  decryptVaultValue,
  encryptVaultValue,
  errorMessage,
  json,
  parameter,
  parseRecord,
  responseHandler,
  stringValue,
  type WebsiteSupabaseClient,
} from "./runtime";

const DEFAULT_VIBE_MODEL = "composer-1.5";
const VIBE_BASE_DIR =
  process.env.ROOT_CONSOLE_BASE_DIR || "/opt/oceanleo-vibe-console";

async function resolveServerCredentials(
  supabase: WebsiteSupabaseClient,
  userId: string,
  serverConnectionId: string,
): Promise<SSHCredentials> {
  const { data: server } = await supabase
    .from("server_connections")
    .select("*")
    .eq("id", serverConnectionId)
    .eq("user_id", userId)
    .single();
  if (!server) throw new Error("Server not found");

  const raw = decryptVaultValue(
    server.encrypted_credentials,
    server.iv,
    server.auth_tag,
  );
  const parsed = parseRecord(raw);
  const authType =
    parsed?.authType === "key" || parsed?.authType === "password"
      ? parsed.authType
      : server.auth_type === "password"
        ? "password"
        : "key";
  return {
    host: server.host,
    port: server.port,
    username: server.username,
    authType,
    privateKey: stringValue(parsed?.privateKey),
    password: stringValue(parsed?.password),
  };
}

async function aliyunVaultKeys(
  supabase: WebsiteSupabaseClient,
  userId: string,
): Promise<{ accessKeyId: string; accessKeySecret: string } | null> {
  const { data: vaultEntry } = await supabase
    .from("vault_entries")
    .select("encrypted_token, iv, auth_tag")
    .eq("user_id", userId)
    .eq("platform", "aliyun")
    .single();
  if (!vaultEntry) return null;
  try {
    const raw = decryptVaultValue(
      vaultEntry.encrypted_token,
      vaultEntry.iv,
      vaultEntry.auth_tag,
    );
    const parsed = parseRecord(raw);
    const accessKeyId = stringValue(parsed?.access_key_id);
    const accessKeySecret = stringValue(parsed?.access_key_secret);
    if (!accessKeyId || !accessKeySecret) return null;
    return { accessKeyId, accessKeySecret };
  } catch {
    return null;
  }
}

const serversHandler = responseHandler({
  GET: async (request) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;

    const { data: servers } = await auth.supabase
      .from("server_connections")
      .select(
        "id, label, host, port, username, auth_type, status, last_connected_at, created_at, site_id",
      )
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false });

    return json({ servers: servers || [] });
  },

  POST: async (request) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;

    let body: {
      label?: string;
      host?: string;
      port?: number;
      username?: string;
      authType?: "key" | "password";
      privateKey?: string;
      password?: string;
      testOnly?: boolean;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const host = body.host?.trim();
    const port = body.port || 22;
    const username = body.username?.trim() || "root";
    const authType = body.authType || "key";
    const label = body.label?.trim() || `${host}:${port}`;
    if (!host) return json({ error: "host is required" }, 400);

    const credential =
      authType === "key" ? body.privateKey?.trim() : body.password?.trim();
    if (!credential) {
      return json(
        {
          error:
            authType === "key"
              ? "privateKey is required"
              : "password is required",
        },
        400,
      );
    }

    const creds: SSHCredentials = {
      host,
      port,
      username,
      authType,
      ...(authType === "key"
        ? { privateKey: credential }
        : { password: credential }),
    };

    const testResult = await testUserSshConnection(creds);
    if (!testResult.ok) {
      return json(
        { error: `SSH connection failed: ${testResult.error}` },
        400,
      );
    }

    if (body.testOnly) {
      const prerequisites = await checkUserSshPrerequisites(creds);
      return json({
        status: "ok",
        osInfo: testResult.osInfo,
        prerequisites,
      });
    }

    const encrypted = encryptVaultValue(
      JSON.stringify({
        authType,
        ...(authType === "key"
          ? { privateKey: credential }
          : { password: credential }),
      }),
    );

    const { data: server, error } = await auth.supabase
      .from("server_connections")
      .insert({
        user_id: auth.user.id,
        label,
        host,
        port,
        username,
        auth_type: authType,
        encrypted_credentials: encrypted.ciphertext,
        iv: encrypted.iv,
        auth_tag: encrypted.tag,
        status: "active",
        last_connected_at: new Date().toISOString(),
      })
      .select("id, label, host, port, username, auth_type, status")
      .single();

    if (error) return json({ error: error.message }, 500);

    const prerequisites = await checkUserSshPrerequisites(creds);
    return json({
      status: "connected",
      server,
      osInfo: testResult.osInfo,
      prerequisites,
    });
  },

  DELETE: async (request) => {
    const serverId = new URL(request.url).searchParams.get("id");
    if (!serverId) return json({ error: "id is required" }, 400);

    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;

    await auth.supabase
      .from("server_connections")
      .delete()
      .eq("id", serverId)
      .eq("user_id", auth.user.id);

    return json({ status: "ok" });
  },
});

const serversTestHandler = responseHandler({
  POST: async (request, params) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    const id = parameter(params, "id");

    const { data: server } = await auth.supabase
      .from("server_connections")
      .select("*")
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .single();
    if (!server) return json({ error: "Server not found" }, 404);

    let creds: SSHCredentials;
    try {
      creds = await resolveServerCredentials(
        auth.supabase,
        auth.user.id,
        id,
      );
    } catch (error) {
      return json({ error: errorMessage(error, "Server not found") }, 404);
    }

    const connTest = await testUserSshConnection(creds);
    if (!connTest.ok) {
      await auth.supabase
        .from("server_connections")
        .update({ status: "unreachable" })
        .eq("id", id);
      return json({ ok: false, error: connTest.error }, 200);
    }

    const prerequisites = await checkUserSshPrerequisites(creds);
    await auth.supabase
      .from("server_connections")
      .update({
        status: "active",
        last_connected_at: new Date().toISOString(),
      })
      .eq("id", id);

    return json({
      ok: true,
      osInfo: connTest.osInfo,
      prerequisites,
    });
  },
});

const serversProvisionHandler = responseHandler({
  GET: async (request) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;

    const keys = await aliyunVaultKeys(auth.supabase, auth.user.id);
    if (!keys) {
      return json(
        { error: "Connect Alibaba Cloud first (AccessKey)" },
        400,
      );
    }

    try {
      const regions = await listRegions(keys.accessKeyId, keys.accessKeySecret);
      const regionId =
        new URL(request.url).searchParams.get("regionId") ||
        "ap-southeast-1";
      const [plans, images] = await Promise.all([
        listPlans(keys.accessKeyId, keys.accessKeySecret, regionId),
        listImages(keys.accessKeyId, keys.accessKeySecret, regionId),
      ]);
      const ubuntuImages = images.filter(
        (image) =>
          image.OsType === "linux" &&
          (image.ImageName?.toLowerCase().includes("ubuntu") ||
            image.Platform?.toLowerCase().includes("ubuntu")),
      );
      return json({ regions, plans, images: ubuntuImages });
    } catch (error) {
      return json(
        { error: errorMessage(error, "Failed to list resources") },
        500,
      );
    }
  },

  POST: async (request) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;

    let body: {
      regionId: string;
      planId: string;
      imageId: string;
      period?: number;
      label?: string;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    if (!body.regionId || !body.planId || !body.imageId) {
      return json(
        { error: "regionId, planId, imageId required" },
        400,
      );
    }

    const keys = await aliyunVaultKeys(auth.supabase, auth.user.id);
    if (!keys) {
      return json({ error: "Connect Alibaba Cloud first" }, 400);
    }

    try {
      const instanceIds = await createInstance(
        keys.accessKeyId,
        keys.accessKeySecret,
        body.regionId,
        body.imageId,
        body.planId,
        body.period || 1,
      );
      const instanceId = instanceIds[0]!;
      const instance = await waitForInstanceRunning(
        keys.accessKeyId,
        keys.accessKeySecret,
        body.regionId,
        instanceId,
        300_000,
      );
      await createFirewallRules(
        keys.accessKeyId,
        keys.accessKeySecret,
        body.regionId,
        instanceId,
        [
          { port: "22/22", protocol: "TCP" },
          { port: "80/80", protocol: "TCP" },
          { port: "443/443", protocol: "TCP" },
          { port: "8001/8099", protocol: "TCP" },
          { port: "9000/9000", protocol: "TCP" },
        ],
      );
      const label = body.label || `SWAS-${instance.PublicIpAddress}`;
      return json({
        status: "created",
        instanceId,
        publicIp: instance.PublicIpAddress,
        label,
        message:
          "Instance created! Set a root password in the Alibaba Cloud console, then add it as a server connection with the IP and password.",
      });
    } catch (error) {
      return json(
        { error: errorMessage(error, "Provisioning failed") },
        500,
      );
    }
  },
});

const backendOpsHandler = responseHandler({
  GET: async (request, params) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    const id = parameter(params, "id");

    const { data: site } = await auth.supabase
      .from("deployed_sites")
      .select("slug, server_connection_id, backend_provider, backend_status")
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .single();
    if (!site) return json({ error: "Site not found" }, 404);
    if (!site.server_connection_id || site.backend_provider !== "ssh") {
      return json(
        { error: "No SSH server linked to this site" },
        400,
      );
    }

    try {
      const creds = await resolveServerCredentials(
        auth.supabase,
        auth.user.id,
        site.server_connection_id,
      );
      const status = await getUserSshServiceStatus(creds, site.slug);
      return json(status);
    } catch (error) {
      return json(
        { error: errorMessage(error, "Failed to query server") },
        500,
      );
    }
  },

  POST: async (request, params) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    const id = parameter(params, "id");

    let body: { action: "restart" | "logs" | "exec"; command?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const { data: site } = await auth.supabase
      .from("deployed_sites")
      .select("slug, server_connection_id, backend_provider")
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .single();
    if (!site) return json({ error: "Site not found" }, 404);
    if (!site.server_connection_id || site.backend_provider !== "ssh") {
      return json({ error: "No SSH server linked" }, 400);
    }

    try {
      const creds = await resolveServerCredentials(
        auth.supabase,
        auth.user.id,
        site.server_connection_id,
      );

      if (body.action === "restart") {
        const result = await restartUserSshService(creds, site.slug);
        return json({
          status: result.code === 0 ? "ok" : "error",
          output: result.stdout || result.stderr,
        });
      }

      if (body.action === "logs") {
        const result = await runUserSshCommand(
          creds,
          `journalctl -u ${site.slug}-backend --no-pager -n 100 2>/dev/null || echo "No logs available"`,
          15_000,
        );
        return json({ logs: result.stdout });
      }

      if (body.action === "exec") {
        if (!body.command?.trim()) {
          return json({ error: "command is required" }, 400);
        }
        if (body.command.length > 2000) {
          return json(
            { error: "Command too long (max 2000 chars)" },
            400,
          );
        }
        const result = await runUserSshCommand(creds, body.command, 60_000);
        return json({
          code: result.code,
          stdout: result.stdout,
          stderr: result.stderr,
        });
      }

      return json({ error: "Unknown action" }, 400);
    } catch (error) {
      return json(
        { error: errorMessage(error, "Operation failed") },
        500,
      );
    }
  },
});

interface DeployedSiteRow {
  hosting_mode?: string | null;
  server_connection_id?: string | null;
  platform_subdomain?: string | null;
  slug?: string | null;
  name: string;
}

async function resolveVibeTarget(
  supabase: WebsiteSupabaseClient,
  userId: string,
  site: DeployedSiteRow,
): Promise<{ target: RootConsoleTarget; workdir: string }> {
  if (site.hosting_mode === "remote_server") {
    if (!site.server_connection_id) {
      throw new Error("This remote site has no linked server connection.");
    }
    const creds = await resolveServerCredentials(
      supabase,
      userId,
      site.server_connection_id,
    );
    const workdir = `/opt/${slugifyHost(site.slug || site.name)}`;
    return { target: creds, workdir };
  }

  const slug = site.platform_subdomain
    ? String(site.platform_subdomain).split(".")[0]
    : slugifyHost(site.slug || site.name);
  return {
    target: resolvePlatformTarget(),
    workdir: `${PLATFORM_SITES_ROOT}/${slug}`,
  };
}

const vibeCodeHostedHandler = responseHandler({
  POST: async (request, params) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    const id = parameter(params, "id");

    let body: { prompt?: unknown; cursorApiKey?: unknown; model?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return json({ error: "prompt is required" }, 400);

    const cursorApiKey =
      typeof body.cursorApiKey === "string" ? body.cursorApiKey.trim() : "";
    if (!cursorApiKey) {
      return json(
        {
          error:
            "cursorApiKey is required. Save your Cursor API key in Vault first.",
        },
        400,
      );
    }
    const model =
      typeof body.model === "string" && body.model.trim()
        ? body.model.trim()
        : DEFAULT_VIBE_MODEL;

    const { data: site } = await auth.supabase
      .from("deployed_sites")
      .select("*")
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .single();
    if (!site) return json({ error: "Site not found" }, 404);

    const mode =
      site.hosting_mode ||
      (site.server_connection_id ? "remote_server" : null);
    if (mode !== "platform" && mode !== "remote_server") {
      return json(
        {
          error:
            "This site isn't server-hosted. Use /vibe-code (Cursor Cloud Agent) for GitHub-backed sites.",
        },
        409,
      );
    }

    try {
      const { target, workdir } = await resolveVibeTarget(
        auth.supabase,
        auth.user.id,
        site,
      );
      const { taskId, status } = await launchRootConsoleTask(target, {
        baseDir: VIBE_BASE_DIR,
        workdir,
        prompt,
        model,
        apiKey: cursorApiKey,
      });
      return json({ taskId, status, workdir });
    } catch (error) {
      return json(
        { error: errorMessage(error, "Failed to launch vibe task") },
        500,
      );
    }
  },

  GET: async (request, params) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    const id = parameter(params, "id");

    const taskId = new URL(request.url).searchParams.get("taskId");
    if (!taskId) return json({ error: "taskId is required" }, 400);

    const { data: site } = await auth.supabase
      .from("deployed_sites")
      .select("*")
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .single();
    if (!site) return json({ error: "Site not found" }, 404);

    try {
      const { target } = await resolveVibeTarget(
        auth.supabase,
        auth.user.id,
        site,
      );
      const status = await getRootConsoleTaskStatus(
        target,
        VIBE_BASE_DIR,
        taskId,
      );
      return json(status);
    } catch (error) {
      return json(
        { error: errorMessage(error, "Failed to fetch task status") },
        500,
      );
    }
  },
});

export const SERVER_WEBSITE_HANDLERS: Readonly<
  Record<string, PluginRouteHandler>
> = Object.freeze({
  "/api/servers": serversHandler,
  "/api/servers/[id]/test": serversTestHandler,
  "/api/servers/provision": serversProvisionHandler,
  "/api/sites/[id]/backend/ops": backendOpsHandler,
  "/api/sites/[id]/vibe-code-hosted": vibeCodeHostedHandler,
});
