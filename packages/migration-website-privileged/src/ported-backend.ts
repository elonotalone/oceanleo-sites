import crypto from "node:crypto";

import type { PluginRouteHandler } from "@oceanleo/plugin-runtime";

import {
  deployBackend as aliyunDeployBackend,
  validateCredentials as validateAliyunCredentials,
} from "./aliyun-swas";
import {
  createDnsRecord,
  deleteDnsRecord,
  getZoneForDomain,
  listDnsRecords,
} from "./cloudflare-zones";
import { updateFileContent } from "./github-helpers";
import {
  deployFromGitHub,
  validateRailwayToken,
} from "./railway-api";
import {
  checkPrerequisites,
  deployBackend as sshDeployBackend,
  findAvailablePort,
  installPrerequisites,
  runCommand,
  setupCaddy,
  setupWebhookReceiver,
  type PrerequisiteCheck,
  type SSHCredentials,
} from "./server-deploy";
import {
  setEnvironmentVariables,
  triggerRedeploy,
} from "./vercel-api";
import {
  authenticated,
  decryptVaultValue,
  errorMessage,
  fetchWithTimeout,
  json,
  parameter,
  parseRecord,
  responseHandler,
  stringValue,
  type WebsiteSupabaseClient,
} from "./runtime";

interface VaultCreds {
  [key: string]: unknown;
  api_token?: string;
  access_key_id?: string;
  access_key_secret?: string;
  access_token?: string;
  team_id?: string | null;
  api_token_alt?: string;
}

async function updateSite(
  supabase: WebsiteSupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from("deployed_sites")
    .update(patch)
    .eq("id", id);
  if (!error) return;
  const fallback = { ...patch };
  for (const col of ["backend_deploy_error", "backend_deploy_log"]) {
    if (new RegExp(col).test(error.message || "")) {
      delete fallback[col];
    }
  }
  await supabase.from("deployed_sites").update(fallback).eq("id", id);
}

async function getVaultCredentials(
  supabase: WebsiteSupabaseClient,
  userId: string,
  platform: string,
): Promise<VaultCreds | null> {
  const { data } = await supabase
    .from("vault_entries")
    .select("encrypted_token, iv, auth_tag")
    .eq("user_id", userId)
    .eq("platform", platform)
    .single();
  if (!data) return null;
  try {
    const raw = decryptVaultValue(
      data.encrypted_token,
      data.iv,
      data.auth_tag,
    );
    const parsed = parseRecord(raw);
    if (parsed) return parsed as VaultCreds;
    return { access_token: raw };
  } catch {
    return null;
  }
}

function resolveSSHCreds(server: Record<string, any>): SSHCredentials {
  const raw = decryptVaultValue(
    server.encrypted_credentials,
    server.iv,
    server.auth_tag,
  );
  const parsed = parseRecord(raw);
  return {
    host: server.host,
    port: server.port,
    username: server.username,
    authType:
      parsed?.authType === "key" || parsed?.authType === "password"
        ? parsed.authType
        : server.auth_type === "password"
          ? "password"
          : "key",
    privateKey: stringValue(parsed?.privateKey),
    password: stringValue(parsed?.password),
  };
}

function runInBackground(work: () => Promise<void>): void {
  void work().catch((err) => {
    console.error("[backend deploy] background work failed:", err);
  });
}

type BackendDeployStage =
  | "connecting_ssh"
  | "checking_prerequisites"
  | "installing_nodejs"
  | "installing_prerequisites"
  | "finding_port"
  | "cloning_repo"
  | "installing_deps"
  | "starting_pm2"
  | "configuring_caddy"
  | "configuring_dns"
  | "issuing_cert"
  | "setting_up_webhook"
  | "configuring_vercel"
  | "writing_cursor_rules"
  | "finalizing";

interface BackendStep {
  stage: BackendDeployStage;
  name: string;
  status: "pending" | "running" | "success" | "error" | "skipped";
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

const BACKEND_STAGES: { stage: BackendDeployStage; name: string }[] = [
  { stage: "connecting_ssh", name: "Connecting over SSH" },
  { stage: "checking_prerequisites", name: "Checking prerequisites" },
  {
    stage: "installing_prerequisites",
    name: "Installing Node.js / PM2 / Caddy",
  },
  { stage: "finding_port", name: "Finding available port" },
  { stage: "cloning_repo", name: "Cloning repository" },
  { stage: "installing_deps", name: "Installing dependencies" },
  { stage: "starting_pm2", name: "Starting backend service" },
  { stage: "configuring_caddy", name: "Configuring reverse proxy (Caddy)" },
  { stage: "configuring_dns", name: "Configuring DNS (Cloudflare)" },
  { stage: "setting_up_webhook", name: "Setting up GitHub webhook" },
  { stage: "configuring_vercel", name: "Updating frontend BACKEND_URL" },
  { stage: "writing_cursor_rules", name: "Writing Cursor/AI rules" },
  { stage: "finalizing", name: "Finalizing" },
];

export async function runSshBackendDeploy(opts: {
  supabase: WebsiteSupabaseClient;
  userId: string;
  siteId: string;
  site: {
    github_repo: string | null;
    github_repo_url: string;
    name: string;
    slug: string;
    vercel_project_id: string | null;
  };
  body: {
    serverId?: string;
    backendDir?: string;
    branch?: string;
    envVars?: Record<string, string>;
    startCommand?: string;
    domain?: string;
  };
}): Promise<Response> {
  const { supabase, userId, siteId, site, body } = opts;

  let serverId = body.serverId;
  if (!serverId) {
    const { data: servers } = await supabase
      .from("server_connections")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1);
    serverId = servers?.[0]?.id;
  }
  if (!serverId) {
    return json(
      {
        error: "No server connected. Add one in your Key Vault first.",
        missingPlatform: "server",
      },
      400,
    );
  }

  const { data: server } = await supabase
    .from("server_connections")
    .select("*")
    .eq("id", serverId)
    .eq("user_id", userId)
    .single();
  if (!server) return json({ error: "Server not found" }, 404);

  const steps: BackendStep[] = BACKEND_STAGES.map((stage) => ({
    stage: stage.stage,
    name: stage.name,
    status: "pending",
  }));

  const flushSteps = async () => {
    await updateSite(supabase, siteId, {
      backend_deploy_log: steps,
      updated_at: new Date().toISOString(),
    });
  };

  const runStage = async <T>(
    stage: BackendDeployStage,
    fn: () => Promise<T>,
    stageOpts: { optional?: boolean } = {},
  ): Promise<T | null> => {
    const idx = steps.findIndex((step) => step.stage === stage);
    if (idx < 0) return fn();
    steps[idx] = {
      ...steps[idx]!,
      status: "running",
      startedAt: new Date().toISOString(),
    };
    await flushSteps();
    try {
      const result = await fn();
      steps[idx] = {
        ...steps[idx]!,
        status: "success",
        completedAt: new Date().toISOString(),
      };
      await flushSteps();
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (stageOpts.optional) {
        steps[idx] = {
          ...steps[idx]!,
          status: "skipped",
          completedAt: new Date().toISOString(),
          error: msg.slice(0, 500),
        };
        await flushSteps();
        return null;
      }
      steps[idx] = {
        ...steps[idx]!,
        status: "error",
        completedAt: new Date().toISOString(),
        error: msg.slice(0, 1000),
      };
      await flushSteps();
      throw err;
    }
  };

  const skipStage = async (stage: BackendDeployStage) => {
    const idx = steps.findIndex((step) => step.stage === stage);
    if (idx < 0) return;
    steps[idx] = {
      ...steps[idx]!,
      status: "skipped",
      completedAt: new Date().toISOString(),
    };
    await flushSteps();
  };

  await updateSite(supabase, siteId, {
    backend_provider: "ssh",
    backend_status: "deploying",
    server_connection_id: serverId,
    backend_deploy_error: null,
    backend_deploy_log: steps,
    updated_at: new Date().toISOString(),
  });

  const serverRecord = server as Record<string, any>;
  const resolvedServerId = serverId;

  runInBackground(async () => {
    try {
      const creds = resolveSSHCreds(serverRecord);

      await runStage("connecting_ssh", async () => {
        await runCommand(creds, "echo ok", 10_000);
      });

      let prereqs: PrerequisiteCheck = {
        docker: false,
        caddy: false,
        python3: false,
        git: false,
        systemctl: false,
      };
      await runStage("checking_prerequisites", async () => {
        prereqs = await checkPrerequisites(creds);
      });

      const missing: Partial<PrerequisiteCheck> = {};
      for (const [key, value] of Object.entries(prereqs) as Array<
        [keyof PrerequisiteCheck, boolean]
      >) {
        if (!value) missing[key] = false;
      }
      if (Object.keys(missing).length > 0) {
        await runStage("installing_prerequisites", async () => {
          await installPrerequisites(creds, missing);
        });
      } else {
        await skipStage("installing_prerequisites");
      }

      const portResult = await runStage("finding_port", async () =>
        findAvailablePort(creds),
      );
      const port = portResult!.port;

      const repoUrl = site.github_repo_url.endsWith(".git")
        ? site.github_repo_url
        : `${site.github_repo_url}.git`;

      const cloneIdx = steps.findIndex((step) => step.stage === "cloning_repo");
      const depsIdx = steps.findIndex(
        (step) => step.stage === "installing_deps",
      );
      const pm2Idx = steps.findIndex((step) => step.stage === "starting_pm2");
      if (cloneIdx >= 0) {
        steps[cloneIdx] = {
          ...steps[cloneIdx]!,
          status: "running",
          startedAt: new Date().toISOString(),
        };
      }
      await flushSteps();

      let result: { backendUrl: string };
      try {
        result = await sshDeployBackend(creds, {
          repoUrl,
          branch: body.branch || "main",
          backendDir: body.backendDir || "back-end",
          siteSlug: site.slug,
          port,
          envVars: body.envVars,
          startCommand: body.startCommand,
        });
        const nowIso = new Date().toISOString();
        if (cloneIdx >= 0) {
          steps[cloneIdx] = {
            ...steps[cloneIdx]!,
            status: "success",
            completedAt: nowIso,
          };
        }
        if (depsIdx >= 0) {
          steps[depsIdx] = {
            ...steps[depsIdx]!,
            status: "success",
            startedAt: nowIso,
            completedAt: nowIso,
          };
        }
        if (pm2Idx >= 0) {
          steps[pm2Idx] = {
            ...steps[pm2Idx]!,
            status: "success",
            startedAt: nowIso,
            completedAt: nowIso,
          };
        }
        await flushSteps();
      } catch (err) {
        const nowIso = new Date().toISOString();
        const msg =
          err instanceof Error
            ? err.message.slice(0, 1000)
            : "Clone/install/start failed";
        if (cloneIdx >= 0) {
          steps[cloneIdx] = {
            ...steps[cloneIdx]!,
            status: "error",
            completedAt: nowIso,
            error: msg,
          };
        }
        await flushSteps();
        throw err;
      }

      let backendUrl = result.backendUrl;

      if (body.domain) {
        await runStage("configuring_caddy", async () => {
          await setupCaddy(creds, body.domain!, port);
          backendUrl = `https://${body.domain}`;
        });

        await runStage(
          "configuring_dns",
          async () => {
            const { data: cfVault } = await supabase
              .from("vault_entries")
              .select("encrypted_token, iv, auth_tag")
              .eq("user_id", userId)
              .eq("platform", "cloudflare")
              .single();
            if (!cfVault) {
              throw new Error(
                "Cloudflare not connected — DNS must be configured manually",
              );
            }
            const cfRaw = decryptVaultValue(
              cfVault.encrypted_token,
              cfVault.iv,
              cfVault.auth_tag,
            );
            const parsed = parseRecord(cfRaw);
            const cfToken = stringValue(parsed?.api_token) || cfRaw;

            const zone = await getZoneForDomain(cfToken, body.domain!);
            const isApex = body.domain === zone.name;
            const recordName = isApex
              ? "@"
              : body.domain!.replace(`.${zone.name}`, "");

            const existing = await listDnsRecords(
              cfToken,
              zone.id,
              body.domain!,
            );
            for (const rec of existing) {
              if (rec.type === "A" || rec.type === "CNAME") {
                await deleteDnsRecord(cfToken, zone.id, rec.id);
              }
            }
            await createDnsRecord(cfToken, zone.id, {
              type: "A",
              name: recordName,
              content: serverRecord.host,
              proxied: false,
            });
          },
          { optional: true },
        );
      } else {
        await skipStage("configuring_caddy");
        await skipStage("configuring_dns");
      }

      await runStage(
        "setting_up_webhook",
        async () => {
          await setupWebhookReceiver(creds);
        },
        { optional: true },
      );

      const webhookSecret = crypto.randomBytes(32).toString("hex");
      await runCommand(
        creds,
        `echo '${webhookSecret}' > /opt/${site.slug}/.webhook-secret`,
        10_000,
      );

      await runStage(
        "setting_up_webhook",
        async () => {
          const { data: ghVault } = await supabase
            .from("vault_entries")
            .select("encrypted_token, iv, auth_tag")
            .eq("user_id", userId)
            .eq("platform", "github")
            .single();

          if (!ghVault || !site.github_repo) {
            throw new Error("GitHub not connected — webhook skipped");
          }

          const ghRaw = decryptVaultValue(
            ghVault.encrypted_token,
            ghVault.iv,
            ghVault.auth_tag,
          );
          const parsed = parseRecord(ghRaw);
          const ghToken = stringValue(parsed?.access_token) || ghRaw;
          const [owner, repo] = site.github_repo.split("/");
          const webhookUrl = body.domain
            ? `https://${body.domain}:9000/webhook/${site.slug}`
            : `http://${serverRecord.host}:9000/webhook/${site.slug}`;

          await fetchWithTimeout(
            `https://api.github.com/repos/${owner}/${repo}/hooks`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${ghToken}`,
                "Content-Type": "application/json",
                Accept: "application/vnd.github+json",
              },
              body: JSON.stringify({
                name: "web",
                active: true,
                events: ["push"],
                config: {
                  url: webhookUrl,
                  content_type: "json",
                  secret: webhookSecret,
                  insecure_ssl: "0",
                },
              }),
            },
          );
        },
        { optional: true },
      );

      if (site.vercel_project_id && backendUrl) {
        await runStage(
          "configuring_vercel",
          async () => {
            const { data: vercelVault } = await supabase
              .from("vault_entries")
              .select("encrypted_token, iv, auth_tag")
              .eq("user_id", userId)
              .eq("platform", "vercel")
              .single();
            if (!vercelVault) {
              throw new Error(
                "Vercel not connected — frontend env not updated",
              );
            }
            const vRaw = decryptVaultValue(
              vercelVault.encrypted_token,
              vercelVault.iv,
              vercelVault.auth_tag,
            );
            const parsed = parseRecord(vRaw);
            const vToken = stringValue(parsed?.access_token) || vRaw;
            const vTeamId = stringValue(parsed?.team_id) || null;

            await setEnvironmentVariables(
              vToken,
              site.vercel_project_id!,
              [
                {
                  key: "BACKEND_URL",
                  value: backendUrl,
                  target: ["production", "preview", "development"],
                  type: "plain",
                },
              ],
              vTeamId,
            );
            await triggerRedeploy(vToken, site.vercel_project_id!, vTeamId);
          },
          { optional: true },
        );
      } else {
        await skipStage("configuring_vercel");
      }

      await runStage(
        "writing_cursor_rules",
        async () => {
          const { data: ghVaultForRules } = await supabase
            .from("vault_entries")
            .select("encrypted_token, iv, auth_tag")
            .eq("user_id", userId)
            .eq("platform", "github")
            .single();

          if (ghVaultForRules && site.github_repo) {
            const ghRawRules = decryptVaultValue(
              ghVaultForRules.encrypted_token,
              ghVaultForRules.iv,
              ghVaultForRules.auth_tag,
            );
            const parsed = parseRecord(ghRawRules);
            const ghTokenRules =
              stringValue(parsed?.access_token) || ghRawRules;
            const [repoOwner, repoName] = site.github_repo.split("/");

            const sshRuleContent = `---
description: Server SSH connection info for AI operations (auto-generated by Website)
alwaysApply: false
---

# Backend Server SSH

When the user or AI needs to operate on the backend server (view logs, restart, debug, install deps), use this info:

## Connection

\`\`\`
SSH_HOST=${serverRecord.host}
SSH_USER=${serverRecord.username}
SSH_PORT=${serverRecord.port}
\`\`\`

## Common Commands

- View service status: \`systemctl status ${site.slug}-backend\`
- View logs: \`journalctl -u ${site.slug}-backend --no-pager -n 50\`
- Restart service: \`systemctl restart ${site.slug}-backend\`
- View running processes: \`ps aux | grep uvicorn\`
- Disk usage: \`df -h\`
- Memory: \`free -h\`

## Backend Code Location

\`/opt/${site.slug}/back-end/\`

## Auto-Deploy

Code changes pushed to \`back-end/\` on the \`main\` branch will auto-deploy via webhook.
Manual deploy: \`bash /opt/${site.slug}/deploy.sh\`

## Management API

- Status: \`GET ${backendUrl.replace(/\/$/, "")}:9000/ops/status\`
- Logs: \`GET ${backendUrl.replace(/\/$/, "")}:9000/ops/logs\`
- Restart: \`POST ${backendUrl.replace(/\/$/, "")}:9000/ops/restart\`
`;

            await updateFileContent(
              ghTokenRules,
              repoOwner!,
              repoName!,
              ".cursor/rules/server-ssh.mdc",
              sshRuleContent,
              "Add server SSH rules for Cursor AI (auto-generated by Website)",
            );

            const agentsContent = `# Backend Server

- Backend deployed at: ${backendUrl}
- Server: ${serverRecord.host}:${serverRecord.port} (user: ${serverRecord.username})
- Backend code: \`/opt/${site.slug}/back-end/\`
- Auto-deploy: push to \`back-end/\` on main branch
- Manual deploy: \`bash /opt/${site.slug}/deploy.sh\`
- Service: \`systemctl [status|restart] ${site.slug}-backend\`
- Logs: \`journalctl -u ${site.slug}-backend -n 50\`
`;

            await updateFileContent(
              ghTokenRules,
              repoOwner!,
              repoName!,
              "BACKEND_SERVER.md",
              agentsContent,
              "Add backend server info (auto-generated by Website)",
            );
          } else {
            throw new Error("GitHub not connected — Cursor rules not written");
          }
        },
        { optional: true },
      );

      await runStage("finalizing", async () => {
        await updateSite(supabase, siteId, {
          backend_url: backendUrl,
          backend_project_id: serverRecord.host,
          backend_port: port,
          backend_status: "running",
          backend_deploy_error: null,
          backend_deploy_log: steps,
          webhook_secret: webhookSecret,
          updated_at: new Date().toISOString(),
        });

        await supabase
          .from("server_connections")
          .update({
            site_id: siteId,
            last_connected_at: new Date().toISOString(),
          })
          .eq("id", resolvedServerId);
      });
    } catch (err) {
      console.error("[backend deploy] Error:", err);
      await updateSite(supabase, siteId, {
        backend_status: "error",
        backend_deploy_error:
          err instanceof Error ? err.message.slice(0, 1000) : "Unknown error",
        backend_deploy_log: steps,
        updated_at: new Date().toISOString(),
      });
    }
  });

  return json({
    status: "deploying",
    provider: "ssh",
    serverId: resolvedServerId,
  });
}

const backendHandler = responseHandler({
  GET: async (request, params) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    const id = parameter(params, "id");

    const { data: site } = await auth.supabase
      .from("deployed_sites")
      .select("*")
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .single();

    if (!site) return json({ error: "Site not found" }, 404);
    const siteRecord = site as Record<string, unknown>;

    return json({
      provider: site.backend_provider,
      projectId: site.backend_project_id,
      url: site.backend_url,
      status: site.backend_status,
      error: siteRecord.backend_deploy_error || null,
      serverId: site.server_connection_id || null,
    });
  },

  POST: async (request, params) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    const id = parameter(params, "id");

    let body: {
      provider: "aliyun" | "railway" | "ssh";
      regionId?: string;
      imageId?: string;
      planId?: string;
      period?: number;
      port?: number;
      envVars?: Record<string, string>;
      serverId?: string;
      domain?: string;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    if (
      !body.provider ||
      !["aliyun", "railway", "ssh"].includes(body.provider)
    ) {
      return json(
        { error: "provider must be 'aliyun', 'railway', or 'ssh'" },
        400,
      );
    }

    const { data: site } = await auth.supabase
      .from("deployed_sites")
      .select("github_repo, github_repo_url, name, slug, vercel_project_id")
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .single();
    if (!site) return json({ error: "Site not found" }, 404);
    if (!site.github_repo_url) {
      return json(
        {
          error:
            "Site has no GitHub repo yet. Finish the initial deployment first.",
        },
        409,
      );
    }

    if (body.provider === "ssh") {
      return runSshBackendDeploy({
        supabase: auth.supabase,
        userId: auth.user.id,
        siteId: id,
        site: {
          github_repo: site.github_repo,
          github_repo_url: site.github_repo_url,
          name: site.name,
          slug: site.slug || site.name,
          vercel_project_id: site.vercel_project_id,
        },
        body: {
          serverId: body.serverId,
          envVars: body.envVars,
          domain: body.domain,
        },
      });
    }

    if (body.provider === "aliyun") {
      const creds = await getVaultCredentials(
        auth.supabase,
        auth.user.id,
        "aliyun",
      );
      if (!creds || !creds.access_key_id || !creds.access_key_secret) {
        return json(
          {
            error:
              "Alibaba Cloud is not connected. Connect it in your Key Vault first.",
            missingPlatform: "aliyun",
          },
          400,
        );
      }
      const ok = await validateAliyunCredentials(
        String(creds.access_key_id),
        String(creds.access_key_secret),
        body.regionId || "cn-hangzhou",
      );
      if (!ok) {
        return json(
          {
            error:
              "Alibaba Cloud AccessKey is invalid or lacks permissions. Reconnect it in your Key Vault.",
            invalidPlatform: "aliyun",
          },
          403,
        );
      }
    } else if (body.provider === "railway") {
      const creds = await getVaultCredentials(
        auth.supabase,
        auth.user.id,
        "railway",
      );
      if (!creds || !creds.api_token) {
        return json(
          {
            error:
              "Railway is not connected. Connect it in your Key Vault first.",
            missingPlatform: "railway",
          },
          400,
        );
      }
      const me = await validateRailwayToken(String(creds.api_token));
      if (!me) {
        return json(
          {
            error: "Railway token is invalid. Reconnect it in your Key Vault.",
            invalidPlatform: "railway",
          },
          403,
        );
      }
    }

    const vercelCreds = await getVaultCredentials(
      auth.supabase,
      auth.user.id,
      "vercel",
    );
    if (!vercelCreds) {
      return json(
        {
          error: "Vercel is not connected. Reconnect it in your Key Vault.",
          missingPlatform: "vercel",
        },
        400,
      );
    }

    await updateSite(auth.supabase, id, {
      backend_provider: body.provider,
      backend_status: "deploying",
      backend_deploy_error: null,
      updated_at: new Date().toISOString(),
    });

    const siteSnapshot = site;
    const userId = auth.user.id;
    const supabase = auth.supabase;

    runInBackground(async () => {
      try {
        let backendUrl = "";
        let backendProjectId = "";

        if (body.provider === "aliyun") {
          const creds = await getVaultCredentials(supabase, userId, "aliyun");
          if (!creds) throw new Error("Alibaba Cloud credentials disappeared");
          const result = await aliyunDeployBackend(
            String(creds.access_key_id),
            String(creds.access_key_secret),
            {
              regionId: body.regionId || "cn-hangzhou",
              imageId: body.imageId || "",
              planId: body.planId || "",
              period: body.period || 1,
              repoUrl: siteSnapshot.github_repo_url.endsWith(".git")
                ? siteSnapshot.github_repo_url
                : `${siteSnapshot.github_repo_url}.git`,
              backendDir: "back-end",
              port: body.port || 8000,
              envVars: body.envVars,
            },
          );
          backendUrl = result.backendUrl;
          backendProjectId = result.instanceId;
        } else {
          const creds = await getVaultCredentials(supabase, userId, "railway");
          if (!creds?.api_token) {
            throw new Error("Railway credentials disappeared");
          }
          const result = await deployFromGitHub(String(creds.api_token), {
            projectName: `${siteSnapshot.name}-backend`,
            repo: siteSnapshot.github_repo,
            branch: "main",
            rootDir: "back-end",
            envVars: body.envVars,
          });
          backendUrl = result.url;
          backendProjectId = result.projectId;
        }

        const vercelToken = vercelCreds.access_token
          ? String(vercelCreds.access_token)
          : "";
        const vercelTeamId = vercelCreds.team_id
          ? String(vercelCreds.team_id)
          : undefined;
        if (!vercelToken) {
          throw new Error(
            "Vercel token missing; reconnect Vercel in Key Vault.",
          );
        }
        if (siteSnapshot.vercel_project_id && backendUrl) {
          await setEnvironmentVariables(
            vercelToken,
            siteSnapshot.vercel_project_id,
            [
              {
                key: "BACKEND_URL",
                value: backendUrl,
                target: ["production", "preview", "development"],
                type: "plain",
              },
            ],
            vercelTeamId,
          );
          await triggerRedeploy(
            vercelToken,
            siteSnapshot.vercel_project_id,
            vercelTeamId,
          );
        }

        await updateSite(supabase, id, {
          backend_project_id: backendProjectId,
          backend_url: backendUrl,
          backend_status: "running",
          backend_deploy_error: null,
          updated_at: new Date().toISOString(),
        });
      } catch (err) {
        console.error("[backend deploy] Error:", err);
        await updateSite(supabase, id, {
          backend_status: "error",
          backend_deploy_error: errorMessage(err, "Unknown error").slice(
            0,
            1000,
          ),
          updated_at: new Date().toISOString(),
        });
      }
    });

    return json({ status: "deploying", provider: body.provider });
  },
});

const backendDeployHandler = responseHandler({
  POST: async (request, params) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    const siteId = parameter(params, "id");

    let body: {
      serverId?: string;
      backendDir?: string;
      branch?: string;
      envVars?: Record<string, string>;
      startCommand?: string;
      domain?: string;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const { data: site } = await auth.supabase
      .from("deployed_sites")
      .select("github_repo, github_repo_url, name, slug, vercel_project_id")
      .eq("id", siteId)
      .eq("user_id", auth.user.id)
      .single();
    if (!site) return json({ error: "Site not found" }, 404);
    if (!site.github_repo_url) {
      return json(
        {
          error:
            "Site has no GitHub repo yet. Finish the initial deployment first.",
        },
        409,
      );
    }

    return runSshBackendDeploy({
      supabase: auth.supabase,
      userId: auth.user.id,
      siteId,
      site: {
        github_repo: site.github_repo,
        github_repo_url: site.github_repo_url,
        name: site.name,
        slug: site.slug || site.name,
        vercel_project_id: site.vercel_project_id,
      },
      body,
    });
  },
});

export const BACKEND_WEBSITE_HANDLERS: Readonly<
  Record<string, PluginRouteHandler>
> = Object.freeze({
  "/api/sites/[id]/backend": backendHandler,
  "/api/sites/[id]/backend/deploy": backendDeployHandler,
});
