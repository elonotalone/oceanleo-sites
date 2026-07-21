import type { PluginRouteHandler } from "@oceanleo/plugin-runtime";

import {
  runDeployPipeline,
  type DeployConfig,
  type DeploymentStep,
} from "./deploy-pipeline";
import {
  refreshGithubAccessToken,
  validateGithubToken,
} from "./github-helpers";
import {
  listOrganizations,
  refreshSupabaseAccessToken,
} from "./supabase-management";
import { mergeOverrides, resolveSlots, type TemplateSlot } from "./template-slots";
import {
  detectVercelTeamId,
  refreshVercelAccessToken,
  validateVercelToken,
} from "./vercel-api";
import {
  authenticated,
  decryptVaultValue,
  encryptVaultValue,
  errorMessage,
  json,
  parseRecord,
  responseHandler,
  stringValue,
  type WebsiteSupabaseClient,
} from "./runtime";

interface DecryptedVault {
  access_token: string;
  refresh_token: string;
  team_id?: string | null;
}

async function getDecryptedVault(
  supabase: WebsiteSupabaseClient,
  userId: string,
  platform: string,
): Promise<DecryptedVault | null> {
  const { data } = await supabase
    .from("vault_entries")
    .select("encrypted_token, iv, auth_tag")
    .eq("user_id", userId)
    .eq("platform", platform)
    .single();
  if (!data) return null;
  try {
    const decrypted = decryptVaultValue(
      data.encrypted_token,
      data.iv,
      data.auth_tag,
    );
    const raw = decrypted.trim();
    if (!raw) return null;
    const parsed = parseRecord(raw);
    const accessToken = stringValue(parsed?.access_token);
    if (accessToken) {
      return {
        access_token: accessToken,
        refresh_token: stringValue(parsed?.refresh_token) || "",
        team_id: stringValue(parsed?.team_id) ?? null,
      };
    }
    return { access_token: raw, refresh_token: "", team_id: null };
  } catch {
    return null;
  }
}

async function persistRefreshedToken(
  supabase: WebsiteSupabaseClient,
  userId: string,
  platform: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const enc = encryptVaultValue(JSON.stringify(payload));
  await supabase
    .from("vault_entries")
    .update({
      encrypted_token: enc.ciphertext,
      iv: enc.iv,
      auth_tag: enc.tag,
      connected_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("platform", platform);
}

interface TokenWithRefresher {
  token: string;
  makeRefresher: () => () => Promise<string>;
}

async function getSupabaseTokenWithRefresher(
  supabase: WebsiteSupabaseClient,
  userId: string,
): Promise<TokenWithRefresher | null> {
  const vault = await getDecryptedVault(supabase, userId, "supabase");
  if (!vault) return null;

  const doRefresh = async (refreshToken: string) => {
    const refreshed = await refreshSupabaseAccessToken(refreshToken);
    await persistRefreshedToken(supabase, userId, "supabase", {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
    });
    return refreshed.access_token;
  };

  const createRefresher = () => {
    let used = false;
    return async (): Promise<string> => {
      if (used || !vault.refresh_token) {
        throw new Error(
          "Supabase token refresh unavailable or already attempted",
        );
      }
      used = true;
      return doRefresh(vault.refresh_token);
    };
  };

  let token = vault.access_token;
  try {
    await listOrganizations(token);
    return { token, makeRefresher: createRefresher };
  } catch {
    /* try refresh */
  }

  if (vault.refresh_token) {
    try {
      token = await doRefresh(vault.refresh_token);
    } catch (err) {
      console.warn("[deploy] Supabase token refresh failed:", err);
    }
  }

  return { token, makeRefresher: createRefresher };
}

interface VercelTokenResult {
  token: string;
  teamId: string | null;
  makeRefresher: () => () => Promise<string>;
}

async function getVercelTokenWithRefresher(
  supabase: WebsiteSupabaseClient,
  userId: string,
): Promise<VercelTokenResult | null> {
  const vault = await getDecryptedVault(supabase, userId, "vercel");
  if (!vault) return null;

  let teamId = typeof vault.team_id === "string" ? vault.team_id : null;

  const doRefresh = async (refreshToken: string) => {
    const refreshed = await refreshVercelAccessToken(refreshToken);
    if (refreshed.team_id) teamId = refreshed.team_id;
    await persistRefreshedToken(supabase, userId, "vercel", {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      team_id: teamId,
    });
    return refreshed.access_token;
  };

  const createRefresher = () => {
    let used = false;
    return async (): Promise<string> => {
      if (used || !vault.refresh_token) {
        throw new Error(
          "Vercel token refresh unavailable or already attempted. Re-connect Vercel.",
        );
      }
      used = true;
      return doRefresh(vault.refresh_token);
    };
  };

  let token = vault.access_token;
  if (!teamId && (token.startsWith("vca_") || token.startsWith("vci_"))) {
    const detected = await detectVercelTeamId(token);
    if (detected) teamId = detected;
  }

  const valid = await validateVercelToken(token, teamId);
  if (valid) {
    if (
      teamId &&
      teamId !== (typeof vault.team_id === "string" ? vault.team_id : null)
    ) {
      await persistRefreshedToken(supabase, userId, "vercel", {
        access_token: token,
        refresh_token: vault.refresh_token || "",
        team_id: teamId,
      });
    }
    return { token, teamId, makeRefresher: createRefresher };
  }

  if (vault.refresh_token) {
    try {
      token = await doRefresh(vault.refresh_token);
      return { token, teamId, makeRefresher: createRefresher };
    } catch (err) {
      console.warn("[deploy] Vercel token refresh failed:", err);
    }
  }

  return null;
}

interface GithubTokenResult {
  token: string;
  makeRefresher: () => () => Promise<string>;
}

async function getGithubTokenWithRefresher(
  supabase: WebsiteSupabaseClient,
  userId: string,
): Promise<GithubTokenResult | null> {
  const vault = await getDecryptedVault(supabase, userId, "github");
  if (!vault) return null;

  const doRefresh = async (refreshToken: string) => {
    const refreshed = await refreshGithubAccessToken(refreshToken);
    await persistRefreshedToken(supabase, userId, "github", {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
    });
    return refreshed.access_token;
  };

  const createRefresher = () => {
    let used = false;
    return async (): Promise<string> => {
      if (used || !vault.refresh_token) {
        throw new Error(
          "GitHub token refresh unavailable or already attempted. Re-connect GitHub.",
        );
      }
      used = true;
      return doRefresh(vault.refresh_token);
    };
  };

  let token = vault.access_token;
  const valid = await validateGithubToken(token);
  if (valid) return { token, makeRefresher: createRefresher };

  if (vault.refresh_token) {
    try {
      token = await doRefresh(vault.refresh_token);
    } catch (err) {
      console.warn("[deploy] GitHub token refresh failed:", err);
    }
  }

  return { token, makeRefresher: createRefresher };
}

/** In-process stand-in for Next.js `after()` — fire-and-forget async work. */
function runAfterResponse(work: () => Promise<void>): void {
  void work().catch((err) => {
    console.error("[deploy] background work failed:", err);
  });
}

const deployHandler = responseHandler({
  POST: async (request) => {
    try {
      const auth = await authenticated(request);
      if (!auth.ok) return auth.response;
      const { supabase, user } = auth;

      let body: {
        siteName?: string;
        templateSlug?: string;
        cursorApiKey?: string;
        cursorModel?: string;
        userTemplateId?: string;
      };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }

      const siteName =
        typeof body.siteName === "string" ? body.siteName.trim() : "";
      if (!siteName || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(siteName)) {
        return json({ error: "Invalid site name" }, 400);
      }

      const ghResult = await getGithubTokenWithRefresher(supabase, user.id);
      const vcResult = await getVercelTokenWithRefresher(supabase, user.id);
      const sbResult = await getSupabaseTokenWithRefresher(supabase, user.id);

      const invalidPlatforms: string[] = [];
      const missingPlatforms: string[] = [];
      for (const [label, result] of [
        ["github", ghResult],
        ["vercel", vcResult],
        ["supabase", sbResult],
      ] as const) {
        if (!result) {
          const vault = await getDecryptedVault(supabase, user.id, label);
          if (vault) invalidPlatforms.push(label);
          else missingPlatforms.push(label);
        }
      }

      if (invalidPlatforms.length > 0) {
        return json(
          {
            error: `Token expired or invalid for: ${invalidPlatforms.join(", ")}. Please disconnect and re-connect.`,
            invalidPlatforms,
          },
          403,
        );
      }

      if (missingPlatforms.length > 0) {
        return json(
          {
            error: `Missing platform connections. Complete onboarding first. Missing: ${missingPlatforms.join(", ")}`,
            missingPlatforms,
          },
          400,
        );
      }

      if (!ghResult || !vcResult || !sbResult) {
        return json(
          { error: "Missing platform connections. Complete onboarding first." },
          400,
        );
      }

      const cursorApiKey =
        typeof body.cursorApiKey === "string" ? body.cursorApiKey.trim() : "";
      const effectiveCursorApiKey =
        cursorApiKey || process.env.CURSOR_API_KEY || "";
      if (!effectiveCursorApiKey) {
        return json({ error: "Cursor API Key is required" }, 400);
      }

      let templateOwner = "website";
      let templateRepo = "template-default";
      let filesToRemove = [
        "back-end/",
        "docs/",
        "scripts/",
        ".cursorrules",
        "AGENTS.md",
        "agent.md",
        ".githooks/",
        ".cursor/rules/",
      ];
      let templateSlots: TemplateSlot[] = [];
      const templateSlug = body.templateSlug || "default";

      try {
        const { data: tmpl } = await supabase
          .from("templates")
          .select("*")
          .eq("slug", templateSlug)
          .eq("is_published", true)
          .single();
        if (tmpl) {
          templateOwner =
            (tmpl as Record<string, any>).github_template_owner ||
            templateOwner;
          templateRepo =
            (tmpl as Record<string, any>).github_template_repo || templateRepo;
          filesToRemove =
            (tmpl as Record<string, any>).files_to_remove || filesToRemove;
          templateSlots = resolveSlots(
            templateSlug,
            tmpl as { slots?: unknown },
          );
        }
      } catch {
        /* use defaults */
      }

      if (templateSlots.length === 0) {
        templateSlots = resolveSlots(templateSlug, null);
      }

      const userOverrides: Record<string, string> = {};
      let usedSnapshot: { owner: string; repo: string; ref?: string } | null =
        null;
      if (body.userTemplateId) {
        try {
          const { data: userTmpl } = await supabase
            .from("user_templates")
            .select("id, user_id, base_template_slug, overrides, snapshot_ref")
            .eq("id", body.userTemplateId)
            .eq("user_id", user.id)
            .single();
          if (userTmpl) {
            const raw = (userTmpl as Record<string, any>).overrides;
            if (raw && typeof raw === "object" && !Array.isArray(raw)) {
              for (const [key, value] of Object.entries(raw)) {
                if (typeof value === "string") userOverrides[key] = value;
              }
            }
            const snap = (userTmpl as Record<string, any>).snapshot_ref;
            if (snap && typeof snap === "object" && !Array.isArray(snap)) {
              const record = snap as Record<string, unknown>;
              if (
                record.type === "github-template" &&
                typeof record.owner === "string" &&
                typeof record.repo === "string"
              ) {
                usedSnapshot = {
                  owner: record.owner,
                  repo: record.repo,
                  ref:
                    typeof record.ref === "string" ? record.ref : undefined,
                };
              }
            }
          }
        } catch (err) {
          console.warn("[deploy] user_template lookup failed:", err);
        }
      }

      if (usedSnapshot) {
        templateOwner = usedSnapshot.owner;
        templateRepo = usedSnapshot.repo;
      }

      const appliedOverrides = mergeOverrides(templateSlots, userOverrides);

      const deployConfig: DeployConfig = {
        siteName,
        templateOwner,
        templateRepo,
        githubToken: ghResult.token,
        vercelToken: vcResult.token,
        vercelTeamId: vcResult.teamId,
        supabaseToken: sbResult.token,
        cursorApiKey: effectiveCursorApiKey,
        cursorModel: body.cursorModel || "composer-1.5",
        filesToRemove,
        refreshSupabaseToken: sbResult.makeRefresher(),
        refreshVercelToken: vcResult.makeRefresher(),
        refreshGithubToken: ghResult.makeRefresher(),
        overrides:
          Object.keys(userOverrides).length > 0 ? userOverrides : undefined,
        overrideSlots: templateSlots.map((slot) => ({
          id: slot.id,
          default: slot.default,
          type: slot.type,
        })),
      };

      const { data: existing } = await supabase
        .from("deployed_sites")
        .select("id, status")
        .eq("user_id", user.id)
        .eq("slug", siteName)
        .single();

      let site: { id: string };

      if (
        existing &&
        (existing.status === "error" || existing.status === "deploying")
      ) {
        const { data: updated, error: updateErr } = await supabase
          .from("deployed_sites")
          .update({
            name: siteName,
            status: "deploying",
            deploy_log: [],
            github_repo: null,
            github_repo_url: null,
            vercel_project_id: null,
            vercel_project_url: null,
            supabase_project_ref: null,
            supabase_project_url: null,
            site_url: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id)
          .select("id")
          .single();

        if (updateErr || !updated) {
          return json(
            {
              error: `Failed to reset site record: ${updateErr?.message}`,
            },
            500,
          );
        }
        site = updated;
      } else if (existing && existing.status === "live") {
        return json(
          {
            error:
              "A live site with this name already exists. Choose a different name.",
          },
          409,
        );
      } else {
        const { data: created, error: insertErr } = await supabase
          .from("deployed_sites")
          .insert({
            user_id: user.id,
            name: siteName,
            slug: siteName,
            template_id: null,
            deploy_mode: "vercel_only",
            status: "deploying",
            deploy_log: [],
            source: "template",
            capabilities: {
              vibe_code: true,
              env_edit: true,
              toggle_dns: true,
              domain: true,
            },
            dns_provider: "cloudflare",
          })
          .select("id")
          .single();

        if (insertErr) {
          return json(
            { error: `Failed to create site record: ${insertErr.message}` },
            500,
          );
        }
        site = created!;
      }

      const siteId = site.id;
      const userTemplateId = body.userTemplateId || null;

      runAfterResponse(async () => {
        try {
          const pipelineResult = await runDeployPipeline(
            deployConfig,
            async (steps: DeploymentStep[]) => {
              await supabase
                .from("deployed_sites")
                .update({
                  deploy_log: steps,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", siteId);
            },
          );
          const allSuccess = pipelineResult.steps.every(
            (step) =>
              step.status === "success" || step.status === "skipped",
          );
          await supabase
            .from("deployed_sites")
            .update({
              status: allSuccess ? "live" : "error",
              github_repo: pipelineResult.githubRepo,
              github_repo_url: pipelineResult.githubRepoUrl,
              vercel_project_id: pipelineResult.vercelProjectId,
              vercel_project_url: pipelineResult.vercelProjectUrl,
              supabase_project_ref: pipelineResult.supabaseProjectRef,
              supabase_project_url: pipelineResult.supabaseUrl
                ? `https://supabase.com/dashboard/project/${pipelineResult.supabaseProjectRef}`
                : null,
              site_url: pipelineResult.siteUrl,
              deploy_log: pipelineResult.steps,
              user_template_id: userTemplateId,
              applied_overrides: appliedOverrides,
              updated_at: new Date().toISOString(),
            })
            .eq("id", siteId);
        } catch (err) {
          await supabase
            .from("deployed_sites")
            .update({
              status: "error",
              deploy_log: [
                {
                  name: "pipeline",
                  status: "error",
                  error:
                    err instanceof Error ? err.message : "Unknown error",
                },
              ],
              updated_at: new Date().toISOString(),
            })
            .eq("id", siteId);
        }
      });

      return json({ siteId, status: "deploying" });
    } catch (err) {
      console.error("[deploy] Unhandled error:", err);
      return json(
        { error: errorMessage(err, "Internal server error") },
        500,
      );
    }
  },
});

export const DEPLOY_WEBSITE_HANDLERS: Readonly<
  Record<string, PluginRouteHandler>
> = Object.freeze({
  "/api/deploy": deployHandler,
});
